/**
 * Drive the web build and photograph every screen.
 *
 * There is no device attached to this environment and no emulator available,
 * so this is the visual review loop: export to web, drive the real interface
 * with a real browser at phone dimensions, and look at the results. Native-only
 * pieces (camera, ONNX) are guarded and fall through to their web states, which
 * is exactly what makes the rest of the interface reviewable here.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const DIST = resolve('dist');
const OUT = resolve('screenshots');
const PORT = 8099;
const VIEWPORT = { width: 390, height: 844 };

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ttf': 'font/ttf', '.onnx': 'application/octet-stream',
};

/**
 * Resolve a URL to a file in the static export.
 *
 * Expo's static export writes one HTML file per *static* route and leaves
 * dynamic segments as literal `[id].html`. A request for /session/sess1 has to
 * be served that file and let the router read the real id from the URL at
 * runtime, which is what a real host would be configured to do.
 */
function resolveFile(pathname) {
  const direct = join(DIST, decodeURIComponent(pathname));

  if (existsSync(direct) && !statSync(direct).isDirectory()) return direct;

  const asHtml = `${direct.replace(/\/$/, '')}.html`;
  if (existsSync(asHtml)) return asHtml;

  const asIndex = join(direct, 'index.html');
  if (existsSync(asIndex)) return asIndex;

  // Dynamic route: find the [param].html sibling.
  const parent = dirname(direct);
  if (existsSync(parent) && statSync(parent).isDirectory()) {
    const dynamic = readdirSync(parent).find((name) => /^\[.+\]\.html$/.test(name));
    if (dynamic) return join(parent, dynamic);
  }

  const fallback = join(DIST, 'index.html');
  return existsSync(fallback) ? fallback : null;
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const path = resolveFile(url.pathname);
      if (!path) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((done) => server.listen(PORT, () => done(server)));
}

// --- Sample data -----------------------------------------------------------

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();

const players = [
  { id: 'p1', name: 'Dylan', seat: 'east' },
  { id: 'p2', name: 'Mei', seat: 'south' },
  { id: 'p3', name: 'Ravi', seat: 'west' },
  { id: 'p4', name: 'Jo', seat: 'north' },
];

const hands = [
  {
    id: 'h3', createdAt: iso(6), winnerId: 'p2', discarderId: 'p4',
    hand: { concealed: [], melds: [], bonus: [], winningTile: 'red', context: {} },
    deltas: { p1: 0, p2: 130, p3: 0, p4: -130 },
    summary: { total: 10, unit: 'tai', winnerReceives: 130, topPatterns: ['Half Flush', 'All Pungs', 'Dragon Pung'] },
  },
  {
    id: 'h2', createdAt: iso(23), winnerId: 'p1', discarderId: null,
    hand: { concealed: [], melds: [], bonus: [], winningTile: 'sou5', context: {} },
    deltas: { p1: 240, p2: -80, p3: -80, p4: -80 },
    summary: { total: 5, unit: 'tai', winnerReceives: 240, topPatterns: ['Self Drawn', 'Fully Concealed Hand', 'Flower Tiles'] },
  },
  {
    id: 'h1', createdAt: iso(41), winnerId: 'p3', discarderId: 'p1',
    hand: { concealed: [], melds: [], bonus: [], winningTile: 'pin3', context: {} },
    deltas: { p1: -70, p2: 0, p3: 70, p4: 0 },
    summary: { total: 4, unit: 'tai', winnerReceives: 70, topPatterns: ['All Chows', 'Flower Tiles'] },
  },
];

const seed = {
  'mj.sessions': JSON.stringify([
    {
      id: 'sess1', name: 'Thursday night', createdAt: iso(60), updatedAt: iso(6),
      ruleSetId: 'taiwanese-common', players, roundWind: 'east', dealerId: 'p2', hands,
    },
    {
      id: 'sess2', name: 'August 14', createdAt: iso(4000), updatedAt: iso(3900),
      ruleSetId: 'hongkong-three-faan',
      players: [
        { id: 'q1', name: 'Dylan', seat: 'east' },
        { id: 'q2', name: 'Sam', seat: 'south' },
        { id: 'q3', name: 'Priya', seat: 'west' },
        { id: 'q4', name: 'Tom', seat: 'north' },
      ],
      roundWind: 'south', dealerId: 'q3',
      hands: [
        {
          id: 'k1', createdAt: iso(3900), winnerId: 'q3', discarderId: 'q2',
          hand: { concealed: [], melds: [], bonus: [], winningTile: 'man9', context: {} },
          deltas: { q1: -16, q2: -32, q3: 64, q4: -16 },
          summary: { total: 6, unit: 'faan', winnerReceives: 64, topPatterns: ['Full Flush'] },
        },
      ],
    },
  ]),
  'mj.settings': JSON.stringify({
    defaultRuleSetId: 'taiwanese-common',
    detectionEnabled: true,
    confidenceThreshold: 0.6,
    hapticsEnabled: true,
  }),
  'mj.customRuleSets': JSON.stringify([]),
};

// --- Driving ---------------------------------------------------------------

async function shoot(page, name) {
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

/**
 * Scroll the app, not the window.
 *
 * React Native Web renders a ScrollView as an inner overflow container, so
 * window.scrollTo does nothing. A wheel event over the content is what a user
 * would generate and what the container actually listens for.
 */
async function scrollBy(page, amount) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.mouse.wheel(0, amount);
  await page.waitForTimeout(500);
}

async function goto(page, path) {
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
}

/** Add one tile through the picker: open it, choose by accessible name. */
async function addTile(page, label) {
  await page.getByLabel('Add a tile').first().click();
  await page.waitForTimeout(220);
  await page.getByLabel(label, { exact: true }).last().click();
  await page.waitForTimeout(180);
}

const HAND = [
  '1 Characters', '2 Characters', '3 Characters',
  '4 Characters', '5 Characters', '6 Characters',
  '1 Circles', '2 Circles', '3 Circles',
  '7 Bamboo', '8 Bamboo', '9 Bamboo',
  'East', 'East', 'East',
  'Red Dragon', 'Red Dragon',
];

async function main() {
  const server = await startServer();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) window.localStorage.setItem(key, value);
  }, seed);

  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  ! page error: ${error.message}`));

  console.log('Screens:');

  // A fresh install, before any data exists. Worth capturing: the empty state
  // is the first thing a new user sees and the easiest thing to leave ugly.
  const firstRun = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const firstRunPage = await firstRun.newPage();
  await firstRunPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await shoot(firstRunPage, '00-first-run');
  await firstRun.close();

  await goto(page, '/');
  await shoot(page, '01-sessions');

  await goto(page, '/session/sess1');
  await shoot(page, '02-session');

  await goto(page, '/rules');
  await shoot(page, '03-rules');

  await goto(page, '/rules/taiwanese-common');
  await shoot(page, '04-ruleset-taiwanese');

  await scrollBy(page, 1100);
  await shoot(page, '05-ruleset-patterns');

  await goto(page, '/rules/riichi');
  await shoot(page, '06-ruleset-riichi');

  await goto(page, '/rules/edit?base=taiwanese-common');
  await shoot(page, '07-rule-editor');

  await goto(page, '/settings');
  await shoot(page, '08-settings');

  await goto(page, '/session/new');
  await shoot(page, '09-new-session');

  // The hand flow keeps its state in memory, so it has to be walked rather
  // than deep-linked.
  await goto(page, '/session/sess1');
  await page.getByText('Score a Hand', { exact: true }).click();
  await page.waitForTimeout(700);
  await shoot(page, '10-capture');

  await page.getByText('Enter tiles by hand', { exact: true }).click();
  await page.waitForTimeout(700);
  await shoot(page, '11-review-empty');

  for (const label of HAND) await addTile(page, label);
  await page.waitForTimeout(400);
  await shoot(page, '12-review-filled');

  // Choose the winning tile.
  await page.getByText('Choose', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Red Dragon', { exact: true }).last().click();
  await page.waitForTimeout(400);
  await shoot(page, '13-review-complete');

  await page.getByText('Continue', { exact: true }).click();
  await page.waitForTimeout(800);
  await shoot(page, '14-context');

  // Say who discarded, or the hand cannot be scored.
  await page.getByText('Jo', { exact: true }).last().click();
  await page.waitForTimeout(300);
  await shoot(page, '14b-context-ready');

  await page.getByText('Score the Hand', { exact: true }).click();
  await page.waitForTimeout(900);
  await shoot(page, '15-result');

  await scrollBy(page, 1400);
  await shoot(page, '16-result-settlement');

  await browser.close();
  server.close();
  console.log(`\nWrote to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
