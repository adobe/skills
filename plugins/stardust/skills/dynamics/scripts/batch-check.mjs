#!/usr/bin/env node
/**
 * skills/dynamics/scripts/batch-check.mjs — supervisor on the owner decision batch (#127): is the message
 * one batch that names every decision and the interim shipped? Runs the `decision-batch` battery over the
 * message and the pending rows of the inventory; prints the nouls and a REVIEW when the batch is not one
 * batch, does not name its decisions or does not say what ships meanwhile.
 *
 *   node batch-check.mjs <message.md|-> [--inventory stardust/dynamic-features.md] [--mode off|shadow|assist|gate] [--json]
 *
 * Exit 0; gate mode with a REVIEW exits 2 (rewrite the message before sending); off / no key → skip, exit 0.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IS_MAIN = !!(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
export function pendingFrom(md) { return [...md.matchAll(/\|\s*\d+\s*\|\s*([a-z0-9-]+)\s*\|[^\n]*\|\s*(needs-[a-z-]+)\s*\|/gi)].map((x) => `${x[1]} (${x[2]})`).slice(0, 20); }
async function sibling(name) { for (const c of [join(HERE, '..', '..', 'stardust', 'scripts', name), join(HERE, '..', 'stardust', name)]) if (existsSync(c)) return import(c); throw new Error(`${name} not found beside this script`); }

async function main() {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { const src = readFileSync(fileURLToPath(import.meta.url), 'utf8'); const m = src.match(/\/\*\*[\s\S]*?\*\//); console.log(m ? m[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'usage'); return 0; }
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const file = argv.find((a) => !a.startsWith('--') && ![val('--inventory'), val('--mode')].includes(a));
  if (!file) { console.error('batch-check: needs <message.md|->'); return 2; }
  let message; try { message = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8'); } catch (e) { console.error(`batch-check: cannot read ${file}: ${e.message}`); return 2; }
  const inv = val('--inventory') || 'stardust/dynamic-features.md'; const pending = existsSync(inv) ? pendingFrom(readFileSync(inv, 'utf8')) : [];
  const D = await sibling('decide.mjs');
  let mode = 'off'; try { mode = D.normaliseMode(val('--mode')) || D.wiredMode(); } catch (e) { console.error(`batch-check: ${e.message}`); return 2; }
  if (mode === 'off') { console.log('batch-check: decider off'); return 0; }
  const key = process.env[D.DEFAULTS.keyEnv]; if (!key) { console.log(`batch-check: no $${D.DEFAULTS.keyEnv} — not checked`); return 0; }
  const battery = D.loadBattery('decision-batch'); const client = D.createClient({ key, concurrency: 1, retries: 2 });
  let r; try { r = await D.decide({ battery, state: { message: message.slice(0, 8000), pending }, client, cacheDir: 'stardust/.work/decide', ledger: 'stardust/decisions.jsonl', ref: `batch:${file}`, mode, runId: D.resolveRunId(null) }); } catch (e) { console.log(`batch-check: not checked (${e.message})`); return 0; }
  const P = (q) => (r.answers[q] ? r.answers[q].noul : 0);
  const review = P('one_batch') < 0.5 || P('each_decision_named') < 0.5 || P('interim_recorded') < 0.5;
  if (argv.includes('--json')) { console.log(JSON.stringify({ mode, pending: pending.length, oneBatch: P('one_batch'), named: P('each_decision_named'), interim: P('interim_recorded'), coversPending: P('covers_pending'), review })); return mode === 'gate' && review ? 2 : 0; }
  console.log(`batch-check [${mode}]: one batch ${P('one_batch').toFixed(2)} · decisions named ${P('each_decision_named').toFixed(2)} · interim recorded ${P('interim_recorded').toFixed(2)} · covers ${pending.length} pending ${P('covers_pending').toFixed(2)}${review ? ' → REVIEW: send one batch that names every decision and what ships meanwhile' : ''}`);
  return mode === 'gate' && review ? 2 : 0;
}
if (IS_MAIN) main().then((c) => process.exit(c)).catch((e) => { console.error(`batch-check: ${e.message}`); process.exit(0); });
