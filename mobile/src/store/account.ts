import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { setDefaultPlayerName } from './store';

/**
 * Who is signed in, and what they are called.
 *
 * Everyone has an account from first launch, and almost nobody is asked to
 * make one. Supabase signs a new install in anonymously: a real user id, real
 * rows, real row-level security, and a profile that exists from minute one
 * with nothing to fill in. Signing in with Google or an email later *upgrades
 * the same user*, so no data moves and nothing is lost.
 *
 * That is not only kinder than a registration wall, it is the difference
 * between shipping and not: Apple's guideline 5.1.1(v) forbids requiring
 * registration unless account features are core to the app, and scoring a hand
 * plainly is not. Apps that skip this end up retrofitting a guest
 * path.
 *
 * Everything here fails soft. No backend configured, no network, a rejected
 * sign-in - each leaves `status: 'local'` and an app that works exactly as it
 * did before accounts existed.
 */

export type AccountStatus =
  /** No backend in this build, or we have not reached one yet. */
  | 'local'
  /** Signed in without credentials. Real account, one device. */
  | 'anonymous'
  /** Signed in with an email or a provider. Reaches other devices. */
  | 'identified';

export interface Account {
  readonly status: AccountStatus;
  readonly userId: string | null;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly handle: string | null;
  /** True while a sign-in or profile load is in flight. */
  readonly busy: boolean;
}

const EMPTY: Account = {
  status: 'local',
  userId: null,
  email: null,
  displayName: null,
  handle: null,
  busy: false,
};

let account: Account = EMPTY;
const listeners = new Set<() => void>();

function set(partial: Partial<Account>): void {
  account = { ...account, ...partial };
  // Seat one of the next session, kept current without the store importing
  // any of this.
  setDefaultPlayerName(account.displayName);
  for (const listener of listeners) listener();
}

export function getAccount(): Account {
  return account;
}

export function useAccount<T>(selector: (account: Account) => T): T {
  const read = useCallback(() => selector(account), [selector]);
  return useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    read,
    read,
  );
}

function statusFor(user: { is_anonymous?: boolean; email?: string | null }): AccountStatus {
  return user.is_anonymous ? 'anonymous' : 'identified';
}

/**
 * Get this install an account, without asking anybody anything.
 *
 * Called once at launch. An existing session is reused; otherwise a new
 * anonymous user is created. Being offline is an ordinary outcome, not an
 * error - the app stays local and tries again next launch.
 */
export async function initAccount(): Promise<void> {
  if (!supabase) return;
  set({ busy: true });

  try {
    const { data } = await supabase.auth.getSession();
    let user = data.session?.user ?? null;

    if (!user) {
      const created = await supabase.auth.signInAnonymously();
      if (created.error) {
        // Offline, or anonymous sign-in switched off on the project. Neither is
        // worth interrupting anyone over.
        set({ busy: false });
        return;
      }
      user = created.data.user;
    }
    if (!user) {
      set({ busy: false });
      return;
    }

    set({ status: statusFor(user), userId: user.id, email: user.email ?? null });
    await loadProfile();
  } finally {
    set({ busy: false });
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    if (!user) {
      set(EMPTY);
      return;
    }
    set({ status: statusFor(user), userId: user.id, email: user.email ?? null });
  });
}

async function loadProfile(): Promise<void> {
  if (!supabase || !account.userId) return;
  const { data } = await supabase
    .from('profiles')
    .select('display_name, handle')
    .eq('id', account.userId)
    .maybeSingle();

  if (data) set({ displayName: data.display_name ?? null, handle: data.handle ?? null });
}

/**
 * The name that fills seat one of every new session.
 *
 * Written straight through rather than queued: it is one short string, it is
 * typed deliberately, and a name that silently fails to save is worse than one
 * that reports it could not.
 */
export async function setDisplayName(name: string): Promise<boolean> {
  const trimmed = name.trim();
  set({ displayName: trimmed || null });
  if (!supabase || !account.userId) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: trimmed || null, updated_at: new Date().toISOString() })
    .eq('id', account.userId);
  return !error;
}

/** Claim a handle. Returns why it failed, or null on success. */
export async function setHandle(handle: string): Promise<string | null> {
  const wanted = handle.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(wanted)) {
    return 'Three to twenty characters: letters, numbers and underscores.';
  }
  if (!supabase || !account.userId) return 'Not signed in yet.';

  const { error } = await supabase
    .from('profiles')
    .update({ handle: wanted, updated_at: new Date().toISOString() })
    .eq('id', account.userId);

  // 23505 is the unique violation, which here can only mean the handle is taken.
  if (error) return error.code === '23505' ? 'That name is taken.' : 'Could not save that name.';
  set({ handle: wanted });
  return null;
}

/**
 * Turn the anonymous account into a real one, keeping everything.
 *
 * `updateUser` on an anonymous session attaches credentials to the *same* user
 * id, so every session and hand already stored against it stays exactly where
 * it is. Signing out and signing back in would have stranded all of it.
 */
export async function upgradeWithEmail(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Accounts are unavailable in this build.';
  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) return error.message;
  return null;
}

/** Sign in to an existing account on this device. */
export async function signInWithEmail(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Accounts are unavailable in this build.';
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return error ? error.message : null;
}

/**
 * Delete the account and everything belonging to it.
 *
 * Both stores require this to exist inside the app - Play also wants a public
 * URL that does the same - and it is a listing blocker rather than a nicety.
 *
 * Photographs are cleared first, from the client, because Supabase refuses
 * direct deletes against `storage.objects` from SQL: a function that tried
 * failed with 42501 and took the whole deletion down with it. Everything else
 * cascades from the auth user.
 */
export async function deleteAccount(): Promise<string | null> {
  if (!supabase || !account.userId) return 'Not signed in.';

  try {
    const { data } = await supabase.storage.from('hand-photos').list(account.userId);
    if (data && data.length > 0) {
      await supabase.storage
        .from('hand-photos')
        .remove(data.map((file) => `${account.userId}/${file.name}`));
    }
  } catch {
    // Storage being unreachable must not block deleting the account itself;
    // the objects are orphaned but unreadable once their owner is gone.
  }

  const { error } = await supabase.rpc('delete_own_account');
  if (error) return error.message;

  await supabase.auth.signOut();
  set(EMPTY);
  return null;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
  set(EMPTY);
}
