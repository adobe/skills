/**
 * Rich Text authoring overlay/customization inspection (component level, read-only).
 *
 * This flow never edits project files. Legacy Rich Text dialogs are handed off to the
 * existing Branch D dialog converter (references/legacy-ui/dialog/): a Classic
 * `dialog/` → `convert-extjs`, a Coral 2 `_cq_dialog/` → `upgrade-coral2`. The
 * htmleditor/richtext → `cq/gui/components/authoring/dialog/richtext` mapping in
 * extjs-to-coral3.md only applies inside that whole-dialog conversion; AEM as a Cloud
 * Service has no Classic UI and reads only `cq:dialog`.
 *
 * A candidate needs legacy evidence: a Classic or Coral 2 Rich Text dialog, a product
 * overlay (`/apps/cq|granite/**` mirroring `/libs`), or a Rich Text dialog rendered by
 * a JSP or another non-HTL script. A Coral 3 Rich Text dialog rendered by HTL is
 * already supported and is not reported. Scripts are never rewritten or deleted.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 256 * 1024;
const MAX_WALK_DEPTH = 24;
const SKIP = new Set(['node_modules', '.git', 'target', 'dist']);

const RT_XTYPE = /xtype="(?:richtext|htmleditor)"/;
const RT_RESOURCE = /sling:resourceType="cq\/gui\/components\/authoring\/dialog\/richtext"/;
const RTE_CONFIG = /rtePlugins|uiSettings|htmlRules/;
const CORAL2 = /granite\/ui\/components\/foundation\//;
const CORAL3 = /granite\/ui\/components\/coral\//;
// Product-owned namespaces: anything here overlays the matching /libs path.
const PRODUCT_OVERLAY = /^\/apps\/(?:cq|granite)\/(?:[^/]+\/)*[^/]*(?:richtext|rte)[^/]*$/i;
// Classic (CQ.form.rte) and Touch UI (CUI.rte) RTE plugin APIs: custom plugin code.
const RTE_PLUGIN_JS = /\b(?:CQ\.form\.rte|CUI\.rte)\b/;
const OTHER_SCRIPT = /\.(?:esp|ecma|groovy|jst)$/;

function readText(file) {
  try { return fs.statSync(file).size > MAX_BYTES ? null : fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function isComponentDir(dir) {
  return /jcr:primaryType="cq:Component"/.test(readText(path.join(dir, '.content.xml')) || '');
}

/** Files owned by one component: never descends into a nested cq:Component folder. */
function listFiles(dir, depth = 0, acc = []) {
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    const full = path.join(dir, e.name);
    if (e.isFile()) acc.push(full);
    else if (e.isDirectory() && depth < 3 && !SKIP.has(e.name) && !isComponentDir(full)) listFiles(full, depth + 1, acc);
  }
  return acc;
}

/** Workspace dir → JCR path when it sits under a FileVault jcr_root, else null. */
function jcrPathOf(workspaceRoot, absDir) {
  const parts = path.relative(workspaceRoot, absDir).split(path.sep);
  const i = parts.indexOf('jcr_root');
  return i >= 0 ? `/${parts.slice(i + 1).join('/')}` : null;
}

/** Inventory customizations found in a JSP (pure). */
function analyzeJsp(text, resolveInclude) {
  const found = { imports: [], scriptlets: 0, conditions: [], serverAccess: [], dynamic: [], unresolvedIncludes: [] };
  if (text === null) { found.dynamic.push('unreadable-or-oversized'); return found; }
  for (const m of text.matchAll(/<%@\s*page[^%]*\bimport\s*=\s*"([^"]+)"/g)) found.imports.push(m[1]);
  found.scriptlets = (text.match(/<%(?![@!=\-])/g) || []).length;
  for (const m of text.matchAll(/<c:(?:if|when|choose)\b|<%[^%]*\bif\s*\(/g)) found.conditions.push(m[0].trim());
  for (const m of text.matchAll(/\b(slingRequest|request\.get\w+|session\b|resourceResolver|getService\s*\(|sling\.getService|Repository\b|getAttribute\s*\()/g)) {
    if (!found.serverAccess.includes(m[1])) found.serverAccess.push(m[1]);
  }
  if (/<%=/.test(text)) found.dynamic.push('expression-scriptlet');
  if (/\$\{[^}]+\}/.test(text)) found.dynamic.push('el-expression');
  for (const m of text.matchAll(/<(?:jsp:include|%@\s*include)[^>]*?(?:page|file)="([^"]+)"/g)) {
    if (!resolveInclude(m[1])) found.unresolvedIncludes.push(m[1]);
  }
  if (found.unresolvedIncludes.length) found.dynamic.push('unresolved-include');
  return found;
}

function mergeJsp(analyses) {
  const out = { imports: [], scriptlets: 0, conditions: [], serverAccess: [], dynamic: [], unresolvedIncludes: [] };
  for (const a of analyses) {
    out.scriptlets += a.scriptlets;
    for (const k of ['imports', 'conditions', 'serverAccess', 'dynamic', 'unresolvedIncludes']) {
      for (const v of a[k]) if (!out[k].includes(v)) out[k].push(v);
    }
  }
  return out;
}

/** classic (dialog/, cq:Dialog) | coral2 | coral3 */
function dialogKind(file, text) {
  const dir = path.basename(path.dirname(file));
  if (dir === 'dialog' || dir === 'design_dialog' || /jcr:primaryType="cq:Dialog"/.test(text)) return 'classic';
  if (CORAL2.test(text) && !CORAL3.test(text)) return 'coral2';
  return 'coral3';
}

/**
 * @param {string} absDir  component or overlay folder
 * @param {{ jcrPath?: string }} [opts]
 */
function inspectRichTextCandidate(absDir, opts = {}) {
  const files = listFiles(absDir);
  const rel = f => path.relative(absDir, f);
  const xmls = files.filter(f => f.endsWith('.xml')).map(f => ({ file: f, text: readText(f) })).filter(x => x.text !== null);
  const rtDialogs = xmls
    .filter(x => RT_XTYPE.test(x.text) || RT_RESOURCE.test(x.text) || (RTE_CONFIG.test(x.text) && /richtext|htmleditor/.test(x.text)))
    .map(x => ({ file: x.file, text: x.text, kind: dialogKind(x.file, x.text) }));
  const overlay = opts.jcrPath && PRODUCT_OVERLAY.test(opts.jcrPath)
    ? { libsPath: opts.jcrPath.replace(/^\/apps\//, '/libs/') } : null;
  const jspFiles = files.filter(f => f.endsWith('.jsp'));
  const otherScripts = files.filter(f => OTHER_SCRIPT.test(f));
  const legacyDialogs = rtDialogs.filter(d => d.kind !== 'coral3');
  const scriptRendered = rtDialogs.length > 0 && (jspFiles.length > 0 || otherScripts.length > 0);
  if (!overlay && !legacyDialogs.length && !scriptRendered) return { candidate: false, evidence: [] };

  const evidence = [];
  if (overlay) evidence.push(`overlays product path ${overlay.libsPath}`);
  for (const d of legacyDialogs) evidence.push(`${d.kind} Rich Text dialog ${rel(d.file)}`);
  if (scriptRendered) evidence.push(`Rich Text dialog rendered by ${[...jspFiles, ...otherScripts].map(rel).join(', ')}`);

  const jsp = jspFiles.length
    ? mergeJsp(jspFiles.map(f => analyzeJsp(readText(f), inc => fs.existsSync(path.resolve(path.dirname(f), inc)))))
    : null;
  const clientlibs = [];
  for (const x of xmls) if (/extraClientlibs|categories=|cq:ClientLibraryFolder/.test(x.text)) clientlibs.push(rel(x.file));
  for (const f of jspFiles) if (/clientlib/i.test(readText(f) || '')) clientlibs.push(rel(f));
  const customRtePlugins = files.filter(f => f.endsWith('.js') && RTE_PLUGIN_JS.test(readText(f) || '')).map(rel);

  const customizations = {
    richTextTypes: [...new Set(rtDialogs.flatMap(d => [...d.text.matchAll(/sling:resource(?:Super)?Type="([^"]*richtext)"/g)].map(m => m[1])))],
    dialogs: rtDialogs.map(d => ({ file: rel(d.file), kind: d.kind })),
    jspFiles: jspFiles.map(rel),
    otherScripts: otherScripts.map(rel),
    htlScripts: files.filter(f => f.endsWith('.html')).map(rel),
    rteConfigFiles: rtDialogs.filter(d => RTE_CONFIG.test(d.text)).map(d => rel(d.file)),
    toolbarFeatures: [...new Set(rtDialogs.flatMap(d => [...d.text.matchAll(/<(\w+)\s[^>]*?(?:features|toolbar)="([^"]*)"/g)].map(m => `${m[1]}:${m[2]}`)))],
    clientlibs: [...new Set(clientlibs)],
    customRtePlugins,
    jspAnalysis: jsp,
    overlay,
  };

  let classification = 'configuration-only';
  if (otherScripts.length) classification = 'unknown';
  else if (jsp) {
    const behavioral = jsp.imports.length || jsp.scriptlets || jsp.conditions.length || jsp.serverAccess.length;
    if (behavioral) classification = 'custom-jsp-behavioral';
    else if (jsp.dynamic.length) classification = 'unknown';
    else classification = 'custom-jsp-ui';
  }
  return { candidate: true, evidence, classification, customizations, legacyDialogs: legacyDialogs.map(d => ({ file: d.file, kind: d.kind })) };
}

/** Plan only. `filesToChange` is always empty: this flow never edits files. */
function planRichText(info, workspaceRoot) {
  const cust = info.customizations;
  const base = { richtext: { classification: info.classification, customizations: cust }, filesToChange: [] };
  const relWs = f => path.relative(workspaceRoot, f);

  if (cust.overlay) {
    const proposed = 'replace the /libs overlay with per-component Rich Text configuration (rtePlugins / uiSettings / htmlRules) in each affected cq:dialog; keep the overlay until every affected dialog is migrated and validated';
    const risk = `overlays ${cust.overlay.libsPath}; /libs is immutable in AEM as a Cloud Service and changes with product updates`;
    if (info.classification === 'custom-jsp-behavioral' || info.classification === 'unknown') {
      return { ...base, action: 'manual-review', proposed, risk, blockedReason: `${info.classification}: overlay script behavior has no proven supported replacement` };
    }
    return { ...base, action: 'needs-user-confirm', proposed, risk, blockedReason: 'affected components and the per-dialog equivalent must be confirmed before the overlay can be retired' };
  }
  if (info.classification === 'custom-jsp-ui') {
    return { ...base, action: 'needs-user-confirm', proposed: 'port the static JSP markup to HTL; keep the JSP until confirmed and validated', blockedReason: 'equivalence of JSP markup to a supported mapping is not proven', risk: 'rendering change' };
  }
  if (info.classification !== 'configuration-only') {
    return { ...base, action: 'manual-review', blockedReason: `${info.classification}: script behavior has no proven supported replacement`, risk: 'behavior loss if rewritten' };
  }
  if (cust.customRtePlugins.length || cust.clientlibs.length) {
    return { ...base, action: 'needs-user-confirm', blockedReason: 'custom RTE plugin or clientlib code has no supported mapping', risk: 'authoring behavior provided by custom code' };
  }
  const CONVERTER = { classic: 'convert-extjs', coral2: 'upgrade-coral2' };
  const handoff = info.legacyDialogs.map(d => ({ dialog: relWs(d.file), action: CONVERTER[d.kind] }));
  return {
    ...base,
    action: handoff.some(h => h.action === 'convert-extjs') ? 'handoff-convert-extjs' : 'handoff-upgrade-coral2',
    blockedReason: null,
    risk: 'Rich Text plugin configuration must survive the dialog conversion; re-check rtePlugins/uiSettings afterwards',
    handoff: {
      flow: 'references/legacy-ui/dialog/context.md',
      dialogs: handoff,
      note: 'the dialog converter owns the edit and its own confirmation; this flow changes nothing',
    },
  };
}

/** Component folders and product overlays with legacy Rich Text evidence (any app path). */
function discoverRichTextCandidates(workspaceRoot) {
  const candidates = [];
  const warnings = [];
  (function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) { warnings.push(`depth limit reached at ${path.relative(workspaceRoot, dir)}; deeper folders not scanned`); return; }
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const jcrPath = jcrPathOf(workspaceRoot, dir);
    if (jcrPath && PRODUCT_OVERLAY.test(jcrPath)) {
      const info = inspectRichTextCandidate(dir, { jcrPath });
      if (info.candidate) candidates.push({ absDir: dir, jcrPath, info });
      return;
    }
    if (es.some(e => e.name === '.content.xml') && isComponentDir(dir)) {
      const info = inspectRichTextCandidate(dir, { jcrPath });
      if (info.candidate) candidates.push({ absDir: dir, jcrPath, info });
    }
    for (const e of es) if (e.isDirectory() && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1);
  })(workspaceRoot, 0);
  return { candidates, warnings };
}

module.exports = { inspectRichTextCandidate, planRichText, discoverRichTextCandidates, analyzeJsp, jcrPathOf, PRODUCT_OVERLAY };
