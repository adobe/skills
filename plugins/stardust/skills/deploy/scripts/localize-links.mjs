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
 *      the entries of --redirects (source path → destination) when given. Keys
 *      and targets are the DELIVERY-SAFE form (stardust/scripts/da-path.mjs —
 *      the path deploy-batch PUTs to), so a tree carrying `_`, case, dots or
 *      diacritics in file names still maps hrefs to the path DA serves.
 *   2. Rewrites every <a href> whose host is a --source-host (with or without
 *      `www.`, http or https or protocol-relative), a delivery host
 *      (`<ref>--<repo>--<org>.aem.page|live`, implicit) or the --prod-host,
 *      AND whose path resolves in the map to the canonical root-relative form — extensionless, no
 *      trailing slash (EDS 404s on `/x/` and `/x.html`) — preserving ?query
 *      and #fragment.
 *   3. Normalizes root-relative internal hrefs that resolve in the map but
 *      carry `.html` or a trailing slash to the same canonical form.
 *   4. Leaves everything else untouched: other hosts, mailto:/tel:, anchors,
 *      assets, and source-host links whose path is NOT in the map (reported).
 *   5. Locale alias (--locale-alias en): a site that served `/x` and now
 *      delivers `/en/x` gains `/x → /en/x` for every page (source-host and
 *      root-relative hrefs alike, action `aliased`); --append-redirects writes
 *      each alias the run resolved to the --redirects sheet (deduped) so
 *      inbound `/x` links redirect too.
 *   6. Inverse pass (--unmigrated, the `links` decisions row): a root-relative
 *      href to a page that is NOT in the map is a 404 on the new origin. Under
 *      `bounce` (default) it is rewritten to the first --source-host (the honest
 *      boundary — a link to the live page, never probed); under `list` (owner-
 *      decided) it is left in place and `stardust/link-gaps.tsv` lists
 *      `path<TAB>refs<TAB>first-referrer`. `bounce` residue is a change, so
 *      --check fails on it; `list` gaps are not, so --check passes and prints
 *      the planned-gap count.
 *
 * Usage:
 *   node skills/deploy/scripts/localize-links.mjs --source-host <host[,host]> \
 *        [--content content] [--redirects stardust/redirects.tsv|redirects.json] \
 *        [--locale-alias <prefix[,prefix]>] [--append-redirects] [--unmigrated bounce|list]
 *        [--gaps stardust/link-gaps.tsv] [--dry-run] [--check] [--json]
 *
 *   --source-host  the live site's host(s); `www.` is matched either way
 *   --prod-host    the new site's production host(s), also localizable
 *                  (delivery `*.aem.page|live` branch hosts always are)
 *   --content      root of the authored content tree (default: content)
 *   --redirects    TSV `source<TAB>destination` (rollout's stardust/redirects.tsv)
 *                  or JSON ([{source,destination}] or {source: destination})
 *   --locale-alias <p>  alias `/x` → `/<p>/x` when only the prefixed page exists
 *   --append-redirects  write mode: append resolved aliases to --redirects (deduped)
 *   --unmigrated   bounce (default) | list — dead root-relative hrefs (rule 6)
 *   --gaps         where `list` writes the planned gaps (default stardust/link-gaps.tsv)
 *   --dry-run      report what would change, write nothing
 *   --check        gate mode: write nothing, exit 2 if ANY link would change
 *                  (run the plain pass first; --check is the pre-deploy assertion)
 *   --json         machine-readable summary (adds aliased, bounced, gaps)
 *
 * Exit codes: 0 clean (or rewritten), 2 --check found localizable links,
 * 1 usage/IO error. Dependency-free (regex over the authored HTML, the same
 * technique as davids-model-lint.mjs — content pages are machine-generated).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { normalizeDaPath } from '../../stardust/scripts/da-path.mjs';

function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { content: 'content', hosts: [], hostsRaw: [], prodHosts: [], redirects: null, dryRun: false, check: false, json: false, aliases: [], appendRedirects: false, unmigrated: 'bounce', gaps: path.join('stardust', 'link-gaps.tsv') };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--content') opts.content = rest[i += 1];
    else if (a === '--source-host' || a === '--prod-host') { const hs = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); opts.hosts.push(...hs); (a === '--source-host' ? opts.hostsRaw : opts.prodHosts).push(...hs); }
    else if (a === '--locale-alias') opts.aliases.push(...(rest[i += 1] || '').split(',').map((s) => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean));
    else if (a === '--append-redirects') opts.appendRedirects = true;
    else if (a === '--unmigrated') opts.unmigrated = rest[i += 1];
    else if (a === '--gaps') opts.gaps = rest[i += 1];
    else if (a === '--redirects') opts.redirects = rest[i += 1];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--check') { opts.check = true; opts.dryRun = true; }
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`unknown argument ${a}`); usage(); process.exit(1); }
  }
  if (!opts.hosts.length) { console.error('--source-host (or --prod-host) is required — under --unmigrated bounce it is also the host dead root-relative links bounce to'); usage(); process.exit(1); }
  if (!['bounce', 'list'].includes(opts.unmigrated)) { console.error(`--unmigrated must be bounce or list (got ${opts.unmigrated})`); process.exit(1); }
  if (opts.appendRedirects && !opts.redirects) { console.error('--append-redirects needs --redirects <file> (the sheet the rows go to)'); process.exit(1); }
  if (!existsSync(opts.content) || !statSync(opts.content).isDirectory()) { console.error(`--content ${opts.content} is not a directory`); process.exit(1); }
  return opts;
}

function usage() {
  console.error('usage: localize-links.mjs --source-host <host[,host]> [--prod-host <host>] [--content content] [--redirects file] [--locale-alias <prefix[,prefix]>] [--append-redirects] [--unmigrated bounce|list] [--gaps file] [--dry-run] [--check] [--json]');
}

// ----------------------------------------------------------------- URL map

const bareHost = (h) => h.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');

// Canonical lookup key for a path: no query/fragment, no .html/.htm, no
// trailing slash (root stays "/"), `/index` folded, then the delivery-safe fold
// (stardust/scripts/da-path.mjs — the path deploy-batch actually PUTs to, so map
// keys AND rewrite targets name the served path: `/Über_uns.html` → `/uber-uns`).
// A path with no safe form (non-Latin segment) keeps its lower-cased shape.
export function canonicalPath(p) {
  let s = (p || '').split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/(\.html?)+$/i, ''); // loop-strip: a source that served `/x.html.html` must key as /x
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (s === '' || s === '/index') s = '/';
  s = s.replace(/\/index$/, '');
  s = s.toLowerCase() || '/';
  return normalizeDaPath(s) ?? s;
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

export function buildMap(files, root, redirectsFile, localeAliases = []) {
  const map = new Map(); // canonical source path → canonical served path
  const aliases = new Map(); // alias key → the prefixed key it resolves through (--locale-alias)
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
  // locale alias: `/x` → `/<prefix>/x` for every prefixed key whose bare form is not itself a page
  for (const prefix of localeAliases) {
    const pre = `/${prefix.toLowerCase()}`;
    for (const [key, target] of [...map.entries()]) {
      if (key !== pre && !key.startsWith(`${pre}/`)) continue;
      const bare = key === pre ? '/' : key.slice(pre.length);
      if (map.has(bare)) continue;
      map.set(bare, target);
      aliases.set(bare, key);
    }
  }
  return { map, redirects, aliases };
}

// ------------------------------------------------------------------ rewrite

function parseHref(href) {
  const m = href.match(/^(?:(https?:)?\/\/([^/?#]+))?([^?#]*)(\?[^#]*)?(#.*)?$/i);
  if (!m) return null;
  return { host: m[2] ? bareHost(m[2]) : null, path: m[3] || '', query: m[4] || '', hash: m[5] || '' };
}

// Delivery hosts are always localizable: a branch host dies at merge.
const DELIVERY_HOST = /^[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.(?:aem|hlx)\.(?:page|live)$/i;

// an href to a non-page resource is never an internal-link gap. The asset test is an EXPLICIT
// extension list, never "any short dotted tail": a dotted page path (`/about.us`, `/news/2024.09`,
// the class da-path.mjs folds) is a PAGE — dead, it is bounced or listed, not skipped as an asset —
// and a legacy page extension (`.php`, `.jsp`, `.asp(x)`) is a page for the same reason.
const ASSET_EXT = 'png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|pdf|json|xml|txt|csv|tsv|css|m?js|map|zip|gz|mp3|mp4|webm|ogg|wav|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|ics|vcf|rss|atom';
const ASSET_PATH = new RegExp(`\\.(?:${ASSET_EXT})$`, 'i');

/**
 * ctx: { map, hosts, aliases?, unmigrated?: 'bounce'|'list', bounceHost?: string }
 * actions: localized | normalized | aliased | bounced | gap | kept-absolute | already | skip
 */
export function localizeHref(href, { map, hosts, aliases = null, unmigrated = 'bounce', bounceHost = null }) {
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href) || !href) return { href, action: 'skip' };
  const u = parseHref(href);
  if (!u) return { href, action: 'skip' };
  const isSource = u.host && (hosts.includes(u.host) || DELIVERY_HOST.test(u.host));
  const isRootRel = !u.host && href.startsWith('/') && !href.startsWith('//');
  if (!isSource && !isRootRel) return { href, action: 'skip' };
  const key = canonicalPath(u.path);
  const target = map.get(key);
  if (target === undefined) {
    if (isSource) return { href, action: 'kept-absolute', key };
    // inverse pass: a root-relative href with no local page (rule 6) — assets and the root are not gaps
    if (key === '/' || ASSET_PATH.test(u.path)) return { href, action: 'skip', key };
    if (unmigrated === 'list' || !bounceHost) return { href, action: 'gap', key };
    return { href: `https://${bounceHost}${u.path}${u.query}${u.hash}`, action: 'bounced', key };
  }
  const next = `${target}${u.query}${u.hash}`;
  if (next === href) return { href, action: 'already' };
  if (aliases && aliases.has(key)) return { href: next, action: 'aliased', key };
  return { href: next, action: isSource ? 'localized' : 'normalized', key };
}

const HREF_RE = /(<a\b[^>]*?\bhref=)(["'])([^"']*)\2/gi;

const CHANGES = new Set(['localized', 'normalized', 'aliased', 'bounced']);

function processFile(file, ctx) {
  const src = readFileSync(file, 'utf8');
  const counts = { localized: 0, normalized: 0, aliased: 0, bounced: 0 };
  const kept = []; const gaps = []; const aliased = [];
  const out = src.replace(HREF_RE, (whole, pre, q, href) => {
    const r = localizeHref(href, ctx);
    if (CHANGES.has(r.action)) { counts[r.action] += 1; if (r.action === 'aliased') aliased.push(r.key); if (r.action === 'bounced') gaps.push(r.key); return `${pre}${q}${r.href}${q}`; }
    if (r.action === 'kept-absolute') kept.push(r.key);
    if (r.action === 'gap') gaps.push(r.key);
    return whole;
  });
  return { out, changed: out !== src, counts, kept, gaps, aliased };
}

/** Append `src<TAB>dst` rows not already on the sheet (any whitespace-separated pair counts as present). */
export function appendRedirectRows(file, pairs) {
  const have = new Set(existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\t+|\s{2,}/).slice(0, 2).join('\t')) : []);
  const add = [];
  for (const [src, dst] of pairs) { const row = `${src}\t${dst}`; if (!have.has(row)) { have.add(row); add.push(row); } }
  if (add.length) writeFileSync(file, `${existsSync(file) ? readFileSync(file, 'utf8').replace(/\n?$/, '\n') : ''}${add.join('\n')}\n`);
  return add.length;
}

// --------------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv);
  const hosts = opts.hosts.map(bareHost);
  const files = collectHtml(opts.content);
  const { map, redirects, aliases } = buildMap(files, opts.content, opts.redirects, opts.aliases);
  // bounce target: the first --source-host (the honest boundary), else the first --prod-host — a --prod-host-only run
  // used to get bounceHost null: every dead link was booked `gap` silently and the residue said "BOUNCED to https://null"
  const bounceHost = opts.hostsRaw[0] || opts.prodHosts[0] || null;
  if (opts.unmigrated === 'bounce' && !bounceHost) { console.error('localize-links: --unmigrated bounce has no host to bounce to (pass --source-host or --prod-host, or --unmigrated list)'); process.exit(1); }
  const ctx = { map, hosts, aliases, unmigrated: opts.unmigrated, bounceHost };

  const perFile = {};
  const keptAll = new Map();
  const gapAll = new Map(); // key → { refs, first }
  const aliasedKeys = new Set();
  let localized = 0; let normalized = 0; let aliased = 0; let bounced = 0; let filesChanged = 0;
  for (const f of files.sort()) {
    const rel = `/${path.relative(opts.content, f).split(path.sep).join('/')}`;
    const r = processFile(f, ctx);
    r.kept.forEach((k) => keptAll.set(k, (keptAll.get(k) || 0) + 1));
    r.gaps.forEach((k) => { const g = gapAll.get(k) || { refs: 0, first: rel }; g.refs += 1; gapAll.set(k, g); });
    r.aliased.forEach((k) => aliasedKeys.add(k));
    if (!r.changed) continue;
    filesChanged += 1;
    localized += r.counts.localized; normalized += r.counts.normalized; aliased += r.counts.aliased; bounced += r.counts.bounced;
    perFile[rel] = r.counts;
    if (!opts.dryRun) writeFileSync(f, r.out);
  }
  const keptSorted = [...keptAll.entries()].sort((a, b) => b[1] - a[1]);
  const gapsSorted = [...gapAll.entries()].sort((a, b) => b[1].refs - a[1].refs);
  const listMode = opts.unmigrated === 'list';
  let appended = 0;
  if (!opts.dryRun) {
    if (opts.appendRedirects && aliasedKeys.size) appended = appendRedirectRows(opts.redirects, [...aliasedKeys].sort().map((k) => [k, map.get(k)]));
    if (listMode) {
      const dir = path.dirname(opts.gaps); if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(opts.gaps, `# path\trefs\tfirst-referrer — root-relative links to pages outside the migration set (decisions row links: list)\n${gapsSorted.map(([k, g]) => `${k}\t${g.refs}\t${g.first}`).join('\n')}${gapsSorted.length ? '\n' : ''}`);
    }
  }
  const changes = localized + normalized + aliased + bounced;
  const summary = { content: opts.content, hosts, pages: files.length, mapEntries: map.size, redirects, localeAliases: aliases.size, filesChanged, localized, normalized, aliased, bounced, gaps: gapsSorted.length, unmigrated: opts.unmigrated, appendedRedirects: appended, keptAbsolute: keptSorted.length, mode: opts.check ? 'check' : opts.dryRun ? 'dry-run' : 'write' };

  if (opts.json) {
    console.log(JSON.stringify({ ...summary, perFile, kept: keptSorted.map(([p, n]) => ({ path: p, links: n })), gapList: gapsSorted.map(([p, g]) => ({ path: p, refs: g.refs, first: g.first })) }, null, 2));
  } else {
    const verb = opts.dryRun ? 'would localize' : 'localized';
    console.log(`localize-links: ${files.length} pages, ${map.size} map entries (${redirects} from redirects${aliases.size ? `, ${aliases.size} locale aliases` : ''}), hosts ${hosts.join(', ')}`);
    console.log(`${verb} ${localized} source-host link(s) + normalized ${normalized} internal href(s)${aliased ? ` + aliased ${aliased}` : ''}${bounced ? ` + bounced ${bounced} unmigrated` : ''} across ${filesChanged} file(s)${opts.dryRun ? ' [no writes]' : ''}`);
    for (const [p, c] of Object.entries(perFile)) console.log(`  ${p}: ${c.localized} localized, ${c.normalized} normalized${c.aliased ? `, ${c.aliased} aliased` : ''}${c.bounced ? `, ${c.bounced} bounced` : ''}`);
    if (appended) console.log(`appended ${appended} alias row(s) to ${opts.redirects}`);
    if (keptSorted.length) {
      console.log(`\nabsolute source-host links KEPT (target not in the migration set — the honest boundary; re-run after the wave that ships them):`);
      keptSorted.slice(0, 20).forEach(([p, n]) => console.log(`  ${String(n).padStart(4)}  ${p}`));
      if (keptSorted.length > 20) console.log(`  … ${keptSorted.length - 20} more target(s)`);
    }
    if (gapsSorted.length) {
      console.log(listMode
        ? `\n${gapsSorted.length} planned gap(s) — root-relative links to pages outside the migration set, left in place (links: list)${opts.dryRun ? '' : ` → ${opts.gaps}`}:`
        : `\nunmigrated root-relative targets ${opts.dryRun ? 'that would bounce' : 'BOUNCED'} to https://${ctx.bounceHost} (links: bounce — the page is not in the migration set):`);
      gapsSorted.slice(0, 20).forEach(([p, g]) => console.log(`  ${String(g.refs).padStart(4)}  ${p}  (first in ${g.first})`));
      if (gapsSorted.length > 20) console.log(`  … ${gapsSorted.length - 20} more target(s)`);
    }
    if (opts.check) console.log(`\nCHECK ${changes ? 'FAIL' : 'PASS'} — ${changes} link(s) still localizable${bounced ? ` (${bounced} unmigrated)` : ''}${listMode && gapsSorted.length ? ` · ${gapsSorted.length} planned gap(s)` : ''}`);
  }
  process.exit(opts.check && changes ? 2 : 0);
}

if (process.argv[1] && /localize-links\.mjs$/.test(process.argv[1])) main();
