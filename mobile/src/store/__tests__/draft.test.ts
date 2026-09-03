import {
  appendTile,
  buildHandInput,
  exposedSet,
  getDraft,
  handTiles,
  removeTileAt,
  reorderTile,
  resetDraft,
  setExposed,
  setTileAt,
  updateDraft,
  validateDraft,
} from '../draft';
import { moveTile } from '../tiles';
import type { HandContext } from '@/scoring';
import type { TileCode } from '@/tiles/tileset';

const CONTEXT: HandContext = {
  selfDrawn: true,
  seatWind: 'east',
  roundWind: 'east',
  isDealer: true,
};

/** A complete Taiwanese hand with a kong of east: five sets, a pair, 18 tiles. */
const KONG_HAND = [
  'east', 'east', 'east', 'east',
  'man1', 'man2', 'man3',
  'man4', 'man5', 'man6',
  'pin1', 'pin2', 'pin3',
  'sou1', 'sou2', 'sou3',
  'red', 'red',
] as TileCode[];

/** The same hand without the fourth east: five sets, a pair, 17 tiles. */
const PLAIN_HAND = KONG_HAND.filter((_tile, index) => index !== 3);

beforeEach(() => resetDraft());

describe('editing by flat index', () => {
  it('removes the tile that was tapped', () => {
    // The bug this covers: the hand used to be a list of groups, so removing
    // the sixth tile asked for group 6 - which did not exist - and nothing
    // happened at all.
    for (const code of ['man1', 'man2', 'man3', 'pin5'] as TileCode[]) appendTile(code);
    removeTileAt(1);
    expect(handTiles()).toEqual(['man1', 'man3', 'pin5']);
  });

  it('corrects the tile that was tapped', () => {
    updateDraft({ tiles: ['man1', 'man2', 'man3', 'pin5', 'pin6'] as TileCode[] });
    setTileAt(4, 'sou9');
    expect(handTiles()).toEqual(['man1', 'man2', 'man3', 'pin5', 'sou9']);
  });

  it('sends a flower to the bonus row rather than into the hand', () => {
    appendTile('flower_plum');
    expect(handTiles()).toEqual([]);
    expect(getDraft().bonus).toEqual(['flower_plum']);
  });

  it('drops the winning tile only when its last copy leaves', () => {
    updateDraft({ tiles: ['red', 'red', 'man1'] as TileCode[], winningTile: 'red' });
    removeTileAt(0);
    expect(getDraft().winningTile).toBe('red');
    removeTileAt(0);
    expect(getDraft().winningTile).toBeNull();
  });

  it('keeps the melded marks on their own tiles when one is deleted', () => {
    updateDraft({ tiles: KONG_HAND });
    setExposed([0, 1, 2, 3]);
    removeTileAt(0);
    expect([...exposedSet()]).toEqual([0, 1, 2]);
  });

  it('drops a mark that belonged to the deleted tile', () => {
    updateDraft({ tiles: ['man1', 'man2', 'man3'] as TileCode[] });
    setExposed([1]);
    removeTileAt(1);
    expect([...exposedSet()]).toEqual([]);
  });
});

describe('marking melded tiles', () => {
  it('ignores indices outside the hand and keeps the rest sorted', () => {
    updateDraft({ tiles: ['man1', 'man2', 'man3'] as TileCode[] });
    setExposed([2, 0, 99, -1, 2]);
    expect(getDraft().exposed).toEqual([0, 2]);
  });
});

describe('reordering', () => {
  it('carries a tile\'s mark with it', () => {
    updateDraft({ tiles: KONG_HAND });
    setExposed([0, 1, 2, 3]);
    // Drag the whole kong to the end of the hand, one tile at a time.
    for (let i = 0; i < 4; i += 1) reorderTile(0, 17);
    expect([...exposedSet()]).toEqual([14, 15, 16, 17]);
  });

  it('moves a tile later and earlier', () => {
    expect(moveTile(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTile(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is a no-op for a move onto itself or out of range', () => {
    expect(moveTile(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveTile(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('validateDraft', () => {
  it('accepts a hand at its nominal size', () => {
    updateDraft({ tiles: PLAIN_HAND, winningTile: 'red' });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.tileCount).toBe(17);
    expect(validation.kongs).toBe(0);
    expect(validation.complete).toBe(true);
    expect(validation.ok).toBe(true);
  });

  it('accepts eighteen tiles when they really do make a kong', () => {
    updateDraft({ tiles: KONG_HAND, winningTile: 'red' });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.kongs).toBe(1);
    expect(validation.complete).toBe(true);
    expect(validation.ok).toBe(true);
  });

  it('finds the kong whether it was melded or held', () => {
    updateDraft({ tiles: KONG_HAND, winningTile: 'red', exposed: [0, 1, 2, 3] });
    expect(validateDraft(getDraft(), 16).ok).toBe(true);
  });

  it('refuses eighteen tiles that do not make a kong', () => {
    const broken = [...PLAIN_HAND, 'sou9'] as TileCode[];
    updateDraft({ tiles: broken, winningTile: 'red' });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.complete).toBe(false);
    expect(validation.ok).toBe(false);
    expect(validation.problems[0]).toContain('a kong');
  });

  it('asks for the tiles it is short of', () => {
    updateDraft({ tiles: PLAIN_HAND.slice(0, 14), winningTile: 'red' });
    expect(validateDraft(getDraft(), 16).problems).toContain('3 more tiles needed.');
  });

  it('refuses a count past what every set being a kong could explain', () => {
    const far = [...KONG_HAND, ...KONG_HAND] as TileCode[];
    updateDraft({ tiles: far, winningTile: 'red' });
    expect(validateDraft(getDraft(), 16).problems[0]).toContain('too many tiles');
  });

  it('wants the winning tile before it will pass', () => {
    updateDraft({ tiles: PLAIN_HAND });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.complete).toBe(true);
    expect(validation.ok).toBe(false);
    expect(validation.problems).toContain('Choose the tile that completed the hand.');
  });

  it('rejects a complete-looking hand whose melded tiles cannot form sets', () => {
    // Two thirds of a run on the table and the last third still in hand: the
    // count is right and the hand is not.
    updateDraft({ tiles: PLAIN_HAND, winningTile: 'red', exposed: [4, 5] });
    expect(validateDraft(getDraft(), 16).complete).toBe(false);
  });
});

describe('buildHandInput', () => {
  it('splits the row into what was in hand and what was on the table', () => {
    updateDraft({ tiles: KONG_HAND, winningTile: 'red', exposed: [0, 1, 2, 3] });
    const input = buildHandInput(getDraft(), CONTEXT)!;
    expect(input.exposed).toEqual(['east', 'east', 'east', 'east']);
    expect(input.concealed).toHaveLength(14);
  });

  it('leaves an unmarked hand entirely concealed', () => {
    updateDraft({ tiles: KONG_HAND, winningTile: 'red' });
    const input = buildHandInput(getDraft(), CONTEXT)!;
    expect(input.exposed).toEqual([]);
    expect(input.concealed).toHaveLength(18);
  });

  it('returns nothing without a winning tile', () => {
    updateDraft({ tiles: KONG_HAND });
    expect(buildHandInput(getDraft(), CONTEXT)).toBeNull();
  });
});

describe('saying what is actually wrong', () => {
  /*
   * Reported from a real hand: four nines sitting plainly on screen, and the
   * app saying eighteen tiles means a kong and these tiles do not make one.
   * The kong was fine. Two extra tiles had been swept into the revealed row,
   * so the melded bag could not be cut into whole sets - and blaming the kong
   * for that sent somebody looking in the wrong place.
   */
  const REPORTED = [
    'man1', 'man2', 'man3', 'south', 'south', 'man4', 'man5', 'man8',
    'red', 'red', 'red', 'man9', 'man9', 'man9', 'man9',
    'pin4', 'pin4', 'pin4',
  ] as TileCode[];

  it('blames the revealed tiles, not the kong, when the melds do not divide', () => {
    updateDraft({ tiles: REPORTED, winningTile: 'south', exposed: [0, 1, 2, 5, 6, 7] });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.ok).toBe(false);
    expect(validation.problems[0]).toBe('The revealed tiles do not make whole sets on their own.');
  });

  it('says a kong is missing only when there is no four of a kind at all', () => {
    const noFour = REPORTED.map((tile, index) => (index === 14 ? ('sou2' as TileCode) : tile));
    updateDraft({ tiles: noFour, winningTile: 'south' });
    expect(validateDraft(getDraft(), 16).problems[0]).toContain('no four of a kind');
  });

  it('accepts the same hand once the melded run is a real run', () => {
    // man8 corrected to man6, so the revealed tiles are 1-2-3 and 4-5-6.
    const fixed = REPORTED.map((tile, index) => (index === 7 ? ('man6' as TileCode) : tile));
    updateDraft({ tiles: fixed, winningTile: 'south', exposed: [0, 1, 2, 5, 6, 7] });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.problems).toEqual([]);
    expect(validation.kongs).toBe(1);
    expect(validation.ok).toBe(true);
  });

  it('does not care where in the row the four tiles sit', () => {
    // The same tiles, shuffled: grouping is counted, never read off positions.
    const scattered = [...REPORTED].map((tile, index) => (index === 7 ? ('man6' as TileCode) : tile));
    const shuffled = [
      scattered[11], scattered[0], scattered[12], scattered[1], scattered[13],
      scattered[2], scattered[14], scattered[3], scattered[4], scattered[5],
      scattered[6], scattered[7], scattered[8], scattered[9], scattered[10],
      scattered[15], scattered[16], scattered[17],
    ];
    updateDraft({ tiles: shuffled, winningTile: 'south' });
    expect(validateDraft(getDraft(), 16).complete).toBe(true);
  });
});
