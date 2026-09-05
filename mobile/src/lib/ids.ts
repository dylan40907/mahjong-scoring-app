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
