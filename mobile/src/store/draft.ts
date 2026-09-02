import { useCallback, useSyncExternalStore } from 'react';
import type { TileCode } from '@/tiles/tileset';
import {
  applyDeclaredMelds,
  concealedIndices,
  declaredMelds,
  meldedIndices,
  moveTile,
  type DeclaredMeld,
} from './melds';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import type { HandContext, HandInput, Meld } from '@/scoring';
import type { Detection } from '@/vision/ordering';
import type { HandRecord } from './types';

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
  /** Indices into `groups` the user has marked as declared melds. */
  meldGroups: number[];
  /**
   * The subset of `meldGroups` declared *concealed* - in practice, concealed
   * kongs. Kept apart from `meldGroups` rather than folded into it because a
   * concealed declaration is still part of a concealed hand, and every ruleset
   * here pays it differently from an exposed one.
   */
  concealedMelds: number[];
  bonus: TileCode[];
  winningTile: TileCode | null;
  winnerId: string | null;
  discarderId: string | null;
  context: Partial<HandContext>;
  /** Raw detections, kept so the review screen can show confidence. */
  detections: Detection[];
  /**
   * Size of the decoded image the detection boxes refer to.
   *
   * Carried explicitly because it cannot be recovered from the boxes. Inferring
   * it from their extent - which the review overlay used to do - silently
   * assumes the tiles reach the edges of the photograph, and a hand sitting in
   * the middle of a tall frame then draws every box in the wrong place.
   */
  imageWidth: number;
  imageHeight: number;
  /**
   * The area of the photograph holding the hand, in decoded-image pixels.
   *
   * Starts as the whole photograph, because the photograph has already been
   * cropped to the frame the user pointed at the hand. Shrinking it is a
   * deliberate correction for something that strayed into shot, and re-reading
   * inside it also gives the detector several times more pixels per tile.
   */
  boundary: readonly [number, number, number, number] | null;
  /**
   * Set when an already-scored hand is open for correction.
   *
   * Its presence is the whole difference between saving and re-saving: with an
   * id the record replaces the one in the session, without one it joins as a
   * new hand and the deal passes.
   */
  handId: string | null;
  /** Kept so an edited hand stays where it was in the history. */
  createdAt: string | null;
}

const EMPTY: HandDraft = {
  sessionId: null,
  ruleSetId: 'taiwanese-common',
  photoUri: null,
  groups: [],
  meldGroups: [],
  concealedMelds: [],
  bonus: [],
  winningTile: null,
  winnerId: null,
  discarderId: null,
  context: {},
  detections: [],
  handId: null,
  createdAt: null,
  imageWidth: 0,
  imageHeight: 0,
  boundary: null,
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

/**
 * Open an already-scored hand for correction.
 *
 * The stored form is what the scorer needed - concealed tiles and melds kept
 * apart - and the review screen works in one row with the melded runs marked,
 * so this rebuilds that view: melds become groups in the order they were
 * played, everything concealed follows, and the meld indices come back with
 * them. Nothing is re-detected; the tiles are whatever they were corrected to.
 */
export function editHand(record: HandRecord, sessionId: string, ruleSetId: string): void {
  const groups: TileCode[][] = [];
  const meldGroups: number[] = [];
  const concealedMelds: number[] = [];

  for (const meld of record.hand.melds) {
    groups.push([...meld.tiles]);
    meldGroups.push(groups.length - 1);
    if (meld.concealed) concealedMelds.push(groups.length - 1);
  }
  if (record.hand.concealed.length > 0) groups.push([...record.hand.concealed]);
  if (groups.length === 0) groups.push([]);

  draft = {
    ...EMPTY,
    sessionId,
    ruleSetId,
    handId: record.id,
    createdAt: record.createdAt,
    photoUri: record.photoUri ?? null,
    groups,
    meldGroups,
    concealedMelds,
    bonus: [...record.hand.bonus],
    winningTile: record.hand.winningTile,
    winnerId: record.winnerId,
    discarderId: record.discarderId,
    context: record.hand.context,
  };
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

/*
 * The hand is edited in flat tile indices, because that is the only index the
 * review screen has: it shows one row, not the groups.
 *
 * These used to take a group index and an offset within it, and the review
 * screen passed the flat index for both - so correcting or deleting any tile
 * past the first group silently did nothing at all. Removing a tile you had
 * just added by hand was the visible half of that; the invisible half was
 * corrections quietly failing on any hand the detector split into two groups.
 */

export function setTileAt(index: number, code: TileCode): void {
  const tiles = handTiles();
  if (index < 0 || index >= tiles.length) return;
  const next = tiles.map((tile, i) => (i === index ? code : tile));
  updateDraft(applyDeclaredMelds(next, declaredMeldsOf()));
}

export function removeTileAt(index: number): void {
  const tiles = handTiles();
  if (index < 0 || index >= tiles.length) return;

  // Marks move with the tiles, not with the positions: deleting a tile out of
  // a declared meld shrinks that meld rather than swallowing its neighbour.
  const melds = declaredMeldsOf();
  const marked = meldedIndices(melds);
  const hidden = concealedIndices(melds);
  const kept = tiles
    .map((tile, i) => ({ tile, exposed: marked.has(i), concealed: hidden.has(i) }))
    .filter((_, i) => i !== index);

  updateDraft({
    ...applyDeclaredMelds(
      kept.map((entry) => entry.tile),
      runsFrom(kept),
    ),
    // The winning tile is a code, not a position, so it survives unless the
    // last copy of it just left the hand.
    winningTile: kept.some((entry) => entry.tile === draft.winningTile)
      ? draft.winningTile
      : null,
    // Detections are positional and line up with the tiles the detector found.
    // Dropping the matching one keeps "which box did this come from" honest for
    // every tile after it.
    detections: draft.detections.filter((_, i) => i !== index),
  });
}

/** Contiguous runs of marked tiles, back into declarations. */
function runsFrom(entries: readonly { exposed: boolean; concealed: boolean }[]): DeclaredMeld[] {
  const melds: DeclaredMeld[] = [];
  let start = -1;
  entries.forEach((entry, index) => {
    if (entry.exposed && start === -1) start = index;
    if (!entry.exposed && start !== -1) {
      melds.push({ start, end: index - 1, concealed: entries[start].concealed });
      start = -1;
    }
  });
  if (start !== -1) {
    melds.push({ start, end: entries.length - 1, concealed: entries[start].concealed });
  }
  return melds;
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
  /** Declared kongs, each of which raises `expected` by one. */
  readonly kongs: number;
}

export function validateDraft(draftState: HandDraft, handSize: number): DraftValidation {
  const problems: string[] = [];
  const total = draftState.groups.reduce((sum, group) => sum + group.length, 0);
  const expected = expectedTileCount(draftState, handSize);

  if (total < expected) {
    const short = expected - total;
    problems.push(`${short} more ${short === 1 ? 'tile' : 'tiles'} needed.`);
  } else if (total > expected) {
    problems.push(
      undeclaredFourOfAKind(draftState)
        ? 'Four of a kind only counts as a set once it is marked as a kong.'
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
  if (draftState.concealedMelds.some((index) => !isKong(draftState.groups[index]))) {
    // Only a kong is ever declared face down; a concealed run or triplet is
    // just still in the hand, and the decomposer finds it there.
    problems.push('Only a kong can be declared concealed.');
  }
  if (!draftState.winningTile) problems.push('Choose the tile that completed the hand.');

  return {
    ok: problems.length === 0,
    problems,
    tileCount: total,
    expected,
    kongs: countKongs(draftState),
  };
}

/**
 * The hand as one flat row, which is how it is shown and edited.
 *
 * Groups exist for the scorer's benefit - they carry which runs were exposed -
 * but a player editing their hand thinks in tiles, not groups.
 */
export function handTiles(draftState: HandDraft = draft): TileCode[] {
  return draftState.groups.flat();
}

/** Which runs the player has declared, in flat tile indices. */
export function declaredMeldsOf(draftState: HandDraft = draft): DeclaredMeld[] {
  return declaredMelds({
    groups: draftState.groups,
    meldGroups: draftState.meldGroups,
    concealedMelds: draftState.concealedMelds,
  });
}

/** Replace the declarations, keeping the tiles and their order. */
export function setDeclaredMelds(melds: readonly DeclaredMeld[]): void {
  updateDraft(applyDeclaredMelds(handTiles(), melds));
}

/**
 * Move a tile within the hand, carrying the meld marks with the tiles rather
 * than with the positions - moving a tile out of a meld should shrink it, not
 * silently swap which tile is melded.
 */
export function reorderTile(from: number, to: number): void {
  const tiles = handTiles();
  if (from < 0 || from >= tiles.length) return;

  const melds = declaredMeldsOf();
  const marked = meldedIndices(melds);
  const hidden = concealedIndices(melds);
  const entries = tiles.map((tile, index) => ({
    tile,
    exposed: marked.has(index),
    concealed: hidden.has(index),
  }));
  const moved = moveTile(entries, from, to);

  updateDraft(applyDeclaredMelds(moved.map((entry) => entry.tile), runsFrom(moved)));
}

/**
 * Tiles a complete hand holds, given what has been declared.
 *
 * A kong is four tiles standing in for a set of three, so every declared kong
 * puts the hand one tile over the nominal size - a Taiwanese hand with one
 * kong is eighteen tiles, not seventeen, and with two it is nineteen. This is
 * not an edge case; it is the ordinary consequence of a common declaration,
 * and treating the nominal size as a hard count meant a hand with a kong in it
 * could not be scored at all.
 */
export function expectedTileCount(draftState: HandDraft, handSize: number): number {
  return handSize + 1 + countKongs(draftState);
}

function isKong(tiles: readonly TileCode[] | undefined): boolean {
  return !!tiles && tiles.length === 4 && tiles.every((code) => code === tiles[0]);
}

function countKongs(draftState: HandDraft): number {
  return draftState.meldGroups.filter((index) => isKong(draftState.groups[index])).length;
}

/** Four identical tiles sitting in the hand without having been declared. */
function undeclaredFourOfAKind(draftState: HandDraft): boolean {
  const declared = new Set(draftState.meldGroups);
  const counts = new Map<TileCode, number>();
  draftState.groups.forEach((group, index) => {
    if (declared.has(index)) return;
    for (const code of group) counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  for (const n of counts.values()) if (n >= 4) return true;
  return false;
}

export function buildHandInput(
  draftState: HandDraft,
  context: HandContext,
): HandInput | null {
  if (!draftState.winningTile) return null;

  const melds: Meld[] = [];
  const concealed: TileCode[] = [];

  draftState.groups.forEach((group, index) => {
    if (draftState.meldGroups.includes(index)) {
      // Concealed is only ever honoured for a kong: it is the one meld a player
      // sets down without showing, and the one the rulesets pay differently.
      const concealedDeclaration =
        draftState.concealedMelds.includes(index) && isKong(group);
      const meld = classifyMeld(group, concealedDeclaration);
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
