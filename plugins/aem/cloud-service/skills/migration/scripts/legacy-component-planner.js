/**
 * Legacy Component Planner (Branch D — `legacy-ui/foundation-component/`)
 *
 * Read-only classification + dry-run plan for BPA `lui` / `legacy.custom.component`
 * targets. Two supported cases:
 *   - `richtext-overlay` — a Rich Text authoring overlay/customization
 *   - `custom-parsys`    — a component that extends/reimplements the legacy parsys
 * Everything else is `unknown`. Nothing here writes to the workspace.
 *
 * Evidence sources: `bpa` (getBpaFindings identifies the component path) and
 * `local-inspection` (bounded, workspace-only heuristic read of the component
 * folder). Local inspection is a heuristic and is labelled as such.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { inspectParsysCandidate, planParsys, discoverParsysCandidates, buildComponentIndex } = require('./custom-parsys.js');
const { inspectRichTextCandidate, planRichText, discoverRichTextCandidates } = require('./richtext-overlay.js');

const SUBTYPE = 'legacy.custom.component';
const JCR_ROOT = 'ui.apps/src/main/content/jcr_root';
const MAX_FILES = 25;
const MAX_BYTES = 256 * 1024;

const RICHTEXT_RT = /cq\/gui\/components\/authoring\/dialog\/richtext|granite\/ui\/components\/[^"']*\/richtext/;
const RTE_CONFIG = /rtePlugins|uiSettings|htmlRules/;

// Only actions backed by an apply function (applyRichTextConversion / applyParsysConversion).
const APPLY_BACKED_ACTIONS = new Set(['convert-richtext-xtype', 'convert-parsys-supertype']);

/** JCR component path → workspace-relative filesystem path (same mapping as dialog/context.md). */
function jcrToFs(jcrPath) {
  return jcrPath.startsWith('/apps/') ? `${JCR_ROOT}${jcrPath}` : null;
}

/** Bounded read of the text files directly inside a component folder. */
function inspectComponent(absDir) {
  const out = { exists: false, files: [], text: '' };
  try { fs.readdirSync(absDir); } catch { return out; }
  out.exists = true;
  const walk = (dir, list, depth) => {
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (list.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isFile()) list.push(full);
      else if (e.isDirectory() && depth < 2 && !['node_modules', '.git', 'target'].includes(e.name)) walk(full, list, depth + 1);
    }
  };
  walk(absDir, out.files, 0);
  for (const f of out.files) {
    if (!/\.(xml|html|jsp|js)$/.test(f)) continue;
    try {
      if (fs.statSync(f).size <= MAX_BYTES) out.text += `\n${fs.readFileSync(f, 'utf8')}`;
    } catch { /* unreadable → no evidence */ }
  }
  return out;
}

/**
 * Pure classifier. `jcrPath` + inspected text → { classification, evidence, reason }.
 * Ambiguous evidence (both signals, or none) → `unknown`.
 */
function classify(jcrPath, text) {
  const evidence = [];
  const overlayPath = /^\/apps\/(?:cq|granite)\/.*richtext/.test(jcrPath);
  const rt = RICHTEXT_RT.test(text);
  const rte = RTE_CONFIG.test(text);
  const parsys = /sling:resourceSuperType="[^"]*parsys"/.test(text);

  if (overlayPath) evidence.push(`path overlays a foundation richtext node (${jcrPath})`);
  if (rt) evidence.push('dialog uses a richtext resourceType');
  if (rte) evidence.push('RTE plugin/ui configuration nodes present');
  if (parsys) evidence.push('resourceSuperType or name resolves to parsys');

  const isRt = overlayPath || (rt && rte);
  if (isRt && parsys) return { classification: 'unknown', evidence, reason: 'conflicting richtext and parsys signals' };
  if (isRt) return { classification: 'richtext-overlay', evidence, reason: null };
  if (parsys) return { classification: 'custom-parsys', evidence, reason: null };
  return { classification: 'unknown', evidence, reason: evidence.length ? 'insufficient evidence' : 'no recognised signals' };
}

function parsysEntry(jcrPath, workspaceRoot, evidenceSource, ps, opts) {
  const plan = planParsys(ps, opts);
  return {
    componentPath: jcrPath, evidenceSource, classification: 'custom-parsys', evidence: ps.evidence, destructive: false, ...plan,
    filesToChange: plan.filesToChange.map(f => path.relative(workspaceRoot, f)),
  };
}

/** Build one plan entry. Unknown/unsafe → needs-user-confirm, never an inferred conversion. */
function buildEntry(jcrPath, workspaceRoot, evidenceSource, opts = {}) {
  const rel = jcrToFs(jcrPath);
  const base = { componentPath: jcrPath, evidenceSource, filesToChange: [] };
  if (!rel) return { ...base, classification: 'unknown', evidence: [], action: 'needs-user-confirm', risk: 'path outside /apps', blockedReason: 'path outside /apps', destructive: false };
  const info = inspectComponent(path.join(workspaceRoot, rel));
  if (!info.exists) {
    return { ...base, classification: 'unknown', evidence: [], action: 'manual-review', risk: 'component folder not found in workspace', blockedReason: `${rel} does not exist`, destructive: false };
  }
  const { classification, evidence, reason } = classify(jcrPath, info.text);
  if (classification === 'unknown') {
    return { ...base, classification, evidence, action: 'needs-user-confirm', risk: reason, blockedReason: reason, destructive: false };
  }
  if (classification === 'richtext-overlay') {
    const rt = inspectRichTextCandidate(path.join(workspaceRoot, rel));
    if (rt.candidate) {
      const plan = planRichText(rt);
      return {
        ...base, classification, evidence: [...evidence, ...rt.evidence], destructive: false, ...plan,
        filesToChange: plan.filesToChange.map(f => path.relative(workspaceRoot, f)),
      };
    }
  }
  if (classification === 'custom-parsys') {
    const absDir = path.join(workspaceRoot, rel);
    const ps = inspectParsysCandidate(absDir, opts.parsysIndex || buildComponentIndex(workspaceRoot));
    if (ps.candidate) return parsysEntry(jcrPath, workspaceRoot, evidenceSource, ps, opts);
  }
  // The coarse signal was not confirmed by structural inspection: plan only, never convert.
  return {
    ...base, classification, evidence, action: 'needs-user-confirm', destructive: false,
    risk: 'coarse signal only; structure not confirmed',
    blockedReason: `structural inspection did not confirm a supported ${classification} case`,
  };
}

/**
 * Read-only dry run. Targets come from getBpaFindings('lui') filtered to
 * `legacy.custom.component`; `extraPaths` allows bounded local-inspection when BPA
 * lacks detail. No workspace writes.
 */
async function planLegacyComponents(workspaceRoot, options = {}) {
  const { getBpaFindings = require('./bpa-findings-helper.js').getBpaFindings, bpaOptions, extraPaths = [], scanWorkspace = false, scanParsys = false, supportedTarget = null, contentValidated = false } = options;
  const parsysOpts = { supportedTarget, contentValidated, parsysIndex: buildComponentIndex(workspaceRoot) };
  const entries = [];
  const seen = new Set();
  const warnings = [];

  if (bpaOptions) {
    const res = await getBpaFindings('lui', bpaOptions);
    if (res && res.error) warnings.push(`BPA unavailable: ${res.error}`);
    for (const t of (res && res.targets) || []) {
      if (t.identifier !== SUBTYPE) continue;
      const p = t.className || t.filePath;
      if (!p || seen.has(p)) continue;
      seen.add(p);
      entries.push(buildEntry(p, workspaceRoot, 'bpa', parsysOpts));
    }
  }
  for (const p of extraPaths) {
    if (seen.has(p)) continue;
    seen.add(p);
    entries.push(buildEntry(p, workspaceRoot, 'heuristic/local-inspection', parsysOpts));
  }
  if (scanWorkspace) {
    for (const { absDir, info } of discoverRichTextCandidates(workspaceRoot)) {
      const rel = path.relative(workspaceRoot, absDir);
      const idx = rel.split(path.sep).indexOf('jcr_root');
      const jcrPath = idx >= 0 ? `/${rel.split(path.sep).slice(idx + 1).join('/')}` : `/${rel.split(path.sep).join('/')}`;
      if (seen.has(jcrPath)) continue;
      seen.add(jcrPath);
      const plan = planRichText(info);
      entries.push({
        componentPath: jcrPath, evidenceSource: 'heuristic/local-inspection', classification: 'richtext-overlay',
        evidence: info.evidence, destructive: false, ...plan,
        filesToChange: plan.filesToChange.map(f => path.relative(workspaceRoot, f)),
      });
    }
  }
  if (scanParsys) {
    for (const { absDir, info } of discoverParsysCandidates(workspaceRoot, parsysOpts.parsysIndex)) {
      const rel = path.relative(workspaceRoot, absDir).split(path.sep);
      const idx = rel.indexOf('jcr_root');
      const jcrPath = `/${(idx >= 0 ? rel.slice(idx + 1) : rel).join('/')}`;
      if (seen.has(jcrPath)) continue;
      seen.add(jcrPath);
      entries.push(parsysEntry(jcrPath, workspaceRoot, 'heuristic/local-inspection', info, parsysOpts));
    }
  }
  return { mode: 'dry-run', readOnly: true, entries, warnings };
}

/** True only for classified, unblocked entries the user has explicitly confirmed. */
function canApply(entry, userConfirmed) {
  return Boolean(userConfirmed)
    && (entry.classification === 'richtext-overlay' || entry.classification === 'custom-parsys')
    && APPLY_BACKED_ACTIONS.has(entry.action)
    && entry.contentCompatibility !== 'needs-content-validation'
    && !entry.blockedReason;
}

function renderDryRun(plan) {
  const lines = ['# Legacy component dry-run (read-only; no files changed)', ''];
  for (const e of plan.entries) {
    lines.push(`- ${e.componentPath}`,
      `  - evidence (${e.evidenceSource}): ${e.evidence.join('; ') || 'none'}`,
      `  - classification: ${e.classification}${(e.richtext || e.parsys) ? ` / ${(e.richtext || e.parsys).classification}` : ''}`,
      `  - detected customizations: ${e.richtext ? JSON.stringify(e.richtext.customizations) : 'n/a'}`,
      `  - custom behavior inventory: ${e.parsys ? JSON.stringify(e.parsys.inventory) : 'n/a'}`,
      `  - content-compatibility risk: ${e.contentCompatibility || 'n/a'}`,
      `  - proposed target: ${e.proposedTarget || 'none (not guessed)'}`,
      `  - proposed action: ${e.action}`,
      `  - risk/blocked: ${e.blockedReason || e.risk}`,
      `  - files that would change: ${e.filesToChange.join(', ') || 'none'}`);
  }
  return lines.join('\n');
}

module.exports = { classify, buildEntry, planLegacyComponents, canApply, renderDryRun, SUBTYPE };
