#!/usr/bin/env node
// skills/replica/scripts/test/gate-all.test.mjs — the gate-all.mjs verdict (#125 D0), no browser: the four
// criteria (pixel, height, clip + allowance, content), n/a content never fails a page, required vs advisory
// units, pixelOnlyPass vs pass (the calibration pair), reasons text, overrides shown beside the number;
// formatSummary (header, calibration line, one row per page, asymmetric-origin flag, the reused cell); parseArgs
// defaults and --out derived from --width; --help in an empty cwd; pixel-compare's textBoxPct over a synthetic diff.
// Reuse under --skip-existing: probeReuse (the capture pair rule), the gate key (stable across key order, changed by
// one block / content / frozen-file byte or a mask edit, null on a freeze mismatch), the deploy-state guard's
// content half; then the CLI over stub instruments in a sandbox project with a git remote and a deploy ledger.
// Origin reuse (originReusePlan / liveReusePlan tables, --origin-max-age, the split pool budgets) and a sandbox
// runner with stub instruments (no browser): fix rounds reuse this run's origin, a new run recaptures, every reuse
// is in the row, origin.json and _run.log.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codeDeployed, contentDeployed, deployedDocs, edsHostOf, foundationPart, formatSummary, gateKeyOf, gateKeyParts, hostServes, instrumentFiles, keyChanged, liveReusePlan, originReusePlan, parseArgs, probeReuse, rowKey, sharedBlocks, skipCapture, verdict } from '../gate-all.mjs';

// pixel-compare imports pngjs at module level (a project devDependency, absent in the plugin checkout):
// import it lazily and skip its one check where it does not resolve, like the other browser/dep-bound tests.
let textBoxPct = null;
try { ({ textBoxPct } = await import('../pixel-compare.mjs')); } catch { console.log('skip  pixel-compare textBoxPct (pngjs not importable here)'); }

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'gate-all.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const px = (pct, heightDelta, height = 10000) => ({ pct, heightDelta, compared: { width: 1440, height }, pass: pct <= 10 });
const clip = (total) => ({ counts: { total, textClipped: total, textHidden: 0, controlHidden: 0, controlClipped: 0 } });
const content = (missing, hidden, controlState = 0) => ({ totals: { missing, hidden, controlState } });

check('the recorded card page: pixel PASS, elements FAIL — pixelOnlyPass true, pass false, both reasons named', () => {
  const v = verdict({ pixel: px(6.68, 69, 29326), clip: clip(379), content: content(0, 284, 2) });
  assert.equal(v.pixelOnlyPass, true); assert.equal(v.pass, false);
  assert.match(v.reasons.join('; '), /clipped 379/); assert.match(v.reasons.join('; '), /HIDDEN 284/); assert.match(v.reasons.join('; '), /2 control state/);
});
check('a clean page passes every criterion', () => {
  const v = verdict({ pixel: px(1.77, -1, 3415), clip: clip(0), content: content(0, 0) });
  assert.equal(v.pass, true); assert.deepEqual(v.reasons, []); assert.equal(v.originH, 3415); assert.equal(v.edsH, 3416);
});
check('height guard: pixel % inside the bar but 6900 px too tall fails (the rejected union metric case)', () => {
  const v = verdict({ pixel: px(4, -6900, 10000), clip: clip(0), content: content(0, 0) });
  assert.equal(v.pixelPass, true); assert.equal(v.heightPass, false); assert.equal(v.pixelOnlyPass, false); assert.match(v.reasons[0], /Δh -6900px > 5% of 10000/);
});
check('clip allowance: a documented allowance lifts the bar; clipMax option too', () => {
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(2), content: content(0, 0), allowance: 2 }).pass, true);
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(3), content: content(0, 0), allowance: 2 }).pass, false);
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(3), content: content(0, 0) }, { clipMax: 3 }).pass, true);
});
check('content n/a (origin not probed) never fails the page and is named in the row', () => {
  const v = verdict({ pixel: px(3, 0), clip: clip(0), content: { error: 'origin HTTP 403' } });
  assert.equal(v.pass, true); assert.equal(v.contentPass, null); assert.equal(v.contentNA, 'origin HTTP 403');
  const w = verdict({ pixel: px(3, 0), clip: clip(0), content: null });
  assert.equal(w.contentNA, 'not probed');
});
check('criteria switched off read null and cannot fail; --no-probes = the pixel-only verdict', () => {
  const v = verdict({ pixel: px(3, 0), clip: clip(99), content: content(9, 9) }, { clipOn: false, contentOn: false });
  assert.equal(v.pass, true); assert.equal(v.clipPass, null); assert.equal(v.contentPass, null);
});
check('units: required units fail the page, advisory ones do not', () => {
  const u = { verdict: { off: 3, hidden: 1, missing: 0, errors: 0 } };
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(0), content: content(0, 0), units: { ...u, required: true } }).pass, false);
  assert.equal(verdict({ pixel: px(3, 0), clip: clip(0), content: content(0, 0), units: { ...u, required: false } }).pass, true);
});
check('missing capture / pixel error → not compared, reasons say so; override shows beside, never replaces', () => {
  const v = verdict({ pixel: { error: 'missing capture' }, override: { verdict: 'PASS (source capture)', reason: 'live drifted' } });
  assert.equal(v.pass, false); assert.equal(v.passWithOverride, true); assert.match(v.reasons[0], /missing capture/);
});
check('formatSummary: header, calibration line, rows, asymmetric flag, override text', () => {
  const rows = [
    { slug: 'a', path: '/a', template: 't', tier: 'thin', origin: 'stitch-live', pct: 6.68, textPct: 12.3, heightDelta: 69, clipped: 379, clipAllowance: 0, content: { missing: 0, hidden: 284, controlState: 2 }, units: { off: 12, hidden: 2, missing: 4 }, unitsRequired: true, pass: false, pixelOnlyPass: true, reasons: ['clipped 379', 'content MISSING 0 / HIDDEN 284'], masked: false, override: null, error: null },
    { slug: 'b', path: '/b', template: 't', tier: 'thin', origin: 'crawl-fullpage', pct: 3, textPct: null, heightDelta: 0, clipped: 0, clipAllowance: 0, content: null, contentNA: 'origin HTTP 403', units: null, pass: true, pixelOnlyPass: true, reasons: [], masked: true, maskedRows: 70, maskReason: 'store notice', override: null, error: null },
    { slug: 'c', path: '/', template: 'home', tier: 'archetype', origin: 'stitch-live', pct: 37, heightDelta: 3, clipped: 0, clipAllowance: 0, content: { missing: 0, hidden: 0, controlState: 0 }, units: null, pass: false, pixelOnlyPass: false, reasons: ['pixel 37% > 10%'], masked: false, override: { verdict: 'PASS (source capture)', reason: 'live drifted since capture; 9.14% vs the gated capture' }, error: null },
  ];
  const totals = { pages: 3, pass: 1, pixelOnlyPass: 2, overridePass: 1, passWithOverrides: 2, fail: 2, error: 0, failPixel: 1, failHeight: 0, failClip: 1, failContent: 1, failUnits: 1, contentNA: 1 };
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals, rows });
  assert.match(md, /\*\*1 PASS \/ 2 FAIL \/ 0 error of 3\*\*/); assert.match(md, /pixel-only verdict \(criteria 1\+2\): \*\*2 PASS\*\*; full verdict \(1–4\): \*\*1 PASS\*\*/);
  assert.match(md, /\| `\/a` \|.*FAIL \(elements\)/); assert.match(md, /6\.68 \(12\.3\)/); assert.match(md, /crawl-fullpage ⚠asym/); assert.match(md, /n\/a \(origin HTTP 403\)/); assert.match(md, /masked 70 rows: store notice/); assert.match(md, /→ PASS \(source capture\): live drifted/);
  assert.match(md, /off 12 hidden 2 missing 4 \|/);
});
check('parseArgs: defaults, --out derived from --width, --no-probes drops both probe criteria', () => {
  const o = parseArgs(['node', 'x']);
  assert.equal(o.out, 'stardust/replica/gates/all-1440'); assert.equal(o.threshold, 10); assert.equal(o.heightTol, 0.05); assert.equal(o.clipMax, 0); assert.equal(o.clip, true);
  const p = parseArgs(['node', 'x', '--width', '360', '--no-probes', '--only', 'a,b', '--eds-host', 'https://fix-x--r--o.aem.live/']);
  assert.equal(p.out, 'stardust/replica/gates/all-360');
  const q = parseArgs(['node', 'x', '--stage', 'prototype', '--proto-base', 'http://localhost:8791/']);
  assert.equal(q.out, 'stardust/replica/gates/prototypes-1440'); assert.equal(q.content, false, 'no content-presence at the prototype stage'); assert.equal(q.clip, true); assert.equal(q.protoBase, 'http://localhost:8791'); assert.equal(p.clip, false); assert.equal(p.content, false); assert.deepEqual(p.only, ['a', 'b']); assert.equal(p.edsHost, 'https://fix-x--r--o.aem.live');
});
check('formatSummary: the reused cell per row and the head clause only when something was reused', () => {
  const base = { slug: 'a', path: '/a', pct: 2, heightDelta: 0, clipped: 0, content: { missing: 0, hidden: 0 }, units: null, pass: true, pixelOnlyPass: true, reasons: [] };
  const totals = { pages: 2, pass: 2, pixelOnlyPass: 2, overridePass: 0, fail: 0, error: 0, failPixel: 0, failHeight: 0, failClip: 0, failContent: 0, contentNA: 0 };
  const rows = [{ ...base, reused: { what: 'row', from: 'summary.json', at: '2026-01-01T00:00:00.000Z', gateKey: 'k' } }, { ...base, slug: 'b', path: '/b', reused: { what: 'probes', at: '2026-01-02T00:00:00.000Z' } }];
  const md = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { ...totals, reusedRows: 1, reusedProbes: 1 }, rows });
  assert.match(md, /\*\*2 PASS \/ 0 FAIL \/ 0 error of 2\*\* · reused: 1 rows, 1 probe sets/); assert.match(md, /\| reasons \| reused \|/);
  assert.match(md, /\| `\/a` \|.*\| row 2026-01-01T00:00:00\.000Z \|$/m); assert.match(md, /\| `\/b` \|.*\| probes 2026-01-02T00:00:00\.000Z \|$/m);
  const plain = formatSummary({ _provenance: { writtenAt: 'now', breakpoint: 1440, verdict: 'V' }, totals: { ...totals, reusedRows: 0, reusedProbes: 0 }, rows: [{ ...base, reused: null }] });
  assert.doesNotMatch(plain, /reused:/); assert.match(plain, /\| - \|$/m);
});

// ---- reuse under --skip-existing: probes while the capture pair holds, PASS rows while the gate key holds
const T = (m) => `2026-01-01T00:${String(m).padStart(2, '0')}:00.000Z`;
const inputs0 = () => ({ origin: 'https://o.test/', eds: 'https://e.test/', width: 1440, warmup: null, stage: 'published', content: true, clip: true, presence: { variable: ['.rail'] }, units: [], unitTol: 4 });
const reuseArgs = (over = {}) => ({ sidecar: { at: T(5), inputs: inputs0(), results: { content: 'ok', clip: 'ok', units: null }, ats: { content: T(4), clip: T(4), units: null } }, inputs: inputs0(), originMeta: { at: T(1) }, edsMeta: { at: T(2) }, files: { content: { _provenance: { at: T(4) } }, clip: { at: T(4) } }, opts: { skip: true }, ...over });
check('probeReuse: replays only while both captures are the ones the probes were taken against, same inputs, every probe ok', () => {
  assert.deepEqual(probeReuse(reuseArgs()), { reuse: true, at: T(5), why: null });
  const reordered = reuseArgs(); reordered.sidecar.inputs = Object.fromEntries(Object.entries(inputs0()).reverse());
  assert.equal(probeReuse(reordered).reuse, true, 'key order of the recorded inputs is irrelevant');
  assert.equal(probeReuse(reuseArgs({ edsMeta: { at: T(6) } })).reuse, false, 'EDS re-shot after the probes');
  assert.equal(probeReuse(reuseArgs({ originMeta: { at: T(1), error: 'stitch exit 1' } })).reuse, false, 'a failed capture');
  assert.match(probeReuse(reuseArgs({ opts: { skip: true, recaptureEds: true } })).why, /--recapture-eds/);
  assert.match(probeReuse(reuseArgs({ opts: { skip: true, recaptureOrigin: true } })).why, /--recapture-origin/, 'content loads the origin');
  assert.match(probeReuse(reuseArgs({ inputs: { ...inputs0(), presence: { variable: ['.rail', '.reviews'] } } })).why, /inputs changed/, 'presence.variable edited');
  const errored = reuseArgs(); errored.sidecar.results.content = 'error';
  assert.match(probeReuse(errored).why, /content/, 'a kind that errored re-runs');
  const replaced = reuseArgs(); replaced.files.content = { _provenance: { at: T(9) } };
  assert.equal(probeReuse(replaced).reuse, false, 'content.json is not the recorded one');
  assert.match(probeReuse(reuseArgs({ opts: { skip: false } })).why, /--skip-existing/);
  assert.equal(probeReuse(reuseArgs({ sidecar: null })).reuse, false, 'a legacy dir without probes.json');
});
check('probeReuse: a reused origin (its first capture time kept) replays only when it is the capture the probes recorded in pair', () => {
  const paired = (pair, originMeta) => { const a = reuseArgs({ originMeta }); a.sidecar.pair = pair; return probeReuse(a); };
  const kept = { at: T(1), reused: true, from: 'g/home/origin.png', policy: 'skip-existing' };
  assert.equal(paired({ origin: T(1), eds: T(2) }, kept).reuse, true, '--skip-existing keeps the origin the probes were taken against');
  assert.equal(paired({ origin: T(1), eds: T(2) }, { at: T(1) }).reuse, true, 'a plain capture keeps the time-order rule');
  const copied = { at: T(0), reused: true, from: 'gates/home-1440/live.png', policy: 'same-run' };
  assert.match(paired({ origin: T(1), eds: T(2) }, copied).why, /origin is a reused capture the probes were not taken against/, 'live.png copied in after the probes, older than them');
  assert.equal(paired(undefined, kept).reuse, false, 'probes.json without a recorded pair: a reused origin cannot be proven');
});
check('gateKeyOf / gateKeyParts: stable across key order; one block CSS byte, content byte, frozen-file hash or mask edit changes it; a freeze mismatch → null', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-all-key-'));
  const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
  put('styles/styles.css', 'body{}'); put('blocks/cards/cards.css', '.cards{}'); put('blocks/cards/cards.js', 'export default 1;');
  put('content/index.html', '<main><div><div class="cards one"></div></div></main>'); put('content/nav.html', '<nav></nav>');
  const opts = parseArgs(['node', 'x']); const page = { slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--s--o.aem.page/' };
  const parts = (ctx = {}) => gateKeyParts(page, { root, opts, ...ctx });
  const key = (ctx) => gateKeyOf(parts(ctx).parts);
  const k0 = key();
  assert.match(k0, /^[0-9a-f]{64}$/); assert.equal(key(), k0);
  assert.deepEqual(Object.keys(parts().parts.content), ['content/index.html', 'content/nav.html']); assert.deepEqual(Object.keys(parts().parts.blocks), ['cards']);
  const shuffled = Object.fromEntries(Object.entries(parts().parts).reverse().map(([k, v]) => [k, v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse()) : v]));
  assert.equal(gateKeyOf(shuffled), k0, 'key order');
  put('blocks/cards/cards.css', '.cards{ }'); assert.notEqual(key(), k0, 'one CSS byte'); put('blocks/cards/cards.css', '.cards{}'); assert.equal(key(), k0);
  put('content/index.html', '<main><div><div class="cards one"></div></div> </main>'); assert.notEqual(key(), k0, 'one content byte'); put('content/index.html', '<main><div><div class="cards one"></div></div></main>');
  assert.notEqual(key({ masks: { home: { masks: ['0-80'], reason: 'banner' } } }), k0, 'a mask edit');
  assert.notEqual(key({ opts: { ...opts, threshold: 12 } }), k0, 'a criterion'); assert.notEqual(key({ opts: { ...opts, clip: false, content: false } }), k0, '--no-probes');
  assert.notEqual(key({ instruments: 'other' }), k0, 'another verdict or probe version');
  const freeze = () => assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'foundation-freeze.mjs'), 'freeze'], { cwd: root }).status, 0);
  freeze(); const kf = key();
  put('styles/styles.css', 'body{ }'); freeze(); assert.notEqual(key(), kf, 'a frozen file hash in the manifest');
  assert.deepEqual(gateKeyParts({ ...page, liveUrl: 'https://main--s--o.aem.page/missing/' }, { root, opts }), { parts: null, why: 'no content/missing/index.html' });
  const frozen = parts().parts.foundation; put('styles/styles.css', 'body{  }');
  assert.equal(parts().why, 'foundation changed since freeze', 'no key'); assert.notEqual(parts().parts.foundation, frozen, 'the parts still say what moved');
  put('styles/styles.css', 'body{ }'); assert.equal(parts().parts.foundation, frozen, 'the snapshot hash equals the manifest\'s while check passes');
  for (const f of ['content/fr/nav.html', 'content/de/footer-alt.html', 'content/fr/fragments/promo.html', 'content/fragments/deep/x.html']) {
    const k1 = key(); put(f, '<p>chrome</p>'); assert.notEqual(key(), k1, `${f} is in every key`); assert.match(parts().why || '', /^$/);
  }
  put('content/fr/about.html', '<p>another page</p>'); const k2 = key(); put('content/fr/about.html', '<p>edited</p>'); assert.equal(key(), k2, 'another page\'s document is not');
  rmSync(root, { recursive: true, force: true });
});
check('blocks not authored by the page still key it: auto-blocks and foundation-loaded blocks (shared part), blocks its blocks import; another page\'s block does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-all-blocks-'));
  const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
  put('scripts/scripts.js', "import { buildBlock } from './aem.js';\nbuildBlock('embed', []);");
  put('blocks/header/header.js', "import { loadFragment } from '../fragment/fragment.js';");
  put('blocks/fragment/fragment.js', 'export const loadFragment = 1;'); put('blocks/embed/embed.css', '.embed{}'); put('blocks/video/video.css', '.video{}');
  put('blocks/cards/cards.js', "import { carousel } from '../carousel/carousel.js';\nimport { x } from '../../scripts/aem.js';"); put('blocks/carousel/carousel.js', 'export const carousel = 1;');
  put('blocks/tabs/tabs.css', '.tabs{}');
  put('content/index.html', '<div class="cards"></div>'); put('content/other.html', '<div class="tabs"></div><div class="carousel"></div><div class="fragment"></div><div class="embed"></div>');
  const opts = parseArgs(['node', 'x']); const page = { slug: 'home', url: 'https://o.test/', liveUrl: 'https://main--s--o.aem.page/' };
  const key = () => gateKeyOf(gateKeyParts(page, { root, opts, instruments: 'i' }).parts);
  assert.deepEqual(gateKeyParts(page, { root, opts, instruments: 'i' }).parts.blocks.carousel, { 'blocks/carousel/carousel.js': createHash('sha256').update('export const carousel = 1;').digest('hex') }, 'imported by cards');
  assert.deepEqual(sharedBlocks(root).names, ['embed', 'fragment', 'header', 'video'], 'unauthored or loaded by the foundation');
  const k0 = key();
  for (const [f, edit] of [['blocks/embed/embed.css', '.embed{ }'], ['blocks/fragment/fragment.js', 'export const loadFragment = 2;'], ['blocks/video/video.css', '.video{ }'], ['blocks/carousel/carousel.js', 'export const carousel = 2;']]) {
    const before = readFileSync(join(root, f), 'utf8'); put(f, edit); assert.notEqual(key(), k0, f); put(f, before);
  }
  put('blocks/tabs/tabs.css', '.tabs{ }'); assert.equal(key(), k0, 'a block only another page authors');
  rmSync(root, { recursive: true, force: true });
});
check('deploy-state guard: the gated host serves the pushed branch and repo; every document is its newest ledger row, delivered to that org/repo', () => {
  const code = { ok: true, branch: 'feature/Hero', ref: 'feature-hero', owner: 'org', repo: 'site' };
  assert.equal(edsHostOf('feature-hero--site--org.aem.page').ref, 'feature-hero');
  assert.equal(hostServes('feature-hero--site--org.aem.page', code), null);
  assert.match(hostServes('main--site--org.aem.page', code), /serves ref main, the upstream branch is feature\/Hero/);
  assert.match(hostServes('feature-hero--fork--org.aem.page', code), /serves org\/fork, the upstream remote is org\/site/);
  assert.match(hostServes('www.example.com', code), /not an EDS/);
  const root = mkdtempSync(join(tmpdir(), 'gate-all-ledger-'));
  mkdirSync(join(root, 'content')); mkdirSync(join(root, 'stardust/deploy'), { recursive: true });
  const row = (status, ts, contentSha, verifiedOn = 'Org/Site') => ({ status, ts, contentSha, verifiedOn });
  writeFileSync(join(root, 'content/.deploy-ledger.json'), JSON.stringify({ '/index': row('live', T(1), 'old'), '/nav': row('live', T(1), 'n'), '/footer': row('previewed', T(1), 'f'), '/x': { status: 'live', ts: T(1), contentSha: 'x' }, '/y': row('live', T(1), 'y', 'org/other') }));
  writeFileSync(join(root, 'stardust/deploy/ledger-c1.json'), JSON.stringify({ '/index': row('live', T(3), 'new'), '/about': row('preview-fail', T(3), 'a') }));
  const docs = deployedDocs(root); const live = 'main--site--org.aem.live'; const preview = 'main--site--org.aem.page';
  assert.deepEqual(docs['/index'], { contentSha: 'new', status: 'live', verifiedOn: 'Org/Site', ts: T(3) });
  assert.equal(contentDeployed({ 'content/index.html': 'new', 'content/nav.html': 'n' }, docs, live), null);
  assert.match(contentDeployed({ 'content/index.html': 'old' }, docs, live), /content\/index\.html differs from the deployed document/);
  assert.match(contentDeployed({ 'content/z.html': 'z' }, docs, live), /no deploy-ledger contentSha for \/z/);
  assert.equal(contentDeployed({ 'content/footer.html': 'f' }, docs, preview), null, 'previewed is what a preview host serves');
  assert.match(contentDeployed({ 'content/footer.html': 'f' }, docs, live), /is previewed, not live/);
  assert.match(contentDeployed({ 'content/about.html': 'a' }, docs, preview), /is preview-fail/, 'the newest attempt failed: the delivered document is unknown');
  assert.match(contentDeployed({ 'content/x.html': 'x' }, docs, live), /no verifiedOn/, 'a row without verifiedOn proves nothing');
  assert.match(contentDeployed({ 'content/y.html': 'y' }, docs, live), /delivered to org\/other, not org\/site/);
  assert.match(contentDeployed({ 'content/index.html': 'new' }, docs, 'www.example.com'), /not an EDS/);
  rmSync(root, { recursive: true, force: true });
});
check('deploy-state guard, code half: ANY unpushed, deleted, renamed or untracked file under a hashed code path leaves every key unknown', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-git-'))); const root = join(base, 'site');
  const put = (f, s) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), s); };
  const run = (cwd, ...args) => { const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  put('styles/styles.css', 'body{}'); put('scripts/scripts.js', '//'); put('blocks/hero/hero.js', "import { c } from '../carousel/carousel.js';"); put('blocks/carousel/carousel.js', 'export const c = 1;');
  mkdirSync(join(base, 'org')); run(join(base, 'org'), 'init', '-q', '--bare', 'site.git');
  run(root, 'init', '-q'); run(root, 'symbolic-ref', 'HEAD', 'refs/heads/main'); run(root, 'add', '--', 'styles', 'scripts', 'blocks'); run(root, 'commit', '-qm', 'site');
  run(root, 'remote', 'add', 'origin', join(base, 'org', 'site.git')); run(root, 'push', '-q', '-u', 'origin', 'HEAD');
  assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'foundation-freeze.mjs'), 'freeze', '--paths', 'styles,scripts'], { cwd: root }).status, 0);
  const paths = [...foundationPart(root).paths, 'icons/', 'plugins/', 'blocks/'];
  assert.deepEqual(foundationPart(root).paths, ['styles', 'scripts'], 'slash-less manifest entries');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.deepEqual(codeDeployed(paths, root), { ok: true, why: null, upstream: head, branch: 'main', ref: 'main', owner: 'org', repo: 'site' });
  rmSync(join(root, 'blocks/carousel'), { recursive: true });
  assert.match(codeDeployed(paths, root).why, /not pushed, so not deployed\): blocks\/carousel\/carousel\.js/, 'a deleted dependency the hero block imports');
  assert.equal(codeDeployed(paths, root).upstream, head, 'the upstream commit is recorded with an unknown key too');
  run(root, 'checkout', '--', 'blocks'); run(root, 'mv', 'blocks/hero', 'blocks/hero-banner');
  assert.match(codeDeployed(paths, root).why, /blocks\/hero-banner\/hero\.js, blocks\/hero\/hero\.js/, 'a rename names both sides');
  run(root, 'mv', 'blocks/hero-banner', 'blocks/hero');
  assert.equal(codeDeployed(paths, root).ok, true);
  put('styles/styles.css', 'body{ }'); assert.match(codeDeployed(paths, root).why, /styles\/styles\.css/, 'a slash-less manifest entry covers its whole dir');
  run(root, 'checkout', '--', 'styles'); put('scripts/new.js', '//'); assert.match(codeDeployed(paths, root).why, /untracked code, not deployed: scripts\/new\.js/);
  rmSync(base, { recursive: true, force: true });
});
check('instrumentFiles: the gate\'s instruments and every local module they load are hashed — a new local import cannot escape the key', () => {
  const files = instrumentFiles([SCRIPT, join(HERE, '..', 'stitch-shot.mjs'), join(HERE, '..', 'pixel-compare.mjs'), ...['content-presence.mjs', 'clip-probe.mjs', 'unit-geometry.mjs'].map((f) => join(HERE, '../../../diff/scripts', f))]);
  const names = files.map((f) => f.split(/[\\/]/).slice(-1)[0]);
  for (const n of ['live-session.mjs', 'measure-live.mjs', 'run-capped.mjs', 'foundation-freeze.mjs', 'clip-probe.mjs']) assert.ok(names.includes(n), n);
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"`](\.{1,2}\/[^'"`]+)['"`]/g)) assert.ok(files.includes(join(dirname(f), m[1])), `${f} imports ${m[1]}, not hashed`);
});
check('keyChanged / skipCapture / rowKey: an EDS capture is reused only while gate-key.json proves it current; a row keeps a key only for evidence measured under it', () => {
  const P = { blocks: { cards: { 'blocks/cards/cards.css': 'a' } } }; const D = { '/index': { contentSha: 'c', ts: T(1) } };
  const cur = (gateKey, over = {}) => ({ gateKey, why: gateKey ? null : 'why', parts: P, upstream: 'u1', deployed: D, ...over });
  assert.equal(keyChanged(null, undefined), false, 'prototype stage: no keys'); assert.equal(keyChanged(null, cur('K')), true, 'no gate-key.json (legacy): nothing proves the capture');
  assert.equal(keyChanged({ gateKey: 'K' }, cur('K')), false); assert.equal(keyChanged({ gateKey: 'K' }, cur('K2')), true); assert.equal(keyChanged({ gateKey: null, parts: P }, cur('K')), true, 'captured while unknown');
  const proven = { gateKey: 'K', why: 'why', parts: P, upstream: 'u1', deployed: D };
  assert.equal(keyChanged(proven, cur(null)), false, 'unknown now: same tree, same reason, same ledger rows');
  assert.equal(keyChanged(proven, cur(null, { parts: { blocks: { cards: { 'blocks/cards/cards.css': 'b' } } } })), true, 'unknown now and the tree moved');
  assert.equal(keyChanged(proven, cur(null, { why: 'other' })), true, 'another reason (a push, a deploy) since the capture');
  assert.equal(keyChanged(proven, cur(null, { deployed: { '/index': { contentSha: 'c', ts: T(2) } } })), true, 'a document re-deployed since the capture');
  assert.equal(keyChanged(proven, cur(null, { upstream: 'u2' })), true, 'a push since the capture, the reason unchanged');
  assert.equal(keyChanged({ gateKey: null, why: 'why' }, cur(null, { parts: null })), true, 'parts unknown');
  const ctx = (opts, changed = false) => ({ opts, has: () => true, keyChanged: () => changed });
  assert.equal(skipCapture({}, 'eds', ctx({ skip: true })), true); assert.equal(skipCapture({}, 'eds', ctx({ skip: true }, true)), false);
  assert.equal(skipCapture({}, 'origin', ctx({ skip: true }, true)), true); assert.equal(skipCapture({}, 'origin', ctx({ skip: true, recaptureOrigin: true })), false);
  assert.equal(skipCapture({}, 'eds', ctx({ skip: false })), false);
  const build = { origin: 'https://h', settings: { threshold: 10 } }; const stored = { gateKey: 'K', parts: { build } };
  assert.equal(rowKey(stored, { gateKey: 'K', parts: { build } }), 'K'); assert.equal(rowKey(stored, { gateKey: 'K2', parts: { build } }), null, 'measured under another key');
  assert.equal(rowKey(stored, { gateKey: null, parts: { build } }), 'K', 'unknown now, same criteria, probes replayed');
  assert.equal(rowKey(stored, { gateKey: null, parts: { build } }, true), null, 'probed afresh against an unproven deploy');
  assert.equal(rowKey(stored, { gateKey: null, parts: { build: { ...build, settings: { threshold: 12 } } } }), null, 'other criteria');
  assert.equal(rowKey(stored, { gateKey: null, parts: null }), null); assert.equal(rowKey(null, { gateKey: 'K' }), null);
});
if (textBoxPct) check('pixel-compare textBoxPct: differing pixels counted inside the boxes only, masked rows skipped', () => {
  const w = 10; const h = 10; const data = Buffer.alloc(w * h * 4);
  const red = (x, y) => { const i = (y * w + x) * 4; data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255; };
  red(1, 1); red(2, 1); red(8, 8);
  const masked = new Uint8Array(h); masked[1] = 0;
  const r = textBoxPct({ data }, [{ x: 0, y: 0, w: 4, h: 4 }], w, h, masked);
  assert.equal(r.boxes, 1); assert.equal(r.pixels, 16); assert.equal(r.pct, 12.5);
  masked[1] = 1;
  assert.equal(textBoxPct({ data }, [{ x: 0, y: 0, w: 4, h: 4 }], w, h, masked).pct, 0);
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-all-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node gate-all\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});

// ---- CLI over stub instruments (no browser, no network): the gate.test.mjs sandbox pattern — a realpath'd project
// with stardust/scripts/{replica,diff}, a git remote the site's code is pushed to, and a deploy ledger with contentSha.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-reuse-')));
const reuseRoot = join(base, 'site'); const replica = join(reuseRoot, 'stardust/scripts/replica'); const diffDir = join(reuseRoot, 'stardust/scripts/diff');
const COUNT = join(base, 'count.txt'); const REUSE_OUT = join(reuseRoot, 'stardust/replica/gates/all-1440');
mkdirSync(replica, { recursive: true }); mkdirSync(diffDir, { recursive: true });
cpSync(SCRIPT, join(replica, 'gate-all.mjs')); cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(replica, 'foundation-freeze.mjs'));
// gate-all takes the run anchor and the freshness rule from the diff dir's live-session.mjs (node: imports only).
cpSync([resolve(HERE, '../../../diff/scripts'), resolve(HERE, '../../diff')].map((x) => join(x, 'live-session.mjs')).find((x) => existsSync(x)), join(diffDir, 'live-session.mjs'));
// Every instrument appends one line to STUB_COUNT; pixel-compare fails the slugs listed in STUB_FAIL.
writeFileSync(join(replica, 'stitch-shot.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
appendFileSync(process.env.STUB_COUNT, 'STITCH ' + (url.startsWith('https://origin.test') ? 'origin' : 'eds') + '\\n');
writeFileSync(out, 'png');`);
writeFileSync(join(replica, 'pixel-compare.mjs'), `import { appendFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
appendFileSync(process.env.STUB_COUNT, 'COMPARE\\n');
const pct = (process.env.STUB_FAIL || '').split(',').includes(basename(dirname(process.argv[2]))) ? 30 : 2;
console.log(JSON.stringify({ pct, heightDelta: 0, compared: { width: 1440, height: 3000 }, pass: pct <= 10, bands: [] }));`);
writeFileSync(join(diffDir, 'content-presence.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
appendFileSync(process.env.STUB_COUNT, 'PROBE content\\n');
const a = process.argv; const clip = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [] };
writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome' }, origin: { clip }, eds: { clip }, totals: { missing: 0, hidden: 0, controlState: 0 }, scope: 'main' }));`);
writeFileSync(join(diffDir, 'clip-probe.mjs'), `import { appendFileSync, writeFileSync } from 'node:fs';
appendFileSync(process.env.STUB_COUNT, 'PROBE clip\\n');
const a = process.argv; writeFileSync(a[a.indexOf('--json') + 1], JSON.stringify({ at: new Date().toISOString(), counts: { total: 0 }, groups: [] }));`);
writeFileSync(join(diffDir, 'unit-geometry.mjs'), `import { appendFileSync } from 'node:fs';
export function unitsFor() { return []; }
if (process.argv[1] && process.argv[1].endsWith('unit-geometry.mjs')) appendFileSync(process.env.STUB_COUNT, 'PROBE units\\n');`);
const put = (f, s) => { mkdirSync(dirname(join(reuseRoot, f)), { recursive: true }); writeFileSync(join(reuseRoot, f), s); };
put('.gitignore', 'stardust/\n'); put('head.html', '<script src="/scripts/scripts.js" type="module"></script>'); put('scripts/scripts.js', '// site');
put('styles/styles.css', 'body { margin: 0; }'); put('blocks/hero/hero.css', '.hero { color: red; }'); put('blocks/cards/cards.css', '.cards { gap: 1rem; }');
put('content/index.html', '<main><div><div class="hero"></div></div></main>'); put('content/about.html', '<main><div><div class="cards"></div></div></main>');
put('content/nav.html', '<main><div><p>nav</p></div></main>'); put('content/footer.html', '<main><div><p>footer</p></div></main>');
const sha = (f) => createHash('sha256').update(readFileSync(join(reuseRoot, f))).digest('hex');
put('content/.deploy-ledger.json', JSON.stringify(Object.fromEntries(['index', 'about', 'nav', 'footer'].map((n) => [`/${n}`, { status: 'live', ts: '2026-01-01T00:00:00.000Z', contentSha: sha(`content/${n}.html`), verifiedOn: 'org/site' }]))));
put('stardust/state.json', JSON.stringify({ pages: [
  { slug: 'home', url: 'https://origin.test/', liveUrl: 'https://main--site--org.aem.page/', status: 'deployed', template: 'home' },
  { slug: 'about', url: 'https://origin.test/about', liveUrl: 'https://main--site--org.aem.page/about', status: 'deployed', template: 'page' }] }));
const sh = (cwd, cmd, args) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout; };
const git = (...args) => sh(reuseRoot, 'git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]);
const CODE = ['.gitignore', 'head.html', 'scripts', 'styles', 'blocks', 'content'];
sh(reuseRoot, process.execPath, [join(replica, 'foundation-freeze.mjs'), 'freeze']);
// The remote's last two path segments are its <owner>/<repo> and the branch is main: the host main--site--org serves it.
mkdirSync(join(base, 'org')); sh(join(base, 'org'), 'git', ['init', '-q', '--bare', 'site.git']);
git('init', '-q'); git('symbolic-ref', 'HEAD', 'refs/heads/main'); git('add', '--', ...CODE); git('commit', '-qm', 'site');
git('remote', 'add', 'origin', join(base, 'org', 'site.git')); git('push', '-q', '-u', 'origin', 'HEAD');

const gateAll = (args = [], env = {}) => {
  writeFileSync(COUNT, '');
  const r = spawnSync(process.execPath, [join(replica, 'gate-all.mjs'), ...args], { cwd: reuseRoot, encoding: 'utf8', env: { ...process.env, STUB_COUNT: COUNT, STUB_FAIL: '', ...env } });
  const lines = readFileSync(COUNT, 'utf8').split('\n').filter(Boolean);
  const n = (f) => lines.filter(f).length;
  return { ...r, n: { origin: n((l) => l === 'STITCH origin'), eds: n((l) => l === 'STITCH eds'), probes: n((l) => l.startsWith('PROBE')), compares: n((l) => l === 'COMPARE') } };
};
const summary = () => JSON.parse(readFileSync(join(REUSE_OUT, 'summary.json'), 'utf8'));
const row = (s, slug) => s.rows.find((x) => x.slug === slug);
const pageFile = (slug, f) => join(REUSE_OUT, slug, f);
const storedKey = (slug) => JSON.parse(readFileSync(pageFile(slug, 'gate-key.json'), 'utf8')).gateKey;
// summary.json apart from the reuse fields and timestamps (§ 9 item 1: byte-identical apart from reused / at).
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['reused', 'reusedRows', 'reusedProbes', 'reuse', 'at', 'writtenAt'].includes(k) ? undefined : x)));
const HEX = /^[0-9a-f]{64}$/;

let r = gateAll([], { STUB_FAIL: 'about' });
const run1 = existsSync(join(REUSE_OUT, 'summary.json')) ? summary() : null;
check('run 1 (fresh): per page 2 stitches, 1 content probe, 1 compare; probes.json + gate-key.json; rows carry gateKey', () => {
  assert.equal(r.status, 2, r.stderr); assert.deepEqual(r.n, { origin: 2, eds: 2, probes: 2, compares: 2 });
  for (const slug of ['home', 'about']) { assert.ok(existsSync(pageFile(slug, 'probes.json')), slug); assert.match(storedKey(slug), HEX); assert.equal(row(run1, slug).gateKey, storedKey(slug)); assert.equal(row(run1, slug).reused, null); }
  assert.equal(row(run1, 'about').pass, false); assert.deepEqual(run1._provenance.reuse, { rows: 0, probes: 0 });
});
check('probes.json records the capture pair it was taken against (origin.json / eds.json at)', () => {
  const at = (slug, side) => JSON.parse(readFileSync(pageFile(slug, `${side}.json`), 'utf8')).at;
  for (const slug of ['home', 'about']) assert.deepEqual(JSON.parse(readFileSync(pageFile(slug, 'probes.json'), 'utf8')).pair, { origin: at(slug, 'origin'), eds: at(slug, 'eds') }, slug);
});
r = gateAll(['--skip-existing'], { STUB_FAIL: 'about' });
check('run 2 --skip-existing: the PASS row reused whole, the FAIL page re-compared on replayed probes — 0 stitches, 0 probes; summary.json equal apart from reused/at and the recorded origin reuse', () => {
  assert.equal(r.status, 2, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 1 });
  const s = summary();
  assert.deepEqual(row(s, 'home').reused, { what: 'row', from: 'summary.json', at: run1._provenance.writtenAt, gateKey: row(run1, 'home').gateKey });
  assert.equal(row(s, 'about').reused.what, 'probes'); assert.equal(s.totals.reusedRows, 1); assert.equal(s.totals.reusedProbes, 1);
  // the kept origin is a recorded reuse too (originReused, policy skip-existing) — the one other field that differs
  assert.equal(row(s, 'about').originReused.policy, 'skip-existing'); assert.equal(s.totals.originReused, 1);
  const own = (v) => { const c = strip(v); for (const x of c.rows) delete x.originReused; delete c.totals.originReused; return c; };
  assert.deepEqual(own(s), own(run1));
  assert.match(readFileSync(join(REUSE_OUT, 'summary.md'), 'utf8'), /· reused: 1 rows, 1 probe sets/);
});
r = gateAll(['--skip-existing', '--recapture-eds']);
const run3 = summary();
check('--recapture-eds: the EDS side only — EDS stitches + probes + compares, 0 origin stitches, no row reused', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.equal(run3.totals.reusedRows + run3.totals.reusedProbes, 0);
});
r = gateAll(['--skip-existing']);
check('a second --skip-existing run over all-PASS rows launches nothing: 0 stitches, 0 probes, 0 compares; summary.json equal apart from reused/at', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 0 });
  assert.equal(summary().totals.reusedRows, 2); assert.deepEqual(strip(summary()), strip(run3));
});
r = gateAll(['--compare-only', '--no-probes']);
check('--compare-only --no-probes: a pixel-only row never carries the full-criteria key', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  for (const slug of ['home', 'about']) assert.equal(row(summary(), slug).gateKey, null, slug);
});
r = gateAll(['--skip-existing']);
check('… so the next --skip-existing run reuses no row: it re-compares on replayed probes and keys the rows again', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  const s = summary(); assert.equal(s.totals.reusedRows, 0); assert.equal(s.totals.reusedProbes, 2); assert.equal(row(s, 'home').gateKey, storedKey('home'));
});
const keys4 = { home: storedKey('home'), about: storedKey('about') };
put('blocks/cards/cards.css', '.cards { gap: 2rem; }'); git('add', '--', 'blocks/cards/cards.css'); git('commit', '-qm', 'cards gap'); git('push', '-q');
r = gateAll(['--skip-existing']);
check('one byte in blocks/cards/cards.css, committed + pushed: that page re-shoots EDS + probes + compares under a new key, the other page is reused', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 1, probes: 1, compares: 1 });
  const s = summary();
  assert.equal(row(s, 'home').reused.what, 'row'); assert.equal(row(s, 'about').reused, null);
  assert.notEqual(storedKey('about'), keys4.about); assert.equal(row(s, 'about').gateKey, storedKey('about')); assert.equal(storedKey('home'), keys4.home);
});
put('blocks/cards/cards.css', '.cards { gap: 3rem; }');
r = gateAll(['--skip-existing']);
check('the same edit NOT pushed: every key is unknown (the reason names the file) — no row reused, every EDS side re-shot and re-probed (its gate-key.json recorded a proven key, now a different reason)', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.match(r.stdout, /gate key n\/a for 2\/2 page\(s\) — code differs from origin\/main \(not pushed, so not deployed\): blocks\/cards\/cards\.css/);
  const s = summary();
  assert.equal(s.totals.reusedRows + s.totals.reusedProbes, 0);
  for (const slug of ['home', 'about']) { assert.equal(row(s, slug).gateKey, null, 'evidence of an unproven build carries no key'); assert.equal(storedKey(slug), null); }
});
r = gateAll(['--skip-existing']);
check('… run again with nothing changed: the unknown-key captures are reused (same tree, reason, upstream commit and ledger rows), probes replayed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 2 });
  assert.equal(summary().totals.reusedProbes, 2);
});
put('blocks/cards/cards.css', '.cards { gap: 4rem; }'); git('add', '--', 'blocks/cards/cards.css'); git('commit', '-qm', 'cards v1'); git('push', '-q');
put('blocks/cards/cards.css', '.cards { gap: 3rem; }');
r = gateAll(['--skip-existing']);
check('a push in between (v1 committed and pushed, v2 still dirty): the reason, tree and ledger rows read the same, the upstream commit moved — every EDS side re-shot', () => {
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /gate key n\/a for 2\/2 page\(s\) — code differs from origin\/main \(not pushed, so not deployed\): blocks\/cards\/cards\.css \(/);
  assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
});
git('checkout', '--', 'blocks/cards/cards.css');
put('styles/styles.css', 'body { margin: 1px; }'); git('add', '--', 'styles/styles.css'); git('commit', '-qm', 'foundation request'); git('push', '-q');
r = gateAll(['--skip-existing']);
check('a frozen file edited after the freeze (pushed): every key unknown, yet the EDS side is re-shot and re-probed — no row reused, rows unkeyed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  assert.match(r.stdout, /gate key n\/a for 2\/2 page\(s\) — foundation changed since freeze/);
  const s = summary(); assert.equal(s.totals.reusedRows + s.totals.reusedProbes, 0);
  for (const slug of ['home', 'about']) { assert.equal(row(s, slug).gateKey, null); assert.equal(storedKey(slug), null); }
});
sh(reuseRoot, process.execPath, [join(replica, 'foundation-freeze.mjs'), 'freeze']);
r = gateAll(['--skip-existing']);
check('re-frozen: the new keys differ from the unknown ones the evidence was captured under — EDS re-shot once more, rows keyed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  for (const slug of ['home', 'about']) { assert.match(storedKey(slug), HEX); assert.equal(row(summary(), slug).gateKey, storedKey(slug)); }
});
r = gateAll(['--skip-existing']);
check('… and the next run launches nothing', () => { assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 0, probes: 0, compares: 0 }); });
for (const slug of ['home', 'about']) for (const f of ['probes.json', 'gate-key.json']) unlinkSync(pageFile(slug, f));
const legacy = summary(); for (const x of legacy.rows) { delete x.gateKey; delete x.reused; } writeFileSync(join(REUSE_OUT, 'summary.json'), JSON.stringify(legacy, null, 2));
r = gateAll(['--skip-existing']);
check('a legacy gate dir (no probes.json / gate-key.json, rows without gateKey): nothing records what its EDS capture shows — re-shot and re-probed once, then keyed', () => {
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.n, { origin: 0, eds: 2, probes: 2, compares: 2 });
  const s = summary();
  assert.equal(s.totals.reusedRows + s.totals.reusedProbes, 0); assert.match(storedKey('home'), HEX); assert.equal(row(s, 'home').gateKey, storedKey('home'));
});
rmSync(base, { recursive: true, force: true });

// ---- origin reuse: the pure deciders, --origin-max-age, the pool budgets ----------------------------------
const DIFF = [resolve(HERE, '../../../diff/scripts'), resolve(HERE, '../../diff')].find((p) => existsSync(join(p, 'live-session.mjs')));
const { freshness } = await import(pathToFileURL(join(DIFF, 'live-session.mjs')).href);
const RUN = '2026-10-16T08:00:00.000Z'; const NOW = Date.parse('2026-10-16T09:00:00.000Z');
const U = 'https://www.example.com/'; const AT = '2026-10-16T08:30:00.000Z';
const ask = { stage: 'published', only: ['home'], recaptureEds: false, recaptureOrigin: false, url: U, width: 1440, vh: null };
const prev = { instrument: 'stitch-live', url: U, width: 1440, locale: 'en-US', vh: null, at: AT };
const fr = (meta, o = {}) => freshness(meta, { runStart: RUN, maxAgeH: null, now: NOW, ...o });
check('originReusePlan: a fix round reuses this run\'s origin; stale, no anchor, --recapture-origin, other stage or a full round recapture', () => {
  assert.deepEqual(originReusePlan(ask, prev, fr(prev)), { reuse: true, why: 'same-run' });
  const old = { ...prev, at: '2026-10-16T07:00:00.000Z' };
  const stale = originReusePlan(ask, old, fr(old));
  assert.equal(stale.reuse, false); assert.match(stale.why, /captured before this run \(2026-10-16T08:00:00\.000Z\)/);
  const none = originReusePlan(ask, old, fr(old, { runStart: null }));
  assert.equal(none.reuse, false); assert.match(none.why, /no run anchor .*opt-in: --origin-max-age/);
  assert.deepEqual(originReusePlan(ask, old, fr(old, { runStart: null, maxAgeH: 6 })), { reuse: true, why: 'max-age 6h' });
  assert.equal(originReusePlan({ ...ask, recaptureOrigin: true }, prev, fr(prev)).reuse, false);
  assert.equal(originReusePlan({ ...ask, stage: 'prototype' }, prev, fr(prev)).reuse, false);
  assert.equal(originReusePlan({ ...ask, only: null }, prev, fr(prev)).reuse, false, 'a full round recaptures');
  assert.deepEqual(originReusePlan({ ...ask, only: null, recaptureEds: true }, prev, fr(prev)), { reuse: true, why: 'same-run' }, '--recapture-eds re-shoots the EDS side only');
  assert.equal(originReusePlan(ask, null, null).reuse, false);
});
check('originReusePlan: url / width / vh / locale mismatches and crawl / error origins are never reused; legacy metas without width read as the run\'s', () => {
  const no = (p) => assert.equal(originReusePlan(ask, p, fr(p)).reuse, false, JSON.stringify(p));
  no({ ...prev, url: 'https://www.example.com/other' }); no({ ...prev, width: 360 }); no({ ...prev, vh: 900 }); no({ ...prev, locale: 'de-DE' });
  no({ ...prev, instrument: 'crawl-fullpage', asymmetric: true }); no({ ...prev, error: 'stitch exit 1' }); no({ ...prev, instrument: 'none' });
  const legacy = { instrument: 'stitch-live', url: U, at: AT };
  assert.equal(originReusePlan(ask, legacy, fr(legacy)).reuse, true);
  assert.equal(originReusePlan({ ...ask, vh: 900 }, legacy, fr(legacy)).reuse, false, 'a legacy capture had no --vh');
});
check('liveReusePlan: the archetype round\'s live.png is reused only when live.json matches every capture parameter of gate-all\'s own stitch and is fresh', () => {
  const live = { writtenBy: 'gate.sh', url: U, width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, at: AT };
  const la = { stage: 'published', recaptureOrigin: false, url: U, width: 1440 };
  assert.deepEqual(liveReusePlan(la, live, fr(live)), { reuse: true, why: 'same-run' });
  assert.equal(liveReusePlan(la, null, null).reuse, false, 'a legacy live.png without live.json is never reused');
  assert.equal(liveReusePlan(la, { ...live, locale: null }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, dismiss: { off: true, consent: null, extra: null } }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, url: `${U}x` }, fr(live)).reuse, false); assert.equal(liveReusePlan(la, { ...live, width: 360 }, fr(live)).reuse, false);
  const old = { ...live, at: '2026-10-16T07:00:00.000Z' };
  assert.match(liveReusePlan(la, old, fr(old)).why, /captured before this run/);
  assert.equal(liveReusePlan({ ...la, recaptureOrigin: true }, live, fr(live)).reuse, false); assert.equal(liveReusePlan({ ...la, stage: 'prototype' }, live, fr(live)).reuse, false);
  // symmetric capture: --vh, settle, the dismissal set and the UA must be the ones gate-all's stitch would use
  assert.deepEqual(liveReusePlan({ ...la, vh: 1200 }, live, fr(live)), { reuse: false, why: '--vh set (live.png uses the default viewport)' });
  assert.equal(liveReusePlan({ ...la, vh: 1200 }, { ...live, vh: 1200 }, fr(live)).reuse, true);
  assert.equal(liveReusePlan(la, { ...live, vh: 1200 }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, settle: false }, fr(live)).reuse, false);
  assert.match(liveReusePlan(la, { ...live, dismiss: { off: false, consent: '#accept', extra: null } }, fr(live)).why, /consent/);
  assert.equal(liveReusePlan(la, { ...live, dismiss: { off: false, consent: null, extra: '.modal' } }, fr(live)).reuse, false);
  assert.equal(liveReusePlan(la, { ...live, ua: 'custom' }, fr(live)).reuse, false);
});
check('parseArgs: --origin-max-age <h>; pools 4 / 2 without a machine browser slot, 6 / 4 with STARDUST_BROWSER_SLOT, origin stays 2, explicit flags win', () => {
  assert.equal(parseArgs(['node', 'x'], {}).originMaxAge, null); assert.equal(parseArgs(['node', 'x', '--origin-max-age', '6'], {}).originMaxAge, 6);
  const plain = parseArgs(['node', 'x'], {}); assert.deepEqual([plain.oc, plain.ec, plain.pc], [2, 4, 2]);
  const held = parseArgs(['node', 'x'], { STARDUST_BROWSER_SLOT: '/locks/slot-1' }); assert.deepEqual([held.oc, held.ec, held.pc], [2, 6, 4]);
  const own = parseArgs(['node', 'x', '--eds-concurrency', '3', '--probe-concurrency', '1', '--origin-concurrency', '1'], { STARDUST_BROWSER_SLOT: '/locks/slot-1' }); assert.deepEqual([own.oc, own.ec, own.pc], [1, 3, 1]);
  for (const bad of ['x', '-1']) {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-all-maxage-'));
    const r = spawnSync(process.execPath, [SCRIPT, '--origin-max-age', bad], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /--origin-max-age/); assert.deepEqual(readdirSync(cwd), []);
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---- sandbox runner: the real gate-all with stub instruments (no browser, no network) -----------------------
// realpath: gate-all's main-module guard compares process.argv[1] with import.meta.url (macOS /var → /private/var).
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-all-run-')));
const RS = join(root, 'stardust/scripts/replica'); const DS = join(root, 'stardust/scripts/diff');
mkdirSync(RS, { recursive: true }); cpSync(SCRIPT, join(RS, 'gate-all.mjs')); cpSync(DIFF, DS, { recursive: true });
const STITCH_LOG = join(root, 'stitch.log'); const CP_LOG = join(root, 'cp.log');
const stub = (dir, name, body) => writeFileSync(join(dir, name), `#!/usr/bin/env node\n${body}\n`);
// stitch-shot: one line per call (ORIGIN = the www.example.com side, EDS = anything else), writes a PNG stand-in;
// STUB_ORIGIN_RC makes the origin capture fail with that exit code.
stub(RS, 'stitch-shot.mjs', `import { appendFileSync, writeFileSync } from 'node:fs';
  const side = /www\\.example\\.com/.test(process.argv[2]) ? 'ORIGIN' : 'EDS';
  appendFileSync(${JSON.stringify(STITCH_LOG)}, side + ' ' + process.argv.slice(2).join(' ') + '\\n');
  if (side === 'ORIGIN' && process.env.STUB_ORIGIN_RC) { console.error('stitch-shot error: stub exit ' + process.env.STUB_ORIGIN_RC); process.exit(Number(process.env.STUB_ORIGIN_RC)); }
  writeFileSync(process.argv[3], 'png');`);
stub(RS, 'pixel-compare.mjs', `console.log(JSON.stringify({ pct: 1.5, heightDelta: 0, compared: { width: 1440, height: 3000 }, pass: true }));`);
// content-presence: records its argv, whether --origin-cache existed at start and the max-age env it inherited;
// writes the cache when absent (like the real probe) and a canned content.json.
stub(DS, 'content-presence.mjs', `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'; import { dirname } from 'node:path';
  const a = process.argv.slice(2); const val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  const cache = val('--origin-cache'); const had = !!cache && existsSync(cache);
  appendFileSync(${JSON.stringify(CP_LOG)}, JSON.stringify({ argv: a, had, maxAge: process.env.STARDUST_ORIGIN_MAX_AGE_H || null }) + '\\n');
  if (cache && !had) { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify({ key: {}, at: new Date().toISOString(), data: {} })); }
  const clip = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, groups: [] };
  writeFileSync(val('--json'), JSON.stringify({ _provenance: { at: new Date().toISOString(), tier: 'chrome' }, scope: 'root', totals: { missing: 0, hidden: 0, controlState: 0 }, eds: { clip }, origin: { clip }, textBoxes: { origin: [] } }));`);
const pages = [{ slug: 'home', url: 'https://www.example.com/', liveUrl: 'https://main--site--org.aem.live/', status: 'deployed', template: 'home', prototypePath: 'stardust/prototypes/home.html' },
  { slug: 'about', url: 'https://www.example.com/about', liveUrl: 'https://main--site--org.aem.live/about', status: 'deployed', template: 'page' }];
writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ pages }));
cpSync(join(HERE, '..', 'foundation-freeze.mjs'), join(RS, 'foundation-freeze.mjs')); // gate-all imports it (gate keys)
const LEDGER = join(root, 'stardust/status.jsonl');
const opener = (ts) => appendFileSync(LEDGER, `${JSON.stringify({ ts, skill: 'stardust:rollout', phase: 'A-inventory', event: 'start' })}\n`);
opener(new Date(Date.now() - 60e3).toISOString());
const OUT = join(root, 'stardust/replica/gates/all-1440');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
const gate = (args, env = {}) => {
  for (const f of [STITCH_LOG, CP_LOG]) rmSync(f, { force: true });
  const e = { ...process.env, ...env }; for (const k of ['STARDUST_ORIGIN_MAX_AGE_H', 'STARDUST_BROWSER_SLOT']) if (!(k in env)) delete e[k];
  const r = spawnSync(process.execPath, [join(RS, 'gate-all.mjs'), '--width', '1440', ...args], { cwd: root, env: e, encoding: 'utf8', timeout: 60e3 });
  const st = lines(STITCH_LOG); const run = (r.stdout.match(/run → (.*)/) || [])[1];
  return { ...r, origin: st.filter((l) => l.startsWith('ORIGIN')).length, eds: st.filter((l) => l.startsWith('EDS')).length, cp: lines(CP_LOG).map((l) => JSON.parse(l)), row: (slug) => (run ? read(run) : read('stardust/replica/gates/all-1440/summary.json')).rows.find((x) => x.slug === slug) };
};
const runLog = () => readFileSync(join(OUT, '_run.log'), 'utf8');
const presence = (slug) => `stardust/replica/gates/all-1440/${slug}/presence-origin.json`;
let homeAt = null;
check('sandbox 1: a full round captures both sides of every page; origin.json records width, locale, vh, headed and at', () => {
  const r = gate([]);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 2); assert.equal(r.eds, 2);
  const m = read('stardust/replica/gates/all-1440/home/origin.json');
  assert.equal(m.width, 1440); assert.equal(m.locale, 'en-US'); assert.equal(m.vh, null); assert.equal(m.headed, true); assert.ok(m.at); assert.equal(m.reused, undefined);
  homeAt = m.at;
  assert.equal(r.row('home').originReused, null); assert.equal(read('stardust/replica/gates/all-1440/summary.json').totals.originReused, 0);
  assert.match(runLog(), /origin reuse: same run since .*; pools origin 2 \/ eds 4 \/ probe 2/);
  assert.ok(r.cp.every((c) => !c.had), 'a fresh origin capture is paired with a fresh presence inventory');
});
check('sandbox 2: --only home is a fix round — 0 origin navigations, the row / origin.json / _run.log record the reuse, presence cache passed', () => {
  const r = gate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0); assert.equal(r.eds, 1);
  assert.deepEqual(r.row('home').originReused, { from: 'stardust/replica/gates/all-1440/home/origin.png', at: homeAt, policy: 'same-run', stale: null });
  const m = read('stardust/replica/gates/all-1440/home/origin.json');
  assert.equal(m.at, homeAt, 'the capture time is kept'); assert.ok(m.reusedAt >= homeAt); assert.equal(m.reused, true); assert.equal(m.policy, 'same-run');
  assert.match(runLog(), /origin home → reused stardust\/replica\/gates\/all-1440\/home\/origin\.png \(captured .*; same-run\)/);
  assert.equal(r.cp.length, 1); const a = r.cp[0].argv; assert.equal(a[a.indexOf('--origin-cache') + 1], presence('home')); assert.equal(r.cp[0].had, true);
});
check('sandbox 3: a new run (new A-inventory start) recaptures the origin once and drops its presence inventory', () => {
  opener(new Date().toISOString());
  const r = gate(['--only', 'home']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 1); assert.equal(r.eds, 1);
  assert.match(runLog(), /origin home → not reused \(captured before this run/); assert.equal(r.cp[0].had, false);
  assert.equal(r.row('home').originReused, null); assert.notEqual(read('stardust/replica/gates/all-1440/home/origin.json').at, homeAt);
  assert.equal(gate(['--only', 'home']).origin, 0, 'the next fix round of the new run reuses again');
});
check('sandbox 4: --recapture-origin re-shoots a fresh origin', () => {
  const r = gate(['--only', 'home', '--recapture-origin']);
  assert.equal(r.origin, 1); assert.equal(r.row('home').originReused, null);
});
check('sandbox 5: without a ledger reuse is opt-in — STARDUST_ORIGIN_MAX_AGE_H or --origin-max-age (passed on to the probes); neither → recapture', () => {
  renameSync(LEDGER, `${LEDGER}.off`);
  try {
    const env = gate(['--only', 'home'], { STARDUST_ORIGIN_MAX_AGE_H: '6' });
    assert.equal(env.origin, 0); assert.equal(env.row('home').originReused.policy, 'max-age 6h');
    const flag = gate(['--only', 'home', '--origin-max-age', '6']);
    assert.equal(flag.origin, 0); assert.equal(flag.row('home').originReused.policy, 'max-age 6h'); assert.equal(flag.cp[0].maxAge, '6');
    assert.match(runLog(), /origin reuse: no run anchor/);
    const off = gate(['--only', 'home']);
    assert.equal(off.origin, 1); assert.match(runLog(), /not reused \(no run anchor/);
  } finally { renameSync(`${LEDGER}.off`, LEDGER); }
});
check('sandbox 6: the published stage reuses the archetype round\'s fresh live.png when live.json matches; locale null → stitched', () => {
  const g = join(root, 'stardust/replica/gates/about-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  opener(new Date().toISOString());
  const liveAt = new Date().toISOString();
  const live = { writtenBy: 'gate.sh', url: 'https://www.example.com/about', width: 1440, locale: 'en-US', settle: true, dismiss: { off: false, consent: null, extra: null }, headed: false, at: liveAt };
  writeFileSync(join(g, 'live.json'), JSON.stringify(live));
  const r = gate(['--only', 'about']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0); assert.equal(r.eds, 1);
  assert.deepEqual(r.row('about').originReused, { from: 'stardust/replica/gates/about-1440/live.png', at: liveAt, policy: 'same-run', stale: null });
  const m = read('stardust/replica/gates/all-1440/about/origin.json'); assert.equal(m.headed, false); assert.equal(m.locale, 'en-US'); assert.equal(m.url, live.url);
  const vh = gate(['--only', 'about', '--vh', '1200']);
  assert.equal(vh.origin, 1, 'a --vh round never takes the default-viewport live.png'); assert.match(runLog(), /origin about → live\.png not reused \(--vh set/);
  writeFileSync(join(g, 'live.json'), JSON.stringify({ ...live, locale: null }));
  opener(new Date().toISOString());
  assert.equal(gate(['--only', 'about']).origin, 1);
});
check('sandbox 7: --skip-existing keeps a stale origin (never a recapture) but records it: policy skip-existing + stale, a WARN line', () => {
  opener(new Date().toISOString());
  const r = gate(['--only', 'home', '--skip-existing']);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.origin, 0); assert.equal(r.eds, 0);
  const o = r.row('home').originReused; assert.equal(o.policy, 'skip-existing'); assert.match(o.stale, /captured before this run/);
  assert.match(runLog(), /origin home → reused \(--skip-existing\) WARN captured before this run/);
  assert.equal(read('stardust/replica/gates/all-1440/home/origin.json').policy, 'skip-existing');
});
check('sandbox 8: the prototype stage records the archetype round\'s live.png as a reuse with its capture time (live.json, else the PNG mtime), stale when it predates the run', () => {
  const g = join(root, 'stardust/replica/gates/home-1440'); mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'live.png'), 'png');
  const args = ['--stage', 'prototype', '--proto-base', 'http://localhost:9', '--no-probes'];
  const row = () => read('stardust/replica/gates/prototypes-1440/summary.json').rows.find((x) => x.slug === 'home');
  const oldAt = new Date(Date.now() - 3600e3).toISOString();
  writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, at: oldAt }));
  const r = gate(args);
  assert.equal(r.origin, 0, r.stderr + r.stdout);
  const o = row().originReused; assert.equal(o.from, 'stardust/replica/gates/home-1440/live.png'); assert.equal(o.at, oldAt); assert.equal(o.policy, 'prototype-stage'); assert.match(o.stale, /captured before this run/);
  assert.equal(read('stardust/replica/gates/prototypes-1440/home/origin.json').at, oldAt);
  assert.match(readFileSync(join(root, 'stardust/replica/gates/prototypes-1440/_run.log'), 'utf8'), /origin home → stitch-live reused .*prototype-stage\) WARN captured before this run/);
  const nowAt = new Date().toISOString(); writeFileSync(join(g, 'live.json'), JSON.stringify({ writtenBy: 'gate.sh', url: 'https://www.example.com/', width: 1440, at: nowAt }));
  gate(args); assert.deepEqual(row().originReused, { from: 'stardust/replica/gates/home-1440/live.png', at: nowAt, policy: 'prototype-stage', stale: null });
  rmSync(join(g, 'live.json')); const mt = new Date(Math.floor((Date.now() - 7200e3) / 1000) * 1000); utimesSync(join(g, 'live.png'), mt, mt);
  gate(args);
  assert.equal(read('stardust/replica/gates/prototypes-1440/home/origin.json').at, mt.toISOString()); assert.equal(statSync(join(g, 'live.png')).mtime.toISOString(), mt.toISOString());
});
check('sandbox 9: a failed --recapture-origin keeps the previous origin AND says so — policy recapture-failed + stale when it predates the run, a WARN line, the presence inventory stays with it', () => {
  assert.equal(gate(['--only', 'home', '--recapture-origin']).origin, 1);
  const reused = gate(['--only', 'home']); assert.equal(reused.row('home').originReused.policy, 'same-run', 'origin.json now holds a same-run reuse record');
  const at = read('stardust/replica/gates/all-1440/home/origin.json').at;
  opener(new Date().toISOString());
  const a = gate(['--only', 'home', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.equal(a.status, 0, a.stderr + a.stdout); assert.equal(a.origin, 1);
  const ra = a.row('home').originReused; assert.equal(ra.policy, 'recapture-failed'); assert.equal(ra.at, at); assert.match(ra.stale, /captured before this run/);
  assert.match(runLog(), /origin home → stitch-live reused .*origin\.png \(captured .*; recapture-failed\) WARN re-shoot failed \(exit 1: .*\) — previous origin kept; captured before this run/);
  assert.equal(a.cp[0].had, true, 'the kept origin keeps its presence inventory (the probe judges its freshness)');
  assert.equal(gate(['--only', 'home', '--recapture-origin']).origin, 1);
  const b = gate(['--only', 'home', '--recapture-origin'], { STUB_ORIGIN_RC: '1' });
  assert.deepEqual(b.row('home').originReused, { from: 'stardust/replica/gates/all-1440/home/origin.png', at: read('stardust/replica/gates/all-1440/home/origin.json').at, policy: 'same-run', stale: null }, 'a kept plain capture is a recorded reuse, never silent');
  assert.match(runLog(), /same-run\) WARN re-shoot failed/); assert.equal(b.cp[0].had, true);
});
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
