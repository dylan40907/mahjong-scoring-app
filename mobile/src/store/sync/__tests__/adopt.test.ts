import { copyId, rootId } from '@/lib/ids';
import { adopt, carryOver, collapseCopies, planAdoption, setAside } from '../adopt';
import { isDirty, type SyncOwner } from '../meta';
import { reconcile, type RemoteState } from '../reconcile';
import { planSeats } from '../seats';
import type { HandRecord, Session, SessionPlayer } from '../../types';

/**
 * Games that were synced under one account, on a device now signed in as
 * another.
 *
 * Every failure here is silent. A session that stays clean for the wrong
 * account never reaches the new one's server, and a reinstall is when anybody
 * finds out. A session pushed against a row the old account owns is refused,
 * and nothing says so. A copy that does not recognise itself coming home puts
 * every game on the device twice.
 */

const A: SyncOwner = { userId: 'u_a', anonymous: false };
const B: SyncOwner = { userId: 'u_b', anonymous: false };
const ANON: SyncOwner = { userId: 'u_anon', anonymous: true };

const T1 = '2026-09-01T10:00:00.000Z';
const T2 = '2026-09-02T10:00:00.000Z';

function hand(id: string, winnerId = 'p1'): HandRecord {
  return {
    id,
    createdAt: T1,
    winnerId,
    discarderId: null,
    hand: {
      concealed: [],
      exposed: [],
      bonus: [],
      winningTile: 'red',
      context: { selfDrawn: true, seatWind: 'east', roundWind: 'east', isDealer: true },
    },
    deltas: { [winnerId]: 30, p2: -30 },
    summary: { total: 3, unit: 'tai', winnerReceives: 30, topPatterns: [] },
  };
}

function player(id: string, name: string, accountId?: string): SessionPlayer {
  return { id, name, seat: 'east', ...(accountId ? { accountId } : {}) };
}

/** Clean, the way a session looks once some server has acknowledged it. */
function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    createdAt: T1,
    updatedAt: T1,
    syncedAt: T1,
    ruleSetId: 'taiwanese-common',
    players: [player('p1', 'Dylan'), player('p2', 'Wei')],
    roundWind: 'east',
    dealerId: 'p1',
    hands: [hand('h1')],
    ...overrides,
  };
}

const nothing: RemoteState = { sessions: [], tombstones: [] };

/** Deterministic copy ids, the same shape `copyId` makes. */
function counter() {
  let n = 0;
  return (id: string) => `${rootId(id)}~n${(n += 1)}`;
}

describe('ids for a copy', () => {
  it('keep the root they were copied from, however many times', () => {
    const once = copyId('s_abc');
    const twice = copyId(once);
    expect(rootId(once)).toBe('s_abc');
    expect(rootId(twice)).toBe('s_abc');
    expect(new Set(['s_abc', once, twice]).size).toBe(3);
  });

  it('leave an id that was never copied as its own root', () => {
    expect(rootId('s_lk3j4abc123')).toBe('s_lk3j4abc123');
  });
});

describe('carrying sessions over to a new account', () => {
  it('makes a session synced under the old account dirty, so it is pushed at all', () => {
    // The original bug: clean, only here, and so never sent anywhere.
    const out = carryOver([session('s1')], nothing, A, B);
    expect(isDirty(out[0])).toBe(true);

    const plan = reconcile({ sessions: out, tombstones: [] }, nothing);
    expect(plan.push.map((s) => s.id)).toEqual(['s1']);
  });

  it('changes nothing while the account stays the same', () => {
    const local = [session('s1')];
    expect(carryOver(local, nothing, B, B)).toBe(local);
  });

  it('changes nothing when an anonymous account is upgraded in place', () => {
    // `linkIdentity` and `updateUser` keep the user id; that is why they are
    // used. Only the anonymous flag moves.
    const local = [session('s1')];
    expect(carryOver(local, nothing, ANON, { ...ANON, anonymous: false })).toBe(local);
  });

  it('leaves alone a session the new account already has, live or deleted', () => {
    const live = session('s_live');
    const gone = session('s_gone');
    const remote: RemoteState = {
      sessions: [live],
      tombstones: [{ id: 's_gone', deletedAt: T2 }],
    };
    const out = carryOver([live, gone], remote, A, B);
    expect(out.every((s) => !isDirty(s))).toBe(true);
  });

  it('gives an anonymous predecessor’s seat to whoever signed in over it', () => {
    // The only ways off an anonymous account here are into a real one, by the
    // person who was using it.
    const mine = session('s1', {
      players: [player('p1', 'Dylan', ANON.userId), player('p2', 'Wei', 'u_wei')],
    });
    const [out] = carryOver([mine], nothing, ANON, B);
    expect(out.players.map((p) => p.accountId)).toEqual(['u_b', 'u_wei']);
  });

  it('leaves a real predecessor’s seat where it is', () => {
    // It still exists, with its own copy of the game and its own seat in it.
    const theirs = session('s1', { players: [player('p1', 'Dylan', A.userId)] });
    const [out] = carryOver([theirs], nothing, A, B);
    expect(out.players[0].accountId).toBe('u_a');
  });

  it('carries what the server lacks on a device that never recorded an owner', () => {
    // Switched before the owner was written down. Nothing says who it was, so
    // nobody's seat is reassigned; the name fallback in `mySeat` still works.
    const orphan = session('s1', { players: [player('p1', 'Dylan', 'u_someone')] });
    const known = session('s2');
    const [carried, kept] = carryOver([orphan, known], { sessions: [known], tombstones: [] }, undefined, B);
    expect(isDirty(carried)).toBe(true);
    expect(carried.players[0].accountId).toBe('u_someone');
    expect(isDirty(kept)).toBe(false);
  });

  it('does not carry a deleted account’s games to the next one', () => {
    const left = session('s1', { leftBehind: true });
    const out = carryOver([left], nothing, A, B);
    expect(isDirty(out[0])).toBe(false);
    expect(reconcile({ sessions: out, tombstones: [] }, nothing).push).toEqual([]);
  });

  it('does carry one of them that has been played since', () => {
    const played = session('s1', { leftBehind: true, updatedAt: T2 });
    const plan = reconcile({ sessions: carryOver([played], nothing, A, B), tombstones: [] }, nothing);
    expect(plan.push.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('games a different real account left on the device', () => {
  // The bug that made this: two accounts on one phone, signing out of one and
  // in to the other, each ended up owning an editable copy of every game the
  // other had scored. A real account can sign back in; its games are not the
  // next account's to adopt.

  it('are set aside for that account, not carried to this one', () => {
    const theirs = session('s_a');
    const { keep, aside } = setAside([theirs], nothing, A, B);
    expect(aside.map((s) => s.id)).toEqual(['s_a']);
    expect(keep).toEqual([]);
    // And nothing is left for carryOver to push under this account.
    const plan = reconcile({ sessions: carryOver(keep, nothing, A, B), tombstones: [] }, nothing);
    expect(plan.push).toEqual([]);
  });

  it('are set aside untouched, so they come back exactly as they left', () => {
    const edited = session('s_a', { updatedAt: T2 });
    const { aside } = setAside([edited], nothing, A, B);
    expect(aside[0]).toBe(edited);
  });

  it('leave behind anything this account’s server already has', () => {
    const shared = session('s_mine');
    const { keep, aside } = setAside(
      [shared, session('s_a')],
      { sessions: [shared], tombstones: [] },
      A,
      B,
    );
    expect(keep.map((s) => s.id)).toEqual(['s_mine']);
    expect(aside.map((s) => s.id)).toEqual(['s_a']);
  });

  it('never include a deleted account’s games, which follow nobody', () => {
    const left = session('s_left', { leftBehind: true });
    expect(setAside([left], nothing, A, B).aside).toEqual([]);
  });

  it('do not apply to a guest, whose games are the next account’s', () => {
    const guest = [session('s_guest')];
    expect(setAside(guest, nothing, ANON, B)).toEqual({ keep: guest, aside: [] });
  });

  it('do not apply when the account has not changed, or nobody knows who it was', () => {
    const local = [session('s1')];
    expect(setAside(local, nothing, B, B).keep).toBe(local);
    expect(setAside(local, nothing, undefined, B).keep).toBe(local);
  });
});

describe('adopting a session another account owns', () => {
  const refused = session('s1', {
    players: [
      player('p1', 'Dylan', 'u_b'),
      player('p2', 'Wei', 'u_wei'),
      player('p3', 'Ann', 'u_a'),
      player('p4', 'Mei'),
    ],
    hands: [hand('h1'), hand('h2', 'p2')],
  });

  it('gets new ids that keep their roots, and is dirty so it is pushed', () => {
    const plan = planAdoption(refused, 'session', counter());
    const copy = adopt(refused, plan, 'u_b');

    expect(copy.id).not.toBe('s1');
    expect(rootId(copy.id)).toBe('s1');
    expect(copy.hands.map((h) => rootId(h.id))).toEqual(['h1', 'h2']);
    expect(copy.hands.map((h) => h.id)).not.toContain('h1');
    expect(isDirty(copy)).toBe(true);
  });

  it('keeps everything a hand refers to', () => {
    // Deltas, winners and the dealer are keyed by player id, so those stay;
    // `updatedAt` stays because moving a record is not editing it.
    const copy = adopt(refused, planAdoption(refused, 'session', counter()), 'u_b');
    expect(copy.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(copy.players.map((p) => p.name)).toEqual(['Dylan', 'Wei', 'Ann', 'Mei']);
    expect(copy.hands.map((h) => h.deltas)).toEqual(refused.hands.map((h) => h.deltas));
    expect(copy.dealerId).toBe('p1');
    expect(copy.updatedAt).toBe(refused.updatedAt);
  });

  it('unlinks everybody but the new owner, so nobody sees the night twice', () => {
    // The original still seats Wei and Ann under its old owner. Seating them
    // in this copy too would give each of them two of the same game.
    const copy = adopt(refused, planAdoption(refused, 'session', counter()), 'u_b');
    expect(copy.players.map((p) => p.accountId)).toEqual(['u_b', undefined, undefined, undefined]);
    expect(planSeats([copy], []).upsert).toEqual([{ sessionId: copy.id, userId: 'u_b', playerId: 'p1' }]);
  });

  it('names every id that moved, so a screen holding one can follow it', () => {
    const plan = planAdoption(refused, 'session', counter());
    const copy = adopt(refused, plan, 'u_b');
    expect(plan.renames.get('s1')).toBe(copy.id);
    expect(plan.renames.get('h1')).toBe(copy.hands[0].id);
    expect(plan.renames.get('h2')).toBe(copy.hands[1].id);
  });

  it('moves only the hands when only a hand id was taken', () => {
    // Moving the session as well would leave the row that did land behind,
    // empty, to come back down as a game with nothing in it.
    const plan = planAdoption(refused, 'hands', counter());
    const copy = adopt(refused, plan, 'u_b');
    expect(copy.id).toBe('s1');
    expect(copy.hands.map((h) => h.id)).not.toContain('h1');
    expect(copy.players).toEqual(refused.players);
    expect(plan.renames.has('s1')).toBe(false);
  });

  it('keeps a hand scored after the refusal, under the id it was born with', () => {
    // The plan is made from the copy that was refused; it is applied to
    // whatever the session is by the time it runs.
    const plan = planAdoption(refused, 'session', counter());
    const since = { ...refused, hands: [hand('h_new'), ...refused.hands], updatedAt: T2 };
    const copy = adopt(since, plan, 'u_b');
    expect(copy.hands.map((h) => h.id)).toEqual(['h_new', plan.hands.get('h1'), plan.hands.get('h2')]);
    expect(copy.updatedAt).toBe(T2);
  });

  it('is not deleted by a tombstone for the id it left behind', () => {
    const copy = adopt(refused, planAdoption(refused, 'session', counter()), 'u_b');
    const plan = reconcile(
      { sessions: [copy], tombstones: [{ id: 's1', deletedAt: T2 }] },
      { sessions: [], tombstones: [{ id: 's1', deletedAt: T2 }] },
    );
    expect(plan.keep.map((s) => s.id)).toEqual([copy.id]);
    expect(plan.push.map((s) => s.id)).toEqual([copy.id]);
    expect(plan.dropLocal).toEqual([]);
  });
});

describe('a copy coming home', () => {
  it('is replaced by the account’s own copy, in the same place in the list', () => {
    const fresh = counter();
    const original = session('s1', { hands: [hand('h1')] });
    const copy = adopt(original, planAdoption(original, 'session', fresh), 'u_c');
    const other = session('s_other');

    const out = collapseCopies([other, copy], { sessions: [original], tombstones: [] });

    expect(out.sessions.map((s) => s.id)).toEqual(['s_other', 's1']);
    expect(out.renames.get(copy.id)).toBe('s1');
    expect(out.renames.get(copy.hands[0].id)).toBe('h1');
  });

  it('survives signing out, getting a fresh account, and signing back in', () => {
    // A -> anonymous C -> A. Without collapsing, C adopts every game, then A
    // adopts C's copies, and A's list holds two of each.
    const fresh = counter();
    const s1 = session('s1');

    // As C: carried, refused (A owns s1), adopted.
    const [carried] = carryOver([s1], nothing, A, ANON);
    const adopted = adopt(carried, planAdoption(carried, 'session', fresh), ANON.userId);
    const asC = [{ ...adopted, syncedAt: adopted.updatedAt }];

    // Back as A, whose server still has s1.
    const home: RemoteState = { sessions: [s1], tombstones: [] };
    const collapsed = collapseCopies(asC, home);
    const local = carryOver(collapsed.sessions, home, ANON, A);
    const plan = reconcile({ sessions: local, tombstones: [] }, home);

    expect(plan.keep.map((s) => s.id)).toEqual(['s1']);
    expect(plan.push).toEqual([]);
  });

  it('is kept alongside when it has been played since it left', () => {
    // Neither copy is a stale version of the other any more, so neither gets
    // to silently beat the other.
    const original = session('s1');
    const copy = { ...adopt(original, planAdoption(original, 'session', counter()), 'u_c'), updatedAt: T2 };
    const out = collapseCopies([copy], { sessions: [original], tombstones: [] });
    expect(out.sessions).toEqual([copy]);
    expect(out.renames.size).toBe(0);
  });

  it('takes the account’s copy when that one is the later edit', () => {
    const original = { ...session('s1'), updatedAt: T2, syncedAt: T2 };
    const copy = adopt(session('s1'), planAdoption(session('s1'), 'session', counter()), 'u_c');
    const out = collapseCopies([copy], { sessions: [original], tombstones: [] });
    expect(out.sessions.map((s) => s.updatedAt)).toEqual([T2]);
  });

  it('is not deleted because the account deleted the original', () => {
    // Dropping a duplicate loses nothing; honouring a delete across ids would
    // throw away the only copy this device has.
    const original = session('s1');
    const copy = adopt(original, planAdoption(original, 'session', counter()), 'u_c');
    const out = collapseCopies([copy], { sessions: [], tombstones: [{ id: 's1', deletedAt: T2 }] });
    expect(out.sessions).toEqual([copy]);
  });

  it('leaves a session the server has by its own id to reconcile', () => {
    const mine = session('s1');
    const local = [mine];
    const out = collapseCopies(local, { sessions: [{ ...mine, updatedAt: T2 }], tombstones: [] });
    expect(out.sessions).toBe(local);
  });

  it('takes the account’s copy only once when two copies of it come home', () => {
    const original = session('s1');
    const fresh = counter();
    const one = adopt(original, planAdoption(original, 'session', fresh), 'u_c');
    const two = adopt(original, planAdoption(original, 'session', fresh), 'u_d');
    const out = collapseCopies([one, two], { sessions: [original], tombstones: [] });
    expect(out.sessions.map((s) => s.id)).toEqual(['s1']);
  });
});
