import { bestHandFor, mySeat, playedGames, playerStats } from '../stats';
import type { HandRecord, Session, SessionPlayer } from '../types';

/**
 * The arithmetic behind a profile.
 *
 * Every mistake available here produces a number rather than an error: a hand
 * counted twice, somebody else's limit hand shown as yours, a friend's game
 * added to your totals when you were not in it. All of them look completely
 * plausible on the screen, which is the reason this is a pure module with
 * tests rather than a few reduces inside the profile component.
 */

const ME = { userId: 'u_me', displayName: 'Dylan' };

function player(id: string, name: string, accountId?: string): SessionPlayer {
  return { id, name, seat: 'east', ...(accountId ? { accountId } : {}) };
}

function hand(id: string, winnerId: string, total: number, deltas: Record<string, number>): HandRecord {
  return {
    id,
    createdAt: `2026-09-0${id.slice(-1)}T00:00:00.000Z`,
    winnerId,
    discarderId: null,
    hand: { concealed: [], exposed: [], bonus: [], winningTile: 'man1', context: {} as never },
    deltas,
    summary: { total, unit: 'tai', winnerReceives: total, topPatterns: [] },
  };
}

function session(id: string, players: SessionPlayer[], hands: HandRecord[]): Session {
  return {
    id,
    name: id,
    createdAt: `2026-09-0${id.slice(-1)}T00:00:00.000Z`,
    updatedAt: '2026-09-04T00:00:00.000Z',
    ruleSetId: 'taiwanese-common',
    players,
    roundWind: 'east',
    dealerId: players[0]?.id ?? '',
    hands,
  };
}

describe('finding which seat is you', () => {
  it('uses the linked account, wherever the seat sits', () => {
    const s = session('s1', [player('p1', 'Wei'), player('p2', 'D', 'u_me')], []);
    expect(mySeat(s, ME)?.id).toBe('p2');
  });

  it('falls back to the name on sessions written before seats could be linked', () => {
    // Not a guess: the app puts the account's own display name into seat one
    // of every session it creates, so on this device the name is the
    // identification and always was.
    const s = session('s1', [player('p1', 'Dylan'), player('p2', 'Wei')], []);
    expect(mySeat(s, ME)?.id).toBe('p1');
  });

  it('will not claim a seat that belongs to somebody else', () => {
    // Two people called Dylan is a coincidence. A linked account is a claim.
    const s = session('s1', [player('p1', 'Dylan', 'u_other')], []);
    expect(mySeat(s, ME)).toBeUndefined();
  });

  it('finds nobody when the account has no name and no links', () => {
    const s = session('s1', [player('p1', 'Wei'), player('p2', 'Mei')], []);
    expect(mySeat(s, { userId: 'u_me', displayName: null })).toBeUndefined();
  });
});

describe('totals', () => {
  const home = session(
    's1',
    [player('p1', 'Dylan', 'u_me'), player('p2', 'Wei')],
    [hand('h1', 'p1', 20, { p1: 200, p2: -200 }), hand('h2', 'p2', 8, { p1: -80, p2: 80 })],
  );
  const away = session(
    's2',
    [player('q1', 'Wei'), player('q2', 'Dylan', 'u_me')],
    [hand('h3', 'q2', 40, { q1: -400, q2: 400 })],
  );

  it('counts every hand at a table you sat at, and only the ones you won as wins', () => {
    const stats = playerStats([{ session: home, away: false }], ME);
    expect(stats.handsPlayed).toBe(2);
    expect(stats.handsWon).toBe(1);
    expect(stats.net).toBe(120);
  });

  it('includes games somebody else scored', () => {
    const stats = playerStats(
      [
        { session: home, away: false },
        { session: away, away: true },
      ],
      ME,
    );
    expect(stats.handsPlayed).toBe(3);
    expect(stats.handsWon).toBe(2);
    expect(stats.net).toBe(520);
    expect(stats.sessions).toBe(2);
    // Away games are part of the session count, not stacked on top of it.
    expect(stats.awaySessions).toBe(1);
  });

  it('says so rather than reporting zero when it cannot tell which seat you were', () => {
    // A flat "0 hands won" beside two hundred played reads as a losing streak
    // rather than as a question the app has not been told the answer to.
    const anonymous = session('s3', [player('p1', 'Wei'), player('p2', 'Mei')], [hand('h4', 'p1', 5, {})]);
    const stats = playerStats([{ session: anonymous, away: false }], ME);
    expect(stats.unidentified).toBe(true);
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(0);
  });
});

describe('the hand on your profile', () => {
  it('is one you won, not the best one at your table', () => {
    const s = session(
      's1',
      [player('p1', 'Dylan', 'u_me'), player('p2', 'Wei')],
      [hand('h1', 'p2', 88, { p2: 880 }), hand('h2', 'p1', 12, { p1: 120 })],
    );
    const best = bestHandFor([{ session: s, away: false }], ME);
    expect(best?.record.id).toBe('h2');
  });

  it('can come from a game somebody else scored, and knows that it did', () => {
    const s = session('s2', [player('q1', 'Dylan', 'u_me')], [hand('h3', 'q1', 40, { q1: 400 })]);
    const best = bestHandFor([{ session: s, away: true }], ME);
    expect(best?.record.id).toBe('h3');
    expect(best?.away).toBe(true);
  });

  it('is nothing at all when no seat identifies you', () => {
    const s = session('s1', [player('p1', 'Wei')], [hand('h1', 'p1', 88, {})]);
    expect(bestHandFor([{ session: s, away: false }], ME)).toBeNull();
  });
});

describe('the combined list', () => {
  it('interleaves away games by when they were played', () => {
    const mine = session('s3', [player('p1', 'Dylan')], []);
    const theirs = session('s5', [player('q1', 'Dylan')], []);
    const games = playedGames([mine], [
      { session: theirs, ownerId: 'u_wei', playerId: 'q1', fetchedAt: '2026-09-04T00:00:00.000Z' },
    ]);
    // Newest first, regardless of whose phone it came off.
    expect(games.map((g) => g.session.id)).toEqual(['s5', 's3']);
    expect(games.map((g) => g.away)).toEqual([true, false]);
  });
});
