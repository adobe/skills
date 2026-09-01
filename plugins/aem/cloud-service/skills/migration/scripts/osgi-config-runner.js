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

// AEM as a Cloud Service supported run-mode tokens. Custom tokens are
// unsupported; `preview` inherits from publish and cannot be declared.
const TIER_TOKENS = new Set(['author', 'publish']);
const ENV_TOKENS = new Set(['dev', 'stage', 'prod']);

// A run-mode-qualified config/install folder: `config` or `install` followed by
// one or more `.token` segments. Bare `config`/`install` (no suffix) does not
// match and is always valid.
const RUNMODE_FOLDER_RE = /^(config|install)((?:\.[a-z0-9-]+)+)$/i;

/**
 * Validate one OSGi config / bundle install folder name against the AEM CS
 * supported run-mode set and the tier-before-environment ordering rule.
 *
 * @param {string} folderName e.g. 'config.author.dev' or 'install.local'
 * @returns {null | {folder: string, runmode: string, reason: string}}
 *   null when valid (or not run-mode-qualified); otherwise the offending
 *   run-mode string (dot-joined) and a human-readable reason.
 */
function validateRunmodeFolder(folderName) {
  const m = RUNMODE_FOLDER_RE.exec(folderName);
  if (!m) return null; // bare config/install or not a config/install folder
  const tokens = m[2].slice(1).toLowerCase().split('.'); // drop leading dot
  const runmode = tokens.join('.');

  let tierCount = 0;
  let envCount = 0;
  let seenEnv = false;
  for (const tok of tokens) {
    if (TIER_TOKENS.has(tok)) {
      if (seenEnv) {
        return { folder: folderName, runmode,
          reason: `tier run mode '${tok}' must precede the environment run mode` };
      }
      tierCount += 1;
    } else if (ENV_TOKENS.has(tok)) {
      envCount += 1;
      seenEnv = true;
    } else {
      return { folder: folderName, runmode, reason: `unsupported run mode token '${tok}'` };
    }
  }
  if (tierCount > 1) return { folder: folderName, runmode, reason: 'more than one tier run mode' };
  if (envCount > 1) return { folder: folderName, runmode, reason: 'more than one environment run mode' };
  return null;
}

// A folder whose name is run-mode-qualified (`config.<x>` / `install.<x>`).
const RUNMODE_QUALIFIED_DIR_RE = /^(config|install)\./i;

/** Recursively collect run-mode-qualified folder paths. Skips build/vcs dirs. */
function collectRunmodeFolders(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (RUNMODE_QUALIFIED_DIR_RE.test(e.name)) acc.push(full);
    collectRunmodeFolders(full, acc);
  }
  return acc;
}

/**
 * Scan a workspace for URC (Unsupported Run modes Configuration): OSGi
 * `config.<runmode>` and bundle `install.<runmode>` folders whose run mode is
 * not supported on AEM as a Cloud Service. Flag-only — never modifies anything.
 * Local fallback for when no BPA report is available.
 *
 * @returns {{ ok: boolean, findings: Array, rawFindings: Array, error?: string }}
 */
function scanUnsupportedRunmodes(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], error: 'no workspaceRoot' };
  let folders;
  try { folders = collectRunmodeFolders(workspaceRoot); }
  catch (err) { return { ok: false, findings: [], rawFindings: [], error: err.message }; }

  const findings = [];
  const rawFindings = [];
  for (const folder of folders) {
    const bad = validateRunmodeFolder(path.basename(folder));
    if (!bad) continue;
    findings.push({
      location: folder,
      detail: `unsupported-runmode — folder '${path.basename(folder)}' (${bad.reason}); rename to a supported run mode or remove`,
      severity: 'high',
    });
    rawFindings.push({
      pattern: 'osgiConfig',
      file: folder,
      line: null,
      snippet: `unsupported run mode '${bad.runmode}'`,
      kind: 'unsupported-runmode',
      runmode: bad.runmode,
    });
  }
  return { ok: true, findings, rawFindings };
}

/**
 * If `folderName` is a pure ordering violation — every token a known tier/env,
 * at most one of each, currently out of canonical `<prefix>.<tier>.<env>` order —
 * return the corrected basename. Otherwise (valid, unknown token, or duplicate
 * tier/env) return null. Deterministic and side-effect free.
 *
 * @returns {null | {from: string, to: string}}
 */
function reorderRunmodeFolder(folderName) {
  const m = RUNMODE_FOLDER_RE.exec(folderName);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const tokens = m[2].slice(1).toLowerCase().split('.');
  const tiers = tokens.filter(t => TIER_TOKENS.has(t));
  const envs = tokens.filter(t => ENV_TOKENS.has(t));
  if (tiers.length + envs.length !== tokens.length) return null; // unknown token(s)
  if (tiers.length > 1 || envs.length > 1) return null;          // duplicate tier/env
  const canonical = [prefix, ...tiers, ...envs].join('.');
  if (canonical === folderName.toLowerCase()) return null;       // already valid
  return { from: folderName, to: canonical };
}

/**
 * Plan safe auto-reorder fixes across a workspace. READ-ONLY: writes nothing.
 * For each ordering-only violation whose target folder does not already exist,
 * emits a `git mv` command (paths relative to `workspaceRoot`) that the Branch A
 * apply runs to perform the reorder. Unknown tokens, duplicate tier/env, and
 * collisions (target already exists — renaming would change PID resolution) are
 * routed to `manual` for the handoff cleanup array.
 *
 * @param {string} workspaceRoot
 * @returns {{ ok: boolean, reorders: Array, manual: Array, error?: string }}
 */
function planRunmodeReorders(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, reorders: [], manual: [], error: 'no workspaceRoot' };
  let folders;
  try { folders = collectRunmodeFolders(workspaceRoot); }
  catch (err) { return { ok: false, reorders: [], manual: [], error: err.message }; }

  const reorders = [];
  const manual = [];
  for (const folder of folders) {
    const name = path.basename(folder);
    const bad = validateRunmodeFolder(name);
    if (!bad) continue; // valid folder — nothing to fix
    const relFolder = path.relative(workspaceRoot, folder);
    const fix = reorderRunmodeFolder(name);
    if (!fix) { manual.push({ folder: relFolder, reason: `not auto-fixable (${bad.reason})` }); continue; }
    const targetAbs = path.join(path.dirname(folder), fix.to);
    const relTarget = path.relative(workspaceRoot, targetAbs);
    if (fs.existsSync(targetAbs)) {
      manual.push({ folder: relFolder, target: relTarget, reason: 'target folder already exists — manual merge required' });
      continue;
    }
    reorders.push({ from: relFolder, to: relTarget, command: `git mv "${relFolder}" "${relTarget}"` });
  }
  return { ok: true, reorders, manual };
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

module.exports = {
  runOsgiConfigScan, collectConfigFiles, SECRET_KEY_RE,
  validateRunmodeFolder, scanUnsupportedRunmodes,
  reorderRunmodeFolder, planRunmodeReorders,
};
