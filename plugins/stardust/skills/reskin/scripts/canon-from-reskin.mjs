#!/usr/bin/env node
/**
 * skills/reskin/scripts/canon-from-reskin.mjs — the reskin → migrate bridge.
 *
 * Reskin produces gated, token-faithful pages but none of the artifacts migrate consumes. This script
 * derives them from the APPROVED reskin archetype, generically — every per-site input comes from
 * state.json, donor-tokens.json, mapping.json and the content models:
 *
 *   <dir>/canon/header.html, footer.html     <header|footer data-canon> lifted verbatim
 *   <dir>/canon/canon.css                    :root first (migrate strict 1) + class-based rules
 *                                            (canon-extraction.md § 2 selection rule), @media kept
 *   <dir>/canon/modules/<id>.html            section[data-module] skeleton, [data-slot-body] emptied;
 *                                            the named archetype's modules first, then modules only
 *                                            the other page types' archetypes render (the ledger's
 *                                            handoff.<type>.archetype, else the type's first approved
 *                                            page with a prototype)
 *                                            (findings: mapped modules with no skeleton, modules the
 *                                            mapping composes more than one way)
 *   <root>/DESIGN.md, DESIGN.json            fresh from donor-tokens.json; extensions.canon / modules
 *   <dir>/direction.md                       "Active <ISO>": the direction is the donor (reskin has no direct)
 *   <dir>/dynamic-features.md                one F row per page with form controls (triage.md shape)
 *
 * Pinned tokens are MEASURED (computed style of `main section` / `main .container` at 1440/768/360 —
 * needs playwright; without it the pins are skipped and listed as a finding), so whatever the
 * renderer fell back to is surfaced, not hidden.
 *
 * Stale flagging (state-machine.md § Stale flagging, "Canon changes"): when a canon already existed
 * (re-authoring with --force), each canon file and module skeleton is compared with the previous
 * DESIGN.json extensions.canon. Content-aware: a migrated page is flagged only when its sidecar's
 * canonShas / archetypeSha / modules no longer match; an approved page (not the archetype) is flagged
 * when anything changed. `stale: true` + staleReason "canon changed at <ts>; affected: …" — the status
 * does not move. Re-authoring identical content keeps a file byte-for-byte (its provenance stamp
 * too). Hashes are migrate's (sha1, 12 hex, of the file bytes) so the sidecars compare.
 *
 * Visual record: on a first approval and on every re-approval that changes the canon, the archetype is
 * captured with replica's stitch-shot.mjs into <dir>/reskin/approvals/<slug>.<ts>.png; a re-approval is
 * then pixel-compared (replica's pixel-compare.mjs) with that archetype's previous capture and the % lands in the
 * DESIGN.json canon history entry. Informational: above --visual-threshold it prints a FINDING, never
 * refuses. Without the replica scripts, playwright, pngjs or pixelmatch it is skipped as a finding.
 *
 * Usage:
 *   node canon-from-reskin.mjs <archetype-slug> [--dir stardust] [--root .] [--tokens <dir>/reskin/donor-tokens.json]
 *     [--mapping <dir>/reskin/mapping.json] [--models <dir>/reskin/content-model]
 *     [--modules <dir>/reskin/donor-modules.md] [--visual-threshold 10] [--force]
 *
 * Reads: <dir>/state.json, the archetype's prototypePath (and the other types' approved archetypes'),
 *        the tokens, mapping, content models, the module
 *        table, the previous <root>/DESIGN.json and migrate sidecars (stale flagging).
 * Writes: the files listed above; <dir>/reskin/approvals/*.png; <dir>/state.json only when a page is flagged stale.
 * Exit: 0 ok · 1 refused (archetype not approved, missing input, canon exists without --force) · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELP = `usage: node canon-from-reskin.mjs <archetype-slug> [--dir stardust] [--root .] [--tokens <file>]
         [--mapping <file>] [--models <dir>] [--modules <file>] [--visual-threshold <pct>] [--force]

Derive migrate's inputs (canon/, DESIGN.md/.json, direction.md, dynamic-features.md) from an approved
reskin archetype. --force re-authors an existing canon and flags affected pages stale. A changed canon
is captured and pixel-compared with the previous approval (warn above --visual-threshold, default 10).
Exit 0 ok, 1 refused, 2 usage.`;

class Refused extends Error { constructor(m) { super(m); this.code = 1; } }
class Usage extends Error { constructor(m) { super(m); this.code = 2; } }

// migrate.mjs's hash: sha1 of the bytes, 12 hex — so sidecar canonShas compare directly.
export const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// A canon file without its provenance stamp: re-authoring identical content keeps the file (and its
// hash) as it was, so only real changes reach the delta.
export const withoutStamp = (s) => s.replace(/<!-- stardust:canon[\s\S]*?-->\n?/g, '').replace(/\/\* stardust:canon[^*]*\*\/\n?/g, '');
function writeStable(file, body) {
  if (existsSync(file)) { const old = readFileSync(file, 'utf8'); if (withoutStamp(old) === withoutStamp(body)) return old; }
  writeFileSync(file, body); return body;
}

// ---- pure: CSS ------------------------------------------------------------------------------------
// Top-level { prelude, body } pairs, nested braces respected, comments dropped.
export function cssBlocks(css) {
  const out = []; let i = 0; css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while (i < css.length) {
    const open = css.indexOf('{', i); if (open < 0) break;
    let depth = 1; let j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1).trim() }); i = j;
  }
  return out;
}
export const classBased = (sel) => sel.split(',').every((s) => /\.[A-Za-z_][\w-]*/.test(s));

// canon-extraction.md § 2: class-based rules are canon; element/id rules stay in the page.
export function liftCss(style) {
  const rootBlock = (style.match(/:root\s*\{[^}]*\}/) || [])[0] || null;
  const lifted = []; const leftBehind = [];
  for (const b of cssBlocks(style)) {
    if (b.prelude.startsWith(':root')) continue;
    if (b.prelude.startsWith('@media')) {
      const inner = cssBlocks(b.body).filter((r) => { const ok = classBased(r.prelude); if (!ok) leftBehind.push(`${b.prelude} ${r.prelude}`); return ok; });
      if (inner.length) lifted.push(`${b.prelude} {\n${inner.map((r) => `  ${r.prelude} { ${r.body} }`).join('\n')}\n}`);
    } else if (b.prelude.startsWith('@')) leftBehind.push(b.prelude);
    else if (classBased(b.prelude)) lifted.push(`${b.prelude} { ${b.body} }`);
    else leftBehind.push(b.prelude);
  }
  return { rootBlock, lifted, leftBehind };
}

// ---- pure: module skeletons -----------------------------------------------------------------------
export function moduleSkeletons(html) {
  const out = new Map(); const findings = [];
  for (const m of html.matchAll(/<section\b[^>]*data-module="([^"]+)"[^>]*>[\s\S]*?<\/section>/gi)) {
    const id = m[1]; if (out.has(id)) continue;
    // A split layout places its media image after the body, inside the panel.
    let sk = m[0].replace(/(<(\w+)\b[^>]*\bdata-slot-body\b[^>]*>)[\s\S]*(<\/\2>\s*(?:<img\b[^>]*>\s*)?<\/div>\s*<\/div>\s*<\/section>)$/i, '$1$3');
    if (sk === m[0]) findings.push(`module ${id}: no [data-slot-body] container — skeleton lifted with archetype content (canon must not hold per-page content)`);
    sk = sk.replace(/<img\b[^>]*class="(band-img|split-img)"[^>]*>/gi, '<img class="$1" data-slot="media" alt="" src="">');
    out.set(id, sk);
  }
  return { modules: out, findings };
}

// ---- pure: multi-archetype modules ----------------------------------------------------------------
// The other page types' archetypes that can contribute modules the named archetype does not render.
// The ledger's handoff.<type>.archetype wins (the page the reskin predicate registered); otherwise the
// first approved/migrated page of the type that has a prototype. Returns [{ slug, type, prototypePath }].
export function otherArchetypes(pages, slug, handoff = {}) {
  const own = pages.find((p) => p.slug === slug)?.type;
  const ok = (p) => p && p.type && p.type !== own && p.slug !== slug && (p.status === 'approved' || p.status === 'migrated') && p.prototypePath;
  const out = []; const seen = new Set(own ? [own] : []);
  for (const p of pages) {
    if (!p.type || seen.has(p.type)) continue;
    const named = handoff?.[p.type]?.archetype;
    const pick = (named && pages.find((q) => q.slug === named && ok(q))) || pages.find((q) => q.type === p.type && ok(q));
    seen.add(p.type);
    if (pick) out.push({ slug: pick.slug, type: pick.type, prototypePath: pick.prototypePath });
  }
  return out;
}

// Modules the mapping references that have no canon skeleton, and modules the mapping composes in more
// than one way (layout/width/tone — the section classes a skeleton keeps; columns live in the emptied
// slot body) — the canon holds one skeleton per module id.
export function mappingModuleIssues(mapping, moduleIds) {
  const have = new Set(moduleIds); const comps = new Map();
  for (const [ps, pm] of Object.entries(mapping?.pages || {})) {
    for (const [s, m] of Object.entries(pm?.slots || {})) {
      if (!m?.module) continue;
      const c = [m.layout || 'stack', m.width || 'narrow', m.tone || ''].join('|');
      if (!comps.has(m.module)) comps.set(m.module, new Map());
      const byComp = comps.get(m.module); if (!byComp.has(c)) byComp.set(c, []); byComp.get(c).push(`${ps}:${s}`);
    }
  }
  const missing = [...comps.keys()].filter((id) => !have.has(id));
  const mixed = [...comps].filter(([, byComp]) => byComp.size > 1).map(([id, byComp]) => ({ id, compositions: [...byComp].map(([c, at]) => ({ composition: c, at })) }));
  return { missing, mixed };
}

// ---- pure: stale flagging -------------------------------------------------------------------------
// prev / next: { files: { header|footer|css: { sha } }, modules: { <id>: sha } }. Returns changed keys
// ("header", "css", "module:M2"); null when there was no previous canon (first approval: nothing stale).
export function canonDelta(prev, next) {
  if (!prev) return null;
  const changed = [];
  for (const k of new Set([...Object.keys(prev.files || {}), ...Object.keys(next.files || {})])) {
    if (prev.files?.[k]?.sha !== next.files?.[k]?.sha) changed.push(k);
  }
  for (const id of new Set([...Object.keys(prev.modules || {}), ...Object.keys(next.modules || {})])) {
    if (prev.modules?.[id] !== next.modules?.[id]) changed.push(`module:${id}`);
  }
  return changed;
}

// pages: state.pages. sidecars: slug → migrate _meta.json (or null). next: as canonDelta, plus
// archetypeSha (fsha of the archetype prototype). Returns [{ slug, affected[] }].
export function staleFlags({ pages, archetype, changed, sidecars = {}, next }) {
  if (!changed) return [];
  const out = [];
  for (const p of pages) {
    if (p.status !== 'approved' && p.status !== 'migrated') continue;
    const meta = sidecars[p.slug];
    if (p.status === 'migrated' && meta) {
      const affected = [];
      for (const k of ['header', 'footer', 'css']) if (meta.canonShas?.[k] && next.files?.[k]?.sha && meta.canonShas[k] !== next.files[k].sha) affected.push(k);
      if (meta.archetypeSha && next.archetypeSha && meta.archetypeSha !== next.archetypeSha) affected.push('archetype');
      for (const id of meta.modules || []) if (changed.includes(`module:${id}`)) affected.push(`module:${id}`);
      if (affected.length) out.push({ slug: p.slug, affected });
    } else if (p.slug !== archetype && changed.length) out.push({ slug: p.slug, affected: [...changed] });
  }
  return out;
}

// ---- pure: compositional moves (deterministic, from mapping.json) --------------------------------
export function compositionalMoves(mapping) {
  const moves = [];
  const ch = mapping.chrome || {};
  if (ch.header || ch.footer) moves.push(`Chrome is the site's own header/footer content restyled with donor tokens (header regions: ${[].concat(ch.header || []).length}, footer regions: ${[].concat(ch.footer || []).length}); never donor chrome copy.`);
  const seen = new Set();
  for (const pm of Object.values(mapping.pages || {})) {
    for (const s of Object.values(pm.slots || {})) {
      if (!s || typeof s !== 'object' || !s.module) continue;
      const key = `${s.module}|${s.layout}|${s.width}`; if (seen.has(key)) continue; seen.add(key);
      moves.push(`Module ${s.module} composes as a ${s.layout || 'stack'} section at ${s.width || 'default'} width.`);
    }
  }
  moves.push('The first button in a slot takes the donor primary treatment; later buttons take the donor secondary treatment.');
  return moves.slice(0, 7);
}

// The most recent history entry carrying a capture, or null.
export function previousShot(history = [], slug = null) {
  return [...(history || [])].reverse().find((h) => h?.shot && (!slug || h.from === slug)) ?? null;
}

// ---- CLI ----------------------------------------------------------------------------------------
function parse(argv) {
  const o = { dir: 'stardust', root: '.', force: false, slug: null, 'visual-threshold': '10' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') o.force = true;
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      if (!['dir', 'root', 'tokens', 'mapping', 'models', 'modules', 'visual-threshold'].includes(k)) throw new Usage(`unknown option ${a}`);
      const v = argv[++i]; if (!v || v.startsWith('--')) throw new Usage(`${a} needs a value`); o[k] = v;
    } else if (!o.slug) o.slug = a; else throw new Usage(`unexpected ${a}`);
  }
  if (!o.slug) throw new Usage('missing <archetype-slug>');
  o.visualThreshold = Number(o['visual-threshold']);
  if (!Number.isFinite(o.visualThreshold) || o.visualThreshold < 0) throw new Usage('--visual-threshold needs a non-negative number');
  o.tokens ??= join(o.dir, 'reskin', 'donor-tokens.json');
  o.mapping ??= join(o.dir, 'reskin', 'mapping.json');
  o.models ??= join(o.dir, 'reskin', 'content-model');
  o.modules ??= join(o.dir, 'reskin', 'donor-modules.md');
  return o;
}

const errLine = (r) => { const ls = `${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n'); return (ls.find((l) => /error/i.test(l)) || ls.pop() || '').trim(); };

function replicaScript(name) {
  return [join(HERE, '..', '..', 'replica', 'scripts', name), join(HERE, '..', 'replica', name)].find((p) => existsSync(p)) ?? null;
}

// Capture the archetype and compare it with the previous approval's capture. Never throws.
function visualRecord({ prototypePath, out, prev, threshold, findings, rel, root }) {
  const shot = replicaScript('stitch-shot.mjs'); const cmp = replicaScript('pixel-compare.mjs');
  if (!shot || !cmp) { findings.push('visual record skipped: replica stitch-shot.mjs / pixel-compare.mjs not found next to the reskin scripts (copy skills/replica/scripts/ except test/ to stardust/scripts/replica/)'); return null; }
  mkdirSync(dirname(out), { recursive: true });
  const s = spawnSync(process.execPath, [shot, pathToFileURL(resolve(prototypePath)).href, out, '--width', '1440'], { encoding: 'utf8' });
  if (s.status !== 0 || !existsSync(out)) { findings.push(`visual record skipped: stitch-shot exited ${s.status} (${errLine(s)})`); return null; }
  const rec = { shot: rel(out) };
  if (!prev?.shot) return rec;
  const prevAbs = resolve(root, prev.shot);
  if (!existsSync(prevAbs)) { findings.push(`visual diff skipped: previous capture ${prev.shot} is gone`); return rec; }
  const diff = out.replace(/\.png$/, '.diff.png');
  const c = spawnSync(process.execPath, [cmp, prevAbs, out, '--out', diff, '--threshold', String(threshold), '--json'], { encoding: 'utf8' });
  let j = null; try { j = JSON.parse(c.stdout); } catch { /* reported below */ }
  if (!j) { findings.push(`visual diff skipped: pixel-compare exited ${c.status} (${errLine(c)})`); return rec; }
  rec.visual = { against: prev.shot, againstSlug: prev.from ?? null, pct: j.pct, threshold, heightDelta: j.heightDelta, diff: rel(diff) };
  if (!j.pass) findings.push(`visual diff ${j.pct}% vs the previous approval (${prev.shot}) exceeds ${threshold}% — review ${rel(diff)} before migrating (informational, not a refusal)`);
  return rec;
}

async function stateLib() {
  for (const rel of [['..', '..', 'stardust', 'scripts', 'state.mjs'], ['..', 'stardust', 'state.mjs']]) {
    const p = join(HERE, ...rel);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  return null;
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const opt = parse(argv);
  const { slug } = opt;
  const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const fsha = (f) => (existsSync(f) ? sha(readFileSync(f)) : null);
  const root = resolve(opt.root);
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rel = (f) => relative(root, resolve(f)).split('\\').join('/');
  const stateFile = join(opt.dir, 'state.json');

  for (const f of [stateFile, opt.tokens, opt.mapping]) if (!existsSync(f)) throw new Refused(`${f} does not exist`);
  const state = readJson(stateFile);
  const page = (state.pages || []).find((p) => p.slug === slug);
  if (!page) throw new Refused(`unknown slug ${slug}`);
  if (page.status !== 'approved' && page.status !== 'migrated') throw new Refused(`${slug} is ${page.status}; canon is authored from an approved archetype only`);
  if (!page.prototypePath || !existsSync(page.prototypePath)) throw new Refused(`${slug} has no prototypePath on disk — advance it with --prototype`);
  const canonDir = join(opt.dir, 'canon');
  if (existsSync(join(canonDir, 'canon.css')) && !opt.force) throw new Refused(`${canonDir}/canon.css exists — canon extension (diff mode) is not implemented; pass --force to re-author`);
  const tokens = readJson(opt.tokens);
  const mapping = readJson(opt.mapping);
  const html = readFileSync(page.prototypePath, 'utf8');
  const approvedAt = [...(page.history || [])].reverse().find((h) => h.status === 'approved')?.at || at;
  const findings = [];

  const designJsonFile = join(root, 'DESIGN.json');
  const prevDesign = existsSync(designJsonFile) ? (() => { try { return readJson(designJsonFile); } catch { return null; } })() : null;
  const prevCanon = prevDesign?.extensions?.canon?.files ? {
    files: prevDesign.extensions.canon.files,
    modules: Object.fromEntries((prevDesign.extensions.modules || []).filter((m) => m.canonicalRendering?.sha).map((m) => [m.id, m.canonicalRendering.sha])),
  } : null;

  // 1. chrome
  const prov = (region) => `<!-- stardust:canon\n  writtenBy:        stardust:reskin/canon-from-reskin\n  writtenAt:        ${at}\n  sourceSlug:       ${slug}\n  sourcePrototype:  ${page.prototypePath}\n  region:           ${region}\n-->\n`;
  const lift = (tag) => (html.match(new RegExp(`<${tag}\\b[^>]*data-canon[^>]*>[\\s\\S]*?</${tag}>`, 'i')) || [])[0] || null;
  mkdirSync(join(canonDir, 'modules'), { recursive: true });
  const files = {};
  for (const region of ['header', 'footer']) {
    const el = lift(region);
    if (!el) { findings.push(`no <${region} data-canon> in the archetype — ${region}.html not written`); continue; }
    const p = join(canonDir, `${region}.html`); const body = `${prov(region)}${el}\n`;
    files[region] = { path: rel(p), sha: sha(writeStable(p, body)) };
  }

  // 2. compound CSS — :root must be the FIRST block (migrate strict 1); provenance follows it.
  const style = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i) || [])[1];
  if (!style) throw new Refused('the archetype has no <style>');
  const { rootBlock, lifted, leftBehind } = liftCss(style);
  if (!rootBlock) throw new Refused('the archetype <style> has no :root block');
  const chromeLeft = leftBehind.filter((s) => /(^|[\s,>])(header|footer)\b/.test(s));
  if (chromeLeft.length) findings.push(`class-based selection leaves ${chromeLeft.length} chrome rule(s) out of canon.css (${chromeLeft.join(' · ')}) — canon header/footer render unstyled on a page without the archetype <style>`);
  const canonCss = `${rootBlock}\n/* stardust:canon writtenBy stardust:reskin/canon-from-reskin · writtenAt ${at} · sourceSlug ${slug} · region css */\n${lifted.join('\n')}\n`;
  files.css = { path: rel(join(canonDir, 'canon.css')), sha: sha(writeStable(join(canonDir, 'canon.css'), canonCss)) };

  // 3. module skeletons
  const sk = moduleSkeletons(html); findings.push(...sk.findings);
  const skeletons = new Map([...sk.modules].map(([id, skel]) => [id, { skel, from: slug }]));
  // The named archetype wins; the other page types' archetypes fill in modules it does not render.
  const ledgerPath = join(opt.dir, 'reskin', 'ledger.json');
  const handoff = existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, 'utf8')).handoff || {}) : {};
  for (const o of otherArchetypes(state.pages || [], slug, handoff)) {
    if (!existsSync(o.prototypePath)) { findings.push(`archetype ${o.slug} (${o.type}) has no prototype on disk — its modules are not in canon`); continue; }
    const osk = moduleSkeletons(readFileSync(o.prototypePath, 'utf8'));
    findings.push(...osk.findings.map((f) => `${o.slug}: ${f}`));
    for (const [id, skel] of osk.modules) if (!skeletons.has(id)) skeletons.set(id, { skel, from: o.slug });
  }
  const moduleRefs = {};
  for (const [id, { skel, from }] of skeletons) {
    const p = join(canonDir, 'modules', `${id}.html`); const body = `${prov(`module:${id}`)}${skel}\n`;
    moduleRefs[id] = { path: rel(p), sha: sha(writeStable(p, body)), from };
  }
  const issues = mappingModuleIssues(mapping, Object.keys(moduleRefs));
  if (issues.missing.length) findings.push(`mapping module(s) with no canon skeleton: ${issues.missing.join(', ')} — no approved archetype renders them; approve a page that does, or remap`);
  for (const m of issues.mixed) findings.push(`module ${m.id} is composed ${m.compositions.length} ways (${m.compositions.map((c) => `${c.composition} @ ${c.at.join(',')}`).join(' · ')}) — canon keeps ${moduleRefs[m.id]?.from || 'one'}'s; give the others their own module id (curation-rules.json modules[] with variantOf, reference/mapping-brief.md § Composition variants)`);

  // 4. pinned tokens (measured)
  const pinned = {};
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch(); const pg = await browser.newPage();
    for (const [name, w] of [['desktop', 1440], ['tablet', 768], ['mobile', 360]]) {
      await pg.setViewportSize({ width: w, height: 900 });
      await pg.goto(pathToFileURL(resolve(page.prototypePath)).href, { waitUntil: 'load' });
      const r = await pg.evaluate(() => { const s = document.querySelector('main section'); const c = document.querySelector('main .container'); const cs = (e) => (e ? getComputedStyle(e) : null); return { pad: cs(s)?.paddingTop, max: cs(c)?.maxWidth }; });
      if (r.pad) pinned[`sectionPadding.${name}`] = r.pad;
      if (name === 'desktop' && r.max) pinned['layout.containerMaxWidth'] = r.max;
    }
    await browser.close();
  } catch (e) { findings.push(`pinned tokens not measured (${String(e.message).split('\n')[0]})`); }
  if (!tokens.layout?.sectionPaddingY && pinned['sectionPadding.desktop']) findings.push(`donor has no layout.sectionPaddingY; canon pins the renderer fallback ${pinned['sectionPadding.desktop']} — a renderer default, not a donor value`);
  pinned.densityTier = null; pinned.typeScale = null;

  // 5. compositional moves
  const moves = compositionalMoves(mapping);

  // DESIGN.md / DESIGN.json
  const flat = [];
  (function walk(o, p) { for (const [k, v] of Object.entries(o || {})) { if (k.startsWith('_')) continue; const q = p ? `${p}.${k}` : k; if (v && typeof v === 'object') walk(v, q); else if (typeof v === 'string' || typeof v === 'number') flat.push([q, v]); } })(tokens, '');
  let moduleIds = Object.keys(moduleRefs);
  if (existsSync(opt.modules)) moduleIds = [...new Set([...moduleIds, ...[...readFileSync(opt.modules, 'utf8').matchAll(/^(?:#+\s*|\|\s*)(M\d+)\b/gm)].map((m) => m[1])])];
  const extModules = moduleIds.map((id) => ({
    id,
    slots: Object.entries(mapping.pages || {}).flatMap(([ps, pm]) => Object.entries(pm.slots || {}).filter(([, s]) => s?.module === id).map(([s]) => ({ name: `${ps}:${s}`, type: 'stream', required: true }))),
    canonicalRendering: moduleRefs[id] || null,
  }));
  const next = { files, modules: Object.fromEntries(Object.entries(moduleRefs).map(([id, m]) => [id, m.sha])), archetypeSha: fsha(page.prototypePath) };
  const changed = canonDelta(prevCanon, next);
  const prevHistory = prevDesign?.extensions?.canon?.history || [];
  const entry = { at, from: slug, kind: prevCanon ? 're-approval' : 'first-approval', via: 'reskin' };
  const prevShotEntry = previousShot(prevHistory, slug);
  if (!prevShotEntry || (changed && changed.length)) {
    const out = join(opt.dir, 'reskin', 'approvals', `${slug}.${at.replace(/[:]/g, '-')}.png`);
    Object.assign(entry, visualRecord({ prototypePath: page.prototypePath, out, prev: prevShotEntry, threshold: opt.visualThreshold, findings, rel, root }) || {});
  }
  const history = [...prevHistory, entry];
  const designJson = {
    $schema: 'stardust:DESIGN.json',
    source: { kind: 'donor', designSource: state.designSource ?? null, tokens: rel(opt.tokens), generatedAt: at, generatedBy: 'stardust:reskin/canon-from-reskin' },
    tokens,
    extensions: { canon: { sourceSlug: slug, approvedAt, files, pinned, compositionalMoves: moves, history }, modules: extModules },
  };
  const donorUrl = state.designSource?.url ?? 'see state.json designSource';
  const designMd = `# DESIGN\n\n> Generated by stardust:reskin/canon-from-reskin at ${at} from \`${rel(opt.tokens)}\` (donor: \`${donorUrl}\`). The donor is the design authority; this file restates its tokens for migrate. Do not hand-edit — re-run the bridge.\n\n## Tokens\n\n| token | value |\n|---|---|\n${flat.map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join('\n')}\n\n## Canon\n\n- Source archetype: \`${slug}\` (approved ${approvedAt})\n- Files: ${Object.entries(files).map(([k, f]) => `${k} \`${f.path}\``).join(' · ')}\n- Pinned: ${Object.entries(pinned).map(([k, v]) => `\`${k}\`=${v}`).join(' · ')}\n\n## Compositional moves\n\n${moves.map((m) => `- ${m}`).join('\n')}\n`;
  writeFileSync(designJsonFile, `${JSON.stringify(designJson, null, 2)}\n`);
  writeFileSync(join(root, 'DESIGN.md'), designMd);

  // direction.md
  const dirFile = join(opt.dir, 'direction.md');
  if (!existsSync(dirFile) || opt.force) writeFileSync(dirFile, `# Direction\n\n## Active ${at}\n\n- Kind: **reskin** — the direction is the external donor, not an authored brief.\n- Donor: \`${donorUrl}\` captured ${state.designSource?.capturedAt ?? '?'} into \`${state.designSource?.path ?? '?'}\`\n- Tokens: \`${rel(opt.tokens)}\` (sha ${fsha(opt.tokens)})\n- Mapping: \`${rel(opt.mapping)}\` (sha ${fsha(opt.mapping)})\n- Archetype: \`${slug}\` approved ${approvedAt}\n- Content: verbatim from the source site (reskin content gate); no copy is authored.\n`);
  else findings.push(`${rel(dirFile)} exists — left untouched`);

  // dynamic-features.md (form detection from content models)
  const rows = [];
  for (const p of state.pages) {
    const f = join(opt.models, p.slug, 'content-model.json'); if (!existsSync(f)) continue;
    const ctl = (readJson(f).sections || []).flatMap((s) => s.formControls || []);
    if (!ctl.length) continue;
    const pii = ctl.some((c) => /^(password|email|tel|date)$/i.test(c.inputType || ''));
    rows.push(`| ${rows.length + 1} | ${p.slug}-form | form on ${p.slug} (${ctl.length} controls) | F | ${p.slug} | rebuild-native | needs-backend | scaffolded-awaiting-owner | form → configurable endpoint | owner: endpoint + ${pii ? 'PII handling (never auto-wire)' : 'submission target'} | ${rel(f)} |`);
  }
  const dynFile = join(opt.dir, 'dynamic-features.md');
  if (!existsSync(dynFile) || opt.force) writeFileSync(dynFile, `# Dynamic features\n\n> Derived by stardust:reskin/canon-from-reskin at ${at} from the reskin content models (form controls only). Not a substitute for \`dynamics-detect\` — scripts, embeds, search and listings are not detected here.\n\n## Features\n\n| # | id | feature | class | reach | disposition | reproducibility | status | pattern | decision / owner | evidence |\n|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n') || '| – | – | none detected | – | – | static-snapshot | self | done | – | – | – |'}\n\n## Decision batch\n\n${rows.length ? rows.map((_, i) => `- Row ${i + 1}: submission endpoint and data handling — owner decision.`).join('\n') : '- none'}\n`);
  else findings.push(`${rel(dynFile)} exists — left untouched`);

  // stale flagging
  const sidecars = {};
  for (const rec of state.migrate?.pages || []) {
    if (!rec?.slug || !rec.file) continue;
    const d = posix.dirname(rec.file); const b = posix.basename(rec.file);
    const side = posix.join(d, b === 'index.html' ? '_meta.json' : `${b.replace(/\.html?$/i, '')}._meta.json`);
    for (const f of [resolve(root, side), resolve(opt.dir, '..', side)]) if (existsSync(f)) { try { sidecars[rec.slug] = readJson(f); } catch { /* unreadable sidecar: blanket rule */ } break; }
  }
  const flags = staleFlags({ pages: state.pages, archetype: slug, changed, sidecars, next });
  if (flags.length) {
    for (const { slug: s, affected } of flags) {
      const p = state.pages.find((x) => x.slug === s);
      p.stale = true; p.staleReason = `canon changed at ${at}; affected: ${affected.join(', ')}`;
    }
    const lib = await stateLib();
    if (lib) { state._provenance = lib.stampProvenance(state._provenance, 'stardust:reskin', at); lib.writeState(stateFile, state); } else writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  console.log(`canon-from-reskin: ${slug} → ${Object.keys(files).length} canon file(s), ${Object.keys(moduleRefs).length} module(s), ${lifted.length} CSS block(s) lifted / ${leftBehind.length} left in page, ${moves.length} move(s), ${rows.length} form row(s)`);
  if (changed) console.log(`  canon delta: ${changed.length ? changed.join(', ') : 'none'}; stale flagged: ${flags.length ? flags.map((f) => f.slug).join(', ') : 'none'}`);
  if (entry.visual) console.log(`  visual diff vs previous approval: ${entry.visual.pct}% (threshold ${entry.visual.threshold}%) → ${entry.visual.diff}`);
  else if (entry.shot) console.log(`  visual record: ${entry.shot}`);
  for (const f of findings) console.log(`  FINDING ${f}`);
  return 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(fileURLToPath(import.meta.url)) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    if (e instanceof Usage) console.error(`usage error: ${e.message}\n\n${HELP}`);
    else console.error(`canon-from-reskin: ${e instanceof Refused ? 'refused: ' : ''}${e.message}`);
    process.exit(e.code === 1 || e.code === 2 ? e.code : 1);
  });
}
