import { AppState } from 'react-native';
import { rootId } from '@/lib/ids';
import { supabase } from '@/lib/supabase';
import { getAccount } from '../account';
import { refreshFriends } from '../friends';
import { saveDeletedSessions, saveSessions } from '../persistence';
import {
  applyAwayGames,
  applyOutbox,
  applySync,
  getState,
  hydrate,
  rekeySession,
  onLocalEdit,
  parkSome,
  setSyncOwner,
} from '../store';
import type { AwayGame, HandRecord, Session } from '../types';
import { adopt, carryOver, collapseCopies, planAdoption, setAside } from './adopt';
import { pruneTombstones, type SyncOwner, type Tombstone } from './meta';
import { applyOutcomes, type Intent, type Outcome } from './outbox';
import { readAll } from './pages';
import { reconcile, settle, type RemoteState } from './reconcile';
import { planSeats, type SeatRow } from './seats';

/**
 * Moving records between the device and the server.
 *
 * All the judgement is in `reconcile` and `adopt`, which are pure and tested;
 * this file is the plumbing around them - fetch, map, write, mark clean.
 * Keeping the two apart is deliberate: the decisions are the part that fails
 * silently, and they should not need a network to exercise.
 *
 * Everything here is best-effort. The app never waits on it, nothing is
 * blocked by it, and nothing is marked clean that the server did not
 * acknowledge, so a failed sync leaves the records dirty to go again next
 * time. Being offline is the ordinary case, not the error case.
 *
 * Nor does it ever write over the device. Sessions are scored while a sync is
 * on the network, so the answer is folded into whatever the store holds by
 * then (`settle`) rather than replacing it, and the few changes sync makes
 * before it has finished - carrying sessions over from another account,
 * giving a refused one new ids - are made to the current copy, in place.
 *
 * One exchange covers four things, in an order that matters. Friendship
 * intents drain first, because a seat can only be handed to somebody who is
 * already a friend. Sessions and hands go next, because a seat row points at a
 * session and the server will refuse one that is not there yet. Seats follow.
 * Games other people scored come last, since they depend on seats the *other*
 * side wrote and are only ever read.
 */

export type SyncOutcome = 'synced' | 'offline' | 'busy';

/** A `session_players` row, as the table holds it. */
interface SeatRowRaw {
  session_id: string;
  user_id: string;
  player_id: string;
}

// What a paged read keeps each row once by: the table's primary key, which is
// also what it is ordered by, so the pages have one order to agree on.
const byId = (row: { id: string }) => row.id;
const bySeat = (row: SeatRowRaw) => `${row.session_id}|${row.user_id}`;

/** The exchange under way, if there is one. Only ever one at a time. */
let inflight: Promise<SyncOutcome> | null = null;
/** Something asked for an exchange while one was running. */
let again = false;
/** When the latest exchange started, so a change it already read is not sent twice. */
let lastStart = 0;

/** A session as the `sessions` table holds it, without its hands. */
interface SessionRow {
  id: string;
  owner_id: string;
  name: string;
  ruleset_id: string;
  players: Session['players'];
  round_wind: Session['roundWind'];
  dealer_id: string | null;
  dealer_streak: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface HandRow {
  id: string;
  session_id: string;
  owner_id: string;
  winner_id: string;
  discarder_id: string | null;
  payload: HandRecord['hand'];
  deltas: HandRecord['deltas'];
  summary: HandRecord['summary'];
  photo_path: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function toSession(row: SessionRow, hands: HandRecord[]): Session {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Arriving from the server means the server has it, by definition.
    syncedAt: row.updated_at,
    ruleSetId: row.ruleset_id,
    players: row.players ?? [],
    roundWind: row.round_wind,
    dealerId: row.dealer_id ?? '',
    dealerStreak: row.dealer_streak ?? 0,
    hands,
  };
}

function toSessionRow(session: Session, ownerId: string): SessionRow {
  return {
    id: session.id,
    owner_id: ownerId,
    name: session.name,
    ruleset_id: session.ruleSetId,
    players: session.players,
    round_wind: session.roundWind,
    dealer_id: session.dealerId || null,
    dealer_streak: session.dealerStreak ?? 0,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    deleted_at: null,
  };
}

function toHandRows(session: Session, ownerId: string): HandRow[] {
  return session.hands.map((record) => ({
    id: record.id,
    session_id: session.id,
    owner_id: ownerId,
    winner_id: record.winnerId,
    discarder_id: record.discarderId,
    payload: record.hand,
    deltas: record.deltas,
    summary: record.summary,
    // Photographs are a paid feature and are uploaded separately. The local
    // file path deliberately does not travel: it means nothing on any other
    // device.
    photo_path: null,
    created_at: record.createdAt,
    updated_at: session.updatedAt,
    // Live, because the copy being pushed has it. A copy that won by being
    // edited after a delete it never heard about brings the hand back, the
    // same way it overwrites everything else about the session.
    deleted_at: null,
  }));
}

function toHandRecord(row: HandRow): HandRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    winnerId: row.winner_id,
    discarderId: row.discarder_id,
    hand: row.payload,
    deltas: row.deltas ?? {},
    summary: row.summary ?? { total: 0, unit: 'tai', winnerReceives: 0, topPatterns: [] },
  };
}

// ---------------------------------------------------------------------------
// Friendship
// ---------------------------------------------------------------------------

/**
 * Tell the server about the friend requests, acceptances and removals that
 * were tapped since it was last reachable.
 *
 * Each is one function call. They are deliberately serial: two of them can
 * concern the same person - accept, then think better of it - and the order
 * they were tapped in is the whole meaning.
 */
async function drainOutbox(): Promise<void> {
  const queue = getState().outbox;
  if (queue.length === 0) return;

  const outcomes = new Map<string, Outcome>();
  for (const queued of queue) {
    outcomes.set(queued.id, await send(queued.intent));
  }
  applyOutbox(applyOutcomes(queue, outcomes));
}

async function send(intent: Intent): Promise<Outcome> {
  if (!supabase) return 'unreachable';
  switch (intent.kind) {
    case 'friend:request': {
      const { data, error } = intent.userId
        ? await supabase.rpc('request_friend_by_id', { target: intent.userId })
        : await supabase.rpc('request_friend', { lookup: intent.handle });
      if (error) return classify(error);
      // 'sent', 'accepted' and 'friends' have all arrived somewhere useful.
      // 'unknown' and 'self' never will, however many times we try.
      return data === 'unknown' || data === 'self' || data === 'blocked' ? 'refused' : 'done';
    }
    case 'friend:accept': {
      const { data, error } = await supabase.rpc('accept_friend', { other: intent.userId });
      if (error) return classify(error);
      // False means there was no request to accept - withdrawn, or already
      // answered on another device. Nothing to retry.
      return data === false ? 'refused' : 'done';
    }
    case 'friend:remove': {
      const { error } = await supabase.rpc('remove_friend', { other: intent.userId });
      return error ? classify(error) : 'done';
    }
    case 'friend:block': {
      const { error } = await supabase.rpc('block_user', { other: intent.userId });
      return error ? classify(error) : 'done';
    }
    case 'friend:unblock': {
      // False means there was no block to lift, which is where we wanted to be.
      const { error } = await supabase.rpc('unblock_user', { other: intent.userId });
      return error ? classify(error) : 'done';
    }
  }
}

/**
 * Whether the server refused or was never reached.
 *
 * The difference decides whether an intent uses up one of its few attempts, so
 * getting it backwards means either abandoning a request because somebody was
 * on a train, or retrying an impossible one forever. PostgREST puts a `code`
 * on anything the database answered; a connection that never arrived has no
 * code to report.
 *
 * `PGRST202` and `PGRST205` are the exception, and they are the reason this is
 * not a one-liner: they mean the function or table is not there, which is what
 * a build says when it has shipped ahead of its migrations. That is temporary
 * and fixes itself the moment the schema catches up, so it must not spend an
 * attempt - otherwise every friend request made in the gap is quietly thrown
 * away, and quietly is the whole problem.
 */
function classify(error: { code?: string | null }): Outcome {
  if (!error.code) return 'unreachable';
  return error.code === 'PGRST202' || error.code === 'PGRST205' ? 'unreachable' : 'refused';
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/**
 * Make the server's idea of who sat where match ours.
 *
 * Only rows we handed out ourselves are compared. Seats we hold in other
 * people's games are theirs to maintain, and treating their absence from our
 * own sessions as something to delete would have us revoking our own access to
 * every game we are a guest in.
 */
async function syncSeats(userId: string, sessions: readonly Session[]): Promise<void> {
  const db = supabase;
  if (!db) return;
  // Every seat, not the first thousand: one past the cut is one this can never
  // see to remove, and removing is the half of this that matters most.
  const data = await readAll<SeatRowRaw>(
    (from, to) =>
      db
        .from('session_players')
        .select('session_id, user_id, player_id')
        .eq('added_by', userId)
        .order('session_id')
        .order('user_id')
        .range(from, to),
    bySeat,
  );
  if (!data) return;

  const remote: SeatRow[] = data.map((row) => ({
    sessionId: row.session_id,
    userId: row.user_id,
    playerId: row.player_id,
  }));

  const plan = planSeats(sessions, remote);

  if (plan.upsert.length > 0) {
    const rows = plan.upsert.map((row) => ({
      session_id: row.sessionId,
      user_id: row.userId,
      player_id: row.playerId,
      added_by: userId,
    }));
    const written = await db.from('session_players').upsert(rows);
    // One refused seat - somebody no longer a friend, a session whose push
    // failed this time - fails the whole statement and every other seat with
    // it. Once the database has answered, the rest go one by one, so that seat
    // is the only one still owed next time.
    if (written.error?.code) {
      for (const row of rows) await db.from('session_players').upsert(row);
    }
  }

  // One at a time, because the pair is a composite key and a single delete
  // cannot express "these two, but not those two".
  for (const row of plan.remove) {
    await db
      .from('session_players')
      .delete()
      .eq('session_id', row.sessionId)
      .eq('user_id', row.userId);
  }
}

// ---------------------------------------------------------------------------
// Games somebody else scored
// ---------------------------------------------------------------------------

/**
 * Pull the games we were seated in but did not score.
 *
 * Read-only, and replaced wholesale: this is a cache of what the server says
 * we can see, so a game that stops coming back - deleted, unseated,
 * unfriended - is simply not in the next list, and that is the entire delete
 * story. Nothing here is ever pushed, and none of it is mixed in with the
 * sessions this device owns, so no write path can reach it by accident.
 */
async function pullAwayGames(userId: string, own: readonly Session[]): Promise<void> {
  const db = supabase;
  if (!db) return;
  const rows = await readAll<SeatRowRaw>(
    (from, to) =>
      db
        .from('session_players')
        .select('session_id, user_id, player_id')
        .eq('user_id', userId)
        // Our own sessions come down the ordinary path. This is everybody else's.
        .neq('added_by', userId)
        .order('session_id')
        .order('user_id')
        .range(from, to),
    bySeat,
  );
  // Replaced wholesale, so a partial read would be a partial list, and the
  // games past the cut would vanish from it. Keep the last whole one instead.
  if (!rows) return;
  if (rows.length === 0) {
    applyAwayGames([]);
    return;
  }

  const ids = rows.map((row) => row.session_id);
  const [sessionRows, handRows] = await Promise.all([
    readAll<SessionRow>(
      (from, to) =>
        db
          .from('sessions')
          .select('*')
          .in('id', ids)
          .is('deleted_at', null)
          .order('id')
          .range(from, to),
      byId,
    ),
    readAll<HandRow>(
      (from, to) =>
        db
          .from('hands')
          .select('*')
          .in('session_id', ids)
          .is('deleted_at', null)
          .order('id')
          .range(from, to),
      byId,
    ),
  ]);
  if (!sessionRows || !handRows) return;

  const handsBySession = new Map<string, HandRecord[]>();
  for (const row of handRows) {
    const list = handsBySession.get(row.session_id) ?? [];
    list.push(toHandRecord(row));
    handsBySession.set(row.session_id, list);
  }
  for (const list of handsBySession.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const seatOf = new Map(rows.map((row) => [row.session_id, row.player_id]));
  // A night this device holds its own copy of is shown once, as ours. The two
  // meet when the account signed in here was seated in the previous account's
  // game and then adopted this phone's copy of it (`adopt.ts`).
  const ours = new Set(own.map((session) => rootId(session.id)));
  const fetchedAt = new Date().toISOString();
  const games: AwayGame[] = sessionRows
    .filter((row) => row.owner_id !== userId && !ours.has(rootId(row.id)))
    .map((row) => ({
      session: toSession(row, handsBySession.get(row.id) ?? []),
      ownerId: row.owner_id,
      playerId: seatOf.get(row.id) ?? '',
      fetchedAt,
    }));

  applyAwayGames(games);
}

// ---------------------------------------------------------------------------
// Our own sessions
// ---------------------------------------------------------------------------

/**
 * Everything this account owns on the server, tombstones included.
 *
 * Paged, and null unless every page arrived. Everything downstream takes an
 * absence from this at its word - `carryOver` pushes a session it cannot find
 * here, and a new phone builds each session from exactly the hands that came
 * back - so part of the server's copy is worse than none of it.
 */
async function pullOwn(userId: string): Promise<RemoteState | null> {
  const db = supabase;
  if (!db) return null;
  const [rows, handRows] = await Promise.all([
    readAll<SessionRow>(
      (from, to) =>
        db.from('sessions').select('*').eq('owner_id', userId).order('id').range(from, to),
      byId,
    ),
    readAll<HandRow>(
      (from, to) =>
        db
          .from('hands')
          .select('*')
          .eq('owner_id', userId)
          .is('deleted_at', null)
          .order('id')
          .range(from, to),
      byId,
    ),
  ]);
  if (!rows || !handRows) return null;

  const bySession = new Map<string, HandRecord[]>();
  for (const row of handRows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(toHandRecord(row));
    bySession.set(row.session_id, list);
  }
  for (const list of bySession.values()) {
    // Newest first, which is the order the session screen shows them in.
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return {
    sessions: rows
      .filter((row) => !row.deleted_at)
      .map((row) => toSession(row, bySession.get(row.id) ?? [])),
    tombstones: rows
      .filter((row) => row.deleted_at)
      .map((row): Tombstone => ({ id: row.id, deletedAt: row.deleted_at as string })),
  };
}

/**
 * Bring the device up to date with who it is signed in as, before reconciling.
 *
 * Copies of a game that has come back to an account that already holds it
 * collapse into that account's copy, and sessions another account synced are
 * carried over to be pushed to this one. Both are written straight away rather
 * than at the end, because the rest of the sync is spent on the network: a
 * screen showing a collapsed copy should follow it to the real one now, not
 * after every push has finished.
 *
 * The owner is recorded last, once the sessions it describes are on disk.
 */
async function arrive(remote: RemoteState, me: SyncOwner): Promise<Session[] | null> {
  // Somebody signed out while the pull was on the network. What it read
  // belongs to an account that is no longer here.
  if (getAccount().userId !== me.userId) return null;

  const state = getState();
  const collapsed = collapseCopies(state.sessions, remote);
  // A different real account's games go aside for it, never carried over.
  const { keep, aside } = setAside(collapsed.sessions, remote, state.syncOwner, me);
  const sessions = carryOver(keep, remote, state.syncOwner, me);

  // Both in this tick, so no render shows the set-aside games in the list.
  const parking =
    aside.length > 0 && state.syncOwner ? parkSome(state.syncOwner.userId, aside) : null;
  if (sessions !== state.sessions) {
    applySync(sessions, state.deletedSessions, collapsed.renames);
    await saveSessions(sessions);
  }
  await parking;

  // Checked again after the writes: a sign-out in between clears the owner,
  // and recording this one over it would make the next account set its own
  // unsynced games aside as ours.
  if (getAccount().userId !== me.userId) return null;
  if (state.syncOwner?.userId !== me.userId || state.syncOwner.anonymous !== me.anonymous) {
    await setSyncOwner(me);
  }
  return sessions;
}

type Pushed = 'landed' | 'session-taken' | 'hands-taken' | 'failed';

/**
 * Whether a refusal means somebody else owns the id.
 *
 * Row-level security reports as 42501. Every row this pushes is stamped with
 * our own id as owner, so the insert half of the upsert always passes; what
 * fails is the update half, against a row that already exists and is not
 * ours - which is exactly "this id is taken".
 */
const taken = (error: { code?: string | null }) => error.code === '42501';

/** Push every session in one statement, the way it goes when nothing is wrong. */
async function pushBatch(
  userId: string,
  sessions: readonly Session[],
): Promise<'landed' | 'refused' | 'unreachable'> {
  if (!supabase) return 'unreachable';
  // A code means the database answered; no code means nothing arrived, and
  // trying again one at a time would only fail the same way more slowly.
  const written = await supabase
    .from('sessions')
    .upsert(sessions.map((session) => toSessionRow(session, userId)));
  if (written.error) return written.error.code ? 'refused' : 'unreachable';

  const handRows = sessions.flatMap((session) => toHandRows(session, userId));
  if (handRows.length === 0) return 'landed';
  const hands = await supabase.from('hands').upsert(handRows);
  if (hands.error) return hands.error.code ? 'refused' : 'unreachable';
  return 'landed';
}

/** One session and its hands, reporting which of the two was refused. */
async function pushOne(userId: string, session: Session): Promise<Pushed> {
  if (!supabase) return 'failed';
  const row = await supabase.from('sessions').upsert(toSessionRow(session, userId));
  if (row.error) return taken(row.error) ? 'session-taken' : 'failed';

  const hands = toHandRows(session, userId);
  if (hands.length > 0) {
    const written = await supabase.from('hands').upsert(hands);
    if (written.error) return taken(written.error) ? 'hands-taken' : 'failed';
  }
  return (await pruneHands(userId, session)) ? 'landed' : 'failed';
}

/**
 * Mark deleted the hands the server holds under a session that the copy just
 * pushed does not have.
 *
 * Deleting a hand takes it out of `session.hands` and nothing more, and an
 * upsert only writes the hands a session still has, so the row used to stay
 * live. The phone that deleted it never noticed, because its own copy wins
 * every reconcile; a second phone or a fresh install pulled the hand straight
 * back, and the night's totals with it.
 *
 * By state rather than as a queued delete, the way seats are: the copy that
 * landed is the whole truth about its hands, so anything else under the
 * session is gone, however it got there. That makes it safe on every push - a
 * second run finds nothing to mark, and a hand already marked keeps the time
 * it went. It runs only once the session and its hands have landed, and a
 * session is not acknowledged until it has, so one that fails here stays dirty
 * and goes again whole.
 */
async function pruneHands(userId: string, session: Session): Promise<boolean> {
  if (!supabase) return false;
  let stale = supabase
    .from('hands')
    .update({ deleted_at: session.updatedAt })
    .eq('session_id', session.id)
    .eq('owner_id', userId)
    .is('deleted_at', null);
  // With no hands left there is nothing to spare: every live row goes.
  if (session.hands.length > 0) {
    // `.notIn` quotes only ids holding a comma or a bracket. The `~` in a
    // copy's id needs none, which verify-sync proves against the database.
    stale = stale.notIn('id', session.hands.map((hand) => hand.id));
  }
  const { error } = await stale;
  return !error;
}

/**
 * Give a refused session new ids here, then return the version to push.
 *
 * Not if the account changed while this sync was running: a row stamped with
 * the old id would be refused under the new one for a reason that has nothing
 * to do with who owns it, and the next sync starts from the right account.
 */
async function rekey(
  userId: string,
  session: Session,
  scope: 'session' | 'hands',
): Promise<Session | undefined> {
  if (getAccount().userId !== userId) return undefined;
  const adoption = planAdoption(session, scope);
  return rekeySession(session.id, (current) => adopt(current, adoption, userId), adoption.renames);
}

/**
 * Push one session on its own, adopting it if another account holds its id.
 *
 * Returns what landed - under its new id, if it moved - or nothing.
 */
async function pushAlone(userId: string, session: Session): Promise<Session | undefined> {
  let current: Session | undefined = session;
  let outcome = await pushOne(userId, current);

  if (outcome === 'session-taken') {
    current = await rekey(userId, current, 'session');
    if (!current) return undefined;
    outcome = await pushOne(userId, current);
  }
  if (outcome === 'hands-taken') {
    current = await rekey(userId, current, 'hands');
    if (!current) return undefined;
    outcome = await pushOne(userId, current);
  }
  return outcome === 'landed' ? current : undefined;
}

/**
 * Push what reconcile decided to push, and say what the server acknowledged.
 *
 * One statement first, which is the whole of it on an ordinary day. But one
 * refused row fails an upsert outright, and every other row in it with it -
 * a session somebody else owns used to keep the night's brand-new sessions off
 * the server on every sync, indefinitely, without a word. So once the
 * database has refused the batch, each session goes on its own and only the
 * refused one is left owing.
 *
 * The result maps each id to the `updatedAt` that landed, which is what lets
 * the write-back tell a pushed copy from one edited after it was sent.
 */
async function pushSessions(
  userId: string,
  sessions: readonly Session[],
): Promise<Map<string, string>> {
  const landed = new Map<string, string>();
  if (sessions.length === 0) return landed;

  const batch = await pushBatch(userId, sessions);
  if (batch === 'landed') {
    // Only now, with every session and hand in the batch on the server. One
    // whose prune fails is left out, so it stays dirty and its deleted hands
    // are still owed.
    for (const session of sessions) {
      if (await pruneHands(userId, session)) landed.set(session.id, session.updatedAt);
    }
    return landed;
  }
  if (batch === 'unreachable') return landed;

  for (const session of sessions) {
    const pushed = await pushAlone(userId, session);
    if (pushed) landed.set(pushed.id, pushed.updatedAt);
  }
  return landed;
}

async function pushDeletes(userId: string, ids: readonly string[]): Promise<Set<string>> {
  const sent = new Set<string>();
  if (!supabase) return sent;
  for (const id of ids) {
    const stone = getState().deletedSessions.find((s) => s.id === id);
    const { error } = await supabase
      .from('sessions')
      .update({ deleted_at: stone?.deletedAt ?? new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', userId);
    if (!error) sent.add(id);
  }
  return sent;
}

/**
 * One full exchange: pull, reconcile, push, write.
 *
 * Sessions are the unit. Hands travel with their session rather than being
 * tracked separately, because a session is edited by one device at a time and
 * the whole thing is a few tens of kilobytes - splitting the bookkeeping would
 * buy nothing and cost a second set of conflict rules.
 */
async function exchange(): Promise<SyncOutcome> {
  const account = getAccount();
  if (!supabase || !account.userId) return 'offline';
  const userId = account.userId;

  try {
    // Launch starts this alongside loading storage. Reconciling against a
    // store that has not loaded yet decides everything against an empty list,
    // and would record this account as the owner of sessions it never saw.
    await hydrate();

    // Before anything else, because a seat can only be handed to somebody who
    // is already a friend, and the acceptance may still be sitting in the
    // queue from a night with no signal.
    await drainOutbox();

    const remote = await pullOwn(userId);
    if (!remote) return 'offline';

    const started = await arrive(remote, {
      userId,
      anonymous: account.status === 'anonymous',
    });
    if (!started) return 'offline';
    const plan = reconcile({ sessions: started, tombstones: getState().deletedSessions }, remote);

    const landed = await pushSessions(userId, plan.push);
    const deletesSent = await pushDeletes(userId, plan.pushDeletes);

    // --- write back ---------------------------------------------------------
    // Not if the account changed while the pushes were out. `settle` adds the
    // sessions this account's server had and the device did not, and after a
    // sign-out that is another account's games arriving in the list.
    if (getAccount().userId !== userId) return 'offline';

    // Read now, not before the pushes: anything scored or deleted while they
    // were in flight is in here, and `settle` keeps it. Nothing below awaits
    // until the store has been written, so nothing can slip in between.
    const now = getState();
    const sessions = settle({ started, current: now.sessions, plan, landed });
    const known = new Set(now.deletedSessions.map((stone) => stone.id));
    const tombstones = pruneTombstones([
      ...now.deletedSessions.map((stone) =>
        deletesSent.has(stone.id) ? { ...stone, syncedAt: stone.deletedAt } : stone,
      ),
      ...plan.learnedDeletes.filter((stone) => !known.has(stone.id)),
    ]);

    applySync(sessions, tombstones);
    void saveSessions(sessions);
    void saveDeletedSessions(tombstones);

    // --- the social half ----------------------------------------------------
    // After the sessions, because a seat row points at a session and the
    // server will refuse one that has not arrived yet - and after any
    // adoption, because seats are keyed by session id and a moved session's
    // seats belong under its new one. Each of these fails on its own without
    // taking the rest down: a night's scores reaching the cloud matters more
    // than a friend's copy of them being up to date.
    await syncSeats(userId, sessions);
    if (getAccount().userId !== userId) return 'offline';
    await pullAwayGames(userId, sessions);
    if (getAccount().userId !== userId) return 'offline';
    await refreshFriends();
    return 'synced';
  } catch {
    // No network, a dropped connection, a server that said something
    // unexpected. All of them mean the same thing here: try later.
    return 'offline';
  } finally {
    // A sync the account changed under gave up, and the new account's own
    // sync was turned away as busy while it ran. Ask for that one now.
    const signedIn = getAccount().userId;
    if (signedIn && signedIn !== userId) again = true;
  }
}

/**
 * Exchange with the server now, or join the exchange already under way.
 *
 * One at a time: two running at once would reconcile against each other's
 * half-written results. A request that arrives while one runs is not simply
 * turned away, though. The running exchange may have read the store before a
 * hand was scored or a game deleted - `settle` keeps that change dirty, but
 * nothing would send it until the next trigger - so exactly one more runs
 * when it finishes, and that one picks up everything still waiting.
 */
export function syncNow(): Promise<SyncOutcome> {
  if (inflight) {
    again = true;
    return Promise.resolve('busy');
  }
  lastStart = Date.now();
  inflight = exchange().finally(() => {
    inflight = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return inflight;
}

/**
 * Send everything waiting, before the account it belongs to leaves the phone.
 *
 * Signing out sets the account's games aside, and anything unsent goes aside
 * with them - a game deleted a moment before signing out stayed on a friend's
 * phone until the deleter signed back in. So this waits out any exchange
 * already running, then runs one more for whatever it missed.
 *
 * Bounded, because a sign-out must not hang on a basement connection. What is
 * still unsent when time runs out goes aside with the account and is sent the
 * next time it signs in here.
 */
export async function flushSync(timeoutMs = 8000): Promise<void> {
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  const attempt = (async () => {
    while (inflight) await inflight;
    await syncNow();
    // A follow-up the last one asked for.
    while (inflight) await inflight;
  })();
  await Promise.race([attempt, deadline]);
}

/** Long enough that scoring a hand is one exchange, not one per tap. */
const AFTER_EDIT_MS = 1500;
/**
 * The safety net, not the main path. Every exchange reads the account's whole
 * history - a heavy one is a megabyte or two - so a short interval would cost
 * real data on a phone plan while nothing changed. Edits, opening the sessions
 * list or a friend's game, and returning to the app carry the freshness.
 */
const WHILE_OPEN_MS = 5 * 60 * 1000;

/**
 * Sync whenever there is a connection and a reason.
 *
 * It used to run at launch, on return to the app, and after a friend request -
 * and never after scoring, correcting or deleting. A game deleted on one phone
 * sat there unsent while it stayed open, and the friend it was shared with
 * kept seeing it. Now every change goes shortly after it is made, and the app
 * checks in every few minutes while it is on screen. Offline, each attempt is
 * one failed request and nothing else.
 *
 * Returns a function that stops it all.
 */
export function startAutoSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopEdits = onLocalEdit(() => {
    const editedAt = Date.now();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // A screen that syncs straight after its own change - a friend
      // request, a seat - has already sent it: an exchange that started
      // after the change read the store with it in.
      if (lastStart >= editedAt) return;
      void syncNow();
    }, AFTER_EDIT_MS);
  });
  const tick = setInterval(() => {
    if (AppState.currentState === 'active') void syncNow();
  }, WHILE_OPEN_MS);
  return () => {
    stopEdits();
    clearInterval(tick);
    if (timer) clearTimeout(timer);
  };
}
