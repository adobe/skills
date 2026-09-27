#!/usr/bin/env node
// skills/extract/scripts/test/type-pages.test.mjs — the type-pages.mjs contract: --help before I/O,
// state building (path, headings, counts, per-type examples from OTHER pages with archetypes first),
// off mode = one skip line and exit 0, no key = skip, --dry-run touches nothing, and the shadow run
// against a fake endpoint: decisions.jsonl lines with agent + agreement, state.json roll-up, the
// _page-types.json summary, a confident disagreement listed as review. Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState, pagesOf } from '../type-pages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'type-pages.mjs');
const root = mkdtempSync(join(tmpdir(), 'type-pages-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const runSync = (args, env = {}, cwd = root) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (args, env = {}, cwd = root) => new Promise((resolve) => { execFile(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });

// fixture project: 4 pages, 2 types, one archetype per type
const proj = join(root, 'proj'); const sd = join(proj, 'stardust'); mkdirSync(join(sd, 'current', 'pages'), { recursive: true });
const pages = [
  { slug: 'home', url: 'https://example.com/', type: 'landing', status: 'approved', prototypePath: 'stardust/prototypes/home-proposed.html', history: [] },
  { slug: 'news', url: 'https://example.com/news', type: 'landing', status: 'directed', history: [] },
  { slug: 'news-a', url: 'https://example.com/news/a', type: 'article', status: 'approved', prototypePath: 'stardust/prototypes/news-a-proposed.html', history: [] },
  { slug: 'news-b', url: 'https://example.com/news/b', type: 'article', status: 'directed', history: [] },
];
writeFileSync(join(sd, 'state.json'), JSON.stringify({ _provenance: {}, site: {}, runId: 'T-1', pages }, null, 2));
for (const p of pages) writeFileSync(join(sd, 'current', 'pages', `${p.slug}.json`), JSON.stringify({ url: p.url, title: `${p.slug} title`, description: 'd', headings: [{ tag: 'h1', text: `${p.slug} heading` }, { tag: 'h2', text: 'x' }], ctas: [{}, {}], links: [{}], media: [{}], body: 'one two three' }));

await check('--help exits 0 before any I/O', () => { const r = runSync(['--help'], {}, root); assert.equal(r.code, 0); assert.match(r.out, /type-pages\.mjs/); assert.deepEqual(readdirSync(root), ['proj']); });

await check('buildState: path, headings, counts; per-type examples exclude the page itself and put archetypes first', () => {
  const ps = pages.map((p) => ({ ...p, _h1: `${p.slug} heading` }));
  const cap = JSON.parse(readFileSync(join(sd, 'current', 'pages', 'news-b.json'), 'utf8'));
  const st = buildState(ps[3], cap, ps, 3);
  assert.equal(st.page.path, '/news/b'); assert.equal(st.page.counts.ctas, 2); assert.equal(st.page.counts.words, 3); assert.equal(st.page.headings[0].text, 'news-b heading');
  assert.deepEqual(Object.keys(st.types), ['article', 'landing']);
  assert.deepEqual(st.types.article.examples, ['/news/a — "news-a heading"'], 'only the other article, never itself');
  assert.equal(st.types.landing.examples[0], '/ — "home heading"', 'the archetype (prototypePath) leads');
  assert.deepEqual(pagesOf({ pages: { a: { slug: 'a' } } }).map((p) => p.slug), ['a']);
});

await check('off mode: one skip line, exit 0, nothing written', () => {
  const r = runSync(['--dir', 'stardust'], {}, proj); assert.equal(r.code, 0, r.err); assert.match(r.out, /decider off/);
  assert.equal(existsSync(join(sd, 'decisions.jsonl')), false); assert.equal(existsSync(join(sd, 'current', '_page-types.json')), false);
  const r2 = runSync(['--dir', 'stardust'], { STARDUST_DECIDER: 'shadow' }, proj); assert.equal(r2.code, 0); assert.match(r2.out, /no \$TYPESAFE_API_KEY/);
  assert.equal(runSync(['--dir', 'nowhere'], {}, proj).code, 2);
});

await check('--dry-run prints the built state and touches nothing', () => {
  const r = runSync(['--dir', 'stardust', '--dry-run', '--mode', 'shadow'], {}, proj); assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out); assert.equal(j.pages, 4); assert.ok(j.sample.types.article);
  assert.equal(existsSync(join(sd, 'decisions.jsonl')), false);
});

// fake endpoint: news-b → landing at 0.95 (a confident disagreement); everything else agrees
const server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
  const body = JSON.parse(b); const path = body.state.page.path; const isB = path === '/news/b';
  const choice = isB ? 'landing' : path.startsWith('/news/') ? 'article' : 'landing';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-9', answers: { type: { type: 'choice', choice, confidence: 0.95, probabilities: { [choice]: 0.96, none: 0.04 } }, locale_shell: { type: 'noul', noul: 0.05 } }, usage: { input_tokens: 10, output_tokens: 2 } }));
}); });
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;

await check('shadow run: ledger lines with agent + agreement, state roll-up, summary file, review list, exit 0', async () => {
  const r = await runAsync(['--dir', 'stardust'], { STARDUST_DECIDER: 'shadow', TYPESAFE_API_KEY: 'k', STARDUST_DECIDE_ENDPOINT: endpoint }, proj);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /type-pages \[shadow\]: 4 page\(s\)/); assert.match(r.out, /jev agrees 3\/4/); assert.match(r.out, /confident disagreements 1/); assert.match(r.out, /review: news-b \(article → landing 0\.95\)/);
  const lines = readFileSync(join(sd, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 4); assert.ok(lines.every((l) => l.mode === 'shadow' && l.runId === 'T-1' && l.agent && l.agreement));
  const st = JSON.parse(readFileSync(join(sd, 'state.json'), 'utf8'));
  const nb = st.pages.find((p) => p.slug === 'news-b'); assert.equal(nb.decisions['page-type'].jev, 'landing'); assert.equal(nb.decisions['page-type'].agree, false); assert.equal(nb.type, 'article', 'shadow never changes the type');
  assert.ok(!('_cap' in nb) && !('_h1' in nb), 'no scratch keys leak into state.json');
  const sum = JSON.parse(readFileSync(join(sd, 'current', '_page-types.json'), 'utf8')); assert.equal(sum.pages['news-b'].review, true); assert.equal(sum.pages.home.review, false);
});

server.close();
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
