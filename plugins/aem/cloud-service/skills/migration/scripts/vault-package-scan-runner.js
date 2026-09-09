/**
 * Vault Package Dependencies Scan Runner
 *
 * The `pom-scan` detection tier of the runbook cascade for the
 * **vault-package-dependencies** pattern — legacy AEM 6.x Vault install-time
 * `<dependencies>` declared inside `content-package-maven-plugin`'s
 * `<configuration>` that CRX refuses to resolve on AEM as a Cloud Service
 * (`day/cq60/*`, `day/cq560/*`, `adobe/cq60`).
 *
 * There is no BPA subtype for this pattern at all — a `pom.xml` install-time
 * dependency declaration is invisible to a deployed-artifact BPA scan — so
 * this scan is the **only** detection tier (no cascade, no analyzer fallback).
 *
 * Implemented as a pure-Node fs walk + regex scan, mirroring `htl-lint-runner.js`:
 * a real XML/DOM parser is not available in this dependency-free script
 * environment, so scoping is done textually — locate the
 * `content-package-maven-plugin` block, then its `<configuration>`, then its
 * `<dependencies>` — narrowing at each step so an unrelated top-level
 * `<dependencies>` (regular Maven deps) is never matched.
 *
 * This is a **heuristic** detector: re-confirm each hit before editing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Group-path prefixes whose packages don't exist on AEMaaCS.
const LEGACY_PREFIXES = ['day/cq60/', 'day/cq560/', 'adobe/cq60'];

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
 * Find the `content-package-maven-plugin` <plugin> block's <configuration>
 * <dependencies> substring, or null if this pom has no such plugin/config.
 * Assumes non-nested <plugin>/<configuration> tags, true for Maven poms.
 */
function findVaultDependenciesBlock(content) {
  const artifactIdx = content.indexOf('<artifactId>content-package-maven-plugin</artifactId>');
  if (artifactIdx === -1) return null;

  const pluginStart = content.lastIndexOf('<plugin>', artifactIdx);
  const pluginEnd = content.indexOf('</plugin>', artifactIdx);
  if (pluginStart === -1 || pluginEnd === -1) return null;
  const pluginBlock = content.slice(pluginStart, pluginEnd);

  const configStart = pluginBlock.indexOf('<configuration>');
  const configEnd = pluginBlock.indexOf('</configuration>');
  if (configStart === -1 || configEnd === -1) return null;
  const configBlock = pluginBlock.slice(configStart, configEnd);

  const depsStart = configBlock.indexOf('<dependencies>');
  const depsEnd = configBlock.indexOf('</dependencies>');
  if (depsStart === -1 || depsEnd === -1) return null;

  return { block: configBlock.slice(depsStart, depsEnd), artifactIdx };
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

    const depsBlock = findVaultDependenciesBlock(content);
    if (!depsBlock) continue;

    const groupMatches = depsBlock.block.match(/<group>([^<]*)<\/group>/g) || [];
    const legacyGroup = groupMatches
      .map(m => m.replace(/<\/?group>/g, '').trim())
      .find(isLegacyGroup);
    if (!legacyGroup) continue;

    const line = lineAt(content, depsBlock.artifactIdx);
    const snippet = `content-package-maven-plugin: legacy Vault dependency group=${legacyGroup}`;
    findings.push({ location: `${file}:${line}`, detail: snippet, severity: 'high' });
    rawFindings.push({ pattern: 'vault-package-dependencies', file, line, snippet });
  }

  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { runVaultPackageScan, collectPomFiles, isLegacyGroup, findVaultDependenciesBlock };
