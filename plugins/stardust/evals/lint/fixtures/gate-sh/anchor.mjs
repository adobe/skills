#!/usr/bin/env node
// STUB anchor for the gate.sh fixture runner: prints the --json shape of the
// real probe without a browser. Env: STUB_LIVE_DOC, STUB_LIVE_SECTIONS,
// STUB_ANCHOR_EXIT. Refuses --cache (the drift probe must be a fresh hit).
const rest = process.argv.slice(2);
if (rest.includes('--cache')) { console.error('stub anchor: --cache must not be used for the drift probe'); process.exit(1); }
const exit = Number(process.env.STUB_ANCHOR_EXIT || 0);
if (exit) process.exit(exit);
const url = rest[0];
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
const doc = Number(process.env.STUB_LIVE_DOC || 3000);
const n = Number(process.env.STUB_LIVE_SECTIONS || 4);
const sections = Array.from({ length: n }, (_, i) => ({ label: `s${i}`, box: [i * 600, 600] }));
const out = { url, width: Number(opt('--width', 1440)), main: 'main', doc, rootMissing: false, rootWrapsChrome: false, sections, footer: [doc - 300, 300] };
console.log(rest.includes('--json') ? JSON.stringify(out, null, 2) : `doc height ${doc}px`);
