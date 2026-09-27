#!/usr/bin/env node
/**
 * skills/extract/scripts/type-pages.mjs — the decision layer at extract prep § 2 (page typing, #127).
 * After the agent has typed the roster (state.json pages[].type), run the `page-type` battery over
 * every captured page with the same evidence the eval measured: the page's path, title, description,
 * headings and counts, and per type the paths + lead heading of up to --examples other pages of that
 * type (archetypes first). Both answers land in stardust/decisions.jsonl and in the page's roll-up
 * (state.json pages[].decisions["page-type"]); a summary goes to stardust/current/_page-types.json.
 *
 *   node type-pages.mjs [--dir stardust] [--only a,b] [--examples 3] [--concurrency 6]
 *                       [--mode off|shadow|assist|gate] [--dry-run] [--json]
 *
 * Mode: --mode, else $STARDUST_DECIDER, else off. off → one skip line, exit 0 (the agent's types stand).
 * shadow → the agent's type is the --agent answer; a confident disagreement (≥ 0.9) marks the page
 * `review` in the summary; nothing else changes. assist → pages without a type get Jev's proposal in the
 * summary for the agent to confirm; typed pages behave as shadow. gate is treated as assist here (the
 * battery earned assist, not gate — evals/jev-batteries/BASELINE.md).
 * Never blocks: no key → skip line, exit 0; a failed call is counted and reported, exit 0. --dry-run
 * prints the first built state and exits 0 without calling anything.
 * Exit codes: 0 · 2 usage (missing state.json or pages dir).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const IS_MAIN = !!(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (IS_MAIN && (argv.includes('--help') || argv.includes('-h'))) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8'); const m = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(m ? m[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'usage: type-pages.mjs'); process.exit(0);
}
// Sibling-skill imports in both layouts: the plugin tree (skills/extract/scripts → skills/stardust/scripts)
// and a project copy (stardust/scripts/extract → stardust/scripts/stardust).
async function sibling(name) {
  for (const c of [join(HERE, '..', '..', 'stardust', 'scripts', name), join(HERE, '..', 'stardust', name)]) if (existsSync(c)) return import(c);
  throw new Error(`${name} not found beside this script (copy skills/stardust/scripts/ to stardust/scripts/stardust/)`);
}

export function parseArgs(args) {
  const o = { dir: 'stardust', only: null, examples: 3, concurrency: 6, mode: null, dryRun: false, json: false };
  const val = (f, v) => { if (v === undefined || v.startsWith('--')) { console.error(`${f} needs a value`); process.exit(2); } return v; };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dir') o.dir = val(a, args[++i]);
    else if (a === '--only') o.only = val(a, args[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--examples') o.examples = Number(val(a, args[++i]));
    else if (a === '--concurrency') o.concurrency = Number(val(a, args[++i]));
    else if (a === '--mode') o.mode = val(a, args[++i]);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else { console.error(`unknown flag ${a}`); process.exit(2); }
  }
  return o;
}

const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const clip = (s, n) => { if (typeof s !== 'string') return s; const cp = Array.from(s); return cp.length > n ? `${cp.slice(0, n).join('')}…` : s; };
export const pagesOf = (state) => { const p = state && state.pages; return Array.isArray(p) ? p : p && typeof p === 'object' ? Object.values(p) : []; };

// One page's state for the battery, from its captured JSON. `types` = every type on the roster, each
// with the paths + lead heading of up to `n` OTHER pages of that type, archetypes (prototypePath) first.
export function buildState(page, cap, pages, n = 3) {
  let path = page.slug; try { path = new URL((cap && (cap.finalUrl || cap.url)) || page.url).pathname; } catch { /* slug */ }
  const headings = ((cap && cap.headings) || []).slice(0, 14).map((h) => ({ tag: h.tag, text: clip(h.text, 100) }));
  const body = cap && cap.body; const words = typeof body === 'string' ? body.split(/\s+/).length : Array.isArray(body) ? body.join(' ').split(/\s+/).length : null;
  const types = [...new Set(pages.map((p) => p.type).filter(Boolean))].sort();
  const typeOptions = Object.fromEntries(types.map((t) => {
    const others = pages.filter((o) => o.type === t && o.slug !== page.slug).sort((a, b) => (b.prototypePath ? 1 : 0) - (a.prototypePath ? 1 : 0)).slice(0, n)
      .map((o) => { let op = o.slug; try { op = new URL(o.url).pathname; } catch { /* slug */ } const h1 = o._h1 || null; return h1 ? `${op} — "${clip(h1, 60)}"` : op; });
    return [t, others.length ? { examples: others } : null];
  }));
  return { page: { path, title: clip(cap && cap.title, 160), description: clip(cap && cap.description, 300), headings, counts: { ctas: ((cap && cap.ctas) || []).length, links: ((cap && cap.links) || []).length, images: ((cap && cap.media) || []).length, words }, signals: cap && cap._signals ? clip(JSON.stringify(cap._signals), 600) : undefined }, types: typeOptions };
}

async function main() {
  const o = parseArgs(argv);
  const dir = resolve(o.dir);
  const stateFile = join(dir, 'state.json'); const pagesDir = join(dir, 'current', 'pages');
  if (!existsSync(stateFile)) { console.error(`type-pages: ${stateFile} not found`); return 2; }
  if (!existsSync(pagesDir)) { console.error(`type-pages: ${pagesDir} not found — run extract first`); return 2; }
  const D = await sibling('decide.mjs'); const S = await sibling('state.mjs');
  let mode = 'off'; try { mode = D.normaliseMode(o.mode) || D.wiredMode(); } catch (e) { console.error(`type-pages: ${e.message}`); return 2; }
  if (mode === 'gate') mode = 'assist';
  if (mode === 'off') { console.log('type-pages: decider off — the agent\'s types stand (set STARDUST_DECIDER=shadow to compare)'); return 0; }
  const state = readJSON(stateFile); const pages = pagesOf(state).filter((p) => p && p.slug);
  // lead headings for the examples come from the captures, once
  for (const p of pages) { const c = readJSON(join(pagesDir, `${p.slug}.json`)); const h1 = c && (c.headings || []).find((h) => h.tag === 'h1'); p._h1 = h1 ? h1.text : null; p._cap = c; }
  const distinct = [...new Set(pages.map((p) => p.type).filter(Boolean))];
  if (distinct.length < 2) { console.log(`type-pages: ${distinct.length} type(s) on the roster — nothing to decide between`); return 0; }
  const targets = pages.filter((p) => !o.only || o.only.includes(p.slug));
  if (o.dryRun) { const t = targets[0]; console.log(JSON.stringify({ mode, pages: targets.length, sample: t ? buildState(t, t._cap, pages, o.examples) : null }, null, 2)); return 0; }
  const key = process.env[D.DEFAULTS.keyEnv];
  if (!key) { console.log(`type-pages: no $${D.DEFAULTS.keyEnv} — skipped, the agent's types stand`); return 0; }
  const battery = D.loadBattery('page-type');
  const client = D.createClient({ key, concurrency: o.concurrency });
  const ledger = join(dir, 'decisions.jsonl'); const cacheDir = join(dir, '.work', 'decide');
  const runId = D.resolveRunId(null, dirname(dir));
  const out = {}; let agree = 0; let withAgent = 0; let errors = 0; const review = []; const routes = { act: 0, review: 0, escalate: 0 };
  const t0 = Date.now();
  await Promise.all(targets.map(async (p) => {
    const st = buildState(p, p._cap, pages, o.examples);
    try {
      const r = await D.decide({ battery, state: st, client, cacheDir, ledger, ref: p.slug, mode, agent: p.type ? { type: p.type } : null, runId });
      const a = r.answers.type;
      out[p.slug] = { agent: p.type || null, jev: a.choice, confidence: a.confidence, route: r.route.questions.type ? r.route.questions.type.verdict : r.route.overall, review: !!(r.shadow && r.shadow.review), localeShell: r.answers.locale_shell ? r.answers.locale_shell.noul : null };
      routes[r.route.overall] = (routes[r.route.overall] || 0) + 1;
      if (p.type) { withAgent += 1; if (r.agreement && r.agreement.type) agree += 1; }
      if (r.shadow && r.shadow.review) review.push(`${p.slug} (${p.type} → ${a.choice} ${a.confidence.toFixed(2)})`);
      try { S.recordDecision(state, p.slug, { battery: 'page-type', jev: a.choice, agent: p.type || null, confidence: a.confidence, route: out[p.slug].route }); } catch { /* roll-up is best effort */ }
    } catch (e) { errors += 1; out[p.slug] = { agent: p.type || null, error: e.message }; }
  }));
  // roll-up: write state.json through the state writer (atomic, ordered); the ledger already has every line
  try { for (const p of pages) { delete p._h1; delete p._cap; } S.writeState(stateFile, state); } catch (e) { console.error(`type-pages: state.json roll-up not written: ${e.message}`); }
  mkdirSync(join(dir, 'current'), { recursive: true });
  writeFileSync(join(dir, 'current', '_page-types.json'), JSON.stringify({ _provenance: { writtenBy: 'stardust:extract/type-pages', writtenAt: new Date().toISOString(), mode, runId }, pages: out }, null, 2));
  const untyped = targets.filter((p) => !p.type).length;
  const line = `type-pages [${mode}]: ${targets.length} page(s) in ${Math.round((Date.now() - t0) / 100) / 10}s · jev agrees ${agree}/${withAgent}${withAgent ? ` (${Math.round((agree / withAgent) * 100)}%)` : ''} · route act ${routes.act} / review ${routes.review} / escalate ${routes.escalate} · confident disagreements ${review.length}${untyped ? ` · proposals for ${untyped} untyped page(s)` : ''}${errors ? ` · errors ${errors}` : ''} → ${join(o.dir, 'current', '_page-types.json')}`;
  console.log(o.json ? JSON.stringify({ mode, pages: targets.length, agree, withAgent, routes, review, errors, out }) : line);
  if (!o.json && review.length) console.log(`  review: ${review.slice(0, 12).join('; ')}${review.length > 12 ? ` … +${review.length - 12}` : ''}`);
  return 0;
}

if (IS_MAIN) main().then((c) => process.exit(c)).catch((e) => { console.error(`type-pages: ${e.message}`); process.exit(2); });
