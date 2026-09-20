#!/usr/bin/env node
// Fixture test: skills/stardust/scripts/da-path.mjs — the one DA/EDS-safe path rule
// (rollout/reference/delivery-gates.md § Gate 3 DESCRIBES it; delivery-lint, deploy-batch
// and localize-links all fold through it, so its contract is pinned here).
//   one rule for every segment: percent-decode, NFKD + strip marks, ß/æ/ø/œ/đ/ł map,
//   lowercase, [^a-z0-9]+ → -, collapse, trim edge -; leaf drops one .html|.htm|.php|.jsp|.aspx;
//   query/fragment dropped; empty segments dropped; root → /; /index leaf KEPT;
//   a segment that empties (non-Latin script) → null; idempotent; NOT extract's slugify (D6).
// Usage: node plugins/stardust/evals/fixtures/da-path.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { normalizeDaPath, isDaSafePath } from '../../skills/stardust/scripts/da-path.mjs';

const CASES = [
  // underscores, double hyphens, edge hyphens (folder AND leaf — one rule)
  ['/a/staging-firmware_91x', '/a/staging-firmware-91x'],
  ['/x/another--not-revert---sannav-ova-', '/x/another-not-revert-sannav-ova'],
  ['/a_b/c--d', '/a-b/c-d'],
  ['/faq/-wait-a-minute', '/faq/wait-a-minute'],
  // dots, extensions, query strings
  ['/articles/category.automotive', '/articles/category-automotive'],
  ['/dw/ipdir.php?c=DW01_add', '/dw/ipdir'],
  ['/it-IT/index.html', '/it-it/index'],
  ['/x/page.aspx#top', '/x/page'],
  ['/x/file.tar.gz', '/x/file-tar-gz'],
  // diacritics, percent-encoding, case
  ['/at/ärztin', '/at/arztin'],
  ['/dk/Book%20et%20møte', '/dk/book-et-mote'],
  ['/om-Pharma', '/om-pharma'],
  ['/de/straße', '/de/strasse'],
  ['/no/Blåbær', '/no/blabaer'],
  // slashes and root
  ['/', '/'],
  ['', '/'],
  ['//x//y/', '/x/y'],
  ['/x/', '/x'],
  // a full URL folds to its path
  ['https://www.example.com/A/B.html?q=1#f', '/a/b'],
  // already safe
  ['/products/getting-started', '/products/getting-started'],
  ['/index', '/index'],
];
for (const [input, want] of CASES) {
  assert.equal(normalizeDaPath(input), want, `normalizeDaPath(${JSON.stringify(input)})`);
  assert.equal(normalizeDaPath(want), want, `idempotent on ${want}`);
  assert.equal(isDaSafePath(want), true, `${want} is safe`);
}
assert.equal(isDaSafePath('/A'), false);
assert.equal(isDaSafePath('/a b'), false);

// non-Latin: no safe form — the caller transliterates, the function never guesses
assert.equal(normalizeDaPath('/日本語'), null, 'a segment that empties → null');
assert.equal(normalizeDaPath('/x/日本語/y'), null, 'anywhere in the path');
assert.equal(isDaSafePath('/日本語'), false);

// D6: not slugify — segments stay segments
assert.equal(normalizeDaPath('/blog/Post-One'), '/blog/post-one', 'per-segment fold, slashes kept');

// CLI: exit 0 when every path is safe, 1 when one differs or has no safe form, 2 on no args
const CLI = new URL('../../skills/stardust/scripts/da-path.mjs', import.meta.url);
let r = spawnSync(process.execPath, [CLI.pathname, '/a/b'], { encoding: 'utf8' });
assert.equal(r.status, 0, 'safe → exit 0');
assert.equal(r.stdout.trim(), '/a/b\t/a/b');
r = spawnSync(process.execPath, [CLI.pathname, '/A_b', '/日本語'], { encoding: 'utf8' });
assert.equal(r.status, 1, 'divergent → exit 1');
assert.equal(r.stdout, '/A_b\t/a-b\n/日本語\t!unsafe\n');
assert.equal(spawnSync(process.execPath, [CLI.pathname], { encoding: 'utf8' }).status, 2, 'no args → exit 2');
r = spawnSync(process.execPath, [CLI.pathname, '--help'], { encoding: 'utf8' });
assert.equal(r.status, 0); assert.match(r.stdout, /Exit codes/);

console.log(`da-path test: ok (${CASES.length} fold cases, idempotence, null on non-Latin, CLI exits)`);
