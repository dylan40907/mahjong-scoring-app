import { useCallback, useSyncExternalStore } from 'react';
import { makeId } from '@/lib/ids';
import type { CustomRuleSet, RuleSet } from '@/scoring';
import { BUILT_IN_RULESETS } from '@/scoring';
import type { Wind } from '@/tiles/tileset';
import {
  loadAll,
  saveAwayGames,
  saveCustomRuleSets,
  saveDeletedSessions,
  saveOutbox,
  saveSessions,
  saveParked,
  saveSettings,
  saveSyncOwner,
} from './persistence';
import { mySeat } from './stats';
import { markSynced, pruneTombstones, type SyncOwner, type Tombstone } from './sync/meta';
import { enqueue, type Intent, type QueuedIntent } from './sync/outbox';
import {
  DEFAULT_SETTINGS,
  type AppState,
  type AwayGame,
  type HandRecord,
  type ParkedGames,
  type Session,
  type SessionPlayer,
  type Settings,
} from './types';

/**
 * A hand-rolled observable store.
 *
 * The app has one screenful of shared state and no async server. Reaching for
 * a state library here would add a dependency, a provider, and a set of
 * conventions to learn, in exchange for nothing this file does not already do
 * in fifty lines. `useSyncExternalStore` is the supported React primitive for
 * exactly this and it behaves correctly under concurrent rendering.
 *
 * Writes update memory synchronously and persist in the background: the
 * interface never waits on storage.
 */

let state: AppState = {
  ready: false,
  sessions: [],
  deletedSessions: [],
  parked: {},
  awayGames: [],
  outbox: [],
  customRuleSets: [],
  settings: DEFAULT_SETTINGS,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  emit();
}

/*
 * Something a person did, as opposed to something sync did.
 *
 * Sync listens for these so a change goes to the server as soon as it is made,
 * rather than whenever the app next happens to launch - which left a deleted
 * game showing on a friend's phone for as long as the phone that deleted it
 * stayed open. Only the write paths a person drives call it: scoring,
 * correcting and deleting hands, starting, renaming and deleting sessions,
 * seating somebody, a friend request. Never the ones sync runs itself -
 * `applySync`, rekeying, parking - or every sync would schedule the next.
 */
const editListeners = new Set<() => void>();

export function onLocalEdit(listener: () => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

function edited(): void {
  for (const listener of editListeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AppState {
  return state;
}

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => selector(getSnapshot()), [selector]),
    useCallback(() => selector(getSnapshot()), [selector]),
  );
}

let hydration: Promise<void> | null = null;

/** Load persisted state once. Safe to call from every screen. */
export function hydrate(): Promise<void> {
  if (!hydration) {
    hydration = loadAll().then((loaded) => {
      set({ ...loaded, ready: true });
    });
  }
  return hydration;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Re-exported so the screens that build ids need not know where it moved to. */
export { makeId };

// ---------------------------------------------------------------------------
// Rulesets
// ---------------------------------------------------------------------------

export function allRuleSets(): RuleSet[] {
  return [...BUILT_IN_RULESETS, ...state.customRuleSets];
}

export function findRuleSet(id: string): RuleSet | undefined {
  return allRuleSets().find((rules) => rules.id === id);
}

export function saveCustomRuleSet(rules: CustomRuleSet): void {
  const existing = state.customRuleSets.findIndex((r) => r.id === rules.id);
  const next =
    existing >= 0
      ? state.customRuleSets.map((r, i) => (i === existing ? rules : r))
      : [...state.customRuleSets, rules];
  set({ customRuleSets: next });
  void saveCustomRuleSets(next);
}

export function deleteCustomRuleSet(id: string): void {
  const next = state.customRuleSets.filter((r) => r.id !== id);
  set({ customRuleSets: next });
  void saveCustomRuleSets(next);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SEATS: Wind[] = ['east', 'south', 'west', 'north'];

export function createSession(input: {
  name: string;
  ruleSetId: string;
  playerNames: string[];
}): Session {
  const players: SessionPlayer[] = input.playerNames.map((name, index) => {
    const settled = name.trim() || placeholderFor(index);
    return {
      id: makeId('p'),
      name: settled,
      seat: SEATS[index] ?? 'east',
      // Whichever seat carries our own name is us, and saying so once here is
      // what lets the profile count wins rather than hands, and what lets a
      // friend's copy of this game know which of the four we were. It is the
      // same rule the profile used to have to infer every time it drew a
      // number; making it a fact on the record means renaming the seat later
      // does not silently change who the history belonged to.
      ...(localAccountId && localPlayerName && settled === localPlayerName
        ? { accountId: localAccountId }
        : {}),
    };
  });

  const now = new Date().toISOString();
  const session: Session = {
    id: makeId('s'),
    name: input.name.trim() || 'Session',
    createdAt: now,
    updatedAt: now,
    ruleSetId: input.ruleSetId,
    players,
    roundWind: 'east',
    dealerId: players[0]?.id ?? '',
    hands: [],
  };

  const next = [session, ...state.sessions];
  set({ sessions: next });
  void saveSessions(next);
  edited();
  return session;
}

/**
 * Start a fresh session with the same people round the table.
 *
 * The names are the only thing worth carrying over, and they are the only
 * thing anybody types into this app twice: the same four play again next week
 * and renaming all of them is the one piece of setup the quick-start path
 * cannot skip. Seats keep their order, so whoever dealt first deals first
 * again - the alternative is a silent reshuffle nobody asked for.
 *
 * Scores, hands and the deal deliberately do not come along. This is a new
 * session, not a continuation of the old one, which is what "play again" means
 * when the previous night is already finished and totalled.
 */
export function createSessionLike(source: Session): Session {
  return createSession({
    name: defaultSessionName(),
    ruleSetId: source.ruleSetId,
    playerNames: source.players.map((player) => player.name),
  });
}

function replaceSession(id: string, update: (session: Session) => Session): void {
  const target = currentId(id);
  const next = state.sessions.map((session) =>
    session.id === target ? { ...update(session), updatedAt: new Date().toISOString() } : session,
  );
  set({ sessions: next });
  void saveSessions(next);
  edited();
}

// ---------------------------------------------------------------------------
// Ids that moved
// ---------------------------------------------------------------------------

/**
 * Where a session or a hand went when sync gave it a new id.
 *
 * Sync re-keys records in two cases - a session another account owns on the
 * server, and a stale copy of a game the server already has (`sync/adopt.ts`)
 * - and either can happen while the session is on screen or a hand is half
 * entered against it. Both of those hold the old id: a route parameter, the
 * draft. Without this the session screen says "not found", and a hand saved a
 * moment later is written to a session that is no longer there, which drops it
 * without a word.
 *
 * In memory only. Nothing holds an id across a restart except storage, and
 * storage is rewritten with the new ones.
 */
const moved = new Map<string, string>();

/** The id a record goes by now, following any moves since this one was read. */
export function currentId(id: string): string {
  let at = id;
  // `recordMoves` never leaves a cycle; the bound is a guard, not a limit.
  for (let hop = 0; hop < 16; hop += 1) {
    const next = moved.get(at);
    if (next === undefined) return at;
    at = next;
  }
  return at;
}

function recordMoves(renames: Iterable<readonly [string, string]>): void {
  for (const [from, to] of renames) {
    if (from === to) continue;
    moved.set(from, to);
    // The target is current now, so it forwards nowhere. That is also what
    // stops a game that goes out to another account and comes back from
    // forwarding to itself in a loop.
    moved.delete(to);
  }
}

/** The session an id names, following it if sync has moved it since. */
export function sessionIn(
  sessions: readonly Session[],
  id: string | null | undefined,
): Session | undefined {
  if (!id) return undefined;
  const target = currentId(id);
  return sessions.find((session) => session.id === target);
}

/**
 * The whole state, for tests and for the sync layer.
 *
 * Screens use `useAppState` and re-render; the sync engine needs to read
 * everything once, off the render path, without subscribing to any of it.
 */
/**
 * Replace what sync owns, in one write.
 *
 * The sync engine has already decided which copy of each session wins and
 * which deletes are real, so this is deliberately a wholesale swap rather than
 * a merge - two things reconciling the same records by different rules is how
 * they end up disagreeing.
 */
export function applySync(
  sessions: Session[],
  deletedSessions: Tombstone[],
  renames: ReadonlyMap<string, string> = new Map(),
): void {
  recordMoves(renames);
  set({ sessions, deletedSessions });
}

/**
 * Give one session new ids, keeping everything that has happened to it.
 *
 * Applied to the session as it is now rather than as sync last read it,
 * because sync spends a while on the network and a hand may have been scored
 * in between; `rekey` builds the new version from whichever copy is current.
 *
 * Awaited, unlike every other write here. The caller is about to put the new
 * id on the server, and a copy the server has that this device has forgotten
 * - the app killed between the two - would be adopted a second time on the
 * next sync and the game would arrive twice.
 */
export async function rekeySession(
  id: string,
  rekey: (current: Session) => Session,
  renames: ReadonlyMap<string, string>,
): Promise<Session | undefined> {
  const current = getSession(id);
  if (!current) return undefined;
  const next = rekey(current);
  recordMoves(renames);
  const sessions = state.sessions.map((session) => (session === current ? next : session));
  set({ sessions });
  await saveSessions(sessions);
  return next;
}

/**
 * Record whose server the sessions' `syncedAt` stamps now describe.
 *
 * Only after the sessions it describes are saved: written first and followed
 * by a crash, it would say the switch had been handled when the sessions on
 * disk still said otherwise, and they would never be carried over.
 */
export async function setSyncOwner(owner: SyncOwner): Promise<void> {
  set({ syncOwner: owner });
  await saveSyncOwner(owner);
}

// ---------------------------------------------------------------------------
// Whose games these are
// ---------------------------------------------------------------------------

/**
 * Set an account's games aside, when it signs out.
 *
 * A game belongs to the account that scored it. Signing out used to leave
 * them in the list, and whoever signed in next - a second account on a shared
 * phone - had every one carried over and adopted as their own: an editable
 * copy under the new account, beside the original that still belonged to the
 * first. Two accounts on one phone each ended up owning the other's nights.
 *
 * Aside rather than deleted. They stay exactly as they were - unsynced edits
 * and unsent deletes included - and come back when that account signs in here
 * again (`restoreParkedSessions`). Nothing on them is touched on the way, not
 * `updatedAt` and not `syncedAt`: moving a record is not editing it, and a
 * copy that looked newer than the server's would win the next reconcile and
 * take the server's extra hands down with it.
 *
 * A deleted account's games stay where they are. They follow nobody, which
 * is what `leftBehind` already says.
 *
 * The owner record goes too. What is left in the list was scored with nobody
 * signed in, and belongs to whoever signs in next - the rule `carryOver`
 * applies when it does not know who the device last synced as.
 */
export async function parkSessions(userId: string): Promise<void> {
  await hydrate();
  const leaving = state.sessions.filter((session) => !session.leftBehind);
  const staying = state.sessions.filter((session) => session.leftBehind);
  const parked =
    leaving.length > 0 || state.deletedSessions.length > 0
      ? parkInto(state.parked, userId, leaving, state.deletedSessions)
      : state.parked;
  set({ parked, sessions: staying, deletedSessions: [], syncOwner: undefined });
  await Promise.all([
    saveParked(parked),
    saveSessions(staying),
    saveDeletedSessions([]),
    saveSyncOwner(null),
  ]);
}

/**
 * Set aside some sessions for an account that is not the one signed in.
 *
 * What sync does when it finds the device was last synced as a different real
 * account and nothing set its games aside - a sign-out on a build older than
 * `parkSessions`, or a session that simply expired. Synchronous in memory, so
 * the caller can take the same sessions out of the list in the same tick and
 * nothing renders both.
 */
export function parkSome(userId: string, sessions: readonly Session[]): Promise<void> {
  const parked = parkInto(state.parked, userId, sessions, []);
  set({ parked });
  return saveParked(parked);
}

/**
 * Bring an account's games back when it signs in on this phone again.
 *
 * Merged into what is here rather than replacing it: anything scored while
 * nobody was signed in stays, and is this account's from now on. Their stamps
 * still describe this account's server, so the next sync reconciles them as
 * though nobody had ever signed out.
 */
export async function restoreParkedSessions(userId: string): Promise<void> {
  await hydrate();
  const mine = state.parked[userId];
  if (!mine) return;
  const parked = Object.fromEntries(
    Object.entries(state.parked).filter(([id]) => id !== userId),
  );
  const sessions = mergeSessions(state.sessions, mine.sessions);
  const deletedSessions = mergeTombstones(state.deletedSessions, mine.deletedSessions);
  set({ parked, sessions, deletedSessions });
  await Promise.all([
    saveParked(parked),
    saveSessions(sessions),
    saveDeletedSessions(deletedSessions),
  ]);
}

/**
 * Tie every game on the phone that no account holds to the one signing in.
 *
 * Games scored with no account signed in - as a guest, or after signing out -
 * belong to the first real account that signs in on this phone, and from then
 * on they are its games like any other: synced to it, set aside with it when
 * it signs out, and invisible to every other account. Guest games need nothing
 * done here; they are already in the list, so they go wherever this account's
 * games go. A deleted account's games do: `leftBehind` is what kept them
 * following nobody, so it comes off, and they are marked unsynced - never
 * re-dated, since moving a record is not editing it - so the next sync sends
 * them to their new owner.
 */
export async function claimUnowned(): Promise<void> {
  await hydrate();
  if (!state.sessions.some((session) => session.leftBehind)) return;
  const sessions = state.sessions.map((session) =>
    session.leftBehind ? { ...session, leftBehind: undefined, syncedAt: null } : session,
  );
  set({ sessions });
  await saveSessions(sessions);
}

function parkInto(
  parked: Readonly<Record<string, ParkedGames>>,
  userId: string,
  sessions: readonly Session[],
  deletedSessions: readonly Tombstone[],
): Record<string, ParkedGames> {
  const had = parked[userId];
  return {
    ...parked,
    [userId]: {
      sessions: mergeSessions(had?.sessions ?? [], sessions),
      deletedSessions: mergeTombstones(had?.deletedSessions ?? [], deletedSessions),
    },
  };
}

/** One copy per id, the later edit where there are two. */
function mergeSessions(base: readonly Session[], extra: readonly Session[]): Session[] {
  const byId = new Map(base.map((session) => [session.id, session]));
  for (const session of extra) {
    const had = byId.get(session.id);
    byId.set(session.id, had && had.updatedAt > session.updatedAt ? had : session);
  }
  return [...byId.values()];
}

function mergeTombstones(base: readonly Tombstone[], extra: readonly Tombstone[]): Tombstone[] {
  const seen = new Set(base.map((stone) => stone.id));
  return [...base, ...extra.filter((stone) => !seen.has(stone.id))];
}

/**
 * Keep the games on this device from following it to the next account.
 *
 * For deleting an account, which promises that what was stored with it is
 * gone. The next launch signs a fresh anonymous account in, and without this
 * the first sync would carry every game straight back up under it. Each
 * session is marked as owing nothing to any server, and `leftBehind` keeps
 * `carryOver` away from it; changing one is playing it again, and it syncs
 * from then on like any other.
 */
export function leaveSessionsBehind(): void {
  const sessions = state.sessions.map((session) => ({ ...markSynced(session), leftBehind: true }));
  set({ sessions });
  void saveSessions(sessions);
}

/**
 * Replace the cache of games we played in but did not score.
 *
 * Wholesale, and that is the entire delete story for them: an away game is
 * whatever the server last said we could see, so one that stops coming back -
 * because the owner deleted it, unseated us, or is no longer a friend - simply
 * is not in the next list. There is nothing to tombstone, because we never had
 * a copy anybody else depends on.
 */
export function applyAwayGames(games: AwayGame[]): void {
  set({ awayGames: games });
  void saveAwayGames(games);
}

export function getAwayGame(sessionId: string): AwayGame | undefined {
  return state.awayGames.find((game) => game.session.id === sessionId);
}

/**
 * Forget what belonged to whoever just signed out.
 *
 * The sessions on this device stay: they were scored here, they are the
 * app working the way it did before accounts existed, and taking them away
 * would make signing out a destructive act. What goes is everything that only
 * makes sense against one account - games borrowed from that account's
 * friends, and the queue of things still to tell the server on its behalf.
 */
export function clearAccountScopedState(): void {
  set({ awayGames: [], outbox: [] });
  void saveAwayGames([]);
  void saveOutbox([]);
}

export function getState(): AppState {
  return state;
}

export function getSession(id: string): Session | undefined {
  return sessionIn(state.sessions, id);
}

export function addHand(sessionId: string, record: HandRecord): void {
  replaceSession(sessionId, (session) => {
    // The deal passes unless the dealer won, which is the near-universal rule
    // across all four variants the app supports. Holding it is 連莊, and the
    // count only ever moves here - a hand corrected later must not advance it
    // a second time.
    const held = record.winnerId === session.dealerId;
    return {
      ...session,
      hands: [record, ...session.hands],
      dealerId: held ? session.dealerId : nextDealer(session),
      dealerStreak: held ? (session.dealerStreak ?? 0) + 1 : 0,
    };
  });
}

function nextDealer(session: Session): string {
  const index = session.players.findIndex((p) => p.id === session.dealerId);
  if (index < 0) return session.players[0]?.id ?? '';
  return session.players[(index + 1) % session.players.length].id;
}

/**
 * Replace an existing hand, leaving the deal where it is.
 *
 * Editing a hand that has already been scored is a correction, not a new hand,
 * so the dealer must not pass again - `addHand` rotates it, and running that a
 * second time for the same hand would quietly desynchronise the seat winds from
 * the game being played.
 */
export function updateHand(sessionId: string, record: HandRecord): void {
  // The draft may have opened this hand under an id sync has since moved.
  const id = currentId(record.id);
  replaceSession(sessionId, (session) => ({
    ...session,
    hands: session.hands.map((hand) => (hand.id === id ? { ...record, id } : hand)),
  }));
}

export function deleteHand(sessionId: string, handId: string): void {
  const id = currentId(handId);
  replaceSession(sessionId, (session) => ({
    ...session,
    hands: session.hands.filter((hand) => hand.id !== id),
  }));
}

export function renameSession(sessionId: string, name: string): void {
  replaceSession(sessionId, (session) => ({ ...session, name }));
}

export function renamePlayer(sessionId: string, playerId: string, name: string): void {
  replaceSession(sessionId, (session) => ({
    ...session,
    players: session.players.map((player) =>
      player.id === playerId ? { ...player, name } : player,
    ),
  }));
}

/**
 * Change which rules a session is scored by, and remember the choice.
 *
 * Remembering it is the point: a group plays the same variant every week, and
 * being asked to pick it again each time is the kind of small friction that
 * makes an app feel like paperwork.
 */
export function setSessionRuleSet(sessionId: string, ruleSetId: string): void {
  replaceSession(sessionId, (session) => ({ ...session, ruleSetId }));
  updateSettings({ defaultRuleSetId: ruleSetId });
}

/**
 * A session with nothing to fill in.
 *
 * Starting a game should not open a form. The name is the time you sat down,
 * the players are numbered until somebody bothers to rename them, and the rules
 * are whatever you played last - all of which are visible and one tap to change
 * on the table itself. Nobody has ever wanted to name a mahjong session before
 * playing it.
 */
/**
 * The name to put in seat one, when anything knows it.
 *
 * Pushed in by the account layer rather than pulled out of it: the store is
 * the bottom of the stack and has no business importing auth, which drags a
 * native module through every test that touches a session.
 */
let localPlayerName: string | null = null;
let localAccountId: string | null = null;

export function setLocalIdentity(name: string | null, accountId: string | null): void {
  localPlayerName = name?.trim() || null;
  localAccountId = accountId || null;
}

/** Who this device belongs to, for the parts of the app that need to ask. */
export function localIdentity(): { userId: string | null; displayName: string | null } {
  return { userId: localAccountId, displayName: localPlayerName };
}

export function createQuickSession(): Session {
  return createSession({
    name: defaultSessionName(),
    ruleSetId: state.settings.defaultRuleSetId,
    // Seat one is whoever is holding the phone, when the app knows who that
    // is. It is the one name in four it can already answer, and four names are
    // the only setup starting a session cannot skip.
    playerNames: [localPlayerName || placeholderFor(0), placeholderFor(1), placeholderFor(2), placeholderFor(3)],
  });
}

/** "Thu 29 Aug, 3:25 pm" in the device's own locale and clock. */
export function defaultSessionName(now: Date = new Date()): string {
  const day = now.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

export function deleteSession(requested: string): void {
  // A tombstone naming an id sync has moved away from would delete nothing
  // and leave the session where it was.
  const id = currentId(requested);
  const next = state.sessions.filter((session) => session.id !== id);
  // The row goes, but a note that it went stays behind, so the delete can
  // travel to the other devices instead of looking like a session they have
  // and this one has merely lost.
  const stones = pruneTombstones([
    ...state.deletedSessions.filter((stone) => stone.id !== id),
    { id, deletedAt: new Date().toISOString() },
  ]);
  set({ sessions: next, deletedSessions: stones });
  void saveSessions(next);
  void saveDeletedSessions(stones);
  edited();
}

// ---------------------------------------------------------------------------
// Seats, and the friends sitting in them
// ---------------------------------------------------------------------------

/**
 * Say that a seat at this table is a particular account.
 *
 * The local half of adding a friend to a game. It takes effect at once and
 * offline: the seat is marked and the screen redraws. Nothing is sent, because
 * nothing needs to be - the seat is part of a session this device owns, and
 * the next sync makes the server's copy match. The friend's phone finds out
 * whenever both of them next have a signal, which in a basement is afterwards,
 * and afterwards is fine because nothing about scoring the night depends on
 * it.
 *
 * One account per table. Somebody cannot be two of the four players, and the
 * server's primary key says so too, so moving a friend from one seat to
 * another has to clear the old one rather than leaving them in both.
 */
export function linkSeat(
  sessionId: string,
  playerId: string,
  accountId: string,
  name?: string,
): void {
  replaceSession(sessionId, (session) => {
    const target = session.players.find((player) => player.id === playerId);
    // Adopt their name only over a placeholder. Somebody who typed "Dad"
    // meant "Dad", and having the app quietly replace it with the name on an
    // account is a correction nobody asked for.
    const adopted = name && target && isPlaceholder(target.name) ? name : undefined;

    return {
      ...session,
      players: session.players.map((player, index) => {
        if (player.id === playerId) {
          return { ...player, accountId, name: adopted ?? player.name };
        }
        if (player.accountId !== accountId) return player;
        // Moving somebody to another chair takes their name with them. Left
        // behind, the table shows the same person twice - once in the seat
        // they are in and once in the seat they are not - and the empty one
        // reads as a second player called Wei. Only when the name actually
        // moved, though: a seat whose name was typed keeps it.
        const moved = adopted !== undefined && player.name.trim() === adopted.trim();
        return { ...player, accountId: undefined, name: moved ? placeholderFor(index) : player.name };
      }),
    };
  });
}

/**
 * Say which seat is ours.
 *
 * The same as seating a friend, with one extra seat to clear. Sessions from
 * before seats could be linked identify us by name alone - `mySeat` falls back
 * to the seat carrying our display name - and that seat has no account on it
 * for `linkSeat` to move. Left alone, it would go on saying our name after we
 * had said we were somewhere else.
 *
 * This is also the only way to claim a seat in a game scored before there was
 * an account at all, where every seat is still "Player 1" to "Player 4" and
 * nothing on the record can say which one was us.
 */
export function takeSeat(sessionId: string, playerId: string): void {
  const session = getSession(sessionId);
  if (!session || !localAccountId) return;

  const byName = mySeat(session, localIdentity());
  if (byName && byName.id !== playerId && !byName.accountId) {
    leaveSeat(sessionId, byName.id);
  }
  linkSeat(sessionId, playerId, localAccountId, localPlayerName ?? undefined);
}

/**
 * Say that a seat is not us after all.
 *
 * For the game somebody scored for a table they were not sitting at - the app
 * puts us in seat one of every session it starts, which is right almost every
 * time and wrong for exactly this. The seat goes back to being a placeholder
 * when it carries our name, because otherwise the name fallback in `mySeat`
 * would find it again on the next render and put us straight back in.
 *
 * A friend taken out of a seat keeps their name (`unlinkSeat`): that is about
 * who can see the game, not about who was sitting there.
 */
export function leaveSeat(sessionId: string, playerId: string): void {
  replaceSession(sessionId, (session) => ({
    ...session,
    players: session.players.map((player, index) => {
      if (player.id !== playerId) return player;
      const ours = !!localPlayerName && player.name.trim() === localPlayerName;
      return { ...player, accountId: undefined, name: ours ? placeholderFor(index) : player.name };
    }),
  }));
}

/**
 * Take a friend back out of a game.
 *
 * The seat and everything scored in it stay exactly where they are - they
 * played, and the night happened. What goes is the link, and with it their
 * copy: once the removal reaches the server, the next pull on their phone will
 * not include this session and their cache of it drops.
 *
 * Removing somebody from a game is often removing them from something they
 * should not have seen, so this is the one social action worth being certain
 * about. It is - not because it is sent urgently, but because it is not sent
 * at all: `sync/seats.ts` compares the two copies every time, so every sync
 * from here on tries again until the server agrees.
 */
export function unlinkSeat(sessionId: string, playerId: string): void {
  const session = getSession(sessionId);
  if (!session?.players.find((player) => player.id === playerId)?.accountId) return;

  replaceSession(sessionId, (current) => ({
    ...current,
    players: current.players.map((player) =>
      player.id === playerId ? { ...player, accountId: undefined } : player,
    ),
  }));
}

/** A seat nobody has bothered to name yet. */
function isPlaceholder(name: string): boolean {
  return /^player\s*\d+$/i.test(name.trim());
}

/** What a seat is called until somebody names it, by its place at the table. */
function placeholderFor(index: number): string {
  return `Player ${index + 1}`;
}

// ---------------------------------------------------------------------------
// The outbox
// ---------------------------------------------------------------------------

/**
 * Remember something to tell the server.
 *
 * Every social action goes through here rather than calling Supabase, so all
 * of them behave the same way with no signal: instantly locally, eventually
 * remotely, exactly once. See `sync/outbox.ts`.
 */
export function queueIntent(intent: Intent): void {
  const next = enqueue(state.outbox, intent);
  set({ outbox: next });
  void saveOutbox(next);
  edited();
}

export function applyOutbox(queue: QueuedIntent[]): void {
  set({ outbox: queue });
  void saveOutbox(queue);
}

/** Running totals for every player in a session. */
export function sessionTotals(session: Session): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const player of session.players) totals[player.id] = 0;
  for (const hand of session.hands) {
    for (const [playerId, delta] of Object.entries(hand.deltas)) {
      totals[playerId] = (totals[playerId] ?? 0) + delta;
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function updateSettings(partial: Partial<Settings>): void {
  const next = { ...state.settings, ...partial };
  set({ settings: next });
  void saveSettings(next);
}
