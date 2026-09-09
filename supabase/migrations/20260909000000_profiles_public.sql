-- Profiles people can actually look at, and a username that is the handle.
--
-- All of this follows from one decision: a profile is now something other
-- people see, rather than a row that existed so the app knew what to call you.

-- ---------------------------------------------------------------------------
-- Privacy, and the stats a profile shows
-- ---------------------------------------------------------------------------

-- Public by default. The alternative - private by default, with a prompt -
-- asks everyone to make a decision before they have seen what the thing is.
alter table public.profiles
  add column if not exists is_private boolean not null default false;

-- What a profile shows about somebody, written by their own device.
--
-- Denormalised on purpose. The numbers come from hands, and hands are readable
-- only by their owner and by whoever was seated in them; computing a stranger's
-- totals would mean opening that up, which is a far larger hole than copying a
-- few numbers and one hand's tile codes. It is the owner's own claim about
-- their own record, which is what a profile is.
alter table public.profiles
  add column if not exists stats jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Claiming a username
-- ---------------------------------------------------------------------------

-- Take `preferred`, or the first free variant of it.
--
-- Server-side because it has to be atomic. Two people signing in with the same
-- email local part at the same moment is rare, and the client-side version of
-- this - check, then write - loses that race silently, leaving one of them with
-- no username at all.
--
-- Returns the handle actually claimed, which is not always the one asked for.
create or replace function public.claim_handle(preferred text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 0;
begin
  -- Reduce to the alphabet the constraint allows, collapse runs of separators,
  -- and leave room for the digits a collision will need.
  base := lower(regexp_replace(coalesce(preferred, ''), '[^a-zA-Z0-9_]+', '_', 'g'));
  base := regexp_replace(base, '_+', '_', 'g');
  base := trim(both '_' from base);
  base := left(base, 16);
  if length(base) < 3 then
    base := 'player';
  end if;

  candidate := base;
  loop
    begin
      update public.profiles
        set handle = candidate, updated_at = now()
        where id = auth.uid();
      return candidate;
    exception when unique_violation then
      suffix := suffix + 1;
      -- Stop being polite rather than looping forever on a popular name.
      if suffix > 50 then
        candidate := base || '_' || substr(md5(random()::text), 1, 6);
      else
        candidate := base || suffix::text;
      end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Looking somebody up
-- ---------------------------------------------------------------------------

-- One profile, by exact username.
--
-- A function rather than a read policy, and that is the whole privacy design.
-- A policy saying "public profiles are readable" is also a policy saying
-- `GET /profiles?select=*` returns every user of the app - a directory nobody
-- asked for and a scrape waiting to happen. Requiring the exact name gives the
-- same answer to somebody who knows who they are looking for, and nothing at
-- all to somebody enumerating.
--
-- Private profiles answer as though they do not exist. That is what private
-- means here: unfindable, and so unrequestable.
create or replace function public.view_profile(lookup text)
returns table (
  id           uuid,
  display_name text,
  handle       text,
  stats        jsonb,
  is_private   boolean,
  friend_count integer,
  relation     text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.display_name,
    p.handle,
    p.stats,
    p.is_private,
    (select count(*)::integer from public.friendships f
      where f.user_id = p.id and f.status = 'accepted'),
    case
      when p.id = auth.uid() then 'self'
      when exists (select 1 from public.friendships f
                    where f.user_id = auth.uid() and f.friend_id = p.id
                      and f.status = 'accepted') then 'friend'
      when exists (select 1 from public.friendships f
                    where f.user_id = auth.uid() and f.friend_id = p.id
                      and f.status = 'pending') then 'requested'
      when exists (select 1 from public.friendships f
                    where f.user_id = p.id and f.friend_id = auth.uid()
                      and f.status = 'pending') then 'incoming'
      else 'none'
    end
  from public.profiles p
  where p.handle = lower(trim(lookup))
    and (
      p.id = auth.uid()
      or not p.is_private
      or exists (select 1 from public.friendships f
                  where f.user_id = auth.uid() and f.friend_id = p.id
                    and f.status = 'accepted')
    )
  limit 1;
$$;

-- The same shape for somebody we already have an id for: the friends list, and
-- opening a profile from it.
create or replace function public.view_profile_by_id(target uuid)
returns table (
  id           uuid,
  display_name text,
  handle       text,
  stats        jsonb,
  is_private   boolean,
  friend_count integer,
  relation     text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.display_name, p.handle, p.stats, p.is_private,
    (select count(*)::integer from public.friendships f
      where f.user_id = p.id and f.status = 'accepted'),
    case when p.id = auth.uid() then 'self' else 'friend' end
  from public.profiles p
  where p.id = target
    and (
      p.id = auth.uid()
      or exists (select 1 from public.friendships f
                  where f.user_id = auth.uid() and f.friend_id = p.id
                    and f.status = 'accepted')
      -- A pending request has to be readable, or "somebody wants to be your
      -- friend" is a question with no name attached to it.
      or exists (select 1 from public.friendships f
                  where f.user_id = p.id and f.friend_id = auth.uid()
                    and f.status = 'pending')
    )
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Requests respect privacy
-- ---------------------------------------------------------------------------

-- The previous body with one clause added: a private profile cannot be sent a
-- request, and answers 'unknown' rather than 'private', so that turning the
-- setting on does not itself become something strangers can detect.
create or replace function public.request_friend(lookup text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target uuid;
  private boolean;
  inbound text;
  outbound text;
begin
  select p.id, p.is_private into target, private
    from public.profiles p
   where p.handle = lower(trim(lookup));
  if target is null then return 'unknown'; end if;
  if target = auth.uid() then return 'self'; end if;

  select status into outbound from public.friendships
    where user_id = auth.uid() and friend_id = target;
  if outbound = 'accepted' then return 'friends'; end if;
  if outbound = 'blocked' then return 'blocked'; end if;

  -- Already-friends is answered above, so a private profile reaching here is
  -- somebody who has said they do not want to be found.
  if private then return 'unknown'; end if;

  select status into inbound from public.friendships
    where user_id = target and friend_id = auth.uid();
  if inbound = 'blocked' then
    return 'unknown';
  end if;

  if inbound = 'pending' then
    update public.friendships set status = 'accepted'
      where (user_id = target and friend_id = auth.uid());
    insert into public.friendships (user_id, friend_id, status)
      values (auth.uid(), target, 'accepted')
      on conflict (user_id, friend_id) do update set status = 'accepted';
    return 'accepted';
  end if;

  insert into public.friendships (user_id, friend_id, status)
    values (auth.uid(), target, 'pending')
    on conflict (user_id, friend_id) do nothing;
  return 'sent';
end;
$$;
