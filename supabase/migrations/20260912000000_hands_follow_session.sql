-- A hand can only be written under a session its writer owns.
--
-- `hands_write` said `owner_id = auth.uid()` and nothing else. The foreign key
-- from a hand to its session is checked without row-level security, so any
-- signed-in account - an anonymous one included, and those are free to make -
-- could insert a hand stamped with its own id into somebody else's session,
-- given only that session's id. Every guest seated at the table knows it.
--
-- The owner would never have seen it. `pullOwn` asks for the owner's own
-- hands, and `pruneHands` only marks the owner's own rows, so the phone that
-- scored the night could neither see the hand nor take it out. Everybody else
-- seated there would: `hands_read` lets a participant read every hand under
-- the session, and `pullAwayGames` asks by `session_id` alone. The night's
-- totals would change on every guest's phone and on none of the owner's.
--
-- So a hand is writable when it is yours and the session it sits under is
-- yours too, on both sides of an update: the row as it was, and the row as it
-- will be, so a hand of your own cannot be moved into somebody else's game
-- either. A session's owner cannot change, so from here on every hand's owner
-- is its session's owner.
--
-- Nothing the app does is refused. Every push upserts a session before its
-- hands, so the session is already ours when they arrive, and adoption
-- (`sync/adopt.ts`) is no exception: a refused session gets a fresh id and is
-- pushed again from the session down, and a refused hand gets a fresh id under
-- a session that has already landed. A hand id another account holds is still
-- refused on the update half of the upsert, as 42501, which is what `pushOne`
-- reads as "this id is taken".
--
-- Ownership only, not liveness. A tombstoned session is still its owner's.
--
-- `(select auth.uid())` rather than the bare call, so it is evaluated once per
-- statement instead of once per row; this policy now runs a subquery per row.

-- A hand already written the old way would be stuck: no longer writable by the
-- account that wrote it, never writable by the session's owner, and still
-- readable by every guest. There were none when this was applied, and the
-- delete is here so that holds wherever else it runs.
delete from public.hands h
 using public.sessions s
 where s.id = h.session_id
   and s.owner_id <> h.owner_id;

drop policy if exists hands_write on public.hands;
create policy hands_write on public.hands for all
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = hands.session_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = hands.session_id and s.owner_id = (select auth.uid())
    )
  );
