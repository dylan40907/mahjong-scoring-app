import { useCallback, useSyncExternalStore } from 'react';
import type { CustomRuleSet, RuleSet } from '@/scoring';
import { BUILT_IN_RULESETS } from '@/scoring';
import type { Wind } from '@/tiles/tileset';
import { loadAll, saveCustomRuleSets, saveSessions, saveSettings } from './persistence';
import {
  DEFAULT_SETTINGS,
  type AppState,
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

/**
 * Ids only have to be unique within one device's storage, so a timestamp with
 * a random suffix is sufficient and avoids a uuid dependency and its crypto
 * polyfill on React Native.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

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
  const players: SessionPlayer[] = input.playerNames.map((name, index) => ({
    id: makeId('p'),
    name: name.trim() || `Player ${index + 1}`,
    seat: SEATS[index] ?? 'east',
  }));

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

function replaceSession(id: string, update: (session: Session) => Session): void {
  const next = state.sessions.map((session) =>
    session.id === id ? { ...update(session), updatedAt: new Date().toISOString() } : session,
  );
  set({ sessions: next });
  void saveSessions(next);
}

export function getSession(id: string): Session | undefined {
  return state.sessions.find((session) => session.id === id);
}

export function addHand(sessionId: string, record: HandRecord): void {
  replaceSession(sessionId, (session) => ({
    ...session,
    hands: [record, ...session.hands],
    // The deal passes unless the dealer won, which is the near-universal rule
    // across all four variants the app supports.
    dealerId: record.winnerId === session.dealerId ? session.dealerId : nextDealer(session),
  }));
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
export function createQuickSession(): Session {
  return createSession({
    name: defaultSessionName(),
    ruleSetId: state.settings.defaultRuleSetId,
    playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
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
  set({ sessions: next });
  void saveSessions(next);
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
