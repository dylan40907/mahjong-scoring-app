-- Finding somebody by typing part of their name.
--
-- Until now a profile could only be reached by its exact username, and that was
-- the whole privacy design: no directory, nothing to enumerate. It also made the
-- friends screen close to useless, because usernames here are made for people
-- rather than chosen by them. A friend's is whatever came before the @ in an
-- email address you have never seen, and nobody can type that from memory.
--
-- Search as you type is what every other app does. What makes it safe enough
-- is not one rule but a stack of limits, each closing a different way of
-- turning a search box into a directory:
--
--   * Only real accounts search, and only real accounts are found. An anonymous
--     account costs nothing to make, so letting one search would make every
--     per-account limit below a per-request limit instead. And an anonymous
--     profile is never somebody a person is looking for.
--   * Private profiles never appear. Private already meant "cannot be found";
--     it now also means "not in search", which is what people will assume it
--     means anyway.
--   * A block hides both people from each other, in either direction.
--   * Two characters or more, and eight results at most. One letter matches a
--     slice of everyone, which is browsing rather than searching.
--   * A quota per account per hour. A person finding four friends types perhaps
--     thirty queries; somebody walking every two-letter prefix needs well over
--     a thousand, and gets eight rows from each.
--   * A name and a username come back, and nothing else - no account id, no
--     stats. Those are a tap further on, through `view_profile`, which applies
--     its own rules.
--
-- Verified with `supabase/verify-search.sql`, which creates real (non-
-- anonymous) accounts inside a transaction and rolls it back. `verify-rls.mjs`
-- can only cover the refusal: it signs in anonymously, which is exactly who
-- this function turns away.

-- ---------------------------------------------------------------------------
-- The quota
-- ---------------------------------------------------------------------------

create table if not exists public.search_quota (
  user_id      uuid primary key references auth.users on delete cascade,
  window_start timestamptz not null default now(),
  used         integer not null default 0
);

-- Row level security on and no policies at all: nothing can read or write this
-- through the API. The only way in is `search_profiles`, which runs as its
-- owner. The advisor lists this as "RLS enabled, no policy", and here that is
-- the point rather than an oversight.
alter table public.search_quota enable row level security;

-- ---------------------------------------------------------------------------
-- The search
-- ---------------------------------------------------------------------------

create or replace function public.search_profiles(query text)
returns table (handle text, display_name text, relation text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q text;
  spent integer;
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return;
  end if;

  -- People type the @ they have seen in front of usernames elsewhere.
  q := ltrim(lower(trim(coalesce(query, ''))), '@');
  if length(q) < 2 then
    return;
  end if;
  q := left(q, 40);

  -- Counted before searching, so a search that finds nobody still counts -
  -- misses are most of what an enumeration is made of. The window is fixed
  -- rather than sliding: simpler to reason about, and the difference only
  -- matters to somebody who is already over the limit.
  insert into public.search_quota as sq (user_id, window_start, used)
    values (auth.uid(), now(), 1)
  on conflict (user_id) do update set
    used = case when sq.window_start < now() - interval '1 hour' then 1 else sq.used + 1 end,
    window_start = case when sq.window_start < now() - interval '1 hour' then now() else sq.window_start end
  returning sq.used into spent;

  -- PostgREST turns a `PTxxx` code into HTTP status xxx, so the app gets a 429
  -- it can put into words rather than an empty list that looks like nobody
  -- exists. Raising rolls the count back, which leaves it parked at the limit
  -- until the window turns over.
  if spent > 120 then
    raise exception 'too many searches' using errcode = 'PT429';
  end if;

  return query
    select
      p.handle,
      p.display_name,
      case
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
    join auth.users u on u.id = p.id
    where p.handle is not null
      and p.id <> auth.uid()
      and not p.is_private
      and not coalesce(u.is_anonymous, false)
      and not exists (
        select 1 from public.friendships f
         where f.status = 'blocked'
           and ((f.user_id = p.id and f.friend_id = auth.uid())
             or (f.user_id = auth.uid() and f.friend_id = p.id))
      )
      -- The start of the username, or the start of any word in the name.
      -- `starts_with` and `position` rather than LIKE, because an underscore
      -- is a LIKE wildcard and usernames are full of them.
      and (
        starts_with(p.handle, q)
        or position(' ' || q in ' ' || lower(coalesce(p.display_name, ''))) > 0
      )
    order by
      (p.handle = q) desc,
      starts_with(p.handle, q) desc,
      length(p.handle),
      p.handle
    limit 8;
end;
$$;

revoke execute on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;
