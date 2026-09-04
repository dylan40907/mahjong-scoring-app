/**
 * Check that the bundle just published actually carries its configuration.
 *
 * This exists because an update shipped without it. The build read its
 * Supabase values from `eas.json`, which applies to builds only; `eas update`
 * reads EAS-hosted environment variables instead, and there were none. So the
 * update replaced a working bundle with one where `EXPO_PUBLIC_SUPABASE_URL`
 * was undefined, `supabase` was null, and the app quietly reported having no
 * account server. Nothing failed, nothing logged, and it looked exactly like a
 * backend that had never been set up.
 *
 * `EXPO_PUBLIC_` values are inlined at bundle time, so their presence is
 * greppable and their absence is the whole bug. Runs straight after
 * `eas update`, as part of `npm run update`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

/** Values that must appear in a bundle, by the name that carries them. */
const REQUIRED = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY'];

/**
 * What the bundler should have inlined.
 *
 * npm does not put `.env` into a script's environment the way the Expo CLI
 * does for the export itself, so this reads the file directly rather than
 * reporting a missing variable when the variable is fine.
 */
function expected(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.env')) return null;
  const prefix = name + '=';
  for (const raw of readFileSync('.env', 'utf8').split('\n')) {
    const row = raw.trim();
    if (row.startsWith(prefix)) return row.slice(prefix.length).trim();
  }
  return null;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(hbc|js)$/.test(entry)) out.push(path);
  }
  return out;
}

let bundles;
try {
  bundles = walk(join(DIST, '_expo', 'static', 'js'));
} catch {
  console.error('No export found in dist/. Run this straight after eas update.');
  process.exit(1);
}

let missing = 0;
for (const name of REQUIRED) {
  const value = expected(name);
  if (!value) {
    console.error('FAIL ' + name + ' is not in .env or the environment, so it cannot be checked.');
    missing += 1;
    continue;
  }
  const found = bundles.filter((file) => readFileSync(file, 'utf8').includes(value));
  if (found.length === 0) {
    console.error('FAIL ' + name + ' is in no bundle - the app will run with no backend.');
    missing += 1;
  } else {
    console.log('ok   ' + name + ' present in ' + found.length + ' bundle(s)');
  }
}

if (missing > 0) {
  console.error('\nThe published update is missing configuration. Check `eas env:list`.');
  process.exit(1);
}
console.log('\nBundle carries its configuration.');
