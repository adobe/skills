/**
 * Migration Runbook Generator
 *
 * Produces a read-only `migration-runbook.md` covering the BPA-addressed
 * migration patterns. Triggered by generic prompts like "review/scan my code
 * for AEMaaCS migration" (no pattern named, no CSV required).
 *
 * Per-pattern detection cascade — for EACH canonical pattern, the highest
 * available source that can actually produce it wins:
 *
 *     BPA/CAM (MCP, if configured)
 *        → CSV (if uploaded / cached)
 *           → analyzer (local fallback — code-assessment analyze.sh)
 *              → LLM scan (last resort — performed by the agent, not this script)
 *
 * `replication` has no BPA/CSV mapping, so it always falls through to the
 * analyzer (or LLM scan). Patterns no deterministic source can scan are
 * returned in `needsLlmScan` for the agent to handle.
 *
 * Usage (CLI):
 *   node scripts/runbook-generator.js <workspaceRoot> [--csv <bpaFilePath>] [--out <outputPath>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getBpaFindings, checkAvailableSources } = require('./bpa-findings-helper.js');
const { runAnalyzer, isAnalyzerAvailable, DEFAULT_ANALYZE_SCRIPT } = require('./analyzer-runner.js');

// Canonical pattern taxonomy for the runbook — the BPA-addressed migration
// patterns only. (htlLint, OSGi config, inject-in-sling-model and
// outdated-dependencies are intentionally out of scope.)
const PATTERN_META = {
  scheduler: {
    label: 'Scheduler',
    severity: 'high',
    bpaSlugs: ['scheduler'],
    description: 'Classes using `org.apache.sling.commons.scheduler.Scheduler` / implementing the legacy `Job` interface. Migrate to OSGi-property scheduling or Sling Jobs via `JobManager`.',
    promptPattern: 'scheduler',
  },
  resourceChangeListener: {
    label: 'Resource Change Listener',
    severity: 'high',
    bpaSlugs: ['resourceChangeListener'],
    description: 'Classes implementing `ResourceChangeListener` / `ExternalResourceChangeListener`. Migrate to a lightweight `ResourceChangeListener` + `JobConsumer` split.',
    promptPattern: 'resourceChangeListener',
  },
  'event-migration': {
    label: 'Event Migration (EventListener / EventHandler)',
    severity: 'high',
    bpaSlugs: ['eventListener', 'eventHandler'],
    description: 'Classes implementing JCR `javax.jcr.observation.EventListener` or OSGi `org.osgi.service.event.EventHandler`. Migrate to a lightweight handler + `JobConsumer` split, with `TopologyEventListener` for leader-only work.',
    promptPattern: 'eventListener',
  },
  assetApi: {
    label: 'Asset Manager API',
    severity: 'high',
    bpaSlugs: ['assetApi'],
    description: 'Calls to `com.day.cq.dam.api.AssetManager` create/upload/delete methods not available on Cloud Service. Migrate to Direct Binary Access and in-JVM `resolver.delete()`.',
    promptPattern: 'assetApi',
  },
  replication: {
    label: 'Replication',
    severity: 'high',
    bpaSlugs: [], // analyzer-only — no BPA/CSV subtype mapping exists
    description: 'Usage of `com.day.cq.replication.Replicator` / Sling Replication Agent. Migrate to the Sling Distribution API (`Distributor` + `SimpleDistributionRequest`).',
    promptPattern: 'replication',
  },
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
 * Gather findings for every canonical pattern via the per-pattern cascade.
 *
 * @returns {Promise<{
 *   findingsByPattern: Record<string, Array<object>>,
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
  const sourceByPattern = {};
  const scannedBy = {};
  CANONICAL_PATTERNS.forEach(p => { findingsByPattern[p] = []; });

  // ── Tier 1/2: BPA (MCP) or CSV ──────────────────────────────────────────
  if (bpaMode) {
    for (const pattern of CANONICAL_PATTERNS) {
      const { bpaSlugs } = PATTERN_META[pattern];
      if (bpaSlugs.length === 0) continue; // replication — not BPA-mappable
      const merged = [];
      for (const slug of bpaSlugs) {
        const res = await getBpaFindings(slug, {
          bpaFilePath, collectionsDir, projectId, mcpFetcher, limit: null, offset: 0,
        });
        if (res.success && Array.isArray(res.targets)) {
          merged.push(...res.targets.map(normalizeBpaTarget));
        }
      }
      findingsByPattern[pattern] = merged;
      sourceByPattern[pattern] = bpaMode;
      scannedBy[pattern] = bpaMode;
    }
  }

  // ── Tier 3: analyzer (fills replication always; fills the rest only when
  //    no BPA source scanned them) ─────────────────────────────────────────
  let analyzerWarnings = [];
  let analyzerUsed = false;
  const analyzerCanRun = isAnalyzerAvailable(analyzeScript) && !!workspaceRoot;
  const patternsNeedingAnalyzer = CANONICAL_PATTERNS.filter(p => !scannedBy[p]);

  if (analyzerCanRun && patternsNeedingAnalyzer.length > 0) {
    const result = runAnalyzer(workspaceRoot, { analyzeScript });
    if (result.ok) {
      analyzerUsed = true;
      analyzerWarnings = result.warnings;
      for (const pattern of patternsNeedingAnalyzer) {
        findingsByPattern[pattern] = result.findingsByPattern[pattern] || [];
        sourceByPattern[pattern] = 'analyzer';
        scannedBy[pattern] = 'analyzer';
      }
    }
  }

  // ── Tier 4: anything still unscanned → LLM scan (agent handles it) ───────
  const needsLlmScan = CANONICAL_PATTERNS.filter(p => !scannedBy[p]);

  return { findingsByPattern, sourceByPattern, needsLlmScan, analyzerWarnings, bpaMode, analyzerUsed };
}

/** Build the per-pattern copy-paste sample prompt. */
function samplePrompt(pattern, ctx) {
  const meta = PATTERN_META[pattern];
  const csvClause = ctx.bpaFilePath ? ` BPA CSV at \`${ctx.bpaFilePath}\`,` : '';
  return `Use the migration skill: **${meta.promptPattern}** only,${csvClause} then read the code-assessment pattern guide before editing.`;
}

/** Render the runbook markdown. */
function renderRunbook(gathered, ctx = {}) {
  const { findingsByPattern, sourceByPattern, needsLlmScan, analyzerWarnings } = gathered;
  const lines = [];

  const total = CANONICAL_PATTERNS.reduce((n, p) => n + findingsByPattern[p].length, 0);
  const withFindings = CANONICAL_PATTERNS.filter(p => findingsByPattern[p].length > 0);

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
    const count = findingsByPattern[p].length;
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

    lines.push(`## ${meta.label} (\`${p}\`)`);
    lines.push('');
    lines.push(`**Severity:** ${meta.severity} | **Findings:** ${targets.length} | **Detected via:** ${SOURCE_LABEL[sourceByPattern[p]] || '—'}`);
    lines.push('');
    lines.push(meta.description);
    lines.push('');
    lines.push('### Affected');
    lines.push('');
    lines.push('| Location | Detail | Severity |');
    lines.push('|----------|--------|----------|');
    for (const t of targets) {
      const detail = (t.detail || '').replace(/\|/g, '\\|');
      lines.push(`| \`${t.location}\` | \`${detail || '—'}\` | ${t.severity || 'high'} |`);
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
    lines.push('## Analyzer warnings');
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
};

/**
 * Generate the runbook end to end.
 *
 * @returns {Promise<{
 *   success: boolean, outputPath?: string, message: string,
 *   totalFindings: number, patternCounts: object,
 *   needsLlmScan: string[], gathered: object,
 * }>}
 *   When `needsLlmScan` is non-empty, the agent should LLM-scan those patterns,
 *   merge them into `gathered.findingsByPattern`, and re-render via `renderRunbook`.
 */
async function generateRunbook(options = {}) {
  const { outputPath = './migration-runbook.md', bpaFilePath } = options;

  const gathered = await gatherFindings(options);
  const ctx = {
    bpaFilePath,
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  const markdown = renderRunbook(gathered, ctx);
  fs.writeFileSync(outputPath, markdown, 'utf8');

  const patternCounts = {};
  let totalFindings = 0;
  for (const p of CANONICAL_PATTERNS) {
    patternCounts[p] = gathered.findingsByPattern[p].length;
    totalFindings += patternCounts[p];
  }

  return {
    success: true,
    outputPath,
    message: `Runbook written to ${outputPath} — ${totalFindings} findings across ${CANONICAL_PATTERNS.filter(p => patternCounts[p] > 0).length} pattern(s).`,
    totalFindings,
    patternCounts,
    needsLlmScan: gathered.needsLlmScan,
    gathered,
  };
}

// CLI
function parseArgs(argv) {
  const out = { workspaceRoot: undefined, bpaFilePath: undefined, outputPath: './migration-runbook.md' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') out.bpaFilePath = argv[++i];
    else if (a === '--out') out.outputPath = argv[++i];
    else if (!out.workspaceRoot) out.workspaceRoot = a;
  }
  if (!out.workspaceRoot) out.workspaceRoot = process.cwd();
  return out;
}

async function main() {
  const { workspaceRoot, bpaFilePath, outputPath } = parseArgs(process.argv.slice(2));

  console.log('Migration Runbook Generator');
  console.log('===========================');
  console.log(`Workspace:  ${workspaceRoot}`);
  if (bpaFilePath) console.log(`BPA CSV:    ${bpaFilePath}`);
  console.log(`Output:     ${outputPath}`);
  console.log('');

  const result = await generateRunbook({ workspaceRoot, bpaFilePath, outputPath });

  console.log(`✅ ${result.message}`);
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
  samplePrompt,
  CANONICAL_PATTERNS,
  PATTERN_META,
};
