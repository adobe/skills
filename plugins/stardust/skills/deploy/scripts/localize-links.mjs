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
 *   1. Builds the URL map from the content tree: every *.html under --content
 *      is a served path (extensionless; `x/index.html` → `/x`; root `/`), plus
 *      the entries of --redirects (source path → destination) when given.
 *   2. Rewrites every <a href> whose host is a --source-host (with or without
 *      `www.`, http or https or protocol-relative) AND whose path resolves in
 *      the map to the canonical root-relative form — extensionless, no
 *      trailing slash (EDS 404s on `/x/` and `/x.html`) — preserving ?query
 *      and #fragment.
 *   3. Normalizes root-relative internal hrefs that resolve in the map but
 *      carry `.html` or a trailing slash to the same canonical form.
 *   4. Leaves everything else untouched: other hosts, mailto:/tel:, anchors,
 *      and source-host links whose path is NOT in the map (reported).
 *
 * Usage:
 *   node skills/deploy/scripts/localize-links.mjs --source-host <host[,host]> \
 *        [--content content] [--redirects stardust/redirects.tsv|redirects.json] \
 *        [--dry-run] [--check] [--json]
 *
 *   --source-host  the live site's host(s); `www.` is matched either way
 *   --content      root of the authored content tree (default: content)
 *   --redirects    TSV `source<TAB>destination` (rollout's stardust/redirects.tsv)
 *                  or JSON ([{source,destination}] or {source: destination})
 *   --dry-run      report what would change, write nothing
 *   --check        gate mode: write nothing, exit 2 if ANY link would change
 *                  (run the plain pass first; --check is the pre-deploy assertion)
 *   --json         machine-readable summary
 *
 * Exit codes: 0 clean (or rewritten), 2 --check found localizable links,
 * 1 usage/IO error. Dependency-free (regex over the authored HTML, the same
 * technique as davids-model-lint.mjs — content pages are machine-generated).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';

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
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`unknown argument ${a}`); usage(); process.exit(1); }
  }
  if (!opts.hosts.length) { console.error('--source-host is required'); usage(); process.exit(1); }
  if (!existsSync(opts.content) || !statSync(opts.content).isDirectory()) { console.error(`--content ${opts.content} is not a directory`); process.exit(1); }
  return opts;
}

function usage() {
  console.error('usage: localize-links.mjs --source-host <host[,host]> [--content content] [--redirects file] [--dry-run] [--check] [--json]');
}

// ----------------------------------------------------------------- URL map

const bareHost = (h) => h.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');

// Canonical lookup key for a path: no query/fragment, no .html/.htm, no
// trailing slash (root stays "/"), collapsed slashes, lower-cased.
export function canonicalPath(p) {
  let s = (p || '').split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\.html?$/i, '');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (s === '' || s === '/index') s = '/';
  s = s.replace(/\/index$/, '');
  return s.toLowerCase() || '/';
}

function collectHtml(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) collectHtml(p, out);
    else if (/\.html$/i.test(entry)) out.push(p);
  }
  return out;
}

function buildMap(files, root, redirectsFile) {
  const map = new Map(); // canonical source path → canonical served path
  for (const f of files) {
    const rel = `/${path.relative(root, f).split(path.sep).join('/')}`;
    const served = canonicalPath(rel);
    map.set(served, served);
  }
  let redirects = 0;
  if (redirectsFile) {
    const raw = readFileSync(redirectsFile, 'utf8');
    const pairs = [];
    if (/\.json$/i.test(redirectsFile)) {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) j.forEach((r) => r && r.source && r.destination && pairs.push([r.source, r.destination]));
      else Object.entries(j).forEach(([s, d]) => pairs.push([s, d]));
    } else {
      raw.split(/\r?\n/).forEach((line) => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const [s, d] = t.split(/\t+|\s{2,}/);
        if (s && d) pairs.push([s, d]);
      });
    }
    for (const [s, d] of pairs) {
      const src = canonicalPath(s.replace(/^https?:\/\/[^/]+/i, ''));
      const dst = canonicalPath(d.replace(/^https?:\/\/[^/]+/i, ''));
      if (!map.has(src)) { map.set(src, dst); redirects += 1; }
    }
  }
  return { map, redirects };
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

function processFile(file, ctx) {
  const src = readFileSync(file, 'utf8');
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
  const opts = parseArgs(process.argv);
  const hosts = opts.hosts.map(bareHost);
  const files = collectHtml(opts.content);
  const { map, redirects } = buildMap(files, opts.content, opts.redirects);
  const ctx = { map, hosts };

  const perFile = {};
  const keptAll = new Map();
  let localized = 0; let normalized = 0; let filesChanged = 0;
  for (const f of files.sort()) {
    const r = processFile(f, ctx);
    r.kept.forEach((k) => keptAll.set(k, (keptAll.get(k) || 0) + 1));
    if (!r.changed) continue;
    filesChanged += 1;
    localized += r.counts.localized; normalized += r.counts.normalized;
    perFile[`/${path.relative(opts.content, f).split(path.sep).join('/')}`] = r.counts;
    if (!opts.dryRun) writeFileSync(f, r.out);
  }
  const keptSorted = [...keptAll.entries()].sort((a, b) => b[1] - a[1]);
  const summary = { content: opts.content, hosts, pages: files.length, mapEntries: map.size, redirects, filesChanged, localized, normalized, keptAbsolute: keptSorted.length, mode: opts.check ? 'check' : opts.dryRun ? 'dry-run' : 'write' };

  if (opts.json) {
    console.log(JSON.stringify({ ...summary, perFile, kept: keptSorted.map(([p, n]) => ({ path: p, links: n })) }, null, 2));
  } else {
    const verb = opts.dryRun ? 'would localize' : 'localized';
    console.log(`localize-links: ${files.length} pages, ${map.size} map entries (${redirects} from redirects), hosts ${hosts.join(', ')}`);
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
