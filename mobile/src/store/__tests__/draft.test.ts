import {
  appendTile,
  buildHandInput,
  declaredMeldsOf,
  getDraft,
  handTiles,
  removeTileAt,
  reorderTile,
  resetDraft,
  setDeclaredMelds,
  setTileAt,
  updateDraft,
  validateDraft,
} from '../draft';
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

beforeEach(() => resetDraft());

describe('editing by flat index', () => {
  it('removes the tile that was tapped', () => {
    // The bug this covers: a hand typed in by hand is one group, so removing
    // the sixth tile asked for group 6 - which does not exist - and nothing
    // happened at all.
    for (const code of ['man1', 'man2', 'man3', 'pin5'] as TileCode[]) appendTile(code);
    removeTileAt(1);
    expect(handTiles()).toEqual(['man1', 'man3', 'pin5']);
  });

  it('removes the right tile when the hand is split into groups', () => {
    updateDraft({ groups: [['man1', 'man2', 'man3'], ['pin5', 'pin6']] as TileCode[][] });
    removeTileAt(3);
    expect(handTiles()).toEqual(['man1', 'man2', 'man3', 'pin6']);
  });

  it('corrects a tile past the first group', () => {
    updateDraft({ groups: [['man1', 'man2', 'man3'], ['pin5', 'pin6']] as TileCode[][] });
    setTileAt(4, 'sou9');
    expect(handTiles()).toEqual(['man1', 'man2', 'man3', 'pin5', 'sou9']);
  });

  it('drops the winning tile only when its last copy leaves', () => {
    updateDraft({ groups: [['red', 'red', 'man1']] as TileCode[][], winningTile: 'red' });
    removeTileAt(0);
    expect(getDraft().winningTile).toBe('red');
    removeTileAt(0);
    expect(getDraft().winningTile).toBeNull();
  });

  it('shrinks a declared meld rather than swallowing its neighbour', () => {
    updateDraft({ groups: [KONG_HAND] });
    setDeclaredMelds([{ start: 0, end: 3, concealed: false }]);
    removeTileAt(0);
    expect(declaredMeldsOf()).toEqual([{ start: 0, end: 2, concealed: false }]);
  });
});

describe('reordering', () => {
  it('carries the concealed mark with the tiles it belongs to', () => {
    updateDraft({ groups: [KONG_HAND] });
    setDeclaredMelds([{ start: 0, end: 3, concealed: true }]);
    // Drag the whole kong to the end of the hand, one tile at a time.
    for (let i = 0; i < 4; i += 1) reorderTile(0, 17);
    const melds = declaredMeldsOf();
    expect(melds).toEqual([{ start: 14, end: 17, concealed: true }]);
  });
});

describe('validateDraft with kongs', () => {
  it('expects one extra tile for each declared kong', () => {
    updateDraft({ groups: [KONG_HAND], winningTile: 'red' });
    setDeclaredMelds([{ start: 0, end: 3, concealed: false }]);

    const validation = validateDraft(getDraft(), 16);
    expect(validation.expected).toBe(18);
    expect(validation.tileCount).toBe(18);
    expect(validation.kongs).toBe(1);
    expect(validation.ok).toBe(true);
  });

  it('says why an undeclared four of a kind is one tile over', () => {
    updateDraft({ groups: [KONG_HAND], winningTile: 'red' });
    const validation = validateDraft(getDraft(), 16);
    expect(validation.expected).toBe(17);
    expect(validation.ok).toBe(false);
    expect(validation.problems).toContain(
      'Four of a kind only counts as a set once it is marked as a kong.',
    );
  });

  it('refuses a concealed declaration that is not a kong', () => {
    updateDraft({ groups: [KONG_HAND], winningTile: 'red' });
    setDeclaredMelds([{ start: 4, end: 6, concealed: true }]);
    expect(validateDraft(getDraft(), 16).problems).toContain(
      'Only a kong can be declared concealed.',
    );
  });
});

describe('buildHandInput', () => {
  it('keeps a concealed kong concealed, and the hand with it', () => {
    updateDraft({ groups: [KONG_HAND], winningTile: 'red' });
    setDeclaredMelds([{ start: 0, end: 3, concealed: true }]);

    const input = buildHandInput(getDraft(), CONTEXT)!;
    expect(input.melds).toEqual([
      { kind: 'kong', tiles: ['east', 'east', 'east', 'east'], concealed: true },
    ]);
    expect(input.concealed).toHaveLength(14);
    expect(input.melds.every((meld) => meld.concealed)).toBe(true);
  });

  it('exposes a kong that was claimed', () => {
    updateDraft({ groups: [KONG_HAND], winningTile: 'red' });
    setDeclaredMelds([{ start: 0, end: 3, concealed: false }]);
    expect(buildHandInput(getDraft(), CONTEXT)!.melds[0].concealed).toBe(false);
  });

  it('never lets a triplet be declared concealed, even if asked', () => {
    // Concealed is only ever meaningful for a kong: a concealed triplet is
    // still in hand, and the decomposer finds it there.
    updateDraft({ groups: [KONG_HAND], winningTile: 'red' });
    setDeclaredMelds([{ start: 4, end: 6, concealed: true }]);
    expect(buildHandInput(getDraft(), CONTEXT)!.melds[0].concealed).toBe(false);
  });
});
