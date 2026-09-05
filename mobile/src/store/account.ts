import { useCallback, useSyncExternalStore } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { identityTaken } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';
import { clearFriends } from './friends';
import { clearAccountScopedState, setLocalIdentity } from './store';

/**
 * Who is signed in, and what they are called.
 *
 * Everyone has an account from first launch, and almost nobody is asked to
 * make one. Supabase signs a new install in anonymously: a real user id, real
 * rows, real row-level security, and a profile that exists from minute one
 * with nothing to fill in. Signing in later *upgrades the same user*, so no
 * data moves and nothing is lost.
 *
 * That last sentence is load-bearing and is easy to get wrong, because the
 * obvious API does the opposite. `signInWithOAuth` and `signInWithIdToken`
 * authenticate somebody - they hand back a session for whichever account owns
 * that Google or Apple identity, which is a *different* account from the
 * anonymous one holding this device's games, friends and handle. Only
 * `linkIdentity` attaches the new identity to the session already in hand: it
 * sends the current access token and asks the server to add to that user
 * rather than to find another one.
 *
 * So every path below links when there is an anonymous session to link to, and
 * only signs in when there is not. The failure is quiet either way - the games
 * are on the device and would be pushed again under the new id - but the
 * friends list, the handle and every seat somebody had been given would be
 * left behind on an account nobody can reach any more.
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

/**
 * Whether the identity should be attached to the session we already have.
 *
 * Anonymous means there is a user id here worth keeping. `local` means we
 * never reached the server, and `identified` means somebody is already signed
 * in properly - linking a second provider to that is a different feature.
 */
function shouldLink(): boolean {
  return account.status === 'anonymous' && !!account.userId;
}


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
  setLocalIdentity(account.displayName, account.userId);
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
      forgetAccountData();
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
  forgetAccountData();
  set(EMPTY);
  return null;
}

/**
 * Sign in with Google.
 *
 * The browser flow rather than the native one-tap sheet. Native Google
 * Sign-In needs an Android OAuth client tied to the release keystore's SHA-1
 * fingerprint, and a native module with it; this needs neither, works on both
 * platforms today, and ships over the air. The nicer sheet is an upgrade to
 * make later, not a reason to have no Google sign-in now.
 *
 * The redirect comes back on the app's own scheme, which any app on the device
 * could in principle claim, so the flow is PKCE: the code that arrives is
 * worthless without the verifier this client kept to itself.
 *
 * `linkIdentity` rather than `signInWithOAuth` whenever there is an anonymous
 * account to keep, because the two do genuinely different things and only one
 * of them keeps this device's history. See the note at the top of this file.
 */
export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return 'Accounts are unavailable in this build.';

  const failure = await googleFlow(shouldLink());
  // Linking is refused after the redirect rather than before it, because only
  // the server can see whose the identity is - so the retry costs a second
  // sheet. Worth it: the alternative is telling somebody their own account is
  // unreachable from their own phone.
  if (failure?.retryAsSignIn) return (await googleFlow(false))?.message ?? null;
  if (failure) return failure.message;

  await loadProfile();
  return null;
}

interface GoogleFailure {
  readonly message: string | null;
  readonly retryAsSignIn?: boolean;
}

async function googleFlow(link: boolean): Promise<GoogleFailure | null> {
  if (!supabase) return { message: 'Accounts are unavailable in this build.' };
  const redirectTo = Linking.createURL('auth/callback');
  const options = { redirectTo, skipBrowserRedirect: true };

  const { data, error } = link
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options });
  if (error && link && identityTaken(error)) return { message: null, retryAsSignIn: true };
  if (error || !data?.url) return { message: error?.message ?? 'Could not reach Google.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  // Dismissing the sheet is a decision, not a failure, and should not raise
  // anything at the person who made it.
  if (result.type !== 'success') return { message: null };

  const code = new URL(result.url).searchParams.get('code');
  if (!code) return { message: 'Google did not return a sign-in code.' };

  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) {
    if (link && identityTaken(exchanged.error)) return { message: null, retryAsSignIn: true };
    return { message: exchanged.error.message };
  }
  return null;
}

/** Whether to offer the Apple button at all. */
export function isAppleSignInAvailable(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Sign in with Apple.
 *
 * Required rather than optional: App Store guideline 4.8 says an app offering
 * a third-party sign-in has to offer this one too, and Tile Tally offers
 * Google. It is also the better button on an iPhone - the sheet is native,
 * there is no browser, and Apple will hide the address behind a relay if the
 * person wants that.
 *
 * The native flow hands back an identity token signed by Apple, which the
 * server verifies against Apple's public keys, so there is no Services ID, no
 * private key and no web redirect anywhere in this path. What the server does
 * need is the bundle id registered as an allowed client, because that is the
 * token's audience and the only thing tying it to this app.
 *
 * The name is the awkward part and the reason for the `fullName` handling
 * below. Apple sends it exactly once, on the very first authorisation, and
 * never again - not on a second sign-in, not on another device. A name that is
 * not captured here is gone for good, so it is written to the profile
 * immediately rather than being read back from the session later.
 */
export async function signInWithApple(): Promise<string | null> {
  if (!supabase) return 'Accounts are unavailable in this build.';
  if (!isAppleSignInAvailable()) return 'Apple sign-in needs an iPhone or iPad.';

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    // Cancelling is a decision, not a failure, and should not raise anything
    // at the person who made it.
    const code = (error as { code?: string }).code;
    return code === 'ERR_REQUEST_CANCELED' ? null : 'Could not reach Apple.';
  }

  const token = credential.identityToken;
  if (!token) return 'Apple did not return a sign-in token.';

  let failed = shouldLink()
    ? (await supabase.auth.linkIdentity({ provider: 'apple', token })).error
    : (await supabase.auth.signInWithIdToken({ provider: 'apple', token })).error;

  // Already somebody's Apple account - almost always their own, on another
  // phone. The token is still in hand here, so signing in with it costs
  // nothing and no second prompt.
  if (failed && identityTaken(failed)) {
    failed = (await supabase.auth.signInWithIdToken({ provider: 'apple', token })).error;
  }
  if (failed) return failed.message;

  // Only ever offered once by Apple, so it is saved before anything else can
  // go wrong, and only when we do not already have something better.
  const given = credential.fullName?.givenName?.trim();
  if (given && !account.displayName) await setDisplayName(given);

  await loadProfile();
  return null;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
  forgetAccountData();
  set(EMPTY);
}

/**
 * Everything on this device that belonged to the account, and nothing else.
 *
 * Two people share a phone more often than anybody plans for. The friends
 * list, the games borrowed from those friends and the queue of things still to
 * tell the server are all meaningless - and in the first two cases nobody
 * else's business - once that account is gone.
 *
 * The sessions scored here stay. They were typed on this phone, they work with
 * no account at all, and making signing out delete them would be the one
 * destructive thing in the app nobody asked for.
 */
function forgetAccountData(): void {
  clearFriends();
  clearAccountScopedState();
}
