import type { Session } from '../types';

/**
 * Working out which friends the server should think are sitting where.
 *
 * Who sits in which chair is a property of a session, and a session belongs to
 * exactly one account, so this is a record rather than an event: the device
 * that owns the game holds the truth, and sync's whole job is to make the
 * server's copy match it.
 *
 * That choice is the reason seats are not in the outbox with friend requests.
 * A queued intent is abandoned after enough refusals, and the intent most
 * worth never abandoning is the one that takes a game *away* from somebody.
 * Comparing the two copies instead means every sync repairs whatever the last
 * one failed to do, however it failed - a refused write, a phone killed
 * mid-push, a row somebody deleted from the dashboard. There is no drift to
 * accumulate, because there is nothing to remember.
 *
 * Pure. The transport is in `engine.ts`.
 */

export interface SeatRow {
  readonly sessionId: string;
  /** The friend's account. */
  readonly userId: string;
  /** Their seat, as an id into the session's `players`. */
  readonly playerId: string;
}

/** Enough of a row to delete it: the composite key, and nothing else. */
export interface SeatKey {
  readonly sessionId: string;
  readonly userId: string;
}

export interface SeatPlan {
  /** Rows to write. Upserted, so a friend moving chairs is one operation. */
  readonly upsert: SeatRow[];
  /** Rows to delete, by the pair that identifies them. */
  readonly remove: SeatKey[];
}

const key = (row: { sessionId: string; userId: string }) => `${row.sessionId}|${row.userId}`;

/**
 * Every seat in our own games that names an account.
 *
 * Includes our own seat. A game we scored ourselves is one we played in, and
 * the row that says so is what makes the totals on this profile the same
 * totals a second device would compute after a fresh install.
 */
export function seatsOf(sessions: readonly Session[]): SeatRow[] {
  const rows: SeatRow[] = [];
  for (const session of sessions) {
    for (const player of session.players) {
      if (player.accountId) {
        rows.push({ sessionId: session.id, userId: player.accountId, playerId: player.id });
      }
    }
  }
  return rows;
}

/**
 * The difference between what we mean and what the server has.
 *
 * `remote` is only ever the rows we handed out ourselves - seats we hold in
 * other people's games are theirs to maintain, and treating their absence
 * from our sessions as something to delete would have us revoking our own
 * access to every game we are a guest in.
 */
export function planSeats(
  sessions: readonly Session[],
  remote: readonly SeatRow[],
): SeatPlan {
  const wanted = seatsOf(sessions);
  const wantedBy = new Map(wanted.map((row) => [key(row), row]));
  const remoteBy = new Map(remote.map((row) => [key(row), row]));

  const upsert = wanted.filter((row) => {
    const there = remoteBy.get(key(row));
    // A friend moved to a different chair is a changed row, not a new one.
    return !there || there.playerId !== row.playerId;
  });

  const remove = remote
    .filter((row) => !wantedBy.has(key(row)))
    .map((row) => ({ sessionId: row.sessionId, userId: row.userId }));

  return { upsert, remove };
}
