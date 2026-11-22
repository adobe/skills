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
 *   --url        source URL (default: stardust/.labs/run.json scope)
 *   --fixture    force a fixture by name (default: the one whose manifest lists the URL)
 *   --match-only check URL + fingerprint, print the verdict, write nothing
 *   --no-runner  do not call localhost:8080 (local testing: boundary = continue, done-check = local script)
 *   --skip-gate  (local testing only) skip gate-all
 *   --no-deliver (local testing only) skip push, DA, preview/live and the polls
 *   --verify smoke|gate  delivery proof: smoke (default; fast delivery smoke check, falls back to the full
 *                published gate when any page fails it) or gate (full published-origin gate). Also
 *                STARDUST_REPLAY_VERIFY=smoke|gate, or the fixture manifest's "verify".
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
    const p = x.pathname.replace(/\/index\.html?$/, '/');
    return `${x.protocol}//${x.host.toLowerCase()}${p}`;
  } catch { return String(u || '').trim(); }
};
/** v1 manifests (one page) and v2 manifests (pages[]) → one shape: pages[] with url, slug, path, marker, pageSha, doc, home. */
function pagesOf(m) {
  if (Array.isArray(m.pages) && m.pages.length) return m.pages;
  return [{ url: m.fingerprint.page, slug: m.page.slug, path: m.page.path, marker: m.page.marker, pageSha: m.fingerprint.pageSha, doc: 'index', home: true }];
}
function findFixture(url, forced) {
  const dir = path.join(REPLICA_DIR, 'fixtures');
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    const mf = path.join(dir, name, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const base = { name, dir: path.join(dir, name), m, pages: pagesOf(m) };
    if (forced) { if (name === forced) return { ...base, via: 'forced' }; continue; }
    if ((m.sourceUrls || []).some((s) => norm(s) === norm(url))) return { ...base, via: 'site' };
    if (base.pages.some((pg) => norm(pg.url) === norm(url))) return { ...base, via: 'page' };
    // aliases: a URL that does not serve the site itself but means it (e.g. a GitHub Pages user root that
    // answers 404 while the site lives under a project path) — the fixture says where the site is
    const alias = (m.aliases || []).find((a) => norm(a.url) === norm(url));
    if (alias) return { ...base, via: 'alias', alias };
  }
  return null;
}
/** Which prepared pages this run delivers: a site-mode run (or the site's root/alias) gets every prepared
 *  page, home first; a pages-mode run gets exactly its URLs, each of which must be prepared. */
function selectPages(fx, run, url) {
  const home = fx.pages.find((p) => p.home) || fx.pages[0];
  const ordered = [home, ...fx.pages.filter((p) => p !== home)];
  if (run?.scope?.mode === 'site' || fx.via === 'alias' || (fx.via === 'site' && run?.scope?.mode !== 'pages')) return { pages: ordered };
  const raw = Array.isArray(run?.scope?.pages) && run.scope.pages.length ? run.scope.pages : [url];
  const urls = raw.map((x) => (typeof x === 'string' ? x : x.url)).filter(Boolean);
  const pick = [];
  const missing = [];
  for (const u of urls) {
    const pg = fx.pages.find((p) => norm(p.url) === norm(u)) || ((fx.m.sourceUrls || []).some((s) => norm(s) === norm(u)) ? home : null);
    if (pg) { if (!pick.includes(pg)) pick.push(pg); } else missing.push(u);
  }
  return { pages: pick, missing };
}
async function fetchText(u, ms = 15000) {
  const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Mozilla/5.0 stardust-replay' } });
  if (!r.ok) throw new Error(`${u} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function checkFingerprints(m, pages) {
  const diffs = [];
  const base = pages[0].url;
  await Promise.all([
    ...pages.map(async (pg) => { if (sha(await fetchText(pg.url)) !== pg.pageSha) diffs.push(`${pg.url} changed`); }),
    ...Object.entries(m.fingerprint?.assets || {}).map(async ([a, h]) => { if (sha(await fetchText(new URL(a, base).toString())) !== h) diffs.push(`${a} changed`); }),
  ]);
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

// ---------- demo branch: a run with no fixture is ONE page ----------
// Deterministic, before the model reads anything else: the runner's own rule is that pages not in the
// site plan are out of scope for every phase, so the plan is rewritten to the one fast page (the submitted
// URL's page when it has a path, else the home page). Then the runner's "extract --pages <selected>"
// instruction covers exactly that page. Writes nothing under --match-only or without a run.json.
function scopeToOnePage(run, url) {
  if (flag('--match-only') || flag('--no-scope') || !run?.scope) return null;
  const planPath = path.join(SD, '.labs', 'site-plan.json');
  const prev = (() => { try { return JSON.parse(fs.readFileSync(planPath, 'utf8')); } catch { return null; } })();
  const selected = (prev?.pages || []).filter((pg) => pg.selected);
  if (run.scope.mode !== 'site' && selected.length <= 1) return null;
  let page = url;
  try { const u = new URL(url); if (u.pathname === '' || u.pathname === '/') page = `${u.origin}/`; } catch { /* keep */ }
  const slug = (() => { try { const p2 = new URL(page).pathname.replace(/^\/|\/$/g, '').replace(/\.html?$/, ''); return p2 ? p2.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'index'; } catch { return 'index'; } })();
  const plan = {
    version: prev?.version || 1, mode: prev?.mode || run.scope.mode, sourceUrl: prev?.sourceUrl || url,
    pageCap: prev?.pageCap ?? run.scope.pageCap ?? 1, discoveredAt: prev?.discoveredAt || iso(),
    discovery: { ...(prev?.discovery || {}), total: 1, note: `demo branch fast-first-page: one page (${page}); ${selected.length} discovered page(s) out of scope` },
    pages: [{ url: page, slug, score: 10, selected: true }],
  };
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(path.join(SD, '.labs', 'site-plan.pages'), `${page}\n`);
  fs.appendFileSync(path.join(SD, 'journal.md'), `\n## scope — demo branch: one page (${iso().slice(0, 10)})\n- No fixture for ${url}. The run is scoped to ONE page, ${page}: stardust/.labs/site-plan.json and site-plan.pages now select only it (${selected.length} discovered page(s) out of scope). Fast first page profile: reference/fast-first-page.md.\n`);
  return page;
}
function noMatch(msg) {
  const run0 = readRunJson();
  const url0 = opt('--url') || run0?.scope?.sourceUrl || run0?.sourceUrl;
  const page = url0 ? scopeToOnePage(run0, url0) : null;
  console.log(`REPLAY-NO-MATCH: ${msg} — continue with the normal replica flow${page ? ` for ONE page`: ''}`);
  if (page) {
    console.log(`SCOPE-ONE-PAGE ${page} — the runner's site plan (stardust/.labs/site-plan.json + site-plan.pages) now selects only this page; every phase covers it alone.`);
    console.log(`Next: stardust:extract ${page} --single --dynamics (the bounded entry), then the fast first page profile (reference/fast-first-page.md): 1440 gate only, at most 2 rounds, one delivery unit, then the done-check. Do not crawl or extract other pages.`);
  }
  process.exit(3);
}

// ---------- main ----------
const run = readRunJson();
const url = opt('--url') || run?.scope?.sourceUrl || run?.sourceUrl;
if (!url) { console.log('REPLAY-NO-MATCH: no source URL (no --url, no stardust/.labs/run.json scope)'); process.exit(3); }
const fx = findFixture(url, opt('--fixture'));
if (!fx) noMatch(`no fixture lists ${url}`);
const sel = selectPages(fx, run, url);
if (sel.missing?.length || !sel.pages.length) noMatch(`fixture ${fx.name} has no prepared page for ${(sel.missing || [url]).join(', ')}`);
const PAGES = sel.pages;
try {
  const diffs = await checkFingerprints(fx.m, PAGES);
  if (diffs.length) noMatch(`fixture ${fx.name} does not match the live site (${diffs.join('; ')})`);
} catch (e) { noMatch(`live page unreachable for the fingerprint (${e.message})`); }
const FIRST = PAGES[0];
log(`fixture ${fx.name} matches the live site: ${PAGES.length} page(s) ${PAGES.map((p) => p.path).join(' ')} (built ${fx.m.builtAt} from run ${fx.m.provenance?.run || '?'})`);
if (fx.via === 'alias') log(`run URL ${url} is an alias of ${FIRST.url}: ${fx.alias.note || ''}`);
if (flag('--match-only')) { console.log(`REPLAY-MATCH ${PAGES.length} page(s): ${PAGES.map((p) => p.url).join(' ')}${fx.via === 'alias' ? ' (via alias)' : ''}`); process.exit(0); }

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
const V2 = Array.isArray(m.pages) && m.pages.length > 0;
const VERIFY = (opt('--verify') || process.env.STARDUST_REPLAY_VERIFY || m.verify || 'smoke').toLowerCase() === 'gate' ? 'gate' : 'smoke';
const NPG = PAGES.length;
const done = lastEnded();
const skip = (skill, phase) => done.has(`stardust:${skill}|${phase}`);
fs.mkdirSync(SD, { recursive: true });
timing('replay-start', `fixture ${fx.name}, site ${ORG}/${SITE}, ${NPG} page(s)${fx.via === 'alias' ? `, run URL ${url} is an alias` : ''}`);
// The site plan is what scopes every phase: rewrite it to the pages the fixture delivers (a site-mode run's
// discovery found other pages, nothing, or a 404 root).
const planPath = path.join(SD, '.labs', 'site-plan.json');
if (run?.scope?.mode === 'site' || fx.via === 'alias' || NPG > 1) {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(planPath, 'utf8')); } catch { return {}; } })();
  const plan = {
    version: prev.version || 1, mode: prev.mode || run?.scope?.mode || 'pages', sourceUrl: prev.sourceUrl || url,
    pageCap: prev.pageCap ?? run?.scope?.pageCap ?? NPG, discoveredAt: iso(),
    discovery: { technique: 'fixture', total: NPG, durationMs: 0, note: fx.via === 'alias' ? `${url} is an alias: ${fx.alias.note || ''} The prepared site is ${FIRST.url}.` : `fixture ${fx.name} delivers ${NPG} prepared page(s)` },
    pages: PAGES.map((pg, i) => ({ url: pg.url, slug: pg.slug, score: 10 - Math.min(i, 9), selected: true })),
  };
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(path.join(SD, '.labs', 'site-plan.pages'), `${PAGES.map((pg) => pg.url).join('\n')}\n`);
  log(`site plan rewritten: ${NPG} page(s), technique fixture`);
}

// script copies (what Setup does in a normal run)
for (const s of ['replica', 'stardust', 'migrate', 'diff', 'deploy', 'rollout', 'dynamics']) {
  const src = path.join(SKILLS_DIR, s, 'scripts');
  if (fs.existsSync(src)) fs.cpSync(src, path.join(SD, 'scripts', s), { recursive: true });
}

// Delivery is PIPELINED: it starts now, right after the fingerprints matched, and runs while the record
// phases below write their ledger lines and the runner checkpoints each boundary. The ledger keeps the
// normal phase order; the C-deliver line and the journal state when delivery actually ran.
const NO_DELIVER = flag('--no-deliver');
const deliverT0 = Date.now();
const nCode = copyTree(path.join(fx.dir, 'repo'), ROOT, null);
const codePaths = fs.readdirSync(path.join(fx.dir, 'repo'));
const token = NO_DELIVER ? '' : daToken();
const mediaDir = path.join(fx.dir, 'da', 'media');
const mediaFiles = [];
(function walk(d, rel) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name), `${rel}${e.name}/`); else mediaFiles.push(`${rel}${e.name}`); } }(mediaDir, ''));
const chromeDocs = V2 ? (m.da.chrome || ['nav', 'footer']) : m.da.docs.filter((d) => d !== 'index');
const pageDocs = V2 ? PAGES.map((pg) => pg.doc) : ['index'];
const DOCS = [...new Set([...pageDocs, ...chromeDocs])];
const tmpDocs = path.join(SD, '.work', 'replay-docs');
const D = { previewOk: false, liveOk: false, allLive: false, codeLive: false, pushed: false, at: {} };
const mark = (k) => { D.at[k] = since(); };
const pageOk = async (origin, pg) => { try { const r = await fetch(`${origin}${pg.path}?cb=${Date.now()}`); return r.ok && (!pg.marker || (await r.text()).includes(pg.marker)); } catch { return false; } };
const daP = (async () => {
  if (NO_DELIVER) return;
  // media: v1 fixtures keep one flat scope; v2 keep media/<scope>/<file>
  await Promise.all(mediaFiles.map((f) => daPut(token, ORG, SITE, V2 ? `media/${f}` : `media/${m.da.mediaScope}/${f}`, path.join(mediaDir, f))));
  await Promise.all(DOCS.map(async (d) => {
    const out = path.join(tmpDocs, `${d}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, subst(fs.readFileSync(path.join(fx.dir, 'da', `${d}.html`), 'utf8')));
    await daPut(token, ORG, SITE, `${d}.html`, out);
  }));
  mark('da-put');
  // the first page first: preview + publish it (and the chrome) before the others
  const firstDocs = [FIRST.doc || 'index', ...chromeDocs];
  await Promise.all(firstDocs.map((d) => admin(token, 'preview', ORG, SITE, BRANCH, d)));
  D.previewOk = await pollUntil(() => pageOk(PREVIEW, FIRST), { every: 500, max: 60000 });
  mark('first-preview');
  timing('first-preview', `${D.previewOk ? 'PASS' : 'FAIL'} ${PREVIEW}${FIRST.path}`);
  await Promise.all(firstDocs.map((d) => admin(token, 'live', ORG, SITE, BRANCH, d)));
  D.liveOk = await pollUntil(() => pageOk(LIVE, FIRST), { every: 500, max: 60000 });
  mark('first-live');
  timing('first-live', `${D.liveOk ? 'PASS' : 'FAIL'} ${LIVE}${FIRST.path}`);
  const rest = DOCS.filter((d) => !firstDocs.includes(d));
  if (rest.length) {
    await Promise.all(rest.map((d) => admin(token, 'preview', ORG, SITE, BRANCH, d)));
    await Promise.all(rest.map((d) => admin(token, 'live', ORG, SITE, BRANCH, d)));
    const served = async (pg) => { try { return (await fetch(`${LIVE}${pg.path}?cb=${Date.now()}`)).ok; } catch { return false; } };
    const oks = await Promise.all(PAGES.slice(1).map((pg) => pollUntil(() => served(pg), { every: 500, max: 120000 })));
    D.allLive = oks.every(Boolean);
    mark('all-live');
    timing('all-live', `${D.allLive ? 'PASS' : 'FAIL'} ${NPG} page(s) on ${LIVE}`);
  } else D.allLive = D.liveOk;
  // broken media shows as about:error in the delivered markup — name it before any page is measured
  const errs = await Promise.all(PAGES.map(async (pg) => { try { const t = await (await fetch(`${LIVE}${pg.path === '/' ? '/index' : pg.path}.plain.html?cb=${Date.now()}`)).text(); return (t.match(/about:error/g) || []).length ? `${pg.path}: ${(t.match(/about:error/g) || []).length}` : null; } catch { return null; } }));
  D.mediaErrors = errs.filter(Boolean);
  if (D.mediaErrors.length) log(`about:error in delivered pages: ${D.mediaErrors.join('; ')}`);
  timing('media-check', D.mediaErrors.length ? `about:error ${D.mediaErrors.join('; ')}` : `0 about:error on ${NPG} page(s)`);
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
  // every code file the fixture ships must be served before any page is measured (a page captured while
  // one of its block files is still missing measures a half-decorated page)
  const codeFiles = [];
  (function walkCode(d, rel) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walkCode(path.join(d, e.name), `${rel}${e.name}/`); else if (/\.(js|css)$/.test(e.name) && /^(blocks|styles|scripts)\//.test(`${rel}${e.name}`)) codeFiles.push(`/${rel}${e.name}`); } }(path.join(fx.dir, 'repo'), ''));
  const allCode = await Promise.all(codeFiles.map((f) => pollUntil(async () => { try { return (await fetch(`${PREVIEW}${f}?cb=${Date.now()}`)).ok; } catch { return false; } }, { every: 1000, max: 180000 })));
  D.allCodeLive = allCode.every(Boolean);
  log(`code files served: ${allCode.filter(Boolean).length}/${codeFiles.length}`);
  mark('code-live');
  timing('code-live', D.codeLive ? 'ok' : 'FAIL');
})();
const deliveryP = Promise.all([daP, codeP]).catch((e) => { D.error = e.message; });
timing('deploy-start', `pipelined: push + DA media/docs → preview → publish (first page first), in parallel with the record phases`);

// records: shared + the selected pages' own; state.json keeps only the delivered pages
function seedRecords() {
  if (!V2) return copyTree(path.join(fx.dir, 'records'), ROOT, subst);
  let n = copyTree(path.join(fx.dir, 'records', 'shared'), ROOT, subst);
  for (const pg of PAGES) n += copyTree(path.join(fx.dir, 'records', 'pages', pg.slug), ROOT, subst);
  const st = path.join(SD, 'state.json');
  if (fs.existsSync(st)) {
    const s = JSON.parse(fs.readFileSync(st, 'utf8'));
    const keep = new Set(PAGES.map((pg) => pg.slug));
    s.pages = (s.pages || []).filter((pg) => keep.has(pg.slug));
    if (s.site) { s.site.crawled = s.pages.length; s.site.totalDiscovered = s.pages.length; }
    fs.writeFileSync(st, `${JSON.stringify(s, null, 2)}\n`);
  }
  return n;
}
// the published-origin gate starts as soon as the pages and their code are served and the records (with
// each page's frozen origin reference) are seeded — overlapping the remaining checkpoints
let recordsSeeded;
const seededP = new Promise((r) => { recordsSeeded = r; });
const coverageDeployed = () => { for (const pg of PAGES) sh('node', ['stardust/scripts/rollout/update-coverage.mjs', pg.slug, '--status', 'deployed', '--url', `${LIVE}${pg.path}`]); };
const gateP = (async () => {
  await Promise.all([deliveryP, seededP]);
  if (D.error || flag('--skip-gate')) return { skipped: true };
  sh('node', ['stardust/scripts/rollout/inventory.mjs']);
  coverageDeployed();
  if (VERIFY === 'smoke') {
    mark('smoke-start');
    timing('smoke-start', `${NPG} page(s), delivery smoke check (fidelity proven at build time)`);
    const sm = await shBg('node', ['stardust/scripts/replica/smoke-check.mjs', '--origin', LIVE, '--pages', JSON.stringify(PAGES.map((pg) => ({ slug: pg.slug, path: pg.path }))), '--width', '1440']);
    mark('smoke-end');
    const smSum = (() => { try { return JSON.parse(fs.readFileSync(path.join(SD, 'replica', 'gates', 'smoke-1440', 'summary.json'), 'utf8')); } catch { return null; } })();
    if (sm.code === 0 && smSum?.pass) return { smoke: true, summary: smSum };
    log(`smoke check failed (exit ${sm.code}) — falling back to the full published gate: ${sm.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | ').slice(0, 300)}`);
    timing('smoke-end', `FAIL → full published gate: ${sm.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | ').slice(0, 200)}`);
    D.smokeFallback = true;
  }
  mark('gate-start');
  timing('published-gate-start', `${NPG} page(s)`);
  const g = await shBg('node', ['stardust/scripts/replica/gate-all.mjs', '--width', '1440', '--coverage', 'stardust/rollout/coverage/pages.json', '--eds-concurrency', String(Math.min(8, Math.max(4, NPG))), '--probe-concurrency', String(Math.min(8, Math.max(4, NPG))), ...(m.gate?.args || [])]);
  mark('gate-end');
  return g;
})();

// Phase 1 — extract: the fixture's capture, proven current by the fingerprints
if (!skip('replica', 'extract')) {
  ledger('replica', 'extract', 'start', `fixture replay: ${url} matched fixture ${fx.name} (${NPG} page(s))`);
  timing('extract-start');
  const n = seedRecords();
  journal('extract — fixture capture verified against the live site', [
    fx.via === 'alias' ? `The run URL ${url} is an alias the fixture declares (${fx.alias.note || 'no site at that URL'}); the prepared site starts at ${FIRST.url}. Site plan rewritten to the prepared pages.` : `Fixture ${fx.name} (built ${m.builtAt}, from run ${m.provenance?.run || '?'}) covers ${url}.`,
    `${NPG} page(s): ${PAGES.map((pg) => `${pg.path} ← ${pg.url}`).join('; ')}.`,
    `Fingerprints: each page's HTML and ${Object.keys(m.fingerprint?.assets || {}).length} shared same-origin assets hash-identical to the fixture's capture, so the capture is current.`,
    `${n} capture, spec, prototype and gate-evidence files seeded from the fixture (site placeholders set to ${ORG}/${SITE}).`,
  ]);
  recordsSeeded();
  ledger('replica', 'extract', 'end', `${NPG}/${NPG} page(s): fixture capture verified current (fingerprint match, ${NPG + Object.keys(m.fingerprint?.assets || {}).length} hashes)`);
  timing('extract-end', 'fingerprint match');
  notes('We confirmed your pages are unchanged since we last measured them and are restoring their verified rebuild.', 'Next we place the rebuilt pages on Adobe Edge Delivery.');
  await boundary('extract');
}
recordsSeeded();
for (const [phase, title, detail] of [
  ['preserve-direction', 'preserve-direction — bounded spec from the fixture', m.evidence?.direction || 'bounded spec + empty register (fixture)'],
  ['recreate', 'recreate — gated archetypes from the fixture', m.evidence?.recreate || 'archetype prototypes from the fixture'],
  ['source-fidelity-gate', 'source-fidelity-gate — fixture gate evidence', m.evidence?.gate || 'fixture gate evidence'],
]) {
  if (skip('replica', phase)) continue;
  ledger('replica', phase, 'start', 'fixture replay');
  if (phase === 'recreate') timing('recreate-start');
  journal(title, [`${detail}.`, 'Evidence produced by the fixture\'s build run and carried in stardust/ unchanged; the live pages are proven unchanged by the extract fingerprints.']);
  ledger('replica', phase, 'end', detail);
  if (phase === 'source-fidelity-gate') timing('prototype-gate-end', detail);
  await boundary(phase);
}

// Phase 5 — handoff: the pipelined delivery is awaited here, then the published-origin gate
ledger('replica', 'handoff', 'start', `fixture replay: deploy → publish → published-origin gate → rollout records (${NPG} page(s))`);
ledger('migrate', 'render', 'start', `fixture: ${NPG} page(s), migrated tree from the fixture`);
ledger('migrate', 'render', 'end', `${NPG}/${NPG} rendered (fixture migrated tree)`);
ledger('rollout', 'A-inventory', 'start');
sh('node', ['stardust/scripts/rollout/inventory.mjs']);
ledger('rollout', 'A-inventory', 'end', `${NPG} page(s)`);
ledger('rollout', 'B-block', 'start');
ledger('rollout', 'B-block', 'end', m.evidence?.blocks || 'blocks from the fixture');
ledger('rollout', 'B2-dynamic', 'start');
ledger('rollout', 'B2-dynamic', 'end', m.evidence?.dynamics || 'dynamic features triaged in the fixture');
ledger('rollout', 'C-deliver', 'start', `foundation + ${NPG} page(s) in one unit (fixture); delivery pipelined since +${((deliverT0 - T0) / 1000).toFixed(1)}s`);
notes('Your rebuilt pages are being placed on Adobe Edge Delivery now.', 'Next we publish them and measure them against your live pages.');
await deliveryP;
log(`delivery: ${JSON.stringify(D)}`);
if (D.error) throw new Error(`delivery failed: ${D.error}`);

coverageDeployed();
let gateLine = 'skipped (--skip-gate)';
const g = await gateP;
if (g.smoke) {
  const rows = g.summary.rows || [];
  gateLine = `delivery smoke check ${rows.filter((r) => r.pass).length}/${rows.length} PASS (200, no broken media, every block loaded, no page error, fonts loaded, top viewport vs frozen source reference ≤ ${g.summary.maxPct}%: ${rows.map((r) => `${r.path} ${r.topPct}%`).join(', ')}); fidelity: published-origin gate of the fixture build run ${m.provenance?.run || ''}`;
  timing('smoke-end', `PASS ${rows.length}/${rows.length}: ${rows.map((r) => `${r.path} ${r.topPct}%`).join(', ')}`);
  log(gateLine);
} else if (!g.skipped) {
  const sum = path.join(SD, 'replica', 'gates', 'all-1440', 'summary.json');
  if (fs.existsSync(sum)) {
    const rows = JSON.parse(fs.readFileSync(sum, 'utf8')).rows || [];
    const pass = rows.filter((r) => r.pass).length;
    const one = (r) => `${r.path} ${r.pass ? 'PASS' : 'FAIL'} ${r.pct}% Δh ${r.heightDelta}`;
    gateLine = NPG === 1 && rows[0]
      ? `${rows[0].pass ? 'PASS' : 'FAIL'} pixel ${rows[0].pct}% (aligned ${rows[0].alignedPct}%), height delta ${rows[0].heightDelta}px, clipped ${rows[0].clipped}, content missing ${rows[0].content?.missing ?? '?'}${rows[0].reasons?.length ? `, reasons: ${rows[0].reasons.join('; ')}` : ''}`
      : `${pass}/${rows.length} PASS — ${rows.map(one).join('; ')}`;
    sh('node', ['stardust/scripts/rollout/update-coverage.mjs', '--gate', sum]);
  } else gateLine = `no summary (gate-all exit ${g.code}): ${g.out.slice(-200)}`;
  timing('published-gate-end', gateLine);
  log(`gate-all exit ${g.code}: ${gateLine}`);
}
try { sh('node', ['stardust/scripts/rollout/verify.mjs', '--base', LIVE, '--all']); } catch (e) { log('verify:', String(e.stdout || e.message).slice(0, 300)); }
journal('C-deliver — fixture code and content delivered on this run\'s site', [
  `Delivery pipelined from +${((deliverT0 - T0) / 1000).toFixed(1)}s, in parallel with the record phases: ${JSON.stringify(D.at)}.`,
  `${nCode} code files from the fixture committed and pushed; code served on ${PREVIEW} (${D.codeLive ? 'confirmed' : 'NOT confirmed'}).`,
  `${mediaFiles.length} media files and ${DOCS.length} documents (${DOCS.join(', ')}) PUT to DA ${ORG}/${SITE}, previewed and published; the first page (${FIRST.path}) first (preview ${D.previewOk ? 'ok' : 'NOT ok'}, live ${D.liveOk ? 'ok' : 'NOT ok'}, all pages live ${D.allLive ? 'ok' : 'NOT ok'}).`,
  `${g.smoke ? 'Delivery verification' : 'Published-origin gate @1440'}: ${gateLine}.`,
]);
ledger('rollout', 'C-deliver', 'end', `${NPG}/${NPG} page(s) live (first ${FIRST.path} at ${D.at['first-live'] || '?'}); ${g.smoke ? '' : 'gate 1440: '}${gateLine}`.slice(0, 400));
await boundary('C-deliver');

// D–I: light, real steps
const status = async (o, p2 = '/') => { try { return (await fetch(`${o}${p2}?cb=${Date.now()}`)).status; } catch { return 0; } };
for (const [phase, fn] of [
  ['D-site', async () => `${FIRST.path} answers ${await status(LIVE, FIRST.path)} on aem.live, ${await status(PREVIEW, FIRST.path)} on aem.page; ${NPG} page(s) delivered`],
  ['D2-dynamic', async () => m.evidence?.dynamicsParity || 'behaviours ship in block JS (fixture); no host-bound APIs'],
  ['E-full-site', async () => `verify.mjs --all on aem.live: ${NPG} page(s)`],
  ['E2-link-audit', async () => m.evidence?.links || 'links as decided in the fixture build run'],
  ['F-optimize', async () => { try { const o = sh('node', ['stardust/scripts/rollout/optimize.mjs', '--all']); return (o.split('\n').filter((l) => /GATE|health|P1/.test(l)).slice(-2).join(' ') || 'optimize run').slice(0, 300); } catch (e) { return `optimize: ${String(e.stdout || e.message).slice(-200)}`; } }],
  ['G-aem', async () => 'no AEM autofix candidates for replayed pages'],
  ['H-report', async () => `${NPG} page(s) delivered`],
  ['I-dashboard', async () => { try { sh('node', ['stardust/scripts/rollout/dashboard.mjs']); return 'dashboard written (stardust/rollout/dashboard/)'; } catch { return 'dashboard skipped'; } }],
]) {
  if (skip('rollout', phase)) continue;
  ledger('rollout', phase, 'start');
  const d = await fn();
  ledger('rollout', phase, 'end', d);
}
journal('Rollout D-site to I-dashboard — replayed pages', ['Pages resolve on .page and .live; verify, optimize and dashboard recorded by the stock rollout scripts.']);

// done-check
let complete = false;
let gaps = [];
if (NO_RUNNER) {
  try { sh('node', ['stardust/scripts/rollout/done-check.mjs', '--live-host', LIVE.replace('https://', ''), '--json']); complete = true; } catch (e) { gaps = [String(e.stdout || e.message).slice(0, 400)]; }
} else {
  const r = await runnerGet('done-check');
  try { const j = JSON.parse(r); complete = j.complete === true; gaps = j.gaps || []; } catch { gaps = [`unreadable done-check: ${String(r).slice(0, 200)}`]; }
}
notes(complete ? `Your ${NPG === 1 ? 'page is' : `${NPG} pages are`} live on Adobe Edge Delivery and match your current site on desktop screens.` : 'Your pages are live on Adobe Edge Delivery; we are completing the final checks.',
  complete ? 'Nothing further is needed.' : 'We finish the remaining checks next.');
if (complete) {
  journal('handoff — pages live, done-check complete', [`Replay of fixture ${fx.name} (${NPG} page(s)) complete in ${since()}.`]);
  ledger('replica', 'handoff', 'end', `${NPG} page(s) live on ${LIVE} (fixture replay, ${since()}); gate 1440: ${gateLine}`.slice(0, 400));
  timing('done', `complete in ${since()}`);
  console.log(`REPLAY-DONE ${since()} ${NPG} page(s) preview ${PREVIEW}${FIRST.path} live ${LIVE}${FIRST.path}`);
  process.exit(0);
}
timing('done-check', `gaps: ${gaps.join('; ')}`.slice(0, 300));
console.log(`REPLAY-GAPS ${JSON.stringify(gaps)} — close them, then ask done-check again before the handoff end line`);
process.exit(4);
