/**
 * Template Scan Runner
 *
 * The `content-scan` detection tier of the runbook for the
 * **templateModernization** pattern — static templates that should become
 * editable templates. Mirrors the discovery in
 * `{migration}/references/template-modernization/template-modernization-context.md`
 * (static templates live under `**​/jcr_root/apps/<appId>/templates/*​/.content.xml`).
 *
 * Pure-Node fs walk (no external tools). Heuristic — the agent runs the full
 * per-template context → execute → validate pipeline (Branch C) to confirm and
 * modernize each one.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Recursively find static-template `.content.xml` files: a `.content.xml`
 * whose path contains `.../apps/<appId>/templates/<name>/.content.xml` and
 * whose content declares a `cq:Template` (the static-template marker).
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
      // Path shape: .../jcr_root/apps/<appId>/templates/<templateName>/.content.xml
      const parts = full.split(path.sep);
      const ti = parts.lastIndexOf('templates');
      const inAppsTemplates = ti > 0 && parts[ti - 2] === 'apps' && parts.length === ti + 3;
      if (!inAppsTemplates) continue;
      let content = '';
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (/jcr:primaryType="cq:Template"/.test(content)) acc.push(full);
    }
  }
  return acc;
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
  for (const file of collectStaticTemplates(workspaceRoot)) {
    const templateName = file.split(path.sep).slice(-2, -1)[0];
    findings.push({
      location: file,
      detail: `static-template '${templateName}' — modernize to an editable template (Branch C)`,
      severity: 'medium',
    });
    rawFindings.push({ pattern: 'templateModernization', file, line: null, snippet: 'static template (cq:Template)', subType: 'legacy.static.template' });
  }
  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { runTemplateScan, collectStaticTemplates };
