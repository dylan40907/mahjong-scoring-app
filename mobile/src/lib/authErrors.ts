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
