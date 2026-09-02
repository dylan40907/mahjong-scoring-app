import {
  applyDeclaredMelds,
  concealedIndices,
  declaredMelds,
  meldedIndices,
  moveTile,
  normaliseMelds,
  type DeclaredMeld,
} from '../melds';
import type { TileCode } from '@/tiles/tileset';

const hand = [
  'man1', 'man2', 'man3', 'pin4', 'pin4', 'pin4', 'sou7', 'sou8', 'sou9',
  'east', 'east', 'east', 'red', 'red',
] as TileCode[];

const open = (start: number, end: number): DeclaredMeld => ({ start, end, concealed: false });
const hidden = (start: number, end: number): DeclaredMeld => ({ start, end, concealed: true });

describe('normaliseMelds', () => {
  it('orders the endpoints and sorts', () => {
    expect(normaliseMelds([open(5, 3), open(1, 0)], 14)).toEqual([open(0, 1), open(3, 5)]);
  });

  it('merges overlapping and adjacent marks', () => {
    expect(normaliseMelds([open(0, 2), open(2, 4)], 14)).toEqual([open(0, 4)]);
    expect(normaliseMelds([open(0, 2), open(3, 5)], 14)).toEqual([open(0, 5)]);
  });

  it('only keeps a merged run concealed when everything in it was', () => {
    expect(normaliseMelds([hidden(0, 3), hidden(4, 7)], 14)).toEqual([hidden(0, 7)]);
    expect(normaliseMelds([hidden(0, 3), open(4, 7)], 14)).toEqual([open(0, 7)]);
  });

  it('clamps to the hand and drops what falls outside', () => {
    expect(normaliseMelds([open(12, 99)], 14)).toEqual([open(12, 13)]);
    expect(normaliseMelds([open(20, 25)], 14)).toEqual([]);
  });
});

describe('applyDeclaredMelds', () => {
  it('leaves an unmarked hand as one concealed group', () => {
    const { groups, meldGroups } = applyDeclaredMelds(hand, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(14);
    expect(meldGroups).toEqual([]);
  });

  it('splits one declared meld out of the middle', () => {
    const { groups, meldGroups } = applyDeclaredMelds(hand, [open(3, 5)]);
    expect(groups.map((group) => group.length)).toEqual([3, 3, 8]);
    expect(meldGroups).toEqual([1]);
    expect(groups[1]).toEqual(['pin4', 'pin4', 'pin4']);
  });

  it('handles a meld at the start and one at the end', () => {
    const { groups, meldGroups } = applyDeclaredMelds(hand, [open(0, 2), open(12, 13)]);
    expect(groups.map((group) => group.length)).toEqual([3, 9, 2]);
    expect(meldGroups).toEqual([0, 2]);
  });

  it('records which declarations were concealed', () => {
    const { meldGroups, concealedMelds } = applyDeclaredMelds(hand, [
      open(0, 2),
      hidden(9, 11),
    ]);
    expect(meldGroups).toEqual([0, 2]);
    expect(concealedMelds).toEqual([2]);
  });

  it('round-trips through declaredMelds', () => {
    const melds = [open(3, 5), hidden(9, 11)];
    expect(declaredMelds(applyDeclaredMelds(hand, melds))).toEqual(melds);
  });

  it('keeps every tile exactly once', () => {
    const { groups } = applyDeclaredMelds(hand, [open(3, 5), open(9, 11)]);
    expect(groups.flat()).toEqual(hand);
  });
});

describe('meldedIndices', () => {
  it('expands marks into the tiles they cover', () => {
    expect([...meldedIndices([open(1, 3)])].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('separates the concealed declarations from the rest', () => {
    const melds = [open(0, 2), hidden(6, 9)];
    expect(meldedIndices(melds).size).toBe(7);
    expect([...concealedIndices(melds)].sort((a, b) => a - b)).toEqual([6, 7, 8, 9]);
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
