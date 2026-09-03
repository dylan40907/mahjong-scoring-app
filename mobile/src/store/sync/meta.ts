/**
 * The bookkeeping that makes a local record syncable.
 *
 * Three fields and one rule. `updatedAt` is when the record last changed on
 * *this* device and is what two copies are compared on. `syncedAt` is the
 * `updatedAt` the server last acknowledged, so "dirty" is simply the two
 * disagreeing - a definition that survives the app being killed mid-push,
 * needs no separate index, and cannot drift out of step with the record it
 * describes. `deletedAt` is a tombstone.
 *
 * Tombstones exist because a delete that syncs as an absence is not a delete.
 * If removing a session just took the row away, the next pull from a device
 * that had not heard about it would look exactly like a new session arriving,
 * and it would come back. Deleting something twice is a bad experience; being
 * unable to delete it at all is worse.
 *
 * None of this is exposed to the rest of the app. The screens go on reading
 * `sessions` and never see a deleted one.
 */

export interface SyncMeta {
  /** When this record last changed here. The conflict resolver. */
  readonly updatedAt: string;
  /**
   * The `updatedAt` the server has acknowledged, or absent if never pushed.
   * Equal to `updatedAt` exactly when the record is clean.
   */
  readonly syncedAt?: string | null;
}

/** A record the server has not seen in its current state. */
export function isDirty(record: SyncMeta): boolean {
  return record.syncedAt !== record.updatedAt;
}

/** Stamp a record as changed now, which also marks it dirty. */
export function touch<T extends object>(record: T, now = new Date().toISOString()): T & SyncMeta {
  return { ...record, updatedAt: now };
}

/** Mark a record as pushed, without changing what it says. */
export function markSynced<T extends SyncMeta>(record: T): T {
  return { ...record, syncedAt: record.updatedAt };
}

/**
 * Which of two copies of the same record wins.
 *
 * Last write wins, on `updatedAt`. That is usually a smell and is right here:
 * a session is edited by one person on one device at a time, because two
 * people do not score the same hand simultaneously. The case that justifies
 * anything cleverer does not arise.
 *
 * Ties go to the local copy, so a device that has already resolved a conflict
 * does not keep flip-flopping with the server on every pull.
 */
export function winner<T extends SyncMeta>(local: T, remote: T): T {
  return remote.updatedAt > local.updatedAt ? remote : local;
}

/** A record id that has been deleted, and when. */
export interface Tombstone {
  readonly id: string;
  readonly deletedAt: string;
  readonly syncedAt?: string | null;
}

/**
 * How long a tombstone is kept.
 *
 * Long enough that a phone left in a drawer for a season still learns the
 * session was deleted, rather than resurrecting it on its next sync. They cost
 * a few dozen bytes each, so the only reason to expire them at all is to stop
 * the list growing without bound over years.
 */
const TOMBSTONE_DAYS = 180;

export function pruneTombstones(
  tombstones: readonly Tombstone[],
  now = Date.now(),
): Tombstone[] {
  const cutoff = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  return tombstones.filter((stone) => {
    const at = Date.parse(stone.deletedAt);
    // An unparseable date is kept rather than dropped: forgetting a delete is
    // the failure that resurrects data.
    return Number.isNaN(at) || at >= cutoff;
  });
}
