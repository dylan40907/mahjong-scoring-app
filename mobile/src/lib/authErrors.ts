/**
 * Reading what the auth server meant.
 *
 * Split out of `account.ts` so it can be tested: that file imports Apple
 * authentication, the web browser and linking, none of which exist under
 * ts-jest, and this is the one piece of judgement in it.
 */

/**
 * Whether linking failed because that Google or Apple account is already
 * somebody's - usually their own, on their other phone.
 *
 * This is not an edge case, it is the ordinary second-device story: install the
 * app, get an anonymous account, tap the same button you tapped last time.
 * Linking cannot succeed, because the identity belongs to the account already
 * holding your history, and the only useful thing left to do is sign in to it.
 *
 * Matched on the message as well as the code because the code has been renamed
 * once already, and the cost of missing it is somebody who cannot reach their
 * own account from their own phone. Matching too eagerly is much cheaper: the
 * fallback is a sign-in with the same identity, which is what they were asking
 * for either way.
 */
export function identityTaken(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === 'identity_already_exists') return true;
  const message = error.message?.toLowerCase() ?? '';
  return message.includes('already') && (message.includes('linked') || message.includes('exists'));
}

/**
 * Whether attaching an email to this account failed because the address
 * already has an account of its own.
 *
 * Almost always the same person, on the wrong half of the form - they made an
 * account on another phone and tapped "Create account" here. Knowing that is
 * what lets the screen try signing them in instead of showing them the
 * server's sentence about registrations.
 */
export function emailTaken(message: string | null | undefined): boolean {
  const text = message?.toLowerCase() ?? '';
  return text.includes('already') && (text.includes('registered') || text.includes('exists'));
}

/**
 * A failed sign-in, in the words somebody signing in would use.
 *
 * The server's messages are written for developers - "Invalid login
 * credentials" - and the common ones have a plainer version. Anything not
 * recognised is passed through rather than hidden, since an unclear reason is
 * still better than none.
 */
export function signInProblem(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials') || text.includes('invalid credentials')) {
    return 'That email and password do not match.';
  }
  if (text.includes('email not confirmed')) {
    return 'Open the link we emailed you first, then sign in.';
  }
  if (text.includes('rate limit')) return 'Too many tries. Wait a minute and try again.';
  return message;
}
