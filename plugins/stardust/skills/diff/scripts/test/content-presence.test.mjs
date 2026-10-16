#!/usr/bin/env node
// skills/diff/scripts/test/content-presence.test.mjs — the content-presence.mjs differ (#125 D2), no browser:
// alignHeadings (LCS by text, prefix tolerance), diffPresence — HIDDEN LINK ×n for links present but clipped,
// MISSING LINK for absent ones, MOVED LINK when present in another band, cross-kind matching (an origin
// button served as a link is not missing), session-variable regions compared as counts (never MISSING) while
// HIDDEN still counts, CONTROL STATE for a sort trigger, HEADING AS TEXT when the text survives as plain
// text, scope = whole page when one side lacks <main>, chrome items excluded by default; formatReport lines;
// --help in an empty cwd; --origin-cache: originCacheKey (field order, stability) and parseArgs, and where
// playwright is importable an e2e write-then-read of the origin side (0 origin requests on a hit, a key mismatch
// measures; a blank origin render is measured but never cached). One load (gate-all --one-load): presenceReport has
// main's keys, blankRender, inventoryPage / inventoryToFile (the hook's scroll protocol, the file, failures never
// throw) over a stand-in page; e2e symmetry (playwright + pngjs + stitch-shot alongside): a fixture page's inventory
// taken standalone equals the one stitch-shot --inventory takes, and the hook changes no pixel. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignHeadings, blankRender, diffPresence, formatReport, inventoryPage, inventorySide, inventoryToFile, originCacheKey, parseArgs, presenceReport } from '../content-presence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'content-presence.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const it = (kind, text, y, extra = {}) => ({ kind, text, y, x: 0, w: 100, h: 20, state: 'visible', variable: false, inRoot: true, inChrome: false, path: 'p', ...extra });
const inv = (items, root = 'main') => ({ docH: 3000, pageW: 1440, root, items });

check('alignHeadings: LCS in order, prefix-tolerant for long texts', () => {
  assert.deepEqual(alignHeadings(['a', 'b', 'c'], ['a', 'c']), [{ oi: 0, ei: 1 }, { oi: 2, ei: 1 }].map((p, i) => [{ oi: 0, ei: 0 }, { oi: 2, ei: 1 }][i]));
  assert.deepEqual(alignHeadings(['help center topics'], ['help center topics and more']), [{ oi: 0, ei: 0 }]);
  assert.deepEqual(alignHeadings(['x'], ['y']), []);
});
check('HIDDEN LINK ×n when the served links exist but are clipped; exit criterion counts them', () => {
  const o = inv([it('heading', 'Coupons', 100, { level: 1 }), ...Array.from({ length: 3 }, (_, i) => it('link', 'View details', 200 + i * 10, { href: '/d' }))]);
  const e = inv([it('heading', 'Coupons', 100, { level: 1 }), ...Array.from({ length: 3 }, (_, i) => it('link', 'View details', 200 + i * 10, { href: '/d', state: 'hidden' }))]);
  const r = diffPresence(o, e);
  const f = r.findings.find((x) => x.kind === 'HIDDEN LINK');
  assert.ok(f && f.n === 3, JSON.stringify(r.findings)); assert.equal(r.totals.hidden, 3); assert.equal(r.totals.missing, 0); assert.equal(r.bands[1].eds.linkHidden, 3);
});
check('MISSING LINK when absent, MOVED LINK when visible in another band, EXTRA LINK for build-only', () => {
  const o = inv([it('heading', 'A', 100, { level: 2 }), it('link', 'Contact', 150, { href: '/c' }), it('heading', 'B', 500, { level: 2 }), it('link', 'Careers', 550, { href: '/j' })]);
  const e = inv([it('heading', 'A', 100, { level: 2 }), it('heading', 'B', 500, { level: 2 }), it('link', 'Contact', 550, { href: '/c' }), it('link', 'Newsroom', 560, { href: '/n' })]);
  const r = diffPresence(o, e);
  assert.deepEqual(r.findings.map((x) => x.kind).sort(), ['EXTRA LINK', 'MISSING LINK', 'MOVED LINK']);
  assert.equal(r.totals.missing, 1);
});
check('cross-kind: an origin button served as a link is present; an origin link served as a button is present', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('button', 'Sign in', 20), it('link', 'Join', 30, { href: '/j' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('link', 'Sign in', 20, { href: '/s' }), it('button', 'Join', 30)]);
  const r = diffPresence(o, e);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
});
check('session-variable region: counts only (never MISSING), HIDDEN still 🔴', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), ...Array.from({ length: 6 }, (_, i) => it('link', `Coupon ${i}`, 100 + i, { href: '/c', variable: true }))]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), ...Array.from({ length: 2 }, (_, i) => it('link', `Other ${i}`, 100 + i, { href: '/o', variable: true })), it('link', 'Clipped one', 120, { href: '/x', variable: true, state: 'hidden' })]);
  const r = diffPresence(o, e);
  assert.ok(!r.findings.some((x) => x.kind === 'MISSING LINK'), JSON.stringify(r.findings));
  assert.ok(r.findings.some((x) => x.kind === 'COUNT LINKS'));
  assert.equal(r.totals.hidden, 1); assert.equal(r.bands[1].variable, true);
});
check('CONTROL STATE for a trigger with the same label and a different value; COUNT control matched by via', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'sort by', value: 'Recommended', via: 'trigger' }), it('control', '', 30, { label: 'count coupon', value: '285', via: 'count' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'sort by', value: 'Expiration Date', via: 'trigger' }), it('control', '', 30, { label: 'count coupon', value: '284', via: 'count' })]);
  const r = diffPresence(o, e);
  assert.equal(r.findings.filter((x) => x.kind === 'CONTROL STATE').length, 2, JSON.stringify(r.findings)); assert.equal(r.totals.controlState, 2); assert.equal(r.totals.structural, 0);
});
check('a specifically labelled control with no counterpart is CONTROL MISSING (never paired by ordinal); generic ones pair by ordinal', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'rebate help', value: 'rebate help', via: 'trigger' }), it('control', '', 25, { label: 'trigger', value: 'Menu A', via: 'trigger' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'trigger', value: 'Menu B', via: 'trigger' })]);
  const r = diffPresence(o, e);
  assert.ok(r.findings.some((x) => x.kind === 'CONTROL MISSING' && /rebate/.test(x.msg)));
  assert.ok(r.findings.some((x) => x.kind === 'CONTROL STATE' && /Menu A.*Menu B/.test(x.msg)));
});
check('HEADING AS TEXT (🟡) when the text is served as plain text; MISSING HEADING (🔴) when it is gone', () => {
  const o = inv([it('heading', 'Rx information', 100, { level: 3 }), it('heading', 'Gone', 300, { level: 2 })]);
  const e = inv([it('text', 'Rx information', 100)]);
  const r = diffPresence(o, e);
  assert.ok(r.findings.some((x) => x.kind === 'HEADING AS TEXT' && x.sev === '🟡'));
  assert.ok(r.findings.some((x) => x.kind === 'MISSING HEADING' && x.sev === '🔴')); assert.equal(r.totals.missingHeadings, 1);
});
check('scope: whole page when one side has no root; chrome items excluded unless { chrome: true }', () => {
  const o = inv([it('link', 'Promo strip', 5, { href: '/p', inRoot: null, inChrome: true }), it('link', 'Body link', 400, { href: '/b', inRoot: null })], null);
  const e = inv([it('link', 'Body link', 400, { href: '/b', inRoot: true })], 'main');
  assert.equal(diffPresence(o, e).scope, 'page');
  assert.equal(diffPresence(o, e).findings.length, 0);
  assert.equal(diffPresence(o, e, { chrome: true }).totals.missing, 1);
});
check('formatReport: band table + Content/Findings lines', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('link', 'A', 20, { href: '/a' })]);
  const r = diffPresence(o, inv([it('heading', 'H', 10, { level: 1 })]));
  const s = formatReport(r);
  assert.match(s, /\| band \| heading/); assert.match(s, /MISSING LINK: "A"/); assert.match(s, /Content: MISSING 1/); assert.match(s, /Findings: 1 \(1 structural/);
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'content-presence-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node content-presence\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
check('--origin-cache: parseArgs takes the file (default null); originCacheKey has a fixed field order and is stable', () => {
  const argv = (...a) => ['node', 'x', 'https://o.example/p', 'https://e.example/p', ...a];
  assert.equal(parseArgs(argv()).originCache, null);
  const o = parseArgs(argv('--origin-cache', 'gates/home/presence-origin.json', '--main', 'main.c=main', '--variable', '.promo', '--warmup', 'https://o.example/'));
  assert.equal(o.originCache, 'gates/home/presence-origin.json');
  const k = originCacheKey(o);
  assert.deepEqual(Object.keys(k), ['url', 'width', 'locale', 'rootSel', 'variableSels', 'countWords', 'moreWords', 'minCut', 'settlePasses', 'tier', 'warmup']);
  assert.deepEqual(k, { url: 'https://o.example/p', width: 1440, locale: 'en-US', rootSel: 'main.c', variableSels: ['.promo'], countWords: null, moreWords: null, minCut: 2, settlePasses: 4, tier: 'stealth', warmup: 'https://o.example/' });
  assert.equal(JSON.stringify(originCacheKey(parseArgs(argv('--main', 'main.c=main', '--variable', '.promo', '--warmup', 'https://o.example/', '--origin-cache', 'x')))), JSON.stringify(k), 'the cache file is not part of the key');
  assert.equal(originCacheKey(parseArgs(argv('--plain'))).tier, 'plain');
  assert.notDeepEqual(originCacheKey(parseArgs(argv('--width', '360'))), originCacheKey(parseArgs(argv())));
});

// ---- one load (gate-all --one-load): the report and inventory exports ------------------------------------------
const sideInv = (items, extra = {}) => ({ url: 'https://x.test/', at: '2026-01-01T00:00:00.000Z', status: 200, settlePasses: 2, ...inv(items), clip: { counts: { total: 0 }, groups: [], findings: [] }, textBoxes: [], ...extra });
check('presenceReport: exactly the keys main writes (via content-presence by default, one-load when given); a stitch-taken side says settle', () => {
  const o = sideInv([it('heading', 'H', 10, { level: 1 }), it('link', 'A', 20, { href: '/a' })]); const e = sideInv([it('heading', 'H', 10, { level: 1 })]);
  const r = presenceReport(o, e, { width: 1440, variable: ['.rail'], tier: 'chrome' });
  assert.deepEqual(Object.keys(r), ['_provenance', 'origin', 'eds', 'bands', 'findings', 'totals', 'textBoxes']);
  assert.deepEqual(Object.keys(r._provenance), ['writtenBy', 'at', 'width', 'variable', 'tier', 'originCache', 'via']);
  assert.deepEqual(Object.keys(r.origin), ['url', 'at', 'status', 'settlePasses', 'docH', 'root', 'items', 'clip']);
  assert.equal(r._provenance.via, 'content-presence'); assert.equal(r._provenance.originCache, null); assert.equal(r.totals.missing, 1);
  assert.deepEqual(r.totals, diffPresence(o, e).totals); assert.deepEqual(r.eds.clip, e.clip, 'the served side keeps its findings');
  const s = presenceReport({ ...o, settle: 'stitch' }, { ...e, settle: 'stitch' }, { width: 1440, via: 'one-load' });
  assert.equal(s._provenance.via, 'one-load'); assert.equal(s.origin.settle, 'stitch'); assert.equal(s.eds.settle, 'stitch');
});
check('blankRender: fewer than 3 visible in-scope items (root when there is one, chrome left out) is a blank render', () => {
  const three = [it('heading', 'H', 10, { level: 1 }), it('text', 'Body text', 20), it('link', 'A', 30, { href: '/a' })];
  assert.equal(blankRender(inv(three)), false);
  assert.equal(blankRender(inv(three.slice(0, 2))), true);
  assert.equal(blankRender(inv([...three.slice(0, 2), it('link', 'Nav', 5, { inChrome: true })])), true, 'chrome does not count');
  assert.equal(blankRender(inv([...three.slice(0, 2), it('link', 'Hidden', 40, { state: 'hidden' })])), true, 'clipped items do not count');
  assert.equal(blankRender(inv([...three.slice(0, 2), it('link', 'Outside', 40, { inRoot: false })])), true, 'outside the root does not count');
  assert.equal(blankRender(inv([...three.slice(0, 2), it('link', 'Whole page', 40, { inRoot: null })], null)), false, 'no root: the whole page');
});
// A stand-in page: evaluate() answers by function name and records the hook's sequence.
const fakePage = (seq, { y = 1234, fail = null } = {}) => ({
  context: () => ({ browser: () => ({ stardustTier: 'chrome' }) }),
  waitForTimeout: async (ms) => { seq.push(`wait ${ms}`); },
  evaluate: async (f, a) => {
    const src = String(f);
    if (fail && src.includes(fail)) throw new Error(`${fail} exploded`);
    if (src.includes('presenceInventoryInPage')) { seq.push('presence'); return { docH: 3000, pageW: 1440, root: 'main', items: [it('heading', 'H', 10, { level: 1 })] }; }
    if (src.includes('clipInventoryInPage')) { seq.push('clip'); return { docH: 3000, pageW: 1440, counts: { total: 1 }, findings: [{ kind: 'TEXT CLIPPED', path: 'p', clipper: 'div', cut: 3 }], textBoxes: [{ x: 0, y: 0, w: 1, h: 1 }] }; }
    if (src.includes('unitInventoryInPage')) { seq.push(`unit ${JSON.parse(src.slice(src.lastIndexOf('({"sel":') + 1, src.lastIndexOf('); })()'))).sel}`); return { sel: '.card', matches: 1, units: [] }; }
    if (src.includes('scrollTo')) { seq.push(`scrollTo ${a ?? 0}`); return undefined; }
    if (src.includes('scrollY')) { seq.push('scrollY'); return y; }
    return undefined;
  },
});
const hookDir = mkdtempSync(join(tmpdir(), 'content-presence-hook-'));
const specOf = (o = {}) => { const f = join(hookDir, `spec-${Object.keys(o).join('-') || 'all'}.json`); writeFileSync(f, JSON.stringify({ out: join(hookDir, 'inv.json'), side: 'origin', presence: { rootSel: null, variableSels: [] }, clip: { minCut: 2, maxFindings: 400 }, units: { sels: ['.card'], n: 2 }, ...o })); return f; };
await (async () => {
  const seq0 = []; const r0 = await inventoryPage(fakePage(seq0), { clip: { minCut: 2, maxFindings: 400 } });
  check('inventoryPage / inventoryToFile are exported; inventoryPage takes only the blocks given (no presence: docH from the clip pass)', () => {
    assert.equal(typeof inventoryPage, 'function'); assert.equal(typeof inventoryToFile, 'function'); assert.equal(typeof inventorySide, 'function');
    assert.deepEqual(seq0, ['clip']); assert.deepEqual(Object.keys(r0), ['docH', 'pageW', 'clip', 'textBoxes']); assert.equal(r0.clip.groups[0].kind, 'TEXT CLIPPED');
  });
  const seq = []; const d = await inventoryToFile(fakePage(seq), specOf(), { url: 'https://x.test/' });
  check('inventoryToFile: top of the page, 600 ms, presence → clip → units, back to where the page was, 300 ms; the file is the inventory + its spec', () => {
    assert.deepEqual(seq, ['scrollY', 'scrollTo 0', 'wait 600', 'presence', 'clip', 'unit .card', 'scrollTo 1234', 'wait 300']);
    const f = JSON.parse(readFileSync(join(hookDir, 'inv.json'), 'utf8'));
    assert.deepEqual(f, JSON.parse(JSON.stringify(d)));
    assert.deepEqual(Object.keys(f), ['url', 'side', 'at', 'docH', 'tier', 'settle', 'status', 'settlePasses', 'pageW', 'root', 'items', 'clip', 'textBoxes', 'units', 'spec']);
    assert.equal(f.tier, 'chrome'); assert.equal(f.settle, 'stitch'); assert.equal(f.status, null); assert.equal(f.side, 'origin'); assert.equal(f.docH, 3000);
    assert.deepEqual(f.units, { n: 2, bySel: { '.card': { sel: '.card', matches: 1, units: [] } } }); assert.deepEqual(f.spec.units, { sels: ['.card'], n: 2 });
  });
  const seq2 = []; const e = await inventoryToFile(fakePage(seq2, { fail: 'clipInventoryInPage' }), specOf({ side: 'eds' }), { url: 'https://e.test/' });
  check('inventoryToFile: an in-page failure writes { url, side, at, error }, still scrolls back, never throws', () => {
    assert.deepEqual(Object.keys(e), ['url', 'side', 'at', 'error']); assert.match(e.error, /clipInventoryInPage exploded/); assert.equal(e.side, 'eds');
    assert.deepEqual(seq2.slice(-2), ['scrollTo 1234', 'wait 300']);
    assert.deepEqual(JSON.parse(readFileSync(join(hookDir, 'inv.json'), 'utf8')), JSON.parse(JSON.stringify(e)));
  });
  const u = await inventoryToFile(fakePage([]), join(hookDir, 'missing.json'), { url: 'https://x.test/' });
  check('inventoryToFile: an unreadable spec returns { error } and writes nothing', () => { assert.ok(u.error); assert.deepEqual(readdirSync(hookDir).filter((f) => f.startsWith('missing')), []); });
})();
rmSync(hookDir, { recursive: true, force: true });

let playwright = true;
try { await import('playwright'); } catch { playwright = false; }
if (!playwright) console.log('skip  e2e --origin-cache (playwright not importable here)');
else {
  const acheck = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
  const PAGE = (extra) => `<!doctype html><html><body style="margin:0;font:16px Arial"><header><a href="/">Home</a></header><main><h1>Offers</h1><p>Weekly offers for every store.</p><a href="/a">All offers</a>${extra}</main><footer>f</footer></body></html>`;
  const hits = {};
  const server = createServer((req, res) => { const p = req.url.split('?')[0]; hits[p] = (hits[p] || 0) + 1; res.setHeader('content-type', 'text/html'); res.end(p === '/origin' ? PAGE('<a href="/b">Store finder</a>') : p === '/blank' ? '<!doctype html><html><body></body></html>' : PAGE('')); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cwd = mkdtempSync(join(tmpdir(), 'content-presence-cache-'));
  const cache = join(cwd, 'o.json');
  const run = (args, origin = 'origin') => new Promise((done) => {
    const ch = spawn(process.execPath, [SCRIPT, `${base}/${origin}`, `${base}/eds`, '--plain', '--width', '900', '--settle-passes', '1', '--origin-cache', cache, ...args], { cwd, env: { ...process.env, STARDUST_ORIGIN_MAX_AGE_H: '1' } });
    let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err }));
  });
  let first = null;
  await acheck('e2e: run 1 measures the origin once and writes the cache; run 2 reads it — 0 new origin requests, same totals, policy recorded', async () => {
    const r1 = await run(['--json', join(cwd, 'c1.json')]);
    assert.equal(r1.code, 2, r1.err); assert.equal(hits['/origin'], 1); assert.ok(existsSync(cache), r1.out);
    assert.match(r1.out, /origin side measured \(cache: absent\)/);
    first = JSON.parse(readFileSync(join(cwd, 'c1.json'), 'utf8'));
    assert.equal(first._provenance.originCache, null);
    const doc = JSON.parse(readFileSync(cache, 'utf8'));
    assert.equal(doc.writtenBy, 'content-presence.mjs'); assert.equal(doc.at, first.origin.at, 'the cache carries the probe time');
    const r2 = await run(['--json', join(cwd, 'c2.json')]);
    assert.equal(r2.code, 2, r2.err); assert.equal(hits['/origin'], 1, 'no origin request on a cache hit'); assert.equal(hits['/eds'], 2, 'the served side is always measured');
    assert.match(r2.out, /origin side from cache .*o\.json \(probed .*, max-age 1h\)/);
    const second = JSON.parse(readFileSync(join(cwd, 'c2.json'), 'utf8'));
    assert.deepEqual(second.totals, first.totals); assert.equal(second.totals.missingLinks, 1);
    assert.deepEqual(second._provenance.originCache, { file: cache, at: first.origin.at, policy: 'max-age 1h' });
  });
  await acheck('e2e: run 3 with another --main is a key mismatch — the origin is measured again and the cache rewritten', async () => {
    const r3 = await run(['--main', 'body', '--json', join(cwd, 'c3.json')]);
    assert.ok(r3.code === 0 || r3.code === 2, r3.err); assert.equal(hits['/origin'], 2);
    assert.match(r3.out, /origin side measured \(cache: key mismatch \(rootSel\)\)/);
    assert.equal(JSON.parse(readFileSync(cache, 'utf8')).key.rootSel, 'body');
  });
  await acheck('e2e: a blank origin render (200, nothing rendered) is measured but never cached — the next run measures it again', async () => {
    const blankCache = join(cwd, 'blank.json');
    const r4 = await run(['--origin-cache', blankCache], 'blank');
    assert.equal(r4.code, 0, r4.err); assert.match(r4.out, /origin side measured \(cache: absent\) — not cached \(blank render\)/);
    assert.equal(existsSync(blankCache), false);
    const r5 = await run(['--origin-cache', blankCache], 'blank');
    assert.match(r5.out, /origin side measured \(cache: absent\) — not cached/); assert.equal(hits['/blank'], 2);
  });
  server.close(); rmSync(cwd, { recursive: true, force: true });

  // ---- C8 symmetry: the inventory of one fixture page taken standalone (inventorySide) equals the one stitch-shot
  // --inventory takes in its own load; the hook changes no pixel (same stitch without it).
  const STITCH = ['../../../replica/scripts/stitch-shot.mjs', '../../replica/stitch-shot.mjs'].map((x) => resolve(HERE, x)).find((x) => existsSync(x));
  let PNG = null; try { ({ PNG } = await import('pngjs')); } catch { PNG = null; }
  if (!STITCH || !PNG) console.log(`skip  e2e symmetry (${!STITCH ? 'stitch-shot.mjs not found next to the diff scripts' : 'pngjs not importable here'})`);
  else {
    const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:16px/22px Arial} header{position:fixed;top:0;left:0;right:0;height:60px;background:#222;z-index:2} header a{color:#fff}
      main{padding:80px 40px 40px} section{height:1200px} img{display:block;width:400px;height:200px;margin:20px 0}
      .card{position:relative;width:355px;height:238px;overflow:hidden;box-shadow:0 0 2px #999;margin:40px 0}
      .card-body{padding:12px;overflow:hidden;height:170px} .desc{margin:0;height:30px;overflow:hidden} .details{margin:160px 0 0}
    </style></head><body><header><a href="/">Home</a> <a href="/shop">Shop</a></header><main><h1>Fixture offers</h1><p>Intro text for the fixture page.</p><a href="/all">All offers</a>
      <section><h2>Below the fold</h2><img loading="lazy" src="/img/a.svg" alt="first"><img loading="lazy" src="/img/b.svg" alt="second"></section>
      <div class="card"><div class="card-body"><p class="desc">First line of the description<br>second line cut mid-glyph by the 30px box<br>third</p><p class="details"><a href="/d">View details</a></p></div></div>
      <div class="card"><div class="card-body"><h3>Card two</h3><p>Body two</p></div></div>
    </main><footer><a href="/legal">Legal</a></footer></body></html>`;
    const SVG = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="${c}"/></svg>`;
    const srv = createServer((req, res) => {
      const p = req.url.split('?')[0];
      if (p.startsWith('/img/')) { res.setHeader('content-type', 'image/svg+xml'); res.end(SVG(p.includes('a.svg') ? '#c33' : '#3c3')); return; }
      res.setHeader('content-type', 'text/html'); res.end(FIXTURE);
    });
    await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
    const url = `http://127.0.0.1:${srv.address().port}/fixture`;
    const wd = mkdtempSync(join(tmpdir(), 'content-presence-sym-'));
    const units = { sels: ['.card'], n: 2 };
    const spec = join(wd, 'spec.json');
    writeFileSync(spec, JSON.stringify({ out: join(wd, 'inv.json'), side: 'origin', presence: { rootSel: null, variableSels: [], countWords: null, moreWords: null, minCut: 2 }, clip: { minCut: 2, maxFindings: 400, moreWords: null }, units }));
    const stitch = (args) => new Promise((done) => {
      const ch = spawn(process.execPath, [STITCH, url, ...args, '--width', '1440', '--settle', '--locale', 'en-US'], { cwd: wd });
      let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err }));
    });
    const pick = (x) => x.items.map(({ kind, text, state, inChrome, x: px, y, w, h }) => ({ kind, text, state, inChrome, x: px, y, w, h }));
    await acheck('e2e symmetry: standalone inventorySide and stitch-shot --inventory read the same items, clip counts and unit geometry; the hook changes no pixel', async () => {
      const { chromium } = await import('playwright');
      const { openBrowser } = await import('../measure-live.mjs');
      const browser = await openBrowser(chromium, { tier: 'plain' });
      let a; try { a = await inventorySide(browser, url, { width: 1440, locale: 'en-US', warmup: null, rootSel: null, variableSels: [], minCut: 2, units }); } finally { await browser.close(); }
      const [withInv, without] = await Promise.all([stitch([join(wd, 's.png'), '--inventory', spec]), stitch([join(wd, 'plain.png')])]);
      assert.equal(withInv.code, 0, withInv.err); assert.equal(without.code, 0, without.err);
      const b = JSON.parse(readFileSync(join(wd, 'inv.json'), 'utf8'));
      assert.equal(b.error, undefined, b.error); assert.equal(b.settle, 'stitch'); assert.equal(b.tier, 'chromium');
      assert.ok(a.items.some((x) => x.kind === 'image' && x.text === 'second'), 'the lazy images below the fold are loaded standalone');
      assert.ok(a.items.some((x) => x.inChrome), 'the fixed header is chrome');
      assert.deepEqual(pick(b), pick(a)); assert.deepEqual(b.clip.counts, a.clip.counts); assert.ok(a.clip.counts.controlHidden >= 1, 'the cut card link');
      assert.deepEqual(b.units.bySel, a.units.bySel); assert.equal(a.units.bySel['.card'].units.length, 2);
      const p1 = PNG.sync.read(readFileSync(join(wd, 's.png'))); const p2 = PNG.sync.read(readFileSync(join(wd, 'plain.png')));
      assert.deepEqual([p1.width, p1.height], [p2.width, p2.height]); assert.ok(p1.data.equals(p2.data), 'identical pixels with and without the hook');
    });
    srv.close(); rmSync(wd, { recursive: true, force: true });
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
