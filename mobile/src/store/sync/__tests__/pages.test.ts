import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_SIZE, readAll, type Page } from '../pages';

/**
 * Reading back everything the server holds, a page at a time.
 *
 * PostgREST stops at `max_rows` without an error, so the only way to find the
 * rest is to ask again. Every way this goes wrong is quiet: a loop that stops
 * a page early, or hands back the pages it did get when a later one failed,
 * and sync reconciles against part of the server without anybody knowing.
 */

interface Row {
  id: string;
  /** Which read of the row this is, to tell two copies apart. */
  seen?: number;
}

const byId = (row: Row) => row.id;

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(3, '0')}` }));

/** Serves `all` the way PostgREST serves a range, and records what was asked. */
function server(all: Row[], options: { failOn?: number; cap?: number } = {}) {
  const asked: [number, number][] = [];
  const page = async (from: number, to: number): Promise<Page<Row>> => {
    asked.push([from, to]);
    if (asked.length === options.failOn) return { data: null, error: { code: '57014' } };
    const limit = Math.min(to - from + 1, options.cap ?? Infinity);
    return { data: all.slice(from, from + limit), error: null };
  };
  return { page, asked };
}

describe('reading every row', () => {
  it('reads across page boundaries and stops at the first short page', async () => {
    const { page, asked } = server(rows(7));
    const read = await readAll(page, byId, 3);
    expect(read).toEqual(rows(7));
    expect(asked).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it('asks once more when the rows end exactly on a boundary', async () => {
    // A full page cannot say whether it was the last, so an empty one has to.
    const { page, asked } = server(rows(6));
    expect(await readAll(page, byId, 3)).toEqual(rows(6));
    expect(asked).toHaveLength(3);
  });

  it('makes one request for an account with nothing on the server', async () => {
    const { page, asked } = server([]);
    expect(await readAll(page, byId, 3)).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('defaults to PAGE_SIZE rows a request', async () => {
    const { page, asked } = server(rows(PAGE_SIZE + 1));
    expect(await readAll(page, byId)).toHaveLength(PAGE_SIZE + 1);
    expect(asked).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);
  });
});

describe('a read that goes wrong', () => {
  it('fails whole when a later page fails, rather than returning the pages before it', async () => {
    const { page, asked } = server(rows(7), { failOn: 2 });
    expect(await readAll(page, byId, 3)).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('keeps a row once when a write mid-read pushes it onto the next page', async () => {
    // Offsets count rows. A row written between two requests that sorts ahead
    // of the one being read shifts the rest along by one, so the last row of
    // the first page is also the first row of the second.
    const all = rows(6);
    let requests = 0;
    const page = async (from: number, to: number): Promise<Page<Row>> => {
      requests += 1;
      if (requests === 2) all.splice(1, 0, { id: 'r000~k2x9' });
      return {
        data: all.slice(from, to + 1).map((row) => ({ ...row, seen: requests })),
        error: null,
      };
    };

    const read = (await readAll(page, byId, 3)) ?? [];
    const ids = read.map(byId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(rows(6).map(byId)));
    // Both copies were read; the later one is the one kept.
    expect(read.find((row) => row.id === 'r002')?.seen).toBe(2);
  });

  it('cannot tell a page the server cut short from the last one, so PAGE_SIZE must fit under the cap', async () => {
    const { page } = server(rows(7), { cap: 2 });
    expect(await readAll(page, byId, 3)).toHaveLength(2);

    const config = readFileSync(join(__dirname, '../../../../../supabase/config.toml'), 'utf8');
    const maxRows = Number(/^max_rows\s*=\s*(\d+)/m.exec(config)?.[1]);
    expect(maxRows).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeLessThanOrEqual(maxRows);
  });
});
