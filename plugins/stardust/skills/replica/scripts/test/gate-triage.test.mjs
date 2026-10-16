#!/usr/bin/env node
// skills/replica/scripts/test/gate-triage.test.mjs — gate-triage.mjs, no browser (chrome-parity is a stub):
// block share + scope, encoder vs capture, layout (asymmetric origins excluded), group ordering + share,
// the routed request lines byte-for-byte under a real foundation freeze + idempotent re-runs, --dry-run
// writes nothing, --help in an empty dir, P3/P4 row fields tolerated, runs/ merge (newest row per page),
// parsePairMsg on chrome-parity's message shapes. Fixtures are built in a temp project per check.
// Run: node <this file>   (TMPDIR may point at a scratch dir)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockOf, classifyRow, parsePairMsg, requestLine } from '../gate-triage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-triage.mjs');
const FREEZE = join(HERE, '..', 'foundation-freeze.mjs');
const GATE = 'stardust/replica/gates/all-1440';
const GATE360 = 'stardust/replica/gates/all-360';
const T1 = '2026-10-01T00:00:00.000Z';
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.stack || e.message).split('\n').slice(0, 8).join('\n  ')}`); } };
const put = (root, rel, data) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const live = (s) => `https://www.example.com/${s}`; const build = (s) => `https://main--site--org.aem.page/${s}`;

// one gate-all row (the recorded shape: template null); passing unless overridden
const row = (slug, o = {}) => ({ slug, path: `/${slug}`, template: null, tier: 'thin', origin: 'stitch-live', originAsymmetric: false, eds: 'stitch-live', pct: 3, textPct: null, heightDelta: 0, originH: 8000, edsH: 8000, pixelPass: true, heightPass: true, clipped: 0, clipPass: true, clipAllowance: 0, contentPass: true, contentNA: null, unitPass: null, pixelOnlyPass: true, pass: true, passWithOverride: true, reasons: [], clipGroups: [], clipAllowReason: null, content: null, units: null, unitsRequired: false, unitsError: null, browser: 'chrome', override: null, masked: false, maskedRows: 0, maskReason: null, hotBands: [], error: null, ...o });
const CARD_GROUP = { kind: 'TEXT CLIPPED', advisory: false, n: 3, clipper: 'div.cards-card-body', path: 'div.cards.block > ul > li > div.cards-card-body', text: 'Card one body text here' };
const contentOf = (slug, { items = [], findings = [], totals = {}, docH = 4000 } = {}) => ({ _provenance: { writtenBy: 'content-presence.mjs', at: T1, width: 1440 }, origin: { url: live(slug), root: 'main', docH, items: [] }, eds: { url: build(slug), root: 'main', docH, items }, bands: [], findings, totals: { missing: 0, hidden: 0, missingHeadings: 0, hiddenHeadings: 0, missingLinks: 0, hiddenLinks: 0, controlState: 0, ...totals } });
const cardItem = { kind: 'text', state: 'visible', variable: false, inRoot: true, inChrome: false, path: 'div.cards.block > ul > li > div.cards-card-body', x: 0, y: 600, w: 300, h: 40, text: 'card one body text here' };

// fixture pieces: { rows: [...], files: { '<slug>/<kind>.json': data }, pages: [{slug, templateId}], captures: {slug: html} }
const A = {
  rows: [row('p1', { pct: 6, clipped: 3, clipPass: false, pass: false, reasons: ['clipped 3'], clipGroups: [CARD_GROUP] }), row('p2', { pct: 4, clipped: 3, clipPass: false, pass: false, reasons: ['clipped 3'], clipGroups: [CARD_GROUP] })],
  files: { 'p1/content.json': contentOf('p1', { items: [cardItem] }), 'p2/content.json': contentOf('p2', { items: [cardItem] }) },
  pages: [['p1', 't1'], ['p2', 't1'], ['p3', 't1'], ['p4', 't1']],
};
const missingLink = { sev: '🔴', kind: 'MISSING LINK', msg: '"Contact us" → /contact in band "(top)" (origin y 900) not on the served page', band: 0, n: 1, text: 'Contact us', href: '/contact' };
const failContent = (slug) => row(slug, { contentPass: false, pass: false, reasons: ['content MISSING 1 / HIDDEN 0'], content: { missing: 1, hidden: 0, controlState: 0 } });
const B = {
  rows: [failContent('p5'), failContent('p6'), failContent('p7')],
  files: Object.fromEntries(['p5', 'p6', 'p7'].map((s) => [`${s}/content.json`, contentOf(s, { findings: [missingLink], totals: { missing: 1, missingLinks: 1 } })])),
  pages: [['p5', 't2'], ['p6', 't2'], ['p7', 't2']],
  captures: { p5: '<main><a href="/contact">Contact&nbsp;us</a></main>', p6: '<p>Contact <b>us</b></p>', p7: '<main><p>Other text only</p></main>' },
};
const bands6 = [8, 20, 30, 40, 50, 5].map((pct, i) => ({ y0: i * 500, y1: (i + 1) * 500, pct }));
const C = {
  rows: [row('p8', { pct: 12, pixelPass: false, heightPass: false, pixelOnlyPass: false, pass: false, heightDelta: 1200, originH: 8000 }), row('p9', { pct: 20, pixelPass: false, pixelOnlyPass: false, pass: false })],
  files: { 'p9/pixel.json': { pct: 20, heightDelta: 0, compared: { width: 1440, height: 3000, mode: 'overlap' }, bands: bands6 } },
  pages: [['p8', 't3'], ['p9', 't3']],
};
const ASYM = { rows: [row('p8x', { pct: 12, pixelPass: false, heightPass: false, pixelOnlyPass: false, pass: false, heightDelta: 1200, originH: 8000, origin: 'crawl-fullpage', originAsymmetric: true })], files: {}, pages: [['p8x', 't3']] };
const footerBands = [0, 500, 1000, 1500, 2000, 2500, 3000].map((y0) => ({ y0, y1: y0 + 500, pct: y0 === 3000 ? 40 : 2 }));
const footerItem = { kind: 'link', state: 'visible', variable: false, inRoot: false, inChrome: true, path: 'div.legal > ul > li > a', x: 10, y: 3100, w: 80, h: 20, text: 'privacy' };
const E = {
  rows: [row('p10', { pct: 14, pixelPass: false, pixelOnlyPass: false, pass: false, hotBands: ['3000-3500:40%'] }), row('p11', { pct: 12, pixelPass: false, pixelOnlyPass: false, pass: false, hotBands: ['3000-3500:40%'] })],
  files: Object.fromEntries(['p10', 'p11'].flatMap((s) => [[`${s}/pixel.json`, { pct: 13, compared: { width: 1440, height: 3600 }, bands: footerBands }], [`${s}/content.json`, contentOf(s, { items: [footerItem], docH: 3600 })]])),
  pages: [['p10', 'landing'], ['p11', 'landing']],
};
const merge = (...parts) => ({ rows: parts.flatMap((p) => p.rows), files: Object.assign({}, ...parts.map((p) => p.files)), pages: parts.flatMap((p) => p.pages), captures: Object.assign({}, ...parts.map((p) => p.captures || {})) });

// chrome-parity stand-in: logs its argv, prints parity-out/<slug>.json (slug = the build URL's last segment)
const STUB = `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
appendFileSync(join(here, 'parity-calls.jsonl'), JSON.stringify(args) + '\\n');
const slug = new URL(args[1]).pathname.split('/').filter(Boolean).pop();
const perWidth = join(here, 'parity-out', slug + '-' + args[args.indexOf('--width') + 1] + '.json');
const out = JSON.parse(readFileSync(existsSync(perWidth) ? perWidth : join(here, 'parity-out', slug + '.json'), 'utf8'));
out.liveCache = { file: args[args.indexOf('--live-cache') + 1], probedAt: new Date().toISOString() };
console.log(JSON.stringify(out));
process.exit(out.regions.some((r) => r.findings.length) ? 2 : 0);
`;
const parityResult = (slug, regions) => ({ live: live(slug), build: build(slug), width: 1440, tolerance: 1, liveCache: null, regions: regions.map(([name, findings]) => ({ name, findings, pairs: findings.length, inventory: { live: { atoms: 4, icons: 0 }, build: { atoms: 4, icons: 0 } } })), raw: { live: {}, build: {} } });
const PARITY_E = {
  p1: parityResult('p1', [['main', [{ kind: 'PAIR', text: 'Card one body text here', msg: 'fontFamily arial → helvetica' }, { kind: 'PAIR', text: 'Unrelated hero line', msg: 'fontSize 40px → 32px' }]]]),
  p10: parityResult('p10', [['footer', [{ kind: 'PAIR', text: 'Privacy', msg: 'fontSize 14px → 16px; fontFamily arial → helvetica' }]]]),
};

// one gate table dir: summary.json (+ runs/), per-page evidence, origin.json / eds.json with the page URLs
function writeGate(root, dir, width, spec, { summary = {}, runs = [] } = {}) {
  put(root, `${dir}/summary.json`, { _provenance: { writtenBy: 'gate-all.mjs', writtenAt: T1, stage: 'published', breakpoint: width, threshold: 10, heightTolerance: 0.05, clipMax: 0, unitTol: 4, origin: 'https://www.example.com', eds: 'https://main--site--org.aem.page', edsHostOverride: null, only: null }, totals: {}, rows: spec.rows, ...summary });
  for (const [rel, data] of Object.entries(spec.files)) put(root, `${dir}/${rel}`, data);
  for (const r of spec.rows) { put(root, `${dir}/${r.slug}/origin.json`, { instrument: 'stitch-live', url: live(r.slug), at: T1 }); put(root, `${dir}/${r.slug}/eds.json`, { instrument: 'stitch-live', url: build(r.slug), at: T1 }); }
  for (const { name, writtenAt, rows, edsHostOverride = null } of runs) put(root, `${dir}/runs/${name}`, { _provenance: { writtenBy: 'gate-all.mjs', writtenAt, breakpoint: width, heightTolerance: 0.05, edsHostOverride, only: rows.map((r) => r.slug) }, totals: {}, rows });
}
function mkProject(spec, { summary = {}, runs = [], parityOut = null, mobile = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gate-triage-'));
  writeGate(root, GATE, 1440, spec, { summary, runs });
  if (mobile) writeGate(root, GATE360, 360, mobile);
  put(root, 'stardust/rollout/coverage/blocks.json', { blocks: [{ id: 'cards', label: 'Cards', kind: 'module', usedByTemplates: ['t1'], usedByPages: ['p1', 'p2', 'p3'], instanceCount: 3, delivery: { status: 'pending', edsBlockName: 'cards' } }] });
  put(root, 'stardust/rollout/coverage/pages.json', { pages: spec.pages.map(([slug, templateId]) => ({ slug, path: `/${slug}`, templateId, source: { sourceUrl: live(slug) }, blocks: [], delivery: { status: 'deployed', deployedUrl: build(slug) } })) });
  for (const [slug, html] of Object.entries(spec.captures || {})) put(root, `stardust/current/pages/${slug}.html`, html);
  put(root, 'parity-stub.mjs', STUB);
  for (const [slug, out] of Object.entries(parityOut || {})) put(root, `parity-out/${slug}.json`, out);
  return root;
}
const run = (root, args) => spawnSync(process.execPath, [SCRIPT, '--root', root, '--parity-script', join(root, 'parity-stub.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
const ok = (r) => { assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}\n${r.stdout}`); return r; };
const readT = (root) => JSON.parse(readFileSync(join(root, GATE, 'triage.json'), 'utf8'));
const withProject = (spec, o, fn) => { const root = mkProject(spec, o); try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const calls = (root) => (existsSync(join(root, 'parity-calls.jsonl')) ? readFileSync(join(root, 'parity-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const treeHash = (root) => { const out = []; (function walk(d) { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) { out.push(`d ${relative(root, p)}`); walk(p); } else out.push(`f ${relative(root, p)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`); } }(root)); return out.join('\n'); };
const causes = (t) => t.groups.map((g) => g.cause);

check('(a) block share: two clipped card pages → one block:cards group, scope = rows ∪ usedByPages ∪ template siblings', () => withProject(A, {}, (root) => {
  ok(run(root, ['--no-parity']));
  const t = readT(root);
  assert.deepEqual(causes(t), ['block:cards']);
  const g = t.groups[0];
  assert.deepEqual(g.rows.map((r) => r.row), ['p1@1440', 'p2@1440']);
  assert.deepEqual(g.scope.pages, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(g.route, 'cluster'); assert.equal(g.requestLine, null); assert.equal(g.frozen, false);
  assert.equal(g.rows[0].source, `${GATE}/summary.json`); assert.deepEqual(g.templates, ['t1']);
  assert.match(g.scope.commands[0], /^node stardust\/scripts\/replica\/gate-all\.mjs --only p1,p2,p3,p4 --width 1440$/);
  assert.ok(existsSync(join(root, GATE, 'triage.md')));
  assert.equal(existsSync(join(root, 'stardust/rollout/foundation-requests.md')), false, 'a non-frozen block is never routed');
}));
check('(a) blockOf: longest name wins, .block fallback without coverage, header/footer tags', () => {
  assert.equal(blockOf('div.cards-card-body', ['card', 'cards']), 'cards');
  assert.equal(blockOf('div.card-x > span', ['card', 'cards']), 'card');
  assert.equal(blockOf('div.teaser.block > div > p', []), 'teaser');
  assert.equal(blockOf('footer > div.legal > a', ['cards']), 'footer');
  assert.equal(blockOf('header#top > nav > a', []), 'header');
  assert.equal(blockOf('div.plain > p', ['cards']), null);
});
check('(b) encoder: MISSING links whose text is in the capture → encoder:t2; a capture without it → capture:<slug>', () => withProject(B, {}, (root) => {
  ok(run(root, ['--no-parity']));
  const t = readT(root);
  assert.deepEqual(causes(t), ['encoder:t2']);
  assert.deepEqual(t.groups[0].rows.map((r) => r.row), ['p5@1440', 'p6@1440']);
  assert.equal(t.groups[0].route, 'cluster'); assert.match(t.groups[0].rows[0].evidence[0], /in capture: yes/);
  assert.deepEqual(t.ungrouped.map((u) => [u.row, u.cause]), [['p7@1440', 'capture:p7']]);
  assert.deepEqual(t.groups[0].scope.pages, ['p5', 'p6', 'p7'], 'encoder scope = the template\'s pages');
}));
check('(c) layout: Δh > 2 × tolerance and hot bands over most of the page → layout:t3 (re-prototype); an asymmetric origin is not layout', () => withProject(merge(C, ASYM), {}, (root) => {
  ok(run(root, ['--no-parity']));
  const t = readT(root);
  assert.deepEqual(causes(t), ['layout:t3']);
  const g = t.groups[0];
  assert.deepEqual(g.rows.map((r) => r.row), ['p9@1440', 'p8@1440']);
  assert.equal(g.route, 're-prototype'); assert.match(g.action, /^re-prototype candidate/);
  assert.deepEqual(g.rows.find((r) => r.slug === 'p8').criteria, ['height']); assert.deepEqual(g.rows.find((r) => r.slug === 'p9').criteria, ['pixel']);
  assert.deepEqual(t.ungrouped.map((u) => u.cause), ['page:p8x@1440']);
  assert.ok(g.scope.pages.includes('p8x'), 'template siblings are in the scope');
}));
check('(d) ordering: score, then kind rank, then cause; ids G1–G3; share over the failing rows', () => withProject(merge(A, B, C), {}, (root) => {
  const r = ok(run(root, ['--no-parity']));
  const t = readT(root);
  assert.deepEqual(t.groups.map((g) => [g.id, g.cause, g.score]), [['G1', 'block:cards', 6], ['G2', 'encoder:t2', 6], ['G3', 'layout:t3', 4]]);
  assert.deepEqual(t.totals, { rows: 7, failing: 7, errors: 0, grouped: 6, share: 0.857, groups: 3, routed: 0 });
  const md = readFileSync(join(root, GATE, 'triage.md'), 'utf8');
  assert.match(md, /^# Gate triage — 7 failing rows, 6 in 3 shared-cause groups \(85\.7 %\)\n/);
  assert.match(md, /\| G1 \| `block:cards` \| 2 \| p1, p2 \| clip 2 \| cluster \|/);
  assert.match(md, /## Not grouped\n\n\| row \| cause \| criteria \| evidence \|\n\|---\|---\|---\|---\|\n\| p7@1440 \| `capture:p7` \| content \|/);
  assert.ok(md.endsWith('\n'));
  assert.equal(r.stdout.trim().split('\n').pop(), '{"failing":7,"grouped":6,"share":0.857,"groups":3,"routed":0}');
}));
check('(d) a score tie is broken by kind rank (selector before encoder) before the cause key; a one-row cause is never a group', () => {
  const strip = { kind: 'TEXT CLIPPED', advisory: false, n: 2, clipper: 'div.promo-strip', path: 'div.promo-strip', text: 'Free delivery today' };
  const lone = { ...strip, clipper: 'div.lonely-note', path: 'div.lonely-note' };
  const S = { rows: [...['s1', 's2'].map((s) => row(s, { clipped: 2, clipPass: false, pass: false, clipGroups: [strip] })), row('s3', { clipped: 2, clipPass: false, pass: false, clipGroups: [lone] })], files: {}, pages: [['s1', 't5'], ['s2', 't5'], ['s3', 't5']] };
  withProject(merge(S, B), {}, (root) => {
    ok(run(root, ['--no-parity'])); const t = readT(root);
    assert.deepEqual(t.groups.map((g) => [g.cause, g.score]), [['selector:div.promo-strip', 6], ['encoder:t2', 6]]);
    assert.deepEqual(t.ungrouped.map((u) => [u.row, u.cause]), [['p7@1440', 'capture:p7'], ['s3@1440', 'selector:div.lonely-note']]);
  });
});
check('(e) frozen footer + a shared token → two request lines byte-for-byte; the freeze check stays clean; a re-run is byte-identical', () => withProject(merge(A, E), { parityOut: PARITY_E }, (root) => {
  put(root, 'styles/styles.css', 'body { font-family: arial; }\n');
  put(root, 'blocks/footer/footer.css', 'footer { font-size: 14px; }\n');
  const manifest = join(root, 'stardust/rollout/foundation-freeze.json');
  const fz = spawnSync(process.execPath, [FREEZE, 'freeze', '--root', root, '--out', manifest], { encoding: 'utf8' });
  assert.equal(fz.status, 0, fz.stderr);
  const bad = run(root, ['--unit', 'cluster-a', '--requests', join(root, 'styles/requests.md')]);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /inside the frozen path styles\//);
  assert.equal(existsSync(join(root, 'styles/requests.md')), false); assert.equal(existsSync(join(root, GATE, 'triage.json')), false); assert.deepEqual(calls(root), []);
  const r1 = ok(run(root, ['--unit', 'cluster-a']));
  const t = readT(root);
  assert.deepEqual(t.groups.map((g) => [g.id, g.cause, g.score, g.route]), [['G1', 'token:fontFamily:arial→helvetica', 12, 'foundation-request'], ['G2', 'block:cards', 6, 'cluster'], ['G3', 'block:footer', 2, 'foundation-request']]);
  const expected = `${[
    '- cluster-a | token fontFamily arial → helvetica (styles/) | gate-triage token:fontFamily:arial→helvetica@1440: 4 failing rows (1440 ×4), pixel 2, clip 2; chrome-parity in 2 groups (block:cards, block:footer) | landing, t1',
    '- cluster-a | footer block (blocks/footer/): fontFamily arial → helvetica ×1; fontSize 14px → 16px ×1 | gate-triage block:footer@1440: 2 failing rows (1440 ×2), pixel 2; chrome-parity p10@1440: findings 1 | landing',
  ].join('\n')}\n`;
  const queue = readFileSync(join(root, 'stardust/rollout/foundation-requests.md'), 'utf8');
  assert.equal(queue, expected);
  for (const l of queue.trim().split('\n')) assert.match(l, /^- [^|\n]+ \| [^|\n]+ \| [^|\n]+ \| [^|\n]+$/);
  assert.deepEqual(calls(root), [
    [live('p1'), build('p1'), '--no-defaults', '--region', 'main=main|main', '--width', '1440', '--json', '--live-cache', `${GATE}/triage-parity/p1-1440.live.json`, '--locale', 'en-US'],
    [live('p10'), build('p10'), '--no-defaults', '--region', 'footer=footer', '--width', '1440', '--json', '--live-cache', `${GATE}/triage-parity/p10-1440.live.json`, '--locale', 'en-US'],
  ]);
  assert.deepEqual(t.groups[1].parity.deltas, [{ prop: 'fontFamily', from: 'arial', to: 'helvetica', n: 1 }], 'main-region findings filtered to the block\'s own texts');
  assert.deepEqual(t.groups[1].tokens, ['token:fontFamily:arial→helvetica']);
  assert.doesNotMatch(readFileSync(join(root, GATE, 'triage.json'), 'utf8'), /probedAt|liveCache/);
  assert.match(r1.stdout, /request appended: token:fontFamily:arial→helvetica/); assert.match(r1.stdout, /parity p1@1440: ran exit 2/);
  const fc = spawnSync(process.execPath, [FREEZE, 'check', '--root', root, '--manifest', manifest], { encoding: 'utf8' });
  assert.equal(fc.status, 0, fc.stdout);
  assert.deepEqual(t.groups.map((g) => g.scope.when ?? null), ['C-final, after the queue is applied', null, 'C-final, after the queue is applied']);
  const md1 = readFileSync(join(root, GATE, 'triage.md'), 'utf8');
  assert.match(md1, /\| G3 \| `block:footer` .*\| C-final: 6 pages \|/); assert.match(md1, /- re-gate scope \(C-final, after the queue is applied — not a cluster step\): 6 pages/);
  assert.match(md1, /act on causes with rows on your own pages/);
  const before = ['triage.json', 'triage.md'].map((f) => readFileSync(join(root, GATE, f), 'utf8'));
  const r2 = ok(run(root, ['--unit', 'cluster-a']));
  assert.deepEqual(['triage.json', 'triage.md'].map((f) => readFileSync(join(root, GATE, f), 'utf8')), before);
  assert.equal(readFileSync(join(root, 'stardust/rollout/foundation-requests.md'), 'utf8'), expected);
  assert.equal(calls(root).length, 2, 'stored parity results reused — no new spawn');
  assert.match(r2.stdout, /request already queued: block:footer@1440/); assert.match(r2.stdout, /parity p10@1440: reused/);
  ok(run(root, ['--unit', 'cluster-b']));
  assert.equal(readFileSync(join(root, 'stardust/rollout/foundation-requests.md'), 'utf8'), expected, 'another unit never queues a copy of the same cause@width');
}));
check('(f) --dry-run writes nothing and spawns nothing; prints triage.md and the lines it would append', () => withProject(merge(A, E), { parityOut: PARITY_E }, (root) => {
  const before = treeHash(root);
  const r = ok(run(root, ['--unit', 'cluster-a', '--dry-run']));
  assert.equal(treeHash(root), before);
  assert.equal(existsSync(join(root, 'parity-calls.jsonl')), false);
  assert.match(r.stdout, /^# Gate triage — 4 failing rows/m);
  assert.match(r.stdout, /would append: - cluster-a \| footer block \(blocks\/footer\/\): property diff not run \(dry-run: no stored result\) \| gate-triage block:footer@1440: 2 failing rows \(1440 ×2\), pixel 2 \| landing\n/);
}));
check('(k) one frozen cause at two widths → one request line per width with its own deltas; --parity-max is one budget per run', () => withProject(E, { mobile: E, parityOut: { p10: PARITY_E.p10, 'p10-360': parityResult('p10', [['footer', [{ kind: 'PAIR', text: 'Privacy', msg: 'fontSize 13px → 15px' }]]]) } }, (root) => {
  ok(run(root, ['--unit', 'cluster-a', '--parity-max', '1', '--no-route']));
  assert.equal(calls(root).length, 1, 'one live navigation over both widths');
  const m = JSON.parse(readFileSync(join(root, GATE360, 'triage.json'), 'utf8'));
  assert.deepEqual(m.groups.map((g) => [g.cause, g.parity]), [['block:footer', { skipped: 'over --parity-max 1' }]]);
  assert.equal(existsSync(join(root, 'stardust/rollout/foundation-requests.md')), false);
  const r = ok(run(root, ['--unit', 'cluster-a']));
  assert.equal(calls(root).length, 2, '1440 reused, 360 probed');
  assert.equal(readFileSync(join(root, 'stardust/rollout/foundation-requests.md'), 'utf8'), `${[
    '- cluster-a | footer block (blocks/footer/): fontFamily arial → helvetica ×1; fontSize 14px → 16px ×1 | gate-triage block:footer@1440: 2 failing rows (1440 ×2), pixel 2; chrome-parity p10@1440: findings 1 | landing',
    '- cluster-a | footer block (blocks/footer/): fontSize 13px → 15px ×1 | gate-triage block:footer@360: 2 failing rows (360 ×2), pixel 2; chrome-parity p10@360: findings 1 | landing',
  ].join('\n')}\n`);
  assert.match(r.stdout, /request appended: block:footer@1440\nrequest appended: block:footer@360/);
}));
check('(l) re-gate commands keep each page\'s own --eds-host (its newest row\'s table), one command per host', () => {
  const host = (b) => `https://${b}--site--org.aem.page`;
  const clipFail = (s) => row(s, { pct: 5, clipped: 3, clipPass: false, pass: false, clipGroups: [CARD_GROUP] });
  const spec = { rows: [row('p1'), row('p2'), row('p3')], files: {}, pages: A.pages };
  const runs = [
    { name: '2026-10-02T00-00-00-000Z-p1.json', writtenAt: '2026-10-02T00:00:00.000Z', edsHostOverride: host('fix-a'), rows: [clipFail('p1')] },
    { name: '2026-10-03T00-00-00-000Z-p2.json', writtenAt: '2026-10-03T00:00:00.000Z', edsHostOverride: host('fix-b'), rows: [clipFail('p2')] },
    { name: '2026-10-04T00-00-00-000Z-p9.json', writtenAt: '2026-10-04T00:00:00.000Z', rows: [row('p9')] },
  ];
  const cmd = (only, h) => `node stardust/scripts/replica/gate-all.mjs --only ${only} --width 1440${h ? ` --eds-host ${h}` : ''}`;
  withProject(spec, { runs }, (root) => {
    ok(run(root, ['--no-parity'])); const { scope } = readT(root).groups[0];
    assert.deepEqual(scope.commands, [cmd('p3,p4'), cmd('p1', host('fix-a')), cmd('p2', host('fix-b'))], 'the newest table (no host) decides nothing');
    assert.match(scope.note, /p4 .*2 eds hosts/);
  });
  withProject(spec, { runs: [{ ...runs[0], rows: [clipFail('p1'), clipFail('p2')] }, runs[2]] }, (root) => {
    ok(run(root, ['--no-parity'])); const { scope } = readT(root).groups[0];
    assert.deepEqual(scope.commands, [cmd('p3'), cmd('p1,p2,p4', host('fix-a'))], 'a page without a row takes the group\'s single host');
    assert.equal(scope.note, undefined);
  });
});
check('(m) a request whose property diff did not run says so; a later real diff is queued once beside it, then nothing', () => {
  const g = { route: 'foundation-request', kind: 'block', name: 'footer', cause: 'block:footer', rows: [{ width: 360 }], criteria: { pixel: 1 }, templates: ['t'] };
  const what = (parity) => requestLine({ ...g, parity }, { unit: 'u' }).split(' | ')[1];
  assert.equal(what(null), 'footer block (blocks/footer/): property diff not run (parity off)');
  assert.equal(what({ skipped: 'over --parity-max 4' }), 'footer block (blocks/footer/): property diff not run (over --parity-max 4)');
  assert.equal(what({ error: 'chrome-parity exit 3: bot challenge' }), 'footer block (blocks/footer/): property diff not run (chrome-parity exit 3: bot challenge)');
  assert.equal(what({ page: 'p@360', exit: 0, total: 0, deltas: [], kinds: {} }), 'footer block (blocks/footer/): no property diff');
  withProject(E, { parityOut: PARITY_E }, (root) => {
    const queue = () => readFileSync(join(root, 'stardust/rollout/foundation-requests.md'), 'utf8').trim().split('\n');
    ok(run(root, ['--unit', 'cluster-a', '--no-parity']));
    assert.deepEqual(queue().map((l) => l.split(' | ')[1]), ['footer block (blocks/footer/): property diff not run (parity off)']);
    const r = ok(run(root, ['--unit', 'cluster-a']));
    assert.match(r.stdout, /request appended \(property diff now run\): block:footer@1440/);
    assert.deepEqual(queue().map((l) => l.split(' | ')[1]), ['footer block (blocks/footer/): property diff not run (parity off)', 'footer block (blocks/footer/): fontFamily arial → helvetica ×1; fontSize 14px → 16px ×1']);
    const before = queue();
    ok(run(root, ['--unit', 'cluster-a'])); ok(run(root, ['--unit', 'cluster-b', '--no-parity']));
    assert.deepEqual(queue(), before, 'idempotent: a real line for the cause@width exists');
  });
});
check('(n) with stardust/rollout/units/<unit>.paths, stdout names own vs another unit\'s groups; the shared triage files stay unit-free', () => withProject(merge(A, B), {}, (root) => {
  put(root, 'stardust/rollout/units/cluster-a.paths', '/p1\n/p2.html\n');
  const shared = () => ['triage.json', 'triage.md'].map((f) => readFileSync(join(root, GATE, f), 'utf8'));
  const r = ok(run(root, ['--unit', 'cluster-a', '--no-parity']));
  assert.match(r.stdout, /^triage → [^\n]+\nunit cluster-a @1440: own: G1 · another unit's: G2$/m);
  const a = shared();
  assert.doesNotMatch(a.join('\n'), /unitRows|another unit's|cluster-a|units\//);
  const z = ok(run(root, ['--unit', 'cluster-z', '--no-parity']));
  assert.deepEqual(shared(), a, 'byte-identical across --unit values');
  assert.doesNotMatch(z.stdout, /^unit /m, 'no paths file → no unit view');
}));
check('(g) --help in an empty dir: exit 0, usage on stdout, nothing written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-triage-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0); assert.match(r.stdout, /usage/i); assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
check('(h) P3/P4 fields (reused, at, gateKey, originReused, presenceReused, oneLoad, origin {instrument: reused}) change nothing', () => {
  let base = null;
  withProject(A, {}, (root) => { ok(run(root, ['--no-parity'])); base = readT(root).groups; });
  const from = (r) => `stardust/replica/gates/all-1440/${r.slug}/origin.png`;
  const p34 = { ...A, rows: A.rows.map((r, i) => ({ ...r, at: T1, gateKey: 'k', origin: { instrument: 'reused', from: `stardust/replica/gates/${r.slug}-1440/live.png`, at: T1 },
    reused: i ? { what: 'probes', at: T1 } : true, originReused: { from: from(r), at: T1, policy: 'fix-round', stale: null },
    presenceReused: { from: `stardust/replica/gates/all-1440/${r.slug}/presence-origin.json`, at: T1, policy: 'fix-round' }, oneLoad: { via: 'probes', fallback: 'no inventory' } })) };
  withProject(p34, { summary: { reused: true, at: T1, gateKey: 'k' } }, (root) => { ok(run(root, ['--no-parity'])); assert.deepEqual(readT(root).groups, base); });
});
check('(i) runs/: the newest row per page wins, gateRuns counts every row; --no-runs reads summary.json only', () => {
  const clipFail = (s) => row(s, { pct: 5, clipped: 3, clipPass: false, pass: false, clipGroups: [CARD_GROUP] });
  const runs = [{ name: '2026-09-30T00-00-00-000Z-p1.json', writtenAt: '2026-09-30T00:00:00.000Z', rows: [row('p1'), row('p2')] }, { name: '2026-10-02T00-00-00-000Z-p2.json', writtenAt: '2026-10-02T00:00:00.000Z', rows: [row('p2')] }];
  withProject({ rows: [clipFail('p1'), clipFail('p2'), clipFail('p3')], files: {}, pages: [] }, { runs }, (root) => {
    ok(run(root, ['--no-parity']));
    let t = readT(root);
    assert.equal(t.totals.failing, 2, 'p2 passed in a newer --only run; p1\'s passing run is older than the summary');
    assert.deepEqual(t.groups[0].rows.map((r) => [r.row, r.gateRuns, r.source]), [['p1@1440', 2, `${GATE}/summary.json`], ['p3@1440', 1, `${GATE}/summary.json`]]);
    assert.equal(t._provenance.inputs.length, 3);
    ok(run(root, ['--no-parity', '--no-runs']));
    t = readT(root);
    assert.equal(t.totals.failing, 3); assert.deepEqual(t.groups[0].rows.map((r) => r.gateRuns), [1, 1, 1]); assert.equal(t._provenance.inputs.length, 1);
  });
});
check('(j) parsePairMsg: rect, box, box style, tag and style parts of a chrome-parity PAIR message', () => {
  assert.deepEqual(parsePairMsg('color rgb(0, 0, 0) → rgb(17, 17, 17); Δy +12px (100→112)'), [{ prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(17, 17, 17)' }, { prop: 'Δy', from: null, to: '+12px' }]);
  assert.deepEqual(parsePairMsg('<a> box 97×40 → 71×32'), [{ prop: 'box', from: '97×40', to: '71×32' }]);
  assert.deepEqual(parsePairMsg('<button> backgroundColor rgb(0, 0, 0) → rgba(0, 0, 0, 0)'), [{ prop: 'box.backgroundColor', from: 'rgb(0, 0, 0)', to: 'rgba(0, 0, 0, 0)' }]);
  assert.deepEqual(parsePairMsg('tag <p> → <span>; Δw -26px (97→71)'), [{ prop: 'tag', from: 'p', to: 'span' }, { prop: 'Δw', from: null, to: '-26px' }]);
});
check('classifyRow: a HIDDEN link resolves to its served block; unit deltas to the unit\'s block, family named', () => {
  const r = row('q1', { contentPass: false, pass: false, unitPass: false, units: { off: 2, hidden: 0, missing: 0 } });
  const content = contentOf('q1', { items: [{ kind: 'link', state: 'hidden', inChrome: false, path: 'div.tabs.block > ul > li > a', y: 900, text: 'shop  now' }], findings: [{ kind: 'HIDDEN LINK', text: 'Shop now', n: 1 }], totals: { hidden: 1, hiddenLinks: 1 } });
  const units = { results: [{ sel: '.tile=div.tiles > ul > li', units: [{ index: 0, eds: { path: 'div.tiles.block > ul > li' }, summary: { off: 2, hidden: 0, missing: 0 } }] }] };
  const { causes: cs } = classifyRow(r, { content, units }, { names: ['tabs', 'tiles'], template: 't9', width: 1440, families: { tile: { origin: '.tile', build: 'div.tiles > ul > li' } } });
  assert.deepEqual(cs.map((c) => [c.cause, c.criteria]), [['block:tabs', ['content']], ['block:tiles', ['units']]]);
  assert.match(cs[1].evidence[0], /family tile/);
  const lone = classifyRow(row('q2', { unitPass: false, pass: false }), {}, { width: 1440 }).causes;
  assert.deepEqual(lone.map((c) => [c.cause, c.criteria]), [['page:q2@1440', ['units']]], 'nothing attributable → page:<slug>@<w>, named by its failing criterion');
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
