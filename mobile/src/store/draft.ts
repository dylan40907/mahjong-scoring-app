import { useCallback, useSyncExternalStore } from 'react';
import type { TileCode } from '@/tiles/tileset';
import { TILE_BY_CODE, isBonus } from '@/tiles/tileset';
import type { HandContext, HandInput } from '@/scoring';
import {
  formsCompleteHand,
  kongsImpliedBy,
  meldedTilesFormSets,
  setsForHandSize,
} from '@/scoring';
import type { Detection } from '@/vision/ordering';
import { moveTile } from './tiles';
import type { HandRecord } from './types';

/**
 * The hand currently being entered.
 *
 * Kept in a module-level store rather than passed through route parameters.
 * The capture, review, context and result screens are four steps of one task,
 * and serialising a partly-entered hand into a URL on every keystroke would be
 * both lossy and slow. This also means backing out of the flow and returning
 * finds the work still there.
 *
 * The hand is one flat row of tiles plus a set of indices marked as melded. It
 * used to be a list of groups whose boundaries the player drew by hand, which
 * asked them to do the parser's job: which tiles form which set is a parsing
 * problem the scorer solves better, and kongs never had an honest answer,
 * since a concealed kong is set down without ever being shown.
 */

export interface HandDraft {
  sessionId: string | null;
  ruleSetId: string;
  photoUri: string | null;
  /** The hand as one row, in the order it was laid out. */
  tiles: TileCode[];
  /**
   * Indices into `tiles` melded before the win.
   *
   * The one thing about grouping that only the player knows, because it is a
   * fact about the game rather than about the tiles - and one that halves or
   * removes a great many patterns.
   */
  exposed: number[];
  bonus: TileCode[];
  winningTile: TileCode | null;
  winnerId: string | null;
  discarderId: string | null;
  context: Partial<HandContext>;
  /** Raw detections, kept so the tile picker can offer the runners-up. */
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
   * Why the photograph could not be read, when it could not be.
   *
   * It lives on the draft rather than in the capture screen's state because
   * the capture screen navigates away the instant it finishes - it set a
   * message and then replaced itself, so the one sentence explaining what had
   * gone wrong was drawn for no frames at all. What the player saw was a photo,
   * no tiles, and nothing to suggest anything had happened.
   *
   * That silence is expensive on a platform we cannot debug directly: an
   * unlinked native module, a model that would not load, and a hand the
   * detector genuinely could not see all look identical from the sofa.
   */
  readNote: string | null;
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
  tiles: [],
  exposed: [],
  bonus: [],
  winningTile: null,
  winnerId: null,
  discarderId: null,
  context: {},
  detections: [],
  handId: null,
  createdAt: null,
  readNote: null,
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
 * Melded tiles come back first, which is where they sat on the table, and the
 * concealed hand follows. Nothing is re-detected; the tiles are whatever they
 * were corrected to.
 */
export function editHand(record: HandRecord, sessionId: string, ruleSetId: string): void {
  const exposed = [...(record.hand.exposed ?? [])];
  draft = {
    ...EMPTY,
    sessionId,
    ruleSetId,
    handId: record.id,
    createdAt: record.createdAt,
    photoUri: record.photoUri ?? null,
    tiles: [...exposed, ...record.hand.concealed],
    exposed: exposed.map((_tile, index) => index),
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
 * Everything here works in flat tile indices, because that is the only index
 * the review screen has: it shows one row.
 *
 * Marks move with the tiles rather than with the positions. Deleting or
 * dragging a tile out of a melded run should shrink that run, not silently
 * hand the mark to whichever tile slid into the gap.
 */

function flags(state: HandDraft = draft): boolean[] {
  const marked = new Set(state.exposed);
  return state.tiles.map((_tile, index) => marked.has(index));
}

function marksFrom(list: readonly boolean[]): number[] {
  const out: number[] = [];
  list.forEach((flag, index) => {
    if (flag) out.push(index);
  });
  return out;
}

/** The hand as one row, which is how it is shown and edited. */
export function handTiles(state: HandDraft = draft): TileCode[] {
  return state.tiles;
}

/** Which tiles the player has marked as melded before the win. */
export function exposedSet(state: HandDraft = draft): Set<number> {
  return new Set(state.exposed);
}

export function setTileAt(index: number, code: TileCode): void {
  if (index < 0 || index >= draft.tiles.length) return;
  updateDraft({ tiles: draft.tiles.map((tile, i) => (i === index ? code : tile)) });
}

export function removeTileAt(index: number): void {
  if (index < 0 || index >= draft.tiles.length) return;

  const tiles = draft.tiles.filter((_tile, i) => i !== index);
  const marks = flags().filter((_flag, i) => i !== index);

  updateDraft({
    tiles,
    exposed: marksFrom(marks),
    // The winning tile is a code, not a position, so it survives unless the
    // last copy of it just left the hand.
    winningTile:
      draft.winningTile && tiles.includes(draft.winningTile) ? draft.winningTile : null,
    // Detections are positional and line up with the tiles the detector found.
    // Dropping the matching one keeps "which box did this come from" honest for
    // every tile after it.
    detections: draft.detections.filter((_detection, i) => i !== index),
  });
}

export function appendTile(code: TileCode): void {
  if (isBonus(TILE_BY_CODE[code])) {
    updateDraft({ bonus: [...draft.bonus, code] });
    return;
  }
  updateDraft({ tiles: [...draft.tiles, code] });
}

export function removeBonus(index: number): void {
  updateDraft({ bonus: draft.bonus.filter((_code, i) => i !== index) });
}

/** Replace which tiles are marked as melded. */
export function setExposed(indices: Iterable<number>): void {
  const limit = draft.tiles.length;
  const unique = [...new Set(indices)].filter((i) => i >= 0 && i < limit).sort((a, b) => a - b);
  updateDraft({ exposed: unique });
}

/** Move a tile within the hand, carrying its mark with it. */
export function reorderTile(from: number, to: number): void {
  if (from < 0 || from >= draft.tiles.length) return;
  updateDraft({
    tiles: moveTile(draft.tiles, from, to),
    exposed: marksFrom(moveTile(flags(), from, to)),
  });
}

// ---------------------------------------------------------------------------
// Building the scoring input
// ---------------------------------------------------------------------------

export interface DraftValidation {
  readonly ok: boolean;
  readonly problems: string[];
  readonly tileCount: number;
  /** What the count is measured against: a hand with no kongs in it. */
  readonly nominal: number;
  /** Kongs the surplus tiles imply, once the hand actually parses. */
  readonly kongs: number;
  /** The tiles form some complete hand, whoever won it and however. */
  readonly complete: boolean;
}

export interface ValidationOptions {
  readonly allowSevenPairs?: boolean;
  readonly allowThirteenOrphans?: boolean;
}

export function validateDraft(
  state: HandDraft,
  handSize: number,
  options: ValidationOptions = {},
): DraftValidation {
  const problems: string[] = [];
  const total = state.tiles.length;
  const nominal = handSize + 1;
  const marked = exposedSet(state);
  const concealed = state.tiles.filter((_tile, index) => !marked.has(index));
  const exposed = state.tiles.filter((_tile, index) => marked.has(index));

  /*
   * Kongs are counted, not declared.
   *
   * A kong is four tiles doing the work of three, and it is the only thing
   * that can put a hand over its nominal size - flowers were set aside long
   * before this. So the surplus *is* the kong count, and whether the hand is
   * legal is simply whether it parses with that many. Asking the player to
   * declare each one was asking them to do arithmetic the app can do, and it
   * had no honest answer for a concealed kong.
   */
  const surplus = kongsImpliedBy(total, handSize);
  const complete =
    surplus !== null &&
    formsCompleteHand(concealed, exposed, {
      handSize,
      allowSevenPairs: options.allowSevenPairs,
      allowThirteenOrphans: options.allowThirteenOrphans,
    });

  if (total < nominal) {
    const short = nominal - total;
    problems.push(`${short} more ${short === 1 ? 'tile' : 'tiles'} needed.`);
  } else if (surplus === null) {
    // Past the point any number of kongs could explain.
    const over = total - (nominal + setsForHandSize(handSize));
    problems.push(`${over} too many tiles, even counting every set as a kong.`);
  } else if (!complete) {
    /*
     * Say what is actually wrong, in the order it is worth checking.
     *
     * This used to blame the kong for every failure at a surplus count, which
     * was a guess dressed up as a diagnosis: a hand can hold a perfectly good
     * kong and still not parse because two tiles were swept into the revealed
     * row by mistake. Telling somebody their four nines are not a kong, while
     * the four nines sit there on screen, is worse than saying nothing.
     */
    if (!meldedTilesFormSets(exposed)) {
      problems.push('The revealed tiles do not make whole sets on their own.');
    } else if (surplus > 0 && !hasFourOfAKind(state.tiles)) {
      problems.push(
        `${total} tiles means ${surplus === 1 ? 'a kong' : `${surplus} kongs`}, and there is no four of a kind here.`,
      );
    } else {
      problems.push('These tiles do not form a complete hand.');
    }
  }

  if (!state.winningTile) problems.push('Choose the tile that completed the hand.');

  return {
    ok: problems.length === 0,
    problems,
    tileCount: total,
    nominal,
    kongs: complete ? (surplus ?? 0) : 0,
    complete,
  };
}

/** Whether any tile appears four times, wherever those four are sitting. */
function hasFourOfAKind(tiles: readonly TileCode[]): boolean {
  const counts = new Map<TileCode, number>();
  for (const code of tiles) counts.set(code, (counts.get(code) ?? 0) + 1);
  for (const n of counts.values()) if (n >= 4) return true;
  return false;
}

export function buildHandInput(state: HandDraft, context: HandContext): HandInput | null {
  if (!state.winningTile) return null;
  const marked = exposedSet(state);
  return {
    concealed: state.tiles.filter((_tile, index) => !marked.has(index)),
    exposed: state.tiles.filter((_tile, index) => marked.has(index)),
    bonus: state.bonus,
    winningTile: state.winningTile,
    context,
  };
}
