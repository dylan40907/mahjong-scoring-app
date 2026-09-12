import { copyId, rootId } from '@/lib/ids';
import type { Session } from '../types';
import { isDirty, type SyncOwner } from './meta';
import type { RemoteState } from './reconcile';

/**
 * Sessions that another account holds, and copies of the same game.
 *
 * Clean is relative to an account. `syncedAt` says a server has this session,
 * and after the device signs in as somebody else - an email sign-in, a Google
 * or Apple identity that already had an account, a sign-out followed by a
 * fresh anonymous one - the server it is talking to has never heard of it.
 * Left alone, such a session looks clean and only-here, so nothing pushes it
 * and a reinstall loses it. Edited, it is pushed against a row the old account
 * still owns, row-level security refuses it, and nothing says so.
 *
 * So the device remembers whose server its stamps describe (`SyncOwner`), and
 * when that changes, a session the new account's server does not have is
 * carried over: made dirty, so the next push tries it. If its id is free it
 * simply lands. If the old account still owns the id, the push is refused and
 * the session is adopted - given a new id, and new hand ids, and pushed as
 * new. The old rows stay with their old owner, which is right both ways
 * round: a real account keeps its own games, and an abandoned anonymous one
 * is unreachable anyway.
 *
 * An in-place upgrade never gets here. `linkIdentity` and `updateUser` keep
 * the user id, which is the entire reason the account layer uses them.
 *
 * Pure. The transport is in `engine.ts`.
 */

/**
 * Make the sessions another account synced ready to push to this one.
 *
 * Only those this account's server does not have, live or tombstoned: one it
 * has is its own, and reconcile already knows what to do with it. Nothing
 * changes while the account stays the same, which is what keeps a row lost
 * on the server - rather than a device that switched - from being quietly
 * pushed back.
 *
 * A seat linked to the previous account becomes this one's when the previous
 * one was anonymous: the only ways off an anonymous account on this device are
 * signing in to a real one, which is the same person reaching an account they
 * already had. A real previous account keeps its own seat, on its own copy.
 *
 * With no `previous` at all - a device that has not synced since the owner was
 * recorded - it could have been anybody, so the same rule runs without the
 * relinking. On a device that never switched it finds nothing to carry.
 */
export function carryOver(
  local: readonly Session[],
  remote: RemoteState,
  previous: SyncOwner | undefined,
  me: SyncOwner,
): Session[] {
  if (previous?.userId === me.userId) return local as Session[];

  const onServer = new Set([
    ...remote.sessions.map((session) => session.id),
    ...remote.tombstones.map((stone) => stone.id),
  ]);
  const relink = previous?.anonymous ? previous.userId : null;

  let changed = false;
  const out = local.map((session) => {
    if (onServer.has(session.id)) return session;
    // A deleted account's games stay on the phone and follow nobody.
    if (session.leftBehind && !isDirty(session)) return session;
    changed = true;
    return {
      ...session,
      syncedAt: null,
      players: relink
        ? session.players.map((player) =>
            player.accountId === relink ? { ...player, accountId: me.userId } : player,
          )
        : session.players,
    };
  });
  return changed ? out : (local as Session[]);
}

/**
 * Sessions a different real account left on the device, to be set aside
 * rather than carried over.
 *
 * `carryOver` exists for the guest: games scored on an anonymous account
 * belong to whoever signs in over it, because nobody can sign back into an
 * anonymous account and it was the same person all along. A real account is
 * not like that - it is somebody, and can sign back in - so its games are not
 * the next account's to adopt. Carrying them over gave a second account on
 * the same phone an editable copy of every game the first one scored.
 *
 * Signing out sets them aside itself (`parkSessions`). This catches what that
 * misses: a sign-out on an older build, or a session that expired without
 * one. Only what the new account's server lacks goes aside - one it has is
 * its own - and never a deleted account's games, which follow nobody.
 *
 * With no `previous`, or an anonymous one, or the same account, nothing is
 * set aside and `carryOver` decides as before.
 */
export function setAside(
  local: readonly Session[],
  remote: RemoteState,
  previous: SyncOwner | undefined,
  me: SyncOwner,
): { keep: Session[]; aside: Session[] } {
  if (!previous || previous.anonymous || previous.userId === me.userId) {
    return { keep: local as Session[], aside: [] };
  }
  const onServer = new Set([
    ...remote.sessions.map((session) => session.id),
    ...remote.tombstones.map((stone) => stone.id),
  ]);
  const keep: Session[] = [];
  const aside: Session[] = [];
  for (const session of local) {
    if (onServer.has(session.id) || session.leftBehind) keep.push(session);
    else aside.push(session);
  }
  return aside.length > 0 ? { keep, aside } : { keep: local as Session[], aside };
}

/**
 * Replace a stale copy of a game with the copy this account already has.
 *
 * Adoption keeps the old id's root, so two sessions with the same root are
 * the same night. A local session the server does not have by id, but whose
 * root it does have, is a copy that went out to another account and has come
 * back - signing out, getting a fresh anonymous account, signing back in.
 * Without this, each round trip would adopt every game again and the list
 * would hold two of everything.
 *
 * Only when the local copy is not newer, which is last-write-wins applied
 * across the two ids: the server's copy is then the same game or a later
 * version of it, and nothing is lost. A local copy edited since it left is
 * kept, and the two sit side by side rather than one silently beating the
 * other.
 *
 * Only live sessions take a copy's place. A tombstone for the old id never
 * deletes the new one: dropping a duplicate loses nothing, and honouring a
 * delete across ids would throw away the only copy this device has of a game
 * somebody else deleted.
 *
 * `renames` maps each dropped id - the session's and its hands' - to where it
 * went, so a screen or a half-entered hand holding the old one can follow it.
 */
export function collapseCopies(
  local: readonly Session[],
  remote: RemoteState,
): { sessions: Session[]; renames: Map<string, string> } {
  const onServer = new Set([
    ...remote.sessions.map((session) => session.id),
    ...remote.tombstones.map((stone) => stone.id),
  ]);
  const byRoot = new Map<string, Session[]>();
  for (const session of remote.sessions) {
    const list = byRoot.get(rootId(session.id)) ?? [];
    list.push(session);
    byRoot.set(rootId(session.id), list);
  }

  const renames = new Map<string, string>();
  const placed = new Set(local.map((session) => session.id));
  const out: Session[] = [];

  for (const session of local) {
    const twin = onServer.has(session.id)
      ? undefined
      : byRoot
          .get(rootId(session.id))
          ?.find((candidate) => candidate.updatedAt >= session.updatedAt);
    if (!twin) {
      out.push(session);
      continue;
    }

    renames.set(session.id, twin.id);
    for (const hand of session.hands) {
      const same = twin.hands.find((theirs) => rootId(theirs.id) === rootId(hand.id));
      if (same && same.id !== hand.id) renames.set(hand.id, same.id);
    }
    // In the copy's place, so the list does not reshuffle under somebody.
    if (!placed.has(twin.id)) {
      placed.add(twin.id);
      out.push(twin);
    }
  }

  return renames.size > 0 ? { sessions: out, renames } : { sessions: local as Session[], renames };
}

/** New ids for a session being adopted, decided before anything is written. */
export interface Adoption {
  readonly sessionId: string;
  /** Old hand id to new, for the hands the session had when it was refused. */
  readonly hands: ReadonlyMap<string, string>;
  /** Every id that moves, sessions and hands together, for whoever held one. */
  readonly renames: ReadonlyMap<string, string>;
}

/**
 * New ids for a session the server refused to take under this account.
 *
 * Hands move with it because they are keyed by their own id with the same
 * owner check, so the old hands would be refused exactly as the session was.
 * `hands` scope is the rarer case - the session's id was free but a hand's
 * was not - where moving the session too would leave an empty one behind on
 * the server to come back down as a phantom game.
 */
export function planAdoption(
  session: Session,
  scope: 'session' | 'hands',
  fresh: (id: string) => string = copyId,
): Adoption {
  const sessionId = scope === 'session' ? fresh(session.id) : session.id;
  const hands = new Map(session.hands.map((hand) => [hand.id, fresh(hand.id)]));
  const renames = new Map(hands);
  if (sessionId !== session.id) renames.set(session.id, sessionId);
  return { sessionId, hands, renames };
}

/**
 * A session under the ids an adoption chose, owned by `owner`.
 *
 * Applied to whatever the session is by the time it runs, not the copy that
 * was refused: somebody may have scored a hand in the meantime, and that hand
 * keeps the fresh id it was born with.
 *
 * Player ids stay, since every hand's deltas and the dealer are keyed by them.
 * `updatedAt` stays too - moving a record is not editing it, and it is what
 * lets `collapseCopies` tell an untouched copy from one played since.
 *
 * A seat linked to anybody but the new owner loses its link. The original
 * still exists under its old owner with those seats, so keeping them would
 * put the same night in a friend's history twice - once from each copy - or
 * be refused outright when the new owner is not their friend. The names stay
 * on the seats; only who can see the game changes.
 */
export function adopt(session: Session, adoption: Adoption, owner: string): Session {
  const moved = adoption.sessionId !== session.id;
  return {
    ...session,
    id: adoption.sessionId,
    syncedAt: null,
    hands: session.hands.map((hand) => {
      const id = adoption.hands.get(hand.id);
      return id ? { ...hand, id } : hand;
    }),
    players: moved
      ? session.players.map((player) =>
          player.accountId && player.accountId !== owner
            ? { ...player, accountId: undefined }
            : player,
        )
      : session.players,
  };
}
