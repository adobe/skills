#!/usr/bin/env node
// wave.test stub for content-acceptance.mjs (Gate 7): writes stardust/migrated/_acceptance/<slug>.json with the verdict
// $WAVE_T/park.json asks for — contentFail[] → verdict fail, exit 2 · contentUnmeasured[] → verdict unmeasured, exit 1
// (no verdict) · else pass, exit 0. Records the call with the {migrated} target it was handed.
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const T = process.env.WAVE_T; const [slug, target] = process.argv.slice(2);
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'content', slug, target })}\n`);
const cfg = JSON.parse(readFileSync(join(T, 'park.json'), 'utf8'));
const verdict = (cfg.contentFail || []).includes(slug) ? 'fail' : (cfg.contentUnmeasured || []).includes(slug) ? 'unmeasured' : 'pass';
mkdirSync(join('stardust', 'migrated', '_acceptance'), { recursive: true });
writeFileSync(join('stardust', 'migrated', '_acceptance', `${slug}.json`), JSON.stringify({ slug, verdict, target, at: new Date().toISOString() }));
if (verdict === 'fail') { console.log(`🔴 ${slug}: fail — links: 3 → 2 (1 dropped)`); process.exit(2); }
if (verdict === 'unmeasured') { console.log(`? ${slug}: unmeasured — source sidecar missing`); process.exit(1); }
console.log(`✓ ${slug}: pass`); process.exit(0);
