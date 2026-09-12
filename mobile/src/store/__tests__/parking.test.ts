import {
  applySync,
  claimUnowned,
  getState,
  hydrate,
  parkSessions,
  restoreParkedSessions,
  setSyncOwner,
} from '../store';
import { isDirty } from '../sync/meta';
import type { HandRecord, Session } from '../types';

/**
 * Signing out of one account and in to another on the same phone.
 *
 * A game belongs to the account that scored it, so signing out sets that
 * account's games aside and signing back in brings them back. Getting it
 * wrong is quiet in both directions: games that follow the phone rather than
 * the person turn up as editable copies in the next account, and games that
 * are lost on the way are simply not there when their owner comes back.
 */

const T1 = '2026-09-01T10:00:00.000Z';
const T2 = '2026-09-02T10:00:00.000Z';

function hand(id: string): HandRecord {
  return {
    id,
    createdAt: T1,
    winnerId: 'p1',
    discarderId: null,
    hand: {
      concealed: [],
      exposed: [],
      bonus: [],
      winningTile: 'red',
      context: { selfDrawn: true, seatWind: 'east', roundWind: 'east', isDealer: true },
    },
    deltas: { p1: 30, p2: -30 },
    summary: { total: 3, unit: 'tai', winnerReceives: 30, topPatterns: [] },
  };
}

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    createdAt: T1,
    updatedAt: T1,
    syncedAt: T1,
    ruleSetId: 'taiwanese-common',
    players: [
      { id: 'p1', name: 'Dylan', seat: 'east' },
      { id: 'p2', name: 'Wei', seat: 'south' },
    ],
    roundWind: 'east',
    dealerId: 'p1',
    hands: [hand(`${id}_h1`)],
    ...overrides,
  };
}

beforeAll(async () => {
  // Loaded once, before anything is seeded, so it cannot overwrite the seed.
  await hydrate();
});

describe('signing out', () => {
  it('takes the account’s games out of the list and keeps them for it', async () => {
    const clean = session('s_clean');
    const unsynced = session('s_dirty', { updatedAt: T2 });
    applySync([clean, unsynced], [{ id: 's_gone', deletedAt: T2 }]);
    await setSyncOwner({ userId: 'u_a', anonymous: false });

    await parkSessions('u_a');

    const state = getState();
    expect(state.sessions).toEqual([]);
    expect(state.deletedSessions).toEqual([]);
    // Nobody is signed in, so nobody's server describes what is left.
    expect(state.syncOwner).toBeUndefined();
    // Kept exactly: moving a record is not editing it, and a stamp nudged
    // here would make a stale copy win against the server later.
    expect(state.parked.u_a.sessions).toEqual([clean, unsynced]);
    expect(state.parked.u_a.deletedSessions).toEqual([{ id: 's_gone', deletedAt: T2 }]);
  });

  it('leaves a deleted account’s games, which follow nobody', async () => {
    const left = session('s_left', { leftBehind: true });
    applySync([left], []);
    await parkSessions('u_other');
    expect(getState().sessions).toEqual([left]);
    applySync([], []);
  });
});

describe('signing back in', () => {
  it('brings the games back, beside anything scored while signed out', async () => {
    const between = session('s_between', { syncedAt: null });
    applySync([between], []);

    await restoreParkedSessions('u_a');

    const state = getState();
    expect(state.sessions.map((s) => s.id).sort()).toEqual(['s_between', 's_clean', 's_dirty']);
    expect(state.deletedSessions.map((s) => s.id)).toEqual(['s_gone']);
    expect(state.parked.u_a).toBeUndefined();
    // Still exactly as they left.
    expect(state.sessions.find((s) => s.id === 's_dirty')?.updatedAt).toBe(T2);
    expect(state.sessions.find((s) => s.id === 's_clean')?.syncedAt).toBe(T1);
  });

  it('changes nothing for an account with nothing set aside', async () => {
    const before = getState().sessions;
    await restoreParkedSessions('u_nobody');
    expect(getState().sessions).toBe(before);
  });

  it('does not mix one account’s games into another’s', async () => {
    applySync([session('s_b')], []);
    await parkSessions('u_b');
    applySync([session('s_c')], []);
    await parkSessions('u_c');

    await restoreParkedSessions('u_b');
    expect(getState().sessions.map((s) => s.id)).toEqual(['s_b']);
    expect(getState().parked.u_c.sessions.map((s) => s.id)).toEqual(['s_c']);
  });
});

describe('games scored with no account signed in', () => {
  // The rule: the first account to sign in on the phone claims them, they
  // leave with it when it signs out, and no other account ever sees them.

  beforeEach(() => applySync([], []));

  it('go with the first account that signs in, and only that one', async () => {
    const guest = session('s_guest', { syncedAt: null });
    applySync([guest], []);

    // Dylan signs in: the guest game is in his list.
    await restoreParkedSessions('u_dylan');
    await claimUnowned();
    expect(getState().sessions.map((s) => s.id)).toEqual(['s_guest']);

    // Dylan signs out: it leaves with him.
    await parkSessions('u_dylan');
    expect(getState().sessions).toEqual([]);

    // Dylans signs in: not there.
    await restoreParkedSessions('u_dylans');
    await claimUnowned();
    expect(getState().sessions).toEqual([]);
    await parkSessions('u_dylans');

    // Dylan again: back, like any other game of his.
    await restoreParkedSessions('u_dylan');
    expect(getState().sessions.map((s) => s.id)).toEqual(['s_guest']);
    await parkSessions('u_dylan');
  });

  it('include a deleted account’s games, which the first account claims', async () => {
    const left = session('s_left', { leftBehind: true });
    applySync([left], []);

    await claimUnowned();

    const [claimed] = getState().sessions;
    expect(claimed.leftBehind).toBeUndefined();
    // Sent to its new owner on the next sync, but not re-dated: a copy that
    // looked newer would win against anything the server already holds.
    expect(isDirty(claimed)).toBe(true);
    expect(claimed.updatedAt).toBe(left.updatedAt);

    // And, now it is claimed, it leaves with that account.
    await parkSessions('u_dylan');
    expect(getState().sessions).toEqual([]);
    expect(getState().parked.u_dylan.sessions.map((s) => s.id)).toContain('s_left');
  });
});
