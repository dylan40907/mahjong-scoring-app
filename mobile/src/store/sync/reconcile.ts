import type { Session } from '../types';
import { isDirty, markSynced, winner, type Tombstone } from './meta';

/**
 * Deciding what to send and what to keep, with no network in sight.
 *
 * The whole of sync's judgement lives here as one pure function, because every
 * mistake it can make is invisible: a record that never looks dirty simply
 * never reaches the server, and a losing copy that wins quietly overwrites the
 * newer one. Neither raises anything. Separating this from the transport is
 * what makes it possible to test the cases that matter - a delete racing an
 * edit, a device that has been offline for a week - without a device or a
 * connection.
 */

export interface Reconciliation {
  /** Sessions to write to local storage, replacing what is there. */
  readonly keep: Session[];
  /** Sessions to push, because this device holds the newer copy. */
  readonly push: Session[];
  /** Ids to delete on the server. */
  readonly pushDeletes: string[];
  /** Ids to delete locally, because another device deleted them. */
  readonly dropLocal: string[];
  /** Tombstones learned from the server that this device did not have. */
  readonly learnedDeletes: Tombstone[];
}

export interface RemoteState {
  readonly sessions: readonly Session[];
  /** Ids the server reports as deleted, with when. */
  readonly tombstones: readonly Tombstone[];
}

export interface LocalState {
  readonly sessions: readonly Session[];
  readonly tombstones: readonly Tombstone[];
}

/**
 * Work out the whole exchange in one pass.
 *
 * Two rules do the deciding, and the order between them is the important part.
 *
 * A tombstone beats an edit, always, whichever side it came from and whatever
 * the timestamps say. Deleting a session and watching it return because
 * another device had it open is a worse outcome than losing a late edit to
 * something you had already thrown away - and the alternative, comparing a
 * delete's time against an edit's, means a device with a slow clock can
 * resurrect data.
 *
 * Otherwise the later `updatedAt` wins. That is last-write-wins, which is
 * usually a smell and is right here: one person edits a session on one device
 * at a time, because two people do not score the same hand simultaneously.
 */
export function reconcile(local: LocalState, remote: RemoteState): Reconciliation {
  const localById = new Map(local.sessions.map((session) => [session.id, session]));
  const remoteById = new Map(remote.sessions.map((session) => [session.id, session]));

  const localDeleted = new Map(local.tombstones.map((stone) => [stone.id, stone]));
  const remoteDeleted = new Map(remote.tombstones.map((stone) => [stone.id, stone]));

  const keep: Session[] = [];
  const push: Session[] = [];
  const pushDeletes: string[] = [];
  const dropLocal: string[] = [];
  const learnedDeletes: Tombstone[] = [];

  // Deletes this device knows about and the server may not.
  for (const stone of local.tombstones) {
    if (!remoteDeleted.has(stone.id)) pushDeletes.push(stone.id);
  }

  // Deletes the server knows about and this device may not.
  for (const stone of remote.tombstones) {
    if (!localDeleted.has(stone.id)) learnedDeletes.push(stone);
    if (localById.has(stone.id)) dropLocal.push(stone.id);
  }

  for (const session of local.sessions) {
    // Deleted anywhere means gone everywhere, regardless of what was edited
    // when.
    if (remoteDeleted.has(session.id)) continue;

    const theirs = remoteById.get(session.id);
    if (!theirs) {
      // Only here. Either it is new, or the server has never seen it.
      keep.push(session);
      if (isDirty(session)) push.push(session);
      continue;
    }

    const better = winner(session, theirs);
    keep.push(better);
    // Push only when this device is the one holding the newer copy; a record
    // that just arrived from the server is by definition already there.
    if (better === session && isDirty(session)) push.push(session);
  }

  // Sessions that exist only on the server: another device made them.
  for (const session of remote.sessions) {
    if (localById.has(session.id)) continue;
    if (localDeleted.has(session.id)) continue;
    keep.push(session);
  }

  return { keep, push, pushDeletes, dropLocal, learnedDeletes };
}

/**
 * Fold what a sync decided into what the device holds now.
 *
 * A sync reads the sessions, spends a while on the network, then writes its
 * answer back - and the table does not stop scoring in between. Writing the
 * answer over the top, which is what this replaced, lost any hand added while
 * the push was in flight. That window used to be one request; falling back to
 * one session at a time, and adopting sessions another account holds, can
 * make it many.
 *
 * So the device's current copy is the starting point, and the sync's decisions
 * apply only to sessions nobody touched while it ran:
 *
 * - Unchanged since `started`: take the decision - the server's copy if it
 *   won, the local one otherwise, marked synced if it landed.
 * - Edited meanwhile: last write wins against the decision, which is almost
 *   always the edit. It stays dirty and goes next time.
 * - Deleted on another device: gone, edited or not. A tombstone beats an edit.
 * - New, or re-keyed by adoption, while it ran: kept as it is now.
 * - Deleted or re-keyed here while it ran: not brought back from `started`.
 *
 * `landed` is the `updatedAt` the server acknowledged for each id, so a
 * session edited after its push is not marked clean on the strength of an
 * older copy.
 */
export function settle(input: {
  readonly started: readonly Session[];
  readonly current: readonly Session[];
  readonly plan: Reconciliation;
  readonly landed: ReadonlyMap<string, string>;
}): Session[] {
  const { started, current, plan, landed } = input;
  const startedById = new Map(started.map((session) => [session.id, session]));
  const decided = new Map(plan.keep.map((session) => [session.id, session]));
  const dropped = new Set(plan.dropLocal);
  const here = new Set(current.map((session) => session.id));

  const out: Session[] = [];
  for (const now of current) {
    const before = startedById.get(now.id);
    let next = now;
    if (before) {
      if (dropped.has(now.id)) continue;
      const answer = decided.get(now.id) ?? now;
      next = now.updatedAt === before.updatedAt ? answer : winner(now, answer);
    }
    out.push(landed.get(next.id) === next.updatedAt ? acknowledged(next) : next);
  }

  // Sessions another device made, which were never here to be touched.
  for (const session of plan.keep) {
    if (!startedById.has(session.id) && !here.has(session.id)) out.push(session);
  }
  return out;
}

/** Marked clean, and following its account again if it had been left behind. */
function acknowledged(session: Session): Session {
  const synced = markSynced(session);
  return session.leftBehind ? { ...synced, leftBehind: undefined } : synced;
}
