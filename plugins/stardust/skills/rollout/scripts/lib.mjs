/**
 * rollout/lib.mjs — shared IO + roll-up helpers so every script derives the same
 * counts from the same per-unit truth (counts are always recomputed, never
 * incremented). Also the delivered-structure reader, identity scrub and coverage
 * writer behind coverage format 0.1.0 (reference/coverage-contract.md).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** Whole-file write through a sibling tmp file + rename: a reader never sees a half-written file. */
export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * Cross-process mutual exclusion for a read-modify-write of a shared file: a lock DIRECTORY
 * `<target>.lock` (mkdir is atomic on every filesystem), an `owner` file naming pid + time, a
 * bounded wait, and a stale lock (older than `staleMs`, a crashed writer) reclaimed. Several
 * cluster subagents record coverage rows at once during a fan-out; without this the last writer
 * won and rows were lost. Returns a release function (also run at process exit).
 */
export function acquireLock(target, { timeoutMs = 30000, staleMs = 60000, pollMs = 50 } = {}) {
  const dir = `${target}.lock`;
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid} ${new Date().toISOString()}\n`);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let st = null;
      try { st = statSync(dir); } catch { continue; }
      if (Date.now() - st.mtimeMs > staleMs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* raced */ } continue; }
      if (Date.now() > deadline) {
        let owner = '?'; try { owner = readFileSync(join(dir, 'owner'), 'utf8').trim(); } catch { /* none */ }
        throw new Error(`lock ${dir} held for over ${timeoutMs} ms (owner ${owner}) — a crashed writer leaves it; remove the directory when no such process runs`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
    }
  }
  let released = false;
  const release = () => { if (released) return; released = true; try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } };
  process.once('exit', release);
  return release;
}

/** Run `fn` under the lock; the file(s) it touches must be re-read INSIDE `fn`, never before. */
export function withLock(target, fn, opts) {
  const release = acquireLock(target, opts);
  try { return fn(); } finally { release(); }
}

const countBy = (rows, get, val) => rows.filter((r) => get(r) === val).length;

/** Page delivery counts from coverage/pages.json rows. */
export function pageCounts(pages) {
  const g = (p) => (p.delivery && p.delivery.status) || 'pending';
  return {
    total: pages.length,
    verified: countBy(pages, g, 'verified'),
    deployed: countBy(pages, g, 'deployed'),
    pending: countBy(pages, g, 'pending'),
    contentPending: countBy(pages, g, 'content-pending'),
    stale: countBy(pages, g, 'stale'),
    failed: countBy(pages, g, 'failed'),
  };
}

/**
 * The `edsBlockName` that records a module mapped to EDS default content (title, text, image,
 * button, separator — deploy's D1): the mapping is the resolved decision and there is no block to
 * build, so such a row is never pending whatever its status. A recorded hands-off run left four of
 * them at `status: pending` and the block roll-up read a finished, verified site as unfinished.
 */
export const DEFAULT_CONTENT = 'default-content';
export const isDefaultContent = (b) => !!(b && b.delivery && b.delivery.edsBlockName === DEFAULT_CONTENT);

/**
 * Block conversion counts from coverage/blocks.json rows; a default-content mapping counts as converted.
 * A block recorded `not-delivered` (left undelivered on purpose, with its reason) is its own count —
 * neither converted nor pending: pending = total − converted − notDelivered.
 */
export function blockCounts(blocks) {
  const status = (b) => b.delivery && b.delivery.status;
  const converted = blocks.filter((b) => isDefaultContent(b) || ['converted', 'deployed', 'verified'].includes(status(b))).length;
  const notDelivered = blocks.filter((b) => !isDefaultContent(b) && status(b) === 'not-delivered').length;
  return { total: blocks.length, converted, notDelivered, pending: blocks.length - converted - notDelivered };
}

/** Recompute each template's delivery roll-up in place from the page rows. */
export function rollupTemplates(templatesDoc, pages) {
  if (!templatesDoc || !Array.isArray(templatesDoc.templates)) return;
  for (const t of templatesDoc.templates) {
    const tp = pages.filter((p) => (t.pages || []).includes(p.slug));
    const g = (p) => (p.delivery && p.delivery.status) || 'pending';
    const cp = countBy(tp, g, 'content-pending');
    t.delivery = {
      verified: countBy(tp, g, 'verified'),
      deployed: countBy(tp, g, 'deployed'),
      contentPending: cp,
      pending: tp.length - countBy(tp, g, 'verified') - countBy(tp, g, 'deployed') - cp,
    };
  }
}

/** Recompute rollout.json lastRun from the page + (optional) block rows. */
export function rollupConfig(config, pages, blocks, now) {
  if (!config) return;
  const counts = pageCounts(pages);
  config.lastRun = {
    ...(config.lastRun || {}),
    at: now,
    pages: counts,
    blocks: blocks ? blockCounts(blocks) : (config.lastRun && config.lastRun.blocks) || { total: 0, converted: 0, notDelivered: 0, pending: 0 },
    verifyFailures: counts.failed,
  };
}

/** EDS block name from a block id: kebab + guard against reserved EDS classes (#15). */
const RESERVED = new Set(['section', 'block', 'wrap', 'button']);
export function edsName(id) {
  let n = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!n) n = 'block';
  if (RESERVED.has(n)) n = `blk-${n}`;
  // decorateBlock derives .<name>-wrapper/.<name>-container classes, so a block
  // NAMED with one of those suffixes collides with another block's derived class.
  if (/-(wrapper|container)$/.test(n)) n = `${n}-block`;
  return n;
}

/** Chrome ids deliver as site-wide authored documents (/nav, /footer), not per-page blocks. */
/**
 * The URL the page was deployed at: the pathname of `delivery.deployedUrl` (an absolute URL or a root-relative path)
 * read by the delivered-path contract (deploy/scripts/eds-path.mjs) — `.html` dropped, a trailing `/index` → `/`, the
 * root `/`, a recorded trailing slash kept — else the page's `path` as it stands, plus `/` for an encoded page with no
 * migrated file whose encoded document is `stardust/encoded/…/index.html` (the DA path `/a/index`, served at `/a/`).
 * The migrated file name does not decide it: an `…/index.html` page whose document went to `/a` (not `/a/index`) is
 * served at `/a`. `path` stays the page's key. Pure.
 */
export function publicUrl(page) {
  const dep = page.delivery && page.delivery.deployedUrl;
  if (typeof dep !== 'string' || !dep.trim()) {
    const p = page.path || `/${page.slug}`;
    const src = (page.source && !page.source.migratedHtml && page.source.encodedHtml) || '';
    return p !== '/' && !p.endsWith('/') && /(^|[/\\])index\.html$/.test(src) ? `${p}/` : p;
  }
  let p;
  try { p = new URL(dep.trim(), 'https://deployed.invalid').pathname; } catch { p = dep.trim().split(/[?#]/)[0]; }
  p = p.replace(/\/{2,}/g, '/').replace(/\.html?$/i, '');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.endsWith('/index')) p = p.slice(0, -'index'.length);
  return p;
}

export const CHROME_IDS = new Set(['header', 'nav', 'footer']);
export const kindOf = (id) => (CHROME_IDS.has(String(id).toLowerCase()) ? 'chrome' : 'module');

/** Map a delivered (extensionless) path to a file under root (migrated-tree shape). */
export function resolveLocalFile(root, p) {
  const candidates = p === '/' ? ['index.html'] : [`${p.slice(1)}.html`, `${p.slice(1)}/index.html`, p.slice(1)];
  for (const c of candidates) { const f = join(root, c); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

/** Load a page's HTML by HTTP (base) or from a local root. Returns {ok, body, reason}. */
export async function loadPageHTML(page, { root, base }) {
  if (root) {
    const f = resolveLocalFile(root, page.path);
    if (!f) return { ok: false, reason: `not found under ${root}` };
    return { ok: true, body: readFileSync(f, 'utf8') };
  }
  try {
    const res = await fetch(`${base}${publicUrl(page)}`);
    const body = await res.text();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, body };
  } catch (e) { return { ok: false, reason: `fetch error: ${e.message}` }; }
}

// --- optimize: layers, scoring, and the AEM autofix registry --------------------
export const ALL_LAYERS = ['brand-tensions', 'design-ux', 'accessibility', 'seo', 'content-conversion', 'ai-search', 'cross-page'];
export const ASSESSED_BY_BASELINE = ['accessibility', 'seo', 'ai-search', 'cross-page'];
export const SEV_WEIGHT = { P1: 25, P2: 10, P3: 4 };

/**
 * AEM autofix registry: maps a finding's `check` to the EDS fixer that resolves it.
 * kind: 'deterministic' (mechanical edit) | 'content-draft' (generates copy needing
 * review — applied under the aggressive policy, logged) | 'manual' (autofix prepares
 * a payload/guidance but a human applies it). target is aem-eds for v1.
 */
export const AEM_AUTOFIX = {
  'title-missing': { strategy: 'eds-metadata-title', kind: 'content-draft' },
  'title-length': { strategy: 'eds-metadata-title', kind: 'content-draft' },
  'meta-description': { strategy: 'eds-metadata-description', kind: 'content-draft' },
  'single-h1': { strategy: 'eds-fix-h1', kind: 'deterministic' },
  'img-alt': { strategy: 'eds-alt-draft', kind: 'content-draft' },
  'duplicate-title': { strategy: 'eds-disambiguate-title', kind: 'content-draft' },
  'sitemap': { strategy: 'rollout-assemble', kind: 'deterministic' },
  'jsonld': { strategy: 'eds-jsonld', kind: 'manual' },
  'canonical': { strategy: 'eds-canonical', kind: 'manual' },
  'landmark-main': { strategy: 'eds-landmark-main', kind: 'manual' },
};

/** The autofix descriptor for a finding (check), or an unavailable stub. */
export function autofixFor(check) {
  const a = AEM_AUTOFIX[check];
  if (!a) return { available: false, target: 'aem-eds', strategy: null, kind: null, status: 'unavailable', appliedBy: null, at: null, detail: null };
  return { available: true, target: 'aem-eds', strategy: a.strategy, kind: a.kind, status: 'pending', appliedBy: null, at: null, detail: null };
}

// --- optimize: source parity ---------------------------------------------------
/**
 * A finding whose condition the SOURCE capture shares — the same <title>, no meta description on
 * the source either, no JSON-LD on the source either, no <h1> on the source either, the same
 * title shared by the same pages — mirrors the source rather than a delivery defect. A recorded
 * hands-off run accepted 63 such findings by hand. They stay in the ledger (listed in their own
 * report section) but are
 * informational: never scored, never counted open, never auto-fixed (a faithful migration is not
 * rewritten). The findings schema has no parity property, so the tag is `fixability:
 * out-of-scope` (the schema's own "informational" value) plus this evidence prefix; both are read.
 */
export const SOURCE_PARITY_PREFIX = 'source parity: ';
export const isSourceParity = (f) => !!(f && f.fixability === 'out-of-scope' && typeof f.evidence === 'string' && f.evidence.startsWith(SOURCE_PARITY_PREFIX));

/** Tag a detected finding as mirroring the source (`why` names the shared condition). */
export function markSourceParity(finding, why) {
  return {
    ...finding,
    fixability: 'out-of-scope',
    evidence: `${SOURCE_PARITY_PREFIX}${finding.evidence} — ${why}`,
    recommendedMove: 'Mirrors the source capture — informational, not scored, no rollout action; change it on the source (or record a content decision) if wanted.',
    autofix: { available: false, target: 'aem-eds', strategy: null, kind: null, status: 'unavailable', appliedBy: null, at: null, detail: 'source parity — a faithful migration is not auto-rewritten' },
  };
}

/** Open source-parity findings by severity (the report's own section; never in the score). */
export function sourceParityCounts(findings) {
  const rows = findings.filter((x) => (x.status === 'open' || x.status === 'in-progress') && isSourceParity(x));
  const sev = (s) => rows.filter((x) => x.severity === s).length;
  return { total: rows.length, P1: sev('P1'), P2: sev('P2'), P3: sev('P3') };
}

/**
 * Compute a scorecard snapshot from the full findings list. Open source-parity findings are
 * excluded from every dimension score and from the open P1/P2/P3 counts (they still mark their
 * layer as assessed); `fixed` counts are untouched.
 */
export function computeScorecard(findings, runId, now) {
  const open = findings.filter((x) => (x.status === 'open' || x.status === 'in-progress') && !isSourceParity(x));
  const fixed = findings.filter((x) => x.status === 'fixed');
  const assessed = new Set();
  for (const f of findings) assessed.add(f.layer);
  const dimensions = {};
  for (const layer of ALL_LAYERS) {
    if (!assessed.has(layer)) { dimensions[layer] = null; continue; }
    const penalty = open.filter((x) => x.layer === layer).reduce((n, x) => n + (SEV_WEIGHT[x.severity] || 0), 0);
    dimensions[layer] = Math.max(0, 100 - penalty);
  }
  const scored = ALL_LAYERS.map((l) => dimensions[l]).filter((v) => v !== null);
  const overall = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  const sev = (arr, s) => arr.filter((x) => x.severity === s).length;
  return {
    runId, at: now, overall, dimensions,
    severity: { P1: sev(open, 'P1'), P2: sev(open, 'P2'), P3: sev(open, 'P3') },
    fixed: { P1: sev(fixed, 'P1'), P2: sev(fixed, 'P2'), P3: sev(fixed, 'P3') },
  };
}

// --- coverage 0.1.0: delivered structure, block code, identity, judgement, writes ----------------
// Pure helpers for inventory.mjs, blocks.mjs, workspace-manifest.mjs and block-origin.mjs (writeCoverage is the only I/O).
// Deterministic: no clock, code-unit sorting, records in document order.
export const COVERAGE_FORMAT_VERSION = '0.1.0';
export const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const sha256 = (data) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const uniqSorted = (xs) => [...new Set(xs)].sort(byStr);
const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const variantIdentity = (name, classes) => `${name}|${uniqSorted(classes || []).join(' ')}`;
export const variantId = (name, classes) =>
  `v_${createHash('sha256').update(`stardust-variant:${variantIdentity(name, classes)}`).digest('hex').slice(0, 12)}`;

/** identity → variantId from a prior pages.json (`pages[].delivered.blocks`), so an id a client stored never changes. */
export function priorVariantIds(pagesDoc) {
  const ids = new Map();
  for (const p of Array.isArray(pagesDoc) ? pagesDoc : (pagesDoc && pagesDoc.pages) || []) {
    for (const r of (p && p.delivered && p.delivered.blocks) || []) {
      const key = r && r.kind === 'block' && r.variantId && variantIdentity(r.block, r.classes);
      if (key && !ids.has(key)) ids.set(key, r.variantId);
    }
  }
  return ids;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

function parseAttrs(body) {
  const attrs = {};
  for (const m of body.matchAll(ATTR)) {
    const key = m[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Index of the `>` that ends the tag opened at `lt`; a `>` inside a quoted value does not count. */
function tagEnd(s, lt) {
  for (let j = lt + 1; j < s.length; j++) {
    if (s[j] === '>') return j;
    if (s[j] !== '=') continue;
    let k = j + 1;
    while (/\s/.test(s[k] || '')) k++;
    if (s[k] === '"' || s[k] === "'") { j = s.indexOf(s[k], k + 1); if (j === -1) return -1; }
  }
  return -1;
}

/**
 * Tolerant HTML tree: elements `{ tag, attrs, children }`, text `{ tag: '#text', text }` (entities decoded).
 * Comments, doctype and script/style bodies are skipped; void and `/>` tags take no children; a closer pops to
 * the nearest open match (a stray one is ignored); unclosed tags close with their parent.
 */
export function parseHtml(html) {
  const s = String(html ?? '');
  const lower = s.toLowerCase();
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const text = (t) => {
    if (!t) return;
    const kids = stack[stack.length - 1].children;
    const last = kids[kids.length - 1];
    if (last && last.tag === '#text') last.text += decode(t); else kids.push({ tag: '#text', text: decode(t) });
  };
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { text(s.slice(i)); break; }
    text(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e === -1 ? s.length : e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const e = s.indexOf('>', lt); i = e === -1 ? s.length : e + 1; continue; }
    const close = s[lt + 1] === '/';
    TAG_NAME.lastIndex = lt + (close ? 2 : 1);
    const name = (TAG_NAME.exec(s) || [])[0];
    if (!name) { text('<'); i = lt + 1; continue; }
    const gt = tagEnd(s, lt);
    if (gt === -1) { text(s.slice(lt)); break; }
    const tag = name.toLowerCase();
    i = gt + 1;
    if (close) {
      const at = stack.findLastIndex((n) => n.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const body = s.slice(lt + 1 + name.length, gt);
    const selfClosing = /\/\s*$/.test(body);
    if (RAW.has(tag)) {
      if (!selfClosing) { const e = lower.indexOf(`</${tag}`, i); const g = e === -1 ? -1 : s.indexOf('>', e); i = g === -1 ? s.length : g + 1; }
      continue;
    }
    const node = { tag, attrs: parseAttrs(selfClosing ? body.replace(/\/\s*$/, '') : body), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing && !VOID.has(tag)) stack.push(node);
  }
  return root;
}

// Tree helpers over parseHtml nodes (also used by block-origin.mjs).
export const elements = (n) => (n.children || []).filter((c) => c.tag !== '#text');
export const classList = (n) => String((n.attrs && n.attrs.class) || '').split(/\s+/).filter(Boolean);
export const textOf = (n) => (n.tag === '#text' ? n.text : (n.children || []).map(textOf).join(''));
const cellText = (n) => (n ? textOf(n).replace(/\s+/g, ' ').trim() : '');
const hasText = (n) => (n.children || []).some((c) => c.tag === '#text' && c.text.trim());
// the single element child of `n` when `n` holds nothing else (whitespace aside), else null
export const onlyChild = (n) => { const els = elements(n); return els.length === 1 && !hasText(n) ? els[0] : null; };
export const isLink = (n) => !!n && (n.tag === 'a' || ((n.tag === 'strong' || n.tag === 'em') && !!onlyChild(n) && onlyChild(n).tag === 'a'));

function findTag(n, tag) {
  for (const c of n.children || []) { const hit = c.tag === tag ? c : findTag(c, tag); if (hit) return hit; }
  return null;
}

/** key/value rows of a metadata-style block: lower-cased first cell → text of the second; first wins. */
function readRows(div, into = {}) {
  for (const row of elements(div)) {
    const [k, v] = elements(row);
    const key = cellText(k).toLowerCase();
    if (key && !(key in into)) into[key] = cellText(v);
  }
  return into;
}

/** The default-content part one element contributes (the spec's vocabulary). */
function partOf(n) {
  if (/^h[1-6]$/.test(n.tag)) return 'heading';
  if (n.tag === 'hr') return 'separator';
  if (n.tag === 'picture' || n.tag === 'img') return 'image';
  if (n.tag === 'video') return 'video';
  if (n.tag === 'p') {
    const els = elements(n);
    if (els.length === 1 && (els[0].tag === 'picture' || els[0].tag === 'img')) return 'image';
    if (isLink(onlyChild(n))) return 'button';
  }
  if ((n.tag === 'ul' || n.tag === 'ol') && elements(n).length
    && elements(n).every((li) => li.tag === 'li' && isLink(onlyChild(li)))) return 'link-list';
  return 'text';
}

/**
 * A delivered page's records in document order: block divs (`kind 'block'`) and runs of consecutive default
 * elements merged into one `default-content` record (`kind 'default'`, variant = parts joined by `+`). Sections
 * without a record are dropped; metadata/section-metadata and chrome (header/footer/nav) divs are not records.
 * `variantId` is null here: the caller assigns it (carry-forward needs the prior pages.json).
 * `nodes[pos]` is record `pos`'s source in the parseHtml tree: a block record's block div, a default record's
 * array of its elements in document order (block-origin.mjs reads the text from them).
 */
export function walkDelivered(html) {
  const root = parseHtml(html);
  const main = findTag(root, 'main') || findTag(root, 'body') || root;
  const [records, sections, metadata, nodes] = [[], [], {}, []];
  for (const sec of elements(main).filter((n) => n.tag === 'div')) {
    const own = [];
    let [style, run] = [null, null];
    for (const el of elements(sec)) {
      const [name, ...rest] = el.tag === 'div' ? classList(el) : [];
      if (!name) {
        const part = partOf(el);
        if (!run) own.push(run = { parts: [], els: [] });
        if (!run.parts.includes(part)) run.parts.push(part);
        run.els.push(el);
        continue;
      }
      run = null;
      if (name === 'metadata') readRows(el, metadata);
      else if (name === 'section-metadata') style = style || nonEmpty(readRows(el).style);
      else if (!CHROME_IDS.has(name.toLowerCase())) {
        const rows = elements(el);
        own.push({ block: name, classes: uniqSorted(rest), rows: rows.length, cells: rows.map((r) => elements(r).length), node: el });
      }
    }
    if (!own.length) continue;
    const s = { pos: sections.length, style, blocks: [] };
    for (const r of own) {
      const pos = records.length;
      s.blocks.push(pos);
      records.push(r.parts
        ? { pos, block: DEFAULT_CONTENT, variant: r.parts.join('+'), kind: 'default', section: style, sectionPos: s.pos, classes: [], variantId: null, rows: null, cells: null }
        : { pos, block: r.block, variant: r.classes.join(' ') || null, kind: 'block', section: style, sectionPos: s.pos, classes: r.classes, variantId: null, rows: r.rows, cells: r.cells });
      nodes.push(r.parts ? r.els : r.node);
    }
    sections.push(s);
  }
  return { records, sections, metadata, nodes };
}

/** walkDelivered without the nodes: the records, sections and metadata coverage stores. */
export function parseDelivered(html) {
  const { records, sections, metadata } = walkDelivered(html);
  return { records, sections, metadata };
}

/** Content file (relative to the content dir) of a delivered path: `index.html` for `/`, else `<p>.html`, `<p>/index.html`. */
export function contentFileFor(deliveredPath, exists) {
  if (deliveredPath == null) return null;
  const has = typeof exists === 'function' ? exists
    : (k) => !!exists && (typeof exists.has === 'function' ? exists.has(k) : Object.hasOwn(exists, k));
  const p = String(deliveredPath).replace(/^\/+|\/+$/g, '');
  return (p ? [`${p}.html`, `${p}/index.html`] : ['index.html']).find((k) => has(k)) || null;
}

/** Classes chained to `.name` in one compound selector (`.teaser.list` → list); pseudo-classes ignored. */
export function cssOptionClasses(name, css) {
  if (!css || !name) return [];
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '{}');
  const out = new Set();
  for (const compound of selectors.match(/[^\s,>+~{}]+/g) || []) {
    const bare = compound.replace(/::?[\w-]+(\([^)]*\))?/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    const classes = [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    if (classes.includes(name)) classes.filter((c) => c !== name).forEach((c) => out.add(c));
  }
  return [...out].sort(byStr);
}

/**
 * First sentence of a block's JSDoc: the `/** … *\/` right before `export default` (whitespace between allowed),
 * else the first one; cut at the first `@tag` line; no sentence end → the cut text. At most 400 characters.
 */
export function blockDescription(js) {
  const comments = [...String(js || '').matchAll(/\/\*\*([\s\S]*?)\*\/(\s*export\s+default\b)?/g)];
  if (!comments.length) return null;
  const lines = (comments.find((m) => m[2]) || comments[0])[1].split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim());
  const tag = lines.findIndex((l) => l.startsWith('@'));
  const flat = (tag === -1 ? lines : lines.slice(0, tag)).join(' ').replace(/\s+/g, ' ').trim();
  const first = (/^(.+?[.!?])(?=\s|$)/.exec(flat) || [null, flat])[1];
  return first.slice(0, 400).trim() || null;
}

/** `- **name**` bullets (with continuation lines) under any "Content contract" heading; joined by "\n". */
export function contractFor(log, name) {
  if (!log || !name) return null;
  const [hits, head] = [[], `- **${name}**`];
  let [level, fence, cur] = [0, false, null];
  const flush = () => { if (cur) hits.push(cur.join(' ').replace(/\s+/g, ' ').trim()); cur = null; };
  for (const line of log.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (level && h[1].length <= level) level = 0;
      if (!level && /content contract/i.test(h[2])) level = h[1].length;
    } else if (!line.trim()) flush();
    else if (/^\s*[-*+]\s/.test(line)) {
      flush();
      if (level && line.trimStart().startsWith(head)) cur = [line.trimStart().slice(2)];
    } else if (cur) cur.push(line);
  }
  flush();
  return hits.length ? hits.join('\n') : null;
}

const STANDARD_BLOCKS = new Set(['accordion', 'cards', 'carousel', 'columns', 'embed', 'form', 'fragment', 'hero', 'modal', 'quote', 'search', 'table', 'tabs', 'video', 'breadcrumbs']);
const BLOCK_ALIASES = { breadcrumb: 'breadcrumbs' };
export function baseTypeOf(name) {
  const n = String(name || '').toLowerCase();
  const t = BLOCK_ALIASES[n] || n;
  return STANDARD_BLOCKS.has(t) ? t : 'unknown';
}

export const kebab = (s) => String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const originOf = (url) => { try { const o = new URL(url).origin; return o && o !== 'null' ? o : null; } catch { return null; } };
const hostOf = (v) => { try { return new URL(v.includes('://') ? v : `https://${v}`).host; } catch { return null; } };

/**
 * Project identity strings (longest first): DA org/site (≥ 3 chars), `org/site`, `main--site--org`, live/preview
 * hosts, the deploy host, and `owner/repo` + `ref--repo--owner` read from any `<ref>--<repo>--<owner>` host.
 */
export function identityTokens({ rollout, state } = {}) {
  const site = (rollout && rollout.site) || {};
  const org = nonEmpty((site.da || {}).org);
  const name = nonEmpty((site.da || {}).site);
  const raw = [org, name, ...(org && name ? [`${org}/${name}`, `main--${name}--${org}`] : [])];
  const hosts = [site.liveHost, site.previewHost].map(nonEmpty).filter(Boolean);
  raw.push(...hosts);
  const deploy = nonEmpty(state && state.site && state.site.deployUrl);
  for (const h of [...hosts, deploy].filter(Boolean).map(hostOf).filter(Boolean)) {
    raw.push(h);
    const parts = h.toLowerCase().split('.')[0].split('--');
    if (parts.length === 3 && parts.every((p) => /^[a-z0-9-]+$/.test(p))) raw.push(`${parts[2]}/${parts[1]}`, parts.join('--'));
  }
  const origin = originOf(state && state.site && state.site.originUrl) || originOf(site.sourceUrl);
  const sourceHost = origin ? new URL(origin).host.toLowerCase() : '';
  const tokens = new Map();
  for (const t of raw.map(nonEmpty)) {
    // the source site is migrated on purpose, so nothing its host contains can count as project identity
    if (t && t.length >= 3 && !sourceHost.includes(t.toLowerCase()) && !tokens.has(t.toLowerCase())) tokens.set(t.toLowerCase(), t);
  }
  return [...tokens.values()].sort((a, b) => b.length - a.length || byStr(a, b));
}

// Identity shapes caught whatever the tokens are: repository URLs, EDS project hosts, DA content paths.
// Non-global, so `.test()` is stateless; scrubbing uses global copies.
const IDENTITY_RULES = [
  [/(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s/"'<>)]+\/[^\s/"'<>)#?]+[^\s"'<>)]*/i, '<repo-url>'],
  // a segment never holds `--` and a match starts only at a label boundary, so this stays linear on `-`/`a--` runs
  [/(?<![a-z0-9-])(?:[a-z0-9]|-(?!-))+--(?:[a-z0-9]|-(?!-))+--(?:[a-z0-9]|-(?!-))+\.(?:aem|hlx)\.(?:page|live)/i, '<host>'],
  [/(?:content|admin)\.da\.live\/[^\s/"'<>)]+\/[^\s/"'<>)]+[^\s"'<>)]*/i, '<da-path>'],
];
export const IDENTITY_PATTERNS = IDENTITY_RULES.map(([re]) => re);
const SITE_PLACEHOLDER = '<site>';
const PLACEHOLDERS = /(<(?:site|repo-url|host|da-path)>)/;

/** Free text with identity patterns replaced (`<repo-url>`, `<host>`, `<da-path>`), then each token (longest first) by `<site>`. */
export function scrubIdentity(text, tokens) {
  if (typeof text !== 'string' || !text) return text;
  let out = IDENTITY_RULES.reduce((s, [re, label]) => s.replace(new RegExp(re.source, 'gi'), label), text);
  const list = (tokens || []).filter(Boolean).sort((a, b) => b.length - a.length || byStr(a, b));
  // one pass; a placeholder already written is matched first and kept as is
  if (list.length) out = out.replace(new RegExp(`${PLACEHOLDERS.source}|${list.map(escapeRe).join('|')}`, 'gi'), (m, kept) => kept || SITE_PLACEHOLDER);
  return out;
}

/** JSON paths of every string (key or value) holding a token; a key holding one shows as `*`, so no token is returned. */
export function findIdentity(value, tokens) {
  const list = (tokens || []).filter(Boolean).map((t) => t.toLowerCase());
  if (!list.length) return [];
  const hit = (s) => { const v = s.split(SITE_PLACEHOLDER).join('\u0000').toLowerCase(); return list.some((t) => v.includes(t)); };
  const hits = [];
  const walk = (v, path) => {
    if (typeof v === 'string') { if (hit(v)) hits.push(path); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const [k, x] of Object.entries(v && typeof v === 'object' ? v : {})) {
      const at = `${path}.${hit(k) ? '*' : k}`;
      if (hit(k)) hits.push(at);
      walk(x, at);
    }
  };
  walk(value, '$');
  return hits;
}

/** A judged free-text value: the trimmed string, or null when absent/empty. */
export const judgedText = (v) => nonEmpty(v);

/** Judged reuse guidance: both lists trimmed, de-duplicated and sorted; null unless one holds an entry. */
export function judgedGuidance(v) {
  if (!v || typeof v !== 'object') return null;
  const list = (xs) => uniqSorted((Array.isArray(xs) ? xs : []).map(nonEmpty).filter(Boolean));
  const g = { suitableFor: list(v.suitableFor), notSuitableFor: list(v.notSuitableFor) };
  return g.suitableFor.length || g.notSuitableFor.length ? g : null;
}

/**
 * Set each template row's judged `name`/`description` (scrubbed) right after `id`, or remove them when not judged;
 * every other key keeps its place. Mutates the rows; returns whether any row changed.
 */
export function applyTemplateJudgement(templates, judgement, tokens) {
  const judged = judgement && judgement.templates && typeof judgement.templates === 'object' ? judgement.templates : {};
  let changed = false;
  for (const row of Array.isArray(templates) ? templates : []) {
    const j = (Object.hasOwn(judged, row.id) && judged[row.id]) || {};
    const name = scrubIdentity(judgedText(j.name), tokens);
    const description = scrubIdentity(judgedText(j.description), tokens);
    const rest = Object.entries(row).filter(([k]) => k !== 'id' && k !== 'name' && k !== 'description');
    const next = { id: row.id, ...(name ? { name } : {}), ...(description ? { description } : {}), ...Object.fromEntries(rest) };
    if (JSON.stringify(next) === JSON.stringify(row)) continue;
    for (const k of Object.keys(row)) delete row[k];
    Object.assign(row, next);
    changed = true;
  }
  return changed;
}

/** writeJSON unless the file already holds `doc` apart from `_provenance.writtenAt` and `generatedAt`; true when written. */
export function writeCoverage(path, doc) {
  const stable = (d) => JSON.stringify(d && typeof d === 'object'
    ? { ...d, generatedAt: undefined, _provenance: d._provenance ? { ...d._provenance, writtenAt: undefined } : d._provenance }
    : d);
  if (existsSync(path) && stable(readJSON(path)) === stable(doc)) return false;
  writeJSON(path, doc);
  return true;
}
