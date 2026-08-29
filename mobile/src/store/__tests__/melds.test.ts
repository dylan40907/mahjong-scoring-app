import {
  applyExposedSpans,
  exposedIndices,
  moveTile,
  normaliseSpans,
  spansFromGrouping,
} from '../melds';
import type { TileCode } from '@/tiles/tileset';

const hand = [
  'man1', 'man2', 'man3', 'pin4', 'pin4', 'pin4', 'sou7', 'sou8', 'sou9',
  'east', 'east', 'east', 'red', 'red',
] as TileCode[];

describe('normaliseSpans', () => {
  it('orders the endpoints and sorts', () => {
    expect(normaliseSpans([[5, 3], [1, 0]], 14)).toEqual([[0, 1], [3, 5]]);
  });

  it('merges overlapping and adjacent spans', () => {
    expect(normaliseSpans([[0, 2], [2, 4]], 14)).toEqual([[0, 4]]);
    expect(normaliseSpans([[0, 2], [3, 5]], 14)).toEqual([[0, 5]]);
  });

  it('clamps to the hand and drops what falls outside', () => {
    expect(normaliseSpans([[12, 99]], 14)).toEqual([[12, 13]]);
    expect(normaliseSpans([[20, 25]], 14)).toEqual([]);
  });
});

describe('applyExposedSpans', () => {
  it('leaves an unmarked hand as one concealed group', () => {
    const { groups, meldGroups } = applyExposedSpans(hand, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(14);
    expect(meldGroups).toEqual([]);
  });

  it('splits one exposed meld out of the middle', () => {
    const { groups, meldGroups } = applyExposedSpans(hand, [[3, 5]]);
    expect(groups.map((g) => g.length)).toEqual([3, 3, 8]);
    expect(meldGroups).toEqual([1]);
    expect(groups[1]).toEqual(['pin4', 'pin4', 'pin4']);
  });

  it('handles a meld at the start and one at the end', () => {
    const { groups, meldGroups } = applyExposedSpans(hand, [[0, 2], [12, 13]]);
    expect(groups.map((g) => g.length)).toEqual([3, 9, 2]);
    expect(meldGroups).toEqual([0, 2]);
  });

  it('round-trips through spansFromGrouping', () => {
    const spans = [[3, 5], [9, 11]] as const;
    const grouping = applyExposedSpans(hand, spans);
    expect(spansFromGrouping(grouping)).toEqual([[3, 5], [9, 11]]);
  });

  it('keeps every tile exactly once', () => {
    const { groups } = applyExposedSpans(hand, [[3, 5], [9, 11]]);
    expect(groups.flat()).toEqual(hand);
  });
});

describe('exposedIndices', () => {
  it('expands spans into the tiles they cover', () => {
    expect([...exposedIndices([[1, 3]])].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

describe('moveTile', () => {
  it('moves a tile later and earlier', () => {
    expect(moveTile(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTile(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is a no-op for a move onto itself or out of range', () => {
    expect(moveTile(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveTile(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('reverses a hand read from the far side of the table', () => {
    let tiles = ['a', 'b', 'c'];
    // Dragging each tile to the front, in order, reverses the hand.
    tiles = moveTile(tiles, 1, 0);
    tiles = moveTile(tiles, 2, 0);
    expect(tiles).toEqual(['c', 'b', 'a']);
  });
});
