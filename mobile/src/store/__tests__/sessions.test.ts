import {
  addHand,
  applySync,
  createSession,
  createSessionLike,
  deleteHand,
  deleteSession,
  getSession,
  getState,
  leaveSeat,
  leaveSessionsBehind,
  linkSeat,
  rekeySession,
  sessionIn,
  sessionTotals,
  setLocalIdentity,
  takeSeat,
  unlinkSeat,
  updateHand,
} from '../store';
import { mySeat } from '../stats';
import { adopt, planAdoption } from '../sync/adopt';
import { isDirty } from '../sync/meta';
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

describe('deleting a session', () => {
  it('leaves a tombstone so the delete can travel', () => {
    const session = fresh();
    deleteSession(session.id);

    expect(getSession(session.id)).toBeUndefined();
    const stone = getState().deletedSessions.find((s) => s.id === session.id);
    expect(stone).toBeDefined();
    // Never pushed yet, so it is still owed to the server.
    expect(stone!.syncedAt ?? null).toBeNull();
  });
});

describe('who is sitting where', () => {
  const ME = { userId: 'u_me', displayName: 'Dylan' };

  function table(names: string[]): Session {
    return createSession({ name: 'Seats', ruleSetId: 'taiwanese-common', playerNames: names });
  }

  const names = (id: string) => reload(id).players.map((player) => player.name);

  afterEach(() => setLocalIdentity(null, null));

  it('lets you claim a seat in a game scored before you had an account', () => {
    // Every seat a placeholder, and nothing on the record says which was us.
    const session = table(['', '', '', '']);
    setLocalIdentity(ME.displayName, ME.userId);

    takeSeat(session.id, session.players[2].id);

    const after = reload(session.id);
    expect(after.players[2]).toMatchObject({ accountId: 'u_me', name: 'Dylan' });
    expect(mySeat(after, ME)?.id).toBe(session.players[2].id);
  });

  it('moves you and your name together', () => {
    setLocalIdentity(ME.displayName, ME.userId);
    const session = table(['Dylan', '', '', '']);
    expect(session.players[0].accountId).toBe('u_me');

    takeSeat(session.id, session.players[2].id);

    expect(names(session.id)).toEqual(['Player 1', 'Player 2', 'Dylan', 'Player 4']);
    expect(reload(session.id).players[0].accountId).toBeUndefined();
  });

  it('clears a seat that was only yours by name', () => {
    // Written before seats carried an account, so only the name says it is us.
    const session = table(['Dylan', '', '', '']);
    setLocalIdentity(ME.displayName, ME.userId);
    expect(mySeat(reload(session.id), ME)?.id).toBe(session.players[0].id);

    takeSeat(session.id, session.players[1].id);

    expect(names(session.id)).toEqual(['Player 1', 'Dylan', 'Player 3', 'Player 4']);
    expect(mySeat(reload(session.id), ME)?.id).toBe(session.players[1].id);
  });

  it('takes you out of a game you were not in, and keeps you out', () => {
    setLocalIdentity(ME.displayName, ME.userId);
    const session = table(['Dylan', 'Bo', '', '']);

    leaveSeat(session.id, session.players[0].id);

    const after = reload(session.id);
    expect(after.players[0].name).toBe('Player 1');
    expect(after.players[0].accountId).toBeUndefined();
    // The name fallback is what would have put us straight back in.
    expect(mySeat(after, ME)).toBeUndefined();
  });

  it('gives a seat the name of whoever is put in it', () => {
    // A guest's name is typed; a seat with a person on it says who they are.
    const session = table(['Ada', 'Dad', '', '']);

    linkSeat(session.id, session.players[1].id, 'u_wei', 'Wei');

    expect(names(session.id)).toEqual(['Ada', 'Wei', 'Player 3', 'Player 4']);
  });

  it('swaps you and a friend when you take their chair', () => {
    // Jacob starts a game (seat one), seats Dylan in seat two, then says he
    // was in seat two. They were sitting the other way round.
    setLocalIdentity('Jacob', 'u_jacob');
    const session = table(['Jacob', '', '', '']);
    linkSeat(session.id, session.players[1].id, 'u_dylan', 'Dylan');
    expect(names(session.id)).toEqual(['Jacob', 'Dylan', 'Player 3', 'Player 4']);

    takeSeat(session.id, session.players[1].id);

    const after = reload(session.id);
    expect(names(session.id)).toEqual(['Dylan', 'Jacob', 'Player 3', 'Player 4']);
    expect(after.players.map((player) => player.accountId)).toEqual([
      'u_dylan',
      'u_jacob',
      undefined,
      undefined,
    ]);
  });

  it('swaps two friends when one is moved into the other’s chair', () => {
    const session = table(['Ada', '', '', '']);
    linkSeat(session.id, session.players[1].id, 'u_wei', 'Wei');
    linkSeat(session.id, session.players[2].id, 'u_bo', 'Bo');

    linkSeat(session.id, session.players[2].id, 'u_wei', 'Wei');

    expect(names(session.id)).toEqual(['Ada', 'Bo', 'Wei', 'Player 4']);
    expect(reload(session.id).players[1].accountId).toBe('u_bo');
  });

  it('takes somebody off the table when a friend who was not seated takes their chair', () => {
    // No chair to swap into, because the newcomer was not sitting anywhere.
    const session = table(['Ada', '', '', '']);
    linkSeat(session.id, session.players[1].id, 'u_wei', 'Wei');

    linkSeat(session.id, session.players[1].id, 'u_bo', 'Bo');

    const after = reload(session.id);
    expect(names(session.id)).toEqual(['Ada', 'Bo', 'Player 3', 'Player 4']);
    expect(after.players.some((player) => player.accountId === 'u_wei')).toBe(false);
  });

  it('hands a friend’s old chair back to a guest when they move', () => {
    const session = table(['Ada', '', '', '']);
    linkSeat(session.id, session.players[1].id, 'u_wei', 'Wei');

    linkSeat(session.id, session.players[3].id, 'u_wei', 'Wei');

    expect(names(session.id)).toEqual(['Ada', 'Player 2', 'Player 3', 'Wei']);
    expect(reload(session.id).players[1].accountId).toBeUndefined();
  });

  it('moves a friend and their name together', () => {
    const session = table(['Ada', '', '', '']);

    linkSeat(session.id, session.players[1].id, 'u_wei', 'Wei');
    linkSeat(session.id, session.players[2].id, 'u_wei', 'Wei');

    expect(names(session.id)).toEqual(['Ada', 'Player 2', 'Wei', 'Player 4']);
  });

  it('keeps a friend in the seat, by name, when the game stops being shared with them', () => {
    const session = table(['Ada', '', '', '']);
    linkSeat(session.id, session.players[1].id, 'u_wei', 'Wei');

    unlinkSeat(session.id, session.players[1].id);

    expect(names(session.id)).toEqual(['Ada', 'Wei', 'Player 3', 'Player 4']);
    expect(reload(session.id).players[1].accountId).toBeUndefined();
  });
});

describe('a session sync gives a new id', () => {
  // Adoption and collapsing copies both re-key a session, and either can
  // happen with the session on screen or a hand half entered against it. Both
  // hold the old id. Missing it drops the hand without a word.
  let n = 0;
  const nextCopy = (id: string) => `${id.split('~')[0]}~t${(n += 1)}`;

  async function move(session: Session): Promise<Session> {
    const adoption = planAdoption(session, 'session', nextCopy);
    const moved = await rekeySession(
      session.id,
      (current) => adopt(current, adoption, 'u_new'),
      adoption.renames,
    );
    return moved!;
  }

  it('still takes a hand saved against the id it had when the hand began', async () => {
    const session = fresh();
    addHand(session.id, hand(session.players[1].id));
    const moved = await move(reload(session.id));

    addHand(session.id, hand(session.players[2].id, 'h_after'));

    expect(getState().sessions.some((s) => s.id === session.id)).toBe(false);
    expect(getSession(moved.id)!.hands.map((h) => h.id)[0]).toBe('h_after');
    expect(getSession(moved.id)!.hands).toHaveLength(2);
  });

  it('corrects a hand opened for editing before it moved', async () => {
    const session = fresh();
    addHand(session.id, hand(session.players[1].id, 'h_edit'));
    await move(reload(session.id));

    updateHand(session.id, hand(session.players[3].id, 'h_edit'));

    const [only] = reload(session.id).hands;
    expect(only.winnerId).toBe(session.players[3].id);
    expect(only.id).not.toBe('h_edit');
  });

  it('deletes a hand by the id it had before it moved', async () => {
    const session = fresh();
    addHand(session.id, hand(session.players[1].id, 'h_gone'));
    await move(reload(session.id));

    deleteHand(session.id, 'h_gone');
    expect(reload(session.id).hands).toEqual([]);
  });

  it('tombstones the session it moved to, not the id it left', async () => {
    const session = fresh();
    const moved = await move(session);

    deleteSession(session.id);

    expect(getSession(moved.id)).toBeUndefined();
    expect(getState().deletedSessions.map((s) => s.id)).toContain(moved.id);
    expect(getState().deletedSessions.map((s) => s.id)).not.toContain(session.id);
  });

  it('follows a game out to another account and back without going in circles', async () => {
    const session = fresh();
    const out = await move(session);

    // Home again: the copy collapses back into the original.
    applySync(
      getState().sessions.map((s) => (s.id === out.id ? session : s)),
      getState().deletedSessions,
      new Map([[out.id, session.id]]),
    );

    expect(sessionIn(getState().sessions, session.id)?.id).toBe(session.id);
    expect(sessionIn(getState().sessions, out.id)?.id).toBe(session.id);
  });
});

describe('deleting the account the games synced to', () => {
  it('leaves them here, owing nothing, and marked so they are not carried on', () => {
    const session = fresh();
    expect(isDirty(reload(session.id))).toBe(true);

    leaveSessionsBehind();

    const after = reload(session.id);
    expect(isDirty(after)).toBe(false);
    expect(after.leftBehind).toBe(true);
  });
});
