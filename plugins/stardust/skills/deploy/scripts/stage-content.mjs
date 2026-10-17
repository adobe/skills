#!/usr/bin/env node
/**
 * skills/deploy/scripts/stage-content.mjs — stage the migrate encoder's documents into content/, behind a hand-edit
 * guard. The encoder writes stardust/encoded/<da-path>.html and never the EDS project; this deploy step copies each
 * page's file to content/<da-path>.html, so content/ keeps one owner (deploy) and the finalisers (localize-links,
 * media-reconcile --apply, sanitise, autofix) rewrite deploy's copy, never the encoder's.
 *
 * Usage:
 *   node skills/deploy/scripts/stage-content.mjs (--template <archetype-slug> | --paths <file>) [--root <projectDir>]
 *        [--overwrite-hand-edit <slug>[,…]]
 *   node skills/deploy/scripts/stage-content.mjs --record (--template <archetype-slug> | --paths <file>) [--root <dir>]
 *
 * Pages: --template = the template's pages (stardust/rollout/coverage/templates.json); --paths = a deploy-batch --paths
 *   file (one DA path per line: /a/b, /a/index, /index), matched to roster pages by eds-path pathKey, so either
 *   delivered form names the page; both flags = both sets. Never staged: the archetype (its gated document is the
 *   one the encoder's round-trip compares with). Skipped: a page with no encoded document, a page whose encode
 *   stopped (the model owns that page; the encoder's exit 2 already signalled it, so the run's exit stays 0) and a
 *   path outside the roster.
 * Paths come from migrate's encode/site.mjs (outputPathFor, contentPathFor, contentFileFor) and eds-path.mjs.
 *
 * Only a current, clean encode is staged — decided by the encoder's own predicate, encode/provenance.mjs
 *   currentEncode(): sidecar audit.encode.status clean, and the encoded bytes' sha256 = the sidecar's
 *   encode.output.sha = the template manifest's entry. `stopped` (a page that stopped after an earlier clean encode
 *   keeps its old document) → skipped; `stale` (bytes, sidecar and manifest disagree — a hand edit of the encoded
 *   document, an older encode) → refused. --overwrite-hand-edit overrides neither.
 *
 * Ledger stardust/deploy/stage-ledger.json: {"content/<da-path>.html": {staged, finalised}} — "sha256:<hex>" of the
 *   bytes stage-content last copied, and of the content/ file --record found after the finalisers (null until then).
 *   Sorted keys, trailing newline, tmp + rename under deploy's file lock, rewritten only when its bytes change.
 *
 * Stage, per page — content/ may hold only what was staged or what --record recorded:
 *   a stopped encode                          → skip (exit unchanged)
 *   a stale encoded document                  → refuse (stale)
 *   no content/ document                      → copy (staged)
 *   the other delivered form exists           → refuse (duplicate): <p>.html and <p>/index.html would be two DA
 *                                               documents for one page; nothing is written
 *   content/ holds the encoded bytes          → pending (no copy; listed until --record) — a document stage-content
 *                                               never wrote is adopted this way
 *   content/ holds the recorded form of the same encoded bytes → unchanged
 *   content/ holds staged or recorded bytes, the encoding changed → copy (staged)
 *   anything else                             → refuse (hand-edit): an edit since --record, a finaliser run not yet
 *                                               recorded, or a differing document never staged (model- or
 *                                               hand-authored).
 *                                               --overwrite-hand-edit <slug> replaces it; a hands-off run never
 *                                               passes it — the edit moves into stardust/patches/<slug>.json (one
 *                                               page) or the template's map (all siblings) first.
 * Record (--record): right after the finalisers, before the PUT, for the pages the stage listed. A page staged since
 *   its last record gets finalised = the sha of its content/ file now; when that differs from the staged bytes it
 *   is recorded with a warning (the chain is a no-op on an encoded document, so a hand edit slipped in). A recorded
 *   page is never re-recorded: a later change to it (a fix-round edit, autofix) is what the guard exists to catch.
 *
 * Output: stdout = the paths to deliver (staged now, or staged and not yet recorded), sorted, one per line — the file
 *   for deploy-batch.mjs --force --paths; --record prints none. stderr = a line per page, then the verdict
 *   `stage-content: staged N · pending N · unchanged N · skipped N · refused N`
 *   (`stage-content --record: recorded N · unchanged N · skipped N · refused N[ · warning N]`). Zero writes when
 *   nothing changed.
 * Exit: 0 ok · 1 usage, unknown template, unreadable list or ledger, a page without a source URL or a recorded page
 *   whose content/ file is gone · 2 a page refused (2 wins over 1).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { byCodePoint, stableJSON, writeIfChanged } from './chrome-map.mjs';
import { pathKey } from './eds-path.mjs';
import { withLock } from './file-lock.mjs';

const HELP = `Usage: node stage-content.mjs (--template <archetype-slug> | --paths <file>) [--root <projectDir>]
         [--overwrite-hand-edit <slug>[,…]]
       node stage-content.mjs --record (--template <archetype-slug> | --paths <file>) [--root <projectDir>]

Copies the migrate encoder's stardust/encoded/<da-path>.html into content/<da-path>.html for the named pages (a
template's siblings, or a deploy-batch --paths file) behind the hand-edit guard of stardust/deploy/stage-ledger.json.
Only a clean, current encode is staged (encode/provenance.mjs currentEncode); a stopped page is skipped.
  --template <a>          the pages of the template whose archetype (or id) is <a>; the archetype itself is never staged
  --paths <file>          one DA path per line (/a/b, /a/index), deploy-batch's --paths format
  --root <dir>            the project root (default: the current directory)
  --record                after the finalisers, before the PUT: record each newly staged page's content/ sha
  --overwrite-hand-edit   replace these pages' hand-edited or never-staged content/ documents (never in hands-off)
  --help                  this text

stdout: the paths to deliver, one per line — redirect it to a file for deploy-batch.mjs --force --paths <file>.
stderr: one line per page, then the verdict. A page whose encoded document is stale, whose content/ document changed
since it was staged or recorded (a hand edit), or whose other delivered form (<p>.html / <p>/index.html) exists, is
refused and never written.
Exit: 0 ok · 1 usage, unknown template, unreadable list or ledger, missing page input · 2 a page refused.`;

export const LEDGER = 'stardust/deploy/stage-ledger.json';
const HERE = dirname(fileURLToPath(import.meta.url));
// migrate's encoder owns the page paths and the "current encode" rule: the plugin tree, then the project copy
const encodeLib = (file) => [join(HERE, '..', '..', 'migrate', 'scripts', 'encode', file), join(HERE, '..', 'migrate', 'encode', file)];
const SHA = /^sha256:[0-9a-f]{64}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
const short = (h) => (typeof h === 'string' && h ? `${h.slice(0, 19)}…` : 'none');
const remedy = (slug) => `move the edit into stardust/patches/${slug}.json (one page) or the template's map (all siblings) and re-encode`;
// the stop's status for the skip line, read from the sidecar currentEncode named
const stopStatus = (root, sidecarPath) => { try { return JSON.parse(readFileSync(join(root, sidecarPath), 'utf8')).audit.encode.status ?? 'absent'; } catch { return 'not clean'; } };

export function parseArgs(argv) {
  const a = { help: false, template: null, paths: null, root: '.', record: false, overwrite: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--template') a.template = next();
    else if (k === '--paths') a.paths = next();
    else if (k === '--root') a.root = next();
    else if (k === '--record') a.record = true;
    else if (k === '--overwrite-hand-edit') a.overwrite.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else throw new Error(`unknown argument ${k}`);
  }
  if (a.help) return a;
  if (!a.template && !a.paths) throw new Error('name the pages: --template <archetype-slug> or --paths <file>');
  if (a.record && a.overwrite.length) throw new Error('--overwrite-hand-edit stages; --record never overwrites');
  return a;
}

/** The ledger as {contentPath: entry}; {} when absent. A malformed file throws: the guard cannot run without it. */
function readLedger(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  let v;
  try { v = JSON.parse(raw); } catch (e) { throw new Error(`${LEDGER}: invalid JSON (${e.message}) — repair it, or remove it so every content/ document counts as never staged`); }
  if (!isObj(v)) throw new Error(`${LEDGER}: not a JSON object`);
  return v;
}
const entryOf = (v) => (isObj(v) && SHA.test(v.staged) ? { finalised: SHA.test(v.finalised) ? v.finalised : null, staged: v.staged } : null);

function saveLedger(file, updates) {
  if (!updates.size) return;
  withLock(file, () => {
    const disk = readLedger(file);
    for (const [k, v] of updates) disk[k] = v;
    writeIfChanged(file, stableJSON(disk));
  });
}

async function importSibling(candidates, name) {
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`migrate's encode/${name} not found: looked in ${candidates.join(' and ')}`);
  return import(pathToFileURL(hit).href);
}

/** The selected roster slugs (sorted, the archetypes included — the caller skips them) and the unmatched list paths. */
function select(a, site) {
  const slugs = new Set();
  if (a.template) {
    const t = site.templateOf(a.template);
    if (!t) throw new Error(`no template with archetype (or id) "${a.template}" in stardust/rollout/coverage/templates.json`);
    for (const s of t.pages) slugs.add(s);
  }
  const unmatched = [];
  if (a.paths) {
    let raw;
    try { raw = readFileSync(resolve(a.paths), 'utf8'); } catch (e) { throw new Error(`--paths ${a.paths}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); }
    const byKey = new Map();
    for (const s of site.slugs) { const p = site.page(s); if (p && !byKey.has(pathKey(p.daPath))) byKey.set(pathKey(p.daPath), s); }
    for (const line of raw.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const p = line.startsWith('/') ? line : `/${line}`;
      const s = byKey.get(pathKey(p));
      if (s) slugs.add(s); else if (!unmatched.includes(p)) unmatched.push(p);
    }
  }
  return { slugs: [...slugs].sort(byCodePoint), unmatched: unmatched.sort(byCodePoint) };
}

/** One page's stage decision; reads only. {status, line, write?, entry?, web?} */
function decideStage({ root, site, slug, ledger, overwrite, currentEncode, manifests }) {
  const info = site.page(slug);
  if (!info) return { status: 'error', line: `✗ ${slug} error: no source URL (its page JSON url, or state.json pages[].url)` };
  const encoded = site.outputPathFor(slug); const content = site.contentPathFor(slug); const web = info.daPath;
  const archetype = site.templateOf(info.template)?.archetype ?? null;
  const enc = currentEncode({ root, url: info.url, docPath: encoded, archetype, manifests });
  if (enc.kind === 'missing') return { status: 'skipped', line: `- ${slug} skipped: not encoded (${enc.why})` };
  if (enc.kind === 'stopped') return { status: 'skipped', line: `- ${slug} skipped (stopped: ${stopStatus(root, enc.sidecarPath)}): ${enc.why}` };
  if (!enc.ok) return { status: 'refused', line: `✗ ${slug} ${enc.kind}: ${enc.why}` };
  const bytes = readFileSync(join(root, encoded));
  const s = sha(bytes);
  if (s !== enc.sha) return { status: 'refused', line: `✗ ${slug} stale: ${encoded} changed while it was being staged — stage again` };
  const fresh = { finalised: null, staged: s };
  const delivered = site.contentFileFor(slug);
  if (delivered && delivered !== content) {
    return { status: 'refused', line: `✗ ${slug} duplicate: ${delivered} already delivers this page; staging would add ${content} — a second DA document for it. Keep one form (remove the other from content/ and DA), then stage again` };
  }
  if (!delivered) return { status: 'staged', web, write: { file: join(root, content), bytes }, entry: [content, fresh], line: `✓ ${slug} staged → ${content}` };
  const e = entryOf(ledger[content]);
  const cur = sha(readFileSync(join(root, content)));
  if (cur === s) {
    if (e && e.staged === s && e.finalised === s) return { status: 'unchanged', line: `· ${slug} unchanged` };
    const line = e ? `· ${slug} pending: ${content} holds the staged bytes — finalise, then --record`
      : `· ${slug} adopted: ${content} already holds the encoded bytes — taken into ${LEDGER}, not written; finalise, then --record`;
    return { status: 'pending', web, entry: [content, fresh], line };
  }
  if (e && e.staged === s && e.finalised === cur) return { status: 'unchanged', line: `· ${slug} unchanged` };
  const replace = { status: 'staged', web, write: { file: join(root, content), bytes }, entry: [content, fresh] };
  if (e && (cur === e.staged || cur === e.finalised)) return { ...replace, line: `✓ ${slug} staged → ${content} (re-encoded)` };
  if (overwrite.has(slug)) return { ...replace, line: `✓ ${slug} staged → ${content} (--overwrite-hand-edit: the previous document is replaced)` };
  const why = !e ? 'was never staged and differs from the encoded document (a model- or hand-authored document)'
    : e.finalised ? `changed since it was recorded (sha ${short(cur)}, recorded ${short(e.finalised)})`
      : `changed since it was staged and no --record followed (sha ${short(cur)}, staged ${short(e.staged)}) — run --record right after the finalisers`;
  return { status: 'refused', line: `✗ ${slug} hand-edit: ${content} ${why}. To keep it, ${remedy(slug)}; then replace the document with --overwrite-hand-edit ${slug}` };
}

/** One page's record decision; reads only. */
function decideRecord({ root, site, slug, ledger }) {
  const content = site.contentPathFor(slug);
  if (!content) return { status: 'error', line: `✗ ${slug} error: no source URL (its page JSON url, or state.json pages[].url)` };
  const e = entryOf(ledger[content]);
  if (!e) return { status: 'skipped', line: `- ${slug} skipped: not staged (no ${content} entry in ${LEDGER})` };
  if (!isFile(join(root, content))) return { status: 'error', line: `✗ ${slug} error: ${content} is missing — stage the page again` };
  const cur = sha(readFileSync(join(root, content)));
  if (e.finalised === null) {
    const recorded = { status: 'recorded', entry: [content, { finalised: cur, staged: e.staged }], line: `✓ ${slug} recorded ${content} (sha ${short(cur)})` };
    if (cur === e.staged) return recorded;
    return { ...recorded, warning: true, line: `! ${slug} recorded ${content} (sha ${short(cur)}) — warning: it differs from the staged bytes (${short(e.staged)}); the chain is a no-op on an encoded document, so a hand edit slipped in: ${remedy(slug)}, then re-stage with --overwrite-hand-edit ${slug}` };
  }
  if (cur === e.finalised || cur === e.staged) return { status: 'unchanged', line: `· ${slug} unchanged` };
  return { status: 'refused', line: `✗ ${slug} hand-edit: ${content} changed since it was recorded (sha ${short(cur)}, recorded ${short(e.finalised)}) — not recorded; the next stage refuses it` };
}

export async function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(s), err: (s) => console.error(s) }) {
  let a;
  try { a = parseArgs(argv); } catch (e) { io.err(`stage-content: ${e.message}\n\n${HELP}`); return 1; }
  if (a.help) { io.out(`${HELP}\n`); return 0; }
  const root = resolve(a.root);
  try {
    const site = await (await importSibling(encodeLib('site.mjs'), 'site.mjs')).loadSite(root);
    const { currentEncode } = a.record ? {} : await importSibling(encodeLib('provenance.mjs'), 'provenance.mjs');
    const manifests = new Map();
    const { slugs, unmatched } = select(a, site);
    const archetypes = new Set(site.templates.map((t) => t.archetype));
    const stray = a.overwrite.filter((s) => !slugs.includes(s));
    if (stray.length) throw new Error(`--overwrite-hand-edit ${stray.join(',')}: not a selected page`);
    const arch = a.overwrite.filter((s) => archetypes.has(s));
    if (arch.length) throw new Error(`--overwrite-hand-edit ${arch.join(',')}: an archetype is never staged`);
    const ledgerFile = join(root, LEDGER);
    const ledger = readLedger(ledgerFile);
    const overwrite = new Set(a.overwrite);
    const rows = slugs.map((slug) => (archetypes.has(slug)
      ? { status: 'skipped', line: `- ${slug} skipped: the archetype (its gated document stays as authored)` }
      : a.record ? decideRecord({ root, site, slug, ledger }) : decideStage({ root, site, slug, ledger, overwrite, currentEncode, manifests })));
    rows.push(...unmatched.map((p) => ({ status: 'skipped', line: `- ${p} skipped: not a roster page` })));

    // content/ first, the ledger second: a run cut off in between leaves content/ = the encoded bytes (adopted next run)
    for (const r of rows) if (r.write) writeIfChanged(r.write.file, r.write.bytes);
    const updates = new Map();
    for (const r of rows) {
      if (!r.entry) continue;
      const [key, next] = r.entry;
      const old = entryOf(ledger[key]);
      if (!old || old.staged !== next.staged || old.finalised !== next.finalised) updates.set(key, next);
    }
    saveLedger(ledgerFile, updates);

    const count = (st) => rows.filter((r) => r.status === st).length;
    for (const r of rows) io.err(r.line);
    const errors = count('error') ? ` · error ${count('error')}` : '';
    const warnings = rows.filter((r) => r.warning).length;
    if (a.record) io.err(`stage-content --record: recorded ${count('recorded')} · unchanged ${count('unchanged')} · skipped ${count('skipped')} · refused ${count('refused')}${errors}${warnings ? ` · warning ${warnings}` : ''}`);
    else {
      const deliver = rows.filter((r) => r.web && (r.status === 'staged' || r.status === 'pending')).map((r) => r.web).sort(byCodePoint);
      if (deliver.length) io.out(`${deliver.join('\n')}\n`);
      io.err(`stage-content: staged ${count('staged')} · pending ${count('pending')} · unchanged ${count('unchanged')} · skipped ${count('skipped')} · refused ${count('refused')}${errors}`);
    }
    return count('refused') ? 2 : count('error') ? 1 : 0;
  } catch (e) {
    io.err(`stage-content: ${e.message}`);
    return 1;
  }
}

// Compare by real path (a symlinked checkout would otherwise turn the CLI into a silent no-op).
const isMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) process.exitCode = await main();
