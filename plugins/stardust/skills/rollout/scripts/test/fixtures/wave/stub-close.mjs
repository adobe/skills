#!/usr/bin/env node
// wave.test stub for the close steps (verify.mjs --paths / dashboard.mjs): records `{stage: <name>, argv}`; prints a SUMMARY
// line for verify; exit code from $WAVE_T/close-mode.json { <name>: <code> } (default 0) — a non-zero close step is logged, never a park.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const T = process.env.WAVE_T; const [name, ...argv] = process.argv.slice(2);
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: name, argv })}\n`);
const mode = existsSync(join(T, 'close-mode.json')) ? JSON.parse(readFileSync(join(T, 'close-mode.json'), 'utf8')) : {};
const code = mode[name] || 0;
if (name === 'verify') console.log(`SUMMARY verify ok=${code ? 0 : 1} failed=${code ? 1 : 0} exit=${code} details=stardust/rollout/waves/w1.verify/summary.json`);
process.exit(code);
