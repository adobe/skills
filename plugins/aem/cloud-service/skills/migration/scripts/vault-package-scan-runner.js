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
 * Implemented as a pure-Node fs walk + regex scan, mirroring `htl-lint-runner.js`:
 * a real XML/DOM parser is not available in this dependency-free script
 * environment, so scoping is done textually — locate the vault package plugin
 * block, then its `<configuration>`, then its `<dependencies>` — narrowing at
 * each step so an unrelated top-level `<dependencies>` (regular Maven deps) is
 * never matched.
 *
 * This is a **heuristic** detector: re-confirm each hit before editing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Group-path prefixes whose packages don't exist on AEMaaCS.
const LEGACY_PREFIXES = ['day/cq60/', 'day/cq560/', 'adobe/cq60'];

// Both artifactIds package the same install-time <dependencies> mechanism;
// modern migrated projects use filevault-package-maven-plugin, so both must
// be matched or those poms' legacy blocks are silently skipped.
const PLUGIN_ARTIFACTS = ['content-package-maven-plugin', 'filevault-package-maven-plugin'];

function isLegacyGroup(group) {
  if (!group) return false;
  return LEGACY_PREFIXES.some(p => group.startsWith(p) || group === p.replace(/\/$/, ''));
}

/** Recursively collect `pom.xml` files under `dir`, skipping heavy/vendor dirs. */
function collectPomFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
      collectPomFiles(full, acc);
    } else if (e.isFile() && e.name === 'pom.xml') {
      acc.push(full);
    }
  }
  return acc;
}

/** 1-indexed line number of `index` within `content`. */
function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

/**
 * Find every vault package plugin occurrence in `content` and return the
 * `<configuration><dependencies>…</dependencies>` substring for each one that
 * has one. Matches either `content-package-maven-plugin` or
 * `filevault-package-maven-plugin`, and iterates so occurrences under
 * `<pluginManagement>`, `<build>`, and `<profiles>` are all considered — the
 * reference doc says the plugin can appear in more than one section.
 *
 * Assumes non-nested <plugin> tags (true for Maven poms).
 */
function findVaultDependenciesBlocks(content) {
  const occurrences = [];
  for (const artifact of PLUGIN_ARTIFACTS) {
    const needle = `<artifactId>${artifact}</artifactId>`;
    let from = 0;
    for (;;) {
      const idx = content.indexOf(needle, from);
      if (idx === -1) break;
      occurrences.push({ artifactIdx: idx, artifact });
      from = idx + needle.length;
    }
  }
  occurrences.sort((a, b) => a.artifactIdx - b.artifactIdx);

  const results = [];
  for (const { artifactIdx, artifact } of occurrences) {
    const pluginStart = content.lastIndexOf('<plugin>', artifactIdx);
    const pluginEnd = content.indexOf('</plugin>', artifactIdx);
    if (pluginStart === -1 || pluginEnd === -1) continue;
    const pluginBlock = content.slice(pluginStart, pluginEnd);

    // Walk every <configuration> block within the plugin — a per-<execution>
    // <configuration> can appear BEFORE the plugin-level one, so grabbing only
    // the first one would truncate the search and miss the real <dependencies>.
    let cursor = 0;
    for (;;) {
      const configStart = pluginBlock.indexOf('<configuration>', cursor);
      if (configStart === -1) break;
      const configEnd = pluginBlock.indexOf('</configuration>', configStart);
      if (configEnd === -1) break;
      const configBlock = pluginBlock.slice(configStart, configEnd);
      cursor = configEnd + '</configuration>'.length;

      const depsStart = configBlock.indexOf('<dependencies>');
      const depsEnd = configBlock.indexOf('</dependencies>');
      if (depsStart === -1 || depsEnd === -1) continue;

      // Absolute offset of the <dependencies> open tag in `content`, so the
      // caller can report the block's own line instead of the plugin's
      // <artifactId> line (which can be far away in a large pom).
      const depsIdx = pluginStart + configStart + depsStart;
      results.push({ block: configBlock.slice(depsStart, depsEnd), artifactIdx, depsIdx, artifact });
    }
  }
  return results;
}

/**
 * Scan `pom.xml` files under `workspaceRoot` for legacy Vault install-time
 * package dependencies. Emits one finding per `<dependencies>` block (not
 * per `<dependency>` entry) — the fix removes the entire block.
 *
 * @returns {{
 *   ok: boolean,
 *   findings: Array<{location: string, detail: string, severity: string}>,
 *   rawFindings: Array<{pattern: string, file: string, line: number, snippet: string}>,
 *   warnings: string[],
 *   error?: string,
 * }}
 */
function runVaultPackageScan(workspaceRoot) {
  if (!workspaceRoot) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  }

  let files;
  try {
    files = collectPomFiles(workspaceRoot);
  } catch (err) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: err.message };
  }

  const findings = [];
  const rawFindings = [];
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

    // One finding per <dependencies> block, not per file — a pom can declare
    // the plugin under <pluginManagement>, <build>, and <profiles>.
    for (const depsBlock of findVaultDependenciesBlocks(content)) {
      const groupMatches = depsBlock.block.match(/<group>([^<]*)<\/group>/g) || [];
      const legacyGroup = groupMatches
        .map(m => m.replace(/<\/?group>/g, '').trim())
        .find(isLegacyGroup);
      if (!legacyGroup) continue;

      const line = lineAt(content, depsBlock.depsIdx);
      const snippet = `${depsBlock.artifact}: legacy Vault dependency group=${legacyGroup}`;
      findings.push({ location: `${file}:${line}`, detail: snippet, severity: 'high' });
      rawFindings.push({ pattern: 'vault-package-dependencies', file, line, snippet });
    }
  }

  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { runVaultPackageScan, collectPomFiles, isLegacyGroup, findVaultDependenciesBlocks };
