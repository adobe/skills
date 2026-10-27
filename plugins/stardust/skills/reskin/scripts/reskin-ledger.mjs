#!/usr/bin/env node
/**
 * skills/reskin/scripts/reskin-ledger.mjs — writes stardust/reskin/ledger.json from evidence, never by hand.
 *
 * The ledger is what reskin-preflight (the flow: reskin predicate) and migrate (the handoff gates it
 * merges into each sidecar) read. Gate verdicts come from the gate reports ("**Overall: PASS|FAIL**"),
 * the mobile-adapt audit is computed (static) or run (prototype's mobile-nav-audit.mjs, runtime), and
 * only the human judgments — the side-by-side eyeball and residual verdicts — are entered.
 *
 *   record <slug> [--stage prototype|migrated]
 *       prototype (default): reads <dir>/reskin/gates/<slug>/{dom-equality,slot-coverage,donor-probe}.md
 *       (or reskin/reports/<slug>-{content-gate,slot-coverage,donor-probe}.md), checks the page's
 *       prototype for the mobile-adapt static rules and runs <dir>/scripts/prototype/mobile-nav-audit.mjs
 *       on it. Sets pages[slug] = { status: gated|failing, gates, prototypeSha, … }. An approved or
 *       migrated page also lands in handoff.<type>.gates.<slug> (PASS gates only, migrate's input), and
 *       the type's first approved page becomes handoff.<type>.archetype with its tier record (D4: the
 *       gates it passed and the prototype gates reskin waives).
 *       M2 evidence: <dir>/.work/reskin/gates/<slug>/figma/summary.json (M2b figma-gate all, local) and
 *       …/deployed/summary.json (M2a deployed-gate all, preview) — their ledgerFragment becomes gates.figma /
 *       gates.deployed; without fresh evidence a fragment already in the ledger is kept. A Figma donor
 *       (reskin/curation-rules.json) with scripts/reskin/figma-gate.mjs installed and no figma fragment
 *       records figma.* NOT-RUN. Blocking: figma join/geometry/ramp; deployed content/tokens/parity/
 *       sanity/inherited/chrome and its figma re-run. A deployed.sanity or deployed.chrome residual is never
 *       accepted (M2a D7): a broken page or broken chrome is fixed, not waived.
 *       (f) evidence: <dir>/.work/reskin/gates/<slug>/exact/summary.json (figma-gate exact, Figma-only sites) —
 *       its ledgerFragment becomes gates.exact (blocking), kept from the ledger without fresh evidence.
 *       migrated: reads <dir>/reskin/gates/<slug>/migrated/*.md — the sibling gate on migrate's output —
 *       into pages[slug].migratedGates and handoff.<type>.siblings.<slug>.
 *   eyeball <slug> --verdict pass|fail [--note "…"]     the side-by-side donor judgment (Phase 5); pass is
 *       refused while the page's deployed.chrome fragment fails
 *   step10 <slug> --eyeball <v> --cls <n> --header <v> [--note "…"] [--by <who>]
 *       deploy's Step 10 receipts on the preview (reference/deployed-leg.md § The ledger) → gates.step10
 *       { eyeball, cls, header, verdict, note, by, at }: eyeball pass|fail, cls the measured CLS (< 0.1
 *       passes), header pass|fail|"n/a: <why>" (--header-toggle is an alias); any of them may be
 *       "unresolved: <why>" — NOT-RUN, plus a needs-owner residual on step10. verdict FAIL beats NOT-RUN
 *       beats PASS. `record` keeps an existing gates.step10.
 *   residual <slug> --gate <g> --cause <c> --verdict accepted|needs-owner|blocked [--note "…"] [--by <owner>]
 *       a header, footer or chrome gate (step10.header, footer, …) is accepted only with --by naming the site
 *       owner, never an agent; a hands-off run records it needs-owner. A residual class (RESIDUAL_CLASSES:
 *       --cause font.unserved on exact, figma.ramp, figma.pixel or deployed.tokens) may be accepted by an agent
 *       (it is not chrome); on exact only when the gate's recorded evidence carries that cause
 *   residual <slug> --gate <g> --cause <c> --remove [--by <who>] [--note "…"]
 *   residual <slug> --gate <g> --cause <c> --rename-cause <new> [--by <who>] [--note "…"]
 *       drop or rename the residual on <g> with cause <c> (exit 1 when there is none); each edit is appended to
 *       pages[slug].residualHistory { at, action, gate, cause, to?, by, note } — no hand edits of ledger.json
 *   show [<slug>]
 *
 * Exit 0 ok, 1 refused (missing page, report or prototype), 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `usage: node reskin-ledger.mjs <command> [args] [--dir stardust]

Writes stardust/reskin/ledger.json from evidence (gate reports, the mobile-adapt audit) plus the two
human judgments. reskin-preflight and migrate read it.

  record <slug> [--stage prototype|migrated]   gate verdicts → pages[slug], handoff.<type>
  eyeball <slug> --verdict pass|fail [--note "…"]   pass refused while deployed.chrome fails
  step10 <slug> --eyeball pass|fail --cls <n> --header pass|fail|"n/a: <why>" [--note "…"] [--by <who>]
      deploy's Step 10 receipts → gates.step10 (CLS < 0.1 passes; any value may be "unresolved: <why>",
      which records NOT-RUN and a needs-owner residual); --header-toggle is an alias of --header
  residual <slug> --gate <g> --cause <c> --verdict accepted|needs-owner|blocked [--note "…"] [--by <owner>]
      deployed.sanity and deployed.chrome are never accepted; a header, footer or chrome gate
      (step10.header, footer, …) is accepted only --by the site owner, never an agent; a residual
      class (--cause font.unserved; on --gate exact only when the recorded evidence names it)
  residual <slug> --gate <g> --cause <c> --remove | --rename-cause <new> [--by <who>] [--note "…"]
      drop or rename that residual (exit 1 when there is none); the edit is kept in residualHistory
  show [<slug>]

Exit 0 ok, 1 refused, 2 usage.`;

export const GATE_FILES = {
  'reskin-dom-equality': ['dom-equality.md', '-content-gate.md'],
  'reskin-slot-coverage': ['slot-coverage.md', '-slot-coverage.md'],
  'reskin-donor-probe': ['donor-probe.md', '-donor-probe.md'],
};
// Prototype gate-stack items a registered reskin page does not run (spec D4): the human waives them by
// approving; the tier record lists them so nobody reads `approved` as "the full prototype stack passed".
export const WAIVED = ['critique', 'audit', 'anti-template', 'content-sourcing', 'motion-validation'];
const VERDICTS = ['accepted', 'needs-owner', 'blocked'];

// M2 evidence. M2b (figma-gate all) and M2a (deployed-gate all) each write
// <dir>/.work/reskin/gates/<slug>/{figma,deployed}/summary.json with a ledgerFragment that lands in
// pages.<slug>.gates.figma / gates.deployed. Their values are 'PASS' | 'FAIL k/n' | 'ADVISORY …' |
// 'n/a: …' | 'not run: …' | 'CRASH: …'. Blocking families: figma B0 join, B1 geometry, B3 ramp (B2 pixel
// is advisory, B4 register informational); deployed A1 content … A5 inherited, plus its figma re-run.
export const M2_FAMILIES = { figma: ['join', 'geometry', 'ramp'], deployed: ['content', 'tokens', 'parity', 'sanity', 'inherited', 'chrome'] };
// A residual that may never be accepted (M2a D7: a deployed hard-sanity or chrome failure is fixed, not waived).
export const NEVER_ACCEPTED = ['deployed.sanity', 'deployed.chrome'];
// Every page inherits the chrome, so a header or footer residual is the site owner's to accept, never an agent's.
export const CHROME_GATE = /(^|\.)(header|footer|chrome|nav)(\b|$)/i;
export const AGENT = /\b(agents?|assistant|stardust|claude|codex|copilot|gpt[\w.-]*|gemini|bot|auto|autopilot|auto-mode|hands-off|ai)\b/i;
// Residual classes (reference/gates.md § Unserved donor font): the gates a cause applies to, and those whose recorded
// evidence must name it before it is accepted (by anyone, agent included: it is not chrome). font.unserved: a donor
// font the page renders from a fallback — UNSERVED in donor-probe/tokens and the ramp, served:false in pixel (never a
// FAIL there), and a figma-gate exact FAIL whose fragment cause names it (Figma rasterises the licensed font).
export const RESIDUAL_CLASSES = { 'font.unserved': { gates: ['exact', 'figma.ramp', 'figma.pixel', 'deployed.tokens', 'deployed.figma.ramp'], evidence: ['exact'], why: 'donor font not served: the Figma render and the page differ in glyphs' } };
export function classRefusal(ledger, slug, gate, cause) {
  const c = RESIDUAL_CLASSES[cause];
  if (!c) return null;
  if (!c.gates.includes(gate)) return `residual class ${cause} applies to gate ${c.gates.join(' | ')}, not ${gate}`;
  if (!c.evidence.includes(gate)) return null;
  const ev = ledger?.pages?.[slug]?.gates?.[gate];
  if (ev?.cause !== cause) return `the recorded ${gate} evidence does not name ${cause}${ev ? ` (${ev.detail || ev.verdict})` : ' (no evidence: run figma-gate exact, then record)'}`;
  return null;
}
export const ownerAccepted = (r) => r.verdict === 'accepted' && (!CHROME_GATE.test(r.gate || '') || (typeof r.by === 'string' && r.by.trim() !== '' && !AGENT.test(r.by)));
export function fragmentVerdict(v) {
  const s = typeof v === 'string' ? v : v?.verdict;
  if (s == null) return 'NOT-RUN';
  if (/^(PASS|ADVISORY|n\/a)/i.test(s)) return 'PASS';
  if (/^FAIL/i.test(s)) return 'FAIL';
  if (/^(not run|CRASH|ERROR|CHALLENGE)/i.test(s)) return 'NOT-RUN';
  return 'UNKNOWN';
}
// deploy's Step 10 receipts on the preview (deployed-leg.md § The ledger): { eyeball, cls, header }. A value
// "unresolved: <why>" is a check not run. FAIL (eyeball fail, CLS ≥ 0.1, header fail) beats NOT-RUN beats PASS.
export const CLS_MAX = 0.1;
const UNRESOLVED = /^unresolved:\s*\S/i;
export function step10Problems({ eyeball, cls, header } = {}) {
  const bad = []; const open = [];
  if (UNRESOLVED.test(String(eyeball ?? ''))) open.push('eyeball');
  else if (!['pass', 'fail'].includes(String(eyeball ?? '').toLowerCase())) bad.push(`eyeball must be pass|fail|"unresolved: <why>", got ${JSON.stringify(eyeball ?? null)}`);
  if (UNRESOLVED.test(String(cls ?? ''))) open.push('cls');
  else if (!/^\d+(\.\d+)?$/.test(String(cls ?? '').trim())) bad.push(`cls must be a number ≥ 0 or "unresolved: <why>", got ${JSON.stringify(cls ?? null)}`);
  if (UNRESOLVED.test(String(header ?? ''))) open.push('header');
  else if (!['pass', 'fail'].includes(String(header ?? '').toLowerCase()) && !/^n\/a:\s*\S/i.test(String(header ?? ''))) bad.push(`header must be pass|fail|"n/a: <why>"|"unresolved: <why>", got ${JSON.stringify(header ?? null)}`);
  return { bad, open };
}
export function step10Verdict(s = {}) {
  if (step10Problems(s).bad.length) return 'UNKNOWN';
  const fails = [/^fail$/i.test(s.eyeball) && 'eyeball fail', !UNRESOLVED.test(String(s.cls)) && Number(s.cls) >= CLS_MAX && `CLS ${s.cls} ≥ ${CLS_MAX}`, /^fail$/i.test(s.header) && 'header fail'].filter(Boolean);
  if (fails.length) return 'FAIL';
  return step10Problems(s).open.length ? 'NOT-RUN' : 'PASS';
}
const step10Detail = (s) => `eyeball ${s?.eyeball}, CLS ${s?.cls}, header ${s?.header}`;
// Flat [{ gate, verdict, detail? }] over reskin's own gates and the M2 fragments.
export function gateVerdicts(gates = {}) {
  const out = [];
  for (const [g, v] of Object.entries(gates || {})) {
    if (M2_FAMILIES[g]) {
      for (const f of M2_FAMILIES[g]) out.push({ gate: `${g}.${f}`, verdict: fragmentVerdict(v?.[f]), detail: v?.missing || (typeof v?.[f] === 'string' ? v[f] : undefined) });
      if (g === 'deployed' && v?.figma) for (const f of M2_FAMILIES.figma) out.push({ gate: `deployed.figma.${f}`, verdict: fragmentVerdict(v.figma[f]), detail: typeof v.figma[f] === 'string' ? v.figma[f] : undefined });
    } else if (g === 'step10' && v && typeof v === 'object') out.push({ gate: g, verdict: v.verdict ?? step10Verdict(v), detail: step10Detail(v) });
    else if (typeof v === 'string') out.push({ gate: g, verdict: fragmentVerdict(v), detail: v });
    else out.push({ gate: g, verdict: v?.verdict ?? 'UNKNOWN', detail: v?.detail });
  }
  return out;
}
// A residual names its family by gate or, as M2b's SKILL writes them, by class (figma.join|geometry|ramp,
// M2a's deployed.*); one on a figma family also covers the same family in the deployed re-run.
export const residualCovers = (r, gate) => {
  const keys = [r.gate, r.class].filter(Boolean);
  return keys.includes(gate) || (gate.startsWith('deployed.figma.') && keys.includes(gate.slice('deployed.'.length)));
};

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
export const overall = (md) => { const m = String(md || '').match(/\*\*Overall:\s*(PASS|FAIL)/i); return m ? m[1].toUpperCase() : null; };

// prototype SKILL § Mobile-adapt audit, the three rules that need no render. A narrow breakpoint is
// `@media (max-width: Npx)` or the range syntax `(width <= Npx)` / `(width < Npx)` (and `Npx >= width`),
// a `<` bound counting as N − 1px.
export function mediaMaxWidths(html) {
  const out = [];
  for (const m of String(html).matchAll(/@media([^{]*)\{/gi)) {
    const q = m[1];
    for (const x of q.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)) out.push(Number(x[1]));
    for (const x of q.matchAll(/\bwidth\s*(<=?)\s*(\d+(?:\.\d+)?)px/gi)) out.push(Number(x[2]) - (x[1] === '<' ? 1 : 0));
    for (const x of q.matchAll(/(\d+(?:\.\d+)?)px\s*(>=?)\s*width\b/gi)) out.push(Number(x[1]) - (x[2] === '>' ? 1 : 0));
  }
  return out;
}
export function mobileStatic(html) {
  const issues = [];
  const vp = String(html).match(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i);
  const content = vp && (vp[0].match(/content\s*=\s*["']([^"']*)/i) || [])[1];
  if (!content || !/width\s*=\s*device-width/i.test(content)) issues.push('viewport meta missing or not width=device-width');
  const widths = mediaMaxWidths(html);
  if (!widths.length) issues.push('no @media (max-width) / (width <= …) rule: desktop-only');
  else if (Math.min(...widths) > 640) issues.push(`narrowest max-width breakpoint is ${Math.min(...widths)}px; needs one at ≤640px`);
  return { pass: issues.length === 0, issues };
}

// Every gate PASS, or covered by an accepted residual (never a NEVER_ACCEPTED one; a chrome gate's only --by its owner).
export function gatesOk(gates, residuals = []) {
  const accepted = (g) => residuals.some((r) => residualCovers(r, g) && ownerAccepted(r) && !NEVER_ACCEPTED.includes(g));
  return gateVerdicts(gates).every(({ gate, verdict }) => verdict === 'PASS' || accepted(gate));
}

// Pure: the ledger with deploy's Step 10 receipts for one page in pages[slug].gates.step10. An unresolved
// check adds (or refreshes) a needs-owner residual on step10 (source "step10"); a record with none open
// drops that residual, never one entered with `residual`. A recorded page's status follows its gates.
export function applyStep10(ledger, { slug, eyeball, cls, header, note = null, by = null, at }) {
  const L = structuredClone(ledger || {}); L.pages ||= {};
  const entry = { ...(L.pages[slug] || {}) };
  const s = { eyeball: String(eyeball), cls: String(cls).trim(), header: String(header) };
  for (const k of ['eyeball', 'header']) if (/^(pass|fail)$/i.test(s[k])) s[k] = s[k].toLowerCase();
  const { open } = step10Problems(s);
  const step10 = { ...s, verdict: step10Verdict(s), note, by, at };
  const hadGates = !!entry.gates;
  entry.gates = { ...(entry.gates || {}), step10 };
  entry.residuals = (entry.residuals || []).filter((r) => !(r.gate === 'step10' && r.source === 'step10'));
  if (open.length) entry.residuals.push({ gate: 'step10', cause: open.map((k) => `${k} ${s[k]}`).join('; '), verdict: 'needs-owner', source: 'step10', note, at });
  if (hadGates && entry.status) entry.status = gatesOk(entry.gates, entry.residuals) ? 'gated' : 'failing';
  L.pages[slug] = entry;
  return L;
}

// Pure: the ledger after recording one stage for one page. reports: { gate: { verdict, report } };
// mobile: { static: {pass, issues}, runtime: {pass, detail} | null }.
export function applyRecord(ledger, { state, slug, stage = 'prototype', reports, mobile, prototypeSha, at, m2 = {} }) {
  const L = structuredClone(ledger || {}); L.pages ||= {}; L.handoff ||= {};
  const page = state.pages.find((p) => p.slug === slug);
  const entry = { ...(L.pages[slug] || {}) }; entry.residuals ||= []; entry.flags ||= [];
  const gates = { ...reports };
  if (stage === 'prototype' && mobile) {
    gates['mobile-adapt-static'] = { verdict: mobile.static.pass ? 'PASS' : 'FAIL', detail: mobile.static.issues.join('; ') || undefined };
    gates['mobile-adapt-runtime'] = mobile.runtime ? { verdict: mobile.runtime.pass ? 'PASS' : 'FAIL', detail: mobile.runtime.detail || undefined } : { verdict: 'NOT-RUN', detail: 'mobile-nav-audit.mjs not found or Playwright missing' };
  }
  if (stage === 'prototype') {
    // M2 fragments: fresh evidence wins, else what is already in the ledger (M2b's SKILL copies it by hand);
    // m2.figmaRequired (a Figma donor with figma-gate installed) makes a missing fragment NOT-RUN.
    const fig = m2.figma ?? entry.gates?.figma;
    if (fig) gates.figma = fig; else if (m2.figmaRequired) gates.figma = { missing: 'figma-gate all not run (Phase 5 (d))' };
    const dep = m2.deployed ?? entry.gates?.deployed;
    if (dep) gates.deployed = dep;
    const ex = m2.exact ?? entry.gates?.exact;
    if (ex) gates.exact = ex;
    // Step 10's receipts are entered with `step10`, never read from a report: a re-record keeps them.
    if (entry.gates?.step10) gates.step10 = entry.gates.step10;
  }
  const ok = gatesOk(gates, entry.residuals);
  if (stage === 'migrated') { entry.migratedGates = gates; entry.migratedStatus = ok ? 'gated' : 'failing'; } else {
    entry.gates = gates; entry.status = ok ? 'gated' : 'failing'; entry.prototypeSha = prototypeSha; entry.prototypePath = page.prototypePath || null;
  }
  entry.recordedAt = at; L.pages[slug] = entry;
  if (page.type && ['approved', 'migrated'].includes(page.status)) {
    const h = { ...(L.handoff[page.type] || {}) }; h.gates ||= {}; h.siblings ||= {};
    if (stage === 'prototype') {
      h.gates[slug] = Object.fromEntries(gateVerdicts(gates).filter((v) => v.verdict === 'PASS').map((v) => [v.gate, gates[v.gate]?.report ? `PASS — ${gates[v.gate].report}` : 'PASS']));
      if (!h.archetype || h.archetype === slug) {
        Object.assign(h, { archetype: slug, prototypePath: page.prototypePath || null, prototypeSha, registeredAt: at,
          tier: { claimed: 'reskin-archetype', passed: Object.keys(h.gates[slug]), waived: WAIVED } });
      }
    } else h.siblings[slug] = { gate: entry.migratedStatus, residuals: entry.residuals.map((r) => r.cause) };
    L.handoff[page.type] = h;
  }
  return L;
}

function parse(argv) {
  const o = { dir: 'stardust', pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--remove') o.remove = true;
    else if (['--dir', '--stage', '--verdict', '--note', '--gate', '--cause', '--by', '--rename-cause', '--eyeball', '--cls', '--header', '--header-toggle'].includes(a)) {
      const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); o[a === '--header-toggle' ? 'header' : a.slice(2)] = v;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.pos.push(a);
  }
  return o;
}
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);
function save(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; writeFileSync(t, `${JSON.stringify(v, null, 2)}\n`); renameSync(t, f); }

function findReports(dir, slug, stage) {
  const out = {}; const missing = [];
  if (stage === 'migrated') {
    const d = join(dir, 'reskin', 'gates', slug, 'migrated');
    for (const [g, [file]] of Object.entries(GATE_FILES)) {
      const f = join(d, file);
      if (existsSync(f)) out[g] = { verdict: overall(readFileSync(f, 'utf8')) || 'UNKNOWN', report: f }; else missing.push(f);
    }
    return { out, missing };
  }
  for (const [g, [file, suffix]] of Object.entries(GATE_FILES)) {
    const f = [join(dir, 'reskin', 'gates', slug, file), join(dir, 'reskin', 'reports', `${slug}${suffix}`)].find(existsSync);
    if (f) { out[g] = { verdict: overall(readFileSync(f, 'utf8')) || 'UNKNOWN', report: f }; continue; }
    // A Figma-sourced page has no source DOM: figma-text-gate stands in for dom-equality (SKILL.md Phase 5).
    const ft = g === 'reskin-dom-equality' && join(dir, 'reskin', 'gates', slug, 'figma-text.json');
    if (ft && existsSync(ft)) {
      let v; try { v = JSON.parse(readFileSync(ft, 'utf8')).verdict; } catch { v = null; }
      out[g] = { verdict: ['PASS', 'FAIL'].includes(v) ? v : 'UNKNOWN', report: ft };
      continue;
    }
    missing.push(`${join(dir, 'reskin', 'gates', slug, file)} (or reports/${slug}${suffix}${g === 'reskin-dom-equality' ? `, or figma-text.json for a Figma-sourced page` : ''})`);
  }
  return { out, missing };
}

export function main(argv) {
  let o; try { o = parse(argv); } catch (e) { console.error(`reskin-ledger: ${e.message}\n\n${HELP}`); return 2; }
  if (o.help) { console.log(HELP); return 0; }
  const [cmd, slug] = o.pos;
  if (!cmd) { console.error(HELP); return 2; }
  const ledgerFile = join(o.dir, 'reskin', 'ledger.json');
  let ledger; try { ledger = readJson(ledgerFile) || {}; } catch { console.error(`reskin-ledger: ${ledgerFile} is not valid JSON`); return 1; }
  if (cmd === 'show') { console.log(JSON.stringify(slug ? ledger.pages?.[slug] ?? null : ledger, null, 2)); return 0; }
  if (!['record', 'eyeball', 'residual', 'step10'].includes(cmd)) { console.error(`reskin-ledger: unknown command ${cmd}\n\n${HELP}`); return 2; }
  if (!slug) { console.error(`reskin-ledger: ${cmd} needs a <slug>`); return 2; }
  let state; try { state = readJson(join(o.dir, 'state.json')); } catch { state = null; }
  if (!state?.pages) { console.error(`reskin-ledger: ${join(o.dir, 'state.json')} missing or invalid`); return 1; }
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) { console.error(`reskin-ledger: no page "${slug}" in state.json`); return 1; }
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  ledger.pages ||= {};

  if (cmd === 'eyeball') {
    if (!['pass', 'fail'].includes(o.verdict)) { console.error('reskin-ledger: eyeball needs --verdict pass|fail'); return 2; }
    const chrome = fragmentVerdict(ledger.pages[slug]?.gates?.deployed?.chrome);
    if (o.verdict === 'pass' && chrome === 'FAIL') { console.error(`reskin-ledger: eyeball pass refused: deployed.chrome fails for ${slug} (${JSON.stringify(ledger.pages[slug].gates.deployed.chrome)}); fix the header or footer and re-run deployed-gate`); return 1; }
    ledger.pages[slug] = { ...(ledger.pages[slug] || {}), eyeball: { verdict: o.verdict, note: o.note || null, at } };
    save(ledgerFile, ledger); console.log(`eyeball ${slug}: ${o.verdict}`); return 0;
  }
  if (cmd === 'residual' && (o.remove || o['rename-cause'])) {
    if (!o.gate || !o.cause || (o.remove && o['rename-cause']) || o.verdict) { console.error('reskin-ledger: residual --remove | --rename-cause <new> needs --gate and --cause (not both, no --verdict)'); return 2; }
    const e = { ...(ledger.pages[slug] || {}) };
    const list = e.residuals || [];
    const i = list.findIndex((r) => r.gate === o.gate && r.cause === o.cause);
    if (i < 0) { console.error(`reskin-ledger: no residual on ${o.gate} with cause "${o.cause}" for ${slug} (have: ${list.map((r) => `${r.gate}:${r.cause}`).join(', ') || 'none'})`); return 1; }
    const to = o['rename-cause'];
    if (to) {
      const refused = list[i].verdict === 'accepted' && classRefusal(ledger, slug, o.gate, to);
      if (refused) { console.error(`reskin-ledger: ${refused}`); return 1; }
    }
    e.residuals = to ? list.map((r, k) => (k === i ? { ...r, cause: to } : r)) : list.filter((_, k) => k !== i);
    e.residualHistory = [...(e.residualHistory || []), { at, action: to ? 'rename-cause' : 'remove', gate: o.gate, cause: o.cause, ...(to ? { to } : {}), verdict: list[i].verdict, by: o.by || null, note: o.note || null }];
    ledger.pages[slug] = e; save(ledgerFile, ledger);
    console.log(`residual ${slug}: ${o.gate} ${to ? `cause "${o.cause}" → "${to}"` : `"${o.cause}" removed`} (re-run record for the page status)`);
    return 0;
  }
  if (cmd === 'step10') {
    const { bad } = step10Problems({ eyeball: o.eyeball, cls: o.cls, header: o.header });
    if (bad.length) { console.error(`reskin-ledger: step10 needs --eyeball, --cls and --header:\n  ${bad.join('\n  ')}`); return 2; }
    const next = applyStep10(ledger, { slug, eyeball: o.eyeball, cls: o.cls, header: o.header, note: o.note || null, by: o.by || null, at });
    save(ledgerFile, next);
    const s = next.pages[slug].gates.step10;
    console.log(`step10 ${slug}: ${s.verdict} — ${step10Detail(s)}${s.verdict === 'NOT-RUN' ? ' (needs-owner residual on step10)' : ''}`);
    return 0;
  }
  if (cmd === 'residual') {
    if (!o.gate || !o.cause || !VERDICTS.includes(o.verdict)) { console.error(`reskin-ledger: residual needs --gate, --cause and --verdict ${VERDICTS.join('|')}`); return 2; }
    if (o.verdict === 'accepted' && NEVER_ACCEPTED.includes(o.gate)) { console.error(`reskin-ledger: a ${o.gate} residual cannot be accepted (hard): fix the page and re-run deployed-gate`); return 1; }
    if (o.verdict === 'accepted' && !ownerAccepted({ gate: o.gate, verdict: o.verdict, by: o.by })) { console.error(`reskin-ledger: a ${o.gate} residual is the site owner's to accept: pass --by <owner> (never an agent), or record it needs-owner`); return 1; }
    const refused = o.verdict === 'accepted' && classRefusal(ledger, slug, o.gate, o.cause);
    if (refused) { console.error(`reskin-ledger: ${refused}`); return 1; }
    const cls = /^(figma|deployed)\./.test(o.gate) ? { class: o.gate } : {};
    const by = o.by ? { by: o.by } : {};
    const e = { ...(ledger.pages[slug] || {}) }; e.residuals = [...(e.residuals || []).filter((r) => r.gate !== o.gate), { gate: o.gate, ...cls, cause: o.cause, verdict: o.verdict, ...by, note: o.note || null, at }];
    ledger.pages[slug] = e; save(ledgerFile, ledger); console.log(`residual ${slug}: ${o.gate} ${o.verdict}`); return 0;
  }

  const stage = o.stage || 'prototype';
  if (!['prototype', 'migrated'].includes(stage)) { console.error('reskin-ledger: --stage is prototype or migrated'); return 2; }
  const { out: reports, missing } = findReports(o.dir, slug, stage);
  if (missing.length) { console.error(`reskin-ledger: missing gate report(s) for ${slug}:\n  ${missing.join('\n  ')}`); return 1; }
  let mobile = null; let prototypeSha = null;
  if (stage === 'prototype') {
    const proto = page.prototypePath && resolve(dirname(o.dir), page.prototypePath);
    const protoFile = [proto, page.prototypePath, join(o.dir, 'prototypes', `${slug}-proposed.html`)].find((f) => f && existsSync(f));
    if (!protoFile) { console.error(`reskin-ledger: no prototype for ${slug} (state prototypePath or ${o.dir}/prototypes/${slug}-proposed.html)`); return 1; }
    const html = readFileSync(protoFile, 'utf8'); prototypeSha = sha(html);
    const audit = join(o.dir, 'scripts', 'prototype', 'mobile-nav-audit.mjs'); let runtime = null;
    if (existsSync(audit)) {
      const r = spawnSync(process.execPath, [audit, protoFile], { encoding: 'utf8', timeout: 120000 });
      if (r.status === 0 || r.status === 1) runtime = { pass: r.status === 0, detail: r.status ? (r.stdout + r.stderr).trim().split('\n').slice(0, 4).join(' | ') : null };
    }
    mobile = { static: mobileStatic(html), runtime };
  }
  const m2 = {};
  if (stage === 'prototype') {
    const ev = (kind) => { const f = join(o.dir, '.work', 'reskin', 'gates', slug, kind, 'summary.json'); try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).ledgerFragment || null : null; } catch { return null; } };
    const fig = ev('figma'); const dep = ev('deployed'); const ex = ev('exact');
    if (fig && fig.regime !== 'preview') m2.figma = fig;
    if (dep) m2.deployed = dep;
    if (ex) m2.exact = ex;
    m2.figmaRequired = existsSync(join(o.dir, 'reskin', 'curation-rules.json')) && existsSync(join(o.dir, 'scripts', 'reskin', 'figma-gate.mjs'));
  }
  const next = applyRecord(ledger, { state, slug, stage, reports, mobile, prototypeSha, at, m2 });
  save(ledgerFile, next);
  const e = next.pages[slug]; const g = stage === 'migrated' ? e.migratedGates : e.gates;
  for (const v of gateVerdicts(g)) console.log(`  ${v.verdict.padEnd(8)} ${v.gate}${v.detail ? ` — ${v.detail}` : ''}`);
  console.log(`${slug} (${stage}): ${stage === 'migrated' ? e.migratedStatus : e.status}${page.type && next.handoff[page.type]?.archetype === slug ? ` — archetype of ${page.type}` : ''}`);
  return 0;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exitCode = main(process.argv.slice(2));
