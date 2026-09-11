-- Name people by their account, not by what they are called this week.
--
-- A username can change, and until now that could go wrong in two quiet ways.
-- The friends list cached each friend's username and opened their profile by
-- it, so a friend who renamed themselves opened as "Nobody by that name" until
-- the next sync - or, if somebody else had since taken the old name, opened as
-- a stranger. And a friend request queued with no signal carried the username
-- that was typed, so a rename before it was sent sent it to nobody, or to
-- whoever holds that name now.
--
-- Both are fixed the same way: once the app knows who somebody is, it asks by
-- their account id, which never changes. A username is only ever used to find
-- somebody in the first place.
--
-- Blocking also becomes symmetrical for profiles. Search already hid the two
-- people from each other in both directions; a profile opened by exact name or
-- by id now does the same, rather than showing a page whose one button quietly
-- fails.

-- ---------------------------------------------------------------------------
-- Friend requests
-- ---------------------------------------------------------------------------

-- The whole of the request logic, by account.
--
-- One ordering change from the old `request_friend`: somebody who has already
-- asked us is answered before privacy is considered. A private profile that
-- sent a request plainly wants this friendship, and asking them back used to
-- come back 'unknown' because the privacy check ran first.
create or replace function public.request_friend_by_id(target uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  private boolean;
  inbound text;
  outbound text;
begin
  if auth.uid() is null or target is null then return 'unknown'; end if;
  if target = auth.uid() then return 'self'; end if;

  select p.is_private into private from public.profiles p where p.id = target;
  if not found then return 'unknown'; end if;

  select status into outbound from public.friendships
    where user_id = auth.uid() and friend_id = target;
  if outbound = 'accepted' then return 'friends'; end if;
  if outbound = 'blocked' then return 'blocked'; end if;

  select status into inbound from public.friendships
    where user_id = target and friend_id = auth.uid();
  -- Whether somebody has blocked you is not information they owe you.
  if inbound = 'blocked' then return 'unknown'; end if;

  if inbound = 'pending' then
    update public.friendships set status = 'accepted'
      where user_id = target and friend_id = auth.uid();
    insert into public.friendships (user_id, friend_id, status)
      values (auth.uid(), target, 'accepted')
      on conflict (user_id, friend_id) do update set status = 'accepted';
    return 'accepted';
  end if;

  -- Private: unfindable, and so unrequestable, answered as though nobody is
  -- there so that the setting is not itself detectable.
  if private then return 'unknown'; end if;

  insert into public.friendships (user_id, friend_id, status)
    values (auth.uid(), target, 'pending')
    on conflict (user_id, friend_id) do nothing;
  return 'sent';
end;
$$;

-- The username form, kept for requests queued by an older build. It finds the
-- account and hands over; there is one copy of the rules.
create or replace function public.request_friend(lookup text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  select p.id into target from public.profiles p where p.handle = lower(trim(lookup));
  if target is null then return 'unknown'; end if;
  return public.request_friend_by_id(target);
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

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
    and not exists (
      select 1 from public.friendships f
       where f.status = 'blocked'
         and ((f.user_id = p.id and f.friend_id = auth.uid())
           or (f.user_id = auth.uid() and f.friend_id = p.id))
    )
  limit 1;
$$;

-- The same answer as `view_profile`, for somebody the app already knows by id.
--
-- It used to be narrower - self, friends, and people with a request waiting on
-- us - and it labelled every one of them 'friend', including the requests.
-- Now it applies exactly the visibility `view_profile` does, plus the pending
-- request (a request with no name on it is a question nobody can answer), and
-- says how the two people actually stand.
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
  where p.id = target
    and (
      p.id = auth.uid()
      or not p.is_private
      or exists (select 1 from public.friendships f
                  where f.user_id = auth.uid() and f.friend_id = p.id
                    and f.status = 'accepted')
      or exists (select 1 from public.friendships f
                  where f.user_id = p.id and f.friend_id = auth.uid()
                    and f.status = 'pending')
    )
    and not exists (
      select 1 from public.friendships f
       where f.status = 'blocked'
         and ((f.user_id = p.id and f.friend_id = auth.uid())
           or (f.user_id = auth.uid() and f.friend_id = p.id))
    )
  limit 1;
$$;

-- The same surface rules as everything else social: signed in, or nothing.
revoke execute on function public.request_friend_by_id(uuid) from public, anon;
grant execute on function public.request_friend_by_id(uuid) to authenticated;
revoke execute on function public.request_friend(text) from public, anon;
revoke execute on function public.view_profile(text) from public, anon;
revoke execute on function public.view_profile_by_id(uuid) from public, anon;
