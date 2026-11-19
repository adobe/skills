/**
 * Rich Text overlay inspection (component level, read-only unless applyRichTextConversion).
 *
 * Structural detection only: a candidate is a `cq:Component` folder whose XML shows
 * Rich Text evidence. A render.jsp alone is never evidence. The single supported
 * mapping comes from references/legacy-ui/dialog/extjs-to-coral3.md:
 *   xtype htmleditor|richtext -> cq/gui/components/authoring/dialog/richtext
 *   + useFixedInlineToolbar="{Boolean}true", RTE plugin child nodes preserved.
 * Nothing else is converted; the JSP is never rewritten or deleted here.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RT_RESOURCE_TYPE = 'cq/gui/components/authoring/dialog/richtext';
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 6;
const SKIP = new Set(['node_modules', '.git', 'target', 'dist']);

const RT_REF = /sling:resource(?:Super)?Type="[^"]*richtext"/;
const RT_XTYPE = /xtype="(?:richtext|htmleditor)"/;
const RTE_CONFIG = /rtePlugins|uiSettings|htmlRules/;

function isComponentDir(dir) {
  return /jcr:primaryType="cq:Component"/.test(readText(path.join(dir, '.content.xml')) || '');
}

function readText(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
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

function inspectRichTextCandidate(absDir) {
  const files = listFiles(absDir);
  const xmlFiles = files.filter(f => f.endsWith('.xml'));
  const xmls = xmlFiles.map(f => ({ file: f, text: readText(f) })).filter(x => x.text !== null);
  const rtXml = xmls.filter(x => RT_REF.test(x.text) || RT_XTYPE.test(x.text) || (RTE_CONFIG.test(x.text) && /richtext|htmleditor/.test(x.text)));
  const evidence = [];
  if (!rtXml.length) return { candidate: false, evidence };

  const rel = f => path.relative(absDir, f);
  const jspFile = files.find(f => path.basename(f) === 'render.jsp');
  const config = rtXml.filter(x => RTE_CONFIG.test(x.text)).map(x => rel(x.file));
  const toolbar = [...new Set(rtXml.flatMap(x => [...x.text.matchAll(/<(\w+)\s[^>]*?(?:features|toolbar)="([^"]*)"/g)].map(m => `${m[1]}:${m[2]}`)))];
  const clientlibs = [];
  for (const x of xmls) if (/extraClientlibs|clientlib|categories=/.test(x.text)) clientlibs.push(rel(x.file));
  if (files.some(f => path.basename(f) === '.content.xml' && /cq:ClientLibraryFolder/.test(readText(f) || ''))) clientlibs.push('adjacent clientlib folder');
  const jspText = jspFile ? readText(jspFile) : undefined;
  if (jspText && /clientlib/i.test(jspText)) clientlibs.push('render.jsp');
  const jsp = jspFile
    ? analyzeJsp(jspText, inc => fs.existsSync(path.resolve(path.dirname(jspFile), inc)))
    : null;

  evidence.push(`rich text reference/xtype in ${rtXml.map(x => rel(x.file)).join(', ')}`);
  if (config.length) evidence.push('declarative RTE configuration');
  if (jspFile) evidence.push('render.jsp present (supporting only)');

  const convertible = rtXml.filter(x => xtypeConversions(x.text).length).map(x => x.file);
  const toolbarConflictFiles = rtXml.filter(x => toolbarConflicts(x.text).length).map(x => rel(x.file));
  const customizations = {
    richTextTypes: [...new Set(rtXml.flatMap(x => [...x.text.matchAll(/sling:resource(?:Super)?Type="([^"]*richtext)"/g)].map(m => m[1])))],
    jsp: Boolean(jspFile), rteConfigFiles: config, toolbarFeatures: toolbar, clientlibs: [...new Set(clientlibs)], jspAnalysis: jsp,
  };

  let classification = 'configuration-only';
  if (jsp) {
    const behavioral = jsp.imports.length || jsp.scriptlets || jsp.conditions.length || jsp.serverAccess.length;
    if (behavioral) classification = 'custom-jsp-behavioral';
    else if (jsp.dynamic.length) classification = 'unknown';
    else classification = 'custom-jsp-ui';
  }
  return { candidate: true, evidence, classification, customizations, convertibleFiles: convertible, toolbarConflictFiles, jspFile: jspFile || null };
}

/** Elements with an exact-mapping xtype and no resourceType of their own. */
function xtypeConversions(text) {
  return [...text.matchAll(/<[\w:.-]+\s[^>]*?xtype="(?:richtext|htmleditor)"[^>]*>/g)].filter(m => !/sling:resourceType=/.test(m[0]));
}

/** Elements that already set useFixedInlineToolbar: adding it again would duplicate the attribute. */
function toolbarConflicts(text) {
  return xtypeConversions(text).filter(m => /\buseFixedInlineToolbar=/.test(m[0]));
}

function planRichText(info) {
  const base = { richtext: { classification: info.classification, customizations: info.customizations } };
  const cust = info.customizations;
  if (info.classification === 'configuration-only') {
    const blockedByLibs = cust.clientlibs.length > 0;
    if (info.toolbarConflictFiles && info.toolbarConflictFiles.length) {
      return { ...base, action: 'needs-user-confirm', blockedReason: `useFixedInlineToolbar already set in ${info.toolbarConflictFiles.join(', ')}; the supported mapping would overwrite an explicit value`, risk: 'explicit toolbar setting conflicts with the mapping', filesToChange: [] };
    }
    if (info.convertibleFiles.length && !blockedByLibs) {
      return { ...base, action: 'convert-richtext-xtype', blockedReason: null, risk: 'rewrites xtype to the supported Coral 3 richtext resourceType; RTE child nodes preserved', filesToChange: info.convertibleFiles };
    }
    if (!info.convertibleFiles.length && !blockedByLibs) {
      return { ...base, action: 'no-change', blockedReason: null, risk: 'already declarative; nothing to convert', filesToChange: [] };
    }
    return { ...base, action: 'needs-user-confirm', blockedReason: 'custom clientlib references need review', risk: 'clientlib behavior is not covered by a supported mapping', filesToChange: [] };
  }
  if (info.classification === 'custom-jsp-ui') {
    return { ...base, action: 'needs-user-confirm', proposed: 'replace JSP-rendered markup with the declarative richtext dialog mapping; keep render.jsp until confirmed and validated', blockedReason: 'equivalence of JSP markup to a supported mapping is not proven', risk: 'UI change', filesToChange: [] };
  }
  return { ...base, action: 'manual-review', blockedReason: `${info.classification}: JSP behavior has no proven supported replacement`, risk: 'behavior loss if rewritten', filesToChange: [] };
}

/** Find cq:Component folders (any depth, any app path) that carry Rich Text evidence. */
function discoverRichTextCandidates(workspaceRoot) {
  const out = [];
  (function walk(dir, depth) {
    if (depth > MAX_DEPTH + 6) return;
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const cx = path.join(dir, '.content.xml');
    if (es.some(e => e.name === '.content.xml') && /jcr:primaryType="cq:Component"/.test(readText(cx) || '')) {
      const info = inspectRichTextCandidate(dir);
      if (info.candidate) out.push({ absDir: dir, info });
    }
    for (const e of es) if (e.isDirectory() && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1);
  })(workspaceRoot, 0);
  return out;
}

/** Guarded conversion: exact mapping only, confirmed, files from the plan only; never touches JSP. */
function applyRichTextConversion(entry, workspaceRoot, userConfirmed) {
  if (!userConfirmed || entry.richtext?.classification !== 'configuration-only' || entry.action !== 'convert-richtext-xtype' || entry.blockedReason) {
    return { applied: [], skipped: 'not confirmed or not an automatic configuration-only conversion' };
  }
  const applied = [];
  for (const file of entry.filesToChange) {
    if (!file.endsWith('.xml')) continue;
    const abs = path.join(workspaceRoot, file);
    const text = fs.readFileSync(abs, 'utf8');
    const next = text.replace(/(<[\w:.-]+\s[^>]*?)xtype="(?:richtext|htmleditor)"([^>]*>)/g, (all, a, b) =>
      /sling:resourceType=|\buseFixedInlineToolbar=/.test(all) ? all : `${a}sling:resourceType="${RT_RESOURCE_TYPE}" useFixedInlineToolbar="{Boolean}true"${b}`);
    if (next !== text) { fs.writeFileSync(abs, next); applied.push(file); }
  }
  return { applied, skipped: null };
}

module.exports = { inspectRichTextCandidate, planRichText, discoverRichTextCandidates, applyRichTextConversion, analyzeJsp, RT_RESOURCE_TYPE };
