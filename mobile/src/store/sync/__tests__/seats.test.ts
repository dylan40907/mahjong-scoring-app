import { planSeats, seatsOf, type SeatRow } from '../seats';
import type { Session, SessionPlayer } from '../../types';

/**
 * Which friends the server thinks are sitting at our tables.
 *
 * The failures here are the ones worth catching before a person does. A seat
 * that fails to reach the server is a game that never shows up in a friend's
 * history and no error anywhere. A seat that fails to be *removed* is worse:
 * somebody still reading a game they were taken out of, which is the only
 * privacy promise this feature makes.
 */

function player(id: string, name: string, accountId?: string): SessionPlayer {
  return { id, name, seat: 'east', ...(accountId ? { accountId } : {}) };
}

function session(id: string, players: SessionPlayer[]): Session {
  return {
    id,
    name: id,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    ruleSetId: 'taiwanese-common',
    players,
    roundWind: 'east',
    dealerId: players[0]?.id ?? '',
    hands: [],
  };
}

const seat = (sessionId: string, userId: string, playerId: string): SeatRow => ({
  sessionId,
  userId,
  playerId,
});

describe('what the server should hold', () => {
  it('is every seat that names an account, our own included', () => {
    // Our own seat matters as much as a friend's: it is what makes these
    // totals survive a fresh install on a second phone.
    const s = session('s1', [player('p1', 'Me', 'u_me'), player('p2', 'Wei', 'u_wei'), player('p3', 'Mei')]);
    expect(seatsOf([s])).toEqual([seat('s1', 'u_me', 'p1'), seat('s1', 'u_wei', 'p2')]);
  });

  it('is nothing at all for a table of people without the app', () => {
    expect(seatsOf([session('s1', [player('p1', 'Wei'), player('p2', 'Mei')])])).toEqual([]);
  });
});

describe('the plan', () => {
  it('writes a seat the server has never heard of', () => {
    const s = session('s1', [player('p1', 'Wei', 'u_wei')]);
    const plan = planSeats([s], []);
    expect(plan.upsert).toEqual([seat('s1', 'u_wei', 'p1')]);
    expect(plan.remove).toEqual([]);
  });

  it('does nothing when the two copies already agree', () => {
    const s = session('s1', [player('p1', 'Wei', 'u_wei')]);
    const plan = planSeats([s], [seat('s1', 'u_wei', 'p1')]);
    expect(plan.upsert).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('rewrites rather than duplicates when a friend changes chairs', () => {
    // One person, one seat, at the table and in the schema.
    const s = session('s1', [player('p1', 'Ann'), player('p2', 'Wei', 'u_wei')]);
    const plan = planSeats([s], [seat('s1', 'u_wei', 'p1')]);
    expect(plan.upsert).toEqual([seat('s1', 'u_wei', 'p2')]);
    expect(plan.remove).toEqual([]);
  });

  it('removes a friend who has been taken out of a game', () => {
    const s = session('s1', [player('p1', 'Wei')]);
    const plan = planSeats([s], [seat('s1', 'u_wei', 'p1')]);
    expect(plan.remove).toEqual([{ sessionId: 's1', userId: 'u_wei' }]);
  });

  it('repairs a removal that failed last time, without being told it failed', () => {
    // The whole reason seats are compared rather than queued. Whatever went
    // wrong before - refused, offline, app killed - the next sync tries again,
    // because the difference is still there to see.
    const s = session('s1', [player('p1', 'Wei')]);
    const once = planSeats([s], [seat('s1', 'u_wei', 'p1')]);
    const again = planSeats([s], [seat('s1', 'u_wei', 'p1')]);
    expect(again).toEqual(once);
  });

  it('leaves seats we hold in other people’s games alone', () => {
    // Those rows belong to whoever owns that game. Reading their absence from
    // our own sessions as something to delete would have us revoking our own
    // access to every game we are a guest in.
    const mine = session('s1', [player('p1', 'Wei', 'u_wei')]);
    const plan = planSeats([mine], [seat('s1', 'u_wei', 'p1')]);
    expect(plan.remove).toEqual([]);
  });

  it('drops every seat of a session that is no longer here', () => {
    const plan = planSeats([], [seat('s_gone', 'u_wei', 'p1'), seat('s_gone', 'u_mei', 'p2')]);
    expect(plan.remove).toHaveLength(2);
    expect(plan.upsert).toEqual([]);
  });
});
