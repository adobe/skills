#!/usr/bin/env node
// skills/stardust/scripts/brief-check.mjs — supervisor before a fan-out (#127): does a subagent brief
// carry what the phase's checklist requires? Runs the `brief-check` battery (one noul per item) over the
// brief text and prints the missing items; code decides, the model reads. Save the brief to a file first
// (stardust/.work/briefs/<name>.md is the convention), check, then dispatch.
//
//   node brief-check.mjs <brief.md|-> [--phase archetype|deploy|cluster|foundation|other]
//                        [--require a,b,c] [--mode off|shadow|assist|gate] [--json]
//
// Items: names_owned_paths, carries_gate_commands, cites_contract_sections, requires_ledger_lines,
// forbids_shortcuts, bounded_scope. --require narrows the blocking set (default: every item except
// forbids_shortcuts, which is advisory). An item is missing when P(present) ≤ 0.3, present when ≥ 0.8,
// unsure otherwise. Output: one line `brief-check [<mode>]: <n> item(s) missing — a, b · unsure — c`,
// then one line per item with its P. Exit: 0 when nothing required is missing; 2 in gate mode when a
// required item is missing (the dispatch should not happen); off / no key → one skip line, exit 0.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IS_MAIN = !!(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
export const ITEMS = ['names_owned_paths', 'carries_gate_commands', 'cites_contract_sections', 'requires_ledger_lines', 'forbids_shortcuts', 'bounded_scope'];
export const DEFAULT_REQUIRED = ITEMS.filter((i) => i !== 'forbids_shortcuts');
export const PRESENT = 0.8; export const MISSING = 0.3;

export function classify(answers, required) {
  const missing = []; const unsure = []; const present = [];
  for (const id of ITEMS) { const a = answers[id]; if (!a) continue; const p = a.noul; if (p <= MISSING) missing.push(id); else if (p >= PRESENT) present.push(id); else unsure.push(id); }
  return { missing, unsure, present, blocking: missing.filter((m) => required.includes(m)) };
}

async function main() {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const file = argv.find((a) => !a.startsWith('--') && ![val('--phase'), val('--require'), val('--mode')].includes(a));
  if (!file) { console.error('brief-check: needs <brief.md|->'); return 2; }
  let brief; try { brief = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8'); } catch (e) { console.error(`brief-check: cannot read ${file}: ${e.message}`); return 2; }
  const phase = val('--phase') || 'other'; const required = val('--require') ? val('--require').split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_REQUIRED;
  const D = await import(join(HERE, 'decide.mjs'));
  let mode = 'off'; try { mode = D.normaliseMode(val('--mode')) || D.wiredMode(); } catch (e) { console.error(`brief-check: ${e.message}`); return 2; }
  if (mode === 'off') { console.log('brief-check: decider off — dispatch on your own reading of the brief'); return 0; }
  const key = process.env[D.DEFAULTS.keyEnv]; if (!key) { console.log(`brief-check: no $${D.DEFAULTS.keyEnv} — not checked`); return 0; }
  const battery = D.loadBattery('brief-check'); const client = D.createClient({ key, concurrency: 1, retries: 2 });
  let r; try { r = await D.decide({ battery, state: { brief: brief.slice(0, 12000), phase, checklist: ITEMS }, client, cacheDir: 'stardust/.work/decide', ledger: 'stardust/decisions.jsonl', ref: `brief:${file === '-' ? 'stdin' : file}`, mode, runId: D.resolveRunId(null) }); } catch (e) { console.log(`brief-check: not checked (${e.message})`); return 0; }
  const c = classify(r.answers, required);
  if (argv.includes('--json')) { console.log(JSON.stringify({ mode, phase, ...c, answers: Object.fromEntries(ITEMS.map((i) => [i, r.answers[i] ? r.answers[i].noul : null])) })); return mode === 'gate' && c.blocking.length ? 2 : 0; }
  console.log(`brief-check [${mode}]: ${c.missing.length} item(s) missing${c.missing.length ? ` — ${c.missing.join(', ')}` : ''}${c.unsure.length ? ` · unsure — ${c.unsure.join(', ')}` : ''}${c.blocking.length && mode === 'gate' ? ' → do not dispatch' : ''}`);
  for (const id of ITEMS) if (r.answers[id]) console.log(`  ${(c.missing.includes(id) ? 'missing' : c.unsure.includes(id) ? 'unsure ' : 'present').padEnd(8)} ${r.answers[id].noul.toFixed(2)}  ${id}`);
  return mode === 'gate' && c.blocking.length ? 2 : 0;
}
if (IS_MAIN) main().then((c) => process.exit(c)).catch((e) => { console.error(`brief-check: ${e.message}`); process.exit(0); });
