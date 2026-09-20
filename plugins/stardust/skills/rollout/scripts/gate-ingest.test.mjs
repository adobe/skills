#!/usr/bin/env node
// Fixture test: the generic per-page gate ingest — update-coverage.mjs --gate <name> <json> and
// verify.mjs --ai-readability <json> (T33.1 AI-readability, T32.1 editability).
//
//   matcher        pages[].path / a full URL / .plain.html / content/<page>.html all resolve to the
//                  coverage row (served path, then normalised key); unmatched keys are listed, never invented
//   ai-readability code < min → status failed + reason "ai-readability code N < min — top: …";
//                  code ≥ min → status untouched, delivery.gates.ai-readability copied (strict, code, origin,
//                  min, at); an `error` row → unmeasured: true, status UNTOUCHED, counted, exit 0 (the
//                  re-drive is the instrument's); the artifact's own `min` wins over --min; roll-up
//                  rollout.json.lastRun.gates.ai-readability = {strictMedian, codeMedian, below, unmeasured,
//                  measured, min, at}
//   editability    totals.dead > 0 or duplicated > 0 → failed ("editability: dead N in <block>"); errors[]
//                  (a block failed to install) → unmeasured, status untouched; blocks[] map to
//                  coverage/blocks.json by edsBlockName → delivery.ewGate pass|fail|exempt|unmeasured + ew{};
//                  roll-up lastRun.gates.editability
//   verify         --ai-readability flips < min to failed, leaves an error row unmeasured (ledger status
//                  untouched), prints the Readability line, counts it as noverdict and exits 2 while any
//                  remain; summary.json carries aiReadability{}; a clean artifact exits 0
//   usage          unknown gate name / missing artifact / bad JSON → exit 2; --help exit 0
//
// Usage: node plugins/stardust/skills/rollout/scripts/gate-ingest.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { matchPage, ingestGate, GATE_NAMES } from './update-coverage.mjs';

const HERE = import.meta.dirname;
const UC = join(HERE, 'update-coverage.mjs');
const VERIFY = join(HERE, 'verify.mjs');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const T = mkdtempSync(join(tmpdir(), 'gate-ingest-test-'));
const OUT = join(T, 'rollout'); mkdirSync(join(OUT, 'coverage'), { recursive: true });
const pagesPath = join(OUT, 'coverage', 'pages.json'); const blocksPath = join(OUT, 'coverage', 'blocks.json'); const configPath = join(OUT, 'rollout.json');
const row = (slug, path, status = 'deployed', blocks = []) => ({ slug, path, templateId: 'landing', source: { sourceHash: 'h', migratedHtml: `${path === '/' ? '' : `${path.slice(1)}/`}index.html` }, blocks, delivery: { status } });
const reset = () => {
  writeFileSync(pagesPath, JSON.stringify({ generatedAt: 'x', pages: [row('home', '/', 'deployed', ['hero']), row('about', '/about', 'verified', ['cards']), row('news', '/news/a', 'deployed', ['cards']), row('careers', '/careers', 'deployed'), row('legacy', '/About-Us.jsp', 'deployed')] }));
  writeFileSync(blocksPath, JSON.stringify({ generatedAt: 'x', blocks: [{ id: 'hero', signature: 's', delivery: { status: 'converted', edsBlockName: 'hero' } }, { id: 'cards', signature: 's', delivery: { status: 'converted', edsBlockName: 'cards' } }, { id: 'footer', signature: 's', delivery: { status: 'pending' } }] }));
  writeFileSync(configPath, JSON.stringify({ site: {}, lastRun: { at: 'x' } }));
};
const uc = (...a) => spawnSync(process.execPath, [UC, ...a, '--out', OUT], { encoding: 'utf8' });

assert.deepEqual(GATE_NAMES, ['ai-readability', 'editability']);
// matcher
reset();
const pages = json(pagesPath).pages;
assert.equal(matchPage(pages, '/about').slug, 'about');
assert.equal(matchPage(pages, 'https://main--x--y.aem.page/news/a.plain.html').slug, 'news');
assert.equal(matchPage(pages, 'content/careers.html').slug, 'careers');
assert.equal(matchPage(pages, '/about-us').slug, 'legacy', 'normalised key match (case, extension)');
assert.equal(matchPage(pages, '/nowhere'), null);

// ---- ai-readability ----
const air = { origin: 'https://main--x--y.aem.page', min: 98, generatedAt: '2026-09-18T10:00:00Z', pages: [
  { path: '/', strict: { score: 96 }, code: { score: 99 }, blocks: [] },
  { path: '/about', strict: { score: 88 }, code: { score: 91 }, blocks: [{ block: 'cards', servedGap: 40 }, { block: 'hero', servedGap: 3 }] },
  { path: '/news/a', error: 'served fetch HTTP 429' },
  { path: '/careers', strict: { score: 99 }, code: { score: 100 }, blocks: [] },
  { path: '/ghost', strict: { score: 50 }, code: { score: 50 } },
] };
writeFileSync(join(T, 'air.json'), JSON.stringify(air));
let r = uc('--gate', 'ai-readability', join(T, 'air.json'), '--min', '50');
assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
assert.match(r.stdout, /4 rows · strict median 96 · code median 99 · pages < 98: 1 → failed · unmeasured: 1 \(status untouched — re-drive\) · unmatched 1/);
assert.match(r.stderr, /unmatched .*\/ghost/);
let cov = Object.fromEntries(json(pagesPath).pages.map((p) => [p.slug, p.delivery]));
assert.equal(cov.home.status, 'deployed'); assert.deepEqual(cov.home.gates['ai-readability'], { strict: 96, code: 99, unmeasured: false, at: '2026-09-18T10:00:00Z', origin: 'https://main--x--y.aem.page', min: 98 });
assert.equal(cov.about.status, 'failed', 'the artifact min (98) wins over --min 50'); assert.equal(cov.about.error, 'ai-readability code 91 < 98 — top: cards, hero');
assert.equal(cov.news.status, 'deployed', 'unmeasured keeps its status'); assert.equal(cov.news.gates['ai-readability'].unmeasured, true); assert.equal(cov.news.gates['ai-readability'].error, 'served fetch HTTP 429');
assert.equal(cov.careers.status, 'deployed'); assert.equal(cov.legacy.gates, undefined, 'rows the artifact does not name are not written');
let cfg = json(configPath);
assert.deepEqual(cfg.lastRun.gates['ai-readability'], { strictMedian: 96, codeMedian: 99, below: 1, unmeasured: 1, measured: 3, min: 98, at: '2026-09-18T10:00:00Z' });
assert.equal(cfg.lastRun.pages.failed, 1, 'roll-ups re-derived');
// pure: no min in the artifact → --min applies
const pure = ingestGate([row('a', '/a')], 'ai-readability', { pages: [{ path: '/a', strict: { score: 90 }, code: { score: 95 } }] }, { min: 90 });
assert.equal(pure.failed, 0); assert.equal(pure.rollup.min, 90);

// ---- editability ----
reset();
const ew = [
  { content: 'content/index.html', totals: { authored: 12, editable: 12, dead: 0, duplicated: 0, exempt: 0 }, blocks: [{ block: 'hero', authored: 12, editable: 12, dead: 0, duplicated: 0, exempt: 0 }], errors: [], exemptions: {} },
  { content: 'content/about.html', totals: { authored: 9, editable: 6, dead: 3, duplicated: 0, exempt: 0 }, blocks: [{ block: 'cards', authored: 9, editable: 6, dead: 3, duplicated: 0, exempt: 0 }], errors: [], exemptions: {} },
  { content: 'content/news/a.html', totals: { authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0 }, blocks: [{ block: 'cards', authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0 }], errors: ['cards: block JS failed to install — import'], exemptions: {} },
  { url: 'https://main--x--y.aem.page/careers', totals: { authored: 4, editable: 2, dead: 0, duplicated: 0, exempt: 2 }, blocks: [{ block: 'footer', authored: 4, editable: 2, dead: 0, duplicated: 0, exempt: 2 }], exemptions: { footer: { source: '--exempt' } } },
];
writeFileSync(join(T, 'ew.json'), JSON.stringify(ew));
r = uc('--gate', 'editability', join(T, 'ew.json'));
assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
assert.match(r.stdout, /4 rows · 20\/25 editable · dead 3 · exempt 2 · unmeasured 1 \(status untouched — URL mode on preview\) · pages failed 1 · unmatched 0/);
cov = Object.fromEntries(json(pagesPath).pages.map((p) => [p.slug, p.delivery]));
assert.equal(cov.home.status, 'deployed'); assert.equal(cov.home.gates.editability.origin, 'harness'); assert.equal(cov.home.gates.editability.exemptSource, '@ew-exempt');
assert.equal(cov.about.status, 'failed'); assert.equal(cov.about.error, 'editability: dead 3 in cards');
assert.equal(cov.news.status, 'deployed', 'probe error = unmeasured, status untouched'); assert.equal(cov.news.gates.editability.unmeasured, true);
assert.equal(cov.careers.gates.editability.origin, 'url'); assert.equal(cov.careers.gates.editability.exemptSource, 'cli', 'CLI exemptions are recorded, never silent');
const blocks = Object.fromEntries(json(blocksPath).blocks.map((b) => [b.id, b.delivery]));
assert.equal(blocks.hero.ewGate, 'pass'); assert.deepEqual(blocks.hero.ew, { authored: 12, editable: 12, dead: 0, exempt: 0, duplicated: 0 });
assert.equal(blocks.cards.ewGate, 'fail', 'a block failing on one page is fail (worst page wins)');
assert.equal(blocks.footer.ewGate, 'pass', 'no edsBlockName yet → mapped by id when the probe block name equals the id (exempt rows with editable text are pass, not exempt)');
cfg = json(configPath);
assert.deepEqual(cfg.lastRun.gates.editability, { authored: 25, editable: 20, dead: 3, exempt: 2, unmeasured: 1, pagesFailed: 1, measured: 3, at: cfg.lastRun.gates.editability.at });
// unmeasured block: a probe error page marks a passing block unmeasured
reset();
writeFileSync(join(T, 'ew2.json'), JSON.stringify([ew[2]]));
uc('--gate', 'editability', join(T, 'ew2.json'));
assert.equal(json(blocksPath).blocks.find((b) => b.id === 'cards').delivery.ewGate, 'unmeasured');

// usage
assert.equal(uc('--gate', 'nope', join(T, 'air.json')).status, 2);
assert.equal(uc('--gate', 'ai-readability', join(T, 'missing.json')).status, 2);
writeFileSync(join(T, 'bad.json'), '{'); assert.equal(uc('--gate', 'ai-readability', join(T, 'bad.json')).status, 2);
assert.equal(uc('--gate', 'ai-readability', join(T, 'air.json'), '--from-ledger', 'x').status, 2, 'one mode per call');
assert.equal(spawnSync(process.execPath, [UC, '--help'], { encoding: 'utf8' }).status, 0);

// ---- verify --ai-readability (offline --root) ----
reset();
const ROOT = join(T, 'tree'); for (const d of ['', 'about', 'news/a', 'careers', 'About-Us.jsp']) { mkdirSync(join(ROOT, d), { recursive: true }); writeFileSync(join(ROOT, d, 'index.html'), '<html><body><main><h1>x</h1></main></body></html>'); }
const vr = (...a) => spawnSync(process.execPath, [VERIFY, '--root', ROOT, '--all', '--out', OUT, ...a], { encoding: 'utf8', cwd: T });
r = vr('--ai-readability', join(T, 'air.json'));
assert.equal(r.status, 2, `unmeasured → exit 2\n${r.stdout}\n${r.stderr}`);
assert.match(r.stdout, /Readability  strict median 96 · code median 99 · pages < 98: 1 · unmeasured: 1 \(exit 2/);
assert.match(r.stdout, /ai-readability below min/); assert.match(r.stdout, /ai-readability unmeasured/);
assert.match(r.stdout.trim().split('\n').pop(), /^SUMMARY verify ok=4 failed=1 noverdict=1 exit=2 /);
cov = Object.fromEntries(json(pagesPath).pages.map((p) => [p.slug, p.delivery]));
assert.equal(cov.about.status, 'failed'); assert.match(cov.about.error, /^ai-readability code 91 < 98/);
assert.equal(cov.news.status, 'verified', 'renders; the readability gate had no verdict — status from the render check, not a FAIL');
assert.equal(cov.news.gates['ai-readability'].unmeasured, true);
assert.equal(cov.home.status, 'verified'); assert.equal(cov.home.gates['ai-readability'].code, 99);
const sj = json(join(OUT, 'verify', 'summary.json'));
assert.equal(sj.aiReadability.below, 1); assert.equal(sj.aiReadability.unmeasured, 1); assert.equal(sj.unverified, 1);
assert.deepEqual(json(configPath).lastRun.gates['ai-readability'].codeMedian, 99);
// clean artifact → exit 0, no Readability unmeasured
reset();
writeFileSync(join(T, 'air-ok.json'), JSON.stringify({ ...air, pages: air.pages.filter((p) => !p.error && p.code.score >= 98 && p.path !== '/ghost') }));
r = vr('--ai-readability', join(T, 'air-ok.json'));
assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /pages < 98: 0 · unmeasured: 0$/m);
// unreadable artifact → exit 2
r = vr('--ai-readability', join(T, 'bad.json')); assert.equal(r.status, 2); assert.match(r.stderr, /pages\[\] missing|not valid|unreadable/);

rmSync(T, { recursive: true, force: true });
console.log('gate-ingest.test: ok (matcher, ai-readability below/unmeasured/roll-up, editability page + block rows, verify --ai-readability exit 2 on unmeasured, usage)');
