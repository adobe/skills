/**
 * Legacy Component Planner (Branch D — `legacy-ui/foundation-component/`)
 *
 * Read-only classification + dry-run plan for BPA `lui` / `legacy.custom.component`
 * targets, plus optional bounded workspace scans. Two component-level cases:
 *   - `richtext-overlay` — Rich Text authoring overlay/customization (richtext-overlay.js)
 *   - `custom-parsys`    — component that extends/includes the legacy parsys (custom-parsys.js)
 * Everything else is `unknown`. Planning never writes. Template migration (Branch C)
 * is out of scope and never invoked.
 *
 * Evidence sources: `bpa` (getBpaFindings identifies the component) and
 * `heuristic/local-inspection` (bounded, workspace-only read).
 *
 * CLI (dry-run by default, prints Markdown; nothing is written):
 *   node legacy-component-planner.js <workspaceRoot> [--bpa <csv>] [--collections <dir>]
 *     [--path <jcrPath>]... [--scan] [--target <resourceType>] [--content-validated]
 *     [--policies-mapped] [--json] [--write-context]
 *     [--apply <jcrPath> --confirm]
 *   --write-context  writes .migration/legacy-component-context.yml (plan only).
 *   --apply          re-plans from the current workspace and applies one entry only
 *                    when canApply() allows it; requires --confirm.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { inspectParsysCandidate, planParsys, discoverParsysCandidates, buildComponentIndex, applyParsysConversion } = require('./custom-parsys.js');
const { inspectRichTextCandidate, planRichText, discoverRichTextCandidates } = require('./richtext-overlay.js');

const SUBTYPE = 'legacy.custom.component';
const JCR_ROOT = 'ui.apps/src/main/content/jcr_root';
const CONTEXT_FILE = '.migration/legacy-component-context.yml';
const MAX_FILES = 25;
const MAX_BYTES = 256 * 1024;

const RICHTEXT_SIGNAL = /cq\/gui\/components\/authoring\/dialog\/richtext|xtype="(?:richtext|htmleditor)"/;
const RTE_CONFIG = /rtePlugins|uiSettings|htmlRules/;

// The only action this flow can apply (applyParsysConversion). Rich Text never applies
// here: legacy dialogs are handed off to the Branch D dialog converter.
const APPLY_BACKED_ACTIONS = new Set(['convert-parsys-supertype']);

/** JCR path → workspace-relative path in the default FileVault module (dialog/context.md). */
function jcrToFs(jcrPath) {
  return jcrPath.startsWith('/apps/') ? `${JCR_ROOT}${jcrPath}` : null;
}

/** Bounded read of the text files owned by a component folder (stops at nested components). */
function inspectComponent(absDir) {
  const out = { exists: false, files: [], text: '' };
  try { fs.readdirSync(absDir); } catch { return out; }
  out.exists = true;
  const isComponent = d => /jcr:primaryType="cq:Component"/.test(readSmall(path.join(d, '.content.xml')) || '');
  const walk = (dir, depth) => {
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (out.files.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isFile()) out.files.push(full);
      else if (e.isDirectory() && depth < 2 && !['node_modules', '.git', 'target'].includes(e.name) && !isComponent(full)) walk(full, depth + 1);
    }
  };
  walk(absDir, 0);
  for (const f of out.files) {
    if (!/\.(xml|html|jsp|js)$/.test(f)) continue;
    const t = readSmall(f);
    if (t !== null) out.text += `\n${t}`;
  }
  return out;
}

function readSmall(file) {
  try { return fs.statSync(file).size <= MAX_BYTES ? fs.readFileSync(file, 'utf8') : null; } catch { return null; }
}

/**
 * Coarse classifier used only when structural inspection does not confirm a case.
 * Ambiguous evidence (both signals, or none) → `unknown`.
 */
function classify(jcrPath, text) {
  const evidence = [];
  const overlayPath = /^\/apps\/(?:cq|granite)\/.*(?:richtext|rte)/i.test(jcrPath);
  const rt = RICHTEXT_SIGNAL.test(text);
  const rte = RTE_CONFIG.test(text);
  const parsys = /sling:resourceSuperType="[^"]*parsys"/.test(text);

  if (overlayPath) evidence.push(`path overlays a product Rich Text node (${jcrPath})`);
  if (rt) evidence.push('dialog uses a Rich Text field');
  if (rte) evidence.push('RTE plugin/ui configuration nodes present');
  if (parsys) evidence.push('resourceSuperType resolves to a parsys');

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

function richTextEntry(jcrPath, workspaceRoot, evidenceSource, rt) {
  return { componentPath: jcrPath, evidenceSource, classification: 'richtext-overlay', evidence: rt.evidence, destructive: false, ...planRichText(rt, workspaceRoot) };
}

/** Build one plan entry. Structural inspection first; unconfirmed/unsafe → never converts. */
function buildEntry(jcrPath, workspaceRoot, evidenceSource, opts = {}) {
  const rel = jcrToFs(jcrPath);
  const base = { componentPath: jcrPath, evidenceSource, filesToChange: [], destructive: false };
  if (!rel) return { ...base, classification: 'unknown', evidence: [], action: 'needs-user-confirm', risk: 'path outside /apps', blockedReason: 'path outside /apps' };
  const absDir = path.join(workspaceRoot, rel);
  const info = inspectComponent(absDir);
  if (!info.exists) {
    return { ...base, classification: 'unknown', evidence: [], action: 'manual-review', risk: 'component folder not found in workspace', blockedReason: `${rel} does not exist` };
  }
  const rt = inspectRichTextCandidate(absDir, { jcrPath });
  const ps = inspectParsysCandidate(absDir, opts.parsysIndex || buildComponentIndex(workspaceRoot));
  if (rt.candidate && ps.candidate) {
    return { ...base, classification: 'unknown', evidence: [...rt.evidence, ...ps.evidence], action: 'needs-user-confirm', risk: 'conflicting evidence', blockedReason: 'both Rich Text and Parsys evidence; classify manually' };
  }
  if (rt.candidate) return richTextEntry(jcrPath, workspaceRoot, evidenceSource, rt);
  if (ps.candidate) return parsysEntry(jcrPath, workspaceRoot, evidenceSource, ps, opts);

  const { classification, evidence, reason } = classify(jcrPath, info.text);
  return {
    ...base, classification, evidence, action: 'needs-user-confirm',
    risk: classification === 'unknown' ? reason : 'coarse signal only; structure not confirmed',
    blockedReason: classification === 'unknown' ? reason : `structural inspection did not confirm a supported ${classification} case`,
  };
}

/**
 * Read-only dry run. Targets come from getBpaFindings('lui') filtered to
 * `legacy.custom.component`; `extraPaths` and the scans add bounded local inspection.
 */
async function planLegacyComponents(workspaceRoot, options = {}) {
  const {
    getBpaFindings = require('./bpa-findings-helper.js').getBpaFindings, bpaOptions, extraPaths = [],
    scanWorkspace = false, scanParsys = false, supportedTarget = null, contentValidated = false, policiesMapped = false,
  } = options;
  const parsysOpts = { supportedTarget, contentValidated, policiesMapped, parsysIndex: buildComponentIndex(workspaceRoot) };
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
    const { candidates, warnings: w } = discoverRichTextCandidates(workspaceRoot);
    warnings.push(...w);
    for (const { absDir, jcrPath, info } of candidates) {
      const key = jcrPath || `/${path.relative(workspaceRoot, absDir).split(path.sep).join('/')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(richTextEntry(key, workspaceRoot, 'heuristic/local-inspection', info));
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

/** True only for apply-backed, fully validated entries the user has explicitly confirmed. */
function canApply(entry, userConfirmed) {
  return Boolean(userConfirmed)
    && entry.classification === 'custom-parsys'
    && APPLY_BACKED_ACTIONS.has(entry.action)
    && entry.contentCompatibility === 'established'
    && entry.policyCompatibility === 'established'
    && !entry.blockedReason;
}

function renderDryRun(plan) {
  const lines = ['# Legacy component dry-run (read-only; no files changed)', ''];
  for (const w of plan.warnings || []) lines.push(`> warning: ${w}`);
  for (const e of plan.entries) {
    lines.push(`- ${e.componentPath}`,
      `  - evidence (${e.evidenceSource}): ${e.evidence.join('; ') || 'none'}`,
      `  - classification: ${e.classification}${(e.richtext || e.parsys) ? ` / ${(e.richtext || e.parsys).classification}` : ''}`,
      `  - detected customizations: ${e.richtext ? JSON.stringify(e.richtext.customizations) : 'n/a'}`,
      `  - custom behavior inventory: ${e.parsys ? JSON.stringify(e.parsys.inventory) : 'n/a'}`,
      `  - content-compatibility risk: ${e.contentCompatibility || 'n/a'}; policy mapping: ${e.policyCompatibility || 'n/a'}`,
      `  - proposed target: ${e.proposedTarget || 'none (not guessed)'}`,
      `  - proposed action: ${e.action}${e.proposed ? ` — ${e.proposed}` : ''}`,
      `  - handoff: ${e.handoff ? `${e.handoff.flow}: ${e.handoff.dialogs.map(h => `${h.action} ${h.dialog}`).join(', ')}` : 'none'}`,
      `  - risk/blocked: ${e.blockedReason || e.risk}`,
      `  - files that would change: ${e.filesToChange.join(', ') || 'none'}`);
  }
  return lines.join('\n');
}

function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(String(v));
}

/** Minimal YAML emitter for plain JSON data (strings double-quoted). */
function toYaml(v, indent = 0) {
  const pad = ' '.repeat(indent);
  const isObj = x => x !== null && typeof x === 'object';
  if (Array.isArray(v)) {
    if (!v.length) return ' []';
    return v.map(x => (isObj(x) && Object.keys(x).length
      ? `\n${pad}-${toYaml(x, indent + 2).replace(/^\n\s*/, ' ')}`
      : `\n${pad}-${isObj(x) ? toYaml(x, indent + 2) : ` ${yamlScalar(x)}`}`)).join('');
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length) return ' {}';
    return keys.map(k => (isObj(v[k]) ? `\n${pad}${k}:${toYaml(v[k], indent + 2)}` : `\n${pad}${k}: ${yamlScalar(v[k])}`)).join('');
  }
  return ` ${yamlScalar(v)}`;
}

function contextYaml(plan) {
  const session = { generatedBy: 'legacy-component-planner.js', mode: plan.mode, entries: plan.entries.length, warnings: plan.warnings };
  const entries = plan.entries.map(e => ({ ...e, userConfirmed: false }));
  return `# Plan only. Confirm per entry with the user; apply re-plans from the workspace.${toYaml({ session, entries })}\n`;
}

function parseArgs(argv) {
  const o = { root: null, extraPaths: [], scan: false, json: false, writeContext: false, confirm: false, contentValidated: false, policiesMapped: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bpa') o.bpa = argv[++i];
    else if (a === '--collections') o.collections = argv[++i];
    else if (a === '--path') o.extraPaths.push(argv[++i]);
    else if (a === '--target') o.target = argv[++i];
    else if (a === '--apply') o.apply = argv[++i];
    else if (a === '--scan') o.scan = true;
    else if (a === '--json') o.json = true;
    else if (a === '--write-context') o.writeContext = true;
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--content-validated') o.contentValidated = true;
    else if (a === '--policies-mapped') o.policiesMapped = true;
    else if (!a.startsWith('--') && !o.root) o.root = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  o.root = path.resolve(o.root || process.cwd());
  if (!o.bpa && !o.extraPaths.length) o.scan = true;
  return o;
}

async function main(argv, io = { out: s => process.stdout.write(s), err: s => process.stderr.write(s) }) {
  const o = parseArgs(argv);
  const bpaOptions = o.bpa ? { bpaFilePath: path.resolve(o.bpa), collectionsDir: o.collections ? path.resolve(o.collections) : undefined, limit: null, offset: 0 } : undefined;
  const log = console.log;
  console.log = (...a) => io.err(`${a.join(' ')}\n`); // keep helper logging off stdout
  let plan;
  try {
    plan = await planLegacyComponents(o.root, {
      bpaOptions, extraPaths: o.extraPaths, scanWorkspace: o.scan, scanParsys: o.scan,
      supportedTarget: o.target || null, contentValidated: o.contentValidated, policiesMapped: o.policiesMapped,
    });
  } finally { console.log = log; }

  if (o.apply) {
    const entry = plan.entries.find(e => e.componentPath === o.apply);
    if (!entry) { io.err(`no planned entry for ${o.apply}\n`); return 2; }
    if (!canApply(entry, o.confirm)) {
      io.err(`refused: ${o.confirm ? (entry.blockedReason || `action ${entry.action} is not applied by this flow`) : '--confirm is required'}\n`);
      return 2;
    }
    const res = applyParsysConversion(entry, o.root, true);
    io.out(`${JSON.stringify(res, null, 2)}\n`);
    return res.applied.length ? 0 : 2;
  }
  if (o.writeContext) {
    const file = path.join(o.root, CONTEXT_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contextYaml(plan));
    io.err(`plan written to ${CONTEXT_FILE} (add .migration/ to .gitignore)\n`);
  }
  io.out(o.json ? `${JSON.stringify(plan, null, 2)}\n` : `${renderDryRun(plan)}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}

module.exports = { classify, buildEntry, planLegacyComponents, canApply, renderDryRun, contextYaml, toYaml, parseArgs, main, SUBTYPE, CONTEXT_FILE };
