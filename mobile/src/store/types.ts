import type { TileCode, Wind } from '@/tiles/tileset';
import type { HandContext, Meld } from '@/scoring';
import type { Tombstone } from './sync/meta';
import type { QueuedIntent } from './sync/outbox';

/**
 * What the app persists.
 *
 * Everything here is plain JSON. Hands store the tiles and the context they
 * were scored with rather than only the resulting number, so that changing a
 * ruleset - or fixing a scoring bug - can re-score a session's history instead
 * of stranding it.
 */

export interface SessionPlayer {
  readonly id: string;
  readonly name: string;
  readonly seat: Wind;
  /**
   * The account sitting in this seat, when one of the players has the app.
   *
   * Optional, and almost always absent. Three of the four people at a table
   * will not have Tile Tally, and a seat is a name on a scoresheet first - the
   * account is an extra fact about one of them, never a requirement. What it
   * buys is the game appearing in that person's own history: their totals,
   * their best hand, their profile, without them typing any of it.
   */
  readonly accountId?: string;
}

/** The scoring inputs, in a form safe to serialise. */
export interface StoredHand {
  readonly concealed: TileCode[];
  /**
   * Tiles melded before the win, ungrouped.
   *
   * Optional because records written before the scorer started working out
   * the grouping for itself stored `melds` instead; `migrateHand` flattens
   * those on load so an old session still opens.
   */
  readonly exposed?: TileCode[];
  /** @deprecated Superseded by `exposed`. Read on load, never written. */
  readonly melds?: Meld[];
  readonly bonus: TileCode[];
  readonly winningTile: TileCode;
  readonly context: HandContext;
}

export interface HandRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly winnerId: string;
  /** Null on a self-drawn win. */
  readonly discarderId: string | null;
  readonly hand: StoredHand;
  /** Point change per player id, summing to zero. */
  readonly deltas: Readonly<Record<string, number>>;
  /** Cached for the history list so it renders without re-scoring. */
  readonly summary: {
    readonly total: number;
    readonly unit: string;
    readonly winnerReceives: number;
    readonly limitName?: string;
    readonly topPatterns: string[];
  };
  /** Local file URI of the photograph the hand was read from. */
  readonly photoUri?: string;
}

export interface Session {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ruleSetId: string;
  readonly players: SessionPlayer[];
  readonly roundWind: Wind;
  /** Player id currently dealing. */
  readonly dealerId: string;
  /**
   * Consecutive hands the current dealer has held the deal - 連莊.
   *
   * Zero on the first hand of a dealership, one after they win it once, and so
   * on. It is session state rather than something a hand carries, because it
   * is a fact about the table that outlives any single hand, and because it has
   * to survive an old hand being corrected without being counted twice.
   *
   * Optional: sessions written before this existed have no streak, and reading
   * them as zero is right.
   */
  readonly dealerStreak?: number;
  readonly hands: HandRecord[];
  readonly closed?: boolean;
  /**
   * The `updatedAt` the server has acknowledged. Absent until first pushed,
   * and differing from `updatedAt` exactly while there is something to push.
   * See `sync/meta.ts` for why dirtiness is derived rather than flagged.
   */
  readonly syncedAt?: string | null;
}

/**
 * The only preference worth storing.
 *
 * There were two more, and both were questions the app had already been
 * answered: whether to read tiles from photos duplicated the camera permission
 * the player granted the first time they scored a hand, and haptics is a
 * system-wide switch every phone already has. Settings that shadow a decision
 * made elsewhere go stale and then lie.
 */
export interface Settings {
  readonly defaultRuleSetId: string;
}

/**
 * A game somebody else scored, that we were seated in.
 *
 * Held apart from `sessions` rather than mixed in with a flag, because every
 * write path in the app - adding a hand, renaming a seat, deleting, pushing -
 * takes `sessions` and would have to learn to check that flag. One of them
 * forgetting would mean editing a record we do not own, which the server
 * would refuse and the app would never mention.
 *
 * It is a cache of the server's copy and nothing more: never edited, never
 * pushed, replaced wholesale on every pull, and dropped the moment it stops
 * coming back - which is how being unseated, or unfriended, takes the game
 * away again.
 */
export interface AwayGame {
  readonly session: Session;
  readonly ownerId: string;
  /** Which seat is ours, as an id into `session.players`. */
  readonly playerId: string;
  /** When this copy was pulled, so the screen can say how stale it is. */
  readonly fetchedAt: string;
}

export interface AppState {
  /**
   * Sessions deleted here, kept so the delete can travel.
   *
   * A delete that syncs as an absence is not a delete: to a device that had
   * not heard about it, the missing row is indistinguishable from a new
   * session arriving, and it comes back.
   */
  readonly deletedSessions: Tombstone[];
  readonly ready: boolean;
  readonly sessions: Session[];
  /** Games scored on somebody else's phone that we played in. Read-only. */
  readonly awayGames: AwayGame[];
  /**
   * Social actions taken while there was nothing to tell.
   *
   * Sessions sync by comparing two copies of a record. Friend requests and
   * seat changes are events, not records, so they queue instead. See
   * `sync/outbox.ts`.
   */
  readonly outbox: QueuedIntent[];
  readonly customRuleSets: import('@/scoring').CustomRuleSet[];
  readonly settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRuleSetId: 'taiwanese-common',
};
