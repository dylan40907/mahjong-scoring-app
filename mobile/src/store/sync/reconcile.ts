import type { Session } from '../types';
import { isDirty, winner, type Tombstone } from './meta';

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
