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
 *   one the encoder's round-trip compares with). Skipped: a page with no encoded document (a stopped page — the
 *   model authors it) and a path outside the roster.
 * Paths come from migrate's encode/site.mjs (outputPathFor, contentPathFor, contentFileFor) and eds-path.mjs.
 *
 * Ledger stardust/deploy/stage-ledger.json: {"content/<da-path>.html": {staged, finalised}} — the sha256 (hex) of the
 *   bytes stage-content last copied, and of the content/ file --record found after the finalisers (null until then).
 *   Sorted keys, trailing newline, tmp + rename under deploy's file lock, rewritten only when its bytes change.
 *
 * Stage, per page — content/ may hold only what was staged or what --record recorded:
 *   no content/ document                      → copy (staged)
 *   the other delivered form exists           → refuse (duplicate): <p>.html and <p>/index.html would be two DA
 *                                               documents for one page; nothing is written
 *   content/ holds the encoded bytes          → pending (no copy; listed until --record)
 *   content/ holds the recorded form of the same encoded bytes → unchanged
 *   content/ holds staged or recorded bytes, the encoding changed → copy (staged)
 *   anything else                             → refuse (hand-edit): an edit since --record, a finaliser run not yet
 *                                               recorded, or a document never staged (model- or hand-authored).
 *                                               --overwrite-hand-edit <slug> replaces it; a hands-off run never
 *                                               passes it — the edit moves into the template's map first.
 * Record (--record): right after the finalisers, before the PUT, for the pages the stage listed. A page staged since
 *   its last record gets finalised = the sha of its content/ file now. A recorded page is never re-recorded: a later
 *   change to it (a fix-round edit, autofix) is what the guard exists to catch.
 *
 * Output: stdout = the paths to deliver (staged now, or staged and not yet recorded), sorted, one per line — the file
 *   for deploy-batch.mjs --force --paths; --record prints none. stderr = a line per page, then the verdict
 *   `stage-content: staged N · pending N · unchanged N · skipped N · refused N`
 *   (`stage-content --record: recorded N · unchanged N · skipped N · refused N`). Zero writes when nothing changed.
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
  --template <a>          the pages of the template whose archetype (or id) is <a>; the archetype itself is never staged
  --paths <file>          one DA path per line (/a/b, /a/index), deploy-batch's --paths format
  --root <dir>            the project root (default: the current directory)
  --record                after the finalisers, before the PUT: record each newly staged page's content/ sha
  --overwrite-hand-edit   replace these pages' hand-edited or never-staged content/ documents (never in hands-off)
  --help                  this text

stdout: the paths to deliver, one per line — redirect it to a file for deploy-batch.mjs --force --paths <file>.
stderr: one line per page, then the verdict. A page whose content/ document changed since it was staged or recorded
(a hand edit), or whose other delivered form (<p>.html / <p>/index.html) exists, is refused and never written.
Exit: 0 ok · 1 usage, unknown template, unreadable list or ledger, missing page input · 2 a page refused.`;

export const LEDGER = 'stardust/deploy/stage-ledger.json';
const HERE = dirname(fileURLToPath(import.meta.url));
// migrate's encode/site.mjs owns the page paths: the plugin tree, then the project copy (stardust/scripts/<skill>/)
const SITE = [join(HERE, '..', '..', 'migrate', 'scripts', 'encode', 'site.mjs'), join(HERE, '..', 'migrate', 'encode', 'site.mjs')];
const HEX = /^[0-9a-f]{64}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
const short = (h) => (h ? h.slice(0, 12) : 'none');

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
const entryOf = (v) => (isObj(v) && HEX.test(v.staged) ? { finalised: HEX.test(v.finalised) ? v.finalised : null, staged: v.staged } : null);

function saveLedger(file, updates) {
  if (!updates.size) return;
  withLock(file, () => {
    const disk = readLedger(file);
    for (const [k, v] of updates) disk[k] = v;
    writeIfChanged(file, stableJSON(disk));
  });
}

async function loadSite(root) {
  const hit = SITE.find((p) => existsSync(p));
  if (!hit) throw new Error(`migrate's encode/site.mjs not found: looked in ${SITE.join(' and ')}`);
  return (await import(pathToFileURL(hit).href)).loadSite(root);
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
function decideStage({ root, site, slug, ledger, overwrite }) {
  const info = site.page(slug);
  if (!info) return { status: 'error', line: `✗ ${slug} error: no source URL (its page JSON url, or state.json pages[].url)` };
  const encoded = site.outputPathFor(slug); const content = site.contentPathFor(slug); const web = info.daPath;
  if (!isFile(join(root, encoded))) return { status: 'skipped', line: `- ${slug} skipped: not encoded (no ${encoded})` };
  const bytes = readFileSync(join(root, encoded));
  const s = sha(bytes);
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
    return { status: 'pending', web, entry: [content, fresh], line: `· ${slug} pending: ${content} holds the staged bytes — finalise, then --record` };
  }
  if (e && e.staged === s && e.finalised === cur) return { status: 'unchanged', line: `· ${slug} unchanged` };
  const replace = { status: 'staged', web, write: { file: join(root, content), bytes }, entry: [content, fresh] };
  if (e && (cur === e.staged || cur === e.finalised)) return { ...replace, line: `✓ ${slug} staged → ${content} (re-encoded)` };
  if (overwrite.has(slug)) return { ...replace, line: `✓ ${slug} staged → ${content} (--overwrite-hand-edit: the previous document is replaced)` };
  const why = !e ? 'exists but was never staged (a model- or hand-authored document)'
    : e.finalised ? `changed since it was recorded (sha ${short(cur)}, recorded ${short(e.finalised)})`
      : `changed since it was staged and no --record followed (sha ${short(cur)}, staged ${short(e.staged)}) — run --record right after the finalisers`;
  return { status: 'refused', line: `✗ ${slug} hand-edit: ${content} ${why}. Move a wanted edit into the template's map and re-encode; replace the document with --overwrite-hand-edit ${slug}` };
}

/** One page's record decision; reads only. */
function decideRecord({ root, site, slug, ledger }) {
  const content = site.contentPathFor(slug);
  if (!content) return { status: 'error', line: `✗ ${slug} error: no source URL (its page JSON url, or state.json pages[].url)` };
  const e = entryOf(ledger[content]);
  if (!e) return { status: 'skipped', line: `- ${slug} skipped: not staged (no ${content} entry in ${LEDGER})` };
  if (!isFile(join(root, content))) return { status: 'error', line: `✗ ${slug} error: ${content} is missing — stage the page again` };
  const cur = sha(readFileSync(join(root, content)));
  if (e.finalised === null) return { status: 'recorded', entry: [content, { finalised: cur, staged: e.staged }], line: `✓ ${slug} recorded ${content} (sha ${short(cur)})` };
  if (cur === e.finalised || cur === e.staged) return { status: 'unchanged', line: `· ${slug} unchanged` };
  return { status: 'refused', line: `✗ ${slug} hand-edit: ${content} changed since it was recorded (sha ${short(cur)}, recorded ${short(e.finalised)}) — not recorded; the next stage refuses it` };
}

export async function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(s), err: (s) => console.error(s) }) {
  let a;
  try { a = parseArgs(argv); } catch (e) { io.err(`stage-content: ${e.message}\n\n${HELP}`); return 1; }
  if (a.help) { io.out(`${HELP}\n`); return 0; }
  const root = resolve(a.root);
  try {
    const site = await loadSite(root);
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
      : a.record ? decideRecord({ root, site, slug, ledger }) : decideStage({ root, site, slug, ledger, overwrite })));
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
    if (a.record) io.err(`stage-content --record: recorded ${count('recorded')} · unchanged ${count('unchanged')} · skipped ${count('skipped')} · refused ${count('refused')}${errors}`);
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
