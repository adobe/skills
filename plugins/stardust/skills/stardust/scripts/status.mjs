#!/usr/bin/env node
/**
 * skills/stardust/scripts/status.mjs — the deterministic, read-only state report.
 *
 * Renders `reference/state-machine.md` § State report from the project's own
 * files, so "where are we" is a file read, not a model recollection:
 *   stardust/state.json · status.jsonl · decisions.md · replica/progress.json ·
 *   rollout/{rollout.json,coverage/pages.json} · the deploy ledger ·
 *   .work/env.json · usage.json · `run-lock.mjs check` (read-only).
 * Blocks: Blocked on owner · Active run · Project root · Preflight · Site ·
 * Direction · Flow · Decisions · Last phase (running since / next / warning) ·
 * Pages · Gates (per archetype × breakpoint, PASS / FAIL / no verdict — copied
 * from the ledger, never recomputed) · Delivery (coverage + ledger counts,
 * --reconcile admin previewed / published + drift) · Probes · Usage · Repo ·
 * Recommended next (replica flow: gate-ledger-lint verdict lines).
 *
 * WRITES NOTHING: no run-lock acquire, no status.jsonl line, no state.json touch,
 * no git index. Drift is a `warning:` line, never an exit code.
 *
 * Usage:
 *   node skills/stardust/scripts/status.mjs [--root <dir>] [--json | --markdown]
 *        [--no-probe] [--sample <n>] [--reconcile] [--token-env DA_TOKEN] [--ledger <file>]
 *     --json        machine-readable report on stdout
 *     --markdown    hand-off shape (handoff-report.md § Gate table first) + recap table + report-check line
 *     --no-probe    skip every network probe (default sample: 5 preview/live HEADs when a live host is known)
 *     --sample <n>  pages to HEAD on the live host (default 5)
 *     --reconcile   opt-in admin bulk-status job (POST admin.hlx.page/status/<org>/<repo>/main/*) — needs the token
 *     --token-env   env var NAME holding the DA token (default state.json credentials.siteTokenEnv, else DA_TOKEN); never printed
 *     --ledger      deploy ledger path (default <root>/content/.deploy-ledger.json)
 *
 * Exit codes: 0 report printed (every probe may be `not probed`) · 2 usage or unreadable state.json.
 * Probes hit aem.page / aem.live / admin.hlx.page only — never the source origin.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (flag('help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
  process.exit(0);
}
const KNOWN = new Set(['--root', '--json', '--markdown', '--no-probe', '--sample', '--reconcile', '--token-env', '--ledger', '--help']);
const bad = args.filter((a) => a.startsWith('--') && !KNOWN.has(a));
if (bad.length) { console.error(`status: unknown flag ${bad.join(' ')} (--help)`); process.exit(2); }

export function findRoot(from) {
  let d = resolve(from);
  for (;;) {
    if (existsSync(join(d, 'stardust', 'state.json'))) return d;
    const up = dirname(d);
    if (up === d) return resolve(from);
    d = up;
  }
}
const root = opt('root') ? resolve(opt('root')) : findRoot(process.cwd());
const sd = join(root, 'stardust');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const day = (iso) => (iso ? String(iso).slice(0, 10) : '?');

const state = readJson(join(sd, 'state.json'));
if (!state) { console.error(`status: no readable stardust/state.json under ${root} (--root <dir>)`); process.exit(2); }
const warnings = [];
const report = { root, cwd: process.cwd(), warnings };

// --- status.jsonl -------------------------------------------------------------
export function parseStatus(text) {
  return (text ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const lines = parseStatus(readText(join(sd, 'status.jsonl')));
const last = lines.at(-1) ?? null;
report.lastStatus = last;
if (last) {
  const key = (l) => `${l.skill}|${l.phase}`;
  report.runningSince = last.event === 'start' && !lines.some((l) => key(l) === key(last) && l.event !== 'start' && l.ts > last.ts) ? last.ts : null;
  if ((last.event === 'end' || last.event === 'blocked') && !last.next) warnings.push(`no \`next\` on the last ${last.event} line (${last.skill} ${last.phase} ${last.ts}) — the resume has nothing to execute (run-status.md § Phase close)`);
  report.blockedOnOwner = lines.filter((l) => l.event === 'blocked' && l.owner && !lines.some((e) => e.event === 'end' && key(e) === key(l) && e.ts > l.ts)).map((l) => ({ owner: l.owner, since: l.ts, detail: l.detail ?? '' }));
} else report.blockedOnOwner = [];

// --- decisions.md ---------------------------------------------------------------
export function parseDecisions(text) {
  const rows = [];
  for (const l of (text ?? '').split('\n')) {
    const m = l.match(/^\|\s*`?([a-z][a-z0-9-]*)`?\s*\|(.*)\|\s*$/);
    if (!m || m[1] === 'id') continue;
    const cells = m[2].split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    rows.push({ id: m[1], question: cells[0], default: cells[1], rationale: cells[2], status: cells[3], decidedBy: cells[4], evidence: cells[5] });
  }
  const latest = {}; for (const r of rows) latest[r.id] = r; // later row wins
  return Object.values(latest);
}
const decisions = parseDecisions(readText(join(sd, 'decisions.md')));
report.decisions = decisions.length ? { defaultApplied: decisions.filter((r) => r.status === 'default-applied').length, ownerOnlyPending: decisions.filter((r) => r.status === 'owner-only-pending').map((r) => r.id), publish: decisions.find((r) => r.id === 'publish')?.default ?? null, tracking: decisions.find((r) => r.id === 'tracking')?.default ?? 'none', target: decisions.find((r) => r.id === 'target')?.default ?? null } : null;

// --- pages ----------------------------------------------------------------------
const pages = Array.isArray(state.pages) ? state.pages : [];
const byStatus = {};
for (const p of pages) (byStatus[p.status ?? 'unknown'] ??= []).push(p.slug ?? p.url ?? '?');
report.pages = { total: pages.length, byStatus, stale: pages.filter((p) => p.stale).map((p) => p.slug) };

// --- gates (copied from progress.json, never re-judged) -------------------------
const progress = readJson(join(sd, 'replica', 'progress.json'));
export function gateRows(progress) {
  const rows = [];
  const list = Array.isArray(progress?.archetypes) ? progress.archetypes : progress?.pageTypes ? Object.entries(progress.pageTypes).map(([pageType, v]) => ({ pageType, ...v })) : [];
  for (const a of list) {
    const bps = Object.keys(a.breakpoints ?? {});
    if (!a.gated || !bps.length) { rows.push({ archetype: a.archetype ?? a.pageType, pageType: a.pageType, bp: '—', verdict: 'no verdict', pixelPct: null, at: a.approvedAt ?? null, regime: null, build: null, note: a.note ?? 'never gated' }); continue; }
    for (const bp of bps) {
      const r = a.breakpoints[bp]?.result ?? {};
      rows.push({ archetype: a.archetype ?? a.pageType, pageType: a.pageType, bp, verdict: r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'no verdict', pixelPct: r.pixelPct ?? null, heightDelta: r.heightDelta ?? null, at: a.breakpoints[bp].at ?? a.approvedAt ?? null, regime: a.breakpoints[bp].regime ?? r.regime ?? null, build: a.breakpoints[bp].build ?? r.build ?? null, residuals: (a.breakpoints[bp].residuals ?? []).length });
    }
  }
  return rows;
}
report.gates = gateRows(progress);

// --- delivery -------------------------------------------------------------------
const rollout = readJson(join(sd, 'rollout', 'rollout.json'));
const coverage = readJson(join(sd, 'rollout', 'coverage', 'pages.json'));
const covRows = Array.isArray(coverage) ? coverage : Array.isArray(coverage?.pages) ? coverage.pages : [];
const covBy = {}; for (const r of covRows) { const s = r.delivery?.status ?? r.status ?? 'unknown'; covBy[s] = (covBy[s] ?? 0) + 1; }
const ledgerPath = opt('ledger') ? resolve(opt('ledger')) : join(root, 'content', '.deploy-ledger.json');
const ledger = readJson(ledgerPath);
const ledgerBy = {}; for (const row of Object.values(ledger ?? {})) { if (row && typeof row === 'object') ledgerBy[row.status ?? 'unknown'] = (ledgerBy[row.status ?? 'unknown'] ?? 0) + 1; }
const target = report.decisions?.target?.match(/`?([a-z0-9-]+)\/([a-z0-9-]+)`?/i);
const org = rollout?.target?.org ?? rollout?.org ?? (target && !target[1].startsWith('<') ? target[1] : null);
const repo = rollout?.target?.repo ?? rollout?.repo ?? (target && !target[2].startsWith('<') ? target[2] : null);
const liveHost = state.site?.deployUrl ?? rollout?.site?.liveHost ?? null;
report.delivery = { coverage: covRows.length ? covBy : null, ledger: ledger ? { file: ledgerPath, ...ledgerBy } : null, liveHost, org, repo, reconcile: 'not reconciled' };

// --- reconcile (opt-in POST job) ------------------------------------------------
const tokenEnv = opt('token-env') ?? state.credentials?.siteTokenEnv ?? 'DA_TOKEN'; // state-machine.md § Credentials key
if (flag('reconcile')) {
  const token = process.env[tokenEnv];
  if (!token) report.delivery.reconcile = `not reconciled (no token in $${tokenEnv})`;
  else if (!org || !repo) report.delivery.reconcile = 'not reconciled (no org/repo: decisions.md `target` row or rollout.json)';
  else report.delivery.reconcile = await reconcile(org, repo, token).catch((e) => `not reconciled (${e.message})`);
}
async function reconcile(o, r, token) {
  const h = { authorization: `token ${token}`, 'content-type': 'application/json' };
  const res = await fetch(`https://admin.hlx.page/status/${o}/${r}/main/*`, { method: 'POST', headers: h, body: JSON.stringify({ paths: ['/*'], select: ['preview', 'live'] }) });
  if (!res.ok) throw new Error(`job POST ${res.status}`);
  const job = await res.json();
  const link = job?.links?.details ?? job?.links?.self;
  if (!link) throw new Error('job link missing');
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const d = await (await fetch(`${link}/details`, { headers: h })).json().catch(() => null);
    if (d?.state === 'stopped') {
      const rs = d.data?.resources ?? [];
      const previewed = rs.filter((x) => x.preview?.status === 200 || x.previewStatus === 200).length;
      const published = rs.filter((x) => x.live?.status === 200 || x.liveStatus === 200).length;
      const out = { previewed, published, total: rs.length };
      if (published > 0 && /preview/i.test(report.decisions?.publish ?? '') && !/owner-decided|live/i.test(report.decisions?.publish ?? '')) warnings.push(`drift: ${published} published on the admin while the \`publish\` row is preview — check who published (D1/D16)`);
      const ledgerLive = ledgerBy.live ?? 0;
      if (ledger && ledgerLive !== published) warnings.push(`drift: ledger says live ${ledgerLive}, admin says published ${published}`);
      return out;
    }
    await new Promise((res2) => { setTimeout(res2, 3000); });
  }
  throw new Error('job did not finish in 60 s');
}

// --- probes ---------------------------------------------------------------------
report.probes = 'not probed';
if (!flag('no-probe') && liveHost && /aem\.(page|live)|\.hlx\./.test(liveHost)) {
  const n = Number(opt('sample') ?? 5);
  const base = liveHost.replace(/\/$/, '').replace(/^(?!https?:)/, 'https://');
  const sample = pages.filter((p) => p.status === 'migrated').slice(0, n);
  const codes = [];
  for (const p of sample) {
    const path = (state.migrate?.pageMap ?? []).find((m) => m.slug === p.slug)?.sourceUrl ?? `/${p.slug.replace(/__/g, '/')}`;
    try { const r = await fetch(`${base}${path.replace(/\/index\.html$/, '/')}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) }); codes.push({ path, code: r.status }); } catch { codes.push({ path, code: 'unreachable' }); }
  }
  let tokens = null;
  const css = readText(join(sd, 'migrated', 'assets', 'styles.css')) ?? readText(join(sd, 'migrated', 'index.html'));
  const names = [...new Set([...(css ?? '').matchAll(/(--[a-z][a-z0-9-]*)\s*:/gi)].map((m) => m[1]))].slice(0, 3);
  const servedCheck = join(HERE, '..', '..', 'deploy', 'scripts', 'served-check.mjs');
  if (names.length && existsSync(servedCheck)) {
    let hit = 0;
    for (const name of names) { const r = spawnSync(process.execPath, [servedCheck, `${base}/styles/styles.css`, '--grep', name.replace(/[-]/g, '\\-')], { encoding: 'utf8' }); if (r.status === 0) hit += 1; }
    tokens = `${hit}/${names.length}`;
  }
  report.probes = { host: base, sample: codes, tokens };
}

// --- run lock, preflight, usage, repo -------------------------------------------
const lock = spawnSync(process.execPath, [join(HERE, 'run-lock.mjs'), 'check', '--root', root], { encoding: 'utf8' });
report.activeRun = lock.status === 3 ? lock.stdout.trim() : null;
report.preflight = readJson(join(sd, '.work', 'env.json'))?.preflight ?? null;
const usage = readJson(join(sd, 'usage.json'));
report.usage = usage?.total ? { ...usage.total, windows: (usage.windows ?? []).length, generatedAt: usage.generatedAt ?? null, harnessCostUSD: usage.harnessCost?.totalCostUSD ?? null } : null;
report.repo = null;
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
if (top.status === 0 && resolve(top.stdout.trim()) === resolve(root)) {
  const ls = spawnSync('git', ['ls-files', '-z', 'stardust'], { cwd: root, encoding: 'utf8' });
  if (ls.status !== 0) warnings.push(`repo: git ls-files failed (${(ls.stderr || '').trim().split('\n')[0] || `exit ${ls.status}`}) — Repo block skipped`);
  else {
    const files = ls.stdout.split('\0').filter(Boolean);
    const bytes = files.reduce((n, f) => { try { return n + statSync(join(root, f)).size; } catch { return n; } }, 0);
    const outside = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).stdout.split('\0').filter((f) => f && !f.startsWith('stardust/'));
    const secrets = files.concat(outside).filter((f) => /(^|\/)\.env|_storage-state\.json$|-clearance\.json$/.test(f));
    report.repo = { tracked: files.length, bytes, stateTracked: files.includes('stardust/state.json'), outsideStardust: outside.length, secretsTracked: secrets, assetsPresent: existsSync(join(sd, 'current', 'assets')) };
    if (!report.repo.stateTracked) warnings.push('repo: stardust/state.json is not tracked — an ignore rule drops it (master Setup step 6)');
  }
}

// --- recommendation -------------------------------------------------------------
report.flow = state.flow ? { flow: state.flow, chosenAt: state.flowChosenAt ?? null, source: state.flowSource ?? null } : null;
report.recommendation = null;
if (state.flow === 'replica') {
  const gl = join(HERE, '..', '..', 'replica', 'scripts', 'gate-ledger-lint.mjs');
  if (progress && existsSync(gl)) {
    const r = spawnSync(process.execPath, [gl, '--all-types', '--project', root, '--progress', join(sd, 'replica', 'progress.json'), '--state', join(sd, 'state.json'), '--json'], { encoding: 'utf8' });
    const j = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
    if (j?.results) {
      report.gateLedgerLint = j.results.map((x) => ({ type: x.type, archetype: x.archetype, verdict: x.verdict, reasons: x.reasons, numbers: x.numbers }));
      // never-gated first (no numbers at all), then over-bar types — one command, the rest named
      const blocked = j.results.filter((x) => x.verdict === 'blocked').sort((a, b) => Number(!/never gated/.test(a.reasons.join())) - Number(!/never gated/.test(b.reasons.join())));
      report.recommendation = blocked.length ? { command: `$stardust replica ${blocked[0].archetype}`, why: `${blocked[0].type}: ${blocked[0].reasons.join('; ')}${blocked.length > 1 ? `; also blocked: ${blocked.slice(1).map((x) => `${x.type} (${x.archetype})`).join(', ')}` : ''}; then $stardust rollout` } : { command: pages.some((p) => p.status !== 'migrated') ? '$stardust migrate' : '$stardust rollout', why: 'every checked page type ok' };
    } else report.recommendation = { command: null, why: `gate-ledger-lint unreadable (${(r.stderr || r.stdout || '').trim().split('\n')[0]})` };
  } else report.recommendation = { command: null, why: 'no replica/progress.json — the archetype gate has not run' };
} else if (!state.flow && /migrat|eds/i.test(state.direction?.phrase ?? '')) report.recommendation = { command: null, why: 'migration ask with no flow — the two-flow question comes first (state-machine.md § Flow keys)' };
else {
  const has = (s) => (byStatus[s] ?? []).length > 0;
  if (!pages.length) report.recommendation = { command: '$stardust extract', why: 'no extracted data' };
  else if (!state.direction?.resolvedAt) report.recommendation = { command: '$stardust direct', why: 'extracted, no direction' };
  else if (has('directed')) report.recommendation = { command: '$stardust prototype', why: `${byStatus.directed.length} directed page(s) waiting` };
  else if (has('approved')) report.recommendation = { command: '$stardust migrate', why: `${byStatus.approved.length} approved page(s) not migrated` };
  else report.recommendation = { command: '$impeccable critique', why: 'every page migrated — final critique against migrated/' };
}

// --- render -----------------------------------------------------------------------
const pct = (v) => (v === null || v === undefined ? '—' : `${v} %`);
const kM = (n) => (typeof n !== 'number' ? '?' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n)); // token-ledger.mjs shape
function renderText() {
  const out = ['stardust state', '=============='];
  for (const b of report.blockedOnOwner) out.push(`Blocked on owner:  ${b.owner}`, `                   (since ${b.since} · ${b.detail || 'run continues on unblocked work'})`);
  if (report.activeRun) out.push(report.activeRun);
  if (resolve(process.cwd()) !== resolve(root)) out.push(`Project root: ${root} (not the working directory)`);
  if (report.preflight) out.push(`Preflight:   ${report.preflight}`);
  out.push('');
  out.push(`Site:        ${state.site?.originUrl ?? '?'} (extracted ${day(state.site?.extractedAt)}, ${state.site?.crawled ?? pages.length}/${state.site?.totalDiscovered ?? '?'} pages)`);
  if (state.direction?.phrase) out.push(`Direction:   "${state.direction.phrase}"`, `             (resolved ${day(state.direction.resolvedAt)}, see ${state.direction.directionFile ?? 'stardust/direction.md'})`);
  if (report.flow) out.push(`Flow:        ${report.flow.flow} (chosen ${day(report.flow.chosenAt)} from ${report.flow.source === 'question' ? 'the keep-vs-redesign question' : report.flow.source ?? '?'})`);
  if (report.decisions) out.push(`Decisions:   ${report.decisions.defaultApplied} default-applied${report.decisions.ownerOnlyPending.length ? `; owner-only pending: ${report.decisions.ownerOnlyPending.join(', ')}` : ''}; publish: ${report.decisions.publish ?? '?'}; tracking: ${report.decisions.tracking}`);
  if (last) out.push(`Last phase:  ${String(last.skill ?? '?').replace(/^stardust:/, '')} ${last.phase} ${last.event} ${last.ts}${report.runningSince ? ` (running since ${report.runningSince})` : ''}${last.next ? `\n             next: ${last.next}` : ''}`);
  out.push('', 'Pages', '-----');
  for (const s of ['migrated', 'approved', 'prototyped', 'directed', 'extracted']) if (byStatus[s]) out.push(`  ${s === 'migrated' || s === 'approved' ? '✓' : s === 'prototyped' ? '·' : ' '} ${s.padEnd(10)} ${byStatus[s].join(', ')}`);
  for (const s of Object.keys(byStatus)) if (!['migrated', 'approved', 'prototyped', 'directed', 'extracted'].includes(s)) out.push(`    ${s.padEnd(10)} ${byStatus[s].join(', ')}`);
  if (report.pages.stale.length) out.push(`Stale: ${report.pages.stale.length} pages (${report.pages.stale.join(', ')})`);
  if (report.gates.length) {
    out.push('', 'Gates', '-----');
    for (const g of report.gates) out.push(`  ${g.archetype.padEnd(30)} ${String(g.bp).padEnd(5)} ${g.verdict.padEnd(10)} ${pct(g.pixelPct).padEnd(8)} ${g.regime ?? '—'} ${g.build ?? ''}${g.note ? ` (${g.note})` : ''}`.trimEnd());
  }
  const d = report.delivery;
  out.push('', `Delivery:    coverage ${d.coverage ? Object.entries(d.coverage).map(([k, v]) => `${k} ${v}`).join(' · ') : 'no rollout coverage'} · ledger ${d.ledger ? Object.entries(ledgerBy).map(([k, v]) => `${k} ${v}`).join(' · ') || 'empty' : 'none'} · admin ${typeof d.reconcile === 'string' ? d.reconcile : `previewed ${d.reconcile.previewed} / published ${d.reconcile.published}`}`);
  out.push(`Probes:      ${typeof report.probes === 'string' ? report.probes : `${report.probes.sample.map((s) => `${s.path} ${s.code}`).join(', ')}${report.probes.tokens ? ` · tokens ${report.probes.tokens}` : ''}`}`);
  if (report.usage) { const u = report.usage; out.push(`Usage:       ${u.turns ?? '?'} requests · fresh ${kM(u.fresh)} · cache read ${kM(u.cacheRead)} · output ${kM(u.output)}${typeof u.estCost === 'number' ? ` · est. USD ${u.estCost.toFixed(2)}` : ''}${typeof u.harnessCostUSD === 'number' ? ` · harness-reported USD ${u.harnessCostUSD.toFixed(2)} (session)` : ''} — ${u.windows} window(s), copied from stardust/usage.json${u.generatedAt ? ` ${day(u.generatedAt)}` : ''}`); }
  if (report.gateLedgerLint) { out.push(''); for (const x of report.gateLedgerLint) out.push(`${x.type}: ${x.verdict}${x.verdict === 'ok' ? ` — ${x.archetype} ${x.numbers.join(' · ')}` : ` — ${x.reasons.join('; ')} → $stardust replica ${x.archetype}`}`); }
  if (report.recommendation) out.push('', `Recommended next: ${report.recommendation.command ?? '—'}`, `                  (${report.recommendation.why})`);
  if (report.repo) out.push('', `Repo:  tracked ${report.repo.tracked} files / ${(report.repo.bytes / 1e6).toFixed(1)} MB under stardust/; outside stardust/: ${report.repo.outsideStardust}`, `       state.json tracked ${report.repo.stateTracked ? '✓' : '✗'} · secrets tracked: ${report.repo.secretsTracked.length ? report.repo.secretsTracked.join(', ') : 'none ✓'}${report.repo.assetsPresent ? '' : '\n       current/assets/ absent on this checkout'}`);
  for (const w of warnings) out.push(`warning: ${w}`);
  return out.join('\n');
}
function renderMarkdown() {
  const out = ['| page / archetype | bp | verdict | pixel % | residuals | at | regime | build | when |', '|---|---|---|---|---|---|---|---|---|'];
  const first = lines[0]?.ts ?? null;
  for (const g of report.gates) out.push(`| ${g.archetype} | ${g.bp} | ${g.verdict} | ${g.pixelPct ?? '—'} | ${g.residuals ?? '—'} | ${g.at ?? '—'} | ${g.regime ?? '—'} | ${g.build ?? '—'} | ${g.at && first && g.at >= first ? 'this run' : 'recorded earlier'} |`);
  if (!report.gates.length) out.push('| — | — | no verdict | — | — | — | — | — | — |');
  const byType = {}; for (const p of pages) byType[p.type ?? '?'] = (byType[p.type ?? '?'] ?? 0) + 1;
  out.push('', '| pages by template | gated | queue | live URLs |', '|---|---|---|---|');
  const passTypes = new Set(report.gates.filter((g) => g.verdict === 'PASS').map((g) => g.pageType));
  out.push(`| ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')} | ${passTypes.size}/${Object.keys(byType).length} types with a PASS row | ${report.recommendation?.command ?? '—'} | ${ledgerBy.live ?? 0} live · ${ledgerBy.previewed ?? 0} previewed (ledger) |`);
  const paths = [join(sd, 'state.json'), join(sd, 'status.jsonl'), join(sd, 'replica', 'progress.json'), ledgerPath].filter((p) => existsSync(p));
  out.push('', `report-check: ${paths.length} paths ls-verified · ${report.gates.length + Object.keys(byStatus).length} counts re-read from progress.json/state.json${report.gates.length ? '' : ' — WARNING: no gate table (no progress.json)'}`);
  for (const w of warnings) out.push(`warning: ${w}`);
  return out.join('\n');
}

if (flag('json')) console.log(JSON.stringify(report, null, 2));
else if (flag('markdown')) console.log(renderMarkdown());
else console.log(renderText());
process.exit(0);
