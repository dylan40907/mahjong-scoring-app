import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CustomRuleSet } from '@/scoring';
import { DEFAULT_SETTINGS, type Session, type Settings, type StoredHand } from './types';
import { pruneTombstones, type Tombstone } from './sync/meta';

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
} as const;

const SCHEMA_VERSION = 2;

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
}> {
  const [sessions, deletedSessions, customRuleSets, settings] = await Promise.all([
    readJson<Session[]>(KEYS.sessions, []),
    readJson<Tombstone[]>(KEYS.deletedSessions, []),
    readJson<CustomRuleSet[]>(KEYS.customRules, []),
    readJson<Settings>(KEYS.settings, DEFAULT_SETTINGS),
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
  };
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

export async function clearAll(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
