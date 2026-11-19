/**
 * Component-level legacy Parsys inspection (read-only unless applyParsysConversion).
 *
 * Structural evidence only (resourceSuperType/resourceType, JSP/HTL includes, local
 * files); names are never used. Supertypes are followed only when they resolve to a
 * component folder inside the workspace. No target resource type is defined here:
 * the only supported target must be supplied explicitly by the caller (from project
 * guidance), otherwise the target is unknown and nothing is converted.
 * Template modernization is not involved.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 256 * 1024;
const MAX_CHAIN = 5;
const SKIP = new Set(['node_modules', '.git', 'target', 'dist']);
const PARSYS_RT = '(?:wcm/)?foundation/components/parsys';
const PARSYS_EXACT = new RegExp(`^${PARSYS_RT}(?:/colctrl)?$`);
const SUPERTYPE_ATTR = new RegExp(`sling:resourceSuperType="${PARSYS_RT}"`);

const SIGNALS = {
  columnControl: /parsys\/colctrl|resource(?:Super)?Type="[^"]*\/colctrl[^"]*"/,
  layout: /\b(?:cq:)?layout(?:Type|Path)?="|cq:childEditConfig/,
  selectorsOrOverrides: /\b(?:addSelectors|replaceSelectors|removeSelectors|getSelectors|getSuffix|suffix)\b|@\s*(?:selectors|suffix|resourceType)\s*=|resourceType="(?!(?:wcm\/)?foundation\/components\/parsys")[^"]+"/,
  virtual: /SyntheticResource|ResourceWrapper|ValueMapDecorator|createResource|getOrCreate|resolver\.create\s*\(|addChild\s*\(/,
  dynamicPath: /@\s*path\s*=\s*['"]?\$\{|path="<%=|path='<%=/,
  customLogic: /<%(?![@\-])|data-sly-(?:use|test|list|call|repeat)/,
  clientlib: /clientlib|categories=|extraClientlibs/i,
  authoredChild: /getChildren\s*\(|listChildren\s*\(|getChild\s*\(|data-sly-list|childResources/,
};

function readText(file) {
  try { return fs.statSync(file).size > MAX_BYTES ? null : fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function listFiles(dir, depth = 0, acc = []) {
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    const full = path.join(dir, e.name);
    if (e.isFile()) acc.push(full);
    else if (e.isDirectory() && depth < 3 && !SKIP.has(e.name)) listFiles(full, depth + 1, acc);
  }
  return acc;
}

function isComponentDir(dir) {
  return /jcr:primaryType="cq:Component"/.test(readText(path.join(dir, '.content.xml')) || '');
}

/** Map resourceType (path under jcr_root/apps|libs) → component dir, for resolvable supertypes. */
function buildComponentIndex(workspaceRoot) {
  const index = new Map();
  (function walk(dir, depth) {
    if (depth > 14) return;
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (es.some(e => e.name === '.content.xml') && isComponentDir(dir)) {
      const parts = path.relative(workspaceRoot, dir).split(path.sep);
      const i = parts.indexOf('jcr_root');
      if (i >= 0) index.set(parts.slice(i + 2).join('/'), dir);
    }
    for (const e of es) if (e.isDirectory() && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1);
  })(workspaceRoot, 0);
  return index;
}

function superTypeOf(dir) {
  const m = /sling:resourceSuperType="([^"]+)"/.exec(readText(path.join(dir, '.content.xml')) || '');
  return m ? m[1] : null;
}

/** Follow resourceSuperType up to parsys using only workspace-resolvable components. */
function resolveChain(absDir, index) {
  const dirs = [absDir];
  let cur = absDir;
  for (let i = 0; i < MAX_CHAIN; i++) {
    const st = superTypeOf(cur);
    if (!st) return { dirs, reachesParsys: false, unresolved: null };
    if (PARSYS_EXACT.test(st)) return { dirs, reachesParsys: true, direct: i === 0, unresolved: null };
    const next = index.get(st.replace(/^\/?(?:apps|libs)\//, ''));
    if (!next || dirs.includes(next)) return { dirs, reachesParsys: false, unresolved: st };
    dirs.push(next);
    cur = next;
  }
  return { dirs, reachesParsys: false, unresolved: 'chain-too-deep' };
}

function inspectParsysCandidate(absDir, index) {
  const chain = resolveChain(absDir, index);
  const files = chain.dirs.flatMap(d => listFiles(d));
  const texts = files.map(f => ({ f, t: readText(f) }));
  const own = listFiles(absDir).map(f => ({ f, t: readText(f) }));
  const scriptUsage = own.some(x => x.t && /\.(jsp|html)$/.test(x.f)
    && new RegExp(`(?:cq|sling):include[^>]*resourceType="${PARSYS_RT}"|data-sly-resource="[^"]*resourceType\\s*=\\s*['"]${PARSYS_RT}['"]`).test(x.t));
  if (!chain.reachesParsys && !scriptUsage) return { candidate: false };

  const evidence = [];
  if (chain.reachesParsys) evidence.push(chain.direct ? 'direct resourceSuperType is legacy parsys' : `inherits legacy parsys via ${chain.dirs.length - 1} workspace-resolved supertype(s)`);
  if (scriptUsage) evidence.push('script includes legacy parsys resourceType');

  const inv = {};
  for (const [k, re] of Object.entries(SIGNALS)) {
    inv[k] = texts.filter(x => x.t && re.test(x.t)).map(x => path.relative(absDir, x.f) || path.basename(x.f));
  }
  const parsysIncludes = own.filter(x => x.t && /\.(jsp|html)$/.test(x.f))
    .reduce((n, x) => n + (x.t.match(new RegExp(`resourceType\\s*=\\s*['"]${PARSYS_RT}['"]`, 'g')) || []).length, 0);
  inv.nestedContainers = parsysIncludes > 1 || own.some(x => x.t && /sling:resourceType="[^"]*(?:parsys|responsivegrid|container)[^"]*"/.test(x.t) && x.f.endsWith('.content.xml') && path.dirname(x.f) !== absDir)
    ? ['multiple container includes/child containers'] : [];
  inv.jsClientFiles = files.filter(f => f.endsWith('.js'));
  inv.jsClientFiles = inv.jsClientFiles.map(f => path.relative(absDir, f));
  inv.unreadable = texts.some(x => x.t === null);
  inv.unresolvedSupertype = chain.unresolved;

  const virtual = inv.virtual.length || inv.dynamicPath.length;
  const layoutish = inv.layout.length || inv.selectorsOrOverrides.length || inv.nestedContainers.length;
  const kinds = [Boolean(inv.columnControl.length), Boolean(layoutish), Boolean(virtual)].filter(Boolean).length;
  const otherCustom = inv.customLogic.length || inv.clientlib.length || inv.jsClientFiles.length || inv.authoredChild.length;

  let classification;
  if (inv.unreadable || inv.unresolvedSupertype) classification = 'unknown';
  else if (kinds > 1) classification = 'mixed-custom';
  else if (virtual) classification = 'custom-virtual-or-dynamic-children';
  else if (inv.columnControl.length) classification = 'custom-column-control';
  else if (layoutish) classification = 'custom-layout';
  else if (otherCustom) classification = 'unknown';
  else classification = 'plain-legacy-parsys';

  return {
    candidate: true, evidence, classification, inventory: inv, direct: Boolean(chain.direct),
    supertypeFile: path.join(absDir, '.content.xml'), authoredChildAssumptions: inv.authoredChild.length > 0,
  };
}

/**
 * options.supportedTarget — exact target resourceType from project guidance (never guessed).
 * options.contentValidated — explicit attestation that authored children were validated.
 */
function planParsys(info, options = {}) {
  const { supportedTarget = null, contentValidated = false } = options;
  const base = { parsys: { classification: info.classification, inventory: info.inventory }, proposedTarget: supportedTarget, filesToChange: [] };
  const contentCompatibility = contentValidated && !info.authoredChildAssumptions ? 'established' : 'needs-content-validation';
  const withCompat = { ...base, contentCompatibility };

  if (info.classification === 'plain-legacy-parsys') {
    if (!supportedTarget) return { ...withCompat, action: 'needs-user-confirm', blockedReason: 'no supported target resource type defined; none is guessed', risk: 'target unknown' };
    if (!info.direct) return { ...withCompat, action: 'needs-user-confirm', blockedReason: 'parsys is inherited or included, not a direct supertype; automatic conversion not supported', risk: 'inheritance chain change' };
    if (contentCompatibility !== 'established') return { ...withCompat, action: 'needs-content-validation', blockedReason: 'authored child-node compatibility not established from source', risk: 'existing authored content may not render' };
    return { ...withCompat, action: 'convert-parsys-supertype', blockedReason: null, risk: 'supertype swap to the supplied supported target', filesToChange: [info.supertypeFile] };
  }
  const plan = ['inventory custom behavior (see detected inventory)', 'identify an explicit supported equivalent for each behavior', 'validate authored content against the target', 'preserve custom behavior until then'];
  if (info.classification === 'custom-layout' || info.classification === 'custom-column-control') {
    return { ...withCompat, action: 'needs-user-confirm', migrationPlan: plan, blockedReason: `${info.classification}: custom behavior has no proven supported replacement`, risk: 'behavior/content change' };
  }
  return { ...withCompat, action: 'manual-review', migrationPlan: plan, blockedReason: `${info.classification}: manual review required`, risk: 'behavior loss if rewritten' };
}

function discoverParsysCandidates(workspaceRoot, index = buildComponentIndex(workspaceRoot)) {
  const out = [];
  for (const dir of index.values()) {
    const info = inspectParsysCandidate(dir, index);
    if (info.candidate) out.push({ absDir: dir, info });
  }
  return out;
}

/** Guarded: only plain, direct, content-validated, user-confirmed entries with an explicit target. */
function applyParsysConversion(entry, workspaceRoot, userConfirmed) {
  const ok = userConfirmed && entry.parsys?.classification === 'plain-legacy-parsys' && entry.action === 'convert-parsys-supertype'
    && entry.contentCompatibility === 'established' && entry.proposedTarget && !entry.blockedReason;
  if (!ok) return { applied: [], skipped: 'not confirmed, not plain, target unknown, or content validation pending' };
  const applied = [];
  for (const rel of entry.filesToChange) {
    const abs = path.join(workspaceRoot, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const next = text.replace(SUPERTYPE_ATTR, () => `sling:resourceSuperType="${entry.proposedTarget}"`);
    if (next !== text) { fs.writeFileSync(abs, next); applied.push(rel); }
  }
  return { applied, skipped: null };
}

module.exports = { inspectParsysCandidate, planParsys, discoverParsysCandidates, buildComponentIndex, applyParsysConversion };
