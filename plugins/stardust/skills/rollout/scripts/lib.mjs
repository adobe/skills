/**
 * rollout/lib.mjs — shared IO + roll-up helpers so every script derives the same
 * counts from the same per-unit truth (counts are always recomputed, never
 * incremented).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

/** Block conversion counts from coverage/blocks.json rows; a default-content mapping counts as converted. */
export function blockCounts(blocks) {
  const converted = blocks.filter((b) => isDefaultContent(b) || ['converted', 'deployed', 'verified']
    .includes(b.delivery && b.delivery.status)).length;
  return { total: blocks.length, converted, pending: blocks.length - converted };
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
    blocks: blocks ? blockCounts(blocks) : (config.lastRun && config.lastRun.blocks) || { total: 0, converted: 0, pending: 0 },
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
    const res = await fetch(`${base}${page.path}`);
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
 * the source either, no JSON-LD on the source either, the same title shared by the same pages —
 * mirrors the source rather than a delivery defect. A recorded hands-off run accepted 63 such
 * findings by hand. They stay in the ledger (listed in their own report section) but are
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
