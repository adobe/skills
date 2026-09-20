#!/usr/bin/env node
// wave.test stub for served-check.mjs: records the URL it was pointed at; exit 1 for URLs listed in park.json liveFail[].
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const T = process.env.WAVE_T; const url = process.argv[2];
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'live-gate', url })}\n`);
const cfg = JSON.parse(readFileSync(join(T, 'park.json'), 'utf8'));
process.exit((cfg.liveFail || []).some((u) => url.includes(u)) ? 1 : 0);
