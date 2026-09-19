#!/usr/bin/env node
/**
 * Fixture test for the header claims of skills/diff/scripts/live-budget.mjs (no browser, no network).
 * Run: node skills/diff/scripts/test/live-budget.test.mjs [--help]
 *
 * The header once named qa's paced browse and rollout verify as importers; neither imports the
 * module (qa paces through qa/scripts/lib.mjs's limiter, verify retries inline) — a reader copying
 * the module "for qa" would have found nothing to wire. Asserts:
 *   the header's `Importers:` line equals the set of skills/** scripts that import live-budget.mjs
 *   (a static `from '…live-budget.mjs'` or a dynamic `import(…live-budget.mjs…)`; comment lines,
 *   strings without an import and *.test.mjs files do not count);
 *   every name in the header's `Exports (…):` list is exported, and importing runs nothing
 *   (no stardust/ file or directory is created by the import).
 * Exit: 0 all assertions pass · 1 an assertion failed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv.includes('--help')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, '')); process.exit(0); }

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(here, '..', '..', '..');
const MODULE = join(here, '..', 'live-budget.mjs');
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

const header = readFileSync(MODULE, 'utf8').split('*/')[0];
const claimed = ((header.match(/^\s*\*\s*Importers:\s*(.+)$/m) || [])[1] || '').split(/[,\s]+/).filter(Boolean).sort();
eq('header carries an Importers: line', claimed.length > 0, true);

const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (f === 'node_modules') continue; if (statSync(p).isDirectory()) walk(p, out); else if (f.endsWith('.mjs') && !f.endsWith('.test.mjs') && p !== MODULE) out.push(p); } return out; };
const IMPORT_LINE = /(\bimport\s*\(|\bfrom\s*['"]).*live-budget\.mjs/;
const actual = walk(SKILLS).filter((p) => readFileSync(p, 'utf8').split('\n').some((line) => { const t = line.trim(); return !t.startsWith('*') && !t.startsWith('//') && IMPORT_LINE.test(t); }))
  .map((p) => `skills/${relative(SKILLS, p)}`).sort();
eq('Importers: line equals the scripts that actually import live-budget.mjs', claimed, actual);
eq('qa and rollout do not import it (they pace on their own)', actual.filter((p) => /^skills\/(qa|rollout)\//.test(p)), []);

const before = existsSync(join(process.cwd(), 'stardust'));
const mod = await import(pathToFileURL(MODULE).href);
const exportsClaim = ((header.match(/Exports \([^)]*\):\s*([\s\S]*?)\./) || [])[1] || '').replace(/^\s*\*\s*/gm, '').split(/[,\s]+/).filter(Boolean);
eq('header lists exports', exportsClaim.length > 0, true);
eq('every claimed export exists', exportsClaim.filter((n) => !(n in mod)), []);
eq('importing runs nothing (no stardust/ created by the import)', existsSync(join(process.cwd(), 'stardust')), before);

if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('live-budget header claims: all assertions pass');
