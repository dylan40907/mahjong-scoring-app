import { supabase } from '@/lib/supabase';
import { getAccount } from '../account';
import { saveDeletedSessions, saveSessions } from '../persistence';
import { applySync, getState } from '../store';
import type { HandRecord, Session } from '../types';
import { markSynced, pruneTombstones, type Tombstone } from './meta';
import { reconcile } from './reconcile';

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
 */

export type SyncOutcome = 'synced' | 'offline' | 'busy';

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
    return 'synced';
  } catch {
    // No network, a dropped connection, a server that said something
    // unexpected. All of them mean the same thing here: try later.
    return 'offline';
  } finally {
    running = false;
  }
}
