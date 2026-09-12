/**
 * Prove that one account cannot read another's data.
 *
 * Row-level security is the entire security model here - there is no server
 * code between the app and the database, so a missing policy is not a bug that
 * shows up as an error, it is a bug that shows up as somebody else's sessions
 * appearing in your history. That failure is silent and total, which is
 * exactly the kind worth a script that can be re-run after any schema change.
 *
 * Signs in three throwaway anonymous users and walks the whole social path:
 * one writes a session, and the others try to reach it as a stranger, as a
 * friend, as somebody seated at that table, and as somebody who has just been
 * taken back out of it. A fourth sits at the same table, to be the guest who
 * would see anything the others managed to add. Run against the real project:
 *
 *   node supabase/verify-rls.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_KEY from the environment, falling back to
 * the values baked into the app, since the publishable key is public by design.
 */

const URL_ = process.env.SUPABASE_URL ?? 'https://your-project-ref.supabase.co';
const KEY = process.env.SUPABASE_KEY ?? 'your-publishable-key';

let failures = 0;

/** A response body that should have been rows, whatever actually came back. */
function list(body) {
  return Array.isArray(body) ? body : [];
}

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
const c = await anonUser();
const asA = rest(a);
const asB = rest(b);
const asC = rest(c);
const sessionId = `s_verify_${Date.now()}`;

console.log(
  `\nThree anonymous users: ${a.id.slice(0, 8)}…, ${b.id.slice(0, 8)}… and ${c.id.slice(0, 8)}…\n`,
);

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

// ---------------------------------------------------------------------------
// Friends, seats, and the games that travel along them
//
// This half is the one worth re-reading. Everything above fails closed - a
// missing policy means somebody sees nothing, which is obvious the first time
// anybody tries. Down here a mistake fails *open*: a game reaching somebody who
// was never at that table, or still reaching somebody who was taken out of it.
// Neither shows up as an error anywhere.
// ---------------------------------------------------------------------------

console.log('');

const rpc = (as) => (fn, args) =>
  as(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args ?? {}) });

/**
 * Stop with something readable if the social migration has not been applied.
 *
 * Without this the first RPC call comes back as a PostgREST error object and
 * the script dies four lines later on `.find is not a function`, which says
 * nothing about the actual problem. A schema that is behind is the most likely
 * reason to be running this at all.
 */
const probe = await rpc(asA)('request_friend', { lookup: `nobody_${Date.now()}` });
if (typeof probe.body !== 'string') {
  console.log('SKIP the social checks: request_friend() is not on this database.\n');
  console.log('Apply the migrations first:\n');
  console.log('  npx supabase db push --db-url "<connection string>"\n');
  console.log('or paste supabase/migrations/20260904*.sql into the SQL editor.\n');
  process.exit(1);
}

const stamp = Date.now().toString(36).slice(-6);
const handleB = `ver_b_${stamp}`;

// Handles and names, so requests arrive with something readable on them.
await asA(`profiles?id=eq.${a.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ handle: `ver_a_${stamp}`, display_name: 'Ada' }),
});
await asB(`profiles?id=eq.${b.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ handle: handleB, display_name: 'Bao' }),
});

// A asks B.
const asked = await rpc(asA)('request_friend', { lookup: handleB });
check('a friend request can be sent by handle', asked.body === 'sent', `said ${asked.body}`);

// B can see who is asking, name included - a request from a bare uuid is a
// question nobody can answer.
const inbox = await rpc(asB)('friend_list');
const fromA = list(inbox.body).find((row) => row.id === a.id);
check(
  'the request arrives with a name on it',
  fromA?.display_name === 'Ada' && fromA?.direction === 'in',
);

// Still not friends, so still no profile.
const tooEarly = await asA(`profiles?select=id&id=eq.${b.id}`);
check('a pending request does not open a profile', tooEarly.body?.length === 0);

// Only the person asked may accept, and only what was actually asked.
const gatecrash = await rpc(asC)('accept_friend', { other: a.id });
check('a third party cannot accept a request sent to someone else', gatecrash.body === false);

const accepted = await rpc(asB)('accept_friend', { other: a.id });
check('the person asked can accept', accepted.body === true);

// Accepting has to move *both* rows, or each side sees a different truth.
const nowVisible = await asA(`profiles?select=display_name&id=eq.${b.id}`);
check('accepting works in both directions', nowVisible.body?.[0]?.display_name === 'Bao');

// A writes a game with a hand in it.
const gameId = `s_social_${stamp}`;
await asA('sessions', {
  method: 'POST',
  body: JSON.stringify({
    id: gameId,
    owner_id: a.id,
    name: 'Friday',
    ruleset_id: 'taiwanese-common',
    players: [
      { id: 'p1', name: 'Ada', seat: 'east' },
      { id: 'p2', name: 'Bao', seat: 'south' },
      { id: 'p3', name: 'Dee', seat: 'west' },
    ],
    updated_at: new Date().toISOString(),
  }),
});
const ownerHand = `h_social_${stamp}`;
const scored = await asA('hands', {
  method: 'POST',
  body: JSON.stringify({
    id: ownerHand,
    session_id: gameId,
    owner_id: a.id,
    winner_id: 'p2',
    payload: {},
    updated_at: new Date().toISOString(),
  }),
});
check('the owner can add a hand to their own game', scored.status === 201, `status ${scored.status}`);

// Being friends on its own shares nothing. This is the promise the friends
// screen makes in as many words.
const justFriends = await asB(`sessions?select=id&id=eq.${gameId}`);
check('being friends alone shares no games', justFriends.body?.length === 0);

const seat = (body) => JSON.stringify({ session_id: gameId, added_by: a.id, ...body });

// Nobody can write themselves into somebody else's game.
const selfSeat = await asB('session_players', {
  method: 'POST',
  body: JSON.stringify({ session_id: gameId, user_id: b.id, player_id: 'p2', added_by: b.id }),
});
check('nobody can seat themselves in a game', selfSeat.status >= 400, `status ${selfSeat.status}`);

// Nor can the owner seat a stranger: the friendship is the consent.
const strangerSeat = await asA('session_players', {
  method: 'POST',
  body: seat({ user_id: c.id, player_id: 'p2' }),
});
check(
  'a game cannot be handed to a non-friend',
  strangerSeat.status >= 400,
  `status ${strangerSeat.status}`,
);

// The real thing.
const seated = await asA('session_players', {
  method: 'POST',
  body: seat({ user_id: b.id, player_id: 'p2' }),
});
check('the owner can seat a friend', seated.status === 201, `status ${seated.status}`);

const guestSees = await asB(`sessions?select=id,name&id=eq.${gameId}`);
check('a seated friend can read the game', guestSees.body?.length === 1);

const guestHands = await asB(`hands?select=id&session_id=eq.${gameId}`);
check('a seated friend can read its hands', guestHands.body?.length === 1);

// Reading is all they get. The phone that scored the night owns the record,
// which is also what lets the app treat a guest copy as a cache.
const guestEdit = await asB(`sessions?id=eq.${gameId}`, {
  method: 'PATCH',
  body: JSON.stringify({ name: 'Renamed by a guest' }),
});
const afterEdit = await asA(`sessions?select=name&id=eq.${gameId}`);
check(
  'a guest cannot change the game',
  afterEdit.body?.[0]?.name === 'Friday',
  `status ${guestEdit.status}`,
);

// Nor add to it. A seat is also how somebody learns a game's id, and a hand's
// foreign key to its session is checked without row-level security, so the
// hand policy has to ask whose session it is. When it did not, anybody holding
// the id could put a hand in the night: every other guest's totals changed,
// while the owner - who only ever pulls their own hands - never saw it and had
// no way to take it out. D is that other guest.
const d = await anonUser();
const asD = rest(d);
await rpc(asA)('request_friend_by_id', { target: d.id });
await rpc(asD)('accept_friend', { other: a.id });
const seatedD = await asA('session_players', { method: 'POST', body: seat({ user_id: d.id, player_id: 'p3' }) });
check('a second friend can be seated at the same table', seatedD.status === 201, `status ${seatedD.status}`);

// The refusal has to be the policy's. A 400 for a malformed row would pass a
// bare status check without proving anything.
const refused = (res) => res.status === 403 && res.body?.code === '42501';
const said = (res) => `status ${res.status}, code ${res.body?.code ?? 'none'}`;
const handIn = (session, owner, id) =>
  JSON.stringify({
    id,
    session_id: session,
    owner_id: owner.id,
    winner_id: 'p2',
    payload: {},
    deltas: { p1: -300, p2: 300 },
    updated_at: new Date().toISOString(),
  });

const guestForged = await asB('hands', { method: 'POST', body: handIn(gameId, b, `h_forged_b_${stamp}`) });
check('a seated guest cannot add a hand to the game', refused(guestForged), said(guestForged));

const strangerForged = await asC('hands', { method: 'POST', body: handIn(gameId, c, `h_forged_c_${stamp}`) });
check('nor can a stranger who knows its id', refused(strangerForged), said(strangerForged));

// The same hole through an update: score a hand in a game of your own, then
// move it across.
const decoyGame = `s_decoy_${stamp}`;
const decoyHand = `h_decoy_${stamp}`;
await asB('sessions', {
  method: 'POST',
  body: JSON.stringify({
    id: decoyGame,
    owner_id: b.id,
    ruleset_id: 'taiwanese-common',
    updated_at: new Date().toISOString(),
  }),
});
const decoy = await asB('hands', { method: 'POST', body: handIn(decoyGame, b, decoyHand) });
check('a guest can still score a hand in a game of their own', decoy.status === 201, `status ${decoy.status}`);
const movedIn = await asB(`hands?id=eq.${decoyHand}`, {
  method: 'PATCH',
  body: JSON.stringify({ session_id: gameId }),
});
check('but cannot move it into somebody else’s', refused(movedIn), said(movedIn));
await asB(`sessions?id=eq.${decoyGame}`, { method: 'DELETE' });

// Read the way `pullAwayGames` reads, by session alone, which is the read that
// would have shown a forged hand.
const besideThem = await asD(`hands?select=id&session_id=eq.${gameId}`);
check(
  'so another guest at the table sees only the owner’s hands',
  besideThem.body?.length === 1 && besideThem.body[0].id === ownerHand,
  `saw ${list(besideThem.body).map((row) => row.id).join(', ') || 'none'}`,
);

// The third user still sees nothing, which is what makes the seat the boundary
// rather than the friendship.
const outsider = await asC(`sessions?select=id&id=eq.${gameId}`);
check('somebody at neither table sees nothing', outsider.body?.length === 0);

// Taking them out takes their copy with it.
await asA(`session_players?session_id=eq.${gameId}&user_id=eq.${b.id}`, { method: 'DELETE' });
const afterUnseat = await asB(`sessions?select=id&id=eq.${gameId}`);
check(
  'unseating revokes the game',
  afterUnseat.body?.length === 0,
  `saw ${afterUnseat.body?.length ?? '?'} rows`,
);

// A guest can walk out of a game without having to ask the owner.
await asA('session_players', { method: 'POST', body: seat({ user_id: b.id, player_id: 'p2' }) });
await asB(`session_players?session_id=eq.${gameId}&user_id=eq.${b.id}`, { method: 'DELETE' });
const afterLeaving = await asB(`sessions?select=id&id=eq.${gameId}`);
check('a guest can leave a game themselves', afterLeaving.body?.length === 0);

// Unfriending has to take the seats with it, or "remove friend" quietly keeps
// sharing every game they were ever in.
await asA('session_players', { method: 'POST', body: seat({ user_id: b.id, player_id: 'p2' }) });
const beforeUnfriend = await asB(`sessions?select=id&id=eq.${gameId}`);
check('re-seating works', beforeUnfriend.body?.length === 1);

await rpc(asA)('remove_friend', { other: b.id });
const afterUnfriend = await asB(`sessions?select=id&id=eq.${gameId}`);
check(
  'unfriending revokes every game they were in',
  afterUnfriend.body?.length === 0,
  `saw ${afterUnfriend.body?.length ?? '?'} rows`,
);

const bothGone = await rpc(asB)('friend_list');
check('unfriending clears both directions', !list(bothGone.body).some((row) => row.id === a.id));

// ---------------------------------------------------------------------------
// Profiles: usernames, privacy, and what a stranger can reach
//
// The failure mode here is the opposite of the one above. A friendship that
// does not work is obvious the first time somebody tries it; a profile that is
// readable when it should not be is invisible forever, and so is a `profiles`
// table that can be downloaded whole.
// ---------------------------------------------------------------------------

console.log('');

// A username is claimed rather than typed. Two accounts asking for the same
// one must both end up with something.
const wantedA = `dup_${stamp}`;
const claimedC = await rpc(asC)('claim_handle', { preferred: wantedA });
check('a username can be claimed', claimedC.body === wantedA, `got ${claimedC.body}`);

const claimedB2 = await rpc(asB)('claim_handle', { preferred: wantedA });
check(
  'a taken username yields a variant rather than an error',
  typeof claimedB2.body === 'string' && claimedB2.body !== wantedA && claimedB2.body.startsWith(wantedA),
  `got ${claimedB2.body}`,
);

// The sanitiser has to hold the column's own constraint, or claiming throws
// where it should be quietly tidying up.
const messy = await rpc(asA)('claim_handle', { preferred: '  Jane.Doe+mahjong@Example.COM  ' });
check(
  'a messy preference is reduced to a legal username',
  typeof messy.body === 'string' && /^[a-z0-9_]{3,20}$/.test(messy.body),
  `got ${messy.body}`,
);

// A public profile answers to anyone who knows the exact name.
const publicView = await rpc(asC)('view_profile', { lookup: messy.body });
check('a public profile is visible to a stranger', publicView.body?.length === 1);
check(
  'and says how they are related',
  publicView.body?.[0]?.relation === 'none',
  `relation ${publicView.body?.[0]?.relation}`,
);

// The whole point of a function instead of a read policy: no directory.
const directory = await asC('profiles?select=id,handle');
check(
  'the profiles table cannot be listed',
  (directory.body?.length ?? 0) <= 1,
  `saw ${directory.body?.length ?? '?'} rows`,
);

// Going private takes the profile out of reach of people who are not friends.
await asA(`profiles?id=eq.${a.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ is_private: true }),
});
const hidden = await rpc(asC)('view_profile', { lookup: messy.body });
check('a private profile is not findable', hidden.body?.length === 0);

// And cannot be sent a request - answered as though the name were unused, so
// that the setting is not itself detectable.
const blockedRequest = await rpc(asC)('request_friend', { lookup: messy.body });
check(
  'a private profile cannot be sent a request',
  blockedRequest.body === 'unknown',
  `said ${blockedRequest.body}`,
);

// Their own profile stays visible to them.
const ownView = await rpc(asA)('view_profile', { lookup: messy.body });
check('a private profile is still visible to its owner', ownView.body?.[0]?.relation === 'self');

// Private is about being found, not about being unable to look: A can still
// reach out, and C can answer.
const outboundWhilePrivate = await rpc(asA)('request_friend', { lookup: claimedC.body });
check(
  'a private profile can still send requests',
  outboundWhilePrivate.body === 'sent',
  `said ${outboundWhilePrivate.body}`,
);

const seesRequester = await rpc(asC)('friend_list');
check(
  'the person asked can see who is asking, private or not',
  list(seesRequester.body).some((row) => row.id === a.id),
);

await rpc(asC)('accept_friend', { other: a.id });
const friendView = await rpc(asC)('view_profile', { lookup: messy.body });
check(
  'once accepted, a private profile opens to that friend',
  friendView.body?.[0]?.relation === 'friend',
  `relation ${friendView.body?.[0]?.relation}`,
);

// Stats travel with the profile, which is what makes them visible to somebody
// who has no right to read the hands underneath.
await asA(`profiles?id=eq.${a.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ stats: { handsWon: 7, handsPlayed: 20 } }),
});
const withStats = await rpc(asC)('view_profile', { lookup: messy.body });
check('a profile carries the stats its owner published', withStats.body?.[0]?.stats?.handsWon === 7);

// But the hands themselves stay shut.
const peekHands = await asC(`hands?select=id&owner_id=eq.${a.id}`);
check(
  'a friend still cannot read hands they were not seated in',
  peekHands.body?.length === 0,
  `saw ${peekHands.body?.length ?? '?'} rows`,
);

// ---------------------------------------------------------------------------
// Renames and blocks: people are named by account once they are known
// ---------------------------------------------------------------------------

console.log('');

// A renames. C is their friend and must still reach them - by the id the app
// holds, not by a username that no longer exists.
const renamed = `ren_${stamp}`;
await asA(`profiles?id=eq.${a.id}`, { method: 'PATCH', body: JSON.stringify({ handle: renamed }) });
const byId = await rpc(asC)('view_profile_by_id', { target: a.id });
check(
  'a friend who renames is still found by id, under the new name',
  byId.body?.[0]?.handle === renamed && byId.body?.[0]?.relation === 'friend',
  `got ${JSON.stringify(byId.body?.[0] ?? null)?.slice(0, 80)}`,
);
const oldName = await rpc(asC)('view_profile', { lookup: messy.body });
check('the old username leads nowhere, rather than to a ghost', oldName.body?.length === 0);

// A request sent by id survives the name it was found under changing.
const byIdRequest = await rpc(asB)('request_friend_by_id', { target: c.id });
check('a request can be sent by account id', byIdRequest.body === 'sent', `said ${byIdRequest.body}`);

// view_profile_by_id used to call every pending request 'friend'.
const incomingView = await rpc(asC)('view_profile_by_id', { target: b.id });
check(
  'a pending request is labelled as one, not as a friend',
  incomingView.body?.[0]?.relation === 'incoming',
  `relation ${incomingView.body?.[0]?.relation}`,
);

// C blocks B. Neither should be able to open the other any more.
await rpc(asC)('block_user', { other: b.id });
const blockedByName = await rpc(asB)('view_profile', { lookup: claimedC.body });
check('somebody blocked cannot open the blocker by name', blockedByName.body?.length === 0);
const blockerById = await rpc(asC)('view_profile_by_id', { target: b.id });
check('the blocker does not keep seeing them by id', blockerById.body?.length === 0);
const retry = await rpc(asB)('request_friend_by_id', { target: c.id });
check('and cannot send another request', retry.body === 'unknown', `said ${retry.body}`);

// The blocked list: yours to see, and never theirs.
const blockerList = await rpc(asC)('friend_list');
check(
  'your own blocks come back in your list, marked as blocks',
  list(blockerList.body).some((row) => row.id === b.id && row.status === 'blocked' && row.direction === 'out'),
);
const blockedList = await rpc(asB)('friend_list');
check(
  'a block against you is never reported to you',
  !list(blockedList.body).some((row) => row.id === c.id),
);

// Only the person who blocked can lift it.
const notTheirs = await rpc(asB)('unblock_user', { other: c.id });
check('a block cannot be lifted by the person blocked', notTheirs.body === false, `said ${notTheirs.body}`);
const stillHidden = await rpc(asB)('view_profile', { lookup: claimedC.body });
check('and it stays in force', stillHidden.body?.length === 0);

const lifted = await rpc(asC)('unblock_user', { other: b.id });
check('a block can be lifted', lifted.body === true, `said ${lifted.body}`);
const foundAgain = await rpc(asB)('view_profile', { lookup: claimedC.body });
check('once lifted, the two can find each other again', foundAgain.body?.length === 1);
const nothingBack = await rpc(asC)('friend_list');
check(
  'lifting a block restores nothing - no friendship, no request',
  !list(nothingBack.body).some((row) => row.id === b.id),
);

// Search is the one read that answers a partial name, so it is the one that
// could become a directory. Everything it returns is proven in
// `verify-search.sql`, as real accounts; what can be proven from here is who
// it refuses, and an anonymous account - free to make, and so a way to
// multiply any per-account limit - is exactly who.
const anonSearch = await rpc(asC)('search_profiles', { query: claimedC.body.slice(0, 6) });
check(
  'an anonymous account cannot search for people',
  Array.isArray(anonSearch.body) && anonSearch.body.length === 0,
  `saw ${JSON.stringify(anonSearch.body)?.slice(0, 80)}`,
);

// And a signed-out caller cannot call the social functions at all. Revoking
// these from `anon` once did nothing, because `anon` still held them through
// PUBLIC; the status is the proof rather than the empty body.
const signedOut = async (fn, args) => {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  return res.status;
};
for (const [fn, args] of [
  ['search_profiles', { query: 'dy' }],
  ['view_profile', { lookup: claimedC.body }],
  ['friend_list', {}],
  ['request_friend', { lookup: claimedC.body }],
  ['request_friend_by_id', { target: c.id }],
  ['unblock_user', { other: c.id }],
]) {
  const status = await signedOut(fn, args);
  check(`${fn} is not callable signed out`, status === 401 || status === 403 || status === 404, `status ${status}`);
}

// Tidy up what we can; the anonymous users themselves are harmless.
await asA(`sessions?id=eq.${sessionId}`, { method: 'DELETE' });
await asA(`sessions?id=eq.${gameId}`, { method: 'DELETE' });

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
