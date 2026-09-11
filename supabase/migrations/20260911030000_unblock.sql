-- The people you have blocked, and a way to change your mind.
--
-- Blocking used to be a one-way door: the row was kept, so it went on working,
-- but `friend_list` left it out and nothing could remove it. Somebody blocked
-- by a mis-tap stayed blocked for good, and the only evidence was that they
-- could no longer be found.

-- The list now includes the blocks we made. Only ours: a block somebody else
-- made against us is still never reported, because whether you have been
-- blocked is not information anybody owes you. Older builds filter the list to
-- accepted and pending rows, so the extra rows are invisible to them.
create or replace function public.friend_list()
returns table (
  id           uuid,
  display_name text,
  handle       text,
  status       text,
  -- 'out' when we asked (or blocked), 'in' when they asked.
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
   where f.user_id = auth.uid()
  union all
  select p.id, p.display_name, p.handle, f.status, 'in'::text
    from public.friendships f
    join public.profiles p on p.id = f.user_id
   where f.friend_id = auth.uid()
     and f.status = 'pending'
     -- Not if we have already answered it, or blocked them; our own row
     -- covers both.
     and not exists (
       select 1 from public.friendships mine
       where mine.user_id = auth.uid() and mine.friend_id = f.user_id
     );
$$;

-- Lift a block. Deliberately not a restore: the friendship the block ended
-- stays ended, and the seats it took away stay taken. Unblocking only makes
-- the two of you findable to each other again, so either can start over.
create or replace function public.unblock_user(other uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  delete from public.friendships
   where user_id = auth.uid() and friend_id = other and status = 'blocked';
  return found;
end;
$$;

-- Both, and each for its own reason. Postgres grants EXECUTE to PUBLIC, which
-- anon belongs to, so revoking from anon alone does nothing; and Supabase's
-- default privileges grant every new function to anon by name as well, so
-- revoking from PUBLIC alone leaves that grant standing. This function was
-- callable signed out until anon was added to the revoke.
revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;
revoke execute on function public.friend_list() from public;
