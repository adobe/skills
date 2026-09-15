/**
 * Vault Package Dependencies Scan Runner
 *
 * The `pom-scan` detection tier of the runbook cascade for the
 * **vault-package-dependencies** pattern — legacy AEM 6.x Vault install-time
 * `<dependencies>` declared inside the vault package plugin's `<configuration>`
 * (either `content-package-maven-plugin` or the modern
 * `filevault-package-maven-plugin`) that CRX refuses to resolve on AEM as a
 * Cloud Service (`day/cq60/*`, `day/cq560/*`, `adobe/cq60`).
 *
 * There is no BPA subtype for this pattern at all — a `pom.xml` install-time
 * dependency declaration is invisible to a deployed-artifact BPA scan — so
 * this scan is the **only** detection tier (no cascade, no analyzer fallback).
 *
 * Detection strategy: ask Maven for the **effective POM** via
 * `mvn help:effective-pom` and scan that, rather than reasoning about
 * `<pluginManagement>` inheritance and per-execution `<configuration>`
 * merging textually against the raw source pom. Maven does the resolution
 * work; we only look at the resolved output.
 *
 * Source-pom line reporting: after a legacy block is detected in the
 * effective POM, the runner searches the customer's own `pom.xml` for the
 * offending `<group>` tag to report an actionable line. If the block was
 * inherited from a parent pom and doesn't appear in the source, the finding
 * is reported with line 1 and marked `(inherited)` in the snippet.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Group-path prefixes whose packages don't exist on AEMaaCS.
const LEGACY_PREFIXES = ['day/cq60/', 'day/cq560/', 'adobe/cq60'];

// Both artifactIds package the same install-time <dependencies> mechanism.
// Modern migrated projects use filevault-package-maven-plugin, so both must
// be matched or those poms' legacy blocks are silently skipped.
const PLUGIN_ARTIFACTS = ['content-package-maven-plugin', 'filevault-package-maven-plugin'];

function isLegacyGroup(group) {
  if (!group) return false;
  return LEGACY_PREFIXES.some(p => group.startsWith(p) || group === p.replace(/\/$/, ''));
}

/** Recursively collect Maven project roots (dirs containing a `pom.xml`). */
function collectMavenProjectRoots(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  const hasPom = entries.some((e) => e.isFile() && e.name === 'pom.xml');
  if (hasPom) acc.push(dir);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
    collectMavenProjectRoots(path.join(dir, e.name), acc);
  }
  return acc;
}

/** 1-indexed line number of `index` within `content`. */
function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

/**
 * Ask Maven to emit the effective POM for `projectDir`. This resolves parent
 * inheritance, `<pluginManagement>` merging, and per-execution vs plugin-level
 * `<configuration>` — the three classes of ambiguity we no longer have to
 * reason about textually.
 *
 * Requires `mvn` on PATH and (usually) network-reachable dependencies to
 * resolve the parent chain. Returns `{ ok: true, xml }` on success, or
 * `{ ok: false, error }` with the tail of the Maven output.
 */
function getEffectivePom(projectDir) {
  const pom = path.join(projectDir, 'pom.xml');
  if (!fs.existsSync(pom)) return { ok: false, error: `no pom.xml at ${projectDir}` };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-eff-'));
  const outFile = path.join(tmpDir, 'effective-pom.xml');
  try {
    execFileSync('mvn', ['-q', '-B', '-N', 'help:effective-pom', `-Doutput=${outFile}`],
      { cwd: projectDir, stdio: 'pipe', encoding: 'utf8' });
    const xml = fs.readFileSync(outFile, 'utf8');
    return { ok: true, xml };
  } catch (err) {
    const combined = String(err.stdout || '') + String(err.stderr || err.message || '');
    return { ok: false, error: combined.trim().split('\n').slice(-8).join('\n') };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Find every legacy `<dependencies>` block inside a vault package plugin's
 * plugin-level `<configuration>` in the given effective POM XML.
 *
 * The effective POM has already merged `<pluginManagement>` inheritance and
 * separated per-execution configs from plugin-level configs, so this scan
 * only needs to look at each `<plugin>` occurrence's direct
 * `<configuration>` (everything before `<executions>` inside the plugin).
 *
 * Profile-scoped plugins live under `<profiles><profile><build><plugins>` and
 * appear as separate `<plugin>` occurrences here — no special handling
 * needed since we iterate every artifactId match in the whole document.
 *
 * @returns {Array<{block: string, artifact: string}>}
 */
function findVaultDependenciesInEffectivePom(effectiveXml) {
  const occurrences = [];
  for (const artifact of PLUGIN_ARTIFACTS) {
    const needle = `<artifactId>${artifact}</artifactId>`;
    let from = 0;
    for (;;) {
      const idx = effectiveXml.indexOf(needle, from);
      if (idx === -1) break;
      occurrences.push({ artifactIdx: idx, artifact });
      from = idx + needle.length;
    }
  }
  occurrences.sort((a, b) => a.artifactIdx - b.artifactIdx);

  const results = [];
  for (const { artifactIdx, artifact } of occurrences) {
    const pluginStart = effectiveXml.lastIndexOf('<plugin>', artifactIdx);
    const pluginEnd = effectiveXml.indexOf('</plugin>', artifactIdx);
    if (pluginStart === -1 || pluginEnd === -1) continue;
    const pluginBlock = effectiveXml.slice(pluginStart, pluginEnd);

    // Plugin-level <configuration> is anything before <executions>. Per-
    // execution configs live under <executions> and don't own install-time
    // <dependencies> — those are a plugin-level concern.
    const executionsAt = pluginBlock.indexOf('<executions>');
    const pluginLevel = executionsAt === -1 ? pluginBlock : pluginBlock.slice(0, executionsAt);

    const configStart = pluginLevel.indexOf('<configuration>');
    const configEnd = pluginLevel.indexOf('</configuration>', configStart);
    if (configStart === -1 || configEnd === -1) continue;
    const configBlock = pluginLevel.slice(configStart, configEnd);

    const depsStart = configBlock.indexOf('<dependencies>');
    const depsEnd = configBlock.indexOf('</dependencies>');
    if (depsStart === -1 || depsEnd === -1) continue;

    results.push({ block: configBlock.slice(depsStart, depsEnd), artifact });
  }
  return results;
}

/**
 * Report the source `pom.xml` line where `legacyGroup` first appears. When
 * the block was inherited from a parent pom and the group isn't in the
 * source, returns `{ line: 1, inherited: true }` so the finding still has an
 * anchor the customer can open.
 */
function locateInSourcePom(sourceXml, legacyGroup) {
  const idx = sourceXml.indexOf(`<group>${legacyGroup}</group>`);
  if (idx === -1) return { line: 1, inherited: true };
  return { line: lineAt(sourceXml, idx), inherited: false };
}

/**
 * Scan Maven projects under `workspaceRoot` for legacy Vault install-time
 * package dependencies. Emits one finding per `<dependencies>` block (not
 * per `<dependency>` entry) — the fix removes the entire block.
 *
 * @param {string} workspaceRoot
 * @param {object} [opts]
 * @param {function(string): {ok: boolean, xml?: string, error?: string}} [opts.getEffectivePom]
 *        Injectable Maven effective-pom reader. Defaults to shelling out to
 *        `mvn help:effective-pom`; tests inject a stub that returns canned
 *        XML.
 * @returns {{
 *   ok: boolean,
 *   findings: Array<{location: string, detail: string, severity: string}>,
 *   rawFindings: Array<{pattern: string, file: string, line: number, snippet: string}>,
 *   warnings: string[],
 *   error?: string,
 * }}
 */
function runVaultPackageScan(workspaceRoot, opts = {}) {
  if (!workspaceRoot) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  }
  const readEffectivePom = opts.getEffectivePom || getEffectivePom;

  let projectRoots;
  try {
    projectRoots = collectMavenProjectRoots(workspaceRoot);
  } catch (err) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: err.message };
  }

  const findings = [];
  const rawFindings = [];
  const warnings = [];

  for (const projectDir of projectRoots) {
    const eff = readEffectivePom(projectDir);
    if (!eff.ok) {
      warnings.push(`${projectDir}: could not resolve effective pom (${eff.error})`);
      continue;
    }

    const blocks = findVaultDependenciesInEffectivePom(eff.xml);
    if (blocks.length === 0) continue;

    const pomFile = path.join(projectDir, 'pom.xml');
    let sourceXml;
    try { sourceXml = fs.readFileSync(pomFile, 'utf8'); } catch { sourceXml = ''; }

    for (const depsBlock of blocks) {
      const groupMatches = depsBlock.block.match(/<group>([^<]*)<\/group>/g) || [];
      const legacyGroup = groupMatches
        .map(m => m.replace(/<\/?group>/g, '').trim())
        .find(isLegacyGroup);
      if (!legacyGroup) continue;

      const { line, inherited } = locateInSourcePom(sourceXml, legacyGroup);
      const source = inherited ? ' (inherited)' : '';
      const snippet = `${depsBlock.artifact}: legacy Vault dependency group=${legacyGroup}${source}`;
      findings.push({ location: `${pomFile}:${line}`, detail: snippet, severity: 'high' });
      rawFindings.push({ pattern: 'vault-package-dependencies', file: pomFile, line, snippet });
    }
  }

  return { ok: true, findings, rawFindings, warnings };
}

module.exports = {
  runVaultPackageScan,
  isLegacyGroup,
  findVaultDependenciesInEffectivePom,
  getEffectivePom,
  collectMavenProjectRoots,
};
