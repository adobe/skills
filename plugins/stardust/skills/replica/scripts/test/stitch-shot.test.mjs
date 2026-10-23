#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — stitch-shot.mjs without a browser: importing the module starts
// no capture; --help answers in an empty cwd with nothing written (playwright and pngjs load lazily); the sidecar
// path; the exit code per error class (BotChallengeError → 3, anything else → 1); recheckDenial on stub pages
// through the real pageDenial / botChallengeError — a vendor signature or a tiny one-error-heading page throws the
// exit-3 error naming "HTTP <status> denial page — …", "origin blocked" and --headed, an ordinary page is 'ok', a
// page the probe cannot read or a live-session copy that predates pageDenial is 'skipped: <reason>' with ONE stderr
// line. End to end, where playwright and pngjs are importable from the scripts dir: a local server's denial pages
// (the recorded shape — about 900 px of "can't process your request" + "Incident Number" served with 200 — the same
// rendered by script after load, and a tiny page under one error heading) exit 3 with no PNG and no capture.json;
// an ordinary page and a long article that mentions "press & hold" exit 0 and capture.json records denialCheck 'ok'.
// Also (0.34.3): parseArgs, overlayExtras, chunkTarget, scrollStalled, stitchRows, and end to end --consent closing a
// fixture consent box and --no-dismiss leaving it. And (0.34.5) the origin-baseline contract, no browser: the pure
// bookkeeping (baselineTargets, baselineProvenance, writeJsonAtomic, baselineExists / readBaselineProvenance,
// baselineStatus, compareBaseline, liveRecord), the two subcommands gate.sh calls (`baseline <dir>`, `record <live.json>`),
// the refusals that precede any capture and the default-OFF parse.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BASELINE_JSON, BASELINE_PNG, BASELINE_SCHEMA, BASELINE_WRITER, HELP, LIVE_RECORD_WRITER, UsageError,
  baselineExists, baselineProvenance, baselineStatus, baselineTargets, chunkTarget, compareBaseline, exitCodeFor, liveRecord, overlayExtras,
  parseArgs, readBaselineProvenance, recheckDenial, recordCommand, scrollStalled, sidecarOf, stitchRows, writeJsonAtomic,
} from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
// live-session.mjs in either layout (plugin tree / project copy) — imports nothing, so the pure part can use it
const LIB = ['../../../diff/scripts/live-session.mjs', '../../diff/live-session.mjs'].map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const session = await import(pathToFileURL(LIB).href);
let checks = 0; let failed = 0;
const check = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// stderr lines console.error printed while fn ran
const stderrOf = async (fn) => {
  const lines = []; const { error } = console;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { await fn(); } finally { console.error = error; }
  return lines;
};

const argv = (...a) => ['node', SCRIPT, ...a];
await check('parseArgs: positional url + out, defaults (1440×900, no settle, wait 1200, timeout 60000, dismissal on)', () => {
  const { url, out, opts } = parseArgs(argv('https://a/', 'o.png'));
  assert.equal(url, 'https://a/'); assert.equal(out, 'o.png');
  assert.equal(opts.width, 1440); assert.equal(opts.vh, 900); assert.equal(opts.settle, false); assert.equal(opts.wait, 1200); assert.equal(opts.timeout, 60000);
  assert.equal(opts.consent, null); assert.deepEqual(opts.dismiss, []); assert.equal(opts.noDismiss, false); assert.equal(opts.headed, false); assert.equal(opts.locale, null);
  assert.match(opts.ua, /Chrome\//);
});
await check('parseArgs: --settle raises the default wait to 3000; an explicit --wait wins; --width/--vh/--timeout/--ua/--locale/--headed', () => {
  assert.equal(parseArgs(argv('u', 'o', '--settle')).opts.wait, 3000);
  const { opts } = parseArgs(argv('u', 'o', '--settle', '--wait', '500', '--width', '360', '--vh', '640', '--timeout', '9000', '--ua', 'UA/1', '--locale', 'en-GB', '--headed'));
  assert.equal(opts.wait, 500); assert.equal(opts.width, 360); assert.equal(opts.vh, 640); assert.equal(opts.timeout, 9000); assert.equal(opts.ua, 'UA/1'); assert.equal(opts.locale, 'en-GB'); assert.equal(opts.headed, true);
});
await check('parseArgs: --consent keeps one selector, --dismiss splits on commas and trims, --no-dismiss is a flag', () => {
  const { opts } = parseArgs(argv('u', 'o', '--consent', '#yes', '--dismiss', ' .close , #later,, '));
  assert.equal(opts.consent, '#yes'); assert.deepEqual(opts.dismiss, ['.close', '#later']); assert.equal(opts.noDismiss, false);
  assert.equal(parseArgs(argv('u', 'o', '--no-dismiss')).opts.noDismiss, true);
});
await check('parseArgs: a missing positional or an unknown flag is a UsageError (the CLI prints HELP and exits 1)', () => {
  assert.throws(() => parseArgs(argv('u')), (e) => e instanceof UsageError && /need <url> and <out\.png>/.test(e.message));
  assert.throws(() => parseArgs(argv('u', 'o', '--bogus')), (e) => e instanceof UsageError && /unknown flag --bogus/.test(e.message));
});
await check('overlayExtras: the consent selector first, then the dismiss list; nothing when neither is set', () => {
  assert.deepEqual(overlayExtras({ consent: '#yes', dismiss: ['.a', '.b'] }), ['#yes', '.a', '.b']);
  assert.deepEqual(overlayExtras({ consent: null, dismiss: ['.a'] }), ['.a']);
  assert.deepEqual(overlayExtras({ consent: null, dismiss: [] }), []);
});
await check('chunkTarget: steps of vh, the last chunk clamped to totalH - vh, never negative', () => {
  assert.equal(chunkTarget(0, 2400, 900), 0); assert.equal(chunkTarget(900, 2400, 900), 900); assert.equal(chunkTarget(1800, 2400, 900), 1500);
  assert.equal(chunkTarget(0, 500, 900), 0);
});
await check('scrollStalled: fires only when the window did not advance AND the target is more than 4 px away', () => {
  assert.equal(scrollStalled(null, 0, 0), false, 'first chunk never stalls');
  assert.equal(scrollStalled(0, 900, 900), false, 'advanced');
  assert.equal(scrollStalled(900, 900, 1500), true, 'stuck with 600 px to go');
  assert.equal(scrollStalled(1497, 1497, 1500), false, 'fractional-scroll slack (3 px)');
  assert.equal(scrollStalled(900, 400, 1500), true, 'went backwards');
});
await check('stitchRows: chunks land at their y, rows past totalH and columns past width are dropped', () => {
  const px = (w, h, v) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4, v) });
  const out = stitchRows([{ y: 0, img: px(2, 2, 1) }, { y: 2, img: px(3, 2, 2) }], 2, 3);
  assert.equal(out.length, 2 * 3 * 4);
  assert.deepEqual([...out.subarray(0, 16)], Array(16).fill(1), 'rows 0–1 from chunk 1');
  assert.deepEqual([...out.subarray(16, 24)], Array(8).fill(2), 'row 2 from chunk 2, its third column dropped');
  const short = stitchRows([{ y: 0, img: px(2, 1, 7) }], 2, 3);
  assert.deepEqual([...short.subarray(8)], Array(16).fill(0), 'rows no chunk covers stay zero');
});

await check('sidecarOf: <out>.png → <out>.capture.json beside it (live.png → live.capture.json), any case of the extension', () => {
  assert.equal(sidecarOf('stardust/replica/gates/home-1440/live.png'), 'stardust/replica/gates/home-1440/live.capture.json');
  assert.equal(sidecarOf('/tmp/x/build.PNG'), '/tmp/x/build.capture.json');
  assert.equal(sidecarOf('shot'), 'shot.capture.json');
});
await check('exitCodeFor: a BotChallengeError is 3 (blocked — escalate --headed), every other error 1 (capture broke)', () => {
  assert.equal(exitCodeFor(session.botChallengeError('https://x.test/', 'HTTP 200 denial page — "System Down"', { denial: true })), 3);
  assert.equal(exitCodeFor(session.botChallengeError('https://x.test/', 'cf-mitigated: challenge')), 3);
  assert.equal(exitCodeFor(Object.assign(new Error('x'), { name: 'LiveHTTPError' })), 1);
  assert.equal(exitCodeFor(new Error('scroll stall at chunk target 900px')), 1);
  assert.equal(exitCodeFor(null), 1);
});
const pageOf = (probe) => ({ evaluate: async () => probe, waitForTimeout: async () => {} });
await check('recheckDenial (stub pages, the real pageDenial): a vendor signature → BotChallengeError naming HTTP <status>, the signature, "origin blocked", --headed — exit code 3', async () => {
  const denied = { title: 'Notice', text: 'System Down Please try again later.', bytes: 35, headings: [], frames: [] };
  const err = await recheckDenial(session, pageOf(denied), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(err && err.name, 'BotChallengeError');
  assert.equal(err.marker, 'HTTP 200 denial page — "System Down"');
  assert.equal(err.url, 'https://x.test/');
  assert.match(err.message, /^bot challenge at https:\/\/x\.test\/: HTTP 200 denial page — "System Down" — origin blocked/);
  assert.match(err.message, /--headed/);
  assert.equal(exitCodeFor(err), 3);
  const recorded = { title: 'Notice', text: 'We can\'t process your request We\'re sorry, we can\'t process your request right now. Please try again later. Incident Number: 18.4f2a7c31.1700000000.1a2b3c', bytes: 170, headings: ['We can\'t process your request'], frames: [] };
  const late = await recheckDenial(session, pageOf(recorded), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(late && late.marker, 'HTTP 200 denial page — "can\'t process your request" + "Incident Number"', 'the recorded shape, rendered after the entry read');
});
await check('recheckDenial: the generic rule — a page under 2 KB of text under one error heading → the same error naming the bytes and the heading', async () => {
  const tiny = { title: 'Error', text: 'Something went wrong Please try again in a few minutes.', bytes: 56, headings: ['Something went wrong'], frames: [] };
  const err = await recheckDenial(session, pageOf(tiny), 'https://x.test/', 200).then(() => null, (e) => e);
  assert.equal(err && err.marker, 'HTTP 200 denial page — 56 B of text under one error heading "Something went wrong"');
  assert.equal(exitCodeFor(err), 3);
});
await check('recheckDenial: an ordinary page → \'ok\', nothing on stderr; a page the probe cannot read → \'skipped: <reason>\' with ONE stderr line, no throw', async () => {
  const ordinary = { title: 'Spring range', text: 'Ordinary page copy. '.repeat(200), bytes: 4000, headings: ['Spring range', 'New arrivals'], frames: [] };
  let out;
  assert.deepEqual(await stderrOf(async () => { out = await recheckDenial(session, pageOf(ordinary), 'https://x.test/', 200); }), []);
  assert.equal(out, 'ok');
  const small = { title: 'Coming soon', text: 'Coming soon. Our new site launches in May.', bytes: 42, headings: ['Coming soon'], frames: [] };
  assert.equal(await recheckDenial(session, pageOf(small), 'https://x.test/', 200), 'ok', 'a small page under one plain heading');
  const unreadable = { evaluate: async () => { throw new Error('Execution context was destroyed, most likely because of a navigation\n  at …'); }, waitForTimeout: async () => {} };
  let skipped;
  assert.deepEqual(await stderrOf(async () => { skipped = await recheckDenial(session, unreadable, 'https://x.test/', 200); }), ['stitch-shot: denial-page check skipped (Execution context was destroyed, most likely because of a navigation)']);
  assert.equal(skipped, 'skipped: Execution context was destroyed, most likely because of a navigation');
});
await check('recheckDenial: a live-session copy that predates pageDenial / botChallengeError never throws — \'skipped: live-session.mjs predates pageDenial\' and ONE stderr line naming the stale copy', async () => {
  for (const stale of [{}, { pageDenial: session.pageDenial }, { botChallengeError: session.botChallengeError }]) {
    let out;
    const lines = await stderrOf(async () => { out = await recheckDenial(stale, { evaluate: async () => { throw new Error('never read'); } }, 'https://x.test/', 200); });
    assert.deepEqual(lines, ['stitch-shot: denial-page check skipped (live-session.mjs predates pageDenial — copy the diff skill\'s live-session.mjs alongside)'], Object.keys(stale).join() || 'neither');
    assert.equal(out, 'skipped: live-session.mjs predates pageDenial');
  }
});
await check('--help in an empty cwd: exit 0, usage, exit 3 named for an edge interstitial or a 2xx denial page with --headed, the capture.json record — nothing written, no playwright needed; importing this module started no capture', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Usage: node stitch-shot\.mjs <url> <out\.png>/);
    assert.match(r.stdout, /3 bot challenge[^]*2xx denial page[^]*pageDenial[^]*no PNG, no capture\.json; escalate --headed/);
    for (const f of ['--consent <sel>', '--dismiss <sel,…>', '--no-dismiss', '--freeze-baseline', '--check-baseline', '--force', 'baseline <dir>', 'record <live.json>', '--gate-against-baseline']) assert.ok(r.stdout.includes(f) && HELP.includes(f), f);
    assert.match(r.stdout, /<stem>\.capture\.json/);
    assert.match(r.stdout, /denialCheck = 'ok' \|\n'skipped: <reason>'/);
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(cwd), []);
    // no arguments: the usage error, exit 1, before any I/O (and before playwright is asked for)
    const bare = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /^need <url> and <out\.png>/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

const runIn = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 15000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const tmp = (tag) => mkdtempSync(join(tmpdir(), `stitch-${tag}-`));
const AT = '2026-10-19T08:00:00.000Z';
const URL_A = 'https://origin.example/';
const freeze = (dir, prov = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, BASELINE_PNG), 'frozen-png');
  writeFileSync(join(dir, BASELINE_JSON), `${JSON.stringify(baselineProvenance({ url: URL_A, width: 1440, vh: 900, height: 2000, settle: true, chunks: 3, capturedAt: AT, ...prov }), null, 2)}\n`);
};

// ---- origin baseline: the parse, default OFF ------------------------------------------------------------------------
await check('parseArgs: the baseline flags are OFF by default and the other options are untouched; the flags switch on', () => {
  const opts = (extra) => parseArgs(['node', 'stitch-shot.mjs', URL_A, 'g/live.png', ...extra]).opts;
  const off = opts([]);
  assert.deepEqual([off.freezeBaseline, off.checkBaseline, off.force], [false, false, false], 'default OFF');
  assert.deepEqual([off.width, off.vh, off.settle, off.wait, off.timeout], [1440, 900, false, 1200, 60000], 'the rest as before');
  const on = opts(['--freeze-baseline', '--force', '--settle']);
  assert.deepEqual([on.freezeBaseline, on.force, on.checkBaseline, on.wait], [true, true, false, 3000]);
  assert.equal(opts(['--check-baseline']).checkBaseline, true);
});

// ---- the pure bookkeeping -------------------------------------------------------------------------------------
await check('baselineTargets: no flags → the given output and no gate dir; a freeze always lands in <dir>/baseline.png (a freeze aimed at live.png is redirected); a check keeps its output and refuses baseline.png', () => {
  assert.deepEqual(baselineTargets('g/live.png', {}), { out: 'g/live.png', baselineDir: null, redirected: false, refusal: null });
  assert.deepEqual(baselineTargets('g/live.png', { freezeBaseline: true }), { out: join('g', BASELINE_PNG), baselineDir: 'g', redirected: true, refusal: null });
  assert.deepEqual(baselineTargets(join('g', BASELINE_PNG), { freezeBaseline: true }), { out: join('g', BASELINE_PNG), baselineDir: 'g', redirected: false, refusal: null });
  assert.deepEqual(baselineTargets('g/live.png', { checkBaseline: true }), { out: 'g/live.png', baselineDir: 'g', redirected: false, refusal: null });
  const refused = baselineTargets(join('g', BASELINE_PNG), { checkBaseline: true });
  assert.deepEqual([refused.out, refused.baselineDir, refused.redirected], [join('g', BASELINE_PNG), 'g', false]);
  assert.match(refused.refusal, /--check-baseline captures a fresh shot to compare against baseline\.png and never writes it — name another output \(e\.g\. g\/live\.png\)/);
  assert.equal(baselineTargets(join('g', BASELINE_PNG), { freezeBaseline: true, checkBaseline: true }).refusal, null, 'freeze + check: the freeze owns baseline.png');
});
await check('baselineProvenance has the documented shape; numbers are numbers; a non-array fontsFailed becomes []', () => {
  const p = baselineProvenance({ url: URL_A, width: '1440', vh: 900, height: 2000, settle: true, chunks: 3, fontsFailed: ['Brand Sans'], capturedAt: AT });
  assert.deepEqual(Object.keys(p), ['writtenBy', 'schema', 'capturedAt', 'url', 'width', 'vh', 'height', 'settle', 'chunks', 'fontsFailed']);
  assert.deepEqual(p, { writtenBy: BASELINE_WRITER, schema: BASELINE_SCHEMA, capturedAt: AT, url: URL_A, width: 1440, vh: 900, height: 2000, settle: true, chunks: 3, fontsFailed: ['Brand Sans'] });
  assert.deepEqual(baselineProvenance({ url: URL_A, width: 360, height: 10, fontsFailed: null }).fontsFailed, []);
  assert.match(baselineProvenance({ url: URL_A, width: 360, height: 10 }).capturedAt, /^\d{4}-\d{2}-\d{2}T/, 'capturedAt defaults to now');
});
await check('writeJsonAtomic writes pretty JSON with a trailing newline through a sibling temp file and leaves none; baselineExists needs BOTH files; readBaselineProvenance round-trips and is null when unreadable', () => {
  const dir = tmp('atomic');
  try {
    const prov = baselineProvenance({ url: URL_A, width: 360, height: 5200, capturedAt: AT });
    assert.equal(baselineExists(dir), false, 'nothing yet');
    writeJsonAtomic(join(dir, BASELINE_JSON), prov);
    assert.equal(baselineExists(dir), false, 'baseline.json alone is not a baseline');
    writeFileSync(join(dir, BASELINE_PNG), 'png-bytes');
    assert.equal(baselineExists(dir), true, 'PNG + JSON');
    const text = readFileSync(join(dir, BASELINE_JSON), 'utf8');
    assert.ok(text.endsWith('}\n') && text.includes('\n  "schema"'), 'pretty + trailing newline');
    assert.deepEqual(readBaselineProvenance(dir), prov, 'round-trips');
    assert.equal(readdirSync(dir).some((n) => n.endsWith('.tmp')), false, 'no temp file left behind');
    writeFileSync(join(dir, BASELINE_JSON), '{ not json');
    assert.equal(readBaselineProvenance(dir), null, 'unreadable → null');
    writeFileSync(join(dir, BASELINE_JSON), '"a string"');
    assert.equal(readBaselineProvenance(dir), null, 'not an object → null');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('baselineStatus names, in one line, why a baseline is unusable — missing, a lone PNG, a lone JSON, unreadable, frozen for another URL, frozen at another width — and is ok for this page at this width (a trailing slash on the origin is the same URL)', () => {
  const dir = tmp('status');
  try {
    const g = join(dir, 'g');
    assert.deepEqual(baselineStatus(g), { ok: false, why: `no frozen baseline in ${g} (${BASELINE_PNG} + ${BASELINE_JSON})` });
    mkdirSync(g); writeFileSync(join(g, BASELINE_PNG), 'png');
    assert.match(baselineStatus(g).why, /baseline\.png has no baseline\.json beside it \(an interrupted freeze\) — re-freeze with --force$/);
    rmSync(join(g, BASELINE_PNG)); writeFileSync(join(g, BASELINE_JSON), '{}');
    assert.match(baselineStatus(g).why, /baseline\.json has no baseline\.png beside it — re-freeze with --force$/);
    writeFileSync(join(g, BASELINE_PNG), 'png'); writeFileSync(join(g, BASELINE_JSON), '{ nope');
    assert.match(baselineStatus(g).why, /baseline\.json is unreadable — re-freeze with --force$/);
    freeze(g);
    assert.equal(baselineStatus(g).ok, true, 'no url / width asked: present and readable is enough');
    assert.equal(baselineStatus(g, { url: 'https://origin.example', width: 1440 }).ok, true, 'same origin without the trailing slash');
    assert.equal(baselineStatus(g, { url: URL_A, width: '1440' }).ok, true, 'width as a string');
    assert.deepEqual(baselineStatus(g, { url: URL_A, width: 1440 }).provenance.capturedAt, AT);
    assert.match(baselineStatus(g, { url: 'https://origin.example/other' }).why, /^stale: .*baseline\.json was frozen for https:\/\/origin\.example\/, this round's live URL is https:\/\/origin\.example\/other — re-freeze with --force$/);
    assert.match(baselineStatus(g, { width: 360 }).why, /^stale: .*baseline\.json was frozen at 1440px, this round is 360px — re-freeze with --force$/);
    assert.match(baselineStatus(g, { url: URL_A, width: 360 }).why, /frozen at 1440px/, 'both given: the url matches, the width is what is stale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('compareBaseline reports the height delta with no verdict; a missing height reads as null', () => {
  const base = baselineProvenance({ url: URL_A, width: 1440, height: 3093, capturedAt: AT });
  assert.deepEqual(compareBaseline(base, { height: 3093 }), { baselineHeight: 3093, freshHeight: 3093, dHeight: 0 });
  assert.deepEqual(compareBaseline(base, { height: 2661 }), { baselineHeight: 3093, freshHeight: 2661, dHeight: -432 });
  assert.deepEqual(compareBaseline({}, { height: 2904 }), { baselineHeight: null, freshHeight: 2904, dHeight: null });
});
await check('liveRecord: origin "baseline" carries at = the baseline\'s capturedAt and originBaseline { capturedAt, height }; origin "live" carries --at; each names its writer', () => {
  const base = baselineProvenance({ url: URL_A, width: 1440, height: 2000, capturedAt: AT });
  assert.deepEqual(liveRecord({ origin: 'baseline', url: URL_A, width: '1440', baseline: base }), { writtenBy: LIVE_RECORD_WRITER.baseline, origin: 'baseline', url: URL_A, width: 1440, at: AT, originBaseline: { capturedAt: AT, height: 2000 } });
  assert.deepEqual(liveRecord({ origin: 'baseline', url: URL_A, width: 1440, baseline: null }).originBaseline, { capturedAt: null, height: null }, 'an unreadable baseline.json → nulls, never a throw');
  assert.deepEqual(liveRecord({ origin: 'live', url: URL_A, width: 360, at: AT }), { writtenBy: LIVE_RECORD_WRITER.live, origin: 'live', url: URL_A, width: 360, at: AT });
});

// ---- the subcommands (what gate.sh calls) ---------------------------------------------------------------------
await check('baseline <dir>: exit 1 and the reason on stdout when there is none; exit 0 and the capturedAt when frozen; stale for another width or URL → exit 1 with the stale line; usage errors exit 1 on stderr', () => {
  const dir = tmp('cmd-baseline');
  try {
    const g = join(dir, 'g');
    let r = runIn(['baseline', g], dir);
    assert.equal(r.code, 1); assert.equal(r.out, `no frozen baseline in ${g} (${BASELINE_PNG} + ${BASELINE_JSON})\n`); assert.equal(r.err, '');
    freeze(g);
    r = runIn(['baseline', g], dir);
    assert.equal(r.code, 0); assert.equal(r.out, `${AT}\n`);
    r = runIn(['baseline', g, '--url', URL_A, '--width', '1440'], dir);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, `${AT}\n`);
    r = runIn(['baseline', g, '--url', URL_A, '--width', '360'], dir);
    assert.equal(r.code, 1); assert.match(r.out, /^stale: .*frozen at 1440px, this round is 360px — re-freeze with --force\n$/);
    r = runIn(['baseline', g, '--url', 'https://origin.example/other', '--width', '1440'], dir);
    assert.equal(r.code, 1); assert.match(r.out, /^stale: .*frozen for https:\/\/origin\.example\/, this round's live URL is https:\/\/origin\.example\/other/);
    r = runIn(['baseline'], dir); assert.equal(r.code, 1); assert.match(r.err, /^stitch-shot baseline: needs <dir>/);
    r = runIn(['baseline', g, '--width'], dir); assert.equal(r.code, 1); assert.match(r.err, /--width needs a value/);
    r = runIn(['baseline', g, '--width', 'wide'], dir); assert.equal(r.code, 1); assert.match(r.err, /--width needs a whole number of px/);
    r = runIn(['baseline', g, '--bogus', 'x'], dir); assert.equal(r.code, 1); assert.match(r.err, /unknown flag --bogus/);
    r = runIn(['baseline', '--help'], dir); assert.equal(r.code, 0); assert.match(r.out, /^stitch-shot — /, 'baseline --help is the help');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('record <live.json>: writes the round\'s live.json atomically — origin "baseline" from baseline.json (at = its capturedAt, originBaseline), origin "live" with --at; every usage error exits 1 and writes nothing', () => {
  const dir = tmp('cmd-record');
  try {
    const g = join(dir, 'g'); freeze(g);
    const live = join(g, 'live.json');
    let r = runIn(['record', live, '--origin', 'baseline', '--baseline', join(g, BASELINE_JSON), '--url', URL_A, '--width', '1440'], dir);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, ''); assert.equal(r.err, '');
    const text = readFileSync(live, 'utf8');
    assert.ok(text.endsWith('}\n'), 'pretty + trailing newline');
    assert.deepEqual(JSON.parse(text), { writtenBy: LIVE_RECORD_WRITER.baseline, origin: 'baseline', url: URL_A, width: 1440, at: AT, originBaseline: { capturedAt: AT, height: 2000 } });
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG, 'live.json'], 'no temp file left');
    r = runIn(['record', live, '--origin', 'live', '--url', URL_A, '--width', '360', '--at', AT], dir);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(readFileSync(live, 'utf8')), { writtenBy: LIVE_RECORD_WRITER.live, origin: 'live', url: URL_A, width: 360, at: AT });
    const fresh = join(g, 'other.json');
    const usage = (args, re) => { const u = runIn(['record', fresh, ...args], dir); assert.equal(u.code, 1, args.join(' ')); assert.match(u.err, re); assert.equal(existsSync(fresh), false, `nothing written for ${args.join(' ')}`); };
    usage(['--url', URL_A, '--width', '1440'], /--origin must be live or baseline/);
    usage(['--origin', 'frozen', '--url', URL_A, '--width', '1440'], /--origin must be live or baseline/);
    usage(['--origin', 'live', '--width', '1440'], /--url <u> and --width <px> are required/);
    usage(['--origin', 'live', '--url', URL_A, '--width', 'wide'], /--url <u> and --width <px> are required/);
    usage(['--origin', 'baseline', '--url', URL_A, '--width', '1440'], /--origin baseline needs --baseline <baseline\.json>/);
    usage(['--origin', 'baseline', '--url', URL_A, '--width', '1440', '--baseline', join(g, 'missing.json')], /cannot read .*missing\.json/);
    usage(['--origin', 'live', '--url', URL_A, '--width', '1440', '--at'], /--at needs a value/);
    usage(['--origin', 'live', '--url', URL_A, '--width', '1440', '--bogus', 'x'], /unknown flag --bogus/);
    r = runIn(['record'], dir); assert.equal(r.code, 1); assert.match(r.err, /^stitch-shot record: needs <live\.json>/);
    assert.equal(recordCommand([fresh, '--origin', 'live', '--url', URL_A, '--width', '1440', '--at', AT]), 0, 'in-process: 0');
    assert.equal(JSON.parse(readFileSync(fresh, 'utf8')).origin, 'live');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the refusals that precede any capture (no browser needed: they come before the lazy playwright import) -----
await check('--check-baseline <url> <dir>/baseline.png is refused with exit 2 before any capture — the frozen baseline is untouched, nothing else written', () => {
  const dir = tmp('refuse-check');
  try {
    const g = join(dir, 'g'); freeze(g);
    const r = runIn(['http://127.0.0.1:9/', join('g', BASELINE_PNG), '--check-baseline'], dir);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /^stitch-shot: --check-baseline captures a fresh shot to compare against baseline\.png and never writes it — name another output \(e\.g\. g\/live\.png\)\n$/);
    assert.equal(readFileSync(join(g, BASELINE_PNG), 'utf8'), 'frozen-png', 'the baseline is untouched');
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG], 'nothing else written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('--freeze-baseline over an existing baseline is refused with exit 2 before any capture (the capture time named; --force is the way past); a freeze aimed at live.png says where it will land', () => {
  const dir = tmp('refuse-freeze');
  try {
    const g = join(dir, 'g'); freeze(g);
    const r = runIn(['http://127.0.0.1:9/', join('g', 'live.png'), '--freeze-baseline'], dir);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /^stitch-shot: --freeze-baseline writes the frozen origin baseline to g\/baseline\.png, not g\/live\.png \(live\.png is a round's live shot, never a freeze target\)\n/);
    assert.match(r.err, new RegExp(`stitch-shot: a frozen baseline already exists in g \\(captured ${AT}\\) — pass --force to re-freeze\\n$`));
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG], 'nothing written, live.png not created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- end-to-end (needs playwright + pngjs importable from the script's location) ---------------------------
const pwProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('playwright'); await import('pngjs');"], { cwd: dirname(SCRIPT), encoding: 'utf8' });
if (pwProbe.status !== 0) {
  console.log('skip  end-to-end stitch-shot (playwright / pngjs not importable from the scripts dir; run this test in an environment that has them)');
} else {
  const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html,body{margin:0}section{height:600px;background:#ddd}</style></head><body>${body}</body></html>`;
  // the recorded shape: about 900 px, "can't process your request" + "Incident Number", status 200, one heading
  const RECORDED = '<div style="height:900px;padding:40px;font:16px sans-serif"><h1>We can\'t process your request</h1><p>We\'re sorry, we can\'t process your request right now. Please try again later.</p><p>Incident Number: 18.4f2a7c31.1700000000.1a2b3c</p></div>';
  const pages = {
    '/ok': html('Spring range', '<h1>Spring range</h1><section></section><h2>New arrivals</h2><section></section><p>Three lines of ordinary copy.</p>'),
    '/denied': html('Notice', RECORDED),
    '/denied-late': html('Notice', `<p>Loading the page.</p><script>document.addEventListener('DOMContentLoaded', () => setTimeout(() => { document.body.innerHTML = ${JSON.stringify(RECORDED)}; }, 500));</script>`),
    '/denied-heading': html('Error', '<h1>Something went wrong</h1><p>Please try again in a few minutes.</p>'),
    '/consent': html('Consent', '<style>body{height:2400px}h1,p{margin:0}#cmp{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><h1>Welcome</h1><p>Ordinary copy.</p><div id="cmp"><button id="yes" onclick="document.getElementById(\'cmp\').remove()">Yes</button></div>'),
    // a consent manager whose accept control reads "Allow all" (no Accept text): matched by its vendor class, no flag
    '/cmp-allow-all': html('Consent', '<style>body{height:2400px}h1,p{margin:0}.ch2-container{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><h1>Welcome</h1><p>Ordinary copy.</p><div class="ch2-container"><button class="ch2-btn ch2-allow-all-btn" onclick="this.parentNode.remove()">Allow all</button></div>'),
    // the vendor class repeated in a hidden preference panel ahead of the banner: the visible copy is the one clicked
    '/cmp-hidden-first': html('Consent', '<style>body{height:2400px}h1,p{margin:0}.cky-consent-bar{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><div class="cky-preference-center" style="display:none"><button class="cky-btn-accept">Accept all</button></div><h1>Welcome</h1><p>Ordinary copy.</p><div class="cky-consent-bar"><button class="cky-btn-accept" onclick="this.parentNode.remove()">Accept all</button></div>'),
    // an unlisted manager: "Disallow all" and "Accept only necessary" come first in the DOM; only "Allow all" is the accept
    '/cmp-unlisted': html('Consent', '<style>body{height:2400px}h1,p{margin:0}#bar{position:fixed;inset:auto 0 0 0;height:120px;background:#fff}</style><h1>Welcome</h1><p>Ordinary copy.</p><div id="bar"><button onclick="this.parentNode.remove()">Disallow all</button><button onclick="this.parentNode.remove()">Accept only necessary</button><button onclick="this.parentNode.remove()">Allow all</button></div>'),
    '/article': html('Voice notes', `<h1>Voice notes</h1>${'<p>Press &amp; hold the button to record a voice note, then release it to send. The note is kept for thirty days and can be replayed from the thread.</p>'.repeat(30)}<section></section><section></section>`),
  };
  const server = createServer((req, res) => {
    const body = pages[new URL(req.url, 'http://127.0.0.1/').pathname];
    if (!body) { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const work = mkdtempSync(join(tmpdir(), 'stitch-e2e-'));
  const stitch = (path, name, extra = []) => new Promise((resolveRun) => {
    const out = join(work, `${name}.png`);
    const child = spawn(process.execPath, [SCRIPT, `${base}${path}`, out, '--width', '800', '--vh', '600', '--wait', '900', '--timeout', '30000', ...extra], { cwd: work });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr, out, sidecar: sidecarOf(out), cap: existsSync(sidecarOf(out)) ? JSON.parse(readFileSync(sidecarOf(out), 'utf8')) : null }));
  });
  try {
    const pngSize = (f) => { const b = readFileSync(f); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
    const [ok, article, consent, noDismiss, allowAll, hiddenFirst, unlisted, ...denied] = await Promise.all([stitch('/ok', 'ok'), stitch('/article', 'article'), stitch('/consent', 'consent', ['--consent', '#yes']), stitch('/consent', 'nodismiss', ['--no-dismiss']), stitch('/cmp-allow-all', 'allow-all'), stitch('/cmp-hidden-first', 'hidden-first'), stitch('/cmp-unlisted', 'unlisted'), stitch('/denied', 'denied'), stitch('/denied-late', 'denied-late'), stitch('/denied-heading', 'denied-heading')]);
    await check('e2e: an ordinary page → exit 0, the PNG and capture.json beside it — { writtenBy, url, width, vh, height, chunks, denialCheck: \'ok\', at }', () => {
      assert.equal(ok.status, 0, ok.stderr);
      assert.ok(existsSync(ok.out), 'the PNG');
      assert.ok(ok.cap, 'the sidecar');
      assert.deepEqual(Object.keys(ok.cap), ['writtenBy', 'url', 'width', 'vh', 'height', 'chunks', 'denialCheck', 'at']);
      assert.deepEqual([ok.cap.writtenBy, ok.cap.url, ok.cap.width, ok.cap.vh, ok.cap.denialCheck], ['skills/replica/scripts/stitch-shot.mjs', `${base}/ok`, 800, 600, 'ok']);
      assert.ok(ok.cap.height >= 1200 && ok.cap.chunks >= 2 && !Number.isNaN(Date.parse(ok.cap.at)), JSON.stringify(ok.cap));
      assert.match(ok.stdout, /stitched .*ok\.png: 800x\d+ from \d+ chunks/);
      assert.doesNotMatch(ok.stderr, /denial/);
    });
    await check('e2e: a long article whose text says "press & hold the button" is no denial page — exit 0, denialCheck \'ok\'', () => {
      assert.equal(article.status, 0, article.stderr);
      assert.equal(article.cap && article.cap.denialCheck, 'ok');
      assert.doesNotMatch(article.stderr, /denial/);
    });
    await check('e2e: a consent manager in the built-in candidates is dismissed with no flag — its "Allow all" button by vendor class', () => {
      assert.equal(allowAll.status, 0, allowAll.stderr + allowAll.stdout);
      assert.match(allowAll.stdout, /consent dismissed via \.ch2-allow-all-btn/);
    });
    await check('e2e: a vendor class repeated in a hidden panel first — the visible copy is clicked, the vendor entry credited', () => {
      assert.equal(hiddenFirst.status, 0, hiddenFirst.stderr + hiddenFirst.stdout);
      assert.match(hiddenFirst.stdout, /consent dismissed via \.cky-btn-accept/);
    });
    await check('e2e: an unlisted manager — "Allow all" is clicked, never "Disallow all" or "Accept only necessary" ahead of it', () => {
      assert.equal(unlisted.status, 0, unlisted.stderr + unlisted.stdout);
      assert.match(unlisted.stdout, /consent dismissed via button:text-matches\("\^\[\^a-z\]\*allow all/);
    });
    await check('e2e: --consent <sel> closes the fixture consent box; the capture is width × document height from vh-sized chunks', () => {
      assert.equal(consent.status, 0, consent.stderr + consent.stdout);
      assert.match(consent.stdout, /overlay dismissed via extra selector #yes/); assert.match(consent.stdout, /stitched .*: 800x2400 from 4 chunks/);
      assert.deepEqual(pngSize(consent.out), { width: 800, height: 2400 }); assert.equal(consent.cap && consent.cap.denialCheck, 'ok');
    });
    await check('e2e: --no-dismiss leaves overlays alone and says so', () => {
      assert.equal(noDismiss.status, 0, noDismiss.stderr + noDismiss.stdout);
      assert.match(noDismiss.stdout, /overlays left as the page shows them \(--no-dismiss\)/); assert.doesNotMatch(noDismiss.stdout, /dismissed via/);
      assert.deepEqual(pngSize(noDismiss.out), { width: 800, height: 2400 });
    });
    const expected = [
      ['/denied', 'HTTP 200 denial page — "can\'t process your request" + "Incident Number"'],
      ['/denied-late', 'HTTP 200 denial page — "can\'t process your request" + "Incident Number"'],
      ['/denied-heading', 'HTTP 200 denial page — '],
    ];
    for (const [i, [path, marker]] of expected.entries()) {
      const r = denied[i];
      await check(`e2e: ${path} → exit 3, one reason line naming ${marker.trim()}…, "origin blocked" and --headed; no PNG, no capture.json`, () => {
        assert.equal(r.status, 3, r.stderr || r.stdout);
        assert.ok(r.stderr.includes(`stitch-shot error: bot challenge at ${base}${path}: ${marker}`), r.stderr);
        assert.ok(r.stderr.includes('origin blocked') && r.stderr.includes('--headed'), r.stderr);
        if (path === '/denied-heading') assert.match(r.stderr, /B of text under one error heading "Something went wrong"/);
        assert.equal(r.stderr.trim().split('\n').filter((l) => l.startsWith('stitch-shot error:')).length, 1, 'one reason line');
        assert.deepEqual([existsSync(r.out), existsSync(r.sidecar)], [false, false]);
      });
    }
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nstitch-shot: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
