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
 * Detection strategy — two paths:
 *
 *   1. Preferred: ask Maven for the **effective POM** via
 *      `mvn help:effective-pom`. This resolves parent inheritance,
 *      `<pluginManagement>` merging, and per-execution vs plugin-level
 *      `<configuration>` — the three classes of ambiguity we don't have to
 *      reason about textually. Runs **once per reactor root** (not per
 *      module) — the reactor invocation produces a single wrapper file
 *      containing every module's effective POM, avoiding N network-bound
 *      subprocesses. Requires `mvn` on PATH and, for legacy AEM 6.x/AMS
 *      codebases, resolvable parent poms (often network-reachable).
 *
 *   2. Fallback: when `mvn help:effective-pom` fails for a module (dead
 *      parent repo, missing artifacts, offline — the pattern's target
 *      audience is legacy projects that often can't build cleanly anymore),
 *      the runner text-scans the module's raw `pom.xml` as-is. This mirrors
 *      the pure-Node scan that predated the Maven delegation: coverage is
 *      degraded (inherited-only deps in a parent's `<pluginManagement>` are
 *      not detected without Maven merging them) but the scan is not silent —
 *      a `warnings[]` entry is emitted for every module that fell back so
 *      the customer sees the degradation.
 *
 * Scanner scope: `findVaultDependenciesInEffectivePom` skips any `<plugin>`
 * nested inside `<pluginManagement>`. The effective POM retains
 * pluginManagement blocks even after merging their configuration into
 * `<build><plugins>`, so scanning both would report the same block twice.
 *
 * Source-pom line reporting: after a legacy block is detected, the runner
 * searches the customer's own `pom.xml` for the offending `<group>` tag to
 * report an actionable line. If the block was inherited from a parent pom
 * and doesn't appear in the source, the finding is reported with line 1
 * and marked `(inherited)` in the snippet.
 *
 * Failure-mode contract: if the runner collects one or more Maven project
 * roots but produces **no scan target** for any of them (effective-POM
 * failed AND the raw pom.xml was unreadable), it returns `ok: false`. The
 * runbook dispatcher treats that as "pattern not scanned" and falls through
 * to the LLM-scan tier rather than reporting a clean bill of health.
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
 * Ask Maven to emit the effective POM for a single `projectDir` via
 * `mvn -N help:effective-pom`. Used only as the fallback when the reactor
 * bulk invocation didn't produce output for this module — normal scans go
 * through `getReactorEffectivePoms` and cost one mvn call per reactor, not
 * per module.
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
 * Ask Maven to emit effective POMs for every module in a reactor in a
 * single `mvn help:effective-pom` invocation (no `-N`). Maven writes one
 * output file that wraps every module's `<project>` in a `<projects>` root
 * element; this splits that file into a map keyed by each module's
 * artifactId so `runVaultPackageScan` can pair modules to their effective
 * POM without an additional mvn call per module.
 *
 * @returns {{ok: true, byArtifactId: Record<string, string>} | {ok: false, error: string}}
 */
function getReactorEffectivePoms(reactorRoot) {
  const pom = path.join(reactorRoot, 'pom.xml');
  if (!fs.existsSync(pom)) return { ok: false, error: `no pom.xml at ${reactorRoot}` };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-eff-reactor-'));
  const outFile = path.join(tmpDir, 'effective-pom.xml');
  try {
    execFileSync('mvn', ['-q', '-B', 'help:effective-pom', `-Doutput=${outFile}`],
      { cwd: reactorRoot, stdio: 'pipe', encoding: 'utf8' });
    const bulk = fs.readFileSync(outFile, 'utf8');
    return { ok: true, byArtifactId: splitReactorEffectivePom(bulk) };
  } catch (err) {
    const combined = String(err.stdout || '') + String(err.stderr || err.message || '');
    return { ok: false, error: combined.trim().split('\n').slice(-8).join('\n') };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Split a reactor `mvn help:effective-pom` output (a `<projects>`-wrapped
 * list of top-level `<project>` children, or a single `<project>` when only
 * one module) into per-module effective POM XML keyed by artifactId. The
 * artifactId picked is the FIRST `<artifactId>` in each `<project>` after
 * stripping any `<parent>` block.
 */
function splitReactorEffectivePom(bulkXml) {
  const byArtifactId = {};
  const re = /<project\b[\s\S]*?<\/project>/g;
  const projects = bulkXml.match(re) || [];
  for (const projectXml of projects) {
    const stripped = projectXml.replace(/<parent[\s\S]*?<\/parent>/g, '');
    const m = stripped.match(/<artifactId>([^<]+)<\/artifactId>/);
    if (m) byArtifactId[m[1].trim()] = projectXml;
  }
  return byArtifactId;
}

/**
 * Read the module's own artifactId from a raw source `pom.xml`. Returns
 * null if the file can't be read or no artifactId is declared (rare — an
 * artifactId is mandatory in a Maven project).
 */
function readSourceArtifactId(pomFile) {
  try {
    const xml = fs.readFileSync(pomFile, 'utf8');
    const withoutParent = xml.replace(/<parent[\s\S]*?<\/parent>/g, '');
    const m = withoutParent.match(/<artifactId>([^<]+)<\/artifactId>/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

/** True iff the source pom declares a `<modules>` list (reactor root). */
function isReactorRoot(projectDir) {
  try {
    const xml = fs.readFileSync(path.join(projectDir, 'pom.xml'), 'utf8');
    return /<modules>[\s\S]*?<module>[\s\S]*?<\/module>[\s\S]*?<\/modules>/.test(xml);
  } catch { return false; }
}

/**
 * Find every legacy `<dependencies>` block inside a vault package plugin's
 * plugin-level `<configuration>` in the given effective POM XML (also used
 * as the text-scan fallback against a raw source pom.xml).
 *
 * The effective POM has already merged `<pluginManagement>` inheritance and
 * separated per-execution configs from plugin-level configs, so this scan
 * only needs to look at each `<plugin>` occurrence's direct
 * `<configuration>` (everything before `<executions>` inside the plugin) —
 * AND must **skip** `<plugin>` entries nested under `<pluginManagement>`.
 * Maven retains pluginManagement blocks in the effective POM even after
 * merging their config into `<build><plugins>`; without this skip the same
 * block is reported once from pluginManagement and once from the merged
 * `<build><plugins>` entry.
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

    // Skip <plugin>s nested inside <pluginManagement>. The effective POM
    // retains pluginManagement blocks even after merging their config into
    // <build><plugins>, so without this the same block is reported twice.
    const pmStart = effectiveXml.lastIndexOf('<pluginManagement>', pluginStart);
    if (pmStart !== -1) {
      const pmEnd = effectiveXml.indexOf('</pluginManagement>', pmStart);
      if (pmEnd !== -1 && pmEnd > pluginEnd) continue;
    }

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
 * Preferred source for the scan is the effective POM (Maven has already
 * done pluginManagement / parent inheritance / per-execution config merging
 * for us). To keep this efficient the runner:
 *
 *   1. Groups project roots under reactor roots (a `pom.xml` declaring
 *      `<modules>`) and runs `mvn help:effective-pom` **once per reactor**,
 *      splitting the resulting `<projects>` file back into per-module XML.
 *   2. Falls back to `mvn -N help:effective-pom` per module for standalone
 *      poms not in any reactor, and for reactor members that the reactor
 *      bulk output didn't cover.
 *   3. Falls back to a raw text-scan of the source `pom.xml` for every
 *      module whose effective-POM resolution failed — legacy AEM 6.x/AMS
 *      projects frequently can't resolve a build anymore (dead repos,
 *      missing parents, offline). Text-scan is degraded (inherited-only
 *      pluginManagement config isn't visible without Maven), and every
 *      fallback emits a warning so the customer knows the scan was
 *      degraded rather than silently clean.
 *
 * If every project root produced no scan target (mvn failed AND the raw
 * pom.xml was unreadable), the runner returns `ok: false`. The runbook
 * dispatcher treats that as "pattern not scanned" and falls through to the
 * LLM-scan tier, so the user never sees "no vault-package findings" from a
 * scan that couldn't run at all.
 *
 * @param {string} workspaceRoot
 * @param {object} [opts]
 * @param {function(string): {ok: boolean, xml?: string, error?: string}} [opts.getEffectivePom]
 *        Injectable per-module Maven effective-pom reader. Defaults to
 *        shelling out to `mvn -N help:effective-pom`; tests inject a stub
 *        that returns canned XML. Injecting this also disables the reactor
 *        bulk path so unit tests don't need to stub two boundaries.
 * @param {function(string): {ok: boolean, byArtifactId?: object, error?: string}} [opts.getReactorEffectivePoms]
 *        Injectable reactor-wide Maven effective-pom reader. Defaults to
 *        `getReactorEffectivePoms`; overriding lets a caller test the
 *        reactor path without a real Maven runtime.
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
  const readReactor = opts.getReactorEffectivePoms || getReactorEffectivePoms;
  // If tests inject only a per-module reader, don't try the reactor path —
  // tests then don't need to stub two boundaries just to keep quiet.
  const reactorEnabled = !opts.getEffectivePom || !!opts.getReactorEffectivePoms;

  let projectRoots;
  try {
    projectRoots = collectMavenProjectRoots(workspaceRoot);
  } catch (err) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: err.message };
  }

  const findings = [];
  const rawFindings = [];
  const warnings = [];

  // effByProject maps absolute projectDir → effective (or raw-fallback) XML.
  const effByProject = new Map();

  // Group projects by reactor: the topmost projectRoot with <modules> claims
  // itself and every projectRoot underneath its directory.
  const reactorRoots = reactorEnabled ? projectRoots.filter(isReactorRoot) : [];
  reactorRoots.sort((a, b) => a.length - b.length);
  const claimed = new Set();
  const reactorGroups = [];
  for (const rr of reactorRoots) {
    if (claimed.has(rr)) continue;
    const members = projectRoots.filter(p => p === rr || p.startsWith(rr + path.sep));
    for (const m of members) claimed.add(m);
    reactorGroups.push({ root: rr, members });
  }

  // Reactor bulk pass — one mvn per reactor, split output per module.
  for (const { root, members } of reactorGroups) {
    const bulk = readReactor(root);
    if (!bulk.ok) {
      warnings.push(`${root}: reactor mvn help:effective-pom failed (${bulk.error}); falling back to per-module scan`);
      continue;
    }
    for (const m of members) {
      const artifactId = readSourceArtifactId(path.join(m, 'pom.xml'));
      if (artifactId && bulk.byArtifactId[artifactId]) {
        effByProject.set(m, bulk.byArtifactId[artifactId]);
      }
    }
  }

  // Per-module pass — anything not covered by a reactor bulk. This includes
  // standalone project dirs AND reactor members the bulk didn't emit for.
  for (const projectDir of projectRoots) {
    if (effByProject.has(projectDir)) continue;
    const eff = readEffectivePom(projectDir);
    if (eff.ok) { effByProject.set(projectDir, eff.xml); continue; }

    // Text-scan fallback: use the raw source pom as the scan target.
    // Legitimate for detecting blocks declared IN this pom; blind to
    // parent pluginManagement Maven would have merged in — that trade-off
    // is called out in the warning.
    try {
      const rawXml = fs.readFileSync(path.join(projectDir, 'pom.xml'), 'utf8');
      warnings.push(`${projectDir}: mvn help:effective-pom failed (${eff.error}); text-scanning raw pom.xml (inherited pluginManagement will not be detected)`);
      effByProject.set(projectDir, rawXml);
    } catch (readErr) {
      warnings.push(`${projectDir}: mvn help:effective-pom failed (${eff.error}) and raw pom.xml unreadable (${readErr.message}); pattern not scanned for this module`);
    }
  }

  for (const projectDir of projectRoots) {
    const effXml = effByProject.get(projectDir);
    if (!effXml) continue;

    const blocks = findVaultDependenciesInEffectivePom(effXml);
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

  // False-clean guard: if we found modules but couldn't produce a scan
  // target for a single one of them, do NOT report ok:true / zero findings —
  // the runbook dispatcher would then mark the pattern as scanned and the
  // user would see "no vault dependency issues" when nothing ran. Return
  // ok:false so the pattern falls through to the LLM-scan tier.
  if (projectRoots.length > 0 && effByProject.size === 0) {
    return {
      ok: false,
      findings: [],
      rawFindings: [],
      warnings,
      error: 'mvn help:effective-pom failed for every module and no raw pom.xml was readable — pattern not scanned',
    };
  }

  return { ok: true, findings, rawFindings, warnings };
}

module.exports = {
  runVaultPackageScan,
  isLegacyGroup,
  findVaultDependenciesInEffectivePom,
  getEffectivePom,
  getReactorEffectivePoms,
  splitReactorEffectivePom,
  collectMavenProjectRoots,
  isReactorRoot,
};
