/**
 * Prove that one account cannot read another's data.
 *
 * Row-level security is the entire security model here - there is no server
 * code between the app and the database, so a missing policy is not a bug that
 * shows up as an error, it is a bug that shows up as somebody else's sessions
 * appearing in your history. That failure is silent and total, which is
 * exactly the kind worth a script that can be re-run after any schema change.
 *
 * Signs in two throwaway anonymous users, has one write a session, and checks
 * the other cannot see it. Run against the real project:
 *
 *   node supabase/verify-rls.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_KEY from the environment, falling back to
 * the values baked into the app, since the publishable key is public by design.
 */

const URL_ = process.env.SUPABASE_URL ?? 'https://your-project-ref.supabase.co';
const KEY = process.env.SUPABASE_KEY ?? 'your-publishable-key';

let failures = 0;

function check(name, passed, detail = '') {
  const mark = passed ? 'ok  ' : 'FAIL';
  if (!passed) failures += 1;
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function anonUser() {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`anonymous sign-in failed: ${JSON.stringify(body)}`);
  return { id: body.user.id, token: body.access_token };
}

function rest(user) {
  return async (path, init = {}) => {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${user.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const a = await anonUser();
const b = await anonUser();
const asA = rest(a);
const asB = rest(b);
const sessionId = `s_verify_${Date.now()}`;

console.log(`\nTwo anonymous users: ${a.id.slice(0, 8)}… and ${b.id.slice(0, 8)}…\n`);

// The signup trigger should have made a profile without anyone asking.
const ownProfile = await asA(`profiles?select=id&id=eq.${a.id}`);
check('a profile row exists on sign-up', ownProfile.body?.length === 1);

// A writes a session.
const written = await asA('sessions', {
  method: 'POST',
  body: JSON.stringify({
    id: sessionId,
    owner_id: a.id,
    name: 'RLS check',
    ruleset_id: 'taiwanese-common',
    players: [{ id: 'p1', name: 'Ada', seat: 'east' }],
    updated_at: new Date().toISOString(),
  }),
});
check('owner can write a session', written.status === 201, `status ${written.status}`);

// A reads it back.
const mine = await asA(`sessions?select=id&id=eq.${sessionId}`);
check('owner can read it back', mine.body?.length === 1);

// B must not see it.
const theirs = await asB(`sessions?select=id&id=eq.${sessionId}`);
check('a stranger cannot read it', theirs.body?.length === 0, `saw ${theirs.body?.length ?? '?'} rows`);

// B must not be able to claim it either.
const stolen = await asB('sessions', {
  method: 'POST',
  body: JSON.stringify({
    id: `s_steal_${Date.now()}`,
    owner_id: a.id,
    ruleset_id: 'taiwanese-common',
    updated_at: new Date().toISOString(),
  }),
});
check('a stranger cannot write rows owned by someone else', stolen.status >= 400, `status ${stolen.status}`);

// B must not see A's profile.
const peeked = await asB(`profiles?select=id&id=eq.${a.id}`);
check('a stranger cannot read another profile', peeked.body?.length === 0);

// Nobody may write entitlements: that table is the webhook's alone.
const bought = await asA('entitlements', {
  method: 'POST',
  body: JSON.stringify({ user_id: a.id, product: 'pro' }),
});
check('nobody can grant themselves an entitlement', bought.status >= 400, `status ${bought.status}`);

// Tidy up what we can; the anonymous users themselves are harmless.
await asA(`sessions?id=eq.${sessionId}`, { method: 'DELETE' });

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
