/**
 * Turn the policy and terms into a small static site.
 *
 * The markdown in `docs/` stays the source of truth. Both stores, the Google
 * OAuth consent screen and TestFlight's beta review all want a public URL, and
 * the worst version of that is a second copy of the text living somewhere else
 * that drifts from the first. So this generates rather than duplicates: edit
 * the markdown, run this, push.
 *
 *   node tools/build-legal.mjs
 *
 * Writes to `site/`, which is what gets pushed to the public pages repo. The
 * app repo is private and stays that way; only these two documents are public,
 * which is the whole point.
 *
 * The converter handles the subset of markdown these documents actually use.
 * A dependency for this would be a dependency to keep current for the sake of
 * two pages that change twice a year.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site');

/** Inline: bold, links, code. Escaped first so the source cannot inject HTML. */
function inline(text) {
  return escape(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toHtml(markdown) {
  // HTML comments in these files are notes to ourselves - the unpublished
  // caveats and the things to check before shipping. They must not travel.
  const source = markdown.replace(/<!--[\s\S]*?-->/g, '');

  const out = [];
  let list = null;
  let paragraph = [];

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      list = null;
    }
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      closeAll();
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeAll();
      out.push('<hr>');
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      closeParagraph();
      list = list ?? [];
      list.push(bullet[1]);
      continue;
    }

    // An indented line under a bullet continues that bullet rather than
    // starting a paragraph; several list items here wrap onto a second line.
    if (list && /^\s{2,}\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }
  closeAll();
  return out.join('\n');
}

/**
 * The page shell.
 *
 * Styled to look like the app rather than like a generic legal page, because
 * somebody arriving here from a store listing should be able to tell they are
 * in the right place. Light on top of the same jade, one column, and readable
 * at arm's length on a phone - which is where a privacy policy is actually
 * opened.
 */
function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — Tile Tally</title>
<style>
  :root {
    --ground: #123a2e;
    --surface: #1b4d3b;
    --line: #357355;
    --ink: #f4f2e8;
    --muted: #b6d4c1;
    --faint: #8ab29b;
    --brass: #f5c63c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 44rem; margin: 0 auto; padding: 3rem 1.4rem 6rem; }
  nav { font-size: 0.85rem; margin-bottom: 2.5rem; color: var(--faint); }
  nav a { color: var(--muted); margin-right: 1rem; }
  h1 { font-size: 1.9rem; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 1.5rem; }
  h2 { font-size: 1.25rem; margin: 2.5rem 0 0.75rem; letter-spacing: -0.01em; }
  h3 { font-size: 1rem; margin: 1.75rem 0 0.5rem; color: var(--muted); }
  p, li { color: var(--muted); }
  strong { color: var(--ink); font-weight: 600; }
  a { color: var(--brass); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  ul { padding-left: 1.15rem; }
  li { margin-bottom: 0.5rem; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2.5rem 0; }
  code {
    background: var(--surface);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  footer { margin-top: 4rem; color: var(--faint); font-size: 0.85rem; }
</style>
</head>
<body>
<main>
  <nav><a href="./">Tile Tally</a><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a></nav>
  ${body}
  <footer>Tile Tally is made by Tangent. Questions: <a href="mailto:dylansken@gmail.com">dylansken@gmail.com</a></footer>
</main>
</body>
</html>
`;
}

const INDEX = `<h1>Tile Tally</h1>
<p>Photograph a winning mahjong hand and it works out the score — Taiwanese,
Hong Kong, MCR or Riichi, including the parts every table argues about.
Everything works offline, and an account is optional.</p>
<h2>Documents</h2>
<ul>
<li><a href="./privacy.html">Privacy Policy</a></li>
<li><a href="./terms.html">Terms of Use</a></li>
</ul>`;

mkdirSync(OUT, { recursive: true });

const pages = [
  ['index.html', 'Tile Tally', INDEX],
  ['privacy.html', 'Privacy Policy', toHtml(readFileSync(join(ROOT, 'docs/privacy-policy.md'), 'utf8'))],
  ['terms.html', 'Terms of Use', toHtml(readFileSync(join(ROOT, 'docs/terms.md'), 'utf8'))],
];

for (const [name, title, body] of pages) {
  writeFileSync(join(OUT, name), page(title, body));
  console.log(`wrote site/${name}`);
}

// Pages runs Jekyll by default, which would try to interpret these and ignore
// anything it decided looked like a draft. There is nothing to build here.
writeFileSync(join(OUT, '.nojekyll'), '');
console.log('wrote site/.nojekyll');
