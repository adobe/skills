#!/usr/bin/env node
// wave.test stub for crawl.mjs (the capture stage): ONE instrument at a time against the source host. Holds
// $WAVE_T/capture.lock for 150 ms; a second instance finding the lock is the overlap the hit-minimisation rule
// forbids → exit 1 (parks the page). Writes stardust/current/pages/<slug>.html. Records the call.
import { existsSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const T = process.env.WAVE_T; const argv = process.argv.slice(2);
const slug = String(argv[argv.indexOf('--url') + 1] || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'capture', slug, argv })}\n`);
const lock = join(T, 'capture.lock');
if (existsSync(lock)) { console.error(`capture overlap: another crawl holds ${lock} — one browser instrument at a time on the source host`); process.exit(1); }
writeFileSync(lock, String(process.pid));
await new Promise((r) => setTimeout(r, 150));
mkdirSync(join('stardust', 'current', 'pages'), { recursive: true });
writeFileSync(join('stardust', 'current', 'pages', `${slug}.html`), `<html><body><main><h1>${slug}</h1></main></body></html>`);
unlinkSync(lock);
process.exit(0);
