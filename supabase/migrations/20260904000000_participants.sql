-- Seating a friend in a game, so it reaches their history too.
--
-- Until now a session belonged to exactly one account and was visible to
-- exactly one person. That is wrong for the thing the app is actually for:
-- four people sat round a table, and any number of them might have the app.
-- The person holding the phone scores the night, but all four played it, and
-- it should show up in all four histories.
--
-- The seat is the unit, not the session. A row here says "this account is the
-- person sitting in seat `player_id` of this session", which is what lets a
-- friend's own totals, their best hand and their profile count a game somebody
-- else typed in. The names in `sessions.players` stay exactly as they were -
-- three of the four people at a table will not have the app, and the schema
-- must not start caring which ones do.

create table if not exists public.session_players (
  session_id text not null references public.sessions on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  -- The seat, matching an `id` inside `sessions.players`. Text, and not a
  -- foreign key, because the seats live in a jsonb column that the server
  -- deliberately does not destructure.
  player_id  text not null,
  -- Always the session's owner. Kept as a column so the delete policy can be
  -- answered without reaching into `sessions`.
  added_by   uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  -- One person, one seat. Somebody cannot be two players in the same game, and
  -- making that a key rather than a check means a double tap is idempotent
  -- rather than a duplicate.
  primary key (session_id, user_id)
);

create index if not exists session_players_user on public.session_players (user_id);

alter table public.session_players enable row level security;

-- Whether the current user is seated in a session.
--
-- Security definer, so the sessions policy can ask it without needing a select
-- policy on this table that would in turn have to ask about sessions. Two
-- policies that each depend on the other is how a schema deadlocks itself.
create or replace function public.is_participant(session text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_players sp
    where sp.session_id = session and sp.user_id = auth.uid()
  );
$$;

-- You can see the seats you hold and the seats you handed out. Deliberately
-- not "everyone in a session you are in": that would turn one shared game into
-- a way to enumerate the accounts of people you have never met.
drop policy if exists session_players_read on public.session_players;
create policy session_players_read on public.session_players for select
  using (user_id = auth.uid() or added_by = auth.uid());

-- Only the owner of a session may seat somebody in it, and only a friend.
-- Both halves matter: the first stops a stranger writing themselves into your
-- game, the second stops your game reaching somebody you have not agreed to
-- share anything with.
drop policy if exists session_players_insert on public.session_players;
create policy session_players_insert on public.session_players for insert
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.owner_id = auth.uid()
    )
    and (user_id = auth.uid() or public.is_friend(user_id))
  );

-- Either side can end it: the owner unseats them, or they leave. A guest who
-- cannot walk out of somebody else's game is a guest who has to ask.
drop policy if exists session_players_delete on public.session_players;
create policy session_players_delete on public.session_players for delete
  using (added_by = auth.uid() or user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Sessions and hands become readable by the people seated in them
-- ---------------------------------------------------------------------------

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select
  using (
    owner_id = auth.uid()
    or public.is_participant(id)
    or exists (
      select 1 from public.shares s
      where s.session_id = sessions.id and public.is_friend(sessions.owner_id)
    )
  );

drop policy if exists hands_read on public.hands;
create policy hands_read on public.hands for select
  using (
    owner_id = auth.uid()
    or public.is_participant(session_id)
    or exists (
      select 1 from public.shares s
      join public.sessions se on se.id = s.session_id
      where s.session_id = hands.session_id and public.is_friend(se.owner_id)
    )
  );

-- Reading is all a guest gets. `sessions_write` and `hands_write` still say
-- `owner_id = auth.uid()`, so the phone that scored the night is the only one
-- that can change it - which is also what lets the client treat a session it
-- does not own as a cache of the server's copy rather than a record it has to
-- reconcile.
