/**
 * AsyncStorage, in memory.
 *
 * The store is worth testing - it decides when the deal passes, how long a
 * dealer's streak has run, and what a new session inherits from an old one -
 * but it reaches persistence on every write, and the real module needs a
 * native side that a plain ts-jest run does not have.
 *
 * A Map is enough. Nothing here asserts on what was written; the point is only
 * that writing does not throw, so the logic above it can be exercised.
 */
const store = new Map<string, string>();

export default {
  getItem: async (key: string): Promise<string | null> => store.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    store.delete(key);
  },
  multiRemove: async (keys: readonly string[]): Promise<void> => {
    for (const key of keys) store.delete(key);
  },
  clear: async (): Promise<void> => store.clear(),
};
