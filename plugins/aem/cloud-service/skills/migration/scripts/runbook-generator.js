/**
 * Migration Runbook Generator
 *
 * Produces a read-only `migration-runbook.md` covering every pattern the
 * migration skill can address. Triggered by generic prompts like "review/scan
 * my code for AEMaaCS migration" (no pattern named, no CSV required).
 *
 * Per-pattern detection STRATEGY — each pattern declares in `PATTERN_META` how
 * it is detected:
 *
 *   'cascade'     — Java code patterns. Highest available source wins:
 *                     BPA/CAM (MCP, if configured)
 *                        → CSV (if uploaded / cached)
 *                           → analyzer (local — code-assessment analyze.sh)
 *                              → LLM scan (last resort — agent, not this script)
 *                   `replication` maps to the BPA `replication.agent` subtype;
 *                   with no BPA source it falls through to the analyzer (or LLM).
 *   'html-scan'   — `htlLint`: heuristic regex scan of `.html` templates.
 *   'config-scan' — `osgiConfig`: heuristic scan of OSGi config files for
 *                   secret-looking keys and `$[secret:]`/`$[env:]` placeholders
 *                   (key names + locations only — never secret values).
 *   'content-scan'— `lui` / `cdw` / `templateModernization`. These ALSO carry
 *                   `bpaSlugs`, so when a BPA source is present they come from
 *                   BPA (authoritative); the `.content.xml` scan (Classic/Coral 2
 *                   dialogs, custom `cq:Widget` xtypes, static templates) is the
 *                   heuristic fallback when no BPA source is available. Routed to
 *                   migration Branches D / C, not code-assessment.
 *
 * `html-scan`/`config-scan`/`content-scan` (fallback) findings are tagged `confidence: 'heuristic'` in the
 * cache. Patterns no available strategy could scan (e.g. a cascade pattern
 * with no BPA source and no JDK) are returned in `needsLlmScan` for the agent.
 *
 * Alongside `migration-runbook.md`, this also writes a sidecar JSON cache
 * (default `./migration-runbook.json`) holding each pattern's raw
 * `{pattern, file, line, snippet}` findings. The apply handoff
 * (migration/SKILL.md Step 3) reads this cache to avoid re-deriving findings
 * via `getBpaFindings` or re-running the analyzer when the user picks a
 * pattern to fix.
 *
 * Usage (CLI):
 *   node scripts/runbook-generator.js <workspaceRoot> [--csv <bpaFilePath>] [--out <outputPath>] [--cache <cachePath>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getBpaFindings, checkAvailableSources } = require('./bpa-findings-helper.js');
const { runAnalyzer, isAnalyzerAvailable, DEFAULT_ANALYZE_SCRIPT } = require('./analyzer-runner.js');
const { runHtlLint } = require('./htl-lint-runner.js');
const { runOsgiConfigScan } = require('./osgi-config-runner.js');
const { runLuiScan, runCdwScan } = require('./legacy-ui-runner.js');
const { runTemplateScan } = require('./template-scan-runner.js');

// Canonical pattern taxonomy for the runbook — every pattern the migration
// skill can address. Each declares a detection `strategy`:
//   'cascade'      — BPA/CAM → CSV → analyzer → LLM (Java code patterns)
//   'html-scan'    — pure-Node regex scan of .html (htlLint)
//   'config-scan'  — config-file heuristic scan (osgiConfig)
//   'content-scan' — .content.xml / template scan (lui, cdw, templateModernization)
// `bpaSlugs` maps a pattern to its BPA subtype(s): the Java 'cascade' patterns,
// plus replication (replication.agent) and lui/cdw/templateModernization. When a
// BPA source is present it is authoritative; html/config/content scans are the
// local fallback. (inject-in-sling-model and outdated-dependencies belong to
// code-assessment's own runbook, not the migration runbook, so they stay out.)
const PATTERN_META = {
  scheduler: {
    label: 'Scheduler',
    severity: 'high',
    strategy: 'cascade',
    bpaSlugs: ['scheduler'],
    description: 'Classes using `org.apache.sling.commons.scheduler.Scheduler` / implementing the legacy `Job` interface. Migrate to OSGi-property scheduling or Sling Jobs via `JobManager`.',
    promptPattern: 'scheduler',
  },
  resourceChangeListener: {
    label: 'Resource Change Listener',
    severity: 'high',
    strategy: 'cascade',
    bpaSlugs: ['resourceChangeListener'],
    description: 'Classes implementing `ResourceChangeListener` / `ExternalResourceChangeListener`. Migrate to a lightweight `ResourceChangeListener` + `JobConsumer` split.',
    promptPattern: 'resourceChangeListener',
  },
  'event-migration': {
    label: 'Event Migration (EventListener / EventHandler)',
    severity: 'high',
    strategy: 'cascade',
    bpaSlugs: ['eventListener', 'eventHandler'],
    description: 'Classes implementing JCR `javax.jcr.observation.EventListener` or OSGi `org.osgi.service.event.EventHandler`. Migrate to a lightweight handler + `JobConsumer` split, with `TopologyEventListener` for leader-only work.',
    promptPattern: 'eventListener',
  },
  assetApi: {
    label: 'Asset Manager API',
    severity: 'high',
    strategy: 'cascade',
    bpaSlugs: ['assetApi'],
    description: 'Calls to `com.day.cq.dam.api.AssetManager` create/upload/delete methods not available on Cloud Service. Migrate to Direct Binary Access and in-JVM `resolver.delete()`.',
    promptPattern: 'assetApi',
  },
  replication: {
    label: 'Replication',
    severity: 'high',
    strategy: 'cascade',
    // BPA reports replication agents under replication.agent / forward|reverse.
    // When no CSV is present, the analyzer detects Replicator usage from source.
    bpaSlugs: ['replication'],
    description: 'Usage of `com.day.cq.replication.Replicator` / Sling Replication Agent. Migrate to the Sling Distribution API (`Distributor` + `SimpleDistributionRequest`).',
    promptPattern: 'replication',
  },
  htlLint: {
    label: 'HTL data-sly-test Lint',
    severity: 'medium',
    strategy: 'html-scan',
    bpaSlugs: [],
    heuristic: true,
    description: 'HTL `data-sly-test` redundant constant comparisons (`== true`, `/apps/…` string as test, split `${} || ${}`, numeric literals). Detected heuristically by a regex scan — not the HTL compiler — so re-confirm each hit before editing.',
    promptPattern: 'htlLint',
  },
  osgiConfig: {
    label: 'OSGi → Cloud Manager Config',
    severity: 'high',
    strategy: 'config-scan',
    bpaSlugs: [],
    heuristic: true,
    needsReview: true,
    description: 'OSGi config values that should move to Cloud Manager environment secrets/variables — plaintext secret-looking keys, legacy `.cfg`/`.config` formats, and existing `$[secret:]`/`$[env:]` placeholders. Heuristic, review-only: classification (real secret? Adobe-owned PID?) happens at apply time. Secret values are never written to the runbook.',
    promptPattern: 'osgi config',
    // Override — the OSGi → Cloud Manager branch uses a natural-language prompt,
    // not a `<pattern> only` invocation.
    sampleOverride: 'Use the migration skill: scan my config files and create Cloud Manager environment secrets or variables.',
  },
  lui: {
    label: 'Classic UI / Coral 2 Dialogs (LUI)',
    severity: 'high',
    strategy: 'content-scan',
    // BPA `lui` returns all legacy.user.interface sub-types; the runbook keeps
    // only the dialog ones (custom.component → create-component, static.template
    // → templateModernization, handled elsewhere).
    bpaSlugs: ['lui'],
    bpaSubtypeFilter: ['legacy.dialog.classic', 'legacy.dialog.coral2'],
    heuristic: true,
    description: 'Classic UI dialogs (`cq:Dialog` / `xtype="dialog"`) and Coral 2 dialogs (`granite/ui/components/foundation/…` resourceTypes) that must move to Coral 3 Touch UI. Detected heuristically by scanning `.content.xml`; the dialog migration (Branch D — legacy-ui/dialog) re-confirms and converts each.',
    promptPattern: 'lui',
    sampleOverride: 'Use the migration skill: fix my LUI dialog findings — convert Classic UI / ExtJS dialogs and upgrade Coral 2 dialogs to Coral 3.',
  },
  cdw: {
    label: 'Custom Classic Widgets (CDW)',
    severity: 'high',
    strategy: 'content-scan',
    bpaSlugs: ['cdw'],
    heuristic: true,
    description: 'Custom `cq:Widget` xtypes with no direct Coral 3 equivalent. Detected heuristically by scanning `.content.xml` for non-standard `xtype` values; the custom-widget migration (Branch D — legacy-ui/cdw) inventories each xtype and maps or scaffolds a Granite UI component. Run CDW before dialog migration when both are present.',
    promptPattern: 'cdw',
    sampleOverride: 'Use the migration skill: fix my CDW findings — migrate custom ExtJS widgets to Coral 3.',
  },
  templateModernization: {
    label: 'Static → Editable Templates',
    severity: 'medium',
    strategy: 'content-scan',
    bpaSlugs: ['templateModernization'],
    heuristic: true,
    description: 'Static templates under `apps/<appId>/templates/*` (`cq:Template`) that should become editable templates. Detected heuristically by globbing template `.content.xml`; the template modernization pipeline (Branch C) runs per-template context → execute → validate.',
    promptPattern: 'template modernization',
    sampleOverride: 'Use the migration skill: migrate my static templates to editable templates and generate the AEM Modernize Tools rewrite rules.',
  },
};

// content-scan strategy → the runner that produces that pattern's findings.
const CONTENT_SCANNERS = {
  lui: runLuiScan,
  cdw: runCdwScan,
  templateModernization: runTemplateScan,
};

const CANONICAL_PATTERNS = Object.keys(PATTERN_META);

/** Normalize a BPA target into the runbook's display shape. */
function normalizeBpaTarget(t) {
  return {
    location: t.className || t.filePath || '—',
    detail: t.identifier || t.issue || '',
    severity: t.severity || 'high',
  };
}

/**
 * Normalize a BPA target into the raw handoff shape. BPA/CSV/MCP sources
 * carry no line number or code snippet — only `pattern` and `file` are
 * populated, so the apply handoff knows it must still run
 * `analyze.sh --files <path>` once to resolve `line`/`snippet` before
 * building an edit plan (see code-assessment/references/runbook.md,
 * with_findings (pre-resolved) mode).
 */
function rawBpaTarget(pattern, t) {
  return {
    pattern,
    file: t.filePath || t.className || null,
    line: null,
    snippet: null,
  };
}

/**
 * Gather findings for every canonical pattern via the per-pattern cascade.
 *
 * @returns {Promise<{
 *   findingsByPattern: Record<string, Array<object>>,
 *   rawFindingsByPattern: Record<string, Array<{pattern: string, file: string, line: number|null, snippet: string|null}>>,
 *   sourceByPattern: Record<string, string>,   // 'mcp' | 'csv' | 'analyzer'
 *   needsLlmScan: string[],                      // patterns no deterministic source could scan
 *   analyzerWarnings: string[],
 *   bpaMode: string|null,
 *   analyzerUsed: boolean,
 * }>}
 */
async function gatherFindings(options = {}) {
  const {
    bpaFilePath,
    collectionsDir = './unified-collections',
    projectId,
    mcpFetcher,
    workspaceRoot = process.cwd(),
    analyzeScript = DEFAULT_ANALYZE_SCRIPT,
  } = options;

  const sources = checkAvailableSources({ bpaFilePath, collectionsDir, projectId, mcpFetcher });
  const bpaMode = sources.mcpServer.available
    ? 'mcp'
    : (sources.bpaFile.available || sources.unifiedCollection.available)
      ? 'csv'
      : null;

  const findingsByPattern = {};
  const rawFindingsByPattern = {};
  const sourceByPattern = {};
  const scannedBy = {};
  CANONICAL_PATTERNS.forEach(p => { findingsByPattern[p] = []; rawFindingsByPattern[p] = []; });

  const cascadePatterns = CANONICAL_PATTERNS.filter(p => PATTERN_META[p].strategy === 'cascade');
  const bpaPatterns = CANONICAL_PATTERNS.filter(p => (PATTERN_META[p].bpaSlugs || []).length > 0);
  const scanWarnings = [];

  // ── BPA tier (MCP or CSV) — any pattern with bpaSlugs. When a BPA source is
  //    available it owns the verdict; the pattern's local detector (analyzer /
  //    content scan) only runs as a fallback when no BPA source scanned it. ──
  if (bpaMode) {
    for (const pattern of bpaPatterns) {
      const { bpaSlugs, bpaSubtypeFilter } = PATTERN_META[pattern];
      const merged = [];
      const mergedRaw = [];
      let realError = false; // a genuine fetch failure (not "pattern absent")
      for (const slug of bpaSlugs) {
        const res = await getBpaFindings(slug, {
          bpaFilePath, collectionsDir, projectId, mcpFetcher, limit: null, offset: 0,
        });
        if (res.success && Array.isArray(res.targets)) {
          // A pattern may map to a broader BPA pattern (e.g. `lui` returns all
          // legacy.user.interface sub-types); keep only the ones this runbook
          // pattern owns.
          const targets = bpaSubtypeFilter
            ? res.targets.filter(t => bpaSubtypeFilter.includes(t.identifier))
            : res.targets;
          merged.push(...targets.map(normalizeBpaTarget));
          mergedRaw.push(...targets.map(t => rawBpaTarget(pattern, t)));
        } else if (res.availablePatterns) {
          // Benign: the report parsed fine but this pattern is absent — a
          // legitimate "clean" result. Stay silent.
        } else {
          // Real failure (mcp-error / mcp-server / bpa-file-error / no-source /
          // "no CSV path"). Do NOT report as clean.
          realError = true;
          scanWarnings.push(
            `BPA fetch failed for \`${pattern}\` (slug \`${slug}\`, source: ${res.source || 'unknown'}): ${res.error || res.message || 'unknown error'}`
          );
        }
      }

      if (realError && merged.length === 0) {
        // Nothing usable from BPA and the fetch genuinely failed — leave the
        // pattern UNSCANNED so its local detector runs as a fallback (and, if
        // that can't run either, it surfaces in needsLlmScan). Never mark it
        // as a clean BPA scan.
        continue;
      }
      // Either the fetch succeeded (possibly zero findings = genuinely clean)
      // or we still got some findings despite a partial error — BPA owns it.
      findingsByPattern[pattern] = merged;
      rawFindingsByPattern[pattern] = mergedRaw;
      sourceByPattern[pattern] = bpaMode;
      scannedBy[pattern] = bpaMode;
    }
  }

  // ── Cascade tier 3: analyzer (fills replication always; fills the other
  //    cascade patterns only when no BPA source scanned them) ──────────────
  let analyzerUsed = false;
  const analyzerCanRun = isAnalyzerAvailable(analyzeScript) && !!workspaceRoot;
  const patternsNeedingAnalyzer = cascadePatterns.filter(p => !scannedBy[p]);

  if (analyzerCanRun && patternsNeedingAnalyzer.length > 0) {
    const result = runAnalyzer(workspaceRoot, { analyzeScript });
    if (result.ok) {
      analyzerUsed = true;
      if (result.warnings && result.warnings.length) scanWarnings.push(...result.warnings);
      for (const pattern of patternsNeedingAnalyzer) {
        findingsByPattern[pattern] = result.findingsByPattern[pattern] || [];
        rawFindingsByPattern[pattern] = result.rawFindingsByPattern[pattern] || [];
        sourceByPattern[pattern] = 'analyzer';
        scannedBy[pattern] = 'analyzer';
      }
    }
  }

  // ── Strategy 'html-scan': htlLint (independent of the cascade) ───────────
  if (CANONICAL_PATTERNS.includes('htlLint') && workspaceRoot) {
    const res = runHtlLint(workspaceRoot);
    if (res.ok) {
      findingsByPattern.htlLint = res.findings;
      rawFindingsByPattern.htlLint = res.rawFindings;
      sourceByPattern.htlLint = 'html-scan';
      scannedBy.htlLint = 'html-scan';
    }
  }

  // ── Strategy 'config-scan': osgiConfig (independent of the cascade) ──────
  if (CANONICAL_PATTERNS.includes('osgiConfig') && workspaceRoot) {
    const res = runOsgiConfigScan(workspaceRoot);
    if (res.ok) {
      findingsByPattern.osgiConfig = res.findings;
      rawFindingsByPattern.osgiConfig = res.rawFindings;
      sourceByPattern.osgiConfig = 'config-scan';
      scannedBy.osgiConfig = 'config-scan';
      if (res.warnings && res.warnings.length) scanWarnings.push(...res.warnings);
    }
  }

  // ── Strategy 'content-scan': lui / cdw / templateModernization (fallback
  //    when no BPA source scanned the pattern) ──────────────────────────────
  if (workspaceRoot) {
    for (const pattern of CANONICAL_PATTERNS) {
      if (PATTERN_META[pattern].strategy !== 'content-scan') continue;
      if (scannedBy[pattern]) continue; // BPA already provided findings
      const scan = CONTENT_SCANNERS[pattern];
      if (!scan) continue;
      const res = scan(workspaceRoot);
      if (res.ok) {
        findingsByPattern[pattern] = res.findings;
        rawFindingsByPattern[pattern] = res.rawFindings;
        sourceByPattern[pattern] = 'content-scan';
        scannedBy[pattern] = 'content-scan';
        if (res.warnings && res.warnings.length) scanWarnings.push(...res.warnings);
      }
    }
  }

  // ── Tier 4: anything still unscanned → LLM scan (agent handles it) ───────
  const needsLlmScan = CANONICAL_PATTERNS.filter(p => !scannedBy[p]);

  return { findingsByPattern, rawFindingsByPattern, sourceByPattern, needsLlmScan, analyzerWarnings: scanWarnings, bpaMode, analyzerUsed };
}

/** Build the per-pattern copy-paste sample prompt. */
function samplePrompt(pattern, ctx) {
  const meta = PATTERN_META[pattern];
  if (meta.sampleOverride) return meta.sampleOverride;
  const csvClause = ctx.bpaFilePath ? ` BPA CSV at \`${ctx.bpaFilePath}\`,` : '';
  return `Use the migration skill: **${meta.promptPattern}** only,${csvClause} then read the code-assessment pattern guide before editing.`;
}

/**
 * Strip a leading `workspaceRoot` prefix from a `file` or `file:line` string so
 * the committed runbook shows portable, workspace-relative paths and does not
 * leak the local filesystem layout. Leaves non-path values untouched (e.g. a
 * BPA `className` FQN, or an already-relative path), so it is safe to apply to
 * every source's output.
 */
function relPath(value, workspaceRoot) {
  if (!value || !workspaceRoot || typeof value !== 'string') return value;
  const prefix = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Findings that represent outstanding work (excludes informational rows). */
function actionable(findings) {
  return findings.filter(f => !f.informational);
}

/** Render the runbook markdown. */
function renderRunbook(gathered, ctx = {}) {
  const { findingsByPattern, sourceByPattern, needsLlmScan, analyzerWarnings } = gathered;
  const root = ctx.workspaceRoot;
  const lines = [];

  const total = CANONICAL_PATTERNS.reduce((n, p) => n + actionable(findingsByPattern[p]).length, 0);
  const withFindings = CANONICAL_PATTERNS.filter(p => actionable(findingsByPattern[p]).length > 0);

  lines.push('# AEM Cloud Service — Migration Runbook');
  lines.push('');
  lines.push('> **Read-only planning document.** It lists the migration findings discovered');
  lines.push('> across your project. Use a pattern\'s sample prompt to start the');
  lines.push('> one-pattern-per-session apply workflow. No code was changed to produce this.');
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Generated | ${ctx.generatedAt || new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC |`);
  lines.push(`| Total findings | **${total}** |`);
  lines.push(`| Patterns with findings | **${withFindings.length}** of ${CANONICAL_PATTERNS.length} |`);
  lines.push('');

  lines.push('### Findings by pattern');
  lines.push('');
  lines.push('| Pattern | Severity | Findings | Detected via |');
  lines.push('|---------|----------|----------|--------------|');
  for (const p of CANONICAL_PATTERNS) {
    const meta = PATTERN_META[p];
    const count = actionable(findingsByPattern[p]).length;
    const src = needsLlmScan.includes(p)
      ? '_needs LLM scan_'
      : SOURCE_LABEL[sourceByPattern[p]] || '—';
    lines.push(`| ${meta.label} | ${meta.severity} | ${count === 0 ? '—' : `**${count}**`} | ${src} |`);
  }
  lines.push('');

  if (needsLlmScan.length > 0) {
    lines.push(`> ⚠️ No deterministic source could scan: **${needsLlmScan.map(p => PATTERN_META[p].label).join(', ')}**. `);
    lines.push('> Provide a BPA CSV, open the project workspace for the analyzer, or ask the agent to run an LLM scan for these.');
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  for (const p of CANONICAL_PATTERNS) {
    const targets = findingsByPattern[p];
    if (targets.length === 0) continue;
    const meta = PATTERN_META[p];

    const actCount = actionable(targets).length;
    const infoCount = targets.length - actCount;
    lines.push(`## ${meta.label} (\`${p}\`)`);
    lines.push('');
    lines.push(`**Severity:** ${meta.severity} | **Findings:** ${actCount}${infoCount > 0 ? ` (+${infoCount} informational)` : ''} | **Detected via:** ${SOURCE_LABEL[sourceByPattern[p]] || '—'}`);
    lines.push('');
    lines.push(meta.description);
    lines.push('');
    if (meta.heuristic) {
      lines.push(`> ⚠️ **Heuristic detection** (${SOURCE_LABEL[sourceByPattern[p]] || 'non-deterministic'}) — these are candidate matches, not compiler/BPA-validated findings. Re-confirm each one before editing.`);
      if (meta.needsReview) {
        lines.push('> Secret **values** are intentionally omitted from this runbook — only key names and locations are shown. Classification happens at apply time.');
      }
      lines.push('');
    }
    lines.push('### Affected');
    lines.push('');
    lines.push('| Location | Detail | Severity |');
    lines.push('|----------|--------|----------|');
    for (const t of targets) {
      const detail = (t.detail || '').replace(/\|/g, '\\|');
      const location = relPath(t.location, root);
      lines.push(`| \`${location}\` | \`${detail || '—'}\` | ${t.severity || 'high'} |`);
    }
    lines.push('');
    lines.push('### Sample prompt');
    lines.push('');
    lines.push('```');
    lines.push(samplePrompt(p, ctx));
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const clean = CANONICAL_PATTERNS.filter(p => findingsByPattern[p].length === 0 && !needsLlmScan.includes(p));
  if (clean.length > 0) {
    lines.push('## Scanned — no findings');
    lines.push('');
    for (const p of clean) lines.push(`- **${PATTERN_META[p].label}** (\`${p}\`)`);
    lines.push('');
  }

  if (analyzerWarnings && analyzerWarnings.length > 0) {
    lines.push('## Scan warnings');
    lines.push('');
    for (const w of analyzerWarnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by the AEM Cloud Service migration skill — runbook-generator.js*');
  return lines.join('\n');
}

const SOURCE_LABEL = {
  mcp: 'BPA / CAM',
  csv: 'BPA CSV',
  analyzer: 'analyzer',
  'html-scan': 'HTL scan',
  'config-scan': 'config scan',
  'content-scan': 'content scan',
  llm: 'LLM scan',
};

/**
 * Default path for the runbook's raw-findings sidecar cache, written next to
 * the markdown so the apply handoff (migration/SKILL.md Step 3) can reuse
 * already-computed findings for a pattern instead of re-deriving them via
 * `getBpaFindings` or re-running the analyzer.
 */
const DEFAULT_CACHE_PATH = './migration-runbook.json';

/**
 * Write the raw-findings sidecar cache. Kept as a separate function (rather
 * than inlined in generateRunbook) so a caller re-rendering after an LLM/rg
 * scan (Tier 4) can refresh the cache without re-running the whole cascade.
 */
function writeRunbookCache(gathered, ctx, cachePath = DEFAULT_CACHE_PATH) {
  const root = ctx.workspaceRoot;
  const cache = {
    generatedAt: ctx.generatedAt,
    // `file` fields below are relative to this root — the apply handoff
    // resolves them with `path.join(workspaceRoot, file)`.
    workspaceRoot: root || null,
    sourceByPattern: gathered.sourceByPattern,
    findingsByPattern: {},
  };
  // Copy raw findings, relativizing `file` and tagging heuristic patterns
  // (regex-scanned htlLint, config-scanned osgiConfig) so the apply handoff
  // knows they are candidate matches, not analyzer/BPA-grade findings, and
  // must re-confirm each one.
  for (const [pattern, findings] of Object.entries(gathered.rawFindingsByPattern)) {
    const meta = PATTERN_META[pattern];
    const heuristic = !!(meta && meta.heuristic);
    cache.findingsByPattern[pattern] = findings.map(f => {
      const rel = { ...f, file: relPath(f.file, root) };
      if (heuristic) rel.confidence = 'heuristic';
      return rel;
    });
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  return cachePath;
}

/**
 * Generate the runbook end to end.
 *
 * @returns {Promise<{
 *   success: boolean, outputPath?: string, cachePath?: string, message: string,
 *   totalFindings: number, patternCounts: object,
 *   needsLlmScan: string[], gathered: object,
 * }>}
 *   When `needsLlmScan` is non-empty, the agent should LLM-scan those patterns,
 *   merge them into `gathered.findingsByPattern` (and `gathered.rawFindingsByPattern`
 *   using the same `{pattern, file, line, snippet}` shape where locatable),
 *   re-render via `renderRunbook`, and call `writeRunbookCache` again so the
 *   cache reflects the merged findings.
 */
async function generateRunbook(options = {}) {
  const { outputPath = './migration-runbook.md', cachePath = DEFAULT_CACHE_PATH, bpaFilePath, workspaceRoot } = options;

  const gathered = await gatherFindings(options);
  const ctx = {
    bpaFilePath,
    workspaceRoot,
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  const markdown = renderRunbook(gathered, ctx);
  fs.writeFileSync(outputPath, markdown, 'utf8');
  writeRunbookCache(gathered, ctx, cachePath);

  // Counts reflect outstanding work — informational findings (e.g. OSGi
  // configs already using placeholders) are excluded from the headline.
  const patternCounts = {};
  let totalFindings = 0;
  for (const p of CANONICAL_PATTERNS) {
    patternCounts[p] = actionable(gathered.findingsByPattern[p]).length;
    totalFindings += patternCounts[p];
  }

  return {
    success: true,
    outputPath,
    cachePath,
    message: `Runbook written to ${outputPath} — ${totalFindings} findings across ${CANONICAL_PATTERNS.filter(p => patternCounts[p] > 0).length} pattern(s).`,
    totalFindings,
    patternCounts,
    needsLlmScan: gathered.needsLlmScan,
    gathered,
  };
}

// CLI
function parseArgs(argv) {
  const out = { workspaceRoot: undefined, bpaFilePath: undefined, outputPath: './migration-runbook.md', cachePath: DEFAULT_CACHE_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') out.bpaFilePath = argv[++i];
    else if (a === '--out') out.outputPath = argv[++i];
    else if (a === '--cache') out.cachePath = argv[++i];
    else if (!out.workspaceRoot) out.workspaceRoot = a;
  }
  if (!out.workspaceRoot) out.workspaceRoot = process.cwd();
  return out;
}

async function main() {
  const { workspaceRoot, bpaFilePath, outputPath, cachePath } = parseArgs(process.argv.slice(2));

  console.log('Migration Runbook Generator');
  console.log('===========================');
  console.log(`Workspace:  ${workspaceRoot}`);
  if (bpaFilePath) console.log(`BPA CSV:    ${bpaFilePath}`);
  console.log(`Output:     ${outputPath}`);
  console.log(`Cache:      ${cachePath}`);
  console.log('');

  const result = await generateRunbook({ workspaceRoot, bpaFilePath, outputPath, cachePath });

  console.log(`✅ ${result.message}`);
  console.log(`   Findings cache: ${result.cachePath}`);
  console.log('');
  console.log('Pattern breakdown:');
  for (const [pattern, count] of Object.entries(result.patternCounts)) {
    const src = result.gathered.needsLlmScan.includes(pattern)
      ? 'needs-llm-scan'
      : (result.gathered.sourceByPattern[pattern] || '—');
    console.log(`  ${pattern.padEnd(25)} ${String(count).padStart(3)}  (${src})`);
  }
  if (result.needsLlmScan.length > 0) {
    console.log('');
    console.log(`⚠️  Needs LLM scan: ${result.needsLlmScan.join(', ')}`);
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  generateRunbook,
  gatherFindings,
  renderRunbook,
  writeRunbookCache,
  samplePrompt,
  CANONICAL_PATTERNS,
  PATTERN_META,
  DEFAULT_CACHE_PATH,
};
