#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — the origin-baseline contract of stitch-shot.mjs, no browser:
// the pure bookkeeping (baselineTargets, baselineProvenance, writeJsonAtomic, baselineExists / readBaselineProvenance,
// baselineStatus, compareBaseline, liveRecord), the two subcommands gate.sh calls (`baseline <dir>`, `record <live.json>`),
// the refusals that precede any capture (--check-baseline aimed at baseline.png; a re-freeze without --force) and the
// default-OFF parse. The capture itself needs playwright + pngjs (project devDependencies) and is exercised through
// gate.test.mjs's stub. Run: node skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_JSON, BASELINE_PNG, BASELINE_SCHEMA, BASELINE_WRITER, LIVE_RECORD_WRITER,
  baselineExists, baselineProvenance, baselineStatus, baselineTargets, compareBaseline, liveRecord,
  parseArgs, readBaselineProvenance, recordCommand, writeJsonAtomic,
} from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 15000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const tmp = (tag) => mkdtempSync(join(tmpdir(), `stitch-${tag}-`));
const AT = '2026-10-19T08:00:00.000Z';
const URL_A = 'https://origin.example/';
const freeze = (dir, prov = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, BASELINE_PNG), 'frozen-png');
  writeFileSync(join(dir, BASELINE_JSON), `${JSON.stringify(baselineProvenance({ url: URL_A, width: 1440, vh: 900, height: 2000, settle: true, chunks: 3, capturedAt: AT, ...prov }), null, 2)}\n`);
};

// ---- --help and the parse: default OFF ------------------------------------------------------------------------
await check('--help exits 0, writes nothing into the cwd and names the baseline flags and both subcommands', () => {
  const cwd = tmp('help');
  try {
    const r = run(['--help'], cwd);
    assert.equal(r.code, 0, r.err);
    for (const s of ['--freeze-baseline', '--check-baseline', '--force', 'baseline <dir>', 'record <live.json>', '--gate-against-baseline']) assert.ok(r.out.includes(s), `--help names ${s}`);
    assert.deepEqual(readdirSync(cwd), [], 'nothing written');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
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
    let r = run(['baseline', g], dir);
    assert.equal(r.code, 1); assert.equal(r.out, `no frozen baseline in ${g} (${BASELINE_PNG} + ${BASELINE_JSON})\n`); assert.equal(r.err, '');
    freeze(g);
    r = run(['baseline', g], dir);
    assert.equal(r.code, 0); assert.equal(r.out, `${AT}\n`);
    r = run(['baseline', g, '--url', URL_A, '--width', '1440'], dir);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, `${AT}\n`);
    r = run(['baseline', g, '--url', URL_A, '--width', '360'], dir);
    assert.equal(r.code, 1); assert.match(r.out, /^stale: .*frozen at 1440px, this round is 360px — re-freeze with --force\n$/);
    r = run(['baseline', g, '--url', 'https://origin.example/other', '--width', '1440'], dir);
    assert.equal(r.code, 1); assert.match(r.out, /^stale: .*frozen for https:\/\/origin\.example\/, this round's live URL is https:\/\/origin\.example\/other/);
    r = run(['baseline'], dir); assert.equal(r.code, 1); assert.match(r.err, /^stitch-shot baseline: needs <dir>/);
    r = run(['baseline', g, '--width'], dir); assert.equal(r.code, 1); assert.match(r.err, /--width needs a value/);
    r = run(['baseline', g, '--width', 'wide'], dir); assert.equal(r.code, 1); assert.match(r.err, /--width needs a whole number of px/);
    r = run(['baseline', g, '--bogus', 'x'], dir); assert.equal(r.code, 1); assert.match(r.err, /unknown flag --bogus/);
    r = run(['baseline', '--help'], dir); assert.equal(r.code, 0); assert.match(r.out, /^stitch-shot — /, 'baseline --help is the help');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await check('record <live.json>: writes the round\'s live.json atomically — origin "baseline" from baseline.json (at = its capturedAt, originBaseline), origin "live" with --at; every usage error exits 1 and writes nothing', () => {
  const dir = tmp('cmd-record');
  try {
    const g = join(dir, 'g'); freeze(g);
    const live = join(g, 'live.json');
    let r = run(['record', live, '--origin', 'baseline', '--baseline', join(g, BASELINE_JSON), '--url', URL_A, '--width', '1440'], dir);
    assert.equal(r.code, 0, r.err); assert.equal(r.out, ''); assert.equal(r.err, '');
    const text = readFileSync(live, 'utf8');
    assert.ok(text.endsWith('}\n'), 'pretty + trailing newline');
    assert.deepEqual(JSON.parse(text), { writtenBy: LIVE_RECORD_WRITER.baseline, origin: 'baseline', url: URL_A, width: 1440, at: AT, originBaseline: { capturedAt: AT, height: 2000 } });
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG, 'live.json'], 'no temp file left');
    r = run(['record', live, '--origin', 'live', '--url', URL_A, '--width', '360', '--at', AT], dir);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(readFileSync(live, 'utf8')), { writtenBy: LIVE_RECORD_WRITER.live, origin: 'live', url: URL_A, width: 360, at: AT });
    const fresh = join(g, 'other.json');
    const usage = (args, re) => { const u = run(['record', fresh, ...args], dir); assert.equal(u.code, 1, args.join(' ')); assert.match(u.err, re); assert.equal(existsSync(fresh), false, `nothing written for ${args.join(' ')}`); };
    usage(['--url', URL_A, '--width', '1440'], /--origin must be live or baseline/);
    usage(['--origin', 'frozen', '--url', URL_A, '--width', '1440'], /--origin must be live or baseline/);
    usage(['--origin', 'live', '--width', '1440'], /--url <u> and --width <px> are required/);
    usage(['--origin', 'live', '--url', URL_A, '--width', 'wide'], /--url <u> and --width <px> are required/);
    usage(['--origin', 'baseline', '--url', URL_A, '--width', '1440'], /--origin baseline needs --baseline <baseline\.json>/);
    usage(['--origin', 'baseline', '--url', URL_A, '--width', '1440', '--baseline', join(g, 'missing.json')], /cannot read .*missing\.json/);
    usage(['--origin', 'live', '--url', URL_A, '--width', '1440', '--at'], /--at needs a value/);
    usage(['--origin', 'live', '--url', URL_A, '--width', '1440', '--bogus', 'x'], /unknown flag --bogus/);
    r = run(['record'], dir); assert.equal(r.code, 1); assert.match(r.err, /^stitch-shot record: needs <live\.json>/);
    assert.equal(recordCommand([fresh, '--origin', 'live', '--url', URL_A, '--width', '1440', '--at', AT]), 0, 'in-process: 0');
    assert.equal(JSON.parse(readFileSync(fresh, 'utf8')).origin, 'live');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the refusals that precede any capture (no browser needed: they come before the lazy playwright import) -----
await check('--check-baseline <url> <dir>/baseline.png is refused with exit 2 before any capture — the frozen baseline is untouched, nothing else written', () => {
  const dir = tmp('refuse-check');
  try {
    const g = join(dir, 'g'); freeze(g);
    const r = run(['http://127.0.0.1:9/', join('g', BASELINE_PNG), '--check-baseline'], dir);
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
    const r = run(['http://127.0.0.1:9/', join('g', 'live.png'), '--freeze-baseline'], dir);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /^stitch-shot: --freeze-baseline writes the frozen origin baseline to g\/baseline\.png, not g\/live\.png \(live\.png is a round's live shot, never a freeze target\)\n/);
    assert.match(r.err, new RegExp(`stitch-shot: a frozen baseline already exists in g \\(captured ${AT}\\) — pass --force to re-freeze\\n$`));
    assert.deepEqual(readdirSync(g).sort(), [BASELINE_JSON, BASELINE_PNG], 'nothing written, live.png not created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(failed ? `\n${failed} check(s) failing` : '\nstitch-shot: all checks passed');
process.exit(failed ? 1 : 0);
