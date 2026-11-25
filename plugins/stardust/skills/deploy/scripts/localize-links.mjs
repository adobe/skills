#!/usr/bin/env node
/**
 * skills/deploy/scripts/localize-links.mjs — link localization as a pipeline stage.
 *
 * Why this exists: generators faithfully carry captured hrefs as fully-qualified
 * source-domain URLs (the D4 "author URLs as opaque tokens" rule), and that
 * silently shipped hundreds of links across a whole migration that bounced
 * visitors OFF the new origin back to the live site — for targets that existed
 * on the new origin all along. D4 is a capture-fidelity rule; it must never be
 * read as a delivery rule. Internal links must be root-relative so the site
 * works on any origin; a link stays absolute ONLY when its target is genuinely
 * external or not (yet) in the migration set — that is the honest integration
 * boundary, and this tool reports it.
 *
 * What it does (idempotent — run it after EVERY generator and before EVERY
 * deploy, over the WHOLE tree, because earlier waves' pages gain newly valid
 * internal targets as later waves ship them):
 *   1. Builds the URL map from the content tree: every document under --content
 *      (lib/documents.mjs contentDocuments: a lowercase `.html` — what deploy
 *      sends; `--targets` narrows it) is a page served at its URL (eds-path.mjs: extensionless; a folder index
 *      `x/index.html` at `/x/`, a leaf at `/x/y`; root `/`), plus the entries of
 *      --redirects (source path → destination) when given.
 *   2. Rewrites every <a href> whose host is a --source-host (with or without
 *      `www.`, http or https or protocol-relative) AND whose path resolves in
 *      the map to that root-relative URL (EDS 404s on `.html` and on a leaf's
 *      trailing slash; `/x` 404s for a folder index), preserving ?query
 *      and #fragment.
 *   3. Normalizes root-relative internal hrefs that resolve in the map to the
 *      same URL.
 *   4. Leaves everything else untouched: other hosts, mailto:/tel:, anchors,
 *      and source-host links whose path is NOT in the map (reported).
 *
 * Usage:
 *   node skills/deploy/scripts/localize-links.mjs --source-host <host[,host]> \
 *        [--content content] [--redirects stardust/redirects.tsv|.json|.jsonl] \
 *        [--dry-run] [--check] [--json] [--receipt <file>] [--targets <file>]
 *
 *   --source-host  the live site's host(s); `www.` is matched either way
 *   --content      root of the authored content tree (default: content)
 *   --redirects    TSV `source<TAB>destination` (rollout's stardust/redirects.tsv), JSON
 *                  ([{source,destination}], {source: destination}, the DA sheet {data:[…]}),
 *                  or JSON Lines ({src,target}: spec's knowledge/redirects.jsonl)
 *   --dry-run      report what would change, write nothing
 *   --check        gate mode: write nothing, exit 2 if ANY link would change
 *                  (run the plain pass first; --check is the pre-deploy assertion)
 *   --json         machine-readable summary
 *   --receipt      write this run's receipt to <file> (a new file, its folder created; an existing
 *                  one is a usage error): { tool, at, content, files: { "/<file>": { input,
 *                  output } } } — the sha256 of the bytes this run READ and WILL WRITE for every
 *                  file it rewrites, nothing else. It is written BEFORE any page: a receipt that
 *                  cannot be written changes nothing (exit 1), and a run interrupted mid-batch
 *                  leaves a record for every file it touched (one still at its input was not
 *                  reached). A caller attributes an edit to the localizer only through its
 *                  receipt (replica's extend pass). Not with --dry-run / --check.
 *   --targets      a file of content file paths (`/about.html`, one per line): the ONLY link
 *                  targets — a source link to any other document stays as it is (the extend
 *                  pass's targets.paths: delivered documents and the pass's own). Every document
 *                  is still read as a page.
 *
 * Every page is written through lib/documents.mjs replaceIfUnchanged: a file saved between this
 * run's read and its write (an editor) is kept, reported as a conflict on stderr and in the summary
 * (`conflicts`), and not counted as rewritten; its receipt record then matches neither side.
 * Entries whose name starts with `.` (`.drafts/`) are no documents (contentDocuments' default).
 *
 * Writes: the rewritten *.html files IN PLACE under --content (nothing with
 * --dry-run or --check; the summary is stdout).
 *
 * Exit codes: 0 clean (or rewritten), 2 --check found localizable links,
 * 1 usage/IO error. Dependency-free (regex over the authored HTML, the same
 * technique as davids-model-lint.mjs — content pages are machine-generated).
 */
import { readFileSync, writeFileSync, statSync, existsSync, renameSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { deliveredUrl, pathKey as canonicalPath } from './eds-path.mjs';

// lib/documents.mjs (through contracts.mjs): which files are documents — the deployer's rule, so a link never points
// to a file deploy does not send (`x.HTML`, `x.htm`)
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) throw Object.assign(new Error('localize-links: contracts.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'), { code: 'FRONT_DOOR_MISSING' });
const { contentDocuments, replaceIfUnchanged } = await import(CONTRACTS.href);

function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { content: 'content', hosts: [], redirects: null, dryRun: false, check: false, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--content') opts.content = rest[i += 1];
    else if (a === '--source-host') opts.hosts.push(...(rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--redirects') opts.redirects = rest[i += 1];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--check') { opts.check = true; opts.dryRun = true; }
    else if (a === '--json') opts.json = true;
    else if (a === '--receipt' || a === '--targets') {
      const v = rest[i += 1];
      if (!v || !v.trim() || v.startsWith('--')) { console.error(`${a} needs a file`); process.exit(1); }
      opts[a === '--receipt' ? 'receipt' : 'targets'] = v;
    }
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`unknown argument ${a}`); usage(); process.exit(1); }
  }
  if (!opts.hosts.length) { console.error('--source-host is required'); usage(); process.exit(1); }
  if (!existsSync(opts.content) || !statSync(opts.content).isDirectory()) { console.error(`--content ${opts.content} is not a directory`); process.exit(1); }
  if (opts.receipt && opts.dryRun) { console.error('--receipt records what a run wrote: not with --dry-run / --check'); process.exit(1); }
  if (opts.receipt && existsSync(opts.receipt)) { console.error(`--receipt ${opts.receipt} exists — one receipt per run`); process.exit(1); }
  if (opts.targets && !existsSync(opts.targets)) { console.error(`--targets ${opts.targets} not found`); process.exit(1); }
  return opts;
}

function usage() {
  console.error('usage: localize-links.mjs --source-host <host[,host]> [--content content] [--redirects file] [--dry-run] [--check] [--json]');
}

// ----------------------------------------------------------------- URL map

const bareHost = (h) => h.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');

// Canonical lookup key for a path: eds-path.mjs pathKey (no query/fragment, .html, /index or trailing slash; lower case).
export { canonicalPath };


/**
 * [source, destination] pairs from a redirects file. Pure. Reads rollout's TSV (`source<TAB>destination`, `#`
 * comments), JSON (`[{source,destination}]`, `{source: destination}`, or the published DA sheet
 * `{data:[{Source,Destination}]}`), and JSON Lines (`{src,target}` rows as in spec knowledge/redirects.jsonl, or
 * `{source,destination}`). Rows without both sides are skipped.
 */
export function redirectPairs(raw, file = '') {
  const pairs = [];
  const add = (r) => { if (!r || typeof r !== 'object') return; const s = r.source ?? r.Source ?? r.src; const d = r.destination ?? r.Destination ?? r.target; if (typeof s === 'string' && typeof d === 'string' && s && d) pairs.push([s, d]); };
  if (/\.jsonl$/i.test(file)) raw.split(/\r?\n/).forEach((l) => { if (l.trim()) add(JSON.parse(l)); });
  else if (/\.json$/i.test(file)) {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) j.forEach(add);
    else if (Array.isArray(j?.data)) j.data.forEach(add);
    else Object.entries(j).forEach(([s, d]) => { if (typeof d === 'string') pairs.push([s, d]); });
  } else {
    raw.split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const [s, d] = t.split(/\t+|\s{2,}/);
      if (s && d) pairs.push([s, d]);
    });
  }
  return pairs;
}

function buildMap(files, root, redirectsFile) {
  const map = new Map(); // lookup key → the URL EDS serves (a folder index at /a/, a leaf at /a/b: eds-path.mjs)
  for (const f of files) {
    const rel = `/${path.relative(root, f).split(path.sep).join('/')}`;
    map.set(canonicalPath(rel), deliveredUrl(rel));
  }
  let redirects = 0; let pending = 0;
  if (redirectsFile) {
    const pairs = redirectPairs(readFileSync(redirectsFile, 'utf8'), redirectsFile);
    if (!pairs.length) console.error(`localize-links: no redirect pairs read from ${redirectsFile}`);
    // a redirect rewrites links only to a page of this content tree: one whose page ships in a later wave stays
    // absolute until then (a seeded spec covers every page of the site, a wave delivers a few)
    for (const [s, d] of pairs) {
      const src = canonicalPath(s.replace(/^https?:\/\/[^/]+/i, ''));
      const dst = map.get(canonicalPath(d.replace(/^https?:\/\/[^/]+/i, '')));
      if (dst === undefined) { pending += 1; continue; }
      if (!map.has(src)) { map.set(src, dst); redirects += 1; }
    }
  }
  return { map, redirects, pending };
}

// ------------------------------------------------------------------ rewrite

function parseHref(href) {
  const m = href.match(/^(?:(https?:)?\/\/([^/?#]+))?([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (!m) return null;
  return { host: m[2] ? bareHost(m[2]) : null, path: m[3] || '', query: m[4] || '', hash: m[5] || '' };
}

export function localizeHref(href, { map, hosts }) {
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href) || !href) return { href, action: 'skip' };
  const u = parseHref(href);
  if (!u) return { href, action: 'skip' };
  const isSource = u.host && hosts.includes(u.host);
  const isRootRel = !u.host && href.startsWith('/') && !href.startsWith('//');
  if (!isSource && !isRootRel) return { href, action: 'skip' };
  const key = canonicalPath(u.path);
  const target = map.get(key);
  if (target === undefined) return { href, action: isSource ? 'kept-absolute' : 'skip', key };
  const next = `${target}${u.query}${u.hash}`;
  if (next === href) return { href, action: 'already' };
  return { href: next, action: isSource ? 'localized' : 'normalized', key };
}

const HREF_RE = /(<a\b[^>]*?\bhref=)(["'])([^"']*)\2/gi;

function processFile(file, ctx, src = readFileSync(file, 'utf8')) {
  const counts = { localized: 0, normalized: 0 };
  const kept = [];
  const out = src.replace(HREF_RE, (whole, pre, q, href) => {
    const r = localizeHref(href, ctx);
    if (r.action === 'localized' || r.action === 'normalized') { counts[r.action] += 1; return `${pre}${q}${r.href}${q}`; }
    if (r.action === 'kept-absolute') kept.push(r.key);
    return whole;
  });
  return { out, changed: out !== src, counts, kept };
}

// --------------------------------------------------------------------- main

function main() {
  // --help prints this file's usage header, so an agent never reads the source to learn the flags.
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    process.exit(0);
  }
  const opts = parseArgs(process.argv);
  const hosts = opts.hosts.map(bareHost);
  const docs = contentDocuments(opts.content);
  const files = docs.map((d) => path.join(opts.content, d.file));
  const allowed = opts.targets ? new Set(readFileSync(opts.targets, 'utf8').split('\n').map((l) => l.trim().replace(/^\/+/, '')).filter(Boolean)) : null;
  const targets = docs.filter((d) => !allowed || allowed.has(d.file)).map((d) => path.join(opts.content, d.file));
  const { map, redirects, pending } = buildMap(targets, opts.content, opts.redirects);
  const ctx = { map, hosts };

  const perFile = {};
  const keptAll = new Map();
  let localized = 0; let normalized = 0; let filesChanged = 0;
  const digest = (b) => createHash('sha256').update(b).digest('hex');
  const receipt = {}; const writes = [];
  for (const f of files) {
    const buf = readFileSync(f);
    const r = processFile(f, ctx, buf.toString('utf8'));
    r.kept.forEach((k) => keptAll.set(k, (keptAll.get(k) || 0) + 1));
    if (!r.changed) continue;
    filesChanged += 1;
    localized += r.counts.localized; normalized += r.counts.normalized;
    const key = `/${path.relative(opts.content, f).split(path.sep).join('/')}`;
    perFile[key] = r.counts;
    receipt[key] = { input: digest(buf), output: digest(Buffer.from(r.out, 'utf8')) };
    writes.push({ f, key, out: r.out, counts: r.counts });
  }
  // the receipt before any page: a receipt that cannot be written leaves every page as it was
  if (opts.receipt) {
    try {
      mkdirSync(path.dirname(opts.receipt), { recursive: true });
      const tmp = `${opts.receipt}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ tool: 'localize-links', at: new Date().toISOString(), content: opts.content, files: receipt }, null, 2)}\n`);
      renameSync(tmp, opts.receipt);
    } catch (e) { console.error(`localize-links: --receipt ${opts.receipt}: ${e.code || e.message} — no page written`); process.exit(1); }
  }
  // each page through lib/documents.mjs replaceIfUnchanged: a save made since this run read it is kept, never overwritten
  const conflicts = [];
  if (!opts.dryRun) {
    for (const w of writes) {
      const why = replaceIfUnchanged(w.f, receipt[w.key].input, Buffer.from(w.out, 'utf8'));
      if (why) { conflicts.push(w.key); console.error(`localize-links: conflict ${w.key} — ${why}`); delete perFile[w.key]; filesChanged -= 1; localized -= w.counts.localized; normalized -= w.counts.normalized; }
    }
  }
  const keptSorted = [...keptAll.entries()].sort((a, b) => b[1] - a[1]);
  const summary = { content: opts.content, hosts, pages: files.length, mapEntries: map.size, redirects, filesChanged, localized, normalized, conflicts: conflicts.length, keptAbsolute: keptSorted.length, mode: opts.check ? 'check' : opts.dryRun ? 'dry-run' : 'write' };

  if (opts.json) {
    console.log(JSON.stringify({ ...summary, perFile, kept: keptSorted.map(([p, n]) => ({ path: p, links: n })) }, null, 2));
  } else {
    const verb = opts.dryRun ? 'would localize' : 'localized';
    console.log(`localize-links: ${files.length} pages, ${map.size} map entries (${redirects} from redirects${pending ? `; ${pending} redirect(s) to pages not in this tree kept for a later wave` : ""}), hosts ${hosts.join(', ')}`);
    console.log(`${verb} ${localized} source-host link(s) + normalized ${normalized} internal href(s) across ${filesChanged} file(s)${opts.dryRun ? ' [no writes]' : ''}`);
    for (const [p, c] of Object.entries(perFile)) console.log(`  ${p}: ${c.localized} localized, ${c.normalized} normalized`);
    if (keptSorted.length) {
      console.log(`\nabsolute source-host links KEPT (target not in the migration set — the honest boundary; re-run after the wave that ships them):`);
      keptSorted.slice(0, 20).forEach(([p, n]) => console.log(`  ${String(n).padStart(4)}  ${p}`));
      if (keptSorted.length > 20) console.log(`  … ${keptSorted.length - 20} more target(s)`);
    }
    if (opts.check) console.log(`\nCHECK ${localized + normalized ? 'FAIL' : 'PASS'} — ${localized + normalized} link(s) still localizable`);
  }
  process.exit(opts.check && (localized + normalized) ? 2 : 0);
}

if (process.argv[1] && /localize-links\.mjs$/.test(process.argv[1])) main();
