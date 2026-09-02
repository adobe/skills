/**
 * Template Scan Runner
 *
 * The `content-scan` detection tier of the runbook for the
 * **templateModernization** pattern — static templates that should become
 * editable templates. Mirrors the discovery in
 * `{migration}/references/template-modernization/template-modernization-context.md`
 * (static templates live under any `jcr_root/apps/<appId>/templates/` subtree,
 * in a `.content.xml` that declares a `cq:Template`).
 *
 * Pure-Node fs walk (no external tools). Heuristic — the agent runs the full
 * per-template context → execute → validate pipeline (Branch C) to confirm and
 * modernize each one.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Page-component resource types that mark a static template as legacy/OOTB-derived
// rather than a project-authored custom template. Mirrors the BPA distinction
// between `legacy.static.template` and `custom.static.template`.
const LEGACY_RT_PREFIXES = [
  'wcm/foundation',
  'foundation/components',
  'wcm/core/components',
  'cq/',
  'geometrixx',
];

/**
 * Recursively find static-template `.content.xml` files: a `.content.xml`
 * that lives at any depth under an `apps/<appId>/templates/` folder (so
 * nested/grouped templates are not missed) and whose content declares a
 * `cq:Template` (the static-template marker).
 */
function collectStaticTemplates(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
      collectStaticTemplates(full, acc);
    } else if (e.isFile() && e.name === '.content.xml') {
      // Path shape: .../jcr_root/apps/<appId>/templates/.../<templateName>/.content.xml
      // Anchor on `apps/<appId>/templates/` but allow any nesting below it — the
      // `cq:Template` content check below is what actually confirms a template,
      // so we don't need an exact depth clamp (which dropped nested templates).
      const parts = full.split(path.sep);
      const ti = parts.lastIndexOf('templates');
      const inAppsTemplates =
        ti > 0 && parts[ti - 2] === 'apps' && parts.length >= ti + 3;
      if (!inAppsTemplates) continue;
      let content = '';
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (/jcr:primaryType="cq:Template"/.test(content)) acc.push({ file: full, content });
    }
  }
  return acc;
}

/**
 * Classify a static template as `custom.static.template` (project-authored) or
 * `legacy.static.template` (OOTB/foundation-derived) from its page-component
 * resource type. Heuristic: a template whose page component points at a
 * foundation/OOTB ancestor is legacy; anything else authored under the
 * project's own `apps/<appId>` tree defaults to custom.
 *
 * @returns {'custom.static.template' | 'legacy.static.template'}
 */
function classifyStaticTemplate(content) {
  const xml = content || '';
  // Only the page component on the template's own `jcr:content` node is a
  // reliable signal. Scanning any resourceType in the file would pick up a
  // descendant (e.g. a foundation parsys) and misclassify an otherwise-custom
  // template as legacy, so when jcr:content declares no resourceType we default
  // to custom (the template lives under the project's own apps/<appId> tree).
  const m = /<jcr:content\b[^>]*\bsling:resourceType="([^"]+)"/.exec(xml);
  const rt = m ? m[1].replace(/^\/(?:apps|libs)\//, '') : '';
  if (rt && LEGACY_RT_PREFIXES.some((p) => rt.startsWith(p))) {
    return 'legacy.static.template';
  }
  return 'custom.static.template';
}

/**
 * Scan for static templates under `workspaceRoot`.
 *
 * @returns {{ ok: boolean, findings: Array, rawFindings: Array, warnings: string[] }}
 */
function runTemplateScan(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  const findings = [];
  const rawFindings = [];
  for (const { file, content } of collectStaticTemplates(workspaceRoot)) {
    const templateName = file.split(path.sep).slice(-2, -1)[0];
    const subType = classifyStaticTemplate(content);
    const kind = subType === 'custom.static.template' ? 'custom' : 'legacy';
    findings.push({
      location: file,
      detail: `${kind} static-template '${templateName}' — modernize to an editable template (Branch C)`,
      severity: 'medium',
    });
    rawFindings.push({ pattern: 'templateModernization', file, line: null, snippet: `static template (cq:Template, ${kind})`, subType });
  }
  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { runTemplateScan, collectStaticTemplates, classifyStaticTemplate };
