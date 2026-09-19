#!/usr/bin/env node
// STUB stitch-shot for the gate.sh fixture runner (evals/lint/gate-sh-fixtures.mjs).
// Writes a minimal PNG + the provenance sidecar the real instrument writes;
// no browser. Controlled by env: STUB_DOC (docHeight), STUB_CAPTURED_AT,
// STUB_STITCH_EXIT, STUB_STITCH_PARTIAL (write the PNG, no sidecar, THEN exit
// STUB_STITCH_EXIT — a capture that died mid-stitch), STUB_STITCH_VERSION
// (sidecar instrument.version; default = INSTRUMENT.version below). The sidecar also records --block / --allow-consent /
// --expect-height so the runner can assert live.png and live-b.png took the same flags.
//
// INSTRUMENT is deliberately declared MULTI-LINE: gate.sh reads the current
// procedure version from this declaration, and a reformat of the real
// instrument must not turn its stale-procedure check off silently (defect
// fixture — the old single-line grep read nothing here).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const INSTRUMENT = {
  name: 'stitch-shot',
  version: '3',
};

const [url, out, ...rest] = process.argv.slice(2);
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
const width = Number(opt('--width', 1440));
const mode = opt('--consent-mode', 'accept');
const exit = Number(process.env.STUB_STITCH_EXIT || 0);
if (exit && !process.env.STUB_STITCH_PARTIAL) process.exit(exit);
mkdirSync(dirname(out), { recursive: true });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(25)]);
png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(width, 16); png.writeUInt32BE(Number(process.env.STUB_DOC || 3000), 20);
writeFileSync(out, png);
if (exit) process.exit(exit); // STUB_STITCH_PARTIAL: the PNG is on disk, the sidecar is not
writeFileSync(`${out}.json`, `${JSON.stringify({
  url, width, vh: 900, dpr: 1, capturedAt: process.env.STUB_CAPTURED_AT || new Date().toISOString(),
  instrument: { name: INSTRUMENT.name, version: process.env.STUB_STITCH_VERSION || INSTRUMENT.version, options: { settle: rest.includes('--settle') } },
  consent: { mode, via: 'none-detected' }, dismissed: [], fontsFailed: [],
  // the flags pixel-compare refuses an asymmetric pair on / gate.sh must pass to BOTH live captures
  blocked: opt('--block', '').split(',').filter(Boolean), allowConsent: rest.includes('--allow-consent'), expectHeight: opt('--expect-height', null),
  docHeight: Number(process.env.STUB_DOC || 3000), chunks: 4, source: 'stitch-shot', technique: 'headless', tier: 1,
}, null, 2)}\n`);
console.log(`stub stitch-shot: ${out}`);
