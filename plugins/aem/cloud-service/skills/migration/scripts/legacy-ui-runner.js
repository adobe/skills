/**
 * Legacy UI Runner
 *
 * The `content-scan` detection tier of the runbook for the **lui** (Classic UI
 * dialog) and **cdw** (Custom Design/Classic Widget) patterns. Mirrors the
 * discovery documented in `{migration}/references/legacy-ui/dialog/context.md`
 * and `.../cdw/context.md`.
 *
 * Pure-Node fs walk + attribute regex over `.content.xml` (no external tools).
 * Heuristic — not the BPA analyzer — so hits are candidate matches the agent
 * re-confirms in Branch D before converting.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// xtypes with a direct Coral 3 equivalent (dialog/context.md). Anything else on
// a cq:Widget is a custom widget → cdw.
const KNOWN_SAFE_XTYPES = new Set([
  'textfield', 'editfield', 'textarea', 'htmleditor', 'richtext', 'checkbox', 'selection',
  'combobox', 'pathfield', 'browsefield', 'smartfile', 'numberfield', 'datefield',
  'multifield', 'dialogfieldset', 'tabpanel', 'panel', 'hidden', 'colorfield', 'tags',
  'tagsfield', 'label', 'static', 'button', 'dialogbuttons', 'userpicker',
]);

/** Recursively collect `.content.xml` files, skipping vendor/build dirs. */
function collectContentXml(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
      collectContentXml(full, acc);
    } else if (e.isFile() && e.name === '.content.xml') {
      acc.push(full);
    }
  }
  return acc;
}

/** Read a file, returning '' on failure. */
function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/**
 * CDW — custom Classic UI widgets. Flags `xtype="…"` attributes whose value is
 * not a known-safe Coral 3 equivalent. One finding per (file, custom xtype).
 *
 * @returns {{ ok: boolean, findings: Array, rawFindings: Array, warnings: string[] }}
 */
function runCdwScan(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  const findings = [];
  const rawFindings = [];
  for (const file of collectContentXml(workspaceRoot)) {
    const content = read(file);
    if (!content.includes('xtype')) continue;
    const seen = new Set();
    const re = /xtype="([^"]+)"/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const xtype = m[1];
      if (KNOWN_SAFE_XTYPES.has(xtype) || seen.has(xtype)) continue;
      seen.add(xtype);
      findings.push({
        location: file,
        detail: `custom-xtype '${xtype}' — no direct Coral 3 equivalent; scaffold a Granite UI component`,
        severity: 'high',
      });
      rawFindings.push({ pattern: 'cdw', file, line: null, snippet: `xtype="${xtype}"`, xtype });
    }
  }
  return { ok: true, findings, rawFindings, warnings: [] };
}

/**
 * LUI — Classic UI / Coral 2 dialogs. Flags:
 *   - `legacy.dialog.classic`: a Classic dialog node (`jcr:primaryType="cq:Dialog"`
 *     or `xtype="dialog"`).
 *   - `legacy.dialog.coral2`: a Touch dialog using Coral 2 resourceTypes
 *     (`granite/ui/components/foundation/…` without the Coral 3 `.../coral/…`).
 * One finding per (file, sub-type).
 *
 * @returns {{ ok: boolean, findings: Array, rawFindings: Array, warnings: string[] }}
 */
function runLuiScan(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  const findings = [];
  const rawFindings = [];
  for (const file of collectContentXml(workspaceRoot)) {
    const content = read(file);

    const isClassic = /jcr:primaryType="cq:Dialog"/.test(content) || /xtype="dialog"/.test(content);
    const usesFoundation = content.includes('granite/ui/components/foundation/');
    const usesCoral3 = content.includes('granite/ui/components/coral/');
    const isCoral2 = usesFoundation && !usesCoral3;

    if (isClassic) {
      findings.push({ location: file, detail: 'legacy.dialog.classic — Classic UI dialog; convert to Coral 3 (Touch UI)', severity: 'high' });
      rawFindings.push({ pattern: 'lui', file, line: null, snippet: 'Classic UI dialog', subType: 'legacy.dialog.classic' });
    }
    if (isCoral2) {
      findings.push({ location: file, detail: 'legacy.dialog.coral2 — Coral 2 resourceTypes; upgrade to Coral 3', severity: 'high' });
      rawFindings.push({ pattern: 'lui', file, line: null, snippet: 'Coral 2 dialog', subType: 'legacy.dialog.coral2' });
    }
  }
  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { runLuiScan, runCdwScan, collectContentXml, KNOWN_SAFE_XTYPES };
