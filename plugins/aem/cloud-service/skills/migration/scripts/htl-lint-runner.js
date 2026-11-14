/**
 * HTL Lint Runner
 *
 * The `html-scan` detection tier of the runbook cascade for the **htlLint**
 * pattern — the AEM Cloud SDK HTL lint warning *"data-sly-test: redundant
 * constant value comparison"*. Mirrors the proactive discovery documented in
 * `{code-assessment}/references/data-sly-test-redundant-constant.md`.
 *
 * Implemented as a pure-Node fs walk + regex scan (no external `rg` binary):
 * ripgrep is not guaranteed to be installed in a developer's environment, and
 * the anti-patterns are simple line regexes, so a self-contained scan is more
 * portable and deterministic.
 *
 * This is a **heuristic** detector: a regex is not the HTL compiler, so it can
 * miss multi-line attributes and false-positive on legitimate expressions.
 * Findings are tagged `confidence: 'heuristic'` by the caller and must be
 * re-confirmed before editing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Anti-pattern classes searched inside a `data-sly-test="…"` attribute.
// `\b` after true/false avoids matching identifiers like `trueFlag`; the
// `apps` class stays within the attribute value (`[^"]*`) to avoid matching
// `/apps/` in an unrelated attribute on the same line.
const HTL_CLASSES = [
  { label: 'boolean-literal', js: /data-sly-test="[^"]*(?:==|!=)\s*(?:true|false)\b/ },
  { label: 'apps-string-as-test', js: /data-sly-test\s*=\s*["'][^"]*\/apps\// },
  { label: 'split-logical-across-expr', js: /data-sly-test="[^"]*\}\s*(?:\|\||&&)\s*\$\{/ },
  { label: 'numeric-literal', js: /data-sly-test="[^"]*==\s*[0-9]+\s*\}/ },
];

/** Classify a line into an HTL anti-pattern label, or null if it matches none. */
function classify(line) {
  for (const c of HTL_CLASSES) {
    if (c.js.test(line)) return c.label;
  }
  return null;
}

/** Collapse a matched line into a single, table-safe snippet cell. */
function sanitizeSnippet(snippet, maxLen = 120) {
  const oneLine = (snippet || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
}

/** Recursively collect `.html` files under `dir`, skipping heavy/vendor dirs. */
function collectHtmlFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
      collectHtmlFiles(full, acc);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Scan `.html` files under `workspaceRoot` for HTL `data-sly-test` anti-patterns.
 *
 * @returns {{
 *   ok: boolean,
 *   findings: Array<{location: string, detail: string, severity: string}>,
 *   rawFindings: Array<{pattern: string, file: string, line: number, snippet: string}>,
 *   warnings: string[],
 *   error?: string,
 * }}
 *   A clean scan with no hits is `ok:true` with empty arrays. `ok:false` only
 *   on an unexpected failure (e.g. unreadable root) — the caller then falls
 *   through to the LLM-scan tier.
 */
function runHtlLint(workspaceRoot, options = {}) {
  if (!workspaceRoot) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  }

  let files;
  try {
    files = collectHtmlFiles(workspaceRoot);
  } catch (err) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], error: err.message };
  }

  const findings = [];
  const rawFindings = [];
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const label = classify(line);
      if (!label) return;
      findings.push({
        location: `${file}:${i + 1}`,
        detail: `${label} — ${sanitizeSnippet(line)}`,
        severity: 'medium',
      });
      rawFindings.push({ pattern: 'htlLint', file, line: i + 1, snippet: line });
    });
  }

  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { runHtlLint, collectHtmlFiles, classify, HTL_CLASSES };
