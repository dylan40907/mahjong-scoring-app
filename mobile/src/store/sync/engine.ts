import { supabase } from '@/lib/supabase';
import { getAccount } from '../account';
import { refreshFriends } from '../friends';
import { saveDeletedSessions, saveSessions } from '../persistence';
import { applyAwayGames, applyOutbox, applySync, getState } from '../store';
import type { AwayGame, HandRecord, Session } from '../types';
import { markSynced, pruneTombstones, type Tombstone } from './meta';
import { applyOutcomes, type Intent, type Outcome } from './outbox';
import { reconcile } from './reconcile';
import { planSeats, type SeatRow } from './seats';

/**
 * Moving records between the device and the server.
 *
 * All the judgement is in `reconcile`, which is pure and tested; this file is
 * the plumbing around it - fetch, map, write, mark clean. Keeping the two
 * apart is deliberate: the decisions are the part that fails silently, and
 * they should not need a network to exercise.
 *
 * Everything here is best-effort. The app never waits on it, nothing is
 * blocked by it, and a failed sync leaves the local records exactly as they
 * were, still dirty, to go again next time. Being offline is the ordinary
 * case, not the error case.
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

let running = false;

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
  if (!supabase) return;
  const { data, error } = await supabase
    .from('session_players')
    .select('session_id, user_id, player_id')
    .eq('added_by', userId);
  if (error) return;

  const remote: SeatRow[] = ((data ?? []) as SeatRowRaw[]).map((row) => ({
    sessionId: row.session_id,
    userId: row.user_id,
    playerId: row.player_id,
  }));

  const plan = planSeats(sessions, remote);

  if (plan.upsert.length > 0) {
    await supabase.from('session_players').upsert(
      plan.upsert.map((row) => ({
        session_id: row.sessionId,
        user_id: row.userId,
        player_id: row.playerId,
        added_by: userId,
      })),
    );
  }

  // One at a time, because the pair is a composite key and a single delete
  // cannot express "these two, but not those two".
  for (const row of plan.remove) {
    await supabase
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
async function pullAwayGames(userId: string): Promise<void> {
  if (!supabase) return;
  const seats = await supabase
    .from('session_players')
    .select('session_id, user_id, player_id')
    .eq('user_id', userId)
    // Our own sessions come down the ordinary path. This is everybody else's.
    .neq('added_by', userId);
  if (seats.error) return;

  const rows = (seats.data ?? []) as SeatRowRaw[];
  if (rows.length === 0) {
    applyAwayGames([]);
    return;
  }

  const ids = rows.map((row) => row.session_id);
  const [sessionsResult, handsResult] = await Promise.all([
    supabase.from('sessions').select('*').in('id', ids).is('deleted_at', null),
    supabase.from('hands').select('*').in('session_id', ids).is('deleted_at', null),
  ]);
  if (sessionsResult.error || handsResult.error) return;

  const handsBySession = new Map<string, HandRecord[]>();
  for (const row of (handsResult.data ?? []) as HandRow[]) {
    const list = handsBySession.get(row.session_id) ?? [];
    list.push(toHandRecord(row));
    handsBySession.set(row.session_id, list);
  }
  for (const list of handsBySession.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const seatOf = new Map(rows.map((row) => [row.session_id, row.player_id]));
  const fetchedAt = new Date().toISOString();
  const games: AwayGame[] = ((sessionsResult.data ?? []) as SessionRow[])
    .filter((row) => row.owner_id !== userId)
    .map((row) => ({
      session: toSession(row, handsBySession.get(row.id) ?? []),
      ownerId: row.owner_id,
      playerId: seatOf.get(row.id) ?? '',
      fetchedAt,
    }));

  applyAwayGames(games);
}

/**
 * One full exchange: pull, reconcile, push, write.
 *
 * Sessions are the unit. Hands travel with their session rather than being
 * tracked separately, because a session is edited by one device at a time and
 * the whole thing is a few tens of kilobytes - splitting the bookkeeping would
 * buy nothing and cost a second set of conflict rules.
 */
export async function syncNow(): Promise<SyncOutcome> {
  const account = getAccount();
  if (!supabase || !account.userId) return 'offline';
  if (running) return 'busy';
  running = true;

  try {
    // Before anything else, because a seat can only be handed to somebody who
    // is already a friend, and the acceptance may still be sitting in the
    // queue from a night with no signal.
    await drainOutbox();

    const [sessionsResult, handsResult] = await Promise.all([
      supabase.from('sessions').select('*').eq('owner_id', account.userId),
      supabase.from('hands').select('*').eq('owner_id', account.userId).is('deleted_at', null),
    ]);
    if (sessionsResult.error || handsResult.error) return 'offline';

    const rows = (sessionsResult.data ?? []) as SessionRow[];
    const handRows = (handsResult.data ?? []) as HandRow[];

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

    const live = rows.filter((row) => !row.deleted_at);
    const remote = {
      sessions: live.map((row) => toSession(row, bySession.get(row.id) ?? [])),
      tombstones: rows
        .filter((row) => row.deleted_at)
        .map((row): Tombstone => ({ id: row.id, deletedAt: row.deleted_at as string })),
    };

    const state = getState();
    const plan = reconcile(
      { sessions: state.sessions, tombstones: state.deletedSessions },
      remote,
    );

    // --- push ---------------------------------------------------------------
    let pushed = new Set<string>();
    if (plan.push.length > 0) {
      const sessionRows = plan.push.map((session) => toSessionRow(session, account.userId!));
      const handsToPush = plan.push.flatMap((session) => toHandRows(session, account.userId!));

      const written = await supabase.from('sessions').upsert(sessionRows);
      if (!written.error) {
        if (handsToPush.length > 0) await supabase.from('hands').upsert(handsToPush);
        pushed = new Set(plan.push.map((session) => session.id));
      }
    }

    const deletesSent = new Set<string>();
    for (const id of plan.pushDeletes) {
      const stone = state.deletedSessions.find((s) => s.id === id);
      const { error } = await supabase
        .from('sessions')
        .update({ deleted_at: stone?.deletedAt ?? new Date().toISOString() })
        .eq('id', id)
        .eq('owner_id', account.userId);
      if (!error) deletesSent.add(id);
    }

    // --- write back ---------------------------------------------------------
    // Only records the server actually acknowledged are marked clean. A push
    // that failed leaves the record dirty and it simply goes again.
    const sessions = plan.keep.map((session) =>
      pushed.has(session.id) ? markSynced(session) : session,
    );
    const tombstones = pruneTombstones([
      ...state.deletedSessions.map((stone) =>
        deletesSent.has(stone.id) ? { ...stone, syncedAt: stone.deletedAt } : stone,
      ),
      ...plan.learnedDeletes,
    ]);

    applySync(sessions, tombstones);
    void saveSessions(sessions);
    void saveDeletedSessions(tombstones);

    // --- the social half ----------------------------------------------------
    // After the sessions, because a seat row points at a session and the
    // server will refuse one that has not arrived yet. Each of these fails on
    // its own without taking the rest down: a night's scores reaching the
    // cloud matters more than a friend's copy of them being up to date.
    await syncSeats(account.userId, sessions);
    await pullAwayGames(account.userId);
    await refreshFriends();
    return 'synced';
  } catch {
    // No network, a dropped connection, a server that said something
    // unexpected. All of them mean the same thing here: try later.
    return 'offline';
  } finally {
    running = false;
  }
}
