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
//      (live-session parseBlockList/blockDecision/label tables,
//      pixel-compare bandOffsets, review-image layout helpers).
//   2. WITH DEPS — the browser-driven fixtures under
//      lint/fixtures/replica-capture/ (a fixed header that must be hidden on
//      chunks 2+, a static page that must stay byte-identical, an overlay
//      wall that must exit 5, --expect-height 99999 → exit 5, the overlays
//      page for dismissOverlays, a blocked third-party sub-resource). They
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
const SCRIPTS = ['stitch-shot.mjs', 'anchor.mjs', 'chrome-parity.mjs', 'sibling-variance.mjs', 'motion-observe.mjs', 'pixel-compare.mjs', 'crop-compare.mjs', 'capture-sidecar.mjs', 'review-image.mjs', 'run-capped.mjs'];
for (const f of SCRIPTS) {
  const p = join(REPLICA, f);
  if (!existsSync(p)) continue;
  const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
  check(r.status === 0, `${f}: node --check failed\n${r.stderr}`);
}
check(spawnSync(process.execPath, ['--check', join(DIFF, 'live-session.mjs')], { encoding: 'utf8' }).status === 0, 'live-session.mjs: node --check failed');
check(spawnSync('bash', ['-n', join(REPLICA, 'gate.sh')], { encoding: 'utf8' }).status === 0, 'gate.sh: bash -n failed');

// stitch-shot contracts (T19.1)
const ss = src(join(REPLICA, 'stitch-shot.mjs'));
check(/Math\.round\(await page\.evaluate\(\(\) => window\.scrollY\)\)/.test(ss), 'stitch-shot: window.scrollY must be rounded before a chunk is placed (integer scroll)');
check(/setProperty\('opacity', '0', 'important'\)/.test(ss), 'stitch-shot: pinned chrome must be hidden with opacity:0 !important (not visibility)');
check(/--keep-pinned/.test(ss) && /--expect-height/.test(ss) && /--exclude-live-only/.test(ss) && /--allow-overlay/.test(ss), 'stitch-shot: T19.1 flags missing from the parser/HELP');
check(/reducedMotion: 'reduce'/.test(ss), 'stitch-shot: newLiveContext must pass reducedMotion: reduce');
check(/Exit codes: 0 written[^]*5 invalid capture/.test(ss), 'stitch-shot: HELP must document exit 5 (invalid capture, no verdict)');
check(/--allow-consent/.test(ss) && /--no-dismiss-defaults/.test(ss) && /--remove-text/.test(ss), 'stitch-shot: T19.2 flags missing from the parser/HELP');
// live-session pure exports (T19.2) — dependency-free module, importable here
const ls = await import(pathToFileURL(join(DIFF, 'live-session.mjs')).href);
check(typeof ls.dismissOverlays === 'function' && typeof ls.installOverlayWatch === 'function' && typeof ls.readOverlayWatch === 'function' && typeof ls.reportOverlayResidue === 'function', 'live-session: dismissOverlays / installOverlayWatch / readOverlayWatch / reportOverlayResidue must be exported');
check(ls.ACCEPT_LABELS.includes('godta alle') && ls.ACCEPT_LABELS.includes('alle akzeptieren') && ls.ACCEPT_LABELS.includes('tout accepter') && ls.ACCEPT_LABELS.every((l) => l.length <= 25), 'live-session: ACCEPT_LABELS must carry the multilingual set with every label ≤ 25 chars (B28)');
check(ls.DECLINE_LABELS.includes('reject all') && ls.DECLINE_LABELS.includes('alle ablehnen') && ls.DECLINE_LABELS.includes('avvis alle') && !ls.DECLINE_LABELS.some((l) => ls.ACCEPT_LABELS.includes(l)), 'live-session: DECLINE_LABELS must be disjoint from ACCEPT_LABELS');
check(ls.normLabel('  Godta\u00a0ALLE! ') === 'godta alle' && ls.normLabel('Accept all cookies…') === 'accept all cookies', `live-session: normLabel wrong (${ls.normLabel('  Godta\u00a0ALLE! ')})`);
check(ls.HIDE_DEFAULTS.includes('#ot-sdk-btn-floating'), 'live-session: HIDE_DEFAULTS must include the OneTrust floating launcher');
const lsSrc = src(join(DIFF, 'live-session.mjs'));
check(!/page\.locator\(sel\)\.first\(\)/.test(lsSrc.slice(lsSrc.indexOf('export async function dismissOverlays'))), 'live-session: dismissOverlays must not use locator(sel).first() (the hidden-twin trap) — iterate all matches');
// --block (T14.5): pure decision + route composition contract
check(JSON.stringify(ls.parseBlockList(' Chat.Example, ads.example ,chat.example,')) === JSON.stringify(['chat.example', 'ads.example']), 'live-session: parseBlockList must trim, lower-case and de-duplicate');
const bd = (o) => ls.blockDecision({ substrings: ['chat.example'], targetOrigin: 'https://site.example', authOrigin: 'https://auth.example', ...o });
check(bd({ url: 'https://chat.example/widget.js' }) === true, 'blockDecision: a matching third-party URL must be blocked');
check(bd({ url: 'https://chat.example/', isMainNav: true }) === false, 'blockDecision: the main-frame navigation is never blocked');
check(bd({ url: 'https://site.example/chat.example.png' }) === false, 'blockDecision: the target origin is exempt even when the path matches');
check(bd({ url: 'https://auth.example/x?chat.example' }) === false, 'blockDecision: the auth origin is exempt');
check(bd({ url: 'https://cdn.chat.example/frame.html', isMainNav: false }) === true, 'blockDecision: a sub-frame document IS blockable (iframe widgets are the point)');
check(ls.blockDecision({ url: 'https://chat.example/x', substrings: [] }) === false, 'blockDecision: an empty list blocks nothing');
check(ls.CMP_HOSTS.includes('onetrust') && ls.warnCmpBlock(['qualified.com']).length === 0, 'live-session: CMP_HOSTS / warnCmpBlock wrong');
const nlc = lsSrc.slice(lsSrc.indexOf('export async function newLiveContext'), lsSrc.indexOf('// The marker that classifies')).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check(!/route\.continue\(/.test(nlc) && (nlc.match(/route\.fallback\(/g) || []).length >= 5, 'live-session: every route handler in the newLiveContext stack must use route.fallback() — continue() ends the chain and disabled the header/auth routes in the field');
check(src(join(REPLICA, 'capture-sidecar.mjs')).includes("'blocked'"), 'capture-sidecar: blocked must be a refusal key');
for (const f of ['stitch-shot.mjs', 'anchor.mjs', 'chrome-parity.mjs', 'sibling-variance.mjs', 'motion-observe.mjs']) check(/'--block'/.test(src(join(REPLICA, f))) && /block: opts\.block/.test(src(join(REPLICA, f))), `${f}: --block parser case + pass-through to newLiveContext missing`);
// review-image (T02.2): dependency-free helpers importable without pngjs
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
}
const pcSrc = src(join(REPLICA, 'pixel-compare.mjs'));
check(/'--review'/.test(pcSrc) && /renderBands\(/.test(pcSrc) && /review image:/.test(pcSrc), 'pixel-compare: --review must render the strip in-process and print `review image:`');
check(pcSrc.indexOf('const pass = pct <= opts.threshold') > pcSrc.indexOf('renderBands({') && /verdict unaffected/.test(pcSrc), 'pixel-compare: the review render must sit before the verdict and never touch it (try/catch to stderr)');
// gate.sh contracts
const gate = src(join(REPLICA, 'gate.sh'));
check(/\[ \$rc -eq 5 \]/.test(gate), 'gate.sh: rc 5 (invalid capture) branch missing — must remove the partial PNG and re-exit 5, never compare');
check(/--expect-height \$EXPECT/.test(gate), 'gate.sh: --expect-height from the crawl screenshot missing on the live capture');
check(/\[ \$rc -eq 124 \]/.test(gate), 'gate.sh: exit 124 handling must stay');
check(/--review "\$DIR\/review-\$LBL\.png"/.test(gate), 'gate.sh: pixel-compare line must pass --review review-<label>.png');
check(/GATE_BLOCK/.test(gate) && (gate.match(/\$STITCH_COMMON/g) || []).length >= 2, 'gate.sh: GATE_BLOCK must reach BOTH stitch-shot calls');

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
  for (const f of readdirSync(REPLICA)) cpSync(join(REPLICA, f), join(tmp, 'replica', f));
  cpSync(join(DIFF, 'live-session.mjs'), join(tmp, 'diff', 'live-session.mjs'));
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
    }
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
    const csP = await run('stitch-shot.mjs', [`${base}/consent-pair.html`, 'out/cP.png', ...W]);
    check(csP.status === 0 && /consent dismissed via (button:has-text\("Accept all"\)|\[data-testid\*="accept"\])/.test(csP.stdout) && /frame overlay dismissed via frame:.*text:no thanks/.test(csP.stdout) && /hidden 1 persistent widget\(s\) via #ot-sdk-btn-floating/.test(csP.stdout), `stitch-shot consent-pair: expected consent + frame + hidden lines, got ${csP.status}\n${csP.stdout}${csP.stderr}`);

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
