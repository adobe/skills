#!/usr/bin/env node
/**
 * skills/rollout/scripts/repair-queue.mjs — after the roster gate-all (#127): grade every failing row of
 * the all-pages table with the `repair-priority` battery (reader harm · scope · template-wide, from the
 * row's probe output as text) and write the repair order. Code weighs the three scores; the ordering is
 * advisory until the battery has a hand ranking in evals/jev-batteries/BASELINE.md.
 *
 *   node repair-queue.mjs [--gate stardust/replica/gates/all-1440] [--out stardust/rollout/repair-queue]
 *                         [--weights 0.6,0.25,0.15] [--mode off|shadow|assist|gate] [--concurrency 6] [--json]
 *
 * Reads <gate>/summary.json (rows with pass=false) and per row <gate>/<slug>/{content,clip,pixel}.json;
 * writes <out>.json (rows sorted by priority with harm / scope / template-wide, probabilities, reasons,
 * a `cosmetic` flag when harm rounds to 0 — an overrides.json candidate, never a silent skip) and <out>.md
 * (the queue as a table). Prints one summary line. Mode: --mode, else $STARDUST_DECIDER, else off (one
 * skip line, exit 0). Never blocks; a failed row is listed with its error and sorted last.
 * Exit codes: 0 · 2 usage (missing summary.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IS_MAIN = !!(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (IS_MAIN && (argv.includes('--help') || argv.includes('-h'))) { const src = readFileSync(fileURLToPath(import.meta.url), 'utf8'); const m = src.match(/\/\*\*[\s\S]*?\*\//); console.log(m ? m[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'usage'); process.exit(0); }
async function sibling(name) { for (const c of [join(HERE, '..', '..', 'stardust', 'scripts', name), join(HERE, '..', 'stardust', name)]) if (existsSync(c)) return import(c); throw new Error(`${name} not found beside this script`); }
const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export const HARM = ['cosmetic', 'degraded', 'broken in part', 'unusable'];

// One failing row → the battery's state, from the summary row and the per-page probe files.
export function rowState(gateDir, r) {
  const dir = join(gateDir, r.slug);
  const clip = readJSON(join(dir, 'clip.json')); const content = readJSON(join(dir, 'content.json')); const pixel = readJSON(join(dir, 'pixel.json'));
  const cs = (clip && clip.summary) || {};
  const missing = []; const hidden = []; const clippedTexts = [];
  if (content && Array.isArray(content.findings)) for (const f of content.findings) { const k = String(f.kind || ''); const t = `${k.toLowerCase().replace(/^(missing|hidden) /, '')}: ${(f.text || '').trim().slice(0, 60)}`; if (/^MISSING/.test(k)) missing.push(t); else if (/^HIDDEN/.test(k)) hidden.push(t); }
  if (clip) (function walk(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { for (const x of o) walk(x); return; } if (typeof o.text === 'string' && (o.kind || o.type || o.reason || o.clipped)) clippedTexts.push(String(o.text).trim().slice(0, 60)); for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v); })(clip.findings || clip.lines || clip.groups || clip);
  const c = r.content || {};
  return { row: { path: r.path || r.slug, template: r.template || null, tier: r.tier || null, pixelPct: r.pct, textPct: r.textPct ?? (pixel && pixel.textBoxPct) ?? null, heightDelta: r.heightDelta, clipped: { textClipped: cs.textClipped ?? r.clipped ?? 0, textHidden: cs.textHidden ?? 0, controlHidden: cs.controlHidden ?? 0, controlClipped: cs.controlClipped ?? 0 }, content: { missing: c.missing ?? missing.length, hidden: c.hidden ?? hidden.length, examples: [...missing, ...hidden].slice(0, 8) }, clippedExamples: [...new Set(clippedTexts)].slice(0, 6), reasons: r.reasons || [] } };
}

export function priorityOf(answers, weights = [0.6, 0.25, 0.15]) {
  const harm = answers.reader_harm; const scope = answers.scope; const tw = answers.template_wide;
  return Math.round(((harm.score / 3) * weights[0] + (scope.score / 2) * weights[1] + tw.noul * weights[2]) * 1000) / 1000;
}

export function toMarkdown(q) {
  const lines = [`# Repair queue — ${q.gate} (${q.failing} failing of ${q.total}; mode ${q.mode})`, '', 'Ordered by priority = 0.6 · reader harm + 0.25 · scope + 0.15 · template-wide, all from the probe output as text. `cosmetic` rows are overrides.json candidates: propose the override with the reasons, never skip silently.', '', '| # | path | template | pixel % | Δh | clipped | content missing/hidden | harm (P) | scope | template-wide | priority | flag |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  q.rows.forEach((r, i) => lines.push(r.error ? `| ${i + 1} | \`${r.path}\` | ${r.template || ''} | ${r.pct ?? ''} | ${r.heightDelta ?? ''} | | | error | | | | ${r.error} |` : `| ${i + 1} | \`${r.path}\` | ${r.template || ''} | ${r.pct} | ${r.heightDelta} | ${r.clipped.textClipped}/${r.clipped.controlClipped} | ${r.content.missing}/${r.content.hidden} | ${HARM[Math.round(r.harm)]} (${r.harmConfidence.toFixed(2)}) | ${r.scope.toFixed(1)} | ${r.templateWide.toFixed(2)} | ${r.priority.toFixed(3)} | ${r.cosmetic ? 'cosmetic → override candidate' : ''} |`));
  return lines.join('\n');
}

async function main() {
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const gateDir = resolve(val('--gate') || 'stardust/replica/gates/all-1440'); const out = resolve(val('--out') || 'stardust/rollout/repair-queue');
  const weights = (val('--weights') || '0.6,0.25,0.15').split(',').map(Number);
  const summary = readJSON(join(gateDir, 'summary.json'));
  if (!summary || !Array.isArray(summary.rows)) { console.error(`repair-queue: ${join(gateDir, 'summary.json')} not found or has no rows — run gate-all first`); return 2; }
  const D = await sibling('decide.mjs');
  let mode = 'off'; try { mode = D.normaliseMode(val('--mode')) || D.wiredMode(); } catch (e) { console.error(`repair-queue: ${e.message}`); return 2; }
  const failing = summary.rows.filter((r) => !r.pass);
  if (mode === 'off') { console.log(`repair-queue: decider off — ${failing.length} failing row(s) stay in the table's order`); return 0; }
  const key = process.env[D.DEFAULTS.keyEnv]; if (!key) { console.log(`repair-queue: no $${D.DEFAULTS.keyEnv} — not graded`); return 0; }
  const battery = D.loadBattery('repair-priority'); const client = D.createClient({ key, concurrency: Number(val('--concurrency') || 6) });
  const sd = dirname(dirname(dirname(gateDir))); // <stardust>/replica/gates/all-<w> → <stardust>
  const ledger = join(sd, 'decisions.jsonl'); const cacheDir = join(sd, '.work', 'decide'); const runId = D.resolveRunId(null, dirname(sd));
  const rows = [];
  await Promise.all(failing.map(async (r) => {
    const state = rowState(gateDir, r);
    try {
      const d = await D.decide({ battery, state, client, cacheDir, ledger, ref: r.slug, mode, runId });
      const harm = d.answers.reader_harm; const scope = d.answers.scope; const tw = d.answers.template_wide;
      rows.push({ slug: r.slug, path: r.path, template: r.template, tier: r.tier, pct: r.pct, heightDelta: r.heightDelta, clipped: state.row.clipped, content: state.row.content, reasons: r.reasons, harm: harm.score, harmConfidence: harm.confidence, harmProbabilities: harm.probabilities, scope: scope.score, templateWide: tw.noul, priority: priorityOf(d.answers, weights), cosmetic: Math.round(harm.score) === 0, route: d.route.overall });
    } catch (e) { rows.push({ slug: r.slug, path: r.path, template: r.template, pct: r.pct, heightDelta: r.heightDelta, error: e.message, priority: -1 }); }
  }));
  rows.sort((a, b) => b.priority - a.priority);
  const q = { _provenance: { writtenBy: 'stardust:rollout/repair-queue', writtenAt: new Date().toISOString(), mode, runId, weights }, gate: gateDir, total: summary.rows.length, failing: failing.length, mode, rows };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.json`, JSON.stringify(q, null, 2)); writeFileSync(`${out}.md`, toMarkdown(q));
  const ok = rows.filter((r) => !r.error); const dist = ok.reduce((m, r) => { const k = HARM[Math.round(r.harm)]; m[k] = (m[k] || 0) + 1; return m; }, {});
  if (argv.includes('--json')) { console.log(JSON.stringify({ mode, failing: failing.length, graded: ok.length, errors: rows.length - ok.length, harm: dist, top: ok.slice(0, 5).map((r) => r.path) })); return 0; }
  console.log(`repair-queue [${mode}]: ${ok.length}/${failing.length} failing row(s) graded${rows.length - ok.length ? ` · errors ${rows.length - ok.length}` : ''} · harm ${Object.entries(dist).map(([k, v]) => `${k} ${v}`).join(' / ')} · cosmetic ${ok.filter((r) => r.cosmetic).length} (override candidates) → ${out}.md`);
  return 0;
}
if (IS_MAIN) main().then((c) => process.exit(c)).catch((e) => { console.error(`repair-queue: ${e.message}`); process.exit(0); });
