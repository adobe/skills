#!/usr/bin/env node
// Fixture test: rollout/scripts/open-review-pairs.mjs — the wave-close review pack (T13.2).
//
//   join       source URL from state.json pages[].url, else migrate pageMap[].sourceUrl (relative →
//              site.sourceUrl + path), else site.sourceUrl + path marked (derived); delivered URL on the
//              live host at delivery.deployedPath | path; only delivered rows (never content-pending)
//   gate       copied, never re-judged: the page's gate-report.json entry first (regime published-origin,
//              reference capturedAt), else the archetype's progress.json result (prototype regime,
//              labelled `archetype <slug>` on a sibling), else `no verdict` for a type never gated
//   selection  --per-template 1 = representative first per template; --random n --seed s deterministic
//              across runs and different for another seed; --slug a,b; --all
//   live host  a liveHost of localhost / 127.0.0.1 or a token in a URL → exit 2, nothing written;
//              no liveHost → exit 1; coverage missing → exit 1; --help exit 0; a value flag without a value →
//              exit 2 (usage — the rollout family's code; NEGATIVE: it was exit 1, the coverage-missing class)
//   files      review-pack.md (one table row per pair + the login hint) and review-pack.json; --no-open
//              writes the pack only; the script never fetches (URLs and numbers come from files)
//
// Usage: node plugins/stardust/skills/rollout/scripts/open-review-pairs.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPairs, selectRows, reviewable } from './open-review-pairs.mjs';

const HERE = import.meta.dirname;
const CLI = join(HERE, 'open-review-pairs.mjs');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const T = mkdtempSync(join(tmpdir(), 'review-pairs-test-'));
const OUT = join(T, 'stardust', 'rollout'); mkdirSync(join(OUT, 'coverage'), { recursive: true }); mkdirSync(join(T, 'stardust', 'replica'), { recursive: true });
const run = (...a) => spawnSync(process.execPath, [CLI, ...a, '--out', OUT, '--state', join(T, 'stardust', 'state.json'), '--progress', join(T, 'stardust', 'replica', 'progress.json'), '--no-open'], { encoding: 'utf8', cwd: T });

assert.equal(reviewable('https://main--s--o.aem.live/x'), true);
assert.equal(reviewable('http://localhost:3000/x'), false);
assert.equal(reviewable('https://127.0.0.1/x'), false);
assert.equal(reviewable('https://main--s--o.aem.live/x?token=abc'), false);
assert.equal(reviewable('https://main--s--o.aem.live/x#access_token=abc'), false);
assert.equal(reviewable(null), false);
assert.equal((readFileSync(CLI, 'utf8').match(/fetch\(/g) || []).length, 0, 'the pack is built from files — no request to any origin');

const row = (slug, path, templateId, status, extra = {}) => ({ slug, path, templateId, source: { sourceHash: 'h' }, blocks: [], delivery: { status, ...extra } });
const pages = [
  row('home', '/', 'landing', 'verified'), row('business', '/business', 'landing', 'deployed', { deployedPath: '/business-insurance' }),
  row('news__a', '/news/a', 'article', 'deployed'), row('news__b', '/news/b', 'article', 'verified'),
  row('prog__home', '/insurance/home', 'program', 'deployed'), row('prog__auto', '/insurance/auto', 'program', 'content-pending'),
];
const write = (liveHost) => {
  writeFileSync(join(OUT, 'coverage', 'pages.json'), JSON.stringify({ generatedAt: 'x', pages }));
  writeFileSync(join(OUT, 'coverage', 'templates.json'), JSON.stringify({ templates: [{ id: 'landing', representativeSlug: 'home', pages: ['home', 'business'] }, { id: 'article', representativeSlug: 'news__a', pages: ['news__a', 'news__b'] }, { id: 'program', representativeSlug: 'prog__home', pages: ['prog__home', 'prog__auto'] }] }));
  writeFileSync(join(OUT, 'rollout.json'), JSON.stringify({ site: { sourceUrl: 'https://www.example.example/', liveHost }, lastRun: {} }));
};
write('main--site--org.aem.live');
writeFileSync(join(T, 'stardust', 'state.json'), JSON.stringify({ pages: [{ slug: 'home', url: 'https://www.example.example/' }, { slug: 'news__a', url: 'https://www.example.example/news/a/' }, { slug: 'prog__home', url: 'https://www.example.example/insurance/home/' }], migrate: { pageMap: [{ slug: 'business', sourceUrl: '/business/', outputPath: 'business/index.html' }] } }));
writeFileSync(join(T, 'stardust', 'replica', 'progress.json'), JSON.stringify({ breakpointsConfigured: [1440, 360], archetypes: [
  { pageType: 'landing', archetype: 'home', gated: true, breakpoints: { 1440: { result: { pixelPct: 2.1, pass: true, regime: 'prototype' } }, 360: { result: { pixelPct: 3.9, pass: true, regime: 'prototype' } } } },
  { pageType: 'article', archetype: 'news__a', gated: true, breakpoints: { 1440: { result: { pixelPct: 11.6, pass: false } }, 360: { result: { pixelPct: 12.4, pass: false } } }, published: { 1440: { result: { pixelPct: 7.2, pass: true, ref: { capturedAt: '2026-09-11T00:00:00Z' } } } } },
  { pageType: 'program', archetype: 'prog__home', gated: false, breakpoints: {} },
] }));
writeFileSync(join(OUT, 'gate-report.json'), JSON.stringify({ breakpoints: [1440, 360], pages: { '/': { slug: 'home', latest: { status: 'pass', pass: true, breakpoints: { 1440: { status: 'pass', pass: true, pixelPct: 6.9 }, 360: { status: 'pass', pass: true, pixelPct: 4.2 } } }, reference: { 1440: '2026-09-18T09:20:00Z' } } } }));

// pure join
const { rows, bps } = buildPairs({ pages, config: json(join(OUT, 'rollout.json')), state: json(join(T, 'stardust', 'state.json')), progress: json(join(T, 'stardust', 'replica', 'progress.json')), gateReport: json(join(OUT, 'gate-report.json')), templates: json(join(OUT, 'coverage', 'templates.json')) });
assert.deepEqual(bps, [1440, 360]);
assert.equal(rows.length, 5, 'content-pending rows are never review pairs');
const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
assert.equal(by.home.source, 'https://www.example.example/'); assert.equal(by.home.sourceDerived, false);
assert.equal(by.home.eds, 'https://main--site--org.aem.live/');
assert.equal(by.home.regime, 'published-origin', 'the page gate entry wins over the archetype ledger'); assert.equal(by.home.gate['1440'], 'PASS 6.9 %'); assert.equal(by.home.referenceCapturedAt, '2026-09-18T09:20:00Z');
assert.equal(by.business.source, 'https://www.example.example/business/', 'sibling source from pageMap (relative → sourceUrl)'); assert.equal(by.business.eds, 'https://main--site--org.aem.live/business-insurance', 'delivered at deployedPath');
assert.equal(by.business.gate.inherited, 'home', "a sibling prints its archetype's number, labelled"); assert.equal(by.business.gate['1440'], 'PASS 2.1 %'); assert.equal(by.business.regime, 'prototype');
assert.equal(by.news__b.source, 'https://www.example.example/news/b'); assert.equal(by.news__b.sourceDerived, true, 'no state/pageMap row → derived from site.sourceUrl + path');
assert.equal(by.news__a.gate['1440'], 'PASS 7.2 %', 'published.<bp> slot first'); assert.equal(by.news__a.gate['360'], 'FAIL 12.4 %'); assert.equal(by.news__a.regime, 'published-origin');
assert.equal(by.prog__home.gate['1440'], 'no verdict', 'a type never gated prints no verdict, never fails a row'); assert.equal(by.prog__home.regime, null);
// selection
assert.deepEqual(selectRows(rows, { perTemplate: 1 }).map((r) => r.slug), ['home', 'news__a', 'prog__home'], 'representative first per template');
assert.deepEqual(selectRows(rows, { perTemplate: 2 }).length, 5);
const r1 = selectRows(rows, { random: 2, seed: 1 }).map((r) => r.slug); const r2 = selectRows(rows, { random: 2, seed: 1 }).map((r) => r.slug);
assert.deepEqual(r1, r2, 'seeded random is deterministic'); assert.equal(r1.length, 2);
{ const pool = Array.from({ length: 30 }, (_, i) => ({ slug: `p${String(i).padStart(2, '0')}`, template: 'article' })); assert.notDeepEqual(selectRows(pool, { random: 5, seed: 1 }).map((r) => r.slug), selectRows(pool, { random: 5, seed: 7 }).map((r) => r.slug), 'another seed draws another set'); assert.notDeepEqual(selectRows(pool, { random: 5, seed: 1 }).map((r) => r.slug), pool.slice(0, 5).map((r) => r.slug), 'never the head of the list'); }
assert.deepEqual(selectRows(rows, { slugs: ['news__b'] }).map((r) => r.slug), ['news__b']);

// CLI: pack files
let r = run('--per-template', '1');
assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
assert.match(r.stdout, /review pack: 3 pair\(s\) \(1 per template, representative first\)/);
const md = readFileSync(join(OUT, 'review-pack.md'), 'utf8');
assert.equal((md.match(/^\| \d+ \| /gm) || []).length, 3);
assert.match(md, /\| 1 \| landing \(archetype\) \| https:\/\/www\.example\.example\/ \| https:\/\/main--site--org\.aem\.live\/ \| PASS 6\.9 % \| PASS 4\.2 % \| published-origin \| 2026-09-18T09:20:00Z \| verified \|/);
assert.match(md, /program \(archetype\) .* no verdict \| no verdict \| — \|/);
assert.match(md, /log in to the delivered site in your own session/); assert.ok(!/https?:\/\/(localhost|127\.0\.0\.1)|[?&#]token=/.test(md), 'no localhost URL, no token in a URL (the hint sentence may name them)');
const pj = json(join(OUT, 'review-pack.json')); assert.equal(pj.rows.length, 3); assert.equal(pj.liveHost, 'https://main--site--org.aem.live');
r = run('--random', '2', '--seed', '1'); assert.equal(r.status, 0); assert.equal(json(join(OUT, 'review-pack.json')).rows.map((x) => x.slug).join(','), r1.join(','));
r = run('--all'); assert.equal(json(join(OUT, 'review-pack.json')).rows.length, 5);
r = run('--slug', 'business'); assert.match(readFileSync(join(OUT, 'review-pack.md'), 'utf8'), /\(archetype home\)/);
assert.match(r.stdout, /not opened \(--no-open\)/);
// usage: a value flag swallowing the next flag → exit 2 (NEGATIVE: exit 1, the coverage-missing class, before)
{ const u = run('--per-template', '--random'); assert.equal(u.status, 2, `usage → exit 2\n${u.stderr}`); assert.match(u.stderr, /--(per-template|random) needs a value/); }
// refusals
write('http://localhost:3000'); rmSync(join(OUT, 'review-pack.md'));
r = run('--per-template', '1'); assert.equal(r.status, 2); assert.match(r.stderr, /localhost/); assert.ok(!existsSync(join(OUT, 'review-pack.md')), 'nothing written on refusal');
write(null); r = run('--per-template', '1'); assert.equal(r.status, 1); assert.match(r.stderr, /liveHost/);
assert.equal(spawnSync(process.execPath, [CLI, '--out', join(T, 'nope'), '--no-open'], { encoding: 'utf8' }).status, 1);
assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);

rmSync(T, { recursive: true, force: true });
console.log('open-review-pairs.test: ok (join, gate copy, selection, pack files, live-host refusals, no fetch)');
