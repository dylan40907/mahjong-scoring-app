import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import type { Breakdown } from '@/scoring';
import { loadFriends, saveFriends } from './persistence';
import { queueIntent } from './store';

/**
 * The friends list, and the four things you can do with it.
 *
 * Kept apart from the account store because it is a list rather than an
 * identity, and apart from the app store because the app store is the bottom
 * of the stack and must not import auth. It behaves like both of them: an
 * observable read through `useFriends`, and actions that take effect locally
 * before anything is sent.
 *
 * It imports neither, and that is on purpose in one direction: the account
 * layer has to be able to empty this list when somebody signs out, and if this
 * file reached back for `getAccount()` that would be a cycle. Not knowing who
 * is signed in costs nothing here - an unauthenticated request comes back as
 * an error and is handled the same way as being offline.
 *
 * Every action here is optimistic and queued. That is not an optimisation - it
 * is the difference between a feature that works at a mahjong table and one
 * that does not, because the table is in somebody's basement and seating a
 * friend in tonight's game has to be a thing you can do there. The list itself
 * is cached on the device for the same reason: choosing a friend from a list
 * that will not load is not choosing anything.
 */

/**
 * `blocked` is only ever a block *we* made. The server never says when
 * somebody has blocked us, so there is no status for it.
 */
export type FriendStatus = 'accepted' | 'pending' | 'blocked';
export type FriendDirection = 'in' | 'out';

export interface Friend {
  readonly id: string;
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly status: FriendStatus;
  /** 'out' when we asked, 'in' when they did. Meaningless once accepted. */
  readonly direction: FriendDirection;
  /**
   * True while this exists only on this device - a request or an answer that
   * has not reached the server yet. The next refresh replaces it with the real
   * row, or drops it if the server refused.
   *
   * Older builds held an offline request under `pending:<username>` because
   * it was addressed by name; those ids still turn up in cached lists, and
   * `removeFriend` knows not to send them anywhere.
   */
  readonly local?: boolean;
}

export interface FriendsState {
  readonly friends: Friend[];
  readonly loaded: boolean;
  readonly busy: boolean;
}

let state: FriendsState = { friends: [], loaded: false, busy: false };
const listeners = new Set<() => void>();

function set(partial: Partial<FriendsState>): void {
  state = { ...state, ...partial };
  for (const listener of listeners) listener();
}

function commit(friends: Friend[]): void {
  set({ friends });
  void saveFriends(friends);
}

export function getFriendsState(): FriendsState {
  return state;
}

export function useFriends<T>(selector: (state: FriendsState) => T): T {
  const read = useCallback(() => selector(state), [selector]);
  return useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    read,
    read,
  );
}

const byName = (a: Friend, b: Friend) =>
  (a.displayName ?? a.handle ?? '').localeCompare(b.displayName ?? b.handle ?? '');

/** Friends proper, ready to be seated at a table. */
export function acceptedFriends(friends: readonly Friend[]): Friend[] {
  return friends.filter((friend) => friend.status === 'accepted').sort(byName);
}

/** Requests waiting on an answer from us. The only ones worth a badge. */
export function incomingRequests(friends: readonly Friend[]): Friend[] {
  return friends.filter((f) => f.status === 'pending' && f.direction === 'in').sort(byName);
}

/** Requests we have sent and nobody has answered. */
export function outgoingRequests(friends: readonly Friend[]): Friend[] {
  return friends.filter((f) => f.status === 'pending' && f.direction === 'out').sort(byName);
}

/** People we have blocked, for the one place a block can be undone. */
export function blockedUsers(friends: readonly Friend[]): Friend[] {
  return friends.filter((f) => f.status === 'blocked').sort(byName);
}

/** Read the cached list, so the first paint has something in it. */
export async function hydrateFriends(): Promise<void> {
  if (state.loaded) return;
  const cached = await loadFriends<Friend[]>([]);
  set({ friends: Array.isArray(cached) ? cached : [], loaded: true });
}

interface RawFriend {
  id: string;
  display_name: string | null;
  handle: string | null;
  status: string;
  direction: string;
}

/**
 * Fetch the real list.
 *
 * Replaces what is here wholesale, optimistic entries included - the server
 * has just said what is true, and a local guess that survived it would be a
 * friend request living on one phone forever. It runs after the outbox has
 * drained, so anything typed offline is already on the server by the time its
 * answer comes back.
 */
export async function refreshFriends(): Promise<void> {
  if (!supabase) return;
  set({ busy: true });
  try {
    const { data, error } = await supabase.rpc('friend_list');
    if (error || !data) return;
    commit(
      (data as RawFriend[])
        .filter(
          (row) =>
            row.status === 'accepted' ||
            row.status === 'pending' ||
            // Ours only; an inbound block is never sent, and this is belt and
            // braces against a server that one day does.
            (row.status === 'blocked' && row.direction === 'out'),
        )
        .map((row) => ({
          id: row.id,
          displayName: row.display_name,
          handle: row.handle,
          status: row.status as FriendStatus,
          direction: row.direction as FriendDirection,
        })),
    );
  } finally {
    set({ busy: false });
  }
}

/**
 * Send somebody a friend request, from their profile.
 *
 * By account id, never by username. The request can sit in the queue for as
 * long as the phone has no signal, and a username can change in that time: a
 * request addressed by name would then reach nobody, or reach whoever claimed
 * the name next. The id is the one thing about a person that does not move.
 *
 * The optimistic entry carries the real id for the same reason. It used to be
 * keyed by the username typed, which is how a rename left a pending request
 * nobody could match to anyone.
 */
export function requestFriend(person: {
  id: string;
  handle: string | null;
  displayName: string | null;
}): void {
  if (!state.friends.some((friend) => friend.id === person.id)) {
    commit([
      ...state.friends,
      {
        id: person.id,
        displayName: person.displayName,
        handle: person.handle,
        status: 'pending',
        direction: 'out',
        local: true,
      },
    ]);
  }
  queueIntent({ kind: 'friend:request', handle: person.handle ?? '', userId: person.id });
}

export function acceptFriend(userId: string): void {
  commit(
    state.friends.map((friend) =>
      friend.id === userId ? { ...friend, status: 'accepted', local: true } : friend,
    ),
  );
  queueIntent({ kind: 'friend:accept', userId });
}

/**
 * End it, turn it down, or take it back.
 *
 * One action for all three, because from here they are the same thing: the
 * pair of rows goes, and so do the seats each of us holds in the other's
 * games. A friendship that ends has to take that access with it, or "remove
 * friend" quietly keeps sharing every game they were ever in.
 */
export function removeFriend(userId: string): void {
  commit(state.friends.filter((friend) => friend.id !== userId));
  // A request that never left this device has no row anywhere to delete.
  if (userId.startsWith('pending:')) return;
  queueIntent({ kind: 'friend:remove', userId });
}

/**
 * Block somebody: the friendship ends, and they can no longer find you.
 *
 * Kept in the list marked blocked rather than dropped, which is what it used
 * to do - so the block went on working and could never be seen again, let
 * alone undone. It now waits at the bottom of the friends screen with an
 * Unblock beside it.
 */
export function blockUser(userId: string): void {
  if (userId.startsWith('pending:')) {
    commit(state.friends.filter((friend) => friend.id !== userId));
    return;
  }
  commit(
    state.friends.map((friend) =>
      friend.id === userId ? { ...friend, status: 'blocked', local: true } : friend,
    ),
  );
  queueIntent({ kind: 'friend:block', userId });
}

/**
 * Lift a block. Not a restore: the friendship stays ended, and either of you
 * can send a new request now that you can find each other again.
 */
export function unblockUser(userId: string): void {
  commit(state.friends.filter((friend) => friend.id !== userId));
  queueIntent({ kind: 'friend:unblock', userId });
}

/**
 * Wipe on sign-out.
 *
 * Two people share a phone more often than anybody plans for, and a list of
 * somebody else's friends surviving a sign-out is both a small privacy failure
 * and a way to seat the wrong person in a game.
 */
export function clearFriends(): void {
  set({ friends: [], loaded: true });
  void saveFriends([]);
}

/** A friend by account id, for putting a name to a seat or a shared game. */
export function friendById(
  friends: readonly Friend[],
  userId: string | null | undefined,
): Friend | undefined {
  if (!userId) return undefined;
  return friends.find((friend) => friend.id === userId);
}

/**
 * Somebody's profile, by the username somebody typed.
 *
 * Goes through a function on the server rather than reading `profiles`
 * directly, and that is the privacy design rather than an implementation
 * detail: a read policy permissive enough to show a stranger's profile is also
 * permissive enough to hand over every profile at once. An exact name answers
 * the person looking for a friend and nothing to the person enumerating.
 *
 * A private profile answers as though it does not exist, which is what private
 * means here - unfindable, and so unrequestable.
 */
export interface PublicProfile {
  readonly id: string;
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly stats: ProfileStats;
  readonly isPrivate: boolean;
  readonly friendCount: number;
  /** How we stand with them, so the screen knows which button to offer. */
  readonly relation: 'self' | 'friend' | 'requested' | 'incoming' | 'none';
}

export interface ProfileStats {
  readonly handsWon?: number;
  readonly handsPlayed?: number;
  readonly sessions?: number;
  readonly net?: number;
  readonly best?: {
    readonly total: number;
    readonly unit: string;
    readonly patterns: string[];
    readonly tiles: string[];
    /** The hand as it scored, one group per set. Absent from older builds. */
    readonly groups?: string[][] | null;
    /** 'Limit hand', 'Mangan', ... when a ceiling set what it paid. */
    readonly limitName?: string | null;
    /**
     * Line by line, worked out on its owner's phone - where the ruleset it was
     * scored under lives. A viewer may not have that ruleset at all, so this
     * cannot be worked out on their side. Absent from older builds.
     */
    readonly breakdown?: Breakdown | null;
    readonly ruleSetId: string;
    readonly at: string;
  } | null;
}

interface RawProfile {
  id: string;
  display_name: string | null;
  handle: string | null;
  stats: ProfileStats | null;
  is_private: boolean;
  friend_count: number;
  relation: string;
}

function toProfile(row: RawProfile): PublicProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    handle: row.handle,
    stats: row.stats ?? {},
    isPrivate: !!row.is_private,
    friendCount: row.friend_count ?? 0,
    relation: (row.relation ?? 'none') as PublicProfile['relation'],
  };
}

export async function lookupProfile(handle: string): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('view_profile', { lookup: handle.trim().toLowerCase() });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return toProfile(data[0] as RawProfile);
}

/**
 * Somebody's profile, by the account id we already hold for them.
 *
 * What the friends list opens a friend with. Their username in the cached list
 * can be out of date - they renamed since the last sync - and opening by that
 * name would show "nobody by that name", or somebody else entirely if the old
 * name has been taken since. The same visibility rules as the lookup by name.
 */
export async function lookupProfileById(id: string): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('view_profile_by_id', { target: id });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return toProfile(data[0] as RawProfile);
}

/** One person a search turned up. Deliberately thin - see `search_profiles`. */
export interface SearchResult {
  readonly handle: string;
  readonly displayName: string | null;
  readonly relation: 'friend' | 'requested' | 'incoming' | 'none';
}

export type SearchOutcome =
  | { readonly kind: 'results'; readonly results: SearchResult[] }
  /** The hourly allowance is spent. A person almost never sees this. */
  | { readonly kind: 'limited' }
  | { readonly kind: 'offline' };

/** The shortest query the server will answer. One letter is browsing. */
export const MIN_SEARCH = 2;

/**
 * People whose username, or any word of whose name, starts with `query`.
 *
 * Search replaced exact lookup as the way in because usernames here are made
 * for people from the front of an email address, so the friend you are looking
 * for does not know theirs either. What keeps it from being a directory lives
 * on the server: real accounts only, private profiles never, eight results,
 * and an hourly quota. The app does not repeat those rules; it would only be
 * a second copy to fall out of step.
 */
export async function searchProfiles(query: string): Promise<SearchOutcome> {
  if (!supabase) return { kind: 'offline' };
  const { data, error } = await supabase.rpc('search_profiles', { query });
  if (error) {
    // `PT429` is the quota; anything else is the network or a server that is
    // behind, and neither is worth more words than "try again".
    return error.code === 'PT429' ? { kind: 'limited' } : { kind: 'offline' };
  }
  const rows = Array.isArray(data)
    ? (data as { handle: string; display_name: string | null; relation: string }[])
    : [];
  return {
    kind: 'results',
    results: rows.map((row) => ({
      handle: row.handle,
      displayName: row.display_name,
      relation: (row.relation ?? 'none') as SearchResult['relation'],
    })),
  };
}

/**
 * Would the server still return this result for a longer query?
 *
 * The same rule `search_profiles` applies, so that results already on screen
 * can be narrowed as somebody keeps typing instead of blanking until the next
 * answer arrives. Only ever narrows: anything new still has to come from the
 * server.
 */
export function stillMatches(result: SearchResult, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (result.handle.startsWith(q)) return true;
  return ` ${(result.displayName ?? '').toLowerCase()}`.includes(` ${q}`);
}
