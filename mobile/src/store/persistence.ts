import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CustomRuleSet } from '@/scoring';
import {
  DEFAULT_SETTINGS,
  type AwayGame,
  type Session,
  type Settings,
  type StoredHand,
  ParkedGames,
} from './types';
import { pruneTombstones, type SyncOwner, type Tombstone } from './sync/meta';
import type { QueuedIntent } from './sync/outbox';

/**
 * Persistence.
 *
 * AsyncStorage rather than SQLite on purpose: a session is a few dozen hands,
 * the whole dataset is kilobytes, and AsyncStorage behaves identically on iOS,
 * Android and web. That last point is what makes the app testable in a browser
 * without a device attached.
 *
 * Every read is defensive. Stored data outlives the code that wrote it, and a
 * single malformed record should cost the user one session, not the app.
 */

const KEYS = {
  version: 'mj.schemaVersion',
  sessions: 'mj.sessions',
  deletedSessions: 'mj.deletedSessions',
  customRules: 'mj.customRuleSets',
  settings: 'mj.settings',
  awayGames: 'mj.awayGames',
  outbox: 'mj.outbox',
  friends: 'mj.friends',
  syncOwner: 'mj.syncOwner',
  parked: 'mj.parked',
} as const;

const SCHEMA_VERSION = 3;

/**
 * Bring a hand written by an older build forward.
 *
 * Version 1 stored the melds the player had drawn by hand. The scorer works
 * the grouping out for itself now and only wants to know which tiles were on
 * the table, so the old groups flatten into one bag and nothing is lost - the
 * boundaries between them were never information the engine could trust.
 */
function migrateHand(hand: StoredHand): StoredHand {
  if (hand.exposed) return hand;
  const exposed = (hand.melds ?? []).flatMap((meld) => [...meld.tiles]);
  return { ...hand, exposed, melds: undefined };
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    // A corrupt value is discarded rather than propagated. Losing a preference
    // is recoverable; failing to start is not.
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage being full or unavailable must not take down the interaction
    // that triggered the write. The in-memory state stays correct either way.
  }
}

export async function loadAll(): Promise<{
  sessions: Session[];
  deletedSessions: Tombstone[];
  customRuleSets: CustomRuleSet[];
  settings: Settings;
  awayGames: AwayGame[];
  outbox: QueuedIntent[];
  syncOwner?: SyncOwner;
  parked: Record<string, ParkedGames>;
}> {
  const [sessions, deletedSessions, customRuleSets, settings, awayGames, outbox, syncOwner, parked] =
    await Promise.all([
      readJson<Session[]>(KEYS.sessions, []),
      readJson<Tombstone[]>(KEYS.deletedSessions, []),
      readJson<CustomRuleSet[]>(KEYS.customRules, []),
      readJson<Settings>(KEYS.settings, DEFAULT_SETTINGS),
      // Kept across launches so a friend's game is still there on a train.
      // It is a cache of the server's copy, so nothing is lost if it is not.
      readJson<AwayGame[]>(KEYS.awayGames, []),
      readJson<QueuedIntent[]>(KEYS.outbox, []),
      readJson<SyncOwner | null>(KEYS.syncOwner, null),
      readJson<Record<string, ParkedGames>>(KEYS.parked, {}),
    ]);

  await writeJson(KEYS.version, SCHEMA_VERSION);

  return {
    sessions: Array.isArray(sessions)
      ? sessions.filter(isPlausibleSession).map((session) => ({
          ...session,
          hands: session.hands.map((record) => ({ ...record, hand: migrateHand(record.hand) })),
        }))
      : [],
    deletedSessions: Array.isArray(deletedSessions) ? pruneTombstones(deletedSessions) : [],
    customRuleSets: Array.isArray(customRuleSets) ? customRuleSets : [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    awayGames: Array.isArray(awayGames)
      ? awayGames.filter((game) => isPlausibleSession(game?.session))
      : [],
    outbox: Array.isArray(outbox) ? outbox.filter((queued) => !!queued?.intent) : [],
    // Unreadable reads as absent, which `carryOver` treats as "could have been
    // anybody": the safe direction, since it pushes rather than strands.
    syncOwner:
      typeof syncOwner?.userId === 'string'
        ? { userId: syncOwner.userId, anonymous: !!syncOwner.anonymous }
        : undefined,
    parked: plausibleParked(parked),
  };
}

/**
 * Each account's set-aside games, with anything unreadable dropped per record
 * rather than per account - one bad session should cost that session, not
 * every game somebody signed out with.
 */
function plausibleParked(value: unknown): Record<string, ParkedGames> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, ParkedGames> = {};
  for (const [userId, games] of Object.entries(value as Record<string, Partial<ParkedGames>>)) {
    const sessions = Array.isArray(games?.sessions) ? games.sessions.filter(isPlausibleSession) : [];
    const deletedSessions = Array.isArray(games?.deletedSessions) ? games.deletedSessions : [];
    if (sessions.length > 0 || deletedSessions.length > 0) {
      out[userId] = {
        sessions: sessions.map((session) => ({
          ...session,
          hands: session.hands.map((record) => ({ ...record, hand: migrateHand(record.hand) })),
        })),
        deletedSessions,
      };
    }
  }
  return out;
}

function isPlausibleSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<Session>;
  return (
    typeof session.id === 'string' &&
    typeof session.ruleSetId === 'string' &&
    Array.isArray(session.players) &&
    Array.isArray(session.hands)
  );
}

export const saveSessions = (sessions: Session[]) => writeJson(KEYS.sessions, sessions);
export const saveDeletedSessions = (stones: Tombstone[]) =>
  writeJson(KEYS.deletedSessions, stones);
export const saveCustomRuleSets = (rules: CustomRuleSet[]) => writeJson(KEYS.customRules, rules);
export const saveSettings = (settings: Settings) => writeJson(KEYS.settings, settings);
export const saveAwayGames = (games: AwayGame[]) => writeJson(KEYS.awayGames, games);
export const saveOutbox = (queue: QueuedIntent[]) => writeJson(KEYS.outbox, queue);
export const saveSyncOwner = (owner: SyncOwner | null) => writeJson(KEYS.syncOwner, owner);
export const saveParked = (parked: Readonly<Record<string, ParkedGames>>) =>
  writeJson(KEYS.parked, parked);

/**
 * The friends list, cached.
 *
 * Kept on the device so that seating somebody in tonight's game works in a
 * basement. Without it the one social action that has to happen *during* a
 * game - "put Wei in seat three" - would be the one that needs a signal.
 */
export const saveFriends = (friends: unknown) => writeJson(KEYS.friends, friends);
export const loadFriends = <T,>(fallback: T) => readJson<T>(KEYS.friends, fallback);

export async function clearAll(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
