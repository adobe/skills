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
 *       sanity/inherited and its figma re-run. A figma fragment of "NOT CHECKED 0/0" (no checks: every
 *       section out-of-kit) records NOT-CHECKED, shown but not blocking. A deployed.sanity residual is never accepted (M2a D7).
 *       migrated: reads <dir>/reskin/gates/<slug>/migrated/*.md — the sibling gate on migrate's output —
 *       into pages[slug].migratedGates and handoff.<type>.siblings.<slug>.
 *   eyeball <slug> --verdict pass|fail [--note "…"]     the side-by-side donor judgment (Phase 5)
 *   step10 <slug> --eyeball <v> --cls <n> --header <v> [--note "…"] [--by <who>]
 *       deploy's Step 10 receipts on the preview (reference/deployed-leg.md § The ledger) → gates.step10
 *       { eyeball, cls, header, verdict, note, by, at }: eyeball pass|fail, cls the measured CLS (< 0.1
 *       passes), header pass|fail|"n/a: <why>" (--header-toggle is an alias); any of them may be
 *       "unresolved: <why>" — NOT-RUN, plus a needs-owner residual on step10 (a header other than pass adds
 *       one too). verdict FAIL beats NOT-RUN beats PASS. `record` keeps an existing gates.step10. An agent
 *       (--by hands-off|autopilot|agent, or no --by in a handsOff run) passing the header (pass or n/a) is
 *       refused unless the page's gates.deployed shows the chrome PASS.
 *   residual <slug> --gate <g> --cause <c> --verdict accepted|needs-owner|blocked|fallback [--note "…"] [--by <who>]
 *       accepted on an owner-only gate (AGENT_NEVER_ACCEPTS, or chrome/header/footer) needs --by user.
 *       fallback: a hands-off run's figma.geometry, figma.ramp, exact or step10 (after step10 ran twice), --note required.
 *   flag <slug> --note "<text>"                          appends to pages[slug].flags (deduped)
 *   delivery --scope full-site|archetypes-only|subset [--pages a,b] --requested-by user|runner --reason "<why>"
 *       → ledger.delivery { scope, pages?, requestedBy, reason, at } (default scope full-site; pages for subset
 *       only). requestedBy user: the user asked in words (reason quotes them); runner: the hosting runner
 *       imposed it (a page cap), reason names the setting.
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
  eyeball <slug> --verdict pass|fail [--note "…"]
  step10 <slug> --eyeball pass|fail --cls <n> --header pass|fail|"n/a: <why>" [--note "…"] [--by <who>]
      deploy's Step 10 receipts → gates.step10 (CLS < 0.1 passes; any value may be "unresolved: <why>",
      which records NOT-RUN and a needs-owner residual); --header-toggle is an alias of --header
      An agent passing the header (pass or n/a) needs gates.deployed to show the chrome PASS; a header
      other than pass adds a needs-owner residual on step10.
  residual <slug> --gate <g> --cause <c> --verdict accepted|needs-owner|blocked|fallback [--note "…"] [--by <who>]
      figma.join|geometry|ramp, exact, step10 and chrome/header/footer gates are the owner's: an agent
      records --verdict needs-owner; only --by user accepts. deployed.sanity is never accepted.
      fallback (hands-off runs only; figma.geometry, figma.ramp, exact or step10; --note says what was used; step10 after a
      second step10 run) covers the gate and is listed in the handoff.
  flag <slug> --note "<text>"                  appends to pages[slug].flags (identical text once)
  delivery --scope full-site|archetypes-only|subset [--pages a,b] --requested-by user|runner --reason "<why>"
      → ledger.delivery { scope, pages?, requestedBy, reason, at }; --pages with subset only. reason: the
      user's words, or the runner setting that capped it (runner = imposed by the hosting runner, not the user)
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
const VERDICTS = ['accepted', 'needs-owner', 'blocked', 'fallback'];

// M2 evidence. M2b (figma-gate all) and M2a (deployed-gate all) each write
// <dir>/.work/reskin/gates/<slug>/{figma,deployed}/summary.json with a ledgerFragment that lands in
// pages.<slug>.gates.figma / gates.deployed. Their values are 'PASS' | 'FAIL k/n' | 'ADVISORY …' |
// 'n/a: …' | 'not run: …' | 'CRASH: …'. Blocking families: figma B0 join, B1 geometry, B3 ramp (B2 pixel
// is advisory, B4 register informational); deployed A1 content … A5 inherited, plus its figma re-run.
export const M2_FAMILIES = { figma: ['join', 'geometry', 'ramp'], deployed: ['content', 'tokens', 'parity', 'sanity', 'inherited'] };
// A residual that may never be accepted (M2a D7: a deployed hard-sanity failure is fixed, not waived).
export const NEVER_ACCEPTED = ['deployed.sanity'];
// Blocking failures only the owner accepts (residual --by user): never the agent that produced them.
export const AGENT_NEVER_ACCEPTS = ['figma.join', 'figma.geometry', 'figma.ramp', 'exact', 'step10'];
export const CHROME_GATE = /chrome|header|footer/i;
export const ownerOnly = (gate) => {
  const g = String(gate || ''); const base = g.replace(/^deployed\./, '');
  return AGENT_NEVER_ACCEPTS.includes(g) || AGENT_NEVER_ACCEPTS.includes(base) || /(^|\.)exact(\.|$)/.test(g) || CHROME_GATE.test(g);
};
// An agent's say-so: --by hands-off|autopilot|agent (anything but user), or no --by in a handsOff run.
export const agentBy = (by, state) => (by ? String(by).toLowerCase() !== 'user' : state?.handsOff === true);
// What a hands-off run uses when an owner-only failure is not one section's to remap (gates.md § Fallback ladder):
// the kit module kept where its geometry still misses (figma.geometry), the source's value for a figma.ramp token,
// the source's text for an exact check, a finish after a second step10.
// residual --verdict fallback, hands-off only, --note naming what was used; it covers its gate and the handoff lists it.
export const fallbackGate = (gate) => { const g = String(gate || '').replace(/^deployed\./, ''); return ['figma.geometry', 'figma.ramp', 'step10'].includes(g) || /(^|\.)exact(\.|$)/.test(g); };
export function fragmentVerdict(v) {
  const s = typeof v === 'string' ? v : v?.verdict;
  if (s == null) return 'NOT-RUN';
  if (/^(PASS|ADVISORY|n\/a)/i.test(s)) return 'PASS';
  if (/^NOT CHECKED/i.test(s)) return 'NOT-CHECKED';
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
// The chrome evidence on the preview: the deployed fragment's chrome/header/footer keys when it has any, else
// parity (its header and footer crops), a crop left n/a counting as not measured. No fragment is NOT-RUN.
export function chromeVerdict(dep) {
  if (!dep || typeof dep !== 'object') return { verdict: 'NOT-RUN', detail: 'no gates.deployed fragment (deployed-gate all, then record)' };
  // A chrome key with its own verdict covers the header and footer; one holding sub-checks ({ navDepth }) adds rows
  // beside parity, which keeps the header and footer crops.
  const rows = []; let explicit = false;
  for (const k of Object.keys(dep).filter((x) => CHROME_GATE.test(x))) {
    const v = dep[k];
    if (v && typeof v === 'object' && v.verdict == null) for (const [sub, sv] of Object.entries(v)) rows.push([`deployed.${k}.${sub}`, sv]);
    else { rows.push([`deployed.${k}`, v]); explicit = true; }
  }
  if (!explicit) rows.unshift(['deployed.parity', dep.parity]);
  const vs = rows.map(([k, v]) => {
    const s = typeof v === 'string' ? v : v?.verdict;
    const unmeasured = k === 'deployed.parity' && /n\/a:[^)]*\b(header|footer)\b/i.test(String(s ?? ''));
    return [k, unmeasured ? 'NOT-RUN' : fragmentVerdict(v), s ?? 'absent'];
  });
  const worst = vs.find(([, v]) => v === 'FAIL') || vs.find(([, v]) => v !== 'PASS');
  return { verdict: worst ? (worst[1] === 'FAIL' ? 'FAIL' : 'NOT-RUN') : 'PASS', detail: vs.map(([k, , s]) => `${k} ${s}`).join('; ') };
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

// An accepted residual covers a gate, never a NEVER_ACCEPTED one, and an owner-only one only when the user
// accepted it (by "user"; a residual without by fails closed).
export const residualAccepted = (residuals, g) => !NEVER_ACCEPTED.includes(g)
  && (residuals || []).some((r) => residualCovers(r, g) && ((r.verdict === 'accepted' && (!ownerOnly(g) || r.by === 'user')) || (r.verdict === 'fallback' && fallbackGate(g))));
// NOT-CHECKED (figma-gate over no checks: every section out-of-kit) is reported, never blocking: nothing failed.
export const passing = (verdict) => verdict === 'PASS' || verdict === 'NOT-CHECKED';
// The gates neither passing nor covered by an accepted residual.
export const openGates = (gates, residuals = []) => gateVerdicts(gates).filter(({ gate, verdict }) => !passing(verdict) && !residualAccepted(residuals, gate));
export const gatesOk = (gates, residuals = []) => openGates(gates, residuals).length === 0;

// Pure: the ledger with deploy's Step 10 receipts for one page in pages[slug].gates.step10. An unresolved
// check, or a header other than pass, adds (or refreshes) a needs-owner residual on step10 (source "step10");
// a record with none open drops that residual, never one entered with `residual`. A recorded page's status follows its gates.
export function applyStep10(ledger, { slug, eyeball, cls, header, note = null, by = null, at }) {
  const L = structuredClone(ledger || {}); L.pages ||= {};
  const entry = { ...(L.pages[slug] || {}) };
  const s = { eyeball: String(eyeball), cls: String(cls).trim(), header: String(header) };
  for (const k of ['eyeball', 'header']) if (/^(pass|fail)$/i.test(s[k])) s[k] = s[k].toLowerCase();
  const { open } = step10Problems(s);
  if (s.header !== 'pass' && !open.includes('header')) open.push('header');
  const step10 = { ...s, verdict: step10Verdict(s), attempts: (Number(entry.gates?.step10?.attempts) || 1) + (entry.gates?.step10 ? 1 : 0), note, by, at };
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
    else if (['--dir', '--stage', '--verdict', '--note', '--gate', '--cause', '--eyeball', '--cls', '--header', '--header-toggle', '--by', '--scope', '--pages', '--requested-by', '--reason'].includes(a)) {
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
    if (f) out[g] = { verdict: overall(readFileSync(f, 'utf8')) || 'UNKNOWN', report: f }; else missing.push(`${join(dir, 'reskin', 'gates', slug, file)} (or reports/${slug}${suffix})`);
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
  if (!['record', 'eyeball', 'residual', 'step10', 'flag', 'delivery'].includes(cmd)) { console.error(`reskin-ledger: unknown command ${cmd}\n\n${HELP}`); return 2; }
  if (cmd === 'delivery') {
    if (slug) { console.error('reskin-ledger: delivery takes no <slug> (it is the run\'s scope)'); return 2; }
    const scope = o.scope || 'full-site';
    const pages = o.pages ? o.pages.split(',').map((p) => p.trim()).filter(Boolean) : null;
    if (!['full-site', 'archetypes-only', 'subset'].includes(scope) || !['user', 'runner'].includes(o['requested-by']) || !o.reason?.trim() || (scope === 'subset') !== !!pages?.length) {
      console.error('reskin-ledger: delivery needs --scope full-site|archetypes-only|subset (--pages a,b with subset only), --requested-by user|runner and --reason "<the user\'s words, or the runner setting that capped it>"'); return 2;
    }
    ledger.delivery = { scope, ...(scope === 'subset' ? { pages } : {}), requestedBy: o['requested-by'], reason: o.reason, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    save(ledgerFile, ledger); console.log(`delivery: ${scope}${pages ? ` (${pages.join(', ')})` : ''}, requested by ${o['requested-by']}`); return 0;
  }
  if (!slug) { console.error(`reskin-ledger: ${cmd} needs a <slug>`); return 2; }
  let state; try { state = readJson(join(o.dir, 'state.json')); } catch { state = null; }
  if (!state?.pages) { console.error(`reskin-ledger: ${join(o.dir, 'state.json')} missing or invalid`); return 1; }
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) { console.error(`reskin-ledger: no page "${slug}" in state.json`); return 1; }
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  ledger.pages ||= {};

  if (cmd === 'eyeball') {
    if (!['pass', 'fail'].includes(o.verdict)) { console.error('reskin-ledger: eyeball needs --verdict pass|fail'); return 2; }
    ledger.pages[slug] = { ...(ledger.pages[slug] || {}), eyeball: { verdict: o.verdict, note: o.note || null, at } };
    save(ledgerFile, ledger); console.log(`eyeball ${slug}: ${o.verdict}`); return 0;
  }
  if (cmd === 'flag') {
    if (!o.note?.trim()) { console.error('reskin-ledger: flag needs --note "<text>"'); return 2; }
    const e = { ...(ledger.pages[slug] || {}) }; e.flags = [...(e.flags || [])];
    if (!e.flags.includes(o.note)) e.flags.push(o.note);
    ledger.pages[slug] = e; save(ledgerFile, ledger); console.log(`flag ${slug}: ${e.flags.length} flag(s)`); return 0;
  }
  if (cmd === 'step10') {
    const { bad } = step10Problems({ eyeball: o.eyeball, cls: o.cls, header: o.header });
    if (bad.length) { console.error(`reskin-ledger: step10 needs --eyeball, --cls and --header:\n  ${bad.join('\n  ')}`); return 2; }
    if (agentBy(o.by, state) && !/^fail$/i.test(o.header) && !UNRESOLVED.test(o.header)) {
      const c = chromeVerdict(ledger.pages[slug]?.gates?.deployed);
      if (c.verdict !== 'PASS') {
        console.error(`reskin-ledger: step10 ${slug} --header ${JSON.stringify(o.header)} refused for ${o.by || 'a hands-off run'}: the preview's chrome evidence is ${c.verdict} (${c.detail}). An agent does not pass the header over its own gate: record --header "unresolved: <why>" (a needs-owner residual on step10) or --header fail; only the user (--by user) passes it.`);
        return 1;
      }
    }
    const next = applyStep10(ledger, { slug, eyeball: o.eyeball, cls: o.cls, header: o.header, note: o.note || null, by: o.by || null, at });
    save(ledgerFile, next);
    const s = next.pages[slug].gates.step10;
    console.log(`step10 ${slug}: ${s.verdict} — ${step10Detail(s)}${s.verdict === 'NOT-RUN' ? ' (needs-owner residual on step10)' : ''}`);
    return 0;
  }
  if (cmd === 'residual') {
    if (!o.gate || !o.cause || !VERDICTS.includes(o.verdict)) { console.error(`reskin-ledger: residual needs --gate, --cause and --verdict ${VERDICTS.join('|')}`); return 2; }
    if (o.verdict === 'accepted' && NEVER_ACCEPTED.includes(o.gate)) { console.error(`reskin-ledger: a ${o.gate} residual cannot be accepted (hard sanity): fix the page and re-run deployed-gate`); return 1; }
    if (o.verdict === 'accepted' && ownerOnly(o.gate) && o.by !== 'user') {
      console.error(`reskin-ledger: a ${o.gate} residual is the owner's to accept, not the agent's: record it with --verdict needs-owner; only --by user accepts it`); return 1;
    }
    if (o.verdict === 'fallback') {
      const why = !state.handsOff ? 'a fallback is for a hands-off run (state.json handsOff: true); record --verdict needs-owner'
        : !fallbackGate(o.gate) ? `${o.gate} takes no fallback (figma.geometry, figma.ramp, exact or step10 only; a section's figma.join or chrome failure is remapped, gates.md § Fallback ladder)`
          : !o.note?.trim() ? 'a fallback needs --note "<what was used instead>"'
            : o.gate.replace(/^deployed\./, '') === 'step10' && !(Number(ledger.pages[slug]?.gates?.step10?.attempts) >= 2) ? 'a step10 fallback needs step10 run twice (re-run it once first)'
              : null;
      if (why) { console.error(`reskin-ledger: residual ${slug} --gate ${o.gate} --verdict fallback refused: ${why}`); return 1; }
    }
    const cls = /^(figma|deployed)\./.test(o.gate) ? { class: o.gate } : {};
    const e = { ...(ledger.pages[slug] || {}) }; e.residuals = [...(e.residuals || []).filter((r) => r.gate !== o.gate), { gate: o.gate, ...cls, cause: o.cause, verdict: o.verdict, by: o.by || null, note: o.note || null, at }];
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
    const fig = ev('figma'); const dep = ev('deployed');
    if (fig && fig.regime !== 'preview') m2.figma = fig;
    if (dep) m2.deployed = dep;
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
