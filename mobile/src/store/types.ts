import type { TileCode, Wind } from '@/tiles/tileset';
import type { HandContext, Meld } from '@/scoring';

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
}

/** The scoring inputs, in a form safe to serialise. */
export interface StoredHand {
  readonly concealed: TileCode[];
  readonly melds: Meld[];
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
  readonly hands: HandRecord[];
  readonly closed?: boolean;
}

export interface Settings {
  readonly defaultRuleSetId: string;
  /** Run the detector on capture; off falls back to manual entry. */
  readonly detectionEnabled: boolean;
  /** Below this the review screen flags a tile for checking. */
  readonly hapticsEnabled: boolean;
}

export interface AppState {
  readonly ready: boolean;
  readonly sessions: Session[];
  readonly customRuleSets: import('@/scoring').CustomRuleSet[];
  readonly settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRuleSetId: 'taiwanese-common',
  detectionEnabled: true,
  hapticsEnabled: true,
};
