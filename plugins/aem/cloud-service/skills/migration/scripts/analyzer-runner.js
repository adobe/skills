/**
 * Analyzer Runner
 *
 * Thin wrapper around the code-assessment deterministic analyzer
 * (`code-assessment/scripts/analyze.sh`). Shells out once over a workspace,
 * parses the `{ findings, warnings }` JSON, and normalizes the analyzer's
 * pattern slugs into the migration skill's canonical pattern taxonomy.
 *
 * This is the "analyzer (local fallback)" tier of the runbook cascade — it can
 * find every BPA-addressed pattern (including `replication`, which the BPA CSV
 * parser cannot map) directly from source, with no BPA report or MCP needed.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Default location of the code-assessment analyzer relative to this file:
//   .../skills/migration/scripts/analyzer-runner.js
//   .../skills/code-assessment/scripts/analyze.sh
const DEFAULT_ANALYZE_SCRIPT = path.resolve(__dirname, '../../code-assessment/scripts/analyze.sh');

// analyzer pattern slug → migration canonical pattern id.
// event-migration covers both JCR EventListener and OSGi EventHandler, which the
// migration apply flow routes to the same guide — so we keep them merged.
const ANALYZER_TO_CANONICAL = {
  'scheduler': 'scheduler',
  'resource-change-listener': 'resourceChangeListener',
  'event-migration': 'event-migration',
  'replication': 'replication',
  'asset-manager': 'assetApi',
};

/** Collapse a (possibly multi-line) code snippet into a single, table-safe cell. */
function sanitizeSnippet(snippet, maxLen = 120) {
  const oneLine = (snippet || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
}

/**
 * Is the analyzer usable? Requires the analyze.sh script to exist on disk.
 * (A missing JDK surfaces only at run time as a non-zero exit — handled in run().)
 */
function isAnalyzerAvailable(analyzeScript = DEFAULT_ANALYZE_SCRIPT) {
  return fs.existsSync(analyzeScript);
}

/**
 * Run the analyzer once over `workspaceRoot` and return normalized findings.
 *
 * @returns {{
 *   ok: boolean,
 *   findingsByPattern: Record<string, Array<{location: string, detail: string, severity: string}>>,
 *   warnings: string[],
 *   error?: string,
 * }}
 *   `findingsByPattern` is keyed by canonical migration pattern id. `ok:false`
 *   means the analyzer could not run (missing script, no JDK, compile/parse
 *   failure) — the caller should treat the analyzer tier as unavailable.
 */
function runAnalyzer(workspaceRoot, options = {}) {
  const { analyzeScript = DEFAULT_ANALYZE_SCRIPT } = options;

  if (!isAnalyzerAvailable(analyzeScript)) {
    return { ok: false, findingsByPattern: {}, warnings: [], error: `analyzer not found at ${analyzeScript}` };
  }

  let raw;
  try {
    raw = execFileSync('bash', [analyzeScript, workspaceRoot], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // exit 3 (no JDK), 5 (compile error), etc. — analyzer tier unavailable.
    const stderr = (err.stderr || '').toString().trim();
    return {
      ok: false,
      findingsByPattern: {},
      warnings: [],
      error: stderr || `analyzer exited with code ${err.status}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, findingsByPattern: {}, warnings: [], error: `could not parse analyzer output: ${e.message}` };
  }

  const findingsByPattern = {};
  for (const f of parsed.findings || []) {
    const canonical = ANALYZER_TO_CANONICAL[f.pattern];
    if (!canonical) continue; // skip non-BPA patterns (inject-in-sling-model, outdated-dependencies, …)
    (findingsByPattern[canonical] = findingsByPattern[canonical] || []).push({
      location: f.line ? `${f.file}:${f.line}` : f.file,
      detail: sanitizeSnippet(f.snippet),
      severity: 'high',
    });
  }

  return { ok: true, findingsByPattern, warnings: parsed.warnings || [] };
}

module.exports = {
  runAnalyzer,
  isAnalyzerAvailable,
  ANALYZER_TO_CANONICAL,
  DEFAULT_ANALYZE_SCRIPT,
};
