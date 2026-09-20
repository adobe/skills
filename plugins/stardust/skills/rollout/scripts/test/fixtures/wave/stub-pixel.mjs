#!/usr/bin/env node
// wave.test stub: a project pixel gate (soft stage). Records the slug; always exits 0.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
appendFileSync(join(process.env.WAVE_T, 'calls.jsonl'), `${JSON.stringify({ stage: 'pixel', slug: process.argv[2] })}\n`);
