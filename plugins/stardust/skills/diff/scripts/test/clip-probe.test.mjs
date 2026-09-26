#!/usr/bin/env node
// skills/diff/scripts/test/clip-probe.test.mjs — the clip-probe.mjs contract (#125 D1). Part (a), no browser:
// summarize groups findings by kind + clipper + parent and keeps advisory kinds apart, formatTable hides advisory
// rows unless asked, verdictLine, parseArgs, --help in an empty cwd. Part (b), where playwright is importable:
// a fixture page served from this process — a 238 px card with overflow:hidden whose description is cut
// mid-line and whose "View details" link sits below the box (the recorded card defect), a line-clamped
// paragraph (advisory only), a collapsed mega-menu (max-height 0 — must not count), an sr-only span (must not
// count), a horizontal carousel track (advisory only), a "Read more" collapsible (advisory TEXT COLLAPSED) — and
// a clean page (exit 0). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTable, parseArgs, summarize, verdictLine } from '../clip-probe.mjs';

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
  rmSync(cwd, { recursive: true, force: true });
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
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url.startsWith('/clean') ? CLEAN : BROKEN); });
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
    assert.ok(!j.textBoxes.some((b) => b.h <= 1), 'no sr-only boxes among the text boxes');
  });
  await check('e2e: a clean page exits 0 with Clipped: 0', async () => {
    const r = await runAsync([`${base}/clean`, '--plain', '--width', '900'], cwd);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /Clipped: 0 /);
  });
  server.close(); rmSync(cwd, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
