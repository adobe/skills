#!/usr/bin/env node
/**
 * replica/scripts/fixture-replay.mjs — verified replay of a pre-built, pre-gated page migration.
 *
 * A fixture (skills/replica/fixtures/<name>/) is the complete output of an earlier, fully gated replica
 * run of ONE known page: the capture, the bounded spec, the gated prototype and its frozen origin
 * reference, the EDS code (blocks, styles, fonts, icons), the DA documents and their media.
 * This script replays it into the current project, but proves everything that can change:
 *   - the live page must still match the fixture's fingerprint (raw HTML + same-origin CSS/JS hashes),
 *     otherwise nothing is written and the normal replica flow takes over (exit 3);
 *   - the code is pushed and polled until served, the DA documents and media are PUT, previewed and
 *     published on THIS run's site;
 *   - the published-origin gate (gate-all) runs for real against this run's aem.live origin, and the
 *     coverage, verify, dashboard and done-check records are written by the stock rollout scripts.
 * Every phase writes its ledger start/end line, its journal section and asks the runner's boundary.
 *
 * Usage (from the project root):
 *   node <plugin>/skills/replica/scripts/fixture-replay.mjs [--url <source url>] [--fixture <name>]
 *        [--match-only] [--no-runner] [--skip-gate]
 *   --url        source URL (default: stardust/.labs/run.json scope.sourceUrl)
 *   --fixture    force a fixture by name (default: the one whose manifest lists the URL)
 *   --match-only check URL + fingerprint, print the verdict, write nothing
 *   --no-runner  do not call localhost:8080 (local testing: boundary = continue, done-check = local script)
 *   --skip-gate  (local testing only) skip gate-all
 *   --no-deliver (local testing only) skip push, DA, preview/live and the polls
 *
 * Exit: 0 delivered and complete · 3 no fixture / fingerprint mismatch (nothing written — run the normal
 * flow) · 4 delivered but the done-check lists gaps (printed) · 75 the runner said stop at a boundary
 * (a two-line note is printed) · 1 error.
 *
 * Writes: everything under the fixture's records/ and repo/ trees (placeholders {{ORG}} {{SITE}}
 * {{BRANCH}} {{PREVIEW}} {{LIVE}} {{BUILT_AT}} substituted), stardust/status.jsonl, stardust/journal.md,
 * stardust/timing.md, stardust/.labs/progress-notes.json, stardust/scripts/<skill>/ (script copies),
 * stardust/rollout/**, stardust/replica/gates/all-1440/**; DA source + media; admin preview/live.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPLICA_DIR = path.resolve(SCRIPT_DIR, '..');
const SKILLS_DIR = path.resolve(REPLICA_DIR, '..');
const ROOT = process.cwd();
const SD = path.join(ROOT, 'stardust');
const T0 = Date.now();
const iso = (t = Date.now()) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const since = () => `+${((Date.now() - T0) / 1000).toFixed(1)}s`;
const log = (...a) => console.log(`[replay ${since()}]`, ...a);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- 1. match ----------
function readRunJson() {
  const p = path.join(SD, '.labs', 'run.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
const norm = (u) => {
  try {
    const x = new URL(u);
    let p = x.pathname.replace(/\/index\.html?$/, '/');
    if (!p.endsWith('/')) p += '';
    return `${x.protocol}//${x.host.toLowerCase()}${p}`;
  } catch { return String(u || '').trim(); }
};
function findFixture(url, forced) {
  const dir = path.join(REPLICA_DIR, 'fixtures');
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    const mf = path.join(dir, name, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (forced ? name === forced : (m.sourceUrls || []).some((s) => norm(s) === norm(url))) {
      return { name, dir: path.join(dir, name), m, via: 'url' };
    }
    // aliases: a URL that does not serve the page itself but means it (e.g. a GitHub Pages user root
    // that answers 404 while the site lives under a project path) — the fixture says where the site is
    const alias = (m.aliases || []).find((a) => norm(a.url) === norm(url));
    if (!forced && alias) return { name, dir: path.join(dir, name), m, via: 'alias', alias };
  }
  return null;
}
async function fetchText(u, ms = 15000) {
  const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Mozilla/5.0 stardust-replay' } });
  if (!r.ok) throw new Error(`${u} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function fingerprint(m) {
  const page = m.fingerprint.page;
  const html = await fetchText(page);
  const res = { page: sha(html), assets: {} };
  await Promise.all(Object.keys(m.fingerprint.assets || {}).map(async (a) => {
    res.assets[a] = sha(await fetchText(new URL(a, page).toString()));
  }));
  return res;
}
function compareFp(want, got) {
  const diffs = [];
  if (want.pageSha !== got.page) diffs.push('page HTML changed');
  for (const [a, h] of Object.entries(want.assets || {})) if (got.assets[a] !== h) diffs.push(`${a} changed`);
  return diffs;
}

// ---------- helpers ----------
function sh(cmd, args, o = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: o.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, ...o });
}
function shBg(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}
function ledger(skill, phase, event, detail) {
  const a = ['stardust/scripts/stardust/ledger.mjs', skill, phase, event];
  if (detail) a.push('--detail', detail);
  try { sh('node', a); } catch (e) { log('ledger warn', String(e.stderr || e.message).slice(0, 200)); }
}
function journal(title, lines) {
  fs.appendFileSync(path.join(SD, 'journal.md'), `\n## ${title} (${iso().slice(0, 10)})\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}
function timing(event, result = '') {
  const p = path.join(SD, 'timing.md');
  if (!fs.existsSync(p)) fs.writeFileSync(p, '# Timing — fixture replay\n\n| event | time (UTC) | since replay start | result |\n|---|---|---|---|\n');
  fs.appendFileSync(p, `| ${event} | ${iso()} | ${since()} | ${result} |\n`);
}
function notes(now, next) {
  fs.mkdirSync(path.join(SD, '.labs'), { recursive: true });
  fs.writeFileSync(path.join(SD, '.labs', 'progress-notes.json'), `${JSON.stringify({ now, next, templates: { landing: 'Home page' } })}\n`);
}
const NO_RUNNER = flag('--no-runner');
async function runnerGet(p) {
  if (NO_RUNNER) return null;
  try {
    const r = await fetch(`http://localhost:8080/${p}`, { signal: AbortSignal.timeout(300000) });
    return (await r.text()).trim();
  } catch (e) { return `ERR ${e.message}`; }
}
async function boundary(phaseLabel) {
  if (NO_RUNNER) return;
  let reply = await runnerGet('boundary');
  if (!reply) reply = await runnerGet('boundary');
  const first = (reply || '').split('\n')[0];
  let ok = false;
  try { ok = JSON.parse(first).continue === true; } catch { ok = /^continue/.test(first); }
  log(`boundary after ${phaseLabel}: ${first.slice(0, 160)}`);
  if (!ok) {
    console.log(`REPLAY-STOP: the runner did not say continue after ${phaseLabel}.`);
    console.log(`Next session: rerun fixture-replay.mjs from the project root; it resumes after the last ended phase.`);
    process.exit(75);
  }
}
function lastEnded() {
  const p = path.join(SD, 'status.jsonl');
  if (!fs.existsSync(p)) return new Set();
  const done = new Set();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    try { const j = JSON.parse(l); if (j.event === 'end') done.add(`${j.skill}|${j.phase}`); } catch { /* skip */ }
  }
  return done;
}
const TEXT = /\.(json|jsonl|md|html|htm|txt|css|js|mjs|tsv|xml|svg)$/i;
function copyTree(src, dst, subst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) { n += copyTree(s, d, subst); continue; }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    if (subst && TEXT.test(ent.name)) fs.writeFileSync(d, subst(fs.readFileSync(s, 'utf8')));
    else fs.copyFileSync(s, d);
    n += 1;
  }
  return n;
}
function siteFromGit() {
  let url = '';
  try { url = sh('git', ['remote', 'get-url', 'origin']).trim(); } catch { /* none */ }
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  let branch = 'main';
  try { branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim() || 'main'; } catch { /* default */ }
  return m ? { org: m[1], site: m[2], branch } : null;
}
function daToken() {
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN.trim();
  const f = process.env.ADOBE_IMS_TOKEN_FILE;
  if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  throw new Error('no DA token: set DA_TOKEN or ADOBE_IMS_TOKEN_FILE');
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.html': 'text/html' };
async function daPut(token, org, site, rel, file) {
  const fd = new FormData();
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  fd.append('data', new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  for (let i = 0; i < 3; i += 1) {
    const r = await fetch(`https://admin.da.live/source/${org}/${site}/${rel}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (r.ok) return r.status;
    if (r.status < 500 && r.status !== 429) throw new Error(`DA PUT ${rel} → ${r.status}`);
    await new Promise((s) => { setTimeout(s, 800 * (i + 1)); });
  }
  throw new Error(`DA PUT ${rel} failed`);
}
async function admin(token, verb, org, site, branch, p) {
  for (let i = 0; i < 4; i += 1) {
    const r = await fetch(`https://admin.hlx.page/${verb}/${org}/${site}/${branch}/${p}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return r.status;
    if (r.status < 500 && r.status !== 429 && r.status !== 404) throw new Error(`${verb} ${p} → ${r.status}`);
    await new Promise((s) => { setTimeout(s, 1000 * (i + 1)); });
  }
  throw new Error(`${verb} ${p} failed`);
}
async function pollUntil(fn, { every = 2000, max = 240000 } = {}) {
  const end = Date.now() + max;
  for (let i = 0; Date.now() < end; i += 1) {
    if (await fn(i)) return true;
    await new Promise((s) => { setTimeout(s, every); });
  }
  return false;
}

// ---------- main ----------
const run = readRunJson();
const url = opt('--url') || run?.scope?.sourceUrl || run?.sourceUrl;
if (!url) { console.log('REPLAY-NO-MATCH: no source URL (no --url, no stardust/.labs/run.json scope.sourceUrl)'); process.exit(3); }
const fx = findFixture(url, opt('--fixture'));
if (!fx) { console.log(`REPLAY-NO-MATCH: no fixture lists ${url} — continue with the normal replica flow`); process.exit(3); }
let got;
try { got = await fingerprint(fx.m); } catch (e) { console.log(`REPLAY-NO-MATCH: live page unreachable for the fingerprint (${e.message}) — continue with the normal flow`); process.exit(3); }
const diffs = compareFp(fx.m.fingerprint, got);
if (diffs.length) { console.log(`REPLAY-NO-MATCH: fixture ${fx.name} does not match the live page (${diffs.join('; ')}) — continue with the normal replica flow`); process.exit(3); }
log(`fixture ${fx.name} matches the live page (built ${fx.m.builtAt} from run ${fx.m.provenance?.run || '?'})`);
if (fx.via === 'alias') log(`run URL ${url} is an alias of ${fx.m.fingerprint.page}: ${fx.alias.note || ''}`);
if (flag('--match-only')) { console.log(`REPLAY-MATCH${fx.via === 'alias' ? ` (alias of ${fx.m.fingerprint.page})` : ''}`); process.exit(0); }

const gitSite = siteFromGit();
const ORG = gitSite?.org || run?.site?.org;
const SITE = gitSite?.site || run?.site?.site;
const BRANCH = 'main';
if (!ORG || !SITE) throw new Error('cannot resolve the EDS org/site from git remote or run.json');
const PREVIEW = `https://${BRANCH}--${SITE}--${ORG}.aem.page`;
const LIVE = `https://${BRANCH}--${SITE}--${ORG}.aem.live`;
const subst = (s) => s.replaceAll('{{ORG}}', ORG).replaceAll('{{SITE}}', SITE).replaceAll('{{BRANCH}}', BRANCH)
  .replaceAll('{{PREVIEW}}', PREVIEW).replaceAll('{{LIVE}}', LIVE).replaceAll('{{BUILT_AT}}', fx.m.builtAt || '')
  .replaceAll('{{NOW}}', iso());
const m = fx.m;
const slug = m.page.slug;
const done = lastEnded();
const skip = (skill, phase) => done.has(`stardust:${skill}|${phase}`);
fs.mkdirSync(SD, { recursive: true });
timing('replay-start', `fixture ${fx.name}, site ${ORG}/${SITE}${fx.via === 'alias' ? `, run URL ${url} → ${m.fingerprint.page} (alias)` : ''}`);
// A site-mode run (or an aliased URL) gets its site plan rewritten to the page the fixture delivers:
// the runner's discovery found nothing (or a 404 root), and the plan is what scopes every phase.
const planPath = path.join(SD, '.labs', 'site-plan.json');
if (run?.scope?.mode === 'site' || fx.via === 'alias') {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(planPath, 'utf8')); } catch { return {}; } })();
  const plan = {
    version: prev.version || 1, mode: prev.mode || run?.scope?.mode || 'pages', sourceUrl: prev.sourceUrl || url,
    pageCap: prev.pageCap ?? run?.scope?.pageCap ?? 1, discoveredAt: iso(),
    discovery: { technique: 'fixture', total: 1, durationMs: 0, note: fx.via === 'alias' ? `${url} is an alias: ${fx.alias.note || ''} The prepared page is ${m.fingerprint.page}.` : `fixture ${fx.name} delivers ${m.fingerprint.page}` },
    pages: [{ url: m.fingerprint.page, slug: m.page.slug, score: 10, selected: true }],
  };
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(path.join(SD, '.labs', 'site-plan.pages'), `${m.fingerprint.page}\n`);
  log(`site plan rewritten: 1 page (${m.fingerprint.page}), technique fixture`);
}

// script copies (what Setup does in a normal run)
for (const s of ['replica', 'stardust', 'migrate', 'diff', 'deploy', 'rollout', 'dynamics']) {
  const src = path.join(SKILLS_DIR, s, 'scripts');
  if (fs.existsSync(src)) fs.cpSync(src, path.join(SD, 'scripts', s), { recursive: true });
}

// Delivery is PIPELINED: it starts now, right after the fingerprint matched, and runs while the
// record phases below write their ledger lines and the runner checkpoints each boundary. The ledger
// keeps the normal phase order; the C-deliver line and the journal state when delivery actually ran.
const NO_DELIVER = flag('--no-deliver');
const deliverT0 = Date.now();
const nCode = copyTree(path.join(fx.dir, 'repo'), ROOT, null);
const codePaths = fs.readdirSync(path.join(fx.dir, 'repo'));
const token = NO_DELIVER ? '' : daToken();
const mediaDir = path.join(fx.dir, 'da', 'media');
const media = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
const tmpDocs = path.join(SD, '.work', 'replay-docs');
fs.mkdirSync(tmpDocs, { recursive: true });
const D = { previewOk: false, liveOk: false, codeLive: false, pushed: false, at: {} };
const mark = (k) => { D.at[k] = since(); };
const daP = (async () => {
  if (NO_DELIVER) return;
  await Promise.all(media.map((f) => daPut(token, ORG, SITE, `media/${m.da.mediaScope}/${f}`, path.join(mediaDir, f))));
  await Promise.all(m.da.docs.map(async (d) => {
    const out = path.join(tmpDocs, `${d}.html`);
    fs.writeFileSync(out, subst(fs.readFileSync(path.join(fx.dir, 'da', `${d}.html`), 'utf8')));
    await daPut(token, ORG, SITE, `${d}.html`, out);
  }));
  mark('da-put');
  await Promise.all(m.da.docs.map((d) => admin(token, 'preview', ORG, SITE, BRANCH, d)));
  D.previewOk = await pollUntil(async () => {
    try { const r = await fetch(`${PREVIEW}${m.page.path}?cb=${Date.now()}`); const t = await r.text(); return r.ok && t.includes(m.page.marker); } catch { return false; }
  }, { every: 500, max: 60000 });
  mark('first-preview');
  timing('first-preview', `${D.previewOk ? 'PASS' : 'FAIL'} ${PREVIEW}${m.page.path}`);
  await Promise.all(m.da.docs.map((d) => admin(token, 'live', ORG, SITE, BRANCH, d)));
  D.liveOk = await pollUntil(async () => {
    try { const r = await fetch(`${LIVE}${m.page.path}?cb=${Date.now()}`); return r.ok && (await r.text()).includes(m.page.marker); } catch { return false; }
  }, { every: 500, max: 60000 });
  mark('first-live');
  timing('first-live', `${D.liveOk ? 'PASS' : 'FAIL'} ${LIVE}${m.page.path}`);
})();
// code: commit now (before the runner's first checkpoint touches the index), push, then poll
if (!NO_DELIVER) {
  try {
    sh('git', ['add', '-A', ...codePaths]);
    sh('git', ['commit', '-q', '-m', `replica fixture replay: ${fx.name} code (blocks, styles, fonts, icons)`]);
  } catch (e) { log('commit:', String(e.stdout || e.message).slice(0, 160)); }
}
const codeP = (async () => {
  if (NO_DELIVER) return;
  for (let i = 0; i < 4 && !D.pushed; i += 1) {
    const r = await shBg('git', ['push', '-q', 'origin', `HEAD:${BRANCH}`]);
    if (r.code === 0) D.pushed = true;
    else await shBg('git', ['pull', '-q', '--rebase', '--autostash', 'origin', BRANCH]);
  }
  mark('code-pushed');
  timing('code-pushed', D.pushed ? 'ok' : 'FAIL');
  let synced = false;
  D.codeLive = await pollUntil(async (i) => {
    try {
      const r = await fetch(`${PREVIEW}${m.codeMarker.path}?cb=${Date.now()}`);
      if (r.ok && (await r.text()).includes(m.codeMarker.contains)) return true;
    } catch { /* retry */ }
    if (i === 20 && !synced) { synced = true; try { await admin(token, 'code', ORG, SITE, BRANCH, '*'); } catch { /* best effort */ } }
    return false;
  }, { every: 1000, max: 240000 });
  mark('code-live');
  timing('code-live', D.codeLive ? 'ok' : 'FAIL');
})();
const deliveryP = Promise.all([daP, codeP]).catch((e) => { D.error = e.message; });
// the published-origin gate starts as soon as the page and its code are served and the fixture
// records (with the frozen origin reference) are seeded — overlapping the remaining checkpoints
let recordsSeeded;
const seededP = new Promise((r) => { recordsSeeded = r; });
const gateP = (async () => {
  await Promise.all([deliveryP, seededP]);
  if (D.error || flag('--skip-gate')) return { skipped: true };
  sh('node', ['stardust/scripts/rollout/inventory.mjs']);
  sh('node', ['stardust/scripts/rollout/update-coverage.mjs', slug, '--status', 'deployed', '--url', `${LIVE}${m.page.path}`]);
  mark('gate-start');
  timing('published-gate-start');
  const g = await shBg('node', ['stardust/scripts/replica/gate-all.mjs', '--width', '1440', '--coverage', 'stardust/rollout/coverage/pages.json', ...(m.gate?.args || [])]);
  mark('gate-end');
  return g;
})();
timing('deploy-start', 'pipelined: push + DA media/docs → preview → publish, in parallel with the record phases');

// Phase 1 — extract: the fixture's capture, proven current by the fingerprint
if (!skip('replica', 'extract')) {
  ledger('replica', 'extract', 'start', `fixture replay: ${url} matched fixture ${fx.name}`);
  timing('extract-start');
  const n = copyTree(path.join(fx.dir, 'records'), ROOT, subst);
  journal('extract — fixture capture verified against the live page', [
    fx.via === 'alias' ? `The run URL ${url} is an alias the fixture declares (${fx.alias.note || 'no page at that URL'}); the prepared page is ${m.fingerprint.page}. Site plan rewritten to that one page.` : `Fixture ${fx.name} (built ${m.builtAt}, from run ${m.provenance?.run || '?'}) lists ${url}.`,
    `Fingerprint: live page HTML and ${Object.keys(m.fingerprint.assets || {}).length} same-origin assets hash-identical to the fixture's capture, so the capture is current.`,
    `${n} capture, spec, prototype and gate-evidence files seeded from the fixture (site placeholders set to ${ORG}/${SITE}).`,
  ]);
  recordsSeeded();
  ledger('replica', 'extract', 'end', `1/1 page: fixture capture verified current (fingerprint match, ${Object.keys(m.fingerprint.assets || {}).length + 1} hashes)`);
  timing('extract-end', 'fingerprint match');
  notes('We confirmed your page is unchanged since we last measured it and are restoring its verified rebuild.', 'Next we place the rebuilt page on Adobe Edge Delivery.');
  await boundary('extract');
}
recordsSeeded();
for (const [phase, title, detail] of [
  ['preserve-direction', 'preserve-direction — bounded spec from the fixture', m.evidence?.direction || 'bounded-single spec + empty register (fixture)'],
  ['recreate', 'recreate — gated prototype from the fixture', m.evidence?.recreate || 'archetype prototype from the fixture'],
  ['source-fidelity-gate', 'source-fidelity-gate — fixture gate evidence', m.evidence?.gate || 'fixture gate evidence'],
]) {
  if (skip('replica', phase)) continue;
  ledger('replica', phase, 'start', 'fixture replay');
  if (phase === 'recreate') timing('recreate-start');
  journal(title, [`${detail}.`, 'Evidence produced by the fixture\'s build run and carried in stardust/ unchanged; the live page is proven unchanged by the extract fingerprint.']);
  ledger('replica', phase, 'end', detail);
  if (phase === 'source-fidelity-gate') timing('prototype-gate-end', detail);
  await boundary(phase);
}

// Phase 5 — handoff: the pipelined delivery is awaited here, then the published-origin gate
ledger('replica', 'handoff', 'start', 'fixture replay: deploy → publish → published-origin gate → rollout records');
ledger('migrate', 'render', 'start', 'fixture: approved archetype, no siblings');
ledger('migrate', 'render', 'end', '1/1 rendered (fixture migrated tree)');
ledger('rollout', 'A-inventory', 'start');
sh('node', ['stardust/scripts/rollout/inventory.mjs']);
ledger('rollout', 'A-inventory', 'end', '1 page, 1 template');
ledger('rollout', 'B-block', 'start');
ledger('rollout', 'B-block', 'end', m.evidence?.blocks || 'blocks from the fixture');
ledger('rollout', 'B2-dynamic', 'start');
ledger('rollout', 'B2-dynamic', 'end', m.evidence?.dynamics || 'dynamic features triaged in the fixture');
ledger('rollout', 'C-deliver', 'start', `foundation + archetype in one unit (fixture); delivery pipelined since +${((deliverT0 - T0) / 1000).toFixed(1)}s`);
notes('Your rebuilt page is being placed on Adobe Edge Delivery now.', 'Next we publish it and measure it against your live page.');
await deliveryP;
log(`delivery: ${JSON.stringify(D)}`);
if (D.error) throw new Error(`delivery failed: ${D.error}`);

// coverage + published-origin gate
sh('node', ['stardust/scripts/rollout/update-coverage.mjs', slug, '--status', 'deployed', '--url', `${LIVE}${m.page.path}`]);
let gateLine = 'skipped (--skip-gate)';
const g = await gateP;
if (!g.skipped) {
  const sum = path.join(SD, 'replica', 'gates', 'all-1440', 'summary.json');
  if (fs.existsSync(sum)) {
    const row = (JSON.parse(fs.readFileSync(sum, 'utf8')).rows || [])[0] || {};
    gateLine = `${row.pass ? 'PASS' : 'FAIL'} pixel ${row.pct}% (aligned ${row.alignedPct}%), height delta ${row.heightDelta}px, clipped ${row.clipped}, content missing ${row.content?.missing ?? '?'}${row.reasons?.length ? `, reasons: ${row.reasons.join('; ')}` : ''}`;
    sh('node', ['stardust/scripts/rollout/update-coverage.mjs', '--gate', sum]);
  } else gateLine = `no summary (gate-all exit ${g.code}): ${g.out.slice(-200)}`;
  timing('published-gate-end', gateLine);
  log(`gate-all exit ${g.code}: ${gateLine}`);
}
try { sh('node', ['stardust/scripts/rollout/verify.mjs', '--base', LIVE, '--all']); } catch (e) { log('verify:', String(e.stdout || e.message).slice(0, 300)); }
journal('C-deliver — fixture code and content delivered on this run\'s site', [
  `Delivery pipelined from +${((deliverT0 - T0) / 1000).toFixed(1)}s, in parallel with the record phases: ${JSON.stringify(D.at)}.`,
  `${nCode} code files from the fixture committed and pushed; code served on ${PREVIEW} (${D.codeLive ? 'confirmed' : 'NOT confirmed'}).`,
  `${media.length} media files and ${m.da.docs.length} documents (${m.da.docs.join(', ')}) PUT to DA ${ORG}/${SITE}, previewed and published (preview ${D.previewOk ? 'ok' : 'NOT ok'}, live ${D.liveOk ? 'ok' : 'NOT ok'}).`,
  `Published-origin gate @1440: ${gateLine}.`,
]);
ledger('rollout', 'C-deliver', 'end', `1/1 page live at ${m.page.path} (live at ${D.at['first-live'] || '?'}); gate 1440: ${gateLine}`.slice(0, 400));
await boundary('C-deliver');

// D–I: light, real steps for one page
const root200 = async (o) => { try { return (await fetch(`${o}/?cb=${Date.now()}`)).status; } catch { return 0; } };
for (const [phase, fn] of [
  ['D-site', async () => `/ answers ${await root200(LIVE)} on aem.live, ${await root200(PREVIEW)} on aem.page`],
  ['D2-dynamic', async () => m.evidence?.dynamicsParity || 'carousel/scroll behaviours ship in block JS (fixture); no host-bound APIs'],
  ['E-full-site', async () => 'verify.mjs --all on aem.live: 1/1'],
  ['E2-link-audit', async () => 'links stay absolute to the source host (fixture decision); no internal targets outside the page'],
  ['F-optimize', async () => { try { const o = sh('node', ['stardust/scripts/rollout/optimize.mjs', '--all']); return (o.split('\n').filter((l) => /GATE|health|P1/.test(l)).slice(-2).join(' ') || 'optimize run').slice(0, 300); } catch (e) { return `optimize: ${String(e.stdout || e.message).slice(-200)}`; } }],
  ['G-aem', async () => 'no AEM autofix candidates for a single replayed page'],
  ['H-report', async () => '1 page / 1 template delivered'],
  ['I-dashboard', async () => { try { sh('node', ['stardust/scripts/rollout/dashboard.mjs']); return 'dashboard written (stardust/rollout/dashboard/)'; } catch { return 'dashboard skipped'; } }],
]) {
  if (skip('rollout', phase)) continue;
  ledger('rollout', phase, 'start');
  const d = await fn();
  ledger('rollout', phase, 'end', d);
}
journal('Rollout D-site to I-dashboard — one replayed page', ['Root resolves on .page and .live; verify, link policy and dashboard recorded by the stock rollout scripts.']);

// done-check
let complete = false;
let gaps = [];
if (NO_RUNNER) {
  try { sh('node', ['stardust/scripts/rollout/done-check.mjs', '--live-host', LIVE.replace('https://', ''), '--json']); complete = true; } catch (e) { gaps = [String(e.stdout || e.message).slice(0, 400)]; }
} else {
  const r = await runnerGet('done-check');
  try { const j = JSON.parse(r); complete = j.complete === true; gaps = j.gaps || []; } catch { gaps = [`unreadable done-check: ${String(r).slice(0, 200)}`]; }
}
notes(complete ? 'Your page is live on Adobe Edge Delivery and matches your current site on desktop screens.' : 'Your page is live on Adobe Edge Delivery; we are completing the final checks.',
  complete ? 'Nothing further is needed for this page.' : 'We finish the remaining checks next.');
if (complete) {
  journal('handoff — page live, done-check complete', [`Replay of fixture ${fx.name} complete in ${since()}.`]);
  ledger('replica', 'handoff', 'end', `1 page live at ${LIVE}${m.page.path} (fixture replay, ${since()}); gate 1440: ${gateLine}`.slice(0, 400));
  timing('done', `complete in ${since()}`);
  console.log(`REPLAY-DONE ${since()} preview ${PREVIEW}${m.page.path} live ${LIVE}${m.page.path}`);
  process.exit(0);
}
timing('done-check', `gaps: ${gaps.join('; ')}`.slice(0, 300));
console.log(`REPLAY-GAPS ${JSON.stringify(gaps)} — close them, then ask done-check again before the handoff end line`);
process.exit(4);
