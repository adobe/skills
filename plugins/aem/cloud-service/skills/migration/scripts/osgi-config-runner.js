/**
 * OSGi Config Runner
 *
 * The `config-scan` detection tier of the runbook cascade for the **osgiConfig**
 * pattern — OSGi configuration values that should move to Cloud Manager
 * environment secrets / variables. Mirrors the scan documented in
 * `{migration}/references/osgi-cfg-json-cloud-manager.md`.
 *
 * This is a **heuristic, review-only** detector. It performs the cheap,
 * deterministic part — finding config files and flagging secret-looking keys
 * and `$[secret:]`/`$[env:]` placeholders — and defers all classification
 * (is this really a secret? Adobe-owned PID?) to apply time. Findings are
 * tagged `confidence: 'heuristic'`, `needsReview: true` by the caller.
 *
 * HARD SAFETY RULE: this detector never emits a secret *value*. It reports
 * only the file path, the key *name*, and a `kind` label. The runbook is a
 * file written to disk (often committed), so leaking a plaintext secret into
 * it would defeat the entire migration.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Keys whose plaintext string values are likely secrets and should move to
// `$[secret:…]`. Matched case-insensitively against the JSON property name.
const SECRET_KEY_RE = /(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|client[-_]?secret)/i;

// A value already using a Cloud Manager placeholder — not actionable, just
// informational ("already templated correctly").
const PLACEHOLDER_RE = /\$\[(secret|env):/;

// repoinit files: placeholders are not allowed there, so we do not flag
// secret keys for placeholder injection (see osgi-cfg-json-cloud-manager.md).
const REPOINIT_RE = /RepositoryInitializer/i;

// An OSGi config folder is `config` or a runmode variant `config.<runmode>`
// (e.g. config.author.dev). Matches the whole segment — not any segment merely
// starting with "config" (which would catch e.g. `configuration`).
const CONFIG_FOLDER_RE = /^config(\.[a-z0-9-]+)*$/i;

/** True if any path segment is a `config` / `config.<runmode>` folder. */
function inConfigFolder(filePath) {
  return filePath.split(path.sep).some(seg => CONFIG_FOLDER_RE.test(seg));
}

const CFG_JSON_RE = /\.cfg\.json$/i;
const LEGACY_RE = /\.(cfg|config)$/i;

/** Recursively collect candidate config files under `dir`. Skips node_modules/.git/target. */
function collectConfigFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
      collectConfigFiles(full, acc);
    } else if (e.isFile()) {
      if (!inConfigFolder(full)) continue;
      if (CFG_JSON_RE.test(e.name) || LEGACY_RE.test(e.name)) acc.push(full);
    }
  }
  return acc;
}

/**
 * Extract **every** `"key": "value"` string property on a line, returning each
 * key name and whether its value is already a placeholder — NEVER the value
 * itself. Uses a global match so compact / multi-property lines (legal for
 * `.cfg.json`, which is JSON) don't hide secrets after the first pair.
 */
function scanCfgJsonLine(line) {
  const re = /"([^"]+)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  const pairs = [];
  let m;
  while ((m = re.exec(line)) !== null) {
    pairs.push({ key: m[1], isPlaceholder: PLACEHOLDER_RE.test(m[2]) });
  }
  return pairs;
}

/**
 * Scan config files under `workspaceRoot`.
 *
 * @returns {{
 *   ok: boolean,
 *   findings: Array<{location: string, detail: string, severity: string}>,
 *   rawFindings: Array<{pattern: string, file: string, line: number|null, snippet: string, kind: string}>,
 *   warnings: string[],
 *   error?: string,
 * }}
 */
function runOsgiConfigScan(workspaceRoot, options = {}) {
  if (!workspaceRoot) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  }

  let files;
  try {
    files = collectConfigFiles(workspaceRoot);
  } catch (err) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: err.message };
  }

  const findings = [];
  const rawFindings = [];
  const warnings = [];

  for (const file of files) {
    const isRepoinit = REPOINIT_RE.test(file);

    if (LEGACY_RE.test(file)) {
      // Legacy .cfg/.config → must be converted to .cfg.json (Phase 0).
      findings.push({
        location: file,
        detail: 'legacy-format — convert to .cfg.json (Phase 0)',
        severity: 'high',
      });
      rawFindings.push({ pattern: 'osgiConfig', file, line: null, snippet: 'legacy config format', kind: 'legacy-format' });
      continue;
    }

    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    let filePlaceholdered = false;

    lines.forEach((line, i) => {
      for (const { key, isPlaceholder } of scanCfgJsonLine(line)) {
        if (isPlaceholder) { filePlaceholdered = true; continue; }
        if (isRepoinit) continue; // placeholders not allowed in repoinit — do not flag.
        if (SECRET_KEY_RE.test(key)) {
          // Report key NAME and location only — never the value.
          findings.push({
            location: `${file}:${i + 1}`,
            detail: `plaintext-secret — key '${key}' should move to $[secret:…]`,
            severity: 'high',
          });
          rawFindings.push({
            pattern: 'osgiConfig',
            file,
            line: i + 1,
            snippet: `"${key}": <redacted>`,
            kind: 'plaintext-secret',
          });
        }
      }
    });

    if (filePlaceholdered) {
      findings.push({
        location: file,
        detail: 'already-placeholdered — uses $[secret:]/$[env:] (informational)',
        severity: 'info',
        informational: true, // already migrated — does not count as outstanding work
      });
      rawFindings.push({ pattern: 'osgiConfig', file, line: null, snippet: 'uses $[secret:]/$[env:]', kind: 'already-placeholdered', informational: true });
    }
  }

  // XML sling:OsgiConfig nodes are in scope per the reference but are not
  // scanned deterministically here — only surface this limitation when the
  // project actually has config folders (otherwise it is noise).
  if (files.length > 0) {
    warnings.push('XML sling:OsgiConfig nodes are not scanned by this detector — review .content.xml config nodes manually.');
  }

  return { ok: true, findings, rawFindings, warnings };
}

module.exports = { runOsgiConfigScan, collectConfigFiles, SECRET_KEY_RE };
