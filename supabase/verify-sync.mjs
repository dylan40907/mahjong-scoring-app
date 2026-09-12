/**
 * Walk the exact queries the app's sync engine issues, not the policies.
 *
 * verify-rls proves the boundary holds. This proves the client can actually
 * get a game across it: the same selects, filters and column names that
 * `pullAwayGames` and `syncSeats` use, in the same order. A policy that is
 * right and a query that asks the wrong question look identical from the
 * database's side and produce an empty screen on the phone.
 *
 * It also proves what `pushSessions` relies on when a device has switched
 * accounts: how the database refuses a session somebody else owns.
 *
 * And that the reads come back whole. PostgREST stops at `max_rows` without
 * an error, so the engine reads in pages, and they are walked here with a size
 * small enough that a handful of rows crosses several boundaries.
 *
 * And that a hand deleted on the phone is deleted on the server. A hand is
 * deleted by leaving it out of its session, which an upsert cannot say, so the
 * push marks whatever the session no longer has, and the pull stops bringing
 * it back.
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

// --- a session another account owns: refused, then adopted -----------------
// `syncNow` pushes with an upsert, the way supabase-js sends one. The adopt
// path rests on three things the database does, so they are proven here
// rather than assumed: an id somebody else owns is refused as 42501 and not
// overwritten, one refused row takes its whole batch down, and a copy id -
// the old id's root, a `~`, a suffix - survives the filters the engine reads
// with. The guest plays the account the device switched to.
const upsert = (as, table, body) =>
  as(table, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
const sessionRow = (id, ownerId) => ({
  id,
  owner_id: ownerId,
  name: 'Carried over',
  ruleset_id: 'taiwanese-common',
  players: [{ id: ownerSeat, name: 'Owner', seat: 'east' }],
  round_wind: 'east',
  dealer_id: ownerSeat,
  dealer_streak: 0,
  created_at: now,
  updated_at: now,
  deleted_at: null,
});
const handRow = (id, session, ownerId) => ({
  id,
  session_id: session,
  owner_id: ownerId,
  winner_id: ownerSeat,
  discarder_id: null,
  payload: { concealed: [], exposed: [], bonus: [], winningTile: 'red', context: {} },
  deltas: {},
  summary: { total: 1, unit: 'tai', winnerReceives: 0, topPatterns: [] },
  photo_path: null,
  created_at: now,
  updated_at: now,
});

const heldId = `s_held_${stamp}`;
const heldHand = `h_held_${stamp}`;
await upsert(asOwner, 'sessions', sessionRow(heldId, owner.id));
await upsert(asOwner, 'hands', handRow(heldHand, heldId, owner.id));

const stolen = await upsert(asGuest, 'sessions', sessionRow(heldId, guest.id));
check(
  'an upsert onto a session id another account owns is refused as 42501',
  stolen.body?.code === '42501',
  `status ${stolen.status}, code ${stolen.body?.code ?? 'none'}`,
);
const untouched = await asOwner(`sessions?select=owner_id&id=eq.${heldId}`);
check('and the owner’s row is left alone', untouched.body?.[0]?.owner_id === owner.id);

const newId = `s_new_${stamp}`;
const batch = await upsert(asGuest, 'sessions', [
  sessionRow(heldId, guest.id),
  sessionRow(newId, guest.id),
]);
check('one refused row fails the whole batch', batch.body?.code === '42501');
const lostWithIt = await asGuest(`sessions?select=id&id=eq.${newId}`);
check(
  'taking a brand-new session down with it',
  lostWithIt.body?.length === 0,
  `saw ${lostWithIt.body?.length ?? '?'}`,
);
const alone = await upsert(asGuest, 'sessions', sessionRow(newId, guest.id));
check('which lands when pushed on its own', alone.status < 300, `status ${alone.status}`);

const copyId = `${heldId}~k2x9${stamp}`;
const adopted = await upsert(asGuest, 'sessions', sessionRow(copyId, guest.id));
check('an adopted copy lands under its new id', adopted.status < 300, `status ${adopted.status}`);

const handTaken = await upsert(asGuest, 'hands', handRow(heldHand, copyId, guest.id));
check(
  'a hand id another account owns is refused the same way',
  handTaken.body?.code === '42501',
  `code ${handTaken.body?.code ?? 'none'}`,
);
const copiedHand = `${heldHand}~k2x9${stamp}`;
const handLanded = await upsert(asGuest, 'hands', handRow(copiedHand, copyId, guest.id));
check('so hands move with it, and land', handLanded.status < 300, `status ${handLanded.status}`);

const pulled = await asGuest(`sessions?select=id&owner_id=eq.${guest.id}&id=in.(${copyId},${newId})`);
check(
  'a copy id reads back through the filters the engine uses',
  pulled.body?.length === 2,
  `saw ${pulled.body?.length ?? '?'}`,
);
const pulledHands = await asGuest(`hands?select=id&session_id=in.(${copyId})&deleted_at=is.null`);
check('with its hands', pulledHands.body?.[0]?.id === copiedHand);

await asGuest(`sessions?id=in.(${copyId},${newId})`, { method: 'DELETE' });
await asOwner(`sessions?id=eq.${heldId}`, { method: 'DELETE' });

// --- paging: every row, across page boundaries -----------------------------
// `sync/pages.ts` reads PAGE_SIZE rows at a time, ordered by primary key, and
// stops at the first short page. Proving that at the real cap would take a
// thousand rows; a page of two crosses the same boundaries with a handful.
// The queries are the engine's own - its filters, its `order`, and the
// `offset`/`limit` that supabase-js turns `.range(from, to)` into. Unlike the
// app this keeps duplicates, because pages that overlap are a failure here.
const PAGE = 2;
async function readPaged(as, path) {
  const rows = [];
  for (let from = 0, pages = 1; ; from += PAGE, pages += 1) {
    const page = await as(`${path}&offset=${from}&limit=${PAGE}`);
    if (page.status !== 200 || !Array.isArray(page.body)) return { rows: null, pages };
    rows.push(...page.body);
    if (page.body.length < PAGE) return { rows, pages };
  }
}
/** Paged, the read has to return what one unpaged read of a few rows does. */
async function provePaged(name, as, path, key) {
  const paged = await readPaged(as, path);
  const whole = await as(path);
  const ids = (paged.rows ?? []).map(key);
  const want = new Set((whole.body ?? []).map(key));
  check(
    name,
    paged.rows !== null &&
      want.size > PAGE &&
      ids.length === want.size &&
      new Set(ids).size === ids.length &&
      ids.every((id) => want.has(id)),
    `${ids.length} over ${paged.pages} pages, ${want.size} in one read`,
  );
  return paged.rows ?? [];
}
const byId = (row) => row.id;
const bySeat = (row) => `${row.session_id}|${row.user_id}`;
const seatCols = 'session_id,user_id,player_id';

// Four more nights, two hands each, the guest seated at all of them. One
// night is deleted and one hand scrapped, so the filters have something to
// leave out on either side of a boundary.
const nights = [0, 1, 2, 3].map((i) => `s_pg${i}_${stamp}`);
const tombstoned = nights[3];
const scrapped = `h_pg0b_${stamp}`;
const seeded = [
  await upsert(
    asOwner,
    'sessions',
    nights.map((id) => ({
      ...sessionRow(id, owner.id),
      name: 'Paged',
      players: [
        { id: ownerSeat, name: 'Owner', seat: 'east', accountId: owner.id },
        { id: guestSeat, name: 'Guest', seat: 'south', accountId: guest.id },
      ],
    })),
  ),
  await upsert(
    asOwner,
    'hands',
    nights.flatMap((id, i) => [
      handRow(`h_pg${i}a_${stamp}`, id, owner.id),
      handRow(`h_pg${i}b_${stamp}`, id, owner.id),
    ]),
  ),
  await upsert(
    asOwner,
    'session_players',
    nights.flatMap((id) => [
      { session_id: id, user_id: owner.id, player_id: ownerSeat, added_by: owner.id },
      { session_id: id, user_id: guest.id, player_id: guestSeat, added_by: owner.id },
    ]),
  ),
  await asOwner(`sessions?id=eq.${tombstoned}`, {
    method: 'PATCH',
    body: JSON.stringify({ deleted_at: now }),
  }),
  await asOwner(`hands?id=eq.${scrapped}`, {
    method: 'PATCH',
    body: JSON.stringify({ deleted_at: now }),
  }),
];
check(
  'the rows to page through are all written',
  seeded.every((res) => res.status < 300),
  seeded.map((res) => res.status).join(' '),
);

const ownSessions = await provePaged(
  'pullOwn reads every session, page by page',
  asOwner,
  `sessions?select=*&owner_id=eq.${owner.id}&order=id.asc`,
  byId,
);
check(
  'tombstones included',
  ownSessions.some((row) => row.id === tombstoned && row.deleted_at),
);
const ownHands = await provePaged(
  'and every live hand',
  asOwner,
  `hands?select=*&owner_id=eq.${owner.id}&deleted_at=is.null&order=id.asc`,
  byId,
);
check('but not the scrapped one', !ownHands.some((row) => row.id === scrapped));

// A read that ends exactly on a boundary asks for one page past the last row,
// and needs an empty page back rather than a 416: otherwise every account
// holding a multiple of PAGE_SIZE rows would fail to sync.
const past = await asOwner(
  `sessions?select=*&owner_id=eq.${owner.id}&order=id.asc&offset=${ownSessions.length}&limit=${PAGE}`,
);
check(
  'a page past the last row is empty, not an error',
  past.status === 200 && past.body?.length === 0,
  `status ${past.status}`,
);

await provePaged(
  'syncSeats reads every seat it handed out',
  asOwner,
  `session_players?select=${seatCols}&added_by=eq.${owner.id}&order=session_id.asc,user_id.asc`,
  bySeat,
);

const awaySeats = await provePaged(
  'pullAwayGames reads every seat held in somebody else’s game',
  asGuest,
  `session_players?select=${seatCols}&user_id=eq.${guest.id}&added_by=neq.${guest.id}&order=session_id.asc,user_id.asc`,
  bySeat,
);
const awayIds = awaySeats.map((row) => row.session_id).join(',');
const awaySessions = await provePaged(
  'and every live session they point to',
  asGuest,
  `sessions?select=*&id=in.(${awayIds})&deleted_at=is.null&order=id.asc`,
  byId,
);
check('which leaves out the deleted night', !awaySessions.some((row) => row.id === tombstoned));
await provePaged(
  'and every hand in them',
  asGuest,
  `hands?select=*&session_id=in.(${awayIds})&deleted_at=is.null&order=id.asc`,
  byId,
);

await asOwner(`sessions?id=in.(${nights.join(',')})`, { method: 'DELETE' });

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

// --- deleting a hand: the delete has to reach the server --------------------
// A hand is deleted on the phone by leaving it out of the session, and an
// upsert only writes what a session has, so the push has to say so: once the
// session and its hands have landed, `pruneHands` marks deleted every live
// hand under the session that the pushed copy does not have. The prune below
// is built the way postgrest-js builds it - filters appended through
// URLSearchParams, `.notIn` quoting only ids holding a comma or a bracket, so
// the `~` of a copy id goes as it is - and asks for the rows back only so each
// check can count what it marked. The pull is pullOwn's: every live hand the
// account owns, grouped by session.
const played = `s_prune_${stamp}`;
const sibling = `s_sib_${stamp}`;
const kept = `h_keep_${stamp}~k2x9${stamp}`;
const dropped = `h_drop_${stamp}`;
const at = (step) => new Date(Date.parse(now) + step * 1000).toISOString();

/** What pushOne sends: the session, then the hands it has, live. */
async function pushNight(id, hands, updatedAt) {
  const session = await upsert(asOwner, 'sessions', {
    ...sessionRow(id, owner.id),
    updated_at: updatedAt,
  });
  if (hands.length === 0) return session.status;
  const written = await upsert(
    asOwner,
    'hands',
    hands.map((hand) => ({ ...handRow(hand, id, owner.id), updated_at: updatedAt, deleted_at: null })),
  );
  return Math.max(session.status, written.status);
}

/** pruneHands, filter for filter. */
async function prune(id, keep, updatedAt) {
  const query = new URLSearchParams();
  query.append('session_id', `eq.${id}`);
  query.append('owner_id', `eq.${owner.id}`);
  query.append('deleted_at', 'is.null');
  if (keep.length > 0) {
    const quoted = keep.map((hand) => (/[,()]/.test(hand) ? `"${hand}"` : hand));
    query.append('id', `not.in.(${quoted.join(',')})`);
  }
  const path = `hands?${query}`;
  const res = await asOwner(path, {
    method: 'PATCH',
    body: JSON.stringify({ deleted_at: updatedAt }),
  });
  return { ...res, marked: Array.isArray(res.body) ? res.body.map(byId) : null, length: path.length };
}

/** The hand ids a pull puts back into a session. */
async function pulledInto(id) {
  const live = await asOwner(
    `hands?select=*&owner_id=eq.${owner.id}&deleted_at=is.null&order=id.asc`,
  );
  return (live.body ?? [])
    .filter((row) => row.session_id === id)
    .map(byId)
    .sort()
    .join(' ');
}
const both = [kept, dropped].sort().join(' ');

check('a night with two hands lands', (await pushNight(played, [kept, dropped], at(1))) < 300);
const nothing = await prune(played, [kept, dropped], at(1));
check(
  'and the prune after it marks nothing',
  nothing.status === 200 && nothing.marked?.length === 0,
  `status ${nothing.status}, marked ${nothing.marked?.length ?? '?'}`,
);
check('the pull brings back both hands', (await pulledInto(played)) === both);

// One hand deleted on the phone. The next push has the other one alone.
await pushNight(played, [kept], at(2));
const marked = await prune(played, [kept], at(2));
check(
  'the next push marks exactly the deleted hand',
  marked.status === 200 && marked.marked?.join(' ') === dropped,
  `status ${marked.status}, marked ${marked.marked?.join(' ') || 'nothing'}`,
);
const afterPrune = await pulledInto(played);
check('and a pull brings back one hand, not two', afterPrune === kept, `saw ${afterPrune || 'none'}`);

// It runs on every push of a dirty session, so it has to be a no-op the second
// time - and must not move the time a hand went.
const again = await prune(played, [kept], at(3));
check('pruning again marks nothing', again.status === 200 && again.marked?.length === 0);
const gone = await asOwner(`hands?select=deleted_at&id=eq.${dropped}`);
check(
  'and the hand keeps the time it went',
  Date.parse(gone.body?.[0]?.deleted_at) === Date.parse(at(2)),
  `deleted_at ${gone.body?.[0]?.deleted_at}`,
);

// A phone that never heard about the delete and edited the night later has
// the winning copy, and a hand it has is live again.
await pushNight(played, [kept, dropped], at(4));
await prune(played, [kept, dropped], at(4));
check('a later copy that still has the hand brings it back', (await pulledInto(played)) === both);

// Every hand deleted: no `id` filter at all, and nothing outside the session.
const neighbour = `h_sib_${stamp}`;
await pushNight(sibling, [neighbour], at(5));
await pushNight(played, [], at(5));
const emptied = await prune(played, [], at(5));
check(
  'a session with no hands left marks every hand it had',
  emptied.status === 200 && emptied.marked?.length === 2,
  `status ${emptied.status}, marked ${emptied.marked?.length ?? '?'}`,
);
check('so it pulls back empty', (await pulledInto(played)) === '');
check('and another session’s hands are left alone', (await pulledInto(sibling)) === neighbour);

// The id list is in the URL. A long night of copies - ids shaped the way
// `lib/ids.ts` makes them, as long as they get - still has to fit.
const makeId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const copyOf = (id) => `${id}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const marathon = `s_long_${stamp}`;
const long = Array.from({ length: 120 }, () => copyOf(makeId('h')));
await pushNight(marathon, long, at(6));
await pushNight(marathon, long.slice(1), at(7));
const longPrune = await prune(marathon, long.slice(1), at(7));
check(
  'a 120-hand night prunes in one request',
  longPrune.status === 200 && longPrune.marked?.join(' ') === long[0],
  `status ${longPrune.status}, URL ${longPrune.length} characters`,
);
const longLeft = await pulledInto(marathon);
check('leaving the other 119', longLeft.split(' ').length === 119);

await asOwner(`sessions?id=in.(${[played, sibling, marathon].join(',')})`, { method: 'DELETE' });

console.log(failures === 0 ? '\nThe app’s own queries work.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
