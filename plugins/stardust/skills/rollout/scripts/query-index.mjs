#!/usr/bin/env node
/**
 * rollout/query-index.mjs — register the site's query index and prove it by read-back.
 *
 * Purpose: the query index is a service two sites register differently — through the
 * admin config service (`config/<org>/sites/<site>/content/query.yaml`) when the token is
 * an org admin, through the repo `helix-query.yaml` otherwise. The script does not guess
 * the site kind: it tries the config route ONCE with the DA token, falls back loudly to the
 * repo yaml on 401/403 (one stderr line, never re-probed), triggers one bulk index job,
 * polls it, then reads every index target back and asserts a published sample page is a
 * row with at least one non-empty Tier-2 property. The read-back, not the route's status,
 * decides. No YAML parser: `indices:` names are compared by regex and the authored file is
 * POSTed whole (the file is the contract of record; a hand merge is what the 409 loop was).
 *
 * Usage:
 *   DA_TOKEN=… node skills/rollout/scripts/query-index.mjs --org <org> --site <site> --yaml helix-query.yaml
 *        [--ref main] [--origin https://main--<site>--<org>.aem.live] [--sample </path>]
 *        [--pages stardust/rollout/coverage/pages.json] [--replace] [--check] [--out stardust/dynamics]
 *        [--admin https://admin.hlx.page] [--timeout 600] [--poll-ms 5000] [--token-env DA_TOKEN] [--help]
 *
 *   --sample     the published page the read-back must find; default: the first coverage row with
 *                delivery.status verified|deployed whose path matches an index include glob
 *   --replace    allow the POST when the remote query.yaml carries index names the file does not
 *   --check      GET + name-level diff only — no POST, no writes (dry run)
 *   --timeout    seconds to wait for the bulk index job (default 600); --poll-ms the poll interval
 *
 * Exit:
 *   0  registered (config route, or repo yaml honoured) AND the read-back found the sample
 *   1  read-back failed with a published sample after the job settled (rows 0 / sample absent) — a real FAIL
 *   2  usage / missing token / unreadable yaml
 *   3  config route denied AND the repo yaml is not honoured (INDEX-CONFIG.md written; owner decision) ·
 *      also: remote index names absent from the file and no --replace (nothing posted)
 *   4  no verdict — no published in-scope page (preview-only run), admin API unreachable, or the job
 *      never settled; never a FAIL
 *
 * Writes (never under --check):
 *   <out>/index-status.json   { _provenance, registered: "config"|"repo-yaml"|"denied"|null, indices[], job, sample, exit, at }
 *   <out>/query.yaml          mirror of the file the config route accepted
 *   <out>/../rollout/INDEX-CONFIG.md  on `denied` — sheet/include/exclude/columns table + the yaml, for an org admin
 *
 * Hit-minimisation: zero requests to the source site. Only the admin API (one config GET, at most
 * one config POST, one index POST, job polls) and the target origin (one GET per index page) are hit.
 * The token value is never printed. Importing this module runs nothing; the pure helpers
 * (indexNames, parseIndices, compareIndices, pickSample, exitCodeFor) are exported for tests.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJSON, writeJSON } from './lib.mjs';

const TAG = '[query-index]';
const unquote = (s) => String(s || '').trim().replace(/^["']|["']$/g, '');
// Tier-1 (page-intrinsic / built-in) columns; anything else an index defines is Tier-2 metadata
const TIER1 = new Set(['path', 'title', 'image', 'description', 'lastModified', 'robots', 'text']);

/* ------------------------------------------------------------ yaml (regex) --- */
/** Index definitions read off the YAML text by line walk: [{ name, target, include[], exclude[], properties[] }]. */
export function parseIndices(yamlText) {
  const lines = String(yamlText || '').split('\n');
  const start = lines.findIndex((l) => /^indices:\s*$/.test(l));
  if (start < 0) return [];
  const out = []; let cur = null; let nameIndent = null; let keyIndent = null; let section = null; let propIndent = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    if (indent === 0) break; // left the indices block
    const key = raw.match(/^ *([\w.-]+):\s*(.*)$/);
    const item = raw.match(/^ *-\s*(.+)$/);
    if (nameIndent === null) nameIndent = indent;
    if (key && indent === nameIndent) { cur = { name: key[1], target: null, include: [], exclude: [], properties: [] }; out.push(cur); section = null; keyIndent = null; continue; }
    if (!cur) continue;
    if (key && keyIndent === null && indent > nameIndent) keyIndent = indent; // the first key under a name fixes the index-level indent
    if (key && indent === keyIndent) {
      section = key[1]; propIndent = null;
      const val = unquote(key[2]);
      if (section === 'target') cur.target = val;
      if ((section === 'include' || section === 'exclude') && /^\[.*\]$/.test(val)) cur[section].push(...val.slice(1, -1).split(',').map(unquote).filter(Boolean));
      continue;
    }
    if (item && (section === 'include' || section === 'exclude')) { cur[section].push(unquote(item[1])); continue; }
    if (key && section === 'properties') { if (propIndent === null) propIndent = indent; if (indent === propIndent) cur.properties.push(key[1]); }
  }
  return out;
}
/** Top-level `indices:` keys of a helix-query.yaml text. */
export function indexNames(yamlText) { return parseIndices(yamlText).map((x) => x.name); }
/** Name-level diff: { same[], onlyRemote[], onlyLocal[] } — onlyRemote is what --replace would drop. */
export function compareIndices(remote, local) {
  const r = new Set(remote || []); const l = new Set(local || []);
  return { same: [...l].filter((n) => r.has(n)), onlyRemote: [...r].filter((n) => !l.has(n)), onlyLocal: [...l].filter((n) => !r.has(n)) };
}

/* ------------------------------------------------------------------ sample --- */
const globRe = (g) => new RegExp(`^${unquote(g).replace(/\/+$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}/?$`);
const inScope = (path, includes, excludes = []) => includes.some((g) => globRe(g).test(path)) && !excludes.some((g) => globRe(g).test(path));
/** First coverage row published (verified|deployed) whose served path matches an include glob and no exclude; null when none. */
export function pickSample(pages, includes, excludes = []) {
  for (const p of pages || []) {
    const st = p && p.delivery && p.delivery.status;
    if (st !== 'verified' && st !== 'deployed') continue;
    const path = (p.delivery && p.delivery.deployedPath) || p.path;
    if (path && inScope(path, includes, excludes)) return path;
  }
  return null;
}
/** The exit table above, as a pure function of the run's facts. */
export function exitCodeFor({ refused = false, unreachable = false, hasSample = true, sampleFound = false, configDenied = false, settled = true }) {
  if (refused) return 3;
  if (unreachable || !hasSample) return 4;
  if (sampleFound) return 0;
  if (!settled) return 4;
  return configDenied ? 3 : 1;
}

/* --------------------------------------------------------------------- cli --- */
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; }
const has = (f) => process.argv.includes(`--${f}`);
function resolveToken(name) {
  let v = process.env[name];
  if (!v && existsSync('.env')) v = (readFileSync('.env', 'utf8').match(new RegExp(`^(?:export\\s+)?${name}=(.*)$`, 'm')) || [])[1];
  return v ? unquote(v) : null;
}
const writeText = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`); };
/** fetch that never throws: { status, text, json } — status 0 = unreachable */
async function call(url, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, body, signal: ctl.signal });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, text: '', json: null, error: String(e.message || e).slice(0, 80) }; } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const sameRow = (rowPath, sample) => { const n = (s) => String(s || '').replace(/\.html?$/, '').replace(/\/+$/, '') || '/'; return n(rowPath) === n(sample); };

function indexConfigMd({ org, site, admin, indices, yaml, readback }) {
  const rows = indices.map((x) => `| \`${x.name}\` | \`${x.target}\` | ${x.include.map((g) => `\`${g}\``).join(', ') || '—'} | ${x.exclude.map((g) => `\`${g}\``).join(', ') || '—'} | ${x.properties.map((p) => `\`${p}\``).join(', ') || '—'} |`);
  return [
    '# Query index — registration needs an org admin', '',
    `Site \`${org}/${site}\`. The config route answered 401/403 for the run's token, and the repo \`helix-query.yaml\` is not honoured on this site (read-back: ${readback}).`,
    'An org admin registers the file below once; the run then re-runs `node skills/rollout/scripts/query-index.mjs` and needs exit 0 before any index-backed row is marked done.', '',
    '| sheet (index) | target | include | exclude | columns |', '|---|---|---|---|---|', ...rows, '',
    '## How to register (org admin)', '',
    '```sh', `curl -sS -X POST -H "Authorization: Bearer $DA_TOKEN" -H "content-type: text/yaml" \\`,
    `  --data-binary @helix-query.yaml ${admin}/config/${org}/sites/${site}/content/query.yaml`,
    `curl -sS -X POST -H "Authorization: Bearer $DA_TOKEN" ${admin}/index/${org}/${site}/main/*`, '```', '',
    'New definitions need a reindex of existing pages (the second call); one target per index.', '',
    '## helix-query.yaml', '', '```yaml', yaml.trimEnd(), '```',
  ].join('\n');
}

async function main() {
  if (has('help')) {
    console.log('usage: node skills/rollout/scripts/query-index.mjs --org <org> --site <site> --yaml helix-query.yaml [--ref main] [--origin <url>] [--sample </path>] [--pages <coverage/pages.json>] [--replace] [--check] [--out stardust/dynamics] [--admin https://admin.hlx.page] [--timeout 600] [--poll-ms 5000] [--token-env DA_TOKEN]\n  exit 0 registered + sample read back · 1 read-back failed (FAIL) · 2 usage/token · 3 config denied and repo yaml not honoured, or remote names need --replace · 4 no verdict');
    return 0;
  }
  const org = arg('org'); const site = arg('site'); const yamlPath = arg('yaml');
  if (!org || !site || !yamlPath) { console.error(`${TAG} usage: --org <org> --site <site> --yaml <helix-query.yaml> are required (--help for the full list)`); return 2; }
  if (!existsSync(yamlPath)) { console.error(`${TAG} ${yamlPath} not found`); return 2; }
  const tokenEnv = arg('token-env', 'DA_TOKEN');
  const token = resolveToken(tokenEnv);
  if (!token) { console.error(`${TAG} no token: set ${tokenEnv} in the shell or a .env in the cwd (value never printed)`); return 2; }
  const yaml = readFileSync(yamlPath, 'utf8');
  const indices = parseIndices(yaml);
  if (!indices.length) { console.error(`${TAG} ${yamlPath} declares no indices: block`); return 2; }
  const ref = arg('ref', 'main');
  const admin = String(arg('admin', 'https://admin.hlx.page')).replace(/\/+$/, '');
  const origin = String(arg('origin', `https://${ref}--${site}--${org}.aem.live`)).replace(/\/+$/, '');
  const OUT = arg('out', 'stardust/dynamics');
  const CHECK = has('check'); const REPLACE = has('replace');
  const timeoutMs = Number(arg('timeout', 600)) * 1000; const pollMs = Number(arg('poll-ms', 5000));
  const auth = { authorization: `Bearer ${token}` };
  const configUrl = `${admin}/config/${org}/sites/${site}/content/query.yaml`;
  const at = new Date().toISOString();

  // 1. config route — once
  const got = await call(configUrl, { headers: auth });
  if (got.status === 0 || got.status >= 500) { console.error(`${TAG} admin API unreachable (config GET → ${got.status || got.error}) — no verdict`); return 4; }
  let configRoute = 'absent'; let diff = compareIndices([], indices.map((x) => x.name));
  if (got.status === 401 || got.status === 403) {
    configRoute = 'denied';
    console.error(`${TAG} config route DENIED (HTTP ${got.status} for ${tokenEnv}) — falling back to the repo helix-query.yaml + bulk index; the read-back decides. Not re-probed.`);
  } else if (got.status === 200 && got.text.trim()) {
    configRoute = 'present';
    diff = compareIndices(indexNames(got.text), indices.map((x) => x.name));
    console.log(`${TAG} remote query.yaml: ${diff.same.length} same · ${diff.onlyLocal.length} new in file (${diff.onlyLocal.join(', ') || '—'}) · ${diff.onlyRemote.length} only remote (${diff.onlyRemote.join(', ') || '—'})`);
    if (diff.onlyRemote.length && !REPLACE) { console.error(`${TAG} REFUSED: the remote query.yaml carries index name(s) the file does not: ${diff.onlyRemote.join(', ')} — a whole-file POST would drop them. Add them to ${yamlPath} or pass --replace (owner row). Nothing posted.`); return 3; }
  } else console.log(`${TAG} remote query.yaml: none (HTTP ${got.status}) — will register`);
  if (CHECK) { console.log(`${TAG} --check: ${configRoute}; file declares ${indices.map((x) => `${x.name} → ${x.target}`).join(', ')}. No POST, no writes.`); return 0; }

  // 2. sample — before any write: without a published in-scope page there is no verdict to earn
  const pagesFile = arg('pages', 'stardust/rollout/coverage/pages.json');
  const pagesDoc = readJSON(pagesFile, null);
  const allIncludes = indices.flatMap((x) => x.include); const allExcludes = indices.flatMap((x) => x.exclude);
  const sample = arg('sample') || pickSample((pagesDoc && pagesDoc.pages) || [], allIncludes, allExcludes);
  const status = (extra) => ({ _provenance: { writtenBy: 'stardust:rollout query-index.mjs', writtenAt: at, org, site, ref, admin, origin, yaml: yamlPath }, ...extra, at });
  if (!sample) {
    console.error(`${TAG} no verdict: no published (verified|deployed) page in ${pagesFile} matches an index include glob and no --sample given — the index builds from the published tree; re-run after the --publish run. Nothing posted.`);
    writeJSON(join(OUT, 'index-status.json'), status({ registered: null, verdict: 'no-verdict', reason: 'no published in-scope page', indices: indices.map((x) => ({ name: x.name, target: x.target, total: null, sampleFound: null, fields: [] })), job: null, sample: null, exit: 4 }));
    return 4;
  }

  // 3. register through the config route (POST the whole file)
  if (configRoute !== 'denied') {
    const posted = await call(configUrl, { method: 'POST', headers: { ...auth, 'content-type': 'text/yaml' }, body: yaml });
    if (posted.status === 401 || posted.status === 403) { configRoute = 'denied'; console.error(`${TAG} config route DENIED on POST (HTTP ${posted.status}) — falling back to the repo helix-query.yaml + bulk index; the read-back decides.`); } else if (posted.status === 0 || posted.status >= 400) { console.error(`${TAG} config POST answered ${posted.status || posted.error} — no verdict`); return 4; } else { configRoute = 'registered'; writeText(join(OUT, 'query.yaml'), yaml); console.log(`${TAG} config POST ${posted.status} → mirrored to ${join(OUT, 'query.yaml')}`); }
  }

  // 4. one bulk index job, polled
  const started = await call(`${admin}/index/${org}/${site}/${ref}/*`, { method: 'POST', headers: auth });
  if (started.status === 0 || started.status >= 400) { console.error(`${TAG} bulk index POST answered ${started.status || started.error} — no verdict`); return 4; }
  const jobName = (started.json && started.json.job && started.json.job.name) || (started.json && started.json.name) || null;
  const jobUrl = (started.json && started.json.links && started.json.links.self) || (jobName ? `${admin}/job/${org}/${site}/${ref}/index/${jobName}` : null);
  const job = { name: jobName, url: jobUrl, state: (started.json && started.json.job && started.json.job.state) || 'created', total: null, processed: null, settled: false };
  const deadline = Date.now() + timeoutMs;
  while (jobUrl && Date.now() < deadline) {
    await sleep(pollMs);
    const j = await call(jobUrl, { headers: auth });
    const d = (j.json && (j.json.job || j.json)) || {}; const p = d.progress || d;
    job.state = d.state || job.state; job.total = p.total ?? job.total; job.processed = p.processed ?? job.processed;
    console.error(`${TAG} job ${jobName || '?'}: ${job.state} · ${job.processed ?? '?'}/${job.total ?? '?'}`);
    if (job.state === 'stopped' || (job.total !== null && job.processed !== null && job.processed >= job.total && job.total > 0)) { job.settled = true; break; }
  }
  if (!jobUrl) job.settled = true; // nothing to poll: the admin answered without a job handle
  if (!job.settled) console.error(`${TAG} job did not settle within ${timeoutMs / 1000}s — reading back anyway`);

  // 5. read-back per index target
  const LIMIT = 1000; let unreachable = false; const results = [];
  for (const x of indices) {
    const scoped = inScope(sample, x.include, x.exclude);
    let total = null; let row = null; let offset = 0;
    do {
      const r = await call(`${origin}${x.target}?limit=${LIMIT}&offset=${offset}`);
      if (r.status === 0) { unreachable = true; break; }
      if (r.status >= 400 || !r.json) { total = 0; break; }
      total = Number(r.json.total ?? (r.json.data || []).length) || 0;
      row = (r.json.data || []).find((d) => sameRow(d.path, sample)) || null;
      offset += LIMIT;
    } while (!row && offset < total && offset < LIMIT * 20);
    const fields = row ? Object.keys(row).filter((k) => k !== 'path' && String(row[k] ?? '').trim() !== '') : [];
    const tier2Defined = x.properties.filter((p) => !TIER1.has(p));
    const tier2 = fields.filter((k) => !TIER1.has(k));
    const sampleFound = scoped ? !!row && fields.length > 0 && (tier2Defined.length === 0 || tier2.length > 0) : null;
    results.push({ name: x.name, target: x.target, total, sampleFound, fields });
    console.log(`${TAG} read-back ${x.target}: total ${total ?? 'unreachable'}${scoped ? ` · sample ${sample} ${row ? `found (${fields.length} fields${tier2.length ? `, Tier-2 ${tier2.join(',')}` : ', NO Tier-2 value'})` : 'ABSENT'}` : ' · sample out of scope'}`);
  }
  const scopedResults = results.filter((r) => r.sampleFound !== null);
  const sampleFound = scopedResults.length > 0 && scopedResults.every((r) => r.sampleFound);
  const configDenied = configRoute === 'denied';
  const exit = exitCodeFor({ unreachable, hasSample: true, sampleFound, configDenied, settled: job.settled });
  const registered = unreachable ? null : configRoute === 'registered' ? 'config' : configDenied ? (sampleFound ? 'repo-yaml' : 'denied') : 'config';
  writeJSON(join(OUT, 'index-status.json'), status({ registered, indices: results, job, sample, exit }));
  if (registered === 'denied' && exit === 3) {
    const md = indexConfigMd({ org, site, admin, indices, yaml, readback: results.map((r) => `${r.target} total ${r.total}`).join(', ') });
    const file = resolvePath(OUT, '..', 'rollout', 'INDEX-CONFIG.md');
    writeText(file, md);
    console.error(`${TAG} DENIED and the repo yaml is not honoured → ${file} written for an org admin; index-backed rows become scaffolded-awaiting-owner`);
  }
  const verdict = { 0: 'registered and read back', 1: 'FAIL — sample absent after the job settled', 3: 'denied — owner decision', 4: unreachable ? 'no verdict — target origin unreachable' : 'no verdict — job not settled' }[exit];
  console.log(`${TAG} ${registered || 'unverified'} · ${verdict} → ${join(OUT, 'index-status.json')} (exit ${exit})`);
  return exit;
}

// run only as the entry script — importing the module (tests) runs nothing
const entry = process.argv[1] ? pathToFileURL(resolvePath(process.argv[1])).href : null;
if (entry === import.meta.url) main().then((code) => { process.exitCode = code; }, (e) => { console.error(`${TAG} fatal: ${e.message}`); process.exitCode = 4; });
