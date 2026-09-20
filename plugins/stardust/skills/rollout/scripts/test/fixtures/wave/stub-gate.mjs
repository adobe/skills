#!/usr/bin/env node
// wave.test stub: the local gate. Exit 124 (no verdict) for slugs in $WAVE_T/park.json gate124[]; sleeps for gateSleep[] (real deadline); records the call.
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const T = process.env.WAVE_T; const slug = process.argv[2];
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'local-gate', slug })}\n`);
const cfg = JSON.parse(readFileSync(join(T, 'park.json'), 'utf8'));
if ((cfg.gate124 || []).includes(slug)) process.exit(124);
if ((cfg.gateSleep || []).includes(slug)) setTimeout(() => process.exit(0), 5000);
else process.exit(0);
