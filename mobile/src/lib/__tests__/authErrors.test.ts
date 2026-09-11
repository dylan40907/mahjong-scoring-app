import { emailTaken, identityTaken, signInProblem } from '../authErrors';

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

describe('an email that already has an account', () => {
  it('is recognised from the server sentence', () => {
    expect(emailTaken('A user with this email address has already been registered')).toBe(true);
    expect(emailTaken('Email address already exists')).toBe(true);
  });

  it('is not confused with a weak password or a bad address', () => {
    expect(emailTaken('Password should be at least 6 characters')).toBe(false);
    expect(emailTaken('Unable to validate email address: invalid format')).toBe(false);
    expect(emailTaken(null)).toBe(false);
  });
});

describe('a failed sign-in', () => {
  it('says a wrong password plainly', () => {
    expect(signInProblem('Invalid login credentials')).toBe('That email and password do not match.');
  });

  it('points an unconfirmed address at its email', () => {
    expect(signInProblem('Email not confirmed')).toMatch(/link we emailed/);
  });

  it('passes through anything it does not recognise', () => {
    expect(signInProblem('Something new')).toBe('Something new');
  });
});
