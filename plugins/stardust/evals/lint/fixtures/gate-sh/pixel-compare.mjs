#!/usr/bin/env node
// STUB pixel-compare for the gate.sh fixture runner: emits the real summary
// shape to --json-out; no pixelmatch. Env: STUB_PCT, STUB_HDELTA, STUB_DIFFPX,
// STUB_BAND0, STUB_COMPARE_EXIT (forces the exit code, e.g. 124), STUB_PREFLIGHT_FAIL, STUB_MASKS (JSON
// masks[] in the real shape: kind/class/label/spec|sel|src/areaPct/side/asymmetric).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const [a, b, ...rest] = process.argv.slice(2);
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
// STUB_PREFLIGHT_FAIL: the real script's preflightExit — a dependency did not resolve → one stderr line, exit 2, NO --json-out
if (process.env.STUB_PREFLIGHT_FAIL) { console.error("pixel-compare.mjs: cannot resolve 'pngjs' — run node skills/stardust/scripts/preflight-runtime.mjs"); process.exit(2); }
const forced = Number(process.env.STUB_COMPARE_EXIT || 0);
if (forced === 124) process.exit(124);
const pct = Number(process.env.STUB_PCT || 5);
const pass = pct <= 10;
const summary = { a, b, compared: { width: 1440, height: 3000 }, heightDelta: Number(process.env.STUB_HDELTA || 0), differingPixels: Number(process.env.STUB_DIFFPX || 1000),
  pct, pixelPct: pct, pixelPctUnmasked: pct, threshold: 10, pass, diff: opt('--out', 'diff.png'), masks: process.env.STUB_MASKS ? JSON.parse(process.env.STUB_MASKS) : [], maskedRows: 0,
  bands: [{ y0: 0, y1: 500, pct: Number(process.env.STUB_BAND0 || 0.1) }, { y0: 500, y1: 1000, pct: 0.0 }, { y0: 1000, y1: 1500, pct: 0.2 }] };
const jo = opt('--json-out', null);
if (jo) { mkdirSync(dirname(jo), { recursive: true }); writeFileSync(jo, `${JSON.stringify(summary, null, 2)}\n`); }
console.log(`${pass ? 'PASS' : 'FAIL'} — pixel diff ${pct}% (threshold 10%)`);
process.exit(forced || (pass ? 0 : 2));
