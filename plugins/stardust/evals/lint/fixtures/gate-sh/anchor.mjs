#!/usr/bin/env node
// STUB anchor for the gate.sh fixture runner: prints the --json shape of the
// real probe without a browser. Env: STUB_LIVE_DOC, STUB_LIVE_SECTIONS,
// STUB_ANCHOR_EXIT, STUB_ANCHOR_TRACE (one line per LIVE HIT — a cache read is
// not a hit). --cache is honoured only with --landmarks (the landmark step):
// a cache with landmarks + matching key is read, one without is re-probed and
// rewritten (the real cache rule); a drift probe must never pass --cache.
// --against <json> [--json-out <file>] writes the paired-table shape.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const rest = process.argv.slice(2);
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
const url = rest[0];
const width = Number(opt('--width', 1440));
const landmarks = rest.includes('--landmarks') || rest.includes('--against');
const cache = opt('--cache', null);
if (cache && !landmarks) { console.error('stub anchor: --cache must not be used for the drift probe'); process.exit(1); }
const exit = Number(process.env.STUB_ANCHOR_EXIT || 0);
if (exit) process.exit(exit);
const key = { url, width, main: 'main' };
if (cache && existsSync(cache)) {
  const c = JSON.parse(readFileSync(cache, 'utf8'));
  if (JSON.stringify(c.key) === JSON.stringify(key) && c.data.landmarks) { console.log(`doc height ${c.data.doc}px  [from cache ${cache}]`); process.exit(0); }
  console.error(`stub anchor: --cache ${cache} has no landmarks (probed without --landmarks) — re-probing once and rewriting it`);
}
if (process.env.STUB_ANCHOR_TRACE) appendFileSync(process.env.STUB_ANCHOR_TRACE, `${url}\n`);
const doc = Number(process.env.STUB_LIVE_DOC || 3000);
const n = Number(process.env.STUB_LIVE_SECTIONS || 4);
const sections = Array.from({ length: n }, (_, i) => ({ label: `s${i}`, box: [i * 600, 600] }));
const out = { url, width, main: 'main', doc, rootMissing: false, rootWrapsChrome: false, sections, footer: [doc - 300, 300], ...(landmarks ? { landmarks: { rows: sections.map((s, i) => ({ key: `h2:${s.label}`, y: i * 600, h: 40, section: s.label })) } } : {}) };
if (cache) { mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify({ key, probedAt: new Date().toISOString(), data: out }, null, 2)); }
const against = opt('--against', null);
if (against) out.pair = { aUrl: url, aFile: against, rows: [], unpaired: [], firstDelta: null, clean: true };
const jo = opt('--json-out', null);
if (jo) { mkdirSync(dirname(jo), { recursive: true }); writeFileSync(jo, `${JSON.stringify(out, null, 2)}\n`); }
console.log(rest.includes('--json') ? JSON.stringify(out, null, 2) : `doc height ${doc}px`);
