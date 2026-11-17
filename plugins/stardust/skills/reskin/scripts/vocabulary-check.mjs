#!/usr/bin/env node
// skills/reskin/scripts/vocabulary-check.mjs — the full donor vocabulary is built (deploy Step 2c).
// Reads reskin/donor-modules.md (every included module, used by a page or not) and the EDS project, and
// checks each module's disposition: a block or variant exists in blocks/, a variant is handled by its block
// code and listed in metadata.json `variants`, a section-style is styled, and each module's library sample
// exists when --library is given. Every blockless kind (section-style, style, convention, feature,
// default-content) needs a why; an invented block another project block can host (chips → links) is a variant
// of it unless a why says otherwise (variant-first). A donor-modules.md without a Disposition column
// (hand-authored, pre-0.34) is read from its EDS block column. No browser, no network.
// Exit codes: 0 every module built · 1 a module is not built or not explained · 2 usage (missing file).
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEEDS_WHY, parseDisposition, variantHost } from './figma/eds-map.mjs';

export const HELP = `Usage:
  node vocabulary-check.mjs [--modules stardust/reskin/donor-modules.md] [--project .]
                            [--library content/library/blocks] [--json <out.json>]
  --modules  the module vocabulary (default stardust/reskin/donor-modules.md)
  --project  the EDS project root holding blocks/ and styles/ (default .)
  --library  the block library sample folder (<block>.plain.html or <block>.html); checks every block and
             variant has a sample section there
  --json     also write the per-module verdicts
Exit codes: 0 every module built · 1 a module not built or not explained · 2 usage`;

const BOILERPLATE_OR_COLLECTION = ['cards', 'columns', 'footer', 'fragment', 'header', 'hero', 'accordion', 'breadcrumbs',
  'carousel', 'embed', 'form', 'modal', 'quote', 'search', 'table', 'tabs', 'video'];

const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** parseModulesMd(md) → [{ id, name, eds: { block, variant }, disposition: { kind, name, why } }] (excluded rows skipped). */
export function parseModulesMd(md) {
  const lines = md.split('\n');
  const h = lines.findIndex((l) => /^\|\s*#\s*\|/.test(l));
  if (h < 0) return [];
  const head = splitRow(lines[h]).map((c) => c.toLowerCase());
  const col = (n) => head.indexOf(n);
  const out = [];
  for (const line of lines.slice(h + 2)) {
    if (!line.trim().startsWith('|')) break;
    const c = splitRow(line);
    const id = c[col('#')];
    if (!id || id === '—') continue;
    const label = c[col('eds block')] ?? '';
    const m = label.match(/^([a-z0-9-]+)(?: \(([^)]+)\))?$/);
    const eds = label === 'default content' || !m ? { block: null, variant: null } : { block: m[1], variant: m[2] ?? null };
    let d = col('disposition') >= 0 ? parseDisposition(c[col('disposition')]) : null;
    if (!d) d = { kind: !eds.block ? 'default-content' : ['header', 'footer'].includes(eds.block) ? 'chrome' : eds.variant ? 'variant' : 'block', name: null, why: '', derived: true };
    out.push({ id, name: c[col('module')] ?? '', eds, disposition: d, malformed: col('disposition') >= 0 && !parseDisposition(c[col('disposition')]) });
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * checkVocabulary(modules, read, { library, blocks }) → [{ id, name, kind, verdict: PASS|FAIL|NOTE, why }]
 * read(relPath) → file text or null (the project); library: a folder relative to the project, or null;
 * blocks: the project's block names (for variant-first).
 */
export function checkVocabulary(modules, read, { library = null, blocks = [] } = {}) {
  const styles = ['styles/styles.css', 'styles/lazy-styles.css'].map(read).filter(Boolean).join('\n');
  const sample = (b) => (library ? read(join(library, `${b}.plain.html`)) ?? read(join(library, `${b}.html`)) : null);
  return modules.map((m) => {
    const { kind, name, why } = m.disposition;
    const r = (verdict, text) => ({ id: m.id, name: m.name, kind, block: m.eds.block, variant: m.eds.variant, verdict, why: text });
    if (m.malformed) return r('FAIL', 'Disposition cell is not "<kind>[ (<name>)][: <why>]"');
    const { block, variant } = m.eds;
    if (['block', 'variant', 'chrome'].includes(kind)) {
      if (!block) return r('FAIL', `${kind} with no EDS block`);
      const js = read(`blocks/${block}/${block}.js`);
      if (js === null) return r('FAIL', `blocks/${block}/${block}.js does not exist: build it (used by a page or not)`);
      if (kind === 'chrome') return r('PASS', `blocks/${block}`);
      const css = read(`blocks/${block}/${block}.css`) ?? '';
      if (variant) {
        const inCode = new RegExp(`\\.${esc(block)}\\.${esc(variant)}(?![\\w-])`).test(css) || new RegExp(`['"\`]${esc(variant)}['"\`]`).test(js);
        if (!inCode) return r('FAIL', `blocks/${block} has no rule or code for the variant "${variant}" (.${block}.${variant})`);
        const meta = read(`blocks/${block}/metadata.json`);
        if (meta !== null) {
          let v = null; try { v = JSON.parse(meta).variants; } catch { /* malformed below */ }
          if (!Array.isArray(v) || !v.includes(variant)) return r('FAIL', `blocks/${block}/metadata.json "variants" does not list "${variant}"`);
        }
      }
      if (library) {
        const s = sample(block);
        if (s === null) return r('FAIL', `no library sample ${library}/${block}.plain.html`);
        if (variant && !new RegExp(`class="${esc(block)}(?: [^"]*)? ${esc(variant)}(?: [^"]*)?"`).test(s)) return r('FAIL', `library sample ${block} has no "${block} (${variant})" section`);
      }
      const host = variantHost(block, blocks.filter((b) => b !== block));
      if (kind === 'block' && host && !why) return r('FAIL', `variant-first: blocks/${host} hosts it — build it as ${host} (${block}), or say why it is not a ${host} variant`);
      if (kind === 'block' && !BOILERPLATE_OR_COLLECTION.includes(block) && !why) return r('NOTE', `a new block (no boilerplate or Block Collection match): record why no existing block's variant fits`);
      return r('PASS', `blocks/${block}${variant ? ` (${variant})` : ''}`);
    }
    if (NEEDS_WHY.includes(kind) && !why) return r('FAIL', `${kind} needs a why: what it styles or does and where it lives`);
    if (kind === 'section-style') {
      if (!name) return r('FAIL', 'section-style needs its Style value: "section-style (<name>)"');
      if (!new RegExp(`\\.section\\.${esc(name)}(?![\\w-])`).test(styles)) return r('FAIL', `styles/ has no .section.${name} rule`);
      return r('PASS', `.section.${name}`);
    }
    return r('PASS', why || kind);
  });
}

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const modulesPath = opt('--modules', 'stardust/reskin/donor-modules.md');
  const project = opt('--project', '.');
  const library = opt('--library', null);
  const jsonOut = opt('--json', null);
  if (!existsSync(modulesPath)) { console.error(`vocabulary-check: no ${modulesPath} (reskin Phase 1 writes it; --modules <path>)`); return 2; }
  if (!existsSync(join(project, 'blocks'))) { console.error(`vocabulary-check: no blocks/ under ${project} (--project <EDS root>)`); return 2; }
  if (library && !existsSync(join(project, library))) { console.error(`vocabulary-check: no library folder ${join(project, library)}`); return 2; }
  const modules = parseModulesMd(readFileSync(modulesPath, 'utf8'));
  if (!modules.length) { console.error(`vocabulary-check: ${modulesPath} has no module table`); return 2; }
  const read = (p) => { const f = join(project, p); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const blocks = readdirSync(join(project, 'blocks'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const rows = checkVocabulary(modules, read, { library, blocks });
  for (const x of rows) console.log(`${x.verdict.padEnd(4)} ${x.id} ${x.name} → ${x.kind}${x.block ? ` ${x.block}${x.variant ? ` (${x.variant})` : ''}` : ''}: ${x.why}`);
  const count = (v) => rows.filter((x) => x.verdict === v).length;
  const kinds = [...new Set(rows.map((x) => x.kind))].map((k) => `${rows.filter((x) => x.kind === k).length} ${k}`).join(', ');
  console.log(`vocabulary: ${rows.length} modules (${kinds}) · ${count('PASS')} PASS · ${count('NOTE')} NOTE · ${count('FAIL')} FAIL${library ? '' : ' · library not checked (--library)'}`);
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ modules: modulesPath, library, rows }, null, 2)}\n`);
  return count('FAIL') ? 1 : 0;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main(process.argv.slice(2)).then((c) => process.exit(c));
