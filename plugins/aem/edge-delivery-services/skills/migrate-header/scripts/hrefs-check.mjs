#!/usr/bin/env node
/**
 * No invented URL: every link of the nav documents and their fragments must be a link of the
 * source's capture, or a fragment of the build.
 * - The capture's links: open/open.json (states[].panel.items) and the header regions' HTML
 *   (regions/*.html), absolute against the source page (page.json url).
 * - The build's documents: every nav.plain.html under <drafts>, and every .plain.html under a
 *   fragments/ folder of <drafts>.
 * - A link to /…/fragments/<name> is a fragment of the build when <drafts>/…/fragments/<name>.plain.html
 *   exists. Any other link is resolved against the source page and must be in the capture.
 * Usage: node hrefs-check.mjs <capture dir> <drafts dir>
 * Prints each link not in the capture; exit 0 when there is none, 1 when there is, 2 on a usage error.
 * No dependencies.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node hrefs-check.mjs <capture dir> <drafts dir>';

/** The href of every <a> in `html`, any quoting, with &amp; decoded. */
export function hrefsOf(html) {
  const out = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const m of html.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, '&').trim());
  return out;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The capture's links, absolute against the source page. */
export function capturedHrefs(src) {
  const { url: base } = readJson(join(src, 'page.json'));
  const known = new Set();
  const add = (href) => {
    try {
      known.add(new URL(href, base).href);
    } catch {
      // not a URL
    }
  };
  const open = join(src, 'open', 'open.json');
  if (existsSync(open)) {
    for (const state of readJson(open).states ?? []) {
      for (const item of state.panel?.items ?? []) add(item.href);
    }
  }
  const regions = join(src, 'regions');
  if (existsSync(regions)) {
    for (const f of readdirSync(regions).filter((x) => x.endsWith('.html'))) {
      hrefsOf(readFileSync(join(regions, f), 'utf8')).forEach(add);
    }
  }
  return { base, known };
}

/** Every file under `dir`, recursively. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The build's nav documents and fragments under `drafts`. */
export function buildDocuments(drafts) {
  return walk(drafts).filter((f) => {
    const rel = relative(drafts, f).split(/[\\/]/);
    return (
      rel.at(-1) === 'nav.plain.html' || (rel.at(-2) === 'fragments' && f.endsWith('.plain.html'))
    );
  });
}

/** Each link of the build's documents that is neither in the capture nor one of its fragments. */
export function inventedHrefs(src, drafts) {
  const { base, known } = capturedHrefs(src);
  const docs = buildDocuments(drafts);
  const bad = [];
  for (const doc of docs) {
    for (const href of hrefsOf(readFileSync(doc, 'utf8'))) {
      const path = href.startsWith('/') && !href.startsWith('//') ? href.split(/[?#]/)[0] : null;
      if (path && /^\/(?:[\w-]+\/)*fragments\/[\w-]+$/.test(path)) {
        if (!existsSync(join(drafts, `${path}.plain.html`))) {
          bad.push({ href, doc, why: `no such fragment (${join(drafts, `${path}.plain.html`)})` });
        }
        continue;
      }
      let abs = null;
      try {
        abs = new URL(href, base).href;
      } catch {
        // not a URL
      }
      if (!abs || !known.has(abs)) bad.push({ href, doc, why: 'not in the capture' });
    }
  }
  return { docs, bad };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [src, drafts] = process.argv.slice(2);
  if (!src || !drafts || process.argv.includes('--help')) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!existsSync(join(src, 'page.json'))) {
    console.error(`${src} is not a capture (no page.json). ${USAGE}`);
    process.exit(2);
  }
  if (!existsSync(drafts)) {
    console.error(`${drafts} does not exist. ${USAGE}`);
    process.exit(2);
  }
  const { docs, bad } = inventedHrefs(src, drafts);
  for (const b of bad) console.log(`INVENTED ${b.href} (${relative(drafts, b.doc)}: ${b.why})`);
  if (!docs.length) console.log(`hrefs: no nav.plain.html or fragment under ${drafts}`);
  else if (bad.length) console.log(`hrefs: ${bad.length} not in the capture`);
  else console.log(`hrefs: every link of the ${docs.length} documents is in the capture`);
  process.exit(bad.length || !docs.length ? 1 : 0);
}
