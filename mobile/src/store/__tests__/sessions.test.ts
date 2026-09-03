import {
  addHand,
  createSession,
  createSessionLike,
  getSession,
  sessionTotals,
} from '../store';
import type { HandRecord, Session } from '../types';

/**
 * What a session remembers between hands.
 *
 * Two things live here that nothing else can work out: whether the deal
 * passed, and how long the dealer has held it. Both are cheap to get subtly
 * wrong and expensive to notice, because a desynchronised deal shows up as
 * seat winds that are quietly one seat off for the rest of the night.
 */

function hand(winnerId: string, id = Math.random().toString(36).slice(2)): HandRecord {
  return {
    id,
    createdAt: new Date().toISOString(),
    winnerId,
    discarderId: null,
    hand: {
      concealed: [],
      exposed: [],
      bonus: [],
      winningTile: 'red',
      context: { selfDrawn: true, seatWind: 'east', roundWind: 'east', isDealer: false },
    },
    deltas: {},
    summary: { total: 1, unit: 'tai', winnerReceives: 10, topPatterns: [] },
  };
}

function fresh(): Session {
  return createSession({
    name: 'Test',
    ruleSetId: 'taiwanese-common',
    playerNames: ['Ada', 'Bo', 'Cy', 'Di'],
  });
}

function reload(id: string): Session {
  return getSession(id)!;
}

describe('the deal and the streak', () => {
  it('passes the deal when the dealer loses, and resets the streak', () => {
    const session = fresh();
    const [dealer, next] = session.players;

    addHand(session.id, hand(next.id));
    const after = reload(session.id);
    expect(after.dealerId).toBe(next.id);
    expect(after.dealerStreak).toBe(0);
    expect(dealer.id).not.toBe(after.dealerId);
  });

  it('holds the deal and counts up when the dealer wins', () => {
    const session = fresh();
    const dealer = session.players[0];

    addHand(session.id, hand(dealer.id));
    expect(reload(session.id).dealerStreak).toBe(1);

    addHand(session.id, hand(dealer.id));
    const after = reload(session.id);
    expect(after.dealerId).toBe(dealer.id);
    expect(after.dealerStreak).toBe(2);
  });

  it('drops a long streak the moment the dealer loses one', () => {
    const session = fresh();
    const [dealer, challenger] = session.players;

    addHand(session.id, hand(dealer.id));
    addHand(session.id, hand(dealer.id));
    addHand(session.id, hand(challenger.id));

    const after = reload(session.id);
    expect(after.dealerId).toBe(challenger.id);
    expect(after.dealerStreak).toBe(0);
  });
});

describe('playing again with the same people', () => {
  it('carries the names and the ruleset across', () => {
    const first = fresh();
    const again = createSessionLike(first);

    expect(again.players.map((player) => player.name)).toEqual(['Ada', 'Bo', 'Cy', 'Di']);
    expect(again.ruleSetId).toBe(first.ruleSetId);
  });

  it('leaves the seats in the order they were sitting', () => {
    const first = fresh();
    const again = createSessionLike(first);
    expect(again.players.map((player) => player.seat)).toEqual(
      first.players.map((player) => player.seat),
    );
  });

  it('starts empty rather than continuing the old night', () => {
    const first = fresh();
    addHand(first.id, hand(first.players[1].id));

    const again = createSessionLike(reload(first.id));
    expect(again.hands).toEqual([]);
    expect(again.dealerStreak ?? 0).toBe(0);
    expect(Object.values(sessionTotals(again)).every((total) => total === 0)).toBe(true);
    // A new night, not the same one reopened.
    expect(again.id).not.toBe(first.id);
  });

  it('gives the new players their own ids, so scores cannot leak between sessions', () => {
    const first = fresh();
    const again = createSessionLike(first);
    const ids = new Set(first.players.map((player) => player.id));
    expect(again.players.every((player) => !ids.has(player.id))).toBe(true);
  });
});
