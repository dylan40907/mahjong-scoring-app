/**
 * Where the published policy and terms live.
 *
 * One constant rather than a URL typed into each screen that links to it, and
 * deliberately not bundled text: both stores require these to be reachable at
 * a public address anyway, and a copy inside the app is a second copy that
 * quietly falls behind the one people are actually shown.
 *
 * Generated from `docs/*.md` by `tools/build-legal.mjs` and served from the
 * `tile-tally` pages repo. The app repository stays private; these two
 * documents are the only public part of it.
 */
export const LEGAL = {
  privacy: 'https://dylan40907.github.io/tile-tally/privacy.html',
  terms: 'https://dylan40907.github.io/tile-tally/terms.html',
} as const;
