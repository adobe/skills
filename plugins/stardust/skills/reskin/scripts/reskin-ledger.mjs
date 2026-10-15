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
 *       migrated: reads <dir>/reskin/gates/<slug>/migrated/*.md — the sibling gate on migrate's output —
 *       into pages[slug].migratedGates and handoff.<type>.siblings.<slug>.
 *   eyeball <slug> --verdict pass|fail [--note "…"]     the side-by-side donor judgment (Phase 5)
 *   residual <slug> --gate <g> --cause <c> --verdict accepted|needs-owner|blocked [--note "…"]
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
  residual <slug> --gate <g> --cause <c> --verdict accepted|needs-owner|blocked [--note "…"]
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

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
export const overall = (md) => { const m = String(md || '').match(/\*\*Overall:\s*(PASS|FAIL)/i); return m ? m[1].toUpperCase() : null; };

// prototype SKILL § Mobile-adapt audit, the three rules that need no render.
export function mobileStatic(html) {
  const issues = [];
  const vp = String(html).match(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i);
  const content = vp && (vp[0].match(/content\s*=\s*["']([^"']*)/i) || [])[1];
  if (!content || !/width\s*=\s*device-width/i.test(content)) issues.push('viewport meta missing or not width=device-width');
  const widths = [...String(html).matchAll(/@media[^{]*max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map((m) => Number(m[1]));
  if (!widths.length) issues.push('no @media (max-width) rule: desktop-only');
  else if (Math.min(...widths) > 640) issues.push(`narrowest max-width breakpoint is ${Math.min(...widths)}px; needs one at ≤640px`);
  return { pass: issues.length === 0, issues };
}

// Pure: the ledger after recording one stage for one page. reports: { gate: { verdict, report } };
// mobile: { static: {pass, issues}, runtime: {pass, detail} | null }.
export function applyRecord(ledger, { state, slug, stage = 'prototype', reports, mobile, prototypeSha, at }) {
  const L = structuredClone(ledger || {}); L.pages ||= {}; L.handoff ||= {};
  const page = state.pages.find((p) => p.slug === slug);
  const entry = { ...(L.pages[slug] || {}) }; entry.residuals ||= []; entry.flags ||= [];
  const gates = { ...reports };
  if (stage === 'prototype' && mobile) {
    gates['mobile-adapt-static'] = { verdict: mobile.static.pass ? 'PASS' : 'FAIL', detail: mobile.static.issues.join('; ') || undefined };
    gates['mobile-adapt-runtime'] = mobile.runtime ? { verdict: mobile.runtime.pass ? 'PASS' : 'FAIL', detail: mobile.runtime.detail || undefined } : { verdict: 'NOT-RUN', detail: 'mobile-nav-audit.mjs not found or Playwright missing' };
  }
  const accepted = (g) => entry.residuals.some((r) => r.gate === g && r.verdict === 'accepted');
  const ok = Object.entries(gates).every(([g, v]) => v.verdict === 'PASS' || accepted(g));
  if (stage === 'migrated') { entry.migratedGates = gates; entry.migratedStatus = ok ? 'gated' : 'failing'; } else {
    entry.gates = gates; entry.status = ok ? 'gated' : 'failing'; entry.prototypeSha = prototypeSha; entry.prototypePath = page.prototypePath || null;
  }
  entry.recordedAt = at; L.pages[slug] = entry;
  if (page.type && ['approved', 'migrated'].includes(page.status)) {
    const h = { ...(L.handoff[page.type] || {}) }; h.gates ||= {}; h.siblings ||= {};
    if (stage === 'prototype') {
      h.gates[slug] = Object.fromEntries(Object.entries(gates).filter(([, v]) => v.verdict === 'PASS').map(([g, v]) => [g, v.report ? `${v.verdict} — ${v.report}` : v.verdict]));
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
    else if (['--dir', '--stage', '--verdict', '--note', '--gate', '--cause'].includes(a)) {
      const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); o[a.slice(2)] = v;
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
  if (!['record', 'eyeball', 'residual'].includes(cmd)) { console.error(`reskin-ledger: unknown command ${cmd}\n\n${HELP}`); return 2; }
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
  if (cmd === 'residual') {
    if (!o.gate || !o.cause || !VERDICTS.includes(o.verdict)) { console.error(`reskin-ledger: residual needs --gate, --cause and --verdict ${VERDICTS.join('|')}`); return 2; }
    const e = { ...(ledger.pages[slug] || {}) }; e.residuals = [...(e.residuals || []).filter((r) => r.gate !== o.gate), { gate: o.gate, cause: o.cause, verdict: o.verdict, note: o.note || null, at }];
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
  const next = applyRecord(ledger, { state, slug, stage, reports, mobile, prototypeSha, at });
  save(ledgerFile, next);
  const e = next.pages[slug]; const g = stage === 'migrated' ? e.migratedGates : e.gates;
  for (const [k, v] of Object.entries(g)) console.log(`  ${v.verdict.padEnd(8)} ${k}${v.detail ? ` — ${v.detail}` : ''}`);
  console.log(`${slug} (${stage}): ${stage === 'migrated' ? e.migratedStatus : e.status}${page.type && next.handoff[page.type]?.archetype === slug ? ` — archetype of ${page.type}` : ''}`);
  return 0;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exitCode = main(process.argv.slice(2));
