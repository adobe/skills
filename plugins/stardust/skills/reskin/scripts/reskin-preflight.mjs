#!/usr/bin/env node
/**
 * skills/reskin/scripts/reskin-preflight.mjs — is a reskin project ready for `migrate`? Read-only.
 *
 * Reskin hands off to migrate through canon-from-reskin.mjs, not through prepare-migration: under
 * flow "reskin" the redesign cascade would resume at extract --prep / direct --prep and overwrite the
 * donor-sourced DESIGN.md/.json with a direction the donor never had. This check is the reskin
 * equivalent of prepare-migration's phase-complete test.
 *
 *   FAIL  state.json flow is "reskin"
 *   FAIL  every typed page's type has an approved (or migrated) archetype
 *   FAIL  canon/canon.css exists and its first block is :root (migrate strict 1)
 *   FAIL  DESIGN.json source.kind is "donor" (written by the bridge, not by direct)
 *   FAIL  DESIGN.json extensions.canon.files match the canon files on disk (no hand edit, no overwrite)
 *   FAIL  direction.md carries an "## Active" direction
 *   FAIL  dynamic-features.md exists and every feature row has a disposition
 *   FAIL  every module a typed page's mapping uses has a canon skeleton (DESIGN.json extensions.modules)
 *   FAIL  no agent approval outside hands-off (approvedBy hands-off/autopilot/agent needs state.handsOff and "hands-off")
 *   FAIL  the reskin predicate: each type's archetype is gated in reskin/ledger.json (reskin-ledger.mjs) —
 *         gates PASS or residual accepted, no open residual, eyeball pass, prototype unchanged, M2 figma/deployed families PASS when recorded
 *   WARN  migrated pages whose migrate output has no passing sibling gate (reskin-ledger.mjs record --stage migrated)
 *   WARN  pages without a type (migrate renders them Path A, never from an archetype)
 *   WARN  stale pages (re-approve / re-migrate them, or migrate stale output knowingly)
 *   WARN  feature rows still awaiting an owner decision
 *
 * Usage: node reskin-preflight.mjs [--dir stardust] [--root .] [--json]
 * Writes nothing. Exit: 0 ready (warnings allowed), 1 not ready, 2 usage.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateVerdicts, NEVER_ACCEPTED, residualCovers } from './reskin-ledger.mjs';

const HELP = `usage: node reskin-preflight.mjs [--dir stardust] [--root .] [--json]

Read-only readiness check for migrating a reskin project: flow, approved archetypes per type, canon,
donor DESIGN.*, direction, dynamic features, stale pages. Under flow "reskin" never run
prepare-migration or direct — run canon-from-reskin.mjs, then this, then migrate.
Exit 0 ready (warnings allowed), 1 not ready, 2 usage.`;

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// Pure over a file reader: read(rel) → string | null. Returns [{ level: 'ok'|'fail'|'warn', check, detail }].
export function preflight(read, { dir = 'stardust' } = {}) {
  const out = [];
  const ok = (check, detail = '') => out.push({ level: 'ok', check, detail });
  const fail = (check, detail) => out.push({ level: 'fail', check, detail });
  const warn = (check, detail) => out.push({ level: 'warn', check, detail });
  const json = (rel) => { const s = read(rel); if (s == null) return undefined; try { return JSON.parse(s); } catch { return null; } };

  const state = json(`${dir}/state.json`);
  if (!state || !Array.isArray(state.pages)) { fail('state', `${dir}/state.json ${state === undefined ? 'is missing' : 'is not valid state'}`); return out; }
  if (state.flow === 'reskin') ok('flow', 'reskin');
  else fail('flow', `flow is ${state.flow ? `"${state.flow}"` : 'unset'}; this check is for reskin projects (prepare-migration owns redesign, replica owns replica)`);

  const types = new Map();
  for (const p of state.pages) if (p.type) { if (!types.has(p.type)) types.set(p.type, []); types.get(p.type).push(p); }
  const missing = [...types].filter(([, ps]) => !ps.some((p) => p.status === 'approved' || p.status === 'migrated'));
  if (!types.size) fail('archetypes', 'no page has a type: classify pages before migrating');
  else if (missing.length) fail('archetypes', `no approved archetype for ${missing.map(([t, ps]) => `${t} (${ps.map((p) => p.slug).join(', ')})`).join('; ')} — approve one page per type with state.mjs advance --to approved`);
  else {
    const handoff = json(`${dir}/reskin/ledger.json`)?.handoff || {};
    ok('archetypes', [...types].map(([t, ps]) => `${t}: ${handoff[t]?.archetype || ps.find((p) => p.status === 'approved' || p.status === 'migrated').slug}`).join(', '));
  }
  // D3: `approved` is the user's approval; an agent may approve only under hands-off (approvedBy "hands-off").
  const AGENT = new Set(['hands-off', 'autopilot', 'agent', 'auto', 'auto-mode']);
  const approvals = state.pages.flatMap((p) => (p.history || []).filter((h) => h.status === 'approved').slice(-1).map((h) => ({ slug: p.slug, by: h.approvedBy })));
  const agentApproved = approvals.filter((a) => a.by && AGENT.has(String(a.by).toLowerCase()) && !(state.handsOff === true && a.by === 'hands-off'));
  if (agentApproved.length) fail('approval', `agent approval outside hands-off: ${agentApproved.map((a) => `${a.slug} (by ${a.by})`).join(', ')} — the user approves, or the run is hands-off (state.json handsOff: true) and the approval is --by hands-off`);
  else if (approvals.length) ok('approval', `${approvals.length} approval(s): ${[...new Set(approvals.map((a) => a.by || 'user'))].join(', ')}`);

  // The flow: reskin predicate (spec § 4.6): each type's archetype is gated in reskin/ledger.json —
  // every gate PASS or a residual accepted, no needs-owner/blocked residual, the eyeball recorded and
  // passing, the recorded prototype still the file on disk, and M2's gates.figma / gates.deployed families PASS
  // (or a residual accepted; never deployed.sanity) when recorded.
  const ledger = json(`${dir}/reskin/ledger.json`);
  if (types.size && !missing.length) {
    if (!ledger) fail('archetype-gates', `${dir}/reskin/ledger.json ${ledger === undefined ? 'is missing' : 'is not valid JSON'} — run reskin-ledger.mjs record <archetype> after the Phase 5 gates`);
    else {
      const problems = []; const good = [];
      for (const [t, ps] of types) {
        const a = ledger.handoff?.[t]?.archetype || ps.find((p) => p.status === 'approved' || p.status === 'migrated').slug;
        const e = ledger.pages?.[a]; const page = state.pages.find((p) => p.slug === a);
        if (!e || !ledger.handoff?.[t]) { problems.push(`${t}/${a}: not recorded (reskin-ledger.mjs record ${a})`); continue; }
        const accepted = (g) => !NEVER_ACCEPTED.includes(g) && (e.residuals || []).some((r) => residualCovers(r, g) && r.verdict === 'accepted');
        // reskin's gates plus M2's fragments (gates.figma B0/B1/B3, gates.deployed A1–A5 + its figma re-run)
        const bad = gateVerdicts(e.gates).filter((v) => v.verdict !== 'PASS' && !accepted(v.gate)).map((v) => `${v.gate} ${v.verdict}`);
        if (e.status !== 'gated' || bad.length) problems.push(`${t}/${a}: ${bad.join(', ') || e.status}`);
        const open = (e.residuals || []).filter((r) => r.verdict !== 'accepted');
        if (open.length) problems.push(`${t}/${a}: residual(s) ${open.map((r) => `${r.gate} ${r.verdict}`).join(', ')}`);
        if (!e.eyeball) problems.push(`${t}/${a}: no eyeball verdict (reskin-ledger.mjs eyeball ${a} --verdict pass|fail)`);
        else if (e.eyeball.verdict !== 'pass') problems.push(`${t}/${a}: eyeball ${e.eyeball.verdict}`);
        const proto = page?.prototypePath && read(page.prototypePath);
        if (proto != null && e.prototypeSha && sha(proto) !== e.prototypeSha) problems.push(`${t}/${a}: prototype changed since it was recorded — re-run the gates and reskin-ledger.mjs record ${a}`);
        if (!problems.some((x) => x.startsWith(`${t}/`))) good.push(`${t}: ${a}`);
      }
      if (problems.length) fail('archetype-gates', problems.join('; '));
      else ok('archetype-gates', good.join(', '));
    }
  }
  const ungated = state.pages.filter((p) => p.status === 'migrated' && ledger?.pages?.[p.slug]?.migratedStatus !== 'gated');
  if (ungated.length) warn('sibling-gates', `migrated page(s) without a passing gate on migrate's output: ${ungated.map((p) => p.slug).join(', ')} — gate them (reskin/gates/<slug>/migrated/) and reskin-ledger.mjs record <slug> --stage migrated`);

  const untyped = state.pages.filter((p) => !p.type);
  if (untyped.length) warn('untyped', `${untyped.map((p) => p.slug).join(', ')} — migrate renders untyped pages Path A`);

  const css = read(`${dir}/canon/canon.css`);
  if (css == null) fail('canon', `${dir}/canon/canon.css is missing — run canon-from-reskin.mjs <archetype>`);
  else if (!/^\s*:root\s*\{/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) fail('canon', `${dir}/canon/canon.css does not open with :root (migrate strict 1)`);
  else ok('canon', `${dir}/canon/canon.css opens with :root`);

  const design = json('DESIGN.json');
  if (!design) fail('design', `DESIGN.json ${design === undefined ? 'is missing' : 'is not valid JSON'} — run canon-from-reskin.mjs`);
  else {
    if (design.source?.kind === 'donor') ok('design', 'DESIGN.json is donor-sourced');
    else fail('design', `DESIGN.json source.kind is ${design.source?.kind ? `"${design.source.kind}"` : 'unset'} — something other than the bridge wrote it (direct / extract --prep?); re-run canon-from-reskin.mjs --force`);
    const files = design.extensions?.canon?.files;
    if (!files) fail('canon-record', 'DESIGN.json has no extensions.canon.files');
    else {
      const drift = Object.entries(files).filter(([, f]) => { const s = read(f.path); return s == null || sha(s) !== f.sha; }).map(([k]) => k);
      if (drift.length) fail('canon-record', `canon file(s) differ from DESIGN.json: ${drift.join(', ')} — re-run canon-from-reskin.mjs --force`);
      else ok('canon-record', `${Object.keys(files).length} canon file(s) match`);
    }
  }

  const direction = read(`${dir}/direction.md`);
  if (direction == null || !/^##\s+Active\b/m.test(direction)) fail('direction', `${dir}/direction.md has no "## Active" direction — run canon-from-reskin.mjs`);
  else ok('direction', 'active');

  const dyn = read(`${dir}/dynamic-features.md`);
  if (dyn == null) fail('dynamics', `${dir}/dynamic-features.md is missing — run canon-from-reskin.mjs (or dynamics-detect)`);
  else {
    const header = dyn.split('\n').find((l) => /^\|\s*#\s*\|/.test(l));
    const cols = header ? header.split('|').map((c) => c.trim()) : [];
    const di = cols.indexOf('disposition'); const si = cols.indexOf('status');
    const rows = dyn.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
    const bare = rows.filter((r) => di < 0 || !r[di] || r[di] === '–');
    if (bare.length) fail('dynamics', `${bare.length} feature row(s) without a disposition`);
    else ok('dynamics', `${rows.length} feature row(s) with dispositions`);
    const waiting = rows.filter((r) => si > -1 && /awaiting/i.test(r[si] || ''));
    if (waiting.length) warn('dynamics-owner', `${waiting.length} feature row(s) await an owner decision (${waiting.map((r) => r[2]).join(', ')})`);
  }

  const stale = state.pages.filter((p) => p.stale);
  if (stale.length) warn('stale', stale.map((p) => `${p.slug}: ${p.staleReason || 'stale'}`).join('; '));

  // Every module a typed page's mapping uses needs a canon skeleton, or migrate has nothing to render it with.
  const mapping = json(`${dir}/reskin/mapping.json`);
  if (mapping && design) {
    const canonMods = new Set((design.extensions?.modules || []).filter((m) => m.canonicalRendering?.path && read(m.canonicalRendering.path) != null).map((m) => m.id));
    const typed = new Set(state.pages.filter((p) => p.type).map((p) => p.slug));
    const used = new Map();
    for (const [ps, pm] of Object.entries(mapping.pages || {})) {
      if (!typed.has(ps)) continue;
      for (const m of Object.values(pm?.slots || {})) if (m?.module) { if (!used.has(m.module)) used.set(m.module, new Set()); used.get(m.module).add(ps); }
    }
    const gaps = [...used].filter(([id]) => !canonMods.has(id));
    if (gaps.length) fail('canon-modules', `mapped module(s) with no canon skeleton: ${gaps.map(([id, ps]) => `${id} (${[...ps].join(', ')})`).join('; ')} — approve an archetype that renders them, then re-run canon-from-reskin.mjs --force`);
    else if (used.size) ok('canon-modules', `${used.size} mapped module(s) have canon skeletons`);
  }
  return out;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const o = { dir: 'stardust', root: '.', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--dir' || a === '--root') { const v = argv[++i]; if (!v || v.startsWith('--')) { console.error(`usage error: ${a} needs a value\n\n${HELP}`); return 2; } o[a.slice(2)] = v; } else { console.error(`usage error: unexpected ${a}\n\n${HELP}`); return 2; }
  }
  const root = resolve(o.root);
  const read = (rel) => { const f = join(root, rel); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const res = preflight(read, { dir: o.dir });
  const fails = res.filter((r) => r.level === 'fail').length;
  if (o.json) console.log(JSON.stringify({ ready: !fails, checks: res }, null, 2));
  else {
    for (const r of res) console.log(`${r.level.toUpperCase().padEnd(4)} ${r.check.padEnd(14)} ${r.detail}`);
    console.log(fails ? `\nnot ready: ${fails} failing check(s). Do not run prepare-migration or direct under flow "reskin".` : '\nready: run migrate render (warnings above are informational).');
  }
  return fails ? 1 : 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(fileURLToPath(import.meta.url)) === safeRealpath(process.argv[1])) process.exit(main(process.argv.slice(2)));
