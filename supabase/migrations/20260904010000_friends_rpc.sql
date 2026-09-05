-- Friendship, as four operations rather than a table you write directly.
--
-- The table is two rows per pair, one in each direction, so "who are my
-- friends" stays an index lookup. That shape is right for reading and
-- impossible to maintain from the client: row-level security lets me write
-- only the row where I am `user_id`, so accepting a request - which has to
-- move *both* rows to accepted - cannot be expressed as a policy at all. A
-- client that could write the other direction could also make itself somebody
-- else's friend, which is the whole boundary.
--
-- So the pair moves together inside these functions, or it does not move.

-- Ask somebody to be a friend, by the handle they would say out loud.
--
-- Returns 'sent', 'accepted' when they had already asked us, 'friends' when we
-- already are, 'self', or 'unknown' if the handle matches nobody. A string
-- rather than an error, because none of these are exceptional and the app has
-- something different to say for each.
create or replace function public.request_friend(lookup text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target uuid;
  inbound text;
  outbound text;
begin
  select p.id into target from public.profiles p
    where p.handle = lower(trim(lookup));
  if target is null then return 'unknown'; end if;
  if target = auth.uid() then return 'self'; end if;

  select status into outbound from public.friendships
    where user_id = auth.uid() and friend_id = target;
  if outbound = 'accepted' then return 'friends'; end if;
  if outbound = 'blocked' then return 'blocked'; end if;

  select status into inbound from public.friendships
    where user_id = target and friend_id = auth.uid();
  if inbound = 'blocked' then
    -- Says the same thing as an unknown handle on purpose: whether somebody
    -- has blocked you is not information they owe you.
    return 'unknown';
  end if;

  -- Both of us asked. Nobody should have to accept a request they had already
  -- made themselves.
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

-- Accept a request somebody sent us. Both directions, or neither.
create or replace function public.accept_friend(other uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  pending boolean;
begin
  select exists (
    select 1 from public.friendships
    where user_id = other and friend_id = auth.uid() and status = 'pending'
  ) into pending;
  if not pending then return false; end if;

  update public.friendships set status = 'accepted'
    where user_id = other and friend_id = auth.uid();
  insert into public.friendships (user_id, friend_id, status)
    values (auth.uid(), other, 'accepted')
    on conflict (user_id, friend_id) do update set status = 'accepted';
  return true;
end;
$$;

-- Stop being friends, or turn down a request, or withdraw one. All the same
-- operation: the pair goes.
--
-- It also unseats us from each other's games. A game reaches a friend's
-- history *because* they are a friend, so a friendship that ends has to take
-- that access with it - leaving the seats behind would mean "remove friend"
-- quietly kept sharing every game they were ever in.
create or replace function public.remove_friend(other uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  delete from public.session_players sp
    using public.sessions s
    where sp.session_id = s.id
      and (
        (s.owner_id = auth.uid() and sp.user_id = other)
        or (s.owner_id = other and sp.user_id = auth.uid())
      );

  delete from public.friendships
    where (user_id = auth.uid() and friend_id = other)
       or (user_id = other and friend_id = auth.uid());
  return true;
end;
$$;

-- Refuse to hear from somebody again.
--
-- Keeps our own row, marked blocked, and drops theirs, so they see a
-- friendship that simply is not there rather than a notice that they were
-- blocked. `request_friend` reads that row and answers 'unknown'.
create or replace function public.block_user(other uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.remove_friend(other);
  insert into public.friendships (user_id, friend_id, status)
    values (auth.uid(), other, 'blocked')
    on conflict (user_id, friend_id) do update set status = 'blocked';
  return true;
end;
$$;

-- Everyone we have a friendship row with, in either direction, with enough of
-- their profile to draw a list.
--
-- This has to be a function. `profiles` is readable for accepted friends only,
-- which is right - but it means an incoming request would arrive as a bare
-- uuid with no name on it, and "somebody wants to be your friend" is not a
-- question anybody can answer. Handing back the name of a person who has
-- chosen to write to you is not a directory.
create or replace function public.friend_list()
returns table (
  id           uuid,
  display_name text,
  handle       text,
  status       text,
  -- 'out' when we asked, 'in' when they did. Meaningless once accepted.
  direction    text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.handle, f.status, 'out'::text
    from public.friendships f
    join public.profiles p on p.id = f.friend_id
   where f.user_id = auth.uid() and f.status <> 'blocked'
  union all
  select p.id, p.display_name, p.handle, f.status, 'in'::text
    from public.friendships f
    join public.profiles p on p.id = f.user_id
   where f.friend_id = auth.uid()
     and f.status = 'pending'
     -- Not if we have already answered it; the outbound half covers that.
     and not exists (
       select 1 from public.friendships mine
       where mine.user_id = auth.uid() and mine.friend_id = f.user_id
     );
$$;
