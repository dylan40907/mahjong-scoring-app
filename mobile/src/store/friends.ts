import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { getAccount } from './account';
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
 * Every action here is optimistic and queued. That is not an optimisation - it
 * is the difference between a feature that works at a mahjong table and one
 * that does not, because the table is in somebody's basement and seating a
 * friend in tonight's game has to be a thing you can do there. The list itself
 * is cached on the device for the same reason: choosing a friend from a list
 * that will not load is not choosing anything.
 */

export type FriendStatus = 'accepted' | 'pending';
export type FriendDirection = 'in' | 'out';

export interface Friend {
  readonly id: string;
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly status: FriendStatus;
  /** 'out' when we asked, 'in' when they did. Meaningless once accepted. */
  readonly direction: FriendDirection;
  /**
   * True while this exists only on this device.
   *
   * A request typed offline has no account id to hang on yet, so it is held
   * under the handle that was typed and shown as pending. The next refresh
   * replaces it with the real row, or - if the handle was nobody - drops it.
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
  if (!supabase || !getAccount().userId) return;
  set({ busy: true });
  try {
    const { data, error } = await supabase.rpc('friend_list');
    if (error || !data) return;
    commit(
      (data as RawFriend[])
        .filter((row) => row.status === 'accepted' || row.status === 'pending')
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
 * Ask somebody to be a friend, by the handle they would say out loud.
 *
 * A handle rather than an email address, because it is the thing you can read
 * off somebody's phone across a table, and because an email address is a fact
 * about a person this app has no business being a directory of.
 */
export function requestFriend(handle: string): void {
  const wanted = handle.trim().toLowerCase();
  if (!wanted) return;
  if (!state.friends.some((friend) => friend.handle === wanted)) {
    commit([
      ...state.friends,
      {
        id: `pending:${wanted}`,
        displayName: null,
        handle: wanted,
        status: 'pending',
        direction: 'out',
        local: true,
      },
    ]);
  }
  queueIntent({ kind: 'friend:request', handle: wanted });
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

export function blockUser(userId: string): void {
  commit(state.friends.filter((friend) => friend.id !== userId));
  if (userId.startsWith('pending:')) return;
  queueIntent({ kind: 'friend:block', userId });
}

/** Wipe on sign-out. Somebody else's friends must not appear on this screen. */
export function clearFriends(): void {
  commit([]);
}

/** A friend by account id, for putting a name to a seat or a shared game. */
export function friendById(
  friends: readonly Friend[],
  userId: string | null | undefined,
): Friend | undefined {
  if (!userId) return undefined;
  return friends.find((friend) => friend.id === userId);
}
