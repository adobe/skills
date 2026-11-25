/**
 * skills/stardust/scripts/lib/documents.mjs — owns which files of a content tree are DA documents, the DA path each
 * one PUTs to, what a path-list entry names, and the DA paths the authoring library owns. One copy for the producer
 * and the consumers of a publish list: deploy/deploy-batch (what it sends), deploy/localize-links (what a link may
 * point to), replica/extend-roster (what an extend pass may publish) and rollout/da-library (where it writes).
 *
 *   contentDocuments(root, {hidden}) every document under root, sorted: [{ file: 'a/index.html', webPath: '/a/index' }].
 *                                   A document is a file whose name ends in a lowercase `.html` (`x.HTML`, `x.htm` are
 *                                   not: deploy never sends them); its webPath is documentPath (lib/paths.mjs). An
 *                                   entry whose name starts with `.` (`.drafts/`) is skipped — its served URL is not its
 *                                   path — unless `hidden: true` (deploy-batch, which has always sent them).
 *   deliveredRows(pagesDoc)         rollout coverage pages.json rows that are delivered: a `path` and delivery status
 *                                   `deployed` or `verified` (da-library's rule, and the extend pass's opening check).
 *   contentFile(root, path)         the content file of a delivered path (`/` → index.html, `/a` → a.html or
 *                                   a/index.html), or null.
 *   replaceIfUnchanged(path, sha, bytes)  write `bytes` over a file only while it still holds the bytes whose sha256 is
 *                                   `sha`: the replacement is prepared first, the file moved aside atomically and
 *                                   checked, the replacement linked in (a link never replaces a file). A save made
 *                                   meanwhile is kept; on any other failure the original is put back. A symbolic link
 *                                   is refused, never replaced by its target's bytes. The replacement and the moved-
 *                                   aside file live in the repository's git dir (`<git dir>/stardust-replace/`, never
 *                                   staged, same filesystem) — outside a repository, beside the file — and a kept one
 *                                   is named. Returns null when written, else why not. Used by localize-links and
 *                                   extend-roster relink-restore.
 *   resolveEntry(entry, webPaths)   what one list entry names among those webPaths (a Set): its literal form (a web
 *                                   path, `/changelog.html` for changelog.html.html), its content-file form (one `.html`
 *                                   dropped) or a folder (`/x/` → `/x/index`). { match } for one, { ambiguous: [forms] }
 *                                   for two (`/nav.html`: nav.html or nav.html.html), { unmatched: true } for none. Pure.
 *   LIBRARY_ROOT, isLibraryPath(p)  `/library`, the DA folder rollout/da-library writes (blocks, templates, their
 *                                   sheets); a destination at or under it belongs to the authoring library, never to a
 *                                   page. Pure.
 * Library, no CLI; nothing runs on import; the filesystem is read only by contentDocuments, contentFile and
 * replaceIfUnchanged, which also asks `git rev-parse --absolute-git-dir` where to keep its files.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { documentPath, pathKey } from './paths.mjs';

export const isDocumentName = (name) => String(name).endsWith('.html');

export function contentDocuments(root, { hidden = false } = {}) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (!hidden && name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (isDocumentName(name)) {
        const file = relative(root, p).split(sep).join('/');
        out.push({ file, webPath: documentPath(file) });
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function resolveEntry(entry, webPaths) {
  const e = String(entry).startsWith('/') ? String(entry) : `/${entry}`;
  const forms = [...new Set([e, e.replace(/\.html$/i, ''), e.replace(/\/$/, '/index')])].filter((f) => webPaths.has(f));
  if (forms.length > 1) return { ambiguous: forms };
  if (forms.length === 1) return { match: forms[0] };
  return { unmatched: true };
}

export const LIBRARY_ROOT = '/library';
export function isLibraryPath(p) {
  const k = pathKey(String(p));
  return k === LIBRARY_ROOT || k.startsWith(`${LIBRARY_ROOT}/`);
}

export const deliveredRows = (pagesDoc) => ((pagesDoc && Array.isArray(pagesDoc.pages)) ? pagesDoc.pages : [])
  .filter((p) => p && p.path && p.delivery && ['deployed', 'verified'].includes(p.delivery.status));

export function contentFile(root, p) {
  const rel = p === '/' || p === '' ? 'index' : String(p).replace(/^\/|\/$/g, '');
  for (const c of [`${rel}.html`, `${rel}/index.html`]) { const f = join(root, c); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
// Where the replacement and the moved-aside file live: the repository's git dir, which a checkpoint never stages.
const stashes = new Map();
function stashFor(path) {
  const dir = dirname(path);
  if (!stashes.has(dir)) {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' });
    const stash = r.status === 0 && r.stdout.trim() ? join(r.stdout.trim(), 'stardust-replace') : dir;
    mkdirSync(stash, { recursive: true });
    stashes.set(dir, stash);
  }
  return stashes.get(dir);
}
export function replaceIfUnchanged(path, expected, bytes, fs = { renameSync, linkSync, rmSync, writeFileSync, readFileSync }) {
  let st;
  try { st = lstatSync(path); } catch (e) { return `cannot read it (${e.code || e.message}) — left as it is`; }
  if (st.isSymbolicLink()) return 'a symbolic link — left as it is (its target is never rewritten through it)';
  const stash = stashFor(path); const id = `${basename(path)}.${process.pid}.${Date.now()}`;
  const tmp = join(stash, `${id}.replace`); const aside = join(stash, `${id}.aside`);
  try { fs.writeFileSync(tmp, bytes); } catch (e) { return `cannot prepare the new bytes (${e.code || e.message}) — left as it is`; }
  try { fs.renameSync(path, aside); } catch (e) { fs.rmSync(tmp, { force: true }); return `cannot move it aside (${e.code || e.message}) — left as it is`; }
  const putBack = (why) => {
    try { fs.linkSync(aside, path); fs.rmSync(aside); return why; } catch (e) {
      return `${why}; ${e.code === 'EEXIST' ? 'a new file took its place' : `putting it back failed (${e.code || e.message})`} — its bytes are kept in ${aside}`;
    }
  };
  if (sha(fs.readFileSync(aside)) !== expected) { fs.rmSync(tmp, { force: true }); return putBack('changed since it was read — left as it is'); }
  try { fs.linkSync(tmp, path); } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (e.code === 'EEXIST') return `saved again while it was replaced — the new file is kept; the bytes read are in ${aside}`;
    return putBack(`replacing failed (${e.code || e.message}) — left as it is`);
  }
  fs.rmSync(tmp); fs.rmSync(aside);
  return null;
}
