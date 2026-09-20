#!/usr/bin/env node
// wave.test stub: a per-page hard stage. Exit 1 (a P1) for slugs listed in $WAVE_T/park.json lintFail[]; records the call.
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const T = process.env.WAVE_T; const slug = process.argv[2];
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'lint', slug })}\n`);
const cfg = JSON.parse(readFileSync(join(T, 'park.json'), 'utf8'));
if ((cfg.lintFail || []).includes(slug)) { console.error(`P1 link-absolute: 2 findings on ${slug}`); process.exit(1); }
process.exit(0);
