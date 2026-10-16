#!/usr/bin/env node
// skills/diff/scripts/test/clip-probe.test.mjs — the clip-probe.mjs contract (#125 D1). Part (a), no browser:
// summarize groups findings by kind + clipper + parent and keeps advisory kinds apart, formatTable hides advisory
// rows unless asked, verdictLine, parseArgs, --help in an empty cwd. Part (b), where playwright is importable:
// a fixture page served from this process — a 238 px card with overflow:hidden whose description is cut
// mid-line and whose "View details" link sits below the box (the recorded card defect), a line-clamped
// paragraph (advisory only), a collapsed mega-menu (max-height 0 — must not count), an sr-only span (must not
// count), a horizontal carousel track (advisory only), a "Read more" collapsible (advisory TEXT COLLAPSED) — and
// a clean page (exit 0). --hide: parseArgs (repeatable comma lists), a missing value is a usage error, clipReport's
// `hidden` key; e2e: an 88 px in-flow .geo-bar holding a clipped paragraph counts without --hide and not with it.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipReport, formatTable, parseArgs, summarize, verdictLine } from '../clip-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'clip-probe.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const runAsync = (args, cwd) => new Promise((done) => { const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd }); let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err })); });

const findings = [
  { kind: 'CONTROL HIDDEN', path: 'div.card-body > p.details > a', text: 'view details', clipper: 'div.card-body', cut: 20 },
  { kind: 'CONTROL HIDDEN', path: 'div.card-body > p.details > a', text: 'view details', clipper: 'div.card-body', cut: 20 },
  { kind: 'TEXT CLIPPED', path: 'div.card-body > p.desc', text: 'multi use offer', clipper: 'div.card-body', cut: 4 },
  { kind: 'TEXT CLIPPED', path: 'div.card-body > p.desc', text: 'valid online', clipper: 'div.card-body', cut: 9 },
  { kind: 'TEXT CLAMPED', advisory: true, path: 'div.card > p.brand', text: 'neutrogena', clipper: 'p.brand' },
];
await check('summarize groups by kind + clipper + parent, counts, cut range, advisory last', () => {
  const g = summarize(findings);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map((x) => [x.kind, x.n]), [['CONTROL HIDDEN', 2], ['TEXT CLIPPED', 2], ['TEXT CLAMPED', 1]]);
  assert.equal(g[1].cutMin, 4); assert.equal(g[1].cutMax, 9); assert.equal(g[2].advisory, true); assert.equal(g[2].cutMin, null);
});
await check('formatTable hides advisory rows by default and shows them with { advisory: true }', () => {
  const g = summarize(findings);
  assert.ok(!formatTable(g).includes('CLAMPED'));
  assert.ok(formatTable(g, { advisory: true }).includes('CLAMPED'));
  assert.ok(formatTable(g).includes('×2'));
  assert.equal(formatTable([]), '  (none)');
});
await check('verdictLine names every counter', () => {
  const l = verdictLine({ total: 3, textClipped: 1, textHidden: 0, controlHidden: 2, controlClipped: 0, clamped: 4, scrollHidden: 0, horizontal: 1 });
  assert.ok(l.startsWith('Clipped: 3')); assert.ok(l.includes('controls hidden 2')); assert.ok(l.includes('clamped 4'));
});
await check('parseArgs: url, flags, --json with and without a file', () => {
  const o = parseArgs(['node', 'x', 'https://a.test/', '--width', '360', '--json', 'out.json', '--min-cut', '3', '--advisory']);
  assert.equal(o.url, 'https://a.test/'); assert.equal(o.width, 360); assert.equal(o.jsonFile, 'out.json'); assert.equal(o.minCut, 3); assert.equal(o.advisory, true);
  const p = parseArgs(['node', 'x', 'https://a.test/', '--json', '--plain']);
  assert.equal(p.json, true); assert.equal(p.jsonFile, null); assert.equal(p.plain, true);
});
await check('--help exits 0 with the usage and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'clip-probe-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node clip-probe\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  assert.match(r.stdout, /^ {2}--hide <sel,…> /m);
  rmSync(cwd, { recursive: true, force: true });
});
await check('--hide: repeatable comma lists, trimmed, de-duplicated in order (default none); a missing value is a usage error (exit 1)', () => {
  assert.deepEqual(parseArgs(['node', 'x', 'https://a.test/']).hide, []);
  const o = parseArgs(['node', 'x', 'https://a.test/', '--hide', '.geo-bar, .location-bar', '--width', '360', '--hide', '.location-bar,,.promo-strip']);
  assert.deepEqual(o.hide, ['.geo-bar', '.location-bar', '.promo-strip']); assert.equal(o.width, 360); assert.equal(o.url, 'https://a.test/');
  for (const tail of [['--hide'], ['--hide', '--plain']]) {
    const r = spawnSync(process.execPath, [SCRIPT, 'https://a.test/', ...tail], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 1, tail.join(' ')); assert.match(r.stderr, /^--hide needs a selector list/);
  }
});
// The CLI's --json keys, in order (gate-all --one-load writes clip.json with clipReport from a stitch's inventory).
const CLI_KEYS = ['url', 'at', 'width', 'status', 'settlePasses', 'docH', 'pageW', 'counts', 'findings', 'textBoxes', 'groups', 'tier'];
await check('clipReport: the CLI JSON object for one inventory — same keys in the same order, groups summarised, time and tier as given', () => {
  const inv = { docH: 900, pageW: 1440, counts: { total: 2 }, findings, textBoxes: [{ x: 0, y: 0, w: 10, h: 10 }] };
  const r = clipReport(inv, { url: 'https://e.test/', width: 1440, status: null, settlePasses: null, tier: 'chrome', at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(Object.keys(r), CLI_KEYS);
  assert.deepEqual(r.groups, summarize(findings)); assert.equal(r.at, '2026-01-01T00:00:00.000Z'); assert.equal(r.tier, 'chrome'); assert.equal(r.counts.total, 2);
  assert.ok(Date.parse(clipReport(inv, { url: 'u', width: 1 }).at) > 0, 'at defaults to now');
  const hidden = [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }];
  const h = clipReport(inv, { url: 'u', width: 1, tier: 'chrome', hidden });
  assert.deepEqual(Object.keys(h), [...CLI_KEYS, 'hidden'], 'hide records are one last key'); assert.deepEqual(h.hidden, hidden);
});

let playwright = true;
try { await import('playwright'); } catch { playwright = false; }
if (!playwright) { console.log('skip  end-to-end (playwright not importable here)'); }
else {
  const BROKEN = `<!doctype html><html><head><style>
    body{margin:0;font:16px/22px Arial} main{padding:40px}
    .card{position:relative;width:355px;height:238px;overflow:hidden;box-shadow:0 0 2px #999;margin:40px 0}
    .card-body{padding:12px;overflow:hidden;height:170px}
    .desc{margin:0;height:30px;overflow:hidden}
    .details{margin:160px 0 0}
    .clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:200px}
    .menu{max-height:0;overflow:hidden}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    .track{width:300px;overflow:hidden;white-space:nowrap} .track span{display:inline-block;width:280px}
  </style></head><body><header><nav><a href="/a">Home</a><div class="menu"><a href="/b">Hidden menu link</a><p>collapsed menu text that must not count</p></div></nav></header>
  <main><h1>Cards</h1>
    <div class="card"><div class="card-body"><p class="desc">First line of the description<br>second line of the description is cut mid-glyph by the 30px box<br>third</p><p class="details"><a href="/d">View details</a></p></div></div>
    <p class="clamp">A long clamped paragraph that keeps going and going until the second line ends and a third line is hidden by the clamp, which is design, not a defect.</p>
    <p>Visible paragraph <span class="sr-only">screen reader only</span>.</p>
    <div class="track"><span>slide one</span><span>slide two off to the right</span></div>
    <div class="menu" style="max-height:44px"><p style="margin:0">Collapsed accordion first line<br>second line<br>third line behind the toggle</p></div><button aria-expanded="false">Read more</button>
  </main></body></html>`;
  const CLEAN = '<!doctype html><html><body style="margin:0;font:16px Arial"><main><h1>Clean</h1><p>All visible text.</p><a href="/x">A link</a><button>A button</button></main></body></html>';
  // an 88 px in-flow per-visitor bar above the content whose 30 px paragraph cuts its second line and hides its third
  const GEO = '<!doctype html><html><body style="margin:0;font:16px/22px Arial"><div class="geo-bar" style="height:88px;overflow:hidden;background:#eee"><p style="margin:0;height:30px;overflow:hidden">You seem to be in another region<br>switch to the local site for local offers<br>third line</p></div><main style="min-height:1500px"><h1>Clean</h1><p>All visible text.</p><a href="/x">A link</a></main></body></html>';
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url.startsWith('/clean') ? CLEAN : req.url.startsWith('/geo') ? GEO : BROKEN); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cwd = mkdtempSync(join(tmpdir(), 'clip-probe-e2e-'));
  await check('e2e: the broken card counts one hidden control + one clipped line + one hidden line; clamp / menu / sr-only / carousel do not count (exit 2)', async () => {
    const r = await runAsync([`${base}/broken`, '--json', '--plain', '--width', '900'], cwd);
    assert.equal(r.code, 2, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.counts.controlHidden, 1, JSON.stringify(j.findings));
    assert.equal(j.counts.textClipped, 1, 'the second line is cut mid-glyph by p.desc');
    assert.equal(j.counts.textHidden, 1, 'the third line (its own text node after <br>) is wholly hidden by p.desc — no clamp');
    assert.equal(j.counts.total, 3);
    assert.equal(j.counts.clamped, 1);
    assert.ok(j.counts.horizontal >= 1, 'carousel slide is a horizontal advisory');
    assert.equal(j.counts.collapsed, 1, 'lines behind a "Read more" collapsible are advisory TEXT COLLAPSED');
    assert.ok(j.findings.some((f) => f.kind === 'TEXT COLLAPSED'));
    assert.ok(!j.findings.some((f) => /collapsed menu|hidden menu/i.test(f.text)), 'collapsed menu must not be reported');
    assert.ok(!j.findings.some((f) => /screen reader/i.test(f.text)), 'sr-only must not be reported');
    assert.ok(j.textBoxes.length > 3, 'visible text line boxes are emitted for --text-boxes');
    assert.deepEqual(Object.keys(j), CLI_KEYS, 'the CLI JSON is clipReport\'s object');
    assert.ok(!j.textBoxes.some((b) => b.h <= 1), 'no sr-only boxes among the text boxes');
  });
  await check('e2e: a clean page exits 0 with Clipped: 0', async () => {
    const r = await runAsync([`${base}/clean`, '--plain', '--width', '900'], cwd);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /Clipped: 0 /);
  });
  await check('e2e --hide: the clipped lines inside an 88 px in-flow .geo-bar count without --hide (no hidden line) and not with it; the hidden line and JSON hidden record it', async () => {
    const without = await runAsync([`${base}/geo`, '--plain', '--width', '900'], cwd);
    assert.equal(without.code, 2, without.err); assert.match(without.out, /^Clipped: 2 \(text clipped 1, text hidden 1,/m, without.out);
    assert.doesNotMatch(without.out, /^hidden:/m);
    const json = join(cwd, 'geo.json');
    const r = await runAsync([`${base}/geo`, '--plain', '--width', '900', '--hide', '.geo-bar', '--json', json], cwd);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /^Clipped: 0 /m, r.out);
    assert.match(r.out, /^hidden: \.geo-bar ×1 \(88px\) \[--hide\]$/m, r.out);
    assert.ok(r.out.indexOf('hidden:') > r.out.indexOf('clip-probe '), 'after the header line');
    const j = JSON.parse(readFileSync(json, 'utf8'));
    assert.deepEqual(j.hidden, [{ sel: '.geo-bar', source: '--hide', n: 1, h: 88 }]); assert.deepEqual(Object.keys(j), [...CLI_KEYS, 'hidden']);
    const docH = (out) => Number((out.match(/ — docH (\d+),/) || [])[1]);
    assert.equal(docH(without.out) - docH(r.out), 88, 'the page is 88 px shorter without the bar'); assert.equal(j.docH, docH(r.out));
  });
  server.close(); rmSync(cwd, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
