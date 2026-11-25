/**
 * skills/stardust/scripts/lib/documents.mjs — owns which files of a content tree are DA documents, the DA path each
 * one PUTs to, what a path-list entry names, and the DA paths the authoring library owns. One copy for the producer
 * and the consumers of a publish list: deploy/deploy-batch (what it sends), deploy/localize-links (what a link may
 * point to), replica/extend-roster (what an extend pass may publish) and rollout/da-library (where it writes).
 *
 *   contentDocuments(root)          every document under root, sorted: [{ file: 'a/index.html', webPath: '/a/index' }].
 *                                   A document is a file whose name ends in a lowercase `.html` (`x.HTML`, `x.htm` are
 *                                   not: deploy never sends them); its webPath is documentPath (lib/paths.mjs). Reads
 *                                   the filesystem; nothing else here does.
 *   resolveEntry(entry, webPaths)   what one list entry names among those webPaths (a Set): its literal form (a web
 *                                   path, `/changelog.html` for changelog.html.html), its content-file form (one `.html`
 *                                   dropped) or a folder (`/x/` → `/x/index`). { match } for one, { ambiguous: [forms] }
 *                                   for two (`/nav.html`: nav.html or nav.html.html), { unmatched: true } for none. Pure.
 *   LIBRARY_ROOT, isLibraryPath(p)  `/library`, the DA folder rollout/da-library writes (blocks, templates, their
 *                                   sheets); a destination at or under it belongs to the authoring library, never to a
 *                                   page. Pure.
 * Library, no CLI; nothing runs on import.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { documentPath, pathKey } from './paths.mjs';

export const isDocumentName = (name) => String(name).endsWith('.html');

export function contentDocuments(root) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
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
