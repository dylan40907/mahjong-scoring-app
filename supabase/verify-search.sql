-- Prove what `search_profiles` returns, as real accounts.
--
-- `verify-rls.mjs` signs in anonymously, which is exactly who search turns
-- away, so over HTTP it can only prove the refusal. This covers the rest from
-- inside the database: it creates non-anonymous users directly in
-- `auth.users`, acts as each of them by setting the JWT claims `auth.uid()`
-- reads, and rolls everything back at the end. Nothing is left behind, and no
-- real account is touched.
--
-- Run it through the Supabase MCP server's `execute_sql`, or paste it into the
-- SQL editor. Silence and "search_profiles: all checks passed" mean it held;
-- any failure stops at the first broken promise with a sentence saying which.

begin;

do $$
declare
  tag      text := 'vs' || substr(md5(random()::text), 1, 6);
  me       uuid := gen_random_uuid();
  pub      uuid := gen_random_uuid();
  pu       uuid := gen_random_uuid();
  pal      uuid := gen_random_uuid();
  priv     uuid := gen_random_uuid();
  anonu    uuid := gen_random_uuid();
  blocker  uuid := gen_random_uuid();
  mute     uuid := gen_random_uuid();
  extra    uuid;
  found    text[];
  rel      text;
  n        integer;
begin
  insert into auth.users (id, is_anonymous) values
    (me, false), (pub, false), (pu, false), (pal, false),
    (priv, false), (anonu, true), (blocker, false), (mute, false);

  -- The signup trigger has made a profile for each; give them names.
  update public.profiles set handle = tag || '_me' where id = me;
  update public.profiles set handle = tag || '_pub', display_name = 'Mei Q' || tag where id = pub;
  update public.profiles set handle = tag || '_pu' where id = pu;
  update public.profiles set handle = tag || '_pal' where id = pal;
  update public.profiles set handle = tag || '_priv', is_private = true where id = priv;
  update public.profiles set handle = tag || '_anon' where id = anonu;
  update public.profiles set handle = tag || '_block' where id = blocker;
  update public.profiles set handle = tag || '_mute' where id = mute;

  -- Ten more, all public, to find out whether the cap holds.
  for i in 1..10 loop
    extra := gen_random_uuid();
    insert into auth.users (id, is_anonymous) values (extra, false);
    update public.profiles set handle = tag || '_x' || lpad(i::text, 2, '0') where id = extra;
  end loop;

  insert into public.friendships (user_id, friend_id, status) values
    (me, pal, 'accepted'), (pal, me, 'accepted'),
    (blocker, me, 'blocked'),
    (me, mute, 'blocked');

  -- Everything below is asked as `me`, a real account.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', me, 'role', 'authenticated', 'is_anonymous', false)::text,
    true
  );

  select array_agg(r.handle order by r.handle) into found
    from public.search_profiles(tag || '_p') r;
  assert found = array[tag || '_pal', tag || '_pu', tag || '_pub'],
    format('a username prefix finds the public profiles and no private one: got %s', found);

  select r.relation into rel from public.search_profiles(tag || '_pal') r;
  assert rel = 'friend', format('a friend is marked as one: got %s', rel);

  select array_agg(r.handle) into found from public.search_profiles(tag || '_pu') r;
  assert found[1] = tag || '_pu', format('an exact username comes first: got %s', found);

  select count(*) into n from public.search_profiles(tag || '_a');
  assert n = 0, format('anonymous accounts are never found: got %s', n);

  select count(*) into n from public.search_profiles(tag || '_b');
  assert n = 0, format('somebody who blocked you is not found: got %s', n);

  select count(*) into n from public.search_profiles(tag || '_mu');
  assert n = 0, format('somebody you blocked is not found: got %s', n);

  select count(*) into n from public.search_profiles(tag || '_me');
  assert n = 0, format('you do not find yourself: got %s', n);

  select count(*) into n from public.search_profiles(tag || '_x');
  assert n = 8, format('no more than eight come back: got %s', n);

  select array_agg(r.handle) into found from public.search_profiles('q' || tag) r;
  assert found = array[tag || '_pub'], format('any word of a name is searched: got %s', found);

  select count(*) into n from public.search_profiles('@' || tag || '_pub');
  assert n = 1, format('a leading @ is ignored: got %s', n);

  select count(*) into n from public.search_profiles('v');
  assert n = 0, format('one character is not a search: got %s', n);

  -- The quota. Parked at the limit, the next search is refused outright.
  update public.search_quota set used = 120, window_start = now() where user_id = me;
  begin
    perform * from public.search_profiles(tag);
    raise exception 'the hourly quota was not enforced';
  exception when sqlstate 'PT429' then
    null;
  end;

  -- And an hour later it has turned over.
  update public.search_quota set used = 500, window_start = now() - interval '2 hours'
    where user_id = me;
  select count(*) into n from public.search_profiles(tag || '_pub');
  assert n = 1, format('the quota resets after an hour: got %s', n);

  -- The same query from an anonymous session gets nothing at all.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', anonu, 'role', 'authenticated', 'is_anonymous', true)::text,
    true
  );
  select count(*) into n from public.search_profiles(tag || '_pub');
  assert n = 0, format('an anonymous account cannot search: got %s', n);

  raise notice 'search_profiles: all checks passed';
end;
$$;

rollback;
