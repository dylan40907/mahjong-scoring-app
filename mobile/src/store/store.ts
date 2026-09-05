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
  saveSettings,
} from './persistence';
import { pruneTombstones, type Tombstone } from './sync/meta';
import { enqueue, type Intent, type QueuedIntent } from './sync/outbox';
import {
  DEFAULT_SETTINGS,
  type AppState,
  type AwayGame,
  type HandRecord,
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
    const settled = name.trim() || `Player ${index + 1}`;
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
  const next = state.sessions.map((session) =>
    session.id === id ? { ...update(session), updatedAt: new Date().toISOString() } : session,
  );
  set({ sessions: next });
  void saveSessions(next);
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
export function applySync(sessions: Session[], deletedSessions: Tombstone[]): void {
  set({ sessions, deletedSessions });
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
  return state.sessions.find((session) => session.id === id);
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
  replaceSession(sessionId, (session) => ({
    ...session,
    hands: session.hands.map((hand) => (hand.id === record.id ? record : hand)),
  }));
}

export function deleteHand(sessionId: string, handId: string): void {
  replaceSession(sessionId, (session) => ({
    ...session,
    hands: session.hands.filter((hand) => hand.id !== handId),
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
    playerNames: [localPlayerName || 'Player 1', 'Player 2', 'Player 3', 'Player 4'],
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

export function deleteSession(id: string): void {
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
  replaceSession(sessionId, (session) => ({
    ...session,
    players: session.players.map((player) => {
      if (player.id === playerId) {
        return {
          ...player,
          accountId,
          // Adopt their name only over a placeholder. Somebody who typed
          // "Dad" meant "Dad", and having the app quietly replace it with the
          // name on an account is a correction nobody asked for.
          name: name && isPlaceholder(player.name) ? name : player.name,
        };
      }
      return player.accountId === accountId ? { ...player, accountId: undefined } : player;
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
