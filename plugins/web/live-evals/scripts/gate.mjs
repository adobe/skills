#!/usr/bin/env node
// Usage: gate.mjs <skill> <promptfoo-output.json>
// Exits 0 when the runs in the file meet the skill's floor (pass rate within the latency budget).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const [skill, file] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { floor } = parse(readFileSync(join(root, 'skills', skill, 'skill.yaml'), 'utf-8'));
const runs = JSON.parse(readFileSync(file, 'utf-8')).results.results;
const good = runs.filter((r) => r.success && (r.latencyMs ?? 0) / 1000 <= floor.max_latency_s).length;
const rate = runs.length ? good / runs.length : 0;
console.log(`baseline: ${good}/${runs.length} within floor (${Math.round(rate * 100)}%, need ${floor.min_pass_rate * 100}%)`);
process.exit(rate >= floor.min_pass_rate ? 0 : 1);
