/**
 * Ids only have to be unique within one device's storage, so a timestamp with
 * a random suffix is sufficient and avoids a uuid dependency and its crypto
 * polyfill on React Native.
 *
 * Lives here rather than in the store because the sync layer needs it too, and
 * the store already sits above sync - having the bottom of the stack reach
 * back up for a string helper is how an import cycle starts.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A new id for a copy of a record, keeping the original's root.
 *
 * Sync needs one when a session has to be pushed again under a different
 * account and the old account still owns its id. Keeping the root is the
 * whole point: two ids with the same root are the same game, which is how a
 * game that moves from one account to another and back again is recognised
 * as coming home rather than arriving twice. See `sync/adopt.ts`.
 */
export function copyId(id: string): string {
  return `${rootId(id)}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The id a record was first created with, before any copy was taken of it. */
export function rootId(id: string): string {
  const cut = id.indexOf('~');
  return cut < 0 ? id : id.slice(0, cut);
}
