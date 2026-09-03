-- Tile Tally: accounts, sync and sharing.
--
-- Two things shape this schema and are worth stating before the tables.
--
-- Ids are text and come from the client. The app has always generated its own
-- ids (`makeId`) and stored hands offline for days before anything reaches a
-- server, so the server cannot be the thing that names a row. A uuid default
-- here would mean every local record changing identity on its first sync.
--
-- `updated_at` is written by the client and never by a trigger. It is the
-- conflict resolver: last write wins, compared across devices. A
-- `moddatetime` trigger would stamp server time on arrival, which makes every
-- pushed row look newer than the copy that was actually edited later, and the
-- older edit would then win on the next pull.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  -- Prefilled into seat one of every new session. Null until they set it.
  display_name     text,
  -- How friends find each other: short, readable, and sayable out loud at a
  -- table, which is the whole reason it is not an email address.
  handle           text unique,
  showcase_hand_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint handle_shape check (
    handle is null or handle ~ '^[a-z0-9_]{3,20}$'
  )
);

-- ---------------------------------------------------------------------------
-- The game data
-- ---------------------------------------------------------------------------

create table if not exists public.sessions (
  id            text primary key,
  owner_id      uuid not null references auth.users on delete cascade,
  name          text not null default 'Session',
  ruleset_id    text not null,
  -- Players stay names rather than accounts. Three of the four people at a
  -- table will not have the app, and requiring them to would break scoring for
  -- the ordinary case. Linking a seat to a friend is an optional extra later.
  players       jsonb not null default '[]'::jsonb,
  round_wind    text not null default 'east',
  dealer_id     text,
  dealer_streak integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Tombstone. A delete that syncs as an absence is a delete that comes back
  -- from whichever device had not heard about it yet.
  deleted_at    timestamptz
);

create table if not exists public.hands (
  id           text primary key,
  session_id   text not null references public.sessions on delete cascade,
  owner_id     uuid not null references auth.users on delete cascade,
  winner_id    text not null,
  discarder_id text,
  -- The StoredHand exactly as the client already serialises it. The scoring
  -- engine is the only thing that understands its shape and it lives on the
  -- device, so the server has no business destructuring it.
  payload      jsonb not null,
  deltas       jsonb not null default '{}'::jsonb,
  summary      jsonb not null default '{}'::jsonb,
  -- Storage key, paid tier only. Null means the photograph stayed on the phone.
  photo_path   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.rulesets (
  id         text primary key,
  owner_id   uuid not null references auth.users on delete cascade,
  config     jsonb not null,
  share_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists sessions_owner_updated on public.sessions (owner_id, updated_at desc);
create index if not exists hands_owner_updated on public.hands (owner_id, updated_at desc);
create index if not exists hands_session on public.hands (session_id);
create index if not exists rulesets_owner_updated on public.rulesets (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Social
-- ---------------------------------------------------------------------------

-- Two rows per pair, one in each direction, so "who are my friends" is an
-- index lookup rather than an OR across two columns.
create table if not exists public.friendships (
  user_id    uuid not null references auth.users on delete cascade,
  friend_id  uuid not null references auth.users on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint no_self_friendship check (user_id <> friend_id)
);

create index if not exists friendships_friend on public.friendships (friend_id, status);

-- Sharing is per session and opt-in. Nothing is visible to anyone until a row
-- exists here.
create table if not exists public.shares (
  session_id text primary key references public.sessions on delete cascade,
  shared_by  uuid not null references auth.users on delete cascade,
  visibility text not null default 'friends' check (visibility in ('friends', 'link')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Entitlements
--
-- Written only by the RevenueCat webhook through the service role. There are
-- deliberately no insert, update or delete policies below: a client that can
-- write this table is a client that can tell itself it has paid.
-- ---------------------------------------------------------------------------

create table if not exists public.entitlements (
  user_id    uuid primary key references auth.users on delete cascade,
  product    text not null,
  expires_at timestamptz,
  source     text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether the current user and `other` are friends, accepted in both
-- directions' sense. Security definer so it can see rows the caller's own
-- policies would hide, which is what stops the friendship check from needing a
-- readable friendships table.
create or replace function public.is_friend(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_id = auth.uid() and f.friend_id = other and f.status = 'accepted'
  );
$$;

-- Look up one profile by exact handle.
--
-- Adding friends needs a way to find a stranger by name, but a blanket select
-- policy on profiles would let anybody page through every user of the app. An
-- exact-match function answers the question without offering a directory.
create or replace function public.find_profile(lookup text)
returns table (id uuid, display_name text, handle text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.handle
  from public.profiles p
  where p.handle = lower(trim(lookup))
  limit 1;
$$;

-- A new sign-in, anonymous or not, gets a profile row immediately, so the
-- profile screen never has to cope with the row not being there yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.sessions     enable row level security;
alter table public.hands        enable row level security;
alter table public.rulesets     enable row level security;
alter table public.friendships  enable row level security;
alter table public.shares       enable row level security;
alter table public.entitlements enable row level security;

-- Profiles: your own, and anyone you have accepted as a friend.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_friend(id));

drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());

-- Sessions: yours, plus a friend's session they have chosen to share.
drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.shares s
      where s.session_id = sessions.id and public.is_friend(sessions.owner_id)
    )
  );

drop policy if exists sessions_write on public.sessions;
create policy sessions_write on public.sessions for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Hands follow their session.
drop policy if exists hands_read on public.hands;
create policy hands_read on public.hands for select
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.shares s
      join public.sessions se on se.id = s.session_id
      where s.session_id = hands.session_id and public.is_friend(se.owner_id)
    )
  );

drop policy if exists hands_write on public.hands;
create policy hands_write on public.hands for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Rulesets: yours, or anybody's if they published a share code.
drop policy if exists rulesets_read on public.rulesets;
create policy rulesets_read on public.rulesets for select
  using (owner_id = auth.uid() or share_code is not null);

drop policy if exists rulesets_write on public.rulesets;
create policy rulesets_write on public.rulesets for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Friendships: rows you are one half of.
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select
  using (user_id = auth.uid() or friend_id = auth.uid());

drop policy if exists friendships_write on public.friendships;
create policy friendships_write on public.friendships for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shares: readable by anyone who can already read the session, writable by the
-- session's owner.
drop policy if exists shares_read on public.shares;
create policy shares_read on public.shares for select
  using (
    shared_by = auth.uid()
    or public.is_friend(shared_by)
  );

drop policy if exists shares_write on public.shares;
create policy shares_write on public.shares for all
  using (shared_by = auth.uid()) with check (shared_by = auth.uid());

-- Entitlements: read your own, write nothing. The absence of the other
-- policies is the point.
drop policy if exists entitlements_read on public.entitlements;
create policy entitlements_read on public.entitlements for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Photo storage, paid tier
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('hand-photos', 'hand-photos', false)
on conflict (id) do nothing;

-- Objects live under `<user id>/<hand id>.jpg`, so the first path segment is
-- the owner and the policy is a string comparison rather than a join.
drop policy if exists hand_photos_read on storage.objects;
create policy hand_photos_read on storage.objects for select
  using (bucket_id = 'hand-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists hand_photos_write on storage.objects;
create policy hand_photos_write on storage.objects for insert
  with check (bucket_id = 'hand-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists hand_photos_delete on storage.objects;
create policy hand_photos_delete on storage.objects for delete
  using (bucket_id = 'hand-photos' and (storage.foldername(name))[1] = auth.uid()::text);
