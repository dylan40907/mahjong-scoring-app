/**
 * Reading back everything a query matches, however many rows that is.
 *
 * PostgREST cuts every response off at `max_rows` and says nothing when it
 * does: no error, no flag, just the first thousand rows looking exactly like
 * all of them. Sync reads the server's copy to compare it with ours, so a
 * short answer is not a smaller answer but a wrong one - a new phone gets
 * sessions without all their hands, and a seat past the cut can never be seen
 * to be removed.
 *
 * Pure apart from the page it is handed. The queries are in `engine.ts`.
 */

/**
 * Rows asked for per request.
 *
 * Must not be larger than the server's `max_rows`, which is 1000 both in
 * `supabase/config.toml` and by default on the hosted project. The last page
 * is recognised by coming back short, and a page the server cut at its cap is
 * short too, so a size above the cap reads one page and stops - the bug this
 * exists to fix, back again. Half the cap leaves room for it to be lowered.
 */
export const PAGE_SIZE = 500;

/** The part of a supabase-js response this needs. */
export interface Page<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Every row a query matches, a page at a time, or null if any page failed.
 *
 * `page` must order by a unique key, or Postgres is free to return the rows
 * in a different order on each request and the pages overlap and skip.
 *
 * All or nothing. Reconciling against part of the server's copy is the silent
 * failure paging is here to prevent: a session missing from it looks like one
 * to push, and a hand missing from it is a total that no longer adds up.
 *
 * Each row is kept once, by `key`, the latest copy winning. Offsets count
 * rows, so a row written mid-read that sorts ahead of the current page - a
 * second phone syncing at the same moment - pushes the others along, and the
 * last row of one page comes round again at the top of the next.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  key: (row: T) => string,
  size: number = PAGE_SIZE,
): Promise<T[] | null> {
  const rows = new Map<string, T>();
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return null;
    const got = data ?? [];
    for (const row of got) rows.set(key(row), row);
    if (got.length < size) return [...rows.values()];
  }
}
