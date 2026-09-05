/**
 * Walk the exact queries the app's sync engine issues, not the policies.
 *
 * verify-rls proves the boundary holds. This proves the client can actually
 * get a game across it: the same selects, filters and column names that
 * `pullAwayGames` and `syncSeats` use, in the same order. A policy that is
 * right and a query that asks the wrong question look identical from the
 * database's side and produce an empty screen on the phone.
 */
const URL_ = 'https://your-project-ref.supabase.co';
const KEY = 'your-publishable-key';

let failures = 0;
function check(name, passed, detail = '') {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
}

async function anonUser() {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
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

const owner = await anonUser();
const guest = await anonUser();
const asOwner = rest(owner);
const asGuest = rest(guest);
const rpc = (as) => (fn, args) =>
  as(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args ?? {}) });

const stamp = Date.now().toString(36).slice(-6);
const sessionId = `s_away_${stamp}`;
const ownerSeat = `p_own_${stamp}`;
const guestSeat = `p_gst_${stamp}`;

// Become friends the way the app does.
await asOwner(`profiles?id=eq.${owner.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ handle: `aw_o_${stamp}`, display_name: 'Owner' }),
});
await asGuest(`profiles?id=eq.${guest.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ handle: `aw_g_${stamp}`, display_name: 'Guest' }),
});
await rpc(asOwner)('request_friend', { lookup: `aw_g_${stamp}` });
await rpc(asGuest)('accept_friend', { other: owner.id });

// The owner pushes a session and a hand, exactly as `syncNow` shapes them.
const now = new Date().toISOString();
await asOwner('sessions', {
  method: 'POST',
  body: JSON.stringify({
    id: sessionId,
    owner_id: owner.id,
    name: 'Sunday',
    ruleset_id: 'taiwanese-common',
    players: [
      { id: ownerSeat, name: 'Owner', seat: 'east', accountId: owner.id },
      { id: guestSeat, name: 'Guest', seat: 'south', accountId: guest.id },
    ],
    round_wind: 'east',
    dealer_id: ownerSeat,
    dealer_streak: 2,
    created_at: now,
    updated_at: now,
  }),
});
await asOwner('hands', {
  method: 'POST',
  body: JSON.stringify({
    id: `h_away_${stamp}`,
    session_id: sessionId,
    owner_id: owner.id,
    winner_id: guestSeat,
    discarder_id: ownerSeat,
    payload: { concealed: [], exposed: [], bonus: [], winningTile: 'pin7', context: {} },
    deltas: { [ownerSeat]: -90, [guestSeat]: 90 },
    summary: { total: 6, unit: 'tai', winnerReceives: 90, topPatterns: ['All Chows'] },
    created_at: now,
    updated_at: now,
  }),
});

// --- syncSeats: the owner writes both seats, its own included ---------------
const written = await asOwner('session_players', {
  method: 'POST',
  headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
  body: JSON.stringify([
    { session_id: sessionId, user_id: owner.id, player_id: ownerSeat, added_by: owner.id },
    { session_id: sessionId, user_id: guest.id, player_id: guestSeat, added_by: owner.id },
  ]),
});
check('an upsert can write both seats at once', written.status === 201, `status ${written.status}`);

const mineBack = await asOwner(
  `session_players?select=session_id,user_id,player_id&added_by=eq.${owner.id}`,
);
check(
  'syncSeats can read back what it handed out',
  mineBack.body?.length === 2,
  `saw ${mineBack.body?.length ?? '?'}`,
);

// --- pullAwayGames, from the guest's side ----------------------------------
const seats = await asGuest(
  `session_players?select=session_id,user_id,player_id&user_id=eq.${guest.id}&added_by=neq.${guest.id}`,
);
check(
  'the guest finds the seat somebody else gave them',
  seats.body?.length === 1 && seats.body[0].player_id === guestSeat,
);

const ids = (seats.body ?? []).map((row) => row.session_id).join(',');
const games = await asGuest(`sessions?select=*&id=in.(${ids})&deleted_at=is.null`);
check('the session comes back whole', games.body?.length === 1);
check('with the seats and their account links', games.body?.[0]?.players?.length === 2);
check('and the dealer streak intact', games.body?.[0]?.dealer_streak === 2);
check(
  'and an owner_id the app can put a name to',
  games.body?.[0]?.owner_id === owner.id,
);

const hands = await asGuest(`hands?select=*&session_id=in.(${ids})&deleted_at=is.null`);
check('the hands come with it', hands.body?.length === 1);
check(
  'with the deltas that make the guest a winner',
  hands.body?.[0]?.deltas?.[guestSeat] === 90,
);

// The owner's own seat row must not come back as an away game.
const ownerAway = await asOwner(
  `session_players?select=session_id&user_id=eq.${owner.id}&added_by=neq.${owner.id}`,
);
check(
  'a game you scored yourself is never an away game',
  ownerAway.body?.length === 0,
  `saw ${ownerAway.body?.length ?? '?'}`,
);

// --- the owner deletes the session; the guest's copy has to vanish ----------
await asOwner(`sessions?id=eq.${sessionId}`, {
  method: 'PATCH',
  body: JSON.stringify({ deleted_at: new Date().toISOString() }),
});
const afterDelete = await asGuest(`sessions?select=id&id=in.(${ids})&deleted_at=is.null`);
check(
  'a deleted session stops arriving as an away game',
  afterDelete.body?.length === 0,
  `saw ${afterDelete.body?.length ?? '?'}`,
);

await asOwner(`sessions?id=eq.${sessionId}`, { method: 'DELETE' });

console.log(failures === 0 ? '\nThe app’s own queries work.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
