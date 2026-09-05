import { identityTaken } from '../authErrors';

/**
 * The check that decides whether somebody can reach their own account.
 *
 * Getting it wrong in one direction strands a person on a second phone: they
 * tap the same button they tapped last time, linking is refused because the
 * identity is already theirs, and without this the refusal is shown to them as
 * a dead end. Getting it wrong the other way costs a sign-in with the identity
 * they just chose, which is what they asked for anyway.
 */

describe('an identity that already belongs to somebody', () => {
  it('is recognised by the error code', () => {
    expect(identityTaken({ code: 'identity_already_exists' })).toBe(true);
  });

  it('is recognised by the message, in case the code is renamed again', () => {
    expect(identityTaken({ message: 'Identity is already linked to another user' })).toBe(true);
    expect(identityTaken({ message: 'identity already exists' })).toBe(true);
  });

  it('is not confused with the ordinary failures', () => {
    // These have to fall through to being shown to the person, not silently
    // retried as a sign-in.
    expect(identityTaken({ message: 'Network request failed' })).toBe(false);
    expect(identityTaken({ code: 'validation_failed', message: 'Missing token' })).toBe(false);
    expect(identityTaken({ message: 'User already registered' })).toBe(false);
    expect(identityTaken({})).toBe(false);
  });
});
