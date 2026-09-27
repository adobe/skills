#!/usr/bin/env node
// skills/stardust/scripts/plan-check.mjs — supervisor at routing and on resume (#127): is the proposed
// next step legal for this run's flow and state? Builds the state from stardust/state.json, the last
// ledger lines and the rollout / migrate unit ledgers, names the legal steps for the flow, and runs the
// `plan-vs-flow` battery. Code owns the legal-step table; the model matches the proposal to it.
//
//   node plan-check.mjs "<proposed next step>" [--dir stardust] [--mode off|shadow|assist|gate] [--json]
//
// Output: `plan-check [<mode>]: <step> (P) · out-of-order P · wrong-flow P · from-memory P` and a REVIEW
// suffix when out-of-order, wrong-flow or from-memory is ≥ 0.8 or the step is `none`. Exit 0 always
// except gate mode with a REVIEW (exit 2: re-read the ledger before acting); off / no key → skip, exit 0.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IS_MAIN = !!(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// The legal steps per flow, by name with one line each — the caller's flow table (master skill § Two
// migration flows, replica Phase 5 / handoff contract § 3). `read-state` is legal from every state.
export const LEGAL = {
  common: { 'read-state': 'read the ledger, state.json and unit ledgers; report status', 'qa-sweep': 'run the QA sweep on the live site (read-only)', 'audit': 'score a URL (read-only)' },
  replica: { 'extract-prep': 'extract the site with --prep (first phase; re-run only with a stated reason)', 'preserve-direction': 'mechanical promotion of the captured spec, register, dynamics triage', 'recreate-archetype': 'author one archetype prototype per page type', 'gate-archetype': 'run the source-fidelity gate rounds on an archetype (both breakpoints)', 'deploy-foundation': 'C0: author and deploy the foundation, gate it, freeze', 'deploy-archetype': 'C-archetype: convert, PUT, preview and gate-all --only a gated archetype before its siblings', 'migrate-siblings': "render a template's siblings after its C-archetype unit is done", 'deliver-cluster': 'C1…Cn: deliver a cluster of rendered siblings, gate rows after PUT', 'rollout-gate-all': 'the roster gate-all unit and update-coverage --gate', 'assemble-site': 'sitemap, redirects, verify --origin', 'dynamics-implement': 'dynamics Phases 4–5 for self rows; owner batch for the rest' },
  redesign: { 'extract-prep': 'extract the site with --prep', 'direct-prep': 'resolve the intent into PRODUCT.md / DESIGN.md', 'prototype-prep': 'one archetype prototype per page type through the craft loop', 'migrate': 'apply canon and modules to every page', 'deploy-foundation': 'C0', 'deploy-archetype': 'C-archetype', 'deliver-cluster': 'C1…Cn', 'rollout-gate-all': 'roster gate-all', 'assemble-site': 'sitemap, redirects, verify' },
  reskin: { 'extract-prep': 'extract the site', 'reskin': 'map content onto the donor design system', 'migrate': 'render every page', 'deploy-foundation': 'C0', 'deliver-cluster': 'C1…Cn', 'rollout-gate-all': 'roster gate-all' },
};

const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export function buildRun(dir) {
  const st = readJSON(join(dir, 'state.json')) || {};
  const pages = Array.isArray(st.pages) ? st.pages : st.pages ? Object.values(st.pages) : [];
  const counts = {}; for (const p of pages) counts[p.status || 'unknown'] = (counts[p.status || 'unknown'] || 0) + 1;
  const units = {};
  for (const f of ['rollout/progress.json', 'migrate/progress.json']) { const j = readJSON(join(dir, f)); if (j && j.units) for (const [k, v] of Object.entries(j.units)) units[`${f.split('/')[0]}:${k}`] = v && v.status ? v.status : String(v); }
  let lastLedger = [];
  if (existsSync(join(dir, 'status.jsonl'))) lastLedger = readFileSync(join(dir, 'status.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-6).map((l) => { try { const j = JSON.parse(l); return `${j.skill} ${j.phase} ${j.event}${j.detail ? ` — ${String(j.detail).slice(0, 120)}` : ''}`; } catch { return null; } }).filter(Boolean);
  const flow = st.flow || null;
  const gatedArchetypes = pages.filter((p) => p.status === 'approved' || p.status === 'migrated').length;
  return { flow, handsOff: !!st.handsOff, decider: st.decider || null, phaseSummary: Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no pages', pages: pages.length, gatedArchetypes, units, lastLedger };
}
export const legalFor = (flow) => ({ ...LEGAL.common, ...(LEGAL[flow] || { ...LEGAL.replica, ...LEGAL.redesign }) });

async function main() {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const proposal = argv.find((a) => !a.startsWith('--') && ![val('--dir'), val('--mode')].includes(a));
  if (!proposal) { console.error('plan-check: needs "<proposed next step>"'); return 2; }
  const dir = resolve(val('--dir') || 'stardust');
  const D = await import(join(HERE, 'decide.mjs'));
  let mode = 'off'; try { mode = D.normaliseMode(val('--mode')) || D.wiredMode(); } catch (e) { console.error(`plan-check: ${e.message}`); return 2; }
  if (mode === 'off') { console.log('plan-check: decider off — route on the flow table yourself'); return 0; }
  const key = process.env[D.DEFAULTS.keyEnv]; if (!key) { console.log(`plan-check: no $${D.DEFAULTS.keyEnv} — not checked`); return 0; }
  const run = buildRun(dir); const legal = legalFor(run.flow);
  const battery = D.loadBattery('plan-vs-flow'); const client = D.createClient({ key, concurrency: 1, retries: 2 });
  let r; try { r = await D.decide({ battery, state: { proposal, run, legal }, client, cacheDir: join(dir, '.work', 'decide'), ledger: join(dir, 'decisions.jsonl'), ref: `plan:${proposal.slice(0, 40)}`, mode, runId: D.resolveRunId(null, dirname(dir)) }); } catch (e) { console.log(`plan-check: not checked (${e.message})`); return 0; }
  const a = r.answers; const P = (q) => (a[q] ? a[q].noul : 0);
  const review = P('out_of_order') >= 0.8 || P('wrong_flow') >= 0.8 || P('resume_from_memory') >= 0.8 || a.step.choice === 'none';
  if (argv.includes('--json')) { console.log(JSON.stringify({ mode, flow: run.flow, step: a.step.choice, confidence: a.step.confidence, outOfOrder: P('out_of_order'), wrongFlow: P('wrong_flow'), fromMemory: P('resume_from_memory'), review })); return mode === 'gate' && review ? 2 : 0; }
  console.log(`plan-check [${mode}] (flow ${run.flow || 'unset'}): ${a.step.choice} (${a.step.confidence.toFixed(2)}) · out-of-order ${P('out_of_order').toFixed(2)} · wrong-flow ${P('wrong_flow').toFixed(2)} · from-memory ${P('resume_from_memory').toFixed(2)}${review ? ' → REVIEW: re-read the ledger and the flow table before acting' : ''}`);
  return mode === 'gate' && review ? 2 : 0;
}
if (IS_MAIN) main().then((c) => process.exit(c)).catch((e) => { console.error(`plan-check: ${e.message}`); process.exit(0); });
