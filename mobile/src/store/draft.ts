import { useCallback, useSyncExternalStore } from 'react';
import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import type { HandContext, HandInput, Meld } from '@/scoring';
import type { Detection } from '@/vision/ordering';

/**
 * The hand currently being entered.
 *
 * Kept in a module-level store rather than passed through route parameters.
 * The capture, review, context and result screens are four steps of one task,
 * and serialising a partly-entered hand into a URL on every keystroke would be
 * both lossy and slow. This also means backing out of the flow and returning
 * finds the work still there.
 */

export interface HandDraft {
  sessionId: string | null;
  ruleSetId: string;
  photoUri: string | null;
  /** Tile groups in reading order, as the ordering step recovered them. */
  groups: TileCode[][];
  /** Indices into `groups` the user has marked as exposed melds. */
  meldGroups: number[];
  bonus: TileCode[];
  winningTile: TileCode | null;
  winnerId: string | null;
  discarderId: string | null;
  context: Partial<HandContext>;
  /** Raw detections, kept so the review screen can show confidence. */
  detections: Detection[];
  /** Positions the model was unsure about: "group:index". */
  flagged: string[];
}

const EMPTY: HandDraft = {
  sessionId: null,
  ruleSetId: 'taiwanese-common',
  photoUri: null,
  groups: [],
  meldGroups: [],
  bonus: [],
  winningTile: null,
  winnerId: null,
  discarderId: null,
  context: {},
  detections: [],
  flagged: [],
};

let draft: HandDraft = { ...EMPTY };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function updateDraft(partial: Partial<HandDraft>): void {
  draft = { ...draft, ...partial };
  emit();
}

export function resetDraft(seed: Partial<HandDraft> = {}): void {
  draft = { ...EMPTY, ...seed };
  emit();
}

export function getDraft(): HandDraft {
  return draft;
}

export function useDraft<T>(selector: (draft: HandDraft) => T): T {
  const read = useCallback(() => selector(draft), [selector]);
  return useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    read,
    read,
  );
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export function setTile(groupIndex: number, tileIndex: number, code: TileCode): void {
  const groups = draft.groups.map((group, g) =>
    g === groupIndex ? group.map((tile, t) => (t === tileIndex ? code : tile)) : group,
  );
  updateDraft({ groups, flagged: draft.flagged.filter((key) => key !== `${groupIndex}:${tileIndex}`) });
}

export function removeTile(groupIndex: number, tileIndex: number): void {
  const groups = draft.groups
    .map((group, g) => (g === groupIndex ? group.filter((_, t) => t !== tileIndex) : group))
    .filter((group) => group.length > 0);
  updateDraft({ groups, winningTile: draft.winningTile });
}

export function appendTile(code: TileCode): void {
  if (isBonus(TILE_BY_CODE[code])) {
    updateDraft({ bonus: [...draft.bonus, code] });
    return;
  }
  const groups = draft.groups.length > 0 ? [...draft.groups] : [[]];
  groups[groups.length - 1] = [...groups[groups.length - 1], code];
  updateDraft({ groups });
}

export function removeBonus(index: number): void {
  updateDraft({ bonus: draft.bonus.filter((_, i) => i !== index) });
}

export function toggleMeldGroup(groupIndex: number): void {
  const meldGroups = draft.meldGroups.includes(groupIndex)
    ? draft.meldGroups.filter((index) => index !== groupIndex)
    : [...draft.meldGroups, groupIndex];
  updateDraft({ meldGroups });
}

// ---------------------------------------------------------------------------
// Building the scoring input
// ---------------------------------------------------------------------------

/**
 * Work out what kind of meld a run of tiles is.
 *
 * The user marks *that* a group is exposed; its kind follows from the tiles
 * themselves, so there is nothing extra to ask them.
 */
export function classifyMeld(tiles: readonly TileCode[], concealed: boolean): Meld | null {
  if (tiles.length === 4 && tiles.every((code) => code === tiles[0])) {
    return { kind: 'kong', tiles: [...tiles], concealed };
  }
  if (tiles.length === 3 && tiles.every((code) => code === tiles[0])) {
    return { kind: 'pung', tiles: [...tiles], concealed };
  }
  if (tiles.length === 3) {
    const sorted = [...tiles].sort(
      (a, b) => TILE_BY_CODE[a].index - TILE_BY_CODE[b].index,
    );
    const [a, b, c] = sorted.map((code) => TILE_BY_CODE[code]);
    const sameSuit = a.suit === b.suit && b.suit === c.suit;
    const consecutive = b.rank === a.rank + 1 && c.rank === b.rank + 1;
    if (sameSuit && consecutive) {
      return { kind: 'chow', tiles: sorted, concealed };
    }
  }
  return null;
}

export interface DraftValidation {
  readonly ok: boolean;
  readonly problems: string[];
  readonly tileCount: number;
  readonly expected: number;
}

export function validateDraft(draftState: HandDraft, handSize: number): DraftValidation {
  const problems: string[] = [];
  const total = draftState.groups.reduce((sum, group) => sum + group.length, 0);
  const expected = handSize + 1;

  if (total !== expected) {
    problems.push(
      total < expected
        ? `${expected - total} more ${expected - total === 1 ? 'tile' : 'tiles'} needed.`
        : `${total - expected} too many tiles.`,
    );
  }
  for (const index of draftState.meldGroups) {
    const group = draftState.groups[index];
    if (group && !classifyMeld(group, false)) {
      problems.push('A group marked as a meld is not a run, triplet or kong.');
      break;
    }
  }
  if (!draftState.winningTile) problems.push('Choose the tile that completed the hand.');

  return { ok: problems.length === 0, problems, tileCount: total, expected };
}

export function buildHandInput(
  draftState: HandDraft,
  context: HandContext,
): HandInput | null {
  if (!draftState.winningTile) return null;

  const melds: Meld[] = [];
  const concealed: TileCode[] = [];

  draftState.groups.forEach((group, index) => {
    const exposed = draftState.meldGroups.includes(index);
    if (exposed) {
      const meld = classifyMeld(group, false);
      if (meld) {
        melds.push(meld);
        return;
      }
    }
    concealed.push(...group);
  });

  return {
    concealed,
    melds,
    bonus: draftState.bonus,
    winningTile: draftState.winningTile,
    context,
  };
}
