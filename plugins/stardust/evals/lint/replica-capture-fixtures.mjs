#!/usr/bin/env node
// Fixture tests for the replica capture instruments (stitch-shot, gate.sh,
// live-session dismissOverlays / block route, pixel-compare offsets,
// review-image, anchor --landmarks).
//
// Two layers, so `npm run lint:stardust` is meaningful with or without the
// gate's browser dependencies installed:
//   1. ALWAYS — `node --check` on every instrument, `bash -n` on gate.sh,
//      static contract greps (the exit-5 header line, the integer-scroll
//      rounding, the opacity hide, gate.sh's rc-5 branch, route.fallback),
//      and pure-function tests on the dependency-free exports
//      (live-session parseBlockList/blockDecision/label tables/normLabel,
//      review-image glyphs/layouts/downscale, capture-sidecar loadMasksJson,
//      pixel-compare pairRects/buildMasks/rasterMasks and --masks-json --check).
//      A stub node_modules lets the browser/PNG modules import here too.
//      The stub dir is removed in a finally — a throwing import never leaks it.
//   2. WITH DEPS — the browser-driven fixtures under
//      lint/fixtures/replica-capture/ (a fixed header that must be hidden on
//      chunks 2+, a static page that must stay byte-identical, an overlay
//      wall that must exit 5, --expect-height 99999 → exit 5, the overlays
//      page for dismissOverlays, a sticky-header page that must NOT read as a
//      consent banner, a blocked third-party sub-resource, gate.sh rounds
//      incl. the anchor-live.skip marker). They
//      run when a node_modules tree with playwright + pngjs + pixelmatch is
//      resolvable: `STARDUST_GATE_DEPS=<dir>/node_modules`, else the repo
//      root's node_modules. Otherwise this layer prints ONE `SKIP` line and
//      the runner still exits 0 — never silently.
//
// Usage: node plugins/stardust/evals/lint/replica-capture-fixtures.mjs
//        (exit 1 on findings)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const PLUGIN = join(HERE, '..', '..');
const REPLICA = join(PLUGIN, 'skills', 'replica', 'scripts');
const DIFF = join(PLUGIN, 'skills', 'diff', 'scripts');
const FIX = join(HERE, 'fixtures', 'replica-capture');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const src = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------- layer 1
// Behavioural, not textual: a stub node_modules (playwright / pngjs /
// pixelmatch export the names the instruments import) lets every instrument
// be IMPORTED and its --help RUN here, so the contracts are asserted on
// exports and output — a reformat of the source cannot break or disable them.
// The few checks that stay source-shaped are marked (shape); their behaviour
// is asserted in layer 2 (browser).
function stubDeps() {
  const tmp = mkdtempSync(join(tmpdir(), 'replica-capture-l1-'));
  mkdirSync(join(tmp, 'replica')); mkdirSync(join(tmp, 'diff'));
  for (const f of readdirSync(REPLICA)) cpSync(join(REPLICA, f), join(tmp, 'replica', f), { recursive: true });
  for (const f of readdirSync(DIFF)) cpSync(join(DIFF, f), join(tmp, 'diff', f), { recursive: true });
  const stubs = { playwright: 'exports.chromium = {};', pngjs: 'exports.PNG = class PNG {};', pixelmatch: 'module.exports = function pixelmatch() { return 0; };' };
  for (const [name, body] of Object.entries(stubs)) {
    mkdirSync(join(tmp, 'node_modules', name), { recursive: true });
    writeFileSync(join(tmp, 'node_modules', name, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
    writeFileSync(join(tmp, 'node_modules', name, 'index.js'), body);
  }
  return tmp;
}
const SCRIPTS = ['stitch-shot.mjs', 'anchor.mjs', 'chrome-parity.mjs', 'sibling-variance.mjs', 'motion-observe.mjs', 'pixel-compare.mjs', 'crop-compare.mjs', 'capture-sidecar.mjs', 'review-image.mjs', 'run-capped.mjs'];
const L1 = stubDeps();
// The stub dir goes on every exit path: the finally below covers a throwing import;
// this hook covers an in-process process.exit() from an imported parser (an unknown
// flag in parseArgs exits the RUNNER, not a child) — no leftover replica-capture-l1-*.
process.on('exit', () => { try { rmSync(L1, { recursive: true, force: true }); } catch { /* gone */ } });
// Run an imported parser in-process without letting its process.exit() kill the runner.
const inProc = (fn) => { const ex = process.exit; process.exit = (c) => { throw new Error(`process.exit(${c})`); }; try { return fn(); } catch (e) { return { error: e.message }; } finally { process.exit = ex; } };
async function layer1() {
const l1 = (dir, f) => join(L1, dir, f);
const runL1 = (dir, f, args) => spawnSync(process.execPath, [l1(dir, f), ...args], { encoding: 'utf8', cwd: L1 });
const help = (dir, f) => { const r = runL1(dir, f, ['--help']); check(r.status === 0 && /usage/i.test(r.stdout), `${f} --help: exit ${r.status}\n${r.stderr}`); return r.stdout; };

for (const f of SCRIPTS) {
  if (!existsSync(join(REPLICA, f))) continue;
  const r = spawnSync(process.execPath, ['--check', join(REPLICA, f)], { encoding: 'utf8' });
  check(r.status === 0, `${f}: node --check failed\n${r.stderr}`);
}
for (const f of ['live-session.mjs', 'content-diff.mjs', 'visual-diff.mjs']) check(spawnSync(process.execPath, ['--check', join(DIFF, f)], { encoding: 'utf8' }).status === 0, `${f}: node --check failed`);
check(spawnSync('bash', ['-n', join(REPLICA, 'gate.sh')], { encoding: 'utf8' }).status === 0, 'gate.sh: bash -n failed');

// ---- stitch-shot (T19.1 / T19.2 / T14.5): parser, HELP, seam detector
const ssHelp = help('replica', 'stitch-shot.mjs');
for (const fl of ['--keep-pinned', '--expect-height', '--exclude-live-only', '--allow-overlay', '--allow-consent', '--no-dismiss-defaults', '--remove-text', '--block', '--consent-mode', '--mask-sel', '--mask-iframes', '--mask-images', '--masks-json']) check(ssHelp.includes(fl), `stitch-shot --help: ${fl} missing`);
{ const ssSrc = src(join(REPLICA, 'stitch-shot.mjs')); const head = ssSrc.slice(0, ssSrc.indexOf('*/')).replace(/\n \* ?/g, ' '); check(!/or accepted/.test(head) && !/or accepted/.test(ssHelp) && /deny mode: no reject control, or still visible after the reject click/.test(head), '(shape) stitch-shot header + HELP: the deny-mode exit-5 condition is "still visible after the reject click" (as HELP says) — the removed "accepted" branch must not be documented'); }
check(/Exit codes: 0 written[^]*5 invalid capture[^]*never a FAIL/.test(ssHelp), 'stitch-shot --help: exit 5 (invalid capture, no verdict) must be documented');
check(/accept mode:[^]*(--allow-consent|consent present)/.test(ssHelp), 'stitch-shot --help: the accept-mode exit 5 (consent present, not dismissed) must be listed, not only the deny-mode one');
const ssm = await import(pathToFileURL(l1('replica', 'stitch-shot.mjs')).href);
check(ssm.INSTRUMENT && ssm.INSTRUMENT.name === 'stitch-shot' && /^\d+$/.test(ssm.INSTRUMENT.version), 'stitch-shot: INSTRUMENT {name, version} export');
{
  const { opts } = ssm.parseArgs(['node', 'x', 'http://h/', 'o.png', '--keep-pinned', '--expect-height', '500', '--exclude', '.a, .b', '--exclude-live-only', '--allow-overlay', '--allow-consent', '--no-dismiss-defaults', '--remove-text', 'p1', '--remove-text', 'p2', '--block', 'Chat.Example,ads', '--consent-mode', 'deny']);
  check(opts.keepPinned && opts.expectHeight === 500 && JSON.stringify(opts.exclude) === '[".a",".b"]' && opts.excludeLiveOnly && opts.allowOverlay && opts.allowConsent && opts.hideDefaults === false && JSON.stringify(opts.removeText) === '["p1","p2"]' && JSON.stringify(opts.block) === '["Chat.Example","ads"]' && opts.consentMode === 'deny', `stitch-shot parseArgs: T19.1/T19.2/T14.5 flags wrong: ${JSON.stringify(opts)}`);
  const d = ssm.parseArgs(['node', 'x', 'http://h/', 'o.png']).opts;
  // --masks-json merges the inventory's sel entries + flags into the capture; an invalid file is exit 1 before any capture
  const mjp = join(L1, 'ss-masks.json'); writeFileSync(mjp, JSON.stringify([{ sel: '.promo', class: 'nondeterministic-live', source: 'dynamics:D-1' }, { kind: 'iframes', source: 'decision:u' }]));
  const mo2 = inProc(() => ssm.parseArgs(['node', 'x', 'http://h/', 'o.png', '--mask-sel', '.x,.promo', '--masks-json', mjp]).opts);
  check(!mo2.error && JSON.stringify(mo2.maskSel) === '[".x",".promo"]' && mo2.maskIframes === true && mo2.maskImages === false, `stitch-shot parseArgs --masks-json: expected maskSel [.x,.promo] + maskIframes, got ${JSON.stringify({ e: mo2.error, s: mo2.maskSel, i: mo2.maskIframes, m: mo2.maskImages })}`);
  const badp = join(L1, 'ss-bad.json'); writeFileSync(badp, '[{"sel":".a","class":"nondeterministic-live"}]');
  const rb = runL1('replica', 'stitch-shot.mjs', ['http://h/', 'o.png', '--masks-json', badp]);
  check(rb.status === 1 && /masks\.json .*entry 0: source missing/.test(rb.stderr) && /nothing captured/.test(rb.stderr), `stitch-shot --masks-json (entry without source): exit 1 naming the entry expected, got ${rb.status}\n${rb.stderr}`);
  check(d.wait === 1200 && ssm.parseArgs(['node', 'x', 'http://h/', 'o.png', '--settle']).opts.wait === 3000 && d.hideDefaults === true && d.consentMode === 'accept', 'stitch-shot parseArgs: defaults (wait 1200 / 3000 with --settle, hideDefaults, accept)');
}
{
  // seamRepeats: a header band repeated at the same viewport rows of every chunk
  // counts as a seam; a persistent vertical texture (rows identical to their own
  // in-chunk neighbour 8 rows away) and uniform rows never do.
  const W = 64; const H = 200;
  const mk = (rowFn) => { const data = Buffer.alloc(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = rowFn(x, y); const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; } return { width: W, height: H, data }; };
  const noise = (x, y, k) => [((x * 31 + y * 17 + k * 101) % 251), ((x * 7 + y * 13 + k) % 241), ((x + y * 3 + k * 5) % 229)];
  const header = (x, y) => (y < 40 ? [16 + ((x * (y + 1)) % 5), 32 + (y % 7), 48 + (x % 3)] : null); // text-like: rows differ from each other, identical across chunks
  const baked = [0, 1, 2].map((k) => ({ img: mk((x, y) => header(x, y) || noise(x, y, k)) }));
  check(ssm.seamRepeats(baked, W) === 2, `seamRepeats: a header baked into 3 chunks must count 2 seams, got ${ssm.seamRepeats(baked, W)}`);
  const clean = [0, 1, 2].map((k) => ({ img: mk((x, y) => noise(x, y, k)) }));
  check(ssm.seamRepeats(clean, W) === 0, 'seamRepeats: distinct chunks must count 0 seams');
  const texture = [0, 1, 2].map((k) => ({ img: mk((x, y) => (x < 8 ? [200, 0, 0] : noise(x, y, k))) })); // a side rail identical on every row
  check(ssm.seamRepeats(texture, W) === 0, 'seamRepeats: a persistent vertical texture (rows identical to their in-chunk neighbour) must not count as a seam');
  const flat = [0, 1].map(() => ({ img: mk(() => [255, 255, 255]) }));
  check(ssm.seamRepeats(flat, W) === 0, 'seamRepeats: uniform rows never count');
}

// ---- stitch-shot (T14.3 c) (shape): post-capture sanity runs on the stitched page BEFORE
// the PNG is written — short AND challenge/near-empty on the live side → BotChallengeError
// (exit 3, nothing written); short alone → one stderr WARN; a thin LOCAL capture is a measurement
{
  const ss = src(join(REPLICA, 'stitch-shot.mjs'));
  const sanityAt = ss.indexOf('captureSanity({'); const writeAt = ss.indexOf('writeFileSync(out,');
  check(sanityAt > 0 && writeAt > 0 && sanityAt < writeAt, '(shape) stitch-shot: captureSanity({ totalH, vh, textLen, walled }) must run before writeFileSync(out, …)');
  check(/verdict === 'suspect' && isLiveHttpUrl\(url\)\)[^\n]*BotChallengeError/.test(ss), '(shape) stitch-shot: a suspect LIVE capture must throw a BotChallengeError (exit 3); a thin local prototype is a measurement, not a wall');
  check(/verdict === 'short'\)[^\n]*console\.error\([^\n]*WARN short capture/.test(ss), '(shape) stitch-shot: a short-only capture is one stderr WARN, not a refusal');
  check(/Exit codes: 0 written[^]*3 bot challenge[^]*short capture with a challenge DOM\/phrase or near-empty text/.test(ssHelp), 'stitch-shot --help: exit 3 must name the post-capture sanity refusal');
}

// ---- live-session (T19.2 / T14.5): pure exports + the route stack on a fake browser
const ls = await import(pathToFileURL(join(DIFF, 'live-session.mjs')).href);
check(typeof ls.dismissOverlays === 'function' && typeof ls.installOverlayWatch === 'function' && typeof ls.readOverlayWatch === 'function' && typeof ls.reportOverlayResidue === 'function', 'live-session: dismissOverlays / installOverlayWatch / readOverlayWatch / reportOverlayResidue must be exported');
check(ls.ACCEPT_LABELS.includes('godta alle') && ls.ACCEPT_LABELS.includes('alle akzeptieren') && ls.ACCEPT_LABELS.includes('tout accepter') && ls.ACCEPT_LABELS.every((l) => l.length <= 25), 'live-session: ACCEPT_LABELS must carry the multilingual set with every label ≤ 25 chars (B28)');
check(ls.DECLINE_LABELS.includes('reject all') && ls.DECLINE_LABELS.includes('alle ablehnen') && ls.DECLINE_LABELS.includes('avvis alle') && !ls.DECLINE_LABELS.some((l) => ls.ACCEPT_LABELS.includes(l)), 'live-session: DECLINE_LABELS must be disjoint from ACCEPT_LABELS');
check(ls.normLabel('  Godta ALLE! ') === 'godta alle' && ls.normLabel('Accept all cookies…') === 'accept all cookies', `live-session: normLabel wrong (${ls.normLabel('  Godta ALLE! ')})`);
check(ls.HIDE_DEFAULTS.includes('#ot-sdk-btn-floating'), 'live-session: HIDE_DEFAULTS must include the OneTrust floating launcher');
check(Array.isArray(ls.SETTINGS_LABELS) && ls.SETTINGS_LABELS.includes('cookie settings'), 'live-session: SETTINGS_LABELS must exist and know "cookie settings"');
{
  // reportOverlayResidue: the probes' WARN path (content-diff / visual-diff / anchor …)
  const err = []; const orig = console.error; console.error = (m) => err.push(String(m));
  try { ls.reportOverlayResidue('probe-x', { consentPresent: true, consentContainer: 'div#b', hidden: [{ kind: 'hide-default', sel: '#w', count: 2 }, { kind: 'remove-text', sel: 'text:z', count: 0 }] }); ls.reportOverlayResidue('probe-y', null); } finally { console.error = orig; }
  check(err.length === 2 && /^probe-x WARN consent present, not dismissed: div#b/.test(err[0]) && /probe-x: hidden 2 persistent widget\(s\) via #w/.test(err[1]), `reportOverlayResidue: expected one WARN + one hidden line, got ${JSON.stringify(err)}`);
}
{
  // Fake browser: handlers are collected and run in Playwright's order (reverse
  // registration); `fallback()` hands to the next handler, `continue()` ends the
  // chain, `abort()` ends it. Header overrides ride along as Playwright does.
  const drive = async (ctxOpts, req) => {
    const handlers = []; const log = { fallbacks: 0, continues: 0, abort: null, headers: null, initScripts: 0 };
    const fake = { newContext: async () => ({ route: async (_p, h) => { handlers.push(h); }, addInitScript: async () => { log.initScripts += 1; } }) };
    await ls.newLiveContext(fake, ctxOpts);
    let headers = { ...(req.headers || {}) };
    const request = { url: () => req.url, resourceType: () => req.resourceType || 'script', headers: () => headers, isNavigationRequest: () => !!req.isNav, frame: () => { if (req.frameThrows) throw new Error('no frame'); return { parentFrame: () => (req.subframe ? {} : null) }; } };
    let i = handlers.length - 1;
    const step = async () => {
      if (i < 0) { log.headers = headers; return; }
      const h = handlers[i]; i -= 1;
      await h({ request: () => request, fallback: async (o) => { log.fallbacks += 1; if (o && o.headers) headers = Object.fromEntries(Object.entries(o.headers).map(([k, v]) => [k.toLowerCase(), v])); await step(); }, /* Playwright: header names are case-insensitive, returned lower-cased */ continue: async () => { log.continues += 1; }, abort: async (reason) => { log.abort = reason || 'aborted'; } });
    };
    await step();
    return { ...log, handlers: handlers.length };
  };
  const base = { block: ['chat.example'], authOrigin: 'https://auth.example', authHeader: 'Basic x' };
  const doc = await drive(base, { url: 'https://site.example/', resourceType: 'document', isNav: true, headers: { accept: '*/*' } });
  check(doc.handlers === 3 && doc.continues === 0 && doc.fallbacks === 3 && doc.abort === null, `route stack: 3 handlers, every one must fallback() (never continue()), got ${JSON.stringify(doc)}`);
  check(doc.headers && /Chromium/.test(doc.headers['sec-ch-ua'] || '') && /text\/html/.test(doc.headers.accept || '') && doc.headers['accept-language'] && !('Accept' in doc.headers), `route stack: the main document must carry the standard header set after composition, got ${JSON.stringify(doc.headers)}`);
  const sub = await drive(base, { url: 'https://site.example/a.js', resourceType: 'script' });
  check(sub.abort === null && sub.fallbacks === 3 && !/text\/html/.test(sub.headers.accept || ''), 'route stack: a same-origin sub-resource passes through with no forced header set (F-B2: CORS fetches must stay simple)');
  const blocked = await drive(base, { url: 'https://cdn.chat.example/widget.js', resourceType: 'script' });
  check(blocked.abort === 'blockedbyclient' && blocked.fallbacks === 0, `route stack: a --block match must abort blockedbyclient before any other handler, got ${JSON.stringify(blocked)}`);
  const frameDoc = await drive(base, { url: 'https://chat.example/frame.html', resourceType: 'document', isNav: true, subframe: true });
  check(frameDoc.abort === 'blockedbyclient', 'route stack: a sub-frame document on a blocked host IS aborted (iframe widgets are the point)');
  const mainNav = await drive(base, { url: 'https://chat.example/', resourceType: 'document', isNav: true });
  check(mainNav.abort === null, 'route stack: the main-frame navigation is never blocked');
  const throwing = await drive(base, { url: 'https://chat.example/x.js', resourceType: 'script', frameThrows: true });
  check(throwing.abort === 'blockedbyclient', 'route stack: req.frame() throwing (service-worker / pre-frame request) must not break the handler — treated as not-main-nav');
  const auth = await drive(base, { url: 'https://auth.example/page', resourceType: 'document', isNav: true });
  check(auth.headers && auth.headers.authorization === 'Basic x' && /text\/html/.test(auth.headers.accept || ''), `route stack: the auth origin's document must carry BOTH authorization and the standard headers (fallback composition), got ${JSON.stringify(auth.headers)}`);
  const none = await drive({}, { url: 'https://chat.example/x.js' });
  check(none.handlers === 1 && none.abort === null, 'route stack: without --block / auth only the header route is installed');
}
check(JSON.stringify(ls.parseBlockList(' Chat.Example, ads.example ,chat.example,')) === JSON.stringify(['chat.example', 'ads.example']), 'live-session: parseBlockList must trim, lower-case and de-duplicate');
const bd = (o) => ls.blockDecision({ substrings: ['chat.example'], targetOrigin: 'https://site.example', authOrigin: 'https://auth.example', ...o });
check(bd({ url: 'https://chat.example/widget.js' }) === true, 'blockDecision: a matching third-party URL must be blocked');
check(bd({ url: 'https://chat.example/', isMainNav: true }) === false, 'blockDecision: the main-frame navigation is never blocked');
check(bd({ url: 'https://site.example/chat.example.png' }) === false, 'blockDecision: the target origin is exempt even when the path matches');
check(bd({ url: 'https://auth.example/x?chat.example' }) === false, 'blockDecision: the auth origin is exempt');
check(bd({ url: 'https://cdn.chat.example/frame.html', isMainNav: false }) === true, 'blockDecision: a sub-frame document IS blockable (iframe widgets are the point)');
check(ls.blockDecision({ url: 'https://chat.example/x', substrings: [] }) === false, 'blockDecision: an empty list blocks nothing');
{
  const err = []; const orig = console.error; console.error = (m) => err.push(String(m));
  try { ls.warnCmpBlock(['qualified.com']); ls.warnCmpBlock(['cdn.onetrust.com', 'x']); } finally { console.error = orig; }
  check(ls.CMP_HOSTS.includes('onetrust') && err.length === 1 && /consent manager \(cdn\.onetrust\.com\)/.test(err[0]), `live-session: warnCmpBlock must warn once for a CMP host only, got ${JSON.stringify(err)}`);
}
// (shape) DOM-dependent contracts — behaviour asserted in layer 2 (consent-pair, sticky-header, --remove-text fixtures)
const lsSrc = src(join(DIFF, 'live-session.mjs'));
check(!/page\.locator\(sel\)\.first\(\)/.test(lsSrc.slice(lsSrc.indexOf('export async function dismissOverlays'))), '(shape) live-session: dismissOverlays must not use locator(sel).first() (the hidden-twin trap) — iterate all matches');

// ---- capture-sidecar (T19.3 / T14.5): refusal keys as behaviour
const cs = await import(pathToFileURL(join(REPLICA, 'capture-sidecar.mjs')).href);
{
  const dir = join(L1, 'sc'); mkdirSync(dir);
  const w = (n, d) => { const p = join(dir, n); writeFileSync(p, ''); cs.writeSidecar(p, d); return p; };
  const basePng = { instrument: { name: 'stitch-shot', version: '3' }, width: 800, vh: 400, dpr: 1, consent: { mode: 'accept', via: 'x' } };
  const a = w('a.png', { ...basePng, blocked: ['chat.example'] }); const b = w('b.png', { ...basePng, blocked: [] }); const c = w('c.png', { ...basePng }); const d = w('d.png', { ...basePng, blocked: ['chat.example'] });
  check(cs.REFUSAL_KEYS.includes('blocked') && cs.comparability(a, b).problems.some((p) => /^blocked:/.test(p)), 'capture-sidecar: a --block on one side only must be a refusal');
  check(cs.comparability(b, c).problems.length === 0 && cs.comparability(a, d).problems.length === 0, 'capture-sidecar: an absent blocked[] equals an empty one; equal lists compare');
  const e = w('e.png', { ...basePng, consent: { mode: 'deny', via: 'y' } });
  check(cs.comparability(c, e).problems.some((p) => /^consent\.mode/.test(p)), 'capture-sidecar: consent.mode is a refusal key');
  const f = join(dir, 'f.png'); writeFileSync(f, '');
  check(cs.comparability(c, f).problems.some((p) => /only A has a provenance sidecar/.test(p)) && cs.comparability(f, join(dir, 'g.png')).sidecars === null, 'capture-sidecar: one-sided sidecar is a refusal; none on either side is allowed through');
  const csHead = src(join(REPLICA, 'capture-sidecar.mjs')); const csSchema = csHead.slice(0, csHead.indexOf('*/'));
  check(/masksRects\?:[^\n]*error\?/.test(csSchema) && /error:'bad selector'/.test(csSchema), '(shape) capture-sidecar schema: masksRects entries must document error:"bad selector" — the zero-rect placeholders collectMaskRects emits and every consumer skips');
  // loadMasksJson — the ONE validator of stardust/replica/masks.json (T17.3 correction 1: class + source or refused)
  if (typeof cs.loadMasksJson !== 'function' || typeof cs.maskFlagsOf !== 'function') check(false, 'capture-sidecar: loadMasksJson / maskFlagsOf exports missing (masks.json has no validator)');
  else {
  const mj = (name, body) => { const p = join(dir, name); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); return p; };
  const good = cs.loadMasksJson(mj('m-good.json', [{ sel: '.promo', class: 'nondeterministic-live', source: 'dynamics:D-07' }, { kind: 'iframes', source: 'decision:user' }, { kind: 'images', source: 'register:R-3' }]));
  check(JSON.stringify(good.sels) === '[".promo"]' && good.iframes === true && good.images === true && good.classBySel['.promo'] === 'nondeterministic-live' && JSON.stringify(cs.maskFlagsOf(good)) === '{"maskSel":[".promo"],"maskIframes":true,"maskImages":true}', `loadMasksJson: valid file → sels/iframes/images/classBySel, got ${JSON.stringify(good)}`);
  check(Array.isArray(cs.MASK_CLASSES) && cs.MASK_CLASSES.includes('photo-reencoding') && cs.MASK_CLASSES.includes('authored-volatile-masked') && cs.AUTO_MASK_CLASS.iframe === 'live-data-embed' && cs.AUTO_MASK_CLASS.img === 'photo-reencoding', 'capture-sidecar: MASK_CLASSES / AUTO_MASK_CLASS must carry the residual class ids');
  const refuses = (body, re, why) => { let msg = ''; try { cs.loadMasksJson(mj(`m-${why}.json`, body)); } catch (e) { msg = e.message; } check(re.test(msg), `loadMasksJson must refuse ${why} with a named message, got "${msg}"`); };
  refuses([{ sel: '.a', class: 'nondeterministic-live' }], /entry 0: source missing/, 'missing-source');
  refuses([{ sel: '.a', source: 'decision:x' }], /entry 0: class undefined is not a residual class id/, 'missing-class');
  refuses([{ sel: '.a', class: 'made-up', source: 'decision:x' }], /not a residual class id/, 'unknown-class');
  refuses([{ class: 'nondeterministic-live', source: 'decision:x' }], /sel missing/, 'missing-sel');
  refuses([{ sel: '.a', class: 'nondeterministic-live', source: 'because' }], /source missing or not dynamics:/, 'free-text-source');
  refuses([{ sel: '.a, .b', class: 'nondeterministic-live', source: 'decision:x' }], /contains a comma/, 'comma-list-sel');
  refuses([{ kind: 'iframes', source: 'decision:x', class: 'photo-reencoding' }], /omit class/, 'iframes-with-another-class');
  refuses([{ kind: 'rows', source: 'decision:x' }], /kind "rows"/, 'unknown-kind');
  refuses({ sel: '.a' }, /expected a JSON array/, 'not-an-array');
  refuses('nope', /not JSON/, 'not-json');
  { let msg = ''; try { cs.loadMasksJson(join(dir, 'absent.json')); } catch (e) { msg = e.message; } check(/not found/.test(msg), `loadMasksJson: a missing file must say "not found", got "${msg}"`); }
  }
}

// ---- motion-observe (defect 10): isNavigationError must not match "navigation" in a selector or unrelated text
const mo = await import(pathToFileURL(join(REPLICA, 'motion-observe.mjs')).href);
for (const m of ['Execution context was destroyed, most likely because of a navigation', 'Target page, context or browser has been closed', 'Target closed', 'Navigation interrupted by another one', 'Frame was detached', 'page.goto: net::ERR_ABORTED; maybe frame was detached?']) check(mo.isNavigationError(new Error(m)), `isNavigationError must recognise "${m}"`);
for (const m of ["locator.hover: Timeout 2000ms exceeded.\n  - waiting for locator('nav.navigation-menu > a')", 'page.evaluate: ReferenceError: navigator is not defined', 'locator.click: Timeout 2500ms exceeded', 'Element is not visible', '']) check(!mo.isNavigationError(new Error(m)), `isNavigationError must NOT flag "${m.split('\n')[0]}" (a selector or API name containing "navigat" is not a navigation)`);
const moHelp = help('replica', 'motion-observe.mjs');
check(/not-found/.test(moHelp) && /no-box/.test(moHelp) && /intercepted/.test(moHelp), 'motion-observe --help: hovered:false reasons (no-box, intercepted, not-found) must be documented');

// ---- review-image (T02.2 / defect 10): helpers + the two modes' flags
const ri = await import(pathToFileURL(join(REPLICA, 'review-image.mjs')).href);
{
  const img = ri.blank(40, 20); ri.drawDigits(img, 2, 2, '10-2', 2);
  const px = (x, y) => img.data[(y * 40 + x) * 4];
  check(px(2, 2) === 255 && px(4, 2) === 0, 'review-image: drawDigits must render the 3×5 glyph for "1" (col 0 blank, col 1 ink)');
  check(JSON.stringify(ri.pickBands([{ y0: 0, y1: 500, pct: 1 }, { y0: 500, y1: 1000, pct: 30 }, { y0: 1000, y1: 1500, pct: 12 }], 2).map((b) => b.y0)) === '[500,1000]', 'review-image: pickBands must take the k worst by pct, returned in y order');
  const sl = ri.sheetLayout({ n: 12, cols: 3, per: 12 }); check(sl.width <= 2000 && sl.height <= 2000 && sl.rows === 4, `review-image: sheetLayout must stay ≤ 2000 px per side (${sl.width}x${sl.height})`);
  const bl = ri.bandsLayout({ srcW: 1440, bands: Array.from({ length: 12 }, (_, i) => ({ y0: i * 500, y1: (i + 1) * 500, pct: 1 })), width: 1000 }); check(bl.height <= 1500 && bl.rows.length < 12, `review-image: bandsLayout must cap the strip at 1500 px (${bl.height}, ${bl.rows.length} rows)`);
  const src2 = ri.blank(4, 2, [0, 0, 0, 255]); for (let x = 2; x < 4; x++) for (let y = 0; y < 2; y++) { const i = (y * 4 + x) * 4; src2.data[i] = 255; src2.data[i + 1] = 255; src2.data[i + 2] = 255; }
  const dst = ri.blank(1, 1); ri.downscaleInto(src2, 0, 0, 4, 2, dst, 0, 0, 1, 1); check(dst.data[0] === 128, `review-image: downscaleInto must box-average (got ${dst.data[0]})`);
  const riHelp = help('replica', 'review-image.mjs');
  check(/--bands[^\n]*--top <k>/.test(riHelp) && /--sheet[^\n]*--crop-top <px>/.test(riHelp) && !/--sheet[^\n]*--top \d/.test(riHelp), 'review-image --help: --top <k> is the bands count, --crop-top <px> the sheet crop — one meaning per flag');
  const bad = runL1('replica', 'review-image.mjs', ['--sheet', 'x', '--out', 'y.png', '--top', '3']);
  check(bad.status === 1 && /--crop-top/.test(bad.stderr), `review-image --sheet --top: must exit 1 naming --crop-top (got ${bad.status})`);
  const badB = runL1('replica', 'review-image.mjs', ['--bands', 'a.png', 'b.png', '--out', 'y.png', '--crop-top', '1200']);
  check(badB.status === 1 && /--crop-top/.test(badB.stderr), `review-image --bands --crop-top: must exit 1 (got ${badB.status})`);
  check(runL1('replica', 'review-image.mjs', ['--bands', 'a.png']).status === 1, 'review-image: missing --out must exit 1');
}

// ---- anchor (T05.3): pairing + flags
const an = await import(pathToFileURL(l1('replica', 'anchor.mjs')).href);
{
  const pr = an.pairLandmarks({ rows: [{ key: 'h2 "a"', y: 100, h: 30 }, { key: 'h2 "b"', y: 500, h: 30 }, { key: 'x', y: 900, h: 10 }] }, { rows: [{ key: 'h2 "b"', y: 524, h: 30 }, { key: 'h2 "a"', y: 101, h: 30 }, { key: 'y', y: 1, h: 1 }] });
  check(pr.rows.length === 2 && pr.rows[0].key === 'h2 "a"' && pr.firstDelta && pr.firstDelta.key === 'h2 "b"' && pr.firstDelta.dy === 24 && pr.unpaired.a[0] === 'x' && pr.unpaired.b[0] === 'y' && pr.clean === false, `pairLandmarks: ${JSON.stringify(pr)}`);
  check(an.pairLandmarks({ rows: [{ key: 'k', y: 1, h: 1 }] }, { rows: [{ key: 'k', y: 3, h: 1 }] }).clean === true, 'pairLandmarks: |Δy| ≤ 2 must be clean');
  const anHelp = help('replica', 'anchor.mjs');
  for (const fl of ['--landmarks', '--against', '--json-out', '--cache', '--block']) check(anHelp.includes(fl), `anchor --help: ${fl} missing`);
  check(/never changes the exit code/.test(src(join(REPLICA, 'anchor.mjs'))), '(shape) anchor: header must state the landmark table never changes the exit code');
}

// ---- pixel-compare (T05.4 / T02.2): offsets algorithm + flags (verdict path in layer 2)
const pc = await import(pathToFileURL(l1('replica', 'pixel-compare.mjs')).href);
{
  const H = 3000; const La = new Float64Array(H); for (let y = 0; y < H; y++) La[y] = ((y * 2654435761) >>> 0) % 200 + 20;
  const Lb = new Float64Array(H); for (let y = 0; y < H; y++) Lb[y] = y < 1000 ? La[y] : y < 1040 ? 128 : La[y - 40]; // 40 px strip inserted at 1000
  for (let y = 2500; y < 3000; y++) { La[y] = 100; Lb[y] = 100; } // flat band
  const bands = []; for (let y0 = 0; y0 < H; y0 += 500) bands.push({ y0, y1: y0 + 500, pct: 0 });
  const offs = pc.bandOffsets(La, Lb, bands, { range: 240 });
  check(offs[0].offset === 0 && offs[1].offset === 0 && offs[2].offset === 40 && offs[3].offset === 40 && offs[4].offset === 40 && offs[5].offset === null, `bandOffsets: expected [0,0,40,40,40,null], got ${JSON.stringify(offs.map((o) => o.offset))}`);
  const { bands: mk2, firstSeam } = pc.markSeams(bands.map((bd2, k) => ({ ...bd2, ...offs[k] })));
  check(firstSeam && firstSeam.y0 === 1000 && firstSeam.from === 0 && firstSeam.to === 40 && mk2[2].seam === true && mk2[3].seam === false, `markSeams: expected the seam on band 1000–1500 (0 → 40), got ${JSON.stringify(firstSeam)}`);
  const pcHelp = help('replica', 'pixel-compare.mjs');
  for (const fl of ['--review', '--no-offsets', '--offset-range', '--mask', '--mask-from', '--mask-iframes', '--mask-images', '--masks-json', '--check', '--json-out', '--force', '--timeout']) check(pcHelp.includes(fl), `pixel-compare --help: ${fl} missing`);
  // --masks-json --check: validation without a compare (gate.sh runs it before the first capture)
  const mdir = join(L1, 'mj'); mkdirSync(mdir);
  writeFileSync(join(mdir, 'ok.json'), JSON.stringify([{ sel: 'h2', class: 'nondeterministic-live', source: 'decision:fixture' }, { kind: 'images', source: 'register:R-1' }]));
  writeFileSync(join(mdir, 'bad.json'), JSON.stringify([{ sel: 'h2', class: 'nondeterministic-live' }]));
  const okc = runL1('replica', 'pixel-compare.mjs', ['--masks-json', join(mdir, 'ok.json'), '--check']);
  check(okc.status === 0 && okc.stdout.trim() === '{"maskSel":["h2"],"maskIframes":false,"maskImages":true}', `pixel-compare --masks-json --check: exit 0 + the capture flags as JSON expected, got ${okc.status} ${okc.stdout}${okc.stderr}`);
  const badc = runL1('replica', 'pixel-compare.mjs', ['--masks-json', join(mdir, 'bad.json'), '--check']);
  check(badc.status === 1 && /entry 0: source missing/.test(badc.stderr), `pixel-compare --masks-json --check (no source): exit 1 naming the entry expected, got ${badc.status}\n${badc.stderr}`);
  check(runL1('replica', 'pixel-compare.mjs', ['--check']).status === 1, 'pixel-compare --check without --masks-json must exit 1');
  check(runL1('replica', 'pixel-compare.mjs', ['a.png', 'b.png', '--mask-from', 'a.json,b.json,c.json']).status === 1, 'pixel-compare --mask-from with three files must exit 1');
  // the rect mask model (T17.3 corrections 3–7): pairRects ±2 px, buildMasks union / skips / declared classes, rasterMasks own-pixels
  if (typeof pc.pairRects !== 'function' || typeof pc.buildMasks !== 'function' || typeof pc.rasterMasks !== 'function') check(false, 'pixel-compare: pairRects / buildMasks / rasterMasks exports missing (no rect mask model)');
  else {
  const pr = pc.pairRects([{ x: 0, y: 0, w: 100, h: 50 }, { x: 500, y: 0, w: 100, h: 50 }], [{ x: 2, y: 2, w: 98, h: 52 }, { x: 520, y: 0, w: 100, h: 50 }]);
  check(pr.pairs.length === 1 && pr.onlyA.length === 1 && pr.onlyA[0].x === 500 && pr.onlyB.length === 1 && pr.onlyB[0].x === 520, `pairRects: ±2 px on every edge pairs one, a 20 px shift pairs none, got ${JSON.stringify(pr)}`);
  check(pc.pairRects([{ x: 0, y: 0, w: 100, h: 50 }], [{ x: 3, y: 0, w: 100, h: 50 }]).pairs.length === 0, 'pairRects: 3 px is outside the ±2 px tolerance');
  const RA = [{ kind: 'sel', sel: '.promo', x: 0, y: 0, w: 800, h: 100 }, { kind: 'sel', sel: '.chat', x: 700, y: 500, w: 60, h: 60, fixed: true }, { kind: 'sel', sel: 'x[', x: 0, y: 0, w: 0, h: 0, error: 'bad selector' }, { kind: 'iframe', src: 'about:blank', x: 0, y: 300, w: 400, h: 200 }, { kind: 'img', x: 100, y: 200, w: 120, h: 80 }, { kind: 'img', x: 500, y: 200, w: 120, h: 80 }];
  const RB = [{ kind: 'sel', sel: '.promo', x: 0, y: 0, w: 800, h: 100 }, { kind: 'iframe', src: 'about:blank', x: 0, y: 300, w: 400, h: 200 }, { kind: 'iframe', src: 'b-only', x: 0, y: 550, w: 100, h: 20 }, { kind: 'img', x: 100, y: 202, w: 120, h: 80 }, { kind: 'img', x: 520, y: 200, w: 120, h: 80 }];
  const bm = pc.buildMasks({ bands: [{ yA: 10, h: 5, yB: 20 }], A: RA, B: RB, iframes: true, images: true, width: 800 });
  const kinds = bm.masks.map((m) => `${m.kind}:${m.side}${m.asymmetric ? '!' : ''}`).join(' ');
  check(kinds === 'band:both sel:both iframe:both iframe:B! img:both', `buildMasks: expected "band:both sel:both iframe:both iframe:B! img:both", got "${kinds}"`);
  check(bm.imagesUnmatched === 2 && !bm.masks.some((m) => m.sel === '.chat' || m.sel === 'x[') && bm.notes.length === 2 && /\.chat: inside pinned chrome on A/.test(bm.notes[0].msg) && /"x\[": bad selector on A/.test(bm.notes[1].msg), `buildMasks: fixed + bad-selector entries are skipped and noted once, moved images unmatched, got ${JSON.stringify({ n: bm.notes, u: bm.imagesUnmatched })}`);
  check(bm.masks[0].class === 'authored-volatile-masked' && bm.masks[0].spec === '10:5@20' && bm.masks[0].rects.length === 2 && bm.masks[2].class === 'live-data-embed' && bm.masks[4].class === 'photo-reencoding' && bm.masks[4].rects.length === 2, `buildMasks: classes / band rects wrong ${JSON.stringify(bm.masks.map((m) => [m.class, m.rects.length]))}`);
  const ras = pc.rasterMasks(bm.masks, 800, 600);
  check(ras.maskedPixels === 8000 + 72000 + 80000 + 2000 + 9840 && bm.masks[0].pixels === 8000 && bm.masks[1].pixels === 72000 && bm.masks[1].areaPct === 15 && bm.masks[4].pixels === 9840, `rasterMasks: own-pixel counts (union, no double count) wrong: ${ras.maskedPixels} ${JSON.stringify(bm.masks.map((m) => m.pixels))}`);
  let fullRows = 0; for (let y = 0; y < 600; y++) fullRows += ras.rows[y]; check(fullRows === 100, `rasterMasks: fully masked rows (offset NaN) must be the 100 promo rows, got ${fullRows}`);
  let errU = ''; try { pc.buildMasks({ A: RA, B: RB, declared: { classBySel: {} } }); } catch (e) { errU = e.message; } check(/does not declare/.test(errU), `buildMasks: a sidecar sel rect masks.json does not declare must throw, got "${errU}"`);
  const dm = pc.buildMasks({ A: RA, B: RB, declared: { classBySel: { '.promo': 'index-driven-content', '.chat': 'third-party-in-flow' } } });
  check(dm.masks.length === 1 && dm.masks[0].class === 'index-driven-content' && dm.masks[0].kind === 'sel', `buildMasks: the declared class must be applied and iframes/images left alone without their flags, got ${JSON.stringify(dm.masks)}`);
  const onlyBands = pc.buildMasks({ bands: [{ yA: 0, h: 10, yB: 0 }], width: 100 }); check(onlyBands.masks.length === 1 && onlyBands.masks[0].rects.length === 1 && onlyBands.masks[0].rects[0].w === 100, 'buildMasks: --mask yA:h with yB = yA is ONE full-width rect');
  }
}
help('replica', 'crop-compare.mjs');
help('replica', 'sibling-variance.mjs');

// ---- chrome-parity (T18.3): flags + the pure compare
const cp = await import(pathToFileURL(l1('replica', 'chrome-parity.mjs')).href);
{
  const cpHelp = help('replica', 'chrome-parity.mjs');
  for (const fl of ['--region', '--live-cache', '--block', '--consent-mode', '--open', '--scroll']) check(cpHelp.includes(fl), `chrome-parity --help: ${fl} missing`);
  const cpHead = src(join(REPLICA, 'chrome-parity.mjs')); check(!/^  --block/m.test(cpHead.slice(0, cpHead.indexOf('const HELP'))), '(shape) chrome-parity: stray un-prefixed --block line in the JSDoc header');
  const { opts } = cp.parseArgs(['node', 'x', 'https://l/', 'http://b/', '--open', '.nav > a|.hdr a', '--scroll', '800', '--block', 'a']);
  check(opts.open && opts.open.live === '.nav > a' && opts.open.build === '.hdr a' && opts.scroll === 800, `chrome-parity parseArgs: --open <liveSel>|<buildSel> / --scroll <y> wrong: ${JSON.stringify({ o: opts.open, s: opts.scroll })}`);
  check(cp.parseArgs(['node', 'x', 'https://l/', 'http://b/', '--open', '.t']).opts.open.build === '.t', 'chrome-parity parseArgs: --open without |buildSel defaults the build selector to the live one');
  const rest = cp.cacheKey('https://l/', cp.parseArgs(['node', 'x', 'https://l/', 'http://b/']).opts); const st = cp.cacheKey('https://l/', opts);
  check(JSON.stringify(rest) !== JSON.stringify(st) && st.open === '.nav > a' && st.scroll === 800 && rest.open === null && rest.scroll === 0, `chrome-parity cacheKey: must carry the state (open/scroll) so a rest-state cache is never compared against an open-state build, got ${JSON.stringify(st)}`);
  // compareRegion on synthetic probes: STICKY / STATE / OCCLUDED / PSEUDO / marker
  const atom = (text, o = {}) => ({ key: text.toLowerCase(), text, tag: 'a', rect: { x: 0, y: 0, w: 50, h: 20 }, box: { x: 0, y: 0, w: 50, h: 20 }, boxTag: 'a', style: { color: 'rgb(0, 0, 0)', marker: 'none', textDecorationThickness: 'auto' }, boxStyle: null, current: false, occluded: null, ...o });
  const region = (o = {}) => ({ found: true, sel: 'header', rect: { x: 0, y: 0, w: 1440, h: 80 }, position: 'static', backgroundColor: 'rgb(255, 255, 255)', atoms: [], icons: [], sticky: [], pseudo: null, ...o });
  const L = region({ atoms: [atom('Home', { current: true }), atom('Shop'), atom('Legal', { style: { color: 'rgb(0, 0, 0)', marker: 'none', textDecorationThickness: 'auto' } })], sticky: [{ el: 'div.promo', top: 0, h: 48 }], pseudo: { '::before': { content: '""', width: '40px', height: '4px', backgroundColor: 'rgb(0, 0, 0)', bottom: '0px' } } });
  const B = region({ atoms: [atom('Home', { occluded: 'main > .section' }), atom('Shop', { occluded: 'main > .section' }), atom('Legal', { style: { color: 'rgb(0, 0, 0)', marker: 'disc', textDecorationThickness: 'auto' } }), atom('Mega menu')], sticky: [{ el: 'header', top: 0, h: 132 }], pseudo: { '::before': { content: 'none', width: 'auto', height: 'auto', backgroundColor: 'rgba(0, 0, 0, 0)', bottom: 'auto' } } });
  const r = cp.compareRegion('header', L, B, 1);
  const kinds = r.findings.map((f) => f.kind);
  check(kinds.includes('STICKY') && r.findings.some((f) => f.kind === 'STICKY' && /live pins div\.promo \(48px\)/.test(f.msg) && /build pins header \(132px\)/.test(f.msg)), `compareRegion: STICKY finding "live pins div.promo (48px), build pins header (132px)" expected, got ${JSON.stringify(r.findings)}`);
  check(r.findings.some((f) => f.kind === 'STATE' && f.text === 'Home' && /current/.test(f.msg)), 'compareRegion: a live current-page atom whose build pair carries no current marker is a STATE finding');
  check(r.findings.filter((f) => f.kind === 'OCCLUDED').length === 2 && r.findings.some((f) => f.kind === 'OCCLUDED' && /main > \.section/.test(f.msg)), 'compareRegion: build-side occluded atoms are OCCLUDED findings naming the covering element');
  check(r.findings.some((f) => f.kind === 'PAIR' && f.text === 'Legal' && /marker none → disc/.test(f.msg)), 'compareRegion: the list marker is a compared style (live none vs build disc)');
  check(r.findings.some((f) => f.kind === 'PSEUDO' && /::before/.test(f.msg) && /height 4px → auto/.test(f.msg)), 'compareRegion: the opened trigger\'s pseudo-elements are diffed as PSEUDO');
  check(r.findings.some((f) => f.kind === 'EXTRA' && f.text === 'Mega menu'), 'compareRegion: a build-only atom in the open state is EXTRA (invented menu)');
  const Lo = region({ atoms: [atom('Home', { occluded: 'div.ad' })] }); const Bo = region({ atoms: [atom('Home')] });
  const ro = cp.compareRegion('header', Lo, Bo, 1);
  check(!ro.findings.some((f) => f.kind === 'OCCLUDED') && ro.warnings && ro.warnings.some((w) => /live/.test(w) && /div\.ad/.test(w)), `compareRegion: a LIVE-side occlusion is a WARN, never a finding, got ${JSON.stringify({ f: ro.findings, w: ro.warnings })}`);
  const same = cp.compareRegion('header', L, L, 1);
  check(same.findings.length === 0, `compareRegion: identical probes (incl. sticky/pseudo/current) must be parity, got ${JSON.stringify(same.findings)}`);
  const legacy = cp.compareRegion('footer', region({ atoms: [atom('A')] }), region({ atoms: [atom('A')] }), 1);
  check(legacy.findings.length === 0, 'compareRegion: probes without sticky/pseudo/current keys (older cache) still compare');
  // STICKY is keyed on geometry: a replica never shares the live ids/classes, so equal pins with different descriptors are parity
  const Lg = region({ sticky: [{ el: 'header.site-header.masthead', top: 0, h: 80 }] });
  check(!cp.compareRegion('header', Lg, region({ sticky: [{ el: 'header.header-wrapper', top: 0, h: 80 }] }), 1).findings.some((f) => f.kind === 'STICKY'), 'compareRegion: pinned inventories with equal geometry but different descriptors (live header.site-header.masthead 80px vs build header.header-wrapper 80px) must NOT be STICKY — exit 0 would otherwise be unreachable on every site with fixed chrome');
  check(!cp.compareRegion('header', Lg, region({ sticky: [{ el: 'div.hdr', top: 0, h: 81 }] }), 1).findings.some((f) => f.kind === 'STICKY'), 'compareRegion: a pinned height inside --tol is parity');
  check(cp.compareRegion('header', Lg, region({ sticky: [{ el: 'header.header-wrapper', top: 0, h: 80 }, { el: 'div.bar', top: 80, h: 40 }] }), 1).findings.some((f) => f.kind === 'STICKY'), 'compareRegion: a different pinned COUNT is still STICKY');
  check(cp.compareRegion('header', Lg, region({ sticky: [{ el: 'header.header-wrapper', top: 0, h: 96 }] }), 1).findings.some((f) => f.kind === 'STICKY' && /header\.site-header\.masthead \(80px\)/.test(f.msg) && /header\.header-wrapper \(96px\)/.test(f.msg)), 'compareRegion: a different pinned HEIGHT is STICKY and the message still names both descriptors');
}

// ---- diff instruments (T14.5 / T19.2): --block in the parser + HELP of content-diff / visual-diff
for (const f of ['content-diff.mjs', 'visual-diff.mjs']) {
  const h = runL1('diff', f, ['--help']);
  check(h.status === 0 && /--block/.test(h.stdout) && /--dismiss/.test(h.stdout), `${f} --help: --block / --dismiss missing (exit ${h.status})\n${h.stderr}`);
  const u = runL1('diff', f, ['http://a/', 'http://b/', '--bogus-flag']);
  check(u.status === 1, `${f}: an unknown flag must exit 1 (got ${u.status})`);
}

// ---- gate.sh (shape — bash; behaviour in layer 2)
const gate = src(join(REPLICA, 'gate.sh'));
check(/\[ \$rc -eq 5 \]/.test(gate), '(shape) gate.sh: rc 5 (invalid capture) branch missing — must remove the partial PNG and re-exit 5, never compare');
check(/--expect-height \$EXPECT/.test(gate), '(shape) gate.sh: --expect-height from the crawl screenshot missing on the live capture');
check(/\[ \$rc -eq 124 \]/.test(gate), '(shape) gate.sh: exit 124 handling must stay');
check(/--review "\$DIR\/review-\$LBL\.png"/.test(gate), '(shape) gate.sh: pixel-compare line must pass --review review-<label>.png');
check(/GATE_LANDMARKS/.test(gate) && /--landmarks --cache/.test(gate) && /--against "\$DIR\/anchor-live\.json"/.test(gate) && /landmark table unavailable/.test(gate), '(shape) gate.sh: landmark hook (live cached + build --against, warn-and-continue, GATE_LANDMARKS=0) missing');
check(/instrument\.version/.test(gate) && /older stitch-shot procedure/.test(gate), '(shape) gate.sh: a cached live.png from an older stitch-shot procedure version must be treated as stale');
check((gate.match(/anchor-live\.skip/g) || []).length >= 5, '(shape) gate.sh: a failed live landmark probe must write anchor-live.skip and later rounds must skip the live pass while it exists');
check(/GATE_BLOCK/.test(gate) && (gate.match(/\$STITCH_COMMON/g) || []).length >= 2, '(shape) gate.sh: GATE_BLOCK must reach BOTH stitch-shot calls');
// gate.sh reads stitch-shot's INSTRUMENT version off the source: keep the line it greps in step with the export
{
  // Derive the two patterns from gate.sh's own STITCH_VER line and run THEM — a change to
  // either pattern that stops matching stitch-shot's INSTRUMENT export must fail here.
  const m = gate.match(/STITCH_VER=\$\(grep -oE "([^"]+)" "\$HERE\/stitch-shot\.mjs" \| grep -oE "([^"]+)" \| tail -1\)/);
  check(!!m, '(shape) gate.sh: STITCH_VER=$(grep -oE "…" "$HERE/stitch-shot.mjs" | grep -oE "…" | tail -1) line not found — the staleness check cannot be cross-checked');
  if (m) { const ver = spawnSync('bash', ['-c', `grep -oE "${m[1]}" "${join(REPLICA, 'stitch-shot.mjs')}" | grep -oE "${m[2]}" | tail -1`], { encoding: 'utf8' }).stdout.trim(); check(ver === ssm.INSTRUMENT.version, `gate.sh staleness check: gate.sh's own grep over stitch-shot's source yields "${ver}" but INSTRUMENT.version is ${ssm.INSTRUMENT.version} — keep the pattern and the export in step`); }
}

}
try { await layer1(); } finally { rmSync(L1, { recursive: true, force: true }); }

// ---------------------------------------------------------------- deps
function resolveDeps() {
  const need = ['playwright', 'pngjs', 'pixelmatch'];
  const has = (d) => d && need.every((m) => existsSync(join(d, m)));
  const env = process.env.STARDUST_GATE_DEPS;
  if (env) { if (has(env)) return env; console.error(`replica-capture-fixtures: STARDUST_GATE_DEPS=${env} lacks ${need.filter((m) => !existsSync(join(env, m))).join(', ')}`); }
  const root = join(PLUGIN, '..', '..', 'node_modules');
  return has(root) ? root : null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' };
function serve(dir, hook) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (hook && hook(u, req, res)) return;
      const p = join(dir, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!existsSync(p)) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(readFileSync(p));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function layer2(deps) {
  // Project-copy layout (stardust/scripts/replica ↔ stardust/scripts/diff): the
  // instruments resolve live-session.mjs from ../diff/ there.
  const tmp = mkdtempSync(join(tmpdir(), 'replica-capture-'));
  mkdirSync(join(tmp, 'replica')); mkdirSync(join(tmp, 'diff')); mkdirSync(join(tmp, 'out'));
  for (const f of readdirSync(REPLICA)) cpSync(join(REPLICA, f), join(tmp, 'replica', f), { recursive: true });
  for (const f of readdirSync(DIFF)) cpSync(join(DIFF, f), join(tmp, 'diff', f), { recursive: true });
  const runDiff = (script, args) => new Promise((resolve) => { const c = spawn(process.execPath, [join(tmp, 'diff', script), ...args], { cwd: tmp }); let stdout = ''; let stderr = ''; c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; }); const t = setTimeout(() => { c.kill('SIGKILL'); stderr += '\n[runner] killed after 120s'; }, 120000); c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); }); });
  symlinkSync(deps, join(tmp, 'node_modules'));
  const req = createRequire(join(tmp, 'x.js'));
  const { PNG } = req('pngjs');
  const png = (p) => PNG.sync.read(readFileSync(p));
  const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  // async spawn: a spawnSync here would block THIS process's event loop while
  // the child fetches its fixture page from THIS process's http server.
  const run = (script, args, extra = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(tmp, 'replica', script), ...args], { cwd: tmp, ...extra });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => { c.kill('SIGKILL'); stderr += '\n[runner] killed after 120s'; }, 120000);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
  const hits = [];
  const seen = []; // main-server requests: { path, headers }
  // second origin for the blocked-widget fixture (a substring must never match the page's own origin)
  const thirdHits = [];
  const third = await serve(FIX, (u, req, res) => {
    thirdHits.push(u.pathname);
    if (u.pathname === '/pixel.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')); return true; }
    return false;
  });
  const { srv, base } = await serve(FIX, (u, req, res) => {
    hits.push(u.pathname); seen.push({ path: u.pathname, headers: req.headers });
    if (u.pathname === '/blocked.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(join(FIX, 'blocked.html'), 'utf8').replaceAll('__THIRD__', third.base)); return true; }
    return false;
  });
  try {
    // --help works for every instrument once deps resolve
    for (const f of SCRIPTS) {
      if (!existsSync(join(tmp, 'replica', f)) || f === 'run-capped.mjs' || f === 'capture-sidecar.mjs') continue;
      const r = await run(f, ['--help']);
      check(r.status === 0 && /usage/i.test(r.stdout), `${f} --help: exit ${r.status}\n${r.stderr}`);
    }

    // T19.1 (a) fixed header hidden on chunks 2+, kept on chunk 1; tail line; seams WARN under --keep-pinned
    const W = ['--width', '800', '--vh', '400', '--wait', '300'];
    const a = await run('stitch-shot.mjs', [`${base}/fixed-header.html`, 'out/fixed.png', ...W]);
    check(a.status === 0, `fixed-header: exit ${a.status}\n${a.stderr}`);
    check(/pinned hidden on chunks 2\+: 1 \[header/.test(a.stdout), `fixed-header: expected "pinned hidden on chunks 2+: 1 [header…]"\n${a.stdout}`);
    check(/tail 100px below footer: div#after/.test(a.stdout), `fixed-header: expected "tail 100px below footer: div#after"\n${a.stdout}`);
    check(!/WARN fixed overlay baked/.test(a.stdout), 'fixed-header: seam WARN must not fire when the header is hidden');
    if (a.status === 0) {
      const img = png(join(tmp, 'out/fixed.png'));
      const HEADER = [16, 32, 48];
      const same = (p, q) => p.every((v, i) => Math.abs(v - q[i]) <= 2);
      check(same(px(img, 400, 30), HEADER), 'fixed-header: chunk 1 must still paint the header (chrome crop gate reads it)');
      check(!same(px(img, 400, 430), HEADER), `fixed-header: chunk 2 rows under the header must be content, got ${px(img, 400, 430)}`);
      const side = JSON.parse(readFileSync(join(tmp, 'out/fixed.png.json'), 'utf8'));
      check(Array.isArray(side.pinnedHidden) && side.pinnedHidden.length === 1 && typeof side.pendingDecodes === 'number' && side.tail && side.tail.px === 100, `fixed-header: sidecar pinnedHidden/pendingDecodes/tail wrong: ${JSON.stringify({ p: side.pinnedHidden, d: side.pendingDecodes, t: side.tail })}`);
      check(side.instrument.version === '3', 'fixed-header: instrument.version must be bumped to 3 (procedure changed)');
      check(side.visibilityState === 'visible', `fixed-header: sidecar must record visibilityState (got ${side.visibilityState})`);
    }
    // stuck STICKY chrome is hidden too (Chromium's offsetTop includes the sticky shift — the layout test never fired; only fixed chrome was hidden)
    const st = await run('stitch-shot.mjs', [`${base}/sticky-chrome.html`, 'out/sticky.png', ...W]);
    check(st.status === 0 && /pinned hidden on chunks 2\+: 1 \[header/.test(st.stdout), `sticky-chrome: expected "pinned hidden on chunks 2+: 1 [header…]", got ${st.status}\n${st.stdout}${st.stderr}`);
    if (st.status === 0) { const img = png(join(tmp, 'out/sticky.png')); const HEADER = [16, 32, 48]; const same = (p, q) => p.every((v, i) => Math.abs(v - q[i]) <= 2); check(same(px(img, 400, 30), HEADER) && !same(px(img, 400, 430), HEADER), `sticky-chrome: chunk 1 keeps the header, chunk 2 rows under it must be content, got ${px(img, 400, 430)}`); }
    const k = await run('stitch-shot.mjs', [`${base}/fixed-header.html`, 'out/kept.png', ...W, '--keep-pinned']);
    check(k.status === 0, `keep-pinned: exit ${k.status}\n${k.stderr}`);
    if (k.status === 0) {
      const img = png(join(tmp, 'out/kept.png'));
      check(px(img, 400, 430)[2] === 48, `keep-pinned: chunk 2 must repeat the header, got ${px(img, 400, 430)}`);
      check(/WARN fixed overlay baked into [2-4] seams/.test(k.stdout), `keep-pinned: seam detector must WARN on the repeated header\n${k.stdout}`);
    }
    // (b) --exclude drops an in-flow element on both sides; --exclude-live-only says ASYMMETRIC
    const ex = await run('stitch-shot.mjs', [`${base}/fixed-header.html`, 'out/ex.png', ...W, '--exclude', '.widget', '--exclude-live-only']);
    check(ex.status === 0 && /excluded 1 element\(s\) via \.widget\s+ASYMMETRIC/.test(ex.stdout) && /^ASYMMETRIC:/m.test(ex.stdout), `--exclude: exit ${ex.status}\n${ex.stdout}\n${ex.stderr}`);
    if (ex.status === 0 && a.status === 0) { const d = png(join(tmp, 'out/fixed.png')).height - png(join(tmp, 'out/ex.png')).height; check(d >= 400 && d <= 440, `--exclude: height must drop by the widget's 400px (+margins), dropped ${d}`); }
    // (c) a page without pinned chrome is byte-identical with and without the hide
    const s1 = await run('stitch-shot.mjs', [`${base}/static.html`, 'out/s1.png', ...W]);
    const s2 = await run('stitch-shot.mjs', [`${base}/static.html`, 'out/s2.png', ...W, '--keep-pinned']);
    check(s1.status === 0 && s2.status === 0, `static: exits ${s1.status}/${s2.status}\n${s1.stderr}${s2.stderr}`);
    if (s1.status === 0 && s2.status === 0) check(Buffer.compare(readFileSync(join(tmp, 'out/s1.png')), readFileSync(join(tmp, 'out/s2.png'))) === 0, 'static: default and --keep-pinned captures must be byte-identical on a page without fixed elements');
    check(/pinned hidden on chunks 2\+: 0$/m.test(s1.stdout), `static: expected "pinned hidden on chunks 2+: 0"\n${s1.stdout}`);
    // (d) --expect-height 99999 → exit 5, nothing written
    const sh = await run('stitch-shot.mjs', [`${base}/static.html`, 'out/short.png', ...W, '--expect-height', '99999']);
    check(sh.status === 5 && /capture invalid \(short\)/.test(sh.stderr) && !existsSync(join(tmp, 'out/short.png')), `--expect-height: expected exit 5 with no PNG, got ${sh.status}\n${sh.stderr}`);
    // (e) overlay wall → exit 5; --allow-overlay → 0 with a WARN
    const ov = await run('stitch-shot.mjs', [`${base}/overlay.html`, 'out/ov.png', ...W]);
    check(ov.status === 5 && /covers \d+ % of the first viewport/.test(ov.stderr) && !existsSync(join(tmp, 'out/ov.png')), `overlay: expected exit 5, got ${ov.status}\n${ov.stderr}`);
    const ov2 = await run('stitch-shot.mjs', [`${base}/overlay.html`, 'out/ov2.png', ...W, '--allow-overlay']);
    check(ov2.status === 0 && /^WARN fixed element div#wall covers/m.test(ov2.stdout), `overlay --allow-overlay: expected exit 0 + WARN, got ${ov2.status}\n${ov2.stdout}${ov2.stderr}`);

    // ---- T19.2 dismissOverlays (driver copied next to the instruments)
    cpSync(join(FIX, '_dismiss-driver.mjs'), join(tmp, 'replica', '_dismiss-driver.mjs'));
    const drive = async (file, o) => { const r = await run('_dismiss-driver.mjs', [`${base}/${file}`, JSON.stringify(o)]); let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* not json */ } check(r.status === 0 && j, `driver ${file}: exit ${r.status}\n${r.stdout}\n${r.stderr}`); return j || { d: {}, state: {} }; };
    const pair = await drive('consent-pair.html', { lateWindowMs: 0 });
    check(['button:has-text("Accept all")', '[data-testid*="accept"]'].includes(pair.d.consent) && pair.state.consent === 'visible', `consent-pair: the VISIBLE twin must be clicked (not the hidden first match), got consent=${pair.d.consent} state=${pair.state.consent}`);
    check(pair.d.hidden.some((h) => h.sel === '#ot-sdk-btn-floating' && h.count === 1) && pair.state.floatingVisibility === 'hidden', `consent-pair: #ot-sdk-btn-floating must be hidden (visibility), got ${JSON.stringify(pair.d.hidden)} / ${pair.state.floatingVisibility}`);
    check(pair.frameClosed === 'yes' && pair.d.frames.length === 1 && /text:no thanks/.test(pair.d.frames[0]), `consent-pair: the survey iframe's "No thanks" must be clicked, got ${JSON.stringify(pair.d.frames)} closed=${pair.frameClosed}`);
    check(pair.d.consentPresent === false, 'consent-pair: consentPresent must be false after the banner is dismissed');
    const pairNoHide = await drive('consent-pair.html', { lateWindowMs: 0, hideDefaults: false });
    check(pairNoHide.d.hidden.length === 0 && pairNoHide.state.floatingVisibility === 'visible' && pairNoHide.state.consent === 'visible', 'consent-pair hideDefaults:false: no widget hidden, consent still clicked');
    const late = await drive('consent-late.html', { lateWindowMs: 4000 });
    check(late.d.consent === 'text:godta alle' && late.state.consent === 'late-text', `consent-late: the late-mounted Norwegian banner must be dismissed by the text fallback inside the window, got ${late.d.consent} / ${late.state.consent}`);
    const lateDeny = await drive('consent-late.html', { lateWindowMs: 3000, mode: 'deny' });
    check(lateDeny.d.rejected === null && lateDeny.d.consentPresent === true && /late-banner/.test(lateDeny.d.consentContainer || '') && lateDeny.state.consent === null, `consent-late deny: the accept label must NOT be clicked and consentPresent must name the banner, got ${JSON.stringify(lateDeny.d)}`);
    const shadow = await drive('consent-shadow.html', { lateWindowMs: 0 });
    check(shadow.state.consent === 'shadow' && shadow.d.consent && /usercentrics-root|alle akzeptieren|data-testid/.test(shadow.d.consent), `consent-shadow: the open-shadow CMP button must be clicked, got ${shadow.d.consent} / ${shadow.state.consent}`);
    const unk = await drive('consent-unknown.html', { lateWindowMs: 0 });
    check(unk.d.consent === null && unk.d.consentPresent === true && unk.d.consentContainer === 'div#unknown-banner.cookie-banner' && unk.state.consent === null, `consent-unknown: an unknown label must be left alone and reported, got ${JSON.stringify(unk.d)}`);
    const neg = await drive('sticky-header.html', { lateWindowMs: 0 });
    check(neg.d.consentPresent === false && neg.d.consentContainer === null && neg.d.consent === null, `sticky-header (negative): a sticky header with a Privacy link + menu button and a fixed bar with a "Cookie policy" LINK is not a consent banner, got ${JSON.stringify(neg.d)}`);
    const rm = await drive('consent-unknown.html', { lateWindowMs: 0, removeText: ['We use cookies'] });
    check(rm.d.hidden.some((h) => h.kind === 'remove-text' && h.count === 1) && rm.d.consentPresent === false, `consent-unknown --remove-text: the fixed ancestor must be hidden and consentPresent cleared, got ${JSON.stringify(rm.d)}`);
    // stitch-shot fail-loud on a surviving consent container (exit 5), --allow-consent, --remove-text
    const cs5 = await run('stitch-shot.mjs', [`${base}/consent-unknown.html`, 'out/c5.png', ...W]);
    check(cs5.status === 5 && /consent present, not dismissed — div#unknown-banner/.test(cs5.stderr) && !existsSync(join(tmp, 'out/c5.png')), `stitch-shot consent-unknown: expected exit 5, got ${cs5.status}\n${cs5.stderr}`);
    const csA = await run('stitch-shot.mjs', [`${base}/consent-unknown.html`, 'out/cA.png', ...W, '--allow-consent']);
    check(csA.status === 0 && /^WARN consent present, not dismissed/m.test(csA.stdout), `stitch-shot --allow-consent: expected exit 0 + WARN, got ${csA.status}\n${csA.stdout}${csA.stderr}`);
    const csR = await run('stitch-shot.mjs', [`${base}/consent-unknown.html`, 'out/cR.png', ...W, '--remove-text', 'We use cookies']);
    check(csR.status === 0 && /hidden 1 persistent widget\(s\) via text:We use cookies/.test(csR.stdout), `stitch-shot --remove-text: expected exit 0 + hidden line, got ${csR.status}\n${csR.stdout}${csR.stderr}`);
    if (csR.status === 0) { const sc = JSON.parse(readFileSync(join(tmp, 'out/cR.png.json'), 'utf8')); check(sc.hidden.some((h) => h.kind === 'remove-text') && sc.instrument.options.removeText[0] === 'We use cookies', 'stitch-shot --remove-text: sidecar hidden[] / options.removeText missing'); }
    // --settle re-runs dismissAndLog: the bar hidden on pass 1 must not print "no element matched" on pass 2, and the hidden line prints once
    const csS = await run('stitch-shot.mjs', [`${base}/consent-unknown.html`, 'out/cS.png', ...W, '--settle', '--remove-text', 'We use cookies']);
    check(csS.status === 0 && !/no element matched/.test(csS.stdout) && (csS.stdout.match(/hidden 1 persistent widget\(s\) via text:We use cookies/g) || []).length === 1, `stitch-shot --settle --remove-text: expected exit 0, one hidden line, no "no element matched", got ${csS.status}\n${csS.stdout}${csS.stderr}`);
    // the reviewer's scenario: an ordinary sticky header must capture by default (exit 0, no consent WARN)
    const csN = await run('stitch-shot.mjs', [`${base}/sticky-header.html`, 'out/cN.png', ...W]);
    check(csN.status === 0 && !/consent present/.test(csN.stdout + csN.stderr), `stitch-shot sticky-header: a page without a banner must capture (exit 0), got ${csN.status}\n${csN.stdout}${csN.stderr}`);
    const csP = await run('stitch-shot.mjs', [`${base}/consent-pair.html`, 'out/cP.png', ...W]);
    check(csP.status === 0 && /consent dismissed via (button:has-text\("Accept all"\)|\[data-testid\*="accept"\])/.test(csP.stdout) && /frame overlay dismissed via frame:.*text:no thanks/.test(csP.stdout) && /hidden 1 persistent widget\(s\) via #ot-sdk-btn-floating/.test(csP.stdout), `stitch-shot consent-pair: expected consent + frame + hidden lines, got ${csP.status}\n${csP.stdout}${csP.stderr}`);

    // ---- defect 10: deny mode — a reject control that leaves the dialog up is exit 5 (was: captured with "consent REJECTED" printed)
    const rj = await run('stitch-shot.mjs', [`${base}/consent-reject-stays.html`, 'out/rj.png', ...W, '--consent-mode', 'deny']);
    check(rj.status === 5 && /reject control .* was clicked but the consent dialog is still visible/.test(rj.stderr) && !existsSync(join(tmp, 'out/rj.png')), `deny reject-stays: expected exit 5 naming the surviving dialog, got ${rj.status}\n${rj.stdout}${rj.stderr}`);
    const rjA = await run('stitch-shot.mjs', [`${base}/consent-reject-stays.html`, 'out/rjA.png', ...W, '--consent-mode', 'deny', '--allow-consent']);
    check(rjA.status === 0 && /^WARN consent present after reject via/m.test(rjA.stdout) && /consent REJECTED via/.test(rjA.stdout), `deny reject-stays --allow-consent: expected exit 0 + WARN + REJECTED line, got ${rjA.status}\n${rjA.stdout}${rjA.stderr}`);
    const rjAcc = await run('stitch-shot.mjs', [`${base}/consent-reject-stays.html`, 'out/rjB.png', ...W]);
    check(rjAcc.status === 0 && /consent dismissed via/.test(rjAcc.stdout), `reject-stays in accept mode: the accept control closes it (exit ${rjAcc.status})\n${rjAcc.stderr}`);
    // ---- defect 10: pendingDecodes counts the decodes that did not finish (one hanging decode of three → 1, not 3)
    const dh = await run('stitch-shot.mjs', [`${base}/decode-hang.html`, 'out/dh.png', ...W]);
    check(dh.status === 0 && /WARN 1 in-viewport image decode\(s\) did not finish/.test(dh.stdout), `decode-hang: expected exit 0 + "WARN 1 … decode(s)", got ${dh.status}\n${dh.stdout}${dh.stderr}`);
    if (dh.status === 0) { const sc = JSON.parse(readFileSync(join(tmp, 'out/dh.png.json'), 'utf8')); check(sc.pendingDecodes === 1, `decode-hang: sidecar pendingDecodes must be 1, got ${sc.pendingDecodes}`); }
    // ---- T17.3 (capture side): --mask-sel / --mask-iframes / --mask-images → sidecar masksRects[]; fixed matches recorded fixed:true
    const mk0 = await run('stitch-shot.mjs', [`${base}/masks.html`, 'out/mk0.png', ...W]);
    if (mk0.status === 0) { const sc = JSON.parse(readFileSync(join(tmp, 'out/mk0.png.json'), 'utf8')); check(!('masksRects' in sc) && !/mask rects:/.test(mk0.stdout), 'masks (no flag): masksRects must be ABSENT from the sidecar and no line printed'); }
    const mk1 = await run('stitch-shot.mjs', [`${base}/masks.html`, 'out/mk1.png', ...W, '--mask-sel', '.promo, .chat, .nope', '--mask-iframes', '--mask-images']);
    check(mk1.status === 0 && /^mask rects: 4 \(sel 1, iframe 1, img 2; fixed skipped 1\)/m.test(mk1.stdout), `masks: expected "mask rects: 4 (sel 1, iframe 1, img 2; fixed skipped 1)", got ${mk1.status}\n${mk1.stdout}${mk1.stderr}`);
    if (mk1.status === 0) {
      const sc = JSON.parse(readFileSync(join(tmp, 'out/mk1.png.json'), 'utf8')); const m = sc.masksRects || [];
      const promo = m.find((r) => r.kind === 'sel' && r.sel === '.promo'); const chat = m.find((r) => r.kind === 'sel' && r.sel === '.chat'); const fr = m.find((r) => r.kind === 'iframe'); const im = m.filter((r) => r.kind === 'img');
      check(promo && promo.y === 0 && promo.h === 100 && promo.w === 800 && !promo.fixed, `masks: .promo rect must be page-space {y 0, h 100, w 800}, got ${JSON.stringify(promo)}`);
      check(chat && chat.fixed === true, `masks: the fixed .chat match must carry fixed:true, got ${JSON.stringify(chat)}`);
      check(fr && fr.y === 300 && fr.w === 400 && fr.h === 200, `masks: iframe rect wrong ${JSON.stringify(fr)}`);
      check(im.length === 2 && im.every((r) => r.w === 120 && r.h === 80), `masks: only the two ≥ 40×40 images are recorded, got ${JSON.stringify(im)}`);
      check(JSON.stringify(sc.instrument.options.maskSel) === '[".promo",".chat",".nope"]' && sc.instrument.options.maskIframes === true && sc.instrument.options.maskImages === true, 'masks: options must record maskSel/maskIframes/maskImages');
    }
    // ---- T17.3 (compare side): the same page served as B with the promo, the image bytes and the iframe body changed and ONE
    // image shifted 20 px → sel + iframe + matched image masked, the shifted image NOT masked, pixelPctUnmasked > pixelPct, area % printed
    const mk2 = await run('stitch-shot.mjs', [`${base}/masks-b.html`, 'out/mk2.png', ...W, '--mask-sel', '.promo, .chat, .nope', '--mask-iframes', '--mask-images']);
    check(mk2.status === 0, `masks-b: exit ${mk2.status}\n${mk2.stderr}`);
    if (mk1.status === 0 && mk2.status === 0) {
      const p0 = await run('pixel-compare.mjs', ['out/mk1.png', 'out/mk2.png', '--out', 'out/mk-d0.png', '--timeout', '0', '--no-offsets', '--json-out', 'out/mk-g0.json']);
      const pm = await run('pixel-compare.mjs', ['out/mk1.png', 'out/mk2.png', '--out', 'out/mk-d1.png', '--timeout', '0', '--no-offsets', '--mask-from', '--mask-iframes', '--mask-images', '--json-out', 'out/mk-g1.json']);
      check([0, 2].includes(p0.status) && !/MASKED/.test(p0.stdout) && [0, 2].includes(pm.status), `masks compare: exits ${p0.status}/${pm.status}\n${p0.stderr}${pm.stderr}`);
      check(/\[MASKED 3 mask\(s\), [\d.]+% of area: sel\/authored-volatile-masked \.promo \([\d.]+%\), iframe\/live-data-embed [^(]*\([\d.]+%\), img\/photo-reencoding img@\d+,\d+ 120×80 \([\d.]+%\) — excluded from the number; unmasked [\d.]+%\]/.test(pm.stdout), `masks compare: verdict line must print every mask with kind/class/area % and the unmasked number\n${pm.stdout}`);
      check(/^  mask sel \.chat: inside pinned chrome on A, B — recorded, not masked \(fixed-disc-at-seams\)$/m.test(pm.stdout) && /^  images: 1 paired within ±2 px and masked, 2 unmatched \(moved \/ missing \/ resized\) kept in the number$/m.test(pm.stdout), `masks compare: the fixed match (both sides) is said ONCE and the shifted image counted as unmatched\n${pm.stdout}`);
      if (existsSync(join(tmp, 'out/mk-g0.json')) && existsSync(join(tmp, 'out/mk-g1.json'))) {
        const g0 = JSON.parse(readFileSync(join(tmp, 'out/mk-g0.json'), 'utf8')); const g1 = JSON.parse(readFileSync(join(tmp, 'out/mk-g1.json'), 'utf8'));
        check(g1.pixelPct > 0 && g1.pixelPct < g1.pixelPctUnmasked && g1.pixelPctUnmasked === g0.pixelPct && g1.imagesUnmatched === 2 && g1.masks.length === 3 && g1.masks.every((m) => m.areaPct > 0 && m.side === 'both' && m.rects.length === 2) && g1.maskedPct > 0 && g1.masksFrom.length === 2 && g1.masksSkipped.length === 1, `masks compare --json-out: pixelPct < pixelPctUnmasked (= the unmasked run), 3 masks with area %, 2 images unmatched, got ${JSON.stringify({ pp: g1.pixelPct, pu: g1.pixelPctUnmasked, p0: g0.pixelPct, u: g1.imagesUnmatched, m: g1.masks && g1.masks.map((m) => [m.kind, m.side, m.areaPct]), sk: g1.masksSkipped })}`);
        const dd = png(join(tmp, 'out/mk-d1.png')); const red = (x, y) => { const [r, g] = px(dd, x, y); return r === 255 && g < 100; };
        check(red(10, 220) && !red(60, 140) && !red(400, 50) && !red(200, 400), `masks compare diff: the 20 px-shifted image (10,220) must stay red; the paired image (60,140), the promo (400,50) and the iframe (200,400) must be grey, got ${JSON.stringify([px(dd, 10, 220), px(dd, 60, 140), px(dd, 400, 50), px(dd, 200, 400)])}`);
      }
      // --masks-json on the compare: declared class applied; kinds not declared stay unmasked; an undeclared sel rect is exit 1
      writeFileSync(join(tmp, 'out/masks.json'), JSON.stringify([{ sel: '.promo', class: 'index-driven-content', source: 'dynamics:D-07' }, { sel: '.chat', class: 'third-party-in-flow', source: 'decision:user' }, { sel: '.nope', class: 'nondeterministic-live', source: 'decision:user' }, { kind: 'images', source: 'register:R-1' }]));
      const pj = await run('pixel-compare.mjs', ['out/mk1.png', 'out/mk2.png', '--out', 'out/mk-d2.png', '--timeout', '0', '--no-offsets', '--masks-json', 'out/masks.json', '--json-out', 'out/mk-g2.json']);
      check([0, 2].includes(pj.status) && /sel\/index-driven-content \.promo/.test(pj.stdout) && !/iframe\//.test(pj.stdout) && /img\/photo-reencoding/.test(pj.stdout), `masks.json on the compare: declared class applied, iframes NOT masked (not declared), images masked (declared), got ${pj.status}\n${pj.stdout}${pj.stderr}`);
      if (existsSync(join(tmp, 'out/mk-g2.json'))) check(JSON.parse(readFileSync(join(tmp, 'out/mk-g2.json'), 'utf8')).masksJson === 'out/masks.json', 'masks.json on the compare: --json-out must record masksJson');
      writeFileSync(join(tmp, 'out/masks-undeclared.json'), JSON.stringify([{ kind: 'images', source: 'register:R-1' }]));
      const pu = await run('pixel-compare.mjs', ['out/mk1.png', 'out/mk2.png', '--out', 'out/mk-d3.png', '--timeout', '0', '--masks-json', 'out/masks-undeclared.json']);
      check(pu.status === 1 && /does not declare/.test(pu.stderr) && !existsSync(join(tmp, 'out/mk-d3.png')), `masks.json on the compare: a sidecar sel rect the file does not declare must be exit 1 before any diff, got ${pu.status}\n${pu.stderr}`);
      // --mask-from with no masksRects on either side is exit 1 (not a silent unmasked number)
      const pn0 = await run('pixel-compare.mjs', ['out/s1.png', 'out/s2.png', '--out', 'out/mk-d4.png', '--timeout', '0', '--mask-from']);
      check(pn0.status === 1 && /no masksRects/.test(pn0.stderr), `pixel-compare --mask-from without masksRects: exit 1 expected, got ${pn0.status}\n${pn0.stderr}`);
    }

    // ---- T14.5 --block: third-party origin aborted, own origin + headers intact, sidecar refusal
    thirdHits.length = 0;
    const nb = await run('stitch-shot.mjs', [`${base}/blocked.html`, 'out/nb.png', ...W]);
    check(nb.status === 0 && thirdHits.length >= 2, `blocked (no flag): the widget origin must be hit, exit ${nb.status} hits ${thirdHits.length}\n${nb.stderr}`);
    thirdHits.length = 0; seen.length = 0;
    const thirdHost = new URL(third.base).host;
    const bl = await run('stitch-shot.mjs', [`${base}/blocked.html`, 'out/bl.png', ...W, '--block', `${thirdHost},ads.example`]);
    check(bl.status === 0 && thirdHits.length === 0, `--block: the widget origin must receive 0 requests, got ${thirdHits.length} (exit ${bl.status})\n${bl.stderr}`);
    check(new RegExp(`^blocked: ${thirdHost.replace('.', '\\.')}, ads\\.example`, 'm').test(bl.stdout), `--block: verdict block must print the blocked list\n${bl.stdout}`);
    const doc = seen.find((x) => x.path === '/blocked.html');
    check(doc && /Chromium/.test(doc.headers['sec-ch-ua'] || '') && /text\/html/.test(doc.headers.accept || ''), `--block: the main document must still carry the standard header set (route composition) — got ${JSON.stringify(doc && { ua: doc.headers['sec-ch-ua'], accept: doc.headers.accept })}`);
    if (bl.status === 0) {
      const sc = JSON.parse(readFileSync(join(tmp, 'out/bl.png.json'), 'utf8'));
      check(JSON.stringify(sc.blocked) === JSON.stringify([thirdHost, 'ads.example']) && JSON.stringify(sc.instrument.options.block) === JSON.stringify([thirdHost, 'ads.example']), `--block: sidecar blocked[] / options.block wrong: ${JSON.stringify(sc.blocked)}`);
      const pc = await run('pixel-compare.mjs', ['out/nb.png', 'out/bl.png', '--out', 'out/d.png', '--timeout', '0']);
      check(pc.status === 1 && /INCOMPARABLE CAPTURES — blocked:/.test(pc.stderr), `pixel-compare: a blocked-vs-unblocked pair must be refused (exit 1), got ${pc.status}\n${pc.stderr}`);
      const pcf = await run('pixel-compare.mjs', ['out/nb.png', 'out/bl.png', '--out', 'out/d.png', '--timeout', '0', '--force']);
      check([0, 2].includes(pcf.status) && /--force given/.test(pcf.stderr), `pixel-compare --force: must compare anyway, got ${pcf.status}\n${pcf.stderr}`);
      const pcs = await run('pixel-compare.mjs', ['out/bl.png', 'out/bl.png', '--out', 'out/d2.png', '--timeout', '0']);
      check(pcs.status === 0 && !/INCOMPARABLE/.test(pcs.stderr), `pixel-compare: same blocked list on both sides must compare, got ${pcs.status}\n${pcs.stderr}`);
    }
    const cmp = await run('stitch-shot.mjs', [`${base}/static.html`, 'out/cmp.png', ...W, '--block', 'onetrust']);
    check(cmp.status === 0 && /names a consent manager \(onetrust\)/.test(cmp.stderr), `--block onetrust: must warn that it is a consent decision (D3)\n${cmp.stderr}`);

    // ---- T14.5 / T19.2 on the diff instruments: --block reaches newLiveContext; a surviving consent container is a WARN, not an exit
    thirdHits.length = 0;
    const cdb = await runDiff('content-diff.mjs', [`${base}/blocked.html`, `${base}/blocked.html`, '--profile', 'generic', '--block', thirdHost]);
    check(cdb.status === 0 && thirdHits.length === 0, `content-diff --block: exit ${cdb.status}, widget origin hits ${thirdHits.length}\n${cdb.stderr}`);
    thirdHits.length = 0;
    const vdb = await runDiff('visual-diff.mjs', [`${base}/blocked.html`, `${base}/blocked.html`, '--profile', 'generic', '--out', 'out/vd', '--block', thirdHost]);
    check(vdb.status === 0 && thirdHits.length === 0, `visual-diff --block: exit ${vdb.status}, widget origin hits ${thirdHits.length}\n${vdb.stderr}`);
    const cdw = await runDiff('content-diff.mjs', [`${base}/consent-unknown.html`, `${base}/consent-unknown.html`, '--profile', 'generic', '--dismiss']);
    check(cdw.status === 0 && (cdw.stderr.match(/content-diff WARN consent present, not dismissed: div#unknown-banner/g) || []).length === 2, `content-diff --dismiss: a surviving consent container must WARN once per side and never change the exit (exit ${cdw.status})\n${cdw.stderr}`);

    // ---- T02.2 review-image: strip via pixel-compare --review, standalone --bands, --sheet with legend
    const mk = (w, h, f) => { const im = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b2] = f(x, y); im.data[i] = r; im.data[i + 1] = g; im.data[i + 2] = b2; im.data[i + 3] = 255; } return im; };
    const stripe = (x, y) => ((Math.floor(y / 40) + Math.floor(x / 60)) % 2 ? [40, 60, 200] : [250, 250, 250]);
    const A = mk(800, 3000, stripe);
    const B = mk(800, 3000, (x, y) => (y >= 1000 && y < 1500 ? stripe(x, y + 20) : stripe(x, y))); // band 1000–1500 shifted 20 px
    writeFileSync(join(tmp, 'out/A.png'), PNG.sync.write(A)); writeFileSync(join(tmp, 'out/B.png'), PNG.sync.write(B));
    const pcr = await run('pixel-compare.mjs', ['out/A.png', 'out/B.png', '--out', 'out/dAB.png', '--review', 'out/review-x.png', '--json-out', 'out/gate-x.json', '--timeout', '30']);
    check([0, 2].includes(pcr.status) && /^review image: out\/review-x\.png/m.test(pcr.stdout) && existsSync(join(tmp, 'out/review-x.png')), `pixel-compare --review: strip must be written and announced (exit ${pcr.status})\n${pcr.stdout}${pcr.stderr}`);
    if (existsSync(join(tmp, 'out/review-x.png'))) {
      const rv = png(join(tmp, 'out/review-x.png')); check(rv.width === 1000 && rv.height <= 1500 && rv.height > 100, `review strip: expected 1000 × ≤1500, got ${rv.width}x${rv.height}`);
      const gx = JSON.parse(readFileSync(join(tmp, 'out/gate-x.json'), 'utf8')); check(gx.review === 'out/review-x.png' && Array.isArray(gx.bands), 'pixel-compare --review: --json-out must carry review');
    }
    const pcrBad = await run('pixel-compare.mjs', ['out/A.png', 'out/B.png', '--out', 'out/dAB2.png', '--review', 'out/A.png/review.png', '--timeout', '30']);
    check(pcrBad.status === pcr.status && /review/.test(pcrBad.stderr) && /→ (PASS|FAIL)/.test(pcrBad.stdout), `pixel-compare --review (unwritable path): the review failure must go to stderr and never touch the verdict (exit ${pcrBad.status} vs ${pcr.status})\n${pcrBad.stderr}`);
    const rb = await run('review-image.mjs', ['--bands', 'out/A.png', 'out/B.png', '--out', 'out/rb.png', '--json', 'out/gate-x.json', '--diff', 'out/dAB.png', '--top', '2']);
    check(rb.status === 0 && /review strip: 2 band\(s\) \[.*1000–1500 48\.\d%/.test(rb.stdout) && existsSync(join(tmp, 'out/rb.png')), `review-image --bands: exit ${rb.status}\n${rb.stdout}${rb.stderr}`);
    const ry = await run('review-image.mjs', ['--bands', 'out/A.png', 'out/B.png', '--out', 'out/ry.png', '--y', '1000', '--height', '500']);
    check(ry.status === 0 && existsSync(join(tmp, 'out/ry.png')), `review-image --bands --y/--height: exit ${ry.status}\n${ry.stderr}`);
    mkdirSync(join(tmp, 'shots'));
    for (let i = 0; i < 5; i++) writeFileSync(join(tmp, 'shots', `page-${i}.png`), PNG.sync.write(mk(600, i === 4 ? 900 : 4000, stripe)));
    const sh2 = await run('review-image.mjs', ['--sheet', 'shots', '--out', 'out/sheet-NN.png', '--per', '4', '--cols', '2']);
    check(sh2.status === 0 && existsSync(join(tmp, 'out/sheet-01.png')) && existsSync(join(tmp, 'out/sheet-02.png')) && existsSync(join(tmp, 'out/sheet-01.json')), `review-image --sheet: two sheets + legends expected (exit ${sh2.status})\n${sh2.stdout}${sh2.stderr}`);
    if (existsSync(join(tmp, 'out/sheet-01.json'))) {
      const l1 = JSON.parse(readFileSync(join(tmp, 'out/sheet-01.json'), 'utf8')); const l2 = JSON.parse(readFileSync(join(tmp, 'out/sheet-02.json'), 'utf8'));
      check(l1.tiles.length === 4 && l2.tiles.length === 1 && l1.tiles[0].slug === 'page-0' && l1.tiles[0].cropTop === 1200 && l1.tiles[0].cropTail === 600 && l2.tiles[0].cropTail === 0, `review-image --sheet: legend wrong ${JSON.stringify(l1.tiles[0])} / ${JSON.stringify(l2.tiles[0])}`);
      const s1 = png(join(tmp, 'out/sheet-01.png')); check(s1.width <= 2000 && s1.height <= 2000, `sheet-01: ${s1.width}x${s1.height} exceeds 2000 px`);
    }
    const badArgs = await run('review-image.mjs', ['--bands', 'out/A.png']);
    check(badArgs.status === 1, 'review-image: missing --out must exit 1');
    // ---- T17.3 photo-dominated + one-sided sidecar + band ≡ full-width rect, on the synthetic pair (copies, so A/B keep no sidecar)
    {
      cpSync(join(tmp, 'out/A.png'), join(tmp, 'out/PA.png')); cpSync(join(tmp, 'out/B.png'), join(tmp, 'out/PB.png'));
      const sideBase = { url: 'x', width: 800, vh: 400, dpr: 1, capturedAt: 'x', instrument: { name: 'stitch-shot', version: '3', options: {} }, consent: { mode: 'accept', via: 'x' }, blocked: [] };
      writeFileSync(join(tmp, 'out/PA.png.json'), JSON.stringify({ ...sideBase, masksRects: [{ kind: 'img', x: 0, y: 0, w: 800, h: 2000 }] }));
      writeFileSync(join(tmp, 'out/PB.png.json'), JSON.stringify({ ...sideBase, masksRects: [{ kind: 'img', x: 0, y: 1, w: 800, h: 2000 }] }));
      const pd = await run('pixel-compare.mjs', ['out/PA.png', 'out/PB.png', '--out', 'out/pd.png', '--timeout', '0', '--no-offsets', '--mask-images', '--json-out', 'out/pd.json']);
      check([0, 2].includes(pd.status) && /^  photo-dominated: masked number covers 33\.3 % of the page \(image masks 66\.7 %\) — the ledger carries this line$/m.test(pd.stdout), `photo-dominated: a 66.7 % image mask must print the line\n${pd.stdout}${pd.stderr}`);
      if (existsSync(join(tmp, 'out/pd.json'))) { const j = JSON.parse(readFileSync(join(tmp, 'out/pd.json'), 'utf8')); check(j.photoDominated === 33.3 && j.imageMaskPct === 66.7 && j.masks[0].areaPct === 66.7, `photo-dominated --json-out: photoDominated/imageMaskPct wrong ${JSON.stringify({ p: j.photoDominated, i: j.imageMaskPct })}`); }
      const pdn = await run('pixel-compare.mjs', ['out/PA.png', 'out/PB.png', '--out', 'out/pdn.png', '--timeout', '0', '--no-offsets', '--mask-from']);
      check([0, 2].includes(pdn.status) && !/MASKED/.test(pdn.stdout) && !/photo-dominated/.test(pdn.stdout), `--mask-from alone never masks images (img rects need --mask-images)\n${pdn.stdout}`);
      // one side only: the union still applies, said on stderr
      writeFileSync(join(tmp, 'out/PB.png.json'), JSON.stringify({ ...sideBase }));
      writeFileSync(join(tmp, 'out/PA.png.json'), JSON.stringify({ ...sideBase, masksRects: [{ kind: 'sel', sel: '.x', x: 0, y: 1000, w: 800, h: 500 }] }));
      const one = await run('pixel-compare.mjs', ['out/PA.png', 'out/PB.png', '--out', 'out/one.png', '--timeout', '0', '--no-offsets', '--mask-from', '--json-out', 'out/one.json']);
      check([0, 2].includes(one.status) && /masksRects\[\] on A only/.test(one.stderr) && /sel\/authored-volatile-masked \.x \(16\.7%, asymmetric A\)/.test(one.stdout), `--mask-from one-sided: applied as union + asymmetric, warned on stderr, got ${one.status}\n${one.stdout}${one.stderr}`);
      // a --mask band and the same rows as a sel rect give the SAME number (one rect model)
      const band = await run('pixel-compare.mjs', ['out/PA.png', 'out/PB.png', '--out', 'out/band.png', '--timeout', '0', '--no-offsets', '--mask', '1000:500', '--json-out', 'out/band.json']);
      if (existsSync(join(tmp, 'out/one.json')) && existsSync(join(tmp, 'out/band.json'))) { const o = JSON.parse(readFileSync(join(tmp, 'out/one.json'), 'utf8')); const bnd = JSON.parse(readFileSync(join(tmp, 'out/band.json'), 'utf8')); check(band.status === one.status && o.pixelPct === bnd.pixelPct && o.maskedPixels === bnd.maskedPixels && bnd.masks[0].kind === 'band' && bnd.masks[0].spec === '1000:500' && bnd.maskedRows === 500, `band ≡ rect: --mask 1000:500 and a sel rect over the same rows must give the same pixelPct, got ${o.pixelPct} vs ${bnd.pixelPct} (maskedRows ${bnd.maskedRows})`); }
      // explicit --mask-from a.json,b.json
      const ex2 = await run('pixel-compare.mjs', ['out/PA.png', 'out/PB.png', '--out', 'out/ex2.png', '--timeout', '0', '--no-offsets', '--mask-from', 'out/PA.png.json,out/PA.png.json']);
      check([0, 2].includes(ex2.status) && /sel\/authored-volatile-masked \.x \(16\.7%\)/.test(ex2.stdout), `--mask-from a.json,b.json (explicit): both sides from the named files\n${ex2.stdout}${ex2.stderr}`);
    }

    // ---- T05.3 anchor --landmarks: table, first non-zero Δ, cache re-probe, --against, gate.sh record (pairLandmarks itself: layer 1)
    const a0 = await run('anchor.mjs', [`${base}/landmark-a.html`, '--width', '800', '--cache', 'out/al.json']);
    check(a0.status === 0 && !/landmarks/.test(a0.stdout), `anchor (no landmarks): exit ${a0.status}\n${a0.stderr}`);
    const a1 = await run('anchor.mjs', [`${base}/landmark-a.html`, '--width', '800', '--landmarks', '--cache', 'out/al.json']);
    check(a1.status === 0 && /has no landmarks .* re-probing once/.test(a1.stderr) && /landmarks \(10;/.test(a1.stdout) && /h2 "section two"  \[two\]/.test(a1.stdout), `anchor --landmarks (cache re-probe): exit ${a1.status}\n${a1.stdout}${a1.stderr}`);
    const a2 = await run('anchor.mjs', [`${base}/landmark-a.html`, '--width', '800', '--landmarks', '--cache', 'out/al.json']);
    check(a2.status === 0 && /from cache/.test(a2.stdout) && /landmarks \(10;/.test(a2.stdout), 'anchor --landmarks: the rewritten cache must now serve the landmarks');
    const a3 = await run('anchor.mjs', [`${base}/landmark-b.html`, '--width', '800', '--landmarks', '--against', 'out/al.json', '--json-out', 'out/lm.json']);
    check(a3.status === 0 && /first non-zero Δ: h2 "section two" \(\+24 px, section two\) — fix its section first/.test(a3.stdout) && /h2 "section one"/.test(a3.stdout), `anchor --against: exit ${a3.status}\n${a3.stdout}${a3.stderr}`);
    if (existsSync(join(tmp, 'out/lm.json'))) { const lm = JSON.parse(readFileSync(join(tmp, 'out/lm.json'), 'utf8')); check(lm.pair && lm.pair.firstDelta && lm.pair.firstDelta.dy === 24 && lm.pair.rows.length === 10 && lm.landmarks.rows.length === 10, `anchor --json-out: pair/landmarks shape wrong ${JSON.stringify(lm.pair && lm.pair.firstDelta)}`); }
    const a4 = await run('anchor.mjs', [`${base}/landmark-a.html`, '--width', '800', '--landmarks', '--against', 'out/al.json']);
    check(a4.status === 0 && /landmarks clean \(all \|Δy\| ≤ 2 px\)/.test(a4.stdout), `anchor --against (same page): expected "landmarks clean"\n${a4.stdout}`);
    // gate.sh end to end on the two fixtures: rc 0/2, review + landmarks in the record, GATE_LANDMARKS=0 drops them
    // rounds past gate.sh's 3-counted-round cap (iter4+) need --over-cap — the fixture asserts the landmark hook, not the cap (gate-sh-fixtures.mjs owns that)
    const gateRun = (env, label, extra = []) => new Promise((resolve) => {
      const c = spawn('bash', [join(tmp, 'replica', 'gate.sh'), 'landmark', `${base}/landmark-a.html`, `${base}/landmark-b.html`, '800', label, '--marker', 'landmark fixture', ...extra], { cwd: tmp, env: { ...process.env, GATE_REAP_MIN: '0', GATE_STITCH_TIMEOUT: '120', ...env } });
      let out = ''; let err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
      const t = setTimeout(() => c.kill('SIGKILL'), 240000);
      c.on('close', (status) => { clearTimeout(t); resolve({ status, out, err }); });
    });
    const g1 = await gateRun({}, 'iter1');
    const recPath = join(tmp, 'stardust/replica/gates/landmark-800/gate-iter1.json');
    check([0, 2].includes(g1.status) && existsSync(recPath), `gate.sh: expected exit 0/2 and a record, got ${g1.status}\n${g1.out}\n${g1.err}`);
    check(/first non-zero Δ: h2 "section two" \(\+24 px/.test(g1.out) && /review image: /.test(g1.out) && /pinned hidden on chunks 2\+: 0/.test(g1.out), `gate.sh: stdout must carry the landmark line, the review line and the pinned line\n${g1.out}`);
    if (existsSync(recPath)) {
      const rec = JSON.parse(readFileSync(recPath, 'utf8'));
      check(rec.landmarks && rec.landmarks.firstDelta && rec.landmarks.firstDelta.dy === 24 && rec.landmarks.rows.length === 10, `gate record: landmarks missing/wrong ${JSON.stringify(rec.landmarks && rec.landmarks.firstDelta)}`);
      check(rec.review === 'stardust/replica/gates/landmark-800/review-iter1.png' && existsSync(join(tmp, rec.review)) && rec.regime === 'prototype' && ['PASS', 'FAIL'].includes(rec.verdict), `gate record: review/regime/verdict wrong ${JSON.stringify({ r: rec.review, g: rec.regime, v: rec.verdict })}`);
      check(existsSync(join(tmp, 'stardust/replica/gates/landmark-800/anchor-live.json')) && existsSync(join(tmp, 'stardust/replica/gates/landmark-800/live.png.json')), 'gate.sh: anchor-live.json cache and live sidecar must exist after a round');
    }
    const g2 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter2');
    const rec2Path = join(tmp, 'stardust/replica/gates/landmark-800/gate-iter2.json');
    check([0, 2].includes(g2.status) && existsSync(rec2Path) && !JSON.parse(readFileSync(rec2Path, 'utf8')).landmarks && !/first non-zero Δ/.test(g2.out), `gate.sh GATE_LANDMARKS=0: no landmark table expected (exit ${g2.status})\n${g2.out}${g2.err}`);
    check(/reference: .* captured/.test(g2.out), 'gate.sh: round 2 must reuse the cached live reference');
    // a live reference from an older stitch-shot procedure is stale: re-captured, one loud line, sidecar now current
    const liveSide = join(tmp, 'stardust/replica/gates/landmark-800/live.png.json');
    if (existsSync(liveSide)) {
      const sc = JSON.parse(readFileSync(liveSide, 'utf8')); const cur = sc.instrument.version; sc.instrument.version = '2'; writeFileSync(liveSide, JSON.stringify(sc));
      const g3 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter3');
      const after = existsSync(liveSide) ? JSON.parse(readFileSync(liveSide, 'utf8')) : null;
      check([0, 2].includes(g3.status) && /older stitch-shot procedure \(instrument\.version 2, current 3/.test(g3.err) && after && after.instrument.version === cur, `gate.sh: a v2 live reference must be re-captured (exit ${g3.status}, version after ${after && after.instrument.version})\n${g3.err}`);
      // T05.3: a failed live landmark probe is not retried every round — anchor-live.skip
      // (a directory at the cache path makes anchor.mjs's cache write throw → exit 1, deterministic)
      const gdir = join(tmp, 'stardust/replica/gates/landmark-800');
      rmSync(join(gdir, 'anchor-live.json'), { recursive: true, force: true }); mkdirSync(join(gdir, 'anchor-live.json'));
      const g4 = await gateRun({}, 'iter4', ['--over-cap', 'instrument-invalidated']);
      check([0, 2].includes(g4.status) && /landmark table unavailable \(live anchor exit 1\)/.test(g4.err) && existsSync(join(gdir, 'anchor-live.skip')) && /^exit 1 at \d{4}-/.test(readFileSync(join(gdir, 'anchor-live.skip'), 'utf8')), `gate.sh: a failed live landmark probe must warn once and write anchor-live.skip (exit ${g4.status})\n${g4.err}`);
      const g5 = await gateRun({}, 'iter5', ['--over-cap', 'instrument-invalidated']);
      check([0, 2].includes(g5.status) && /landmark table skipped — the live landmark probe failed earlier/.test(g5.err) && !/landmark table unavailable/.test(g5.err) && !/anchor live landmark/.test(g5.err), `gate.sh: while anchor-live.skip exists the live pass must be skipped, not retried (exit ${g5.status})\n${g5.err}`);
      rmSync(join(gdir, 'anchor-live.json'), { recursive: true, force: true });
      const g6 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter6', ['--over-cap', 'instrument-invalidated']);
      check([0, 2].includes(g6.status) && !existsSync(join(gdir, 'anchor-live.skip')), `gate.sh GATE_LANDMARKS=0: anchor-live.skip must be cleared (exit ${g6.status})\n${g6.err}`);
      // T17.3 gate.sh: masks.json validated first, on BOTH captures (sidecar masksRects) and the compare (record masks[]);
      // a cached live.png taken with other mask flags is stale; an invalid file exits 1 before any capture
      mkdirSync(join(tmp, 'stardust/replica'), { recursive: true });
      const mjPath = join(tmp, 'stardust/replica/masks.json');
      writeFileSync(mjPath, JSON.stringify([{ sel: 'h2', class: 'nondeterministic-live', source: 'decision:fixture' }]));
      const g7 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter7', ['--over-cap', 'instrument-invalidated']);
      check([0, 2].includes(g7.status) && /captured with other mask flags/.test(g7.err) && /^gate\.sh: masks from stardust\/replica\/masks\.json → \{"maskSel":\["h2"\]/m.test(g7.out) && /\[MASKED \d+ mask\(s\)/.test(g7.out) && /sel\/nondeterministic-live h2 \([\d.]+%\)/.test(g7.out), `gate.sh masks.json: the live reference taken without masks must be recaptured (stderr), the masks line printed and every h2 mask on the verdict line (exit ${g7.status})\n${g7.out}\n${g7.err}`);
      const rec7 = join(gdir, 'gate-iter7.json');
      if (existsSync(rec7)) { const r7 = JSON.parse(readFileSync(rec7, 'utf8')); check(Array.isArray(r7.masks) && r7.masks.length === 1 && r7.masks[0].kind === 'sel' && r7.masks[0].sel === 'h2' && r7.masks[0].class === 'nondeterministic-live' && r7.masks[0].side === 'both' && r7.masks[0].rects.length >= 2 && r7.masksJson === 'stardust/replica/masks.json' && typeof r7.pixelPctUnmasked === 'number', `gate record iter7: masks[] must carry the one h2 sel mask (union of both sides) + masksJson, got ${JSON.stringify({ m: r7.masks, j: r7.masksJson })}`); }
      for (const sd of ['live', 'build']) { const scp = join(gdir, `${sd}.png.json`); const sc = existsSync(scp) ? JSON.parse(readFileSync(scp, 'utf8')) : {}; check(sc.instrument && JSON.stringify(sc.instrument.options.maskSel) === '["h2"]' && Array.isArray(sc.masksRects) && sc.masksRects.length >= 1 && sc.masksRects.every((r) => r.kind === 'sel' && r.sel === 'h2'), `gate.sh masks.json: the ${sd} sidecar must record maskSel ["h2"] and masksRects[], got ${JSON.stringify({ o: sc.instrument && sc.instrument.options && sc.instrument.options.maskSel, n: sc.masksRects && sc.masksRects.length })}`); }
      const g8 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter8', ['--over-cap', 'instrument-invalidated']);
      check([0, 2].includes(g8.status) && !/captured with other mask flags/.test(g8.err) && /reference: .* captured/.test(g8.out), `gate.sh masks.json unchanged: the cached live reference must be reused (exit ${g8.status})\n${g8.err}`);
      writeFileSync(mjPath, JSON.stringify([{ sel: 'h2', class: 'nondeterministic-live' }]));
      const g9 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter9', ['--over-cap', 'instrument-invalidated']);
      check(g9.status === 1 && /masks\.json rejected/.test(g9.err) && /entry 0: source missing/.test(g9.err) && !existsSync(join(gdir, 'gate-iter9.json')) && !/stitched /.test(g9.out), `gate.sh masks.json without source: exit 1 before any capture, no record (exit ${g9.status})\n${g9.out}${g9.err}`);
      rmSync(mjPath, { force: true });
      const g10 = await gateRun({ GATE_LANDMARKS: '0' }, 'iter10', ['--over-cap', 'instrument-invalidated']);
      check([0, 2].includes(g10.status) && /captured with other mask flags/.test(g10.err) && !/MASKED/.test(g10.out), `gate.sh masks.json removed: the masked live reference is stale again and the round is unmasked (exit ${g10.status})\n${g10.err}`);
    }

    // ---- T05.4 pixel-compare --offsets on a synthetic pair with a 40 px strip inserted at y = 1000 (bandOffsets/markSeams: layer 1)
    const hashRow = (y) => { const v = ((y * 2654435761) >>> 0) % 200 + 20; return [v, v, v]; };
    const A2 = mk(600, 3000, (x, y) => (y >= 2500 ? [100, 100, 100] : hashRow(y)));
    const B2 = mk(600, 3040, (x, y) => (y >= 2500 ? [100, 100, 100] : y < 1000 ? hashRow(y) : y < 1040 ? [128, 128, 128] : hashRow(y - 40)));
    writeFileSync(join(tmp, 'out/A2.png'), PNG.sync.write(A2)); writeFileSync(join(tmp, 'out/B2.png'), PNG.sync.write(B2));
    const po = await run('pixel-compare.mjs', ['out/A2.png', 'out/B2.png', '--out', 'out/d2.png', '--json-out', 'out/g2.json', '--timeout', '30']);
    check([0, 2].includes(po.status) && /^first seam: y 1000–1500 \(offset 0 → \+40px\) — fix that section first/m.test(po.stdout), `pixel-compare offsets: first seam line expected\n${po.stdout}${po.stderr}`);
    check(/y\s+1000–1500: [\d.]+%\s+offset\s+\+40px \([\d.]+\)(\s+◄◄ hot band)?\s+◄ seam/.test(po.stdout) && /y\s+2500–3000: [\d.]+%\s+offset\s+—/.test(po.stdout) && /y\s+0–500: [\d.]+%\s+offset\s+0px/.test(po.stdout), `pixel-compare offsets: band rows must carry +40px/◄ seam, 0px and — \n${po.stdout}`);
    if (existsSync(join(tmp, 'out/g2.json'))) {
      const g2 = JSON.parse(readFileSync(join(tmp, 'out/g2.json'), 'utf8'));
      check(g2.bands[2].offset === 40 && g2.bands[2].seam === true && g2.bands[0].offset === 0 && g2.bands[5].offset === null && g2.offsets && g2.offsets.firstSeam && g2.offsets.firstSeam.y0 === 1000 && g2.heightDelta === -40, `pixel-compare --json-out: bands[].offset/seam + offsets.firstSeam wrong ${JSON.stringify({ b2: g2.bands[2], fs: g2.offsets && g2.offsets.firstSeam, hd: g2.heightDelta })}`);
    }
    const pn = await run('pixel-compare.mjs', ['out/A2.png', 'out/B2.png', '--out', 'out/d3.png', '--json', '--timeout', '30', '--no-offsets']);
    check([0, 2].includes(pn.status) && !/offset/.test(pn.stdout), `pixel-compare --no-offsets: no offset fields expected\n${pn.stderr}`);

    // ---- T18.3 chrome-parity states: rest (marker + STATE), --scroll (STICKY), --open (EXTRA + OCCLUDED + PSEUDO), state-aware --live-cache
    const CP = [`${base}/chrome-live.html`, `${base}/chrome-build.html`, '--width', '800'];
    const c0 = await run('chrome-parity.mjs', [...CP, '--live-cache', 'out/chrome-live.json']);
    check(c0.status === 2 && /state: rest/.test(c0.stdout), `chrome-parity rest: expected exit 2 (deltas) + "state: rest", got ${c0.status}\n${c0.stdout}${c0.stderr}`);
    check(/PAIR\s+"Legal"\s+.*marker none → disc/.test(c0.stdout), `chrome-parity rest: footer list marker (live none, build disc) must be a PAIR delta\n${c0.stdout}`);
    check(/STATE\s+"Home"\s+live marks "Home" current[^\n]*live current vs sibling: [^\n]*fontWeight 400 → 700/.test(c0.stdout), `chrome-parity rest: aria-current on live with no build marker must be STATE, naming the style delta vs siblings\n${c0.stdout}`);
    check(!/STICKY/.test(c0.stdout) && !/EXTRA\s+"Mega item"/.test(c0.stdout) && !/OCCLUDED/.test(c0.stdout) && !/PSEUDO/.test(c0.stdout), `chrome-parity rest: no STICKY / EXTRA Mega item / OCCLUDED / PSEUDO at rest\n${c0.stdout}`);
    const c1 = await run('chrome-parity.mjs', [...CP, '--scroll', '400', '--live-cache', 'out/chrome-live.json']);
    check(c1.status === 2 && /re-probing live/.test(c1.stderr) && /STICKY\s+live pins div\.promo \(48px\), build pins header#hdr \(132px\)/.test(c1.stdout), `chrome-parity --scroll 400: rest cache must be re-probed (state key) and STICKY must read "live pins div.promo (48px), build pins header#hdr (132px)"\n${c1.stdout}${c1.stderr}`);
    if (existsSync(join(tmp, 'out/chrome-live.json'))) { const k = JSON.parse(readFileSync(join(tmp, 'out/chrome-live.json'), 'utf8')).key; check(k.scroll === 400 && k.open === null, `chrome-parity --live-cache: key must carry the state, got ${JSON.stringify(k)}`); }
    const c2 = await run('chrome-parity.mjs', [...CP, '--open', 'button.menu']);
    check(c2.status === 2 && /state: open button\.menu/.test(c2.stdout) && /EXTRA\s+"Mega item"/.test(c2.stdout), `chrome-parity --open: the build-only dropdown item must be EXTRA in the open state\n${c2.stdout}${c2.stderr}`);
    check(/OCCLUDED\s+"Alpha item"\s+build "Alpha item" is covered by (main|section|p)/.test(c2.stdout) && !/WARN\s+live "Alpha item"/.test(c2.stdout), `chrome-parity --open: the build dropdown painted behind main must be OCCLUDED (live side clean)\n${c2.stdout}`);
    check(/PSEUDO\s+::before of the opened trigger: [^\n]*height 4px → auto/.test(c2.stdout), `chrome-parity --open: the trigger's ::before bar (4px live, none build) must be PSEUDO\n${c2.stdout}`);
    const c3 = await run('chrome-parity.mjs', [`${base}/chrome-live.html`, `${base}/chrome-live.html`, '--width', '800', '--open', 'button.menu', '--scroll', '300']);
    check(c3.status === 0 && /✓ parity/.test(c3.stdout), `chrome-parity same page open+scroll: must be parity (exit ${c3.status})\n${c3.stdout}${c3.stderr}`);
  } finally {
    third.srv.close();
    srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const deps = resolveDeps();
if (deps) await layer2(deps);
else console.log('replica-capture-fixtures: SKIP browser fixtures — no node_modules with playwright + pngjs + pixelmatch (set STARDUST_GATE_DEPS=<dir>/node_modules, or npm i -D playwright pixelmatch pngjs at the repo root)');

if (failures.length) { console.error(`replica-capture-fixtures: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log(`replica-capture-fixtures: ok (static contracts${deps ? ' + browser fixtures' : ''})`);
