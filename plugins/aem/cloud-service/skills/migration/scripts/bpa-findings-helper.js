/**
 * BPA Findings Helper
 *
 * Two independent execution paths — the helper picks one based on what the
 * caller configured, never mixes them, and applies the same batching to both:
 *
 *   1. MCP configured (mcpFetcher + projectId)
 *        → first call: fetch all findings from MCP, cache to
 *          `<collectionsDir>/mcp/<projectId>/<pattern>.json`.
 *        → subsequent calls: read that cache.
 *        → every call applies `paginate(...)` and returns one batch.
 *
 *   2. MCP not configured, CSV path provided (or cached CSV collection exists)
 *        → first call: parse CSV, write the unified-collection JSON to
 *          `<collectionsDir>/unified-collection.json`.
 *        → subsequent calls: read that cache.
 *        → every call applies `paginate(...)` and returns one batch.
 *
 * The two cache locations are disjoint so the paths never shadow each other.
 * Batch size defaults to `DEFAULT_BATCH_SIZE` (5); pass `limit: null` to
 * disable batching.
 */

const path = require('path');
const fs = require('fs');
const {
  hasUnifiedCollection,
  fetchUnifiedBpaFindings,
  getAvailablePatterns,
  getUnifiedCollectionSummary,
  paginate,
  DEFAULT_BATCH_SIZE
} = require('./unified-collection-reader.js');
const { validateBpaFile, parseBpaFile, createUnifiedCollection } = require('./bpa-local-parser.js');

const DEFAULT_COLLECTIONS_DIR = './unified-collections';

/** Path to the MCP cache file for (projectId, pattern). */
function mcpCachePath(collectionsDir, projectId, pattern) {
  return path.join(collectionsDir, 'mcp', projectId, `${pattern}.json`);
}

/** Read a cached MCP fetch from disk; returns `null` if absent or invalid. */
function readMcpCache(collectionsDir, projectId, pattern) {
  const file = mcpCachePath(collectionsDir, projectId, pattern);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Persist an MCP fetch to disk as the read model for subsequent paging. */
function writeMcpCache(collectionsDir, projectId, pattern, environment, targets, mcpMessage) {
  const file = mcpCachePath(collectionsDir, projectId, pattern);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    source: 'mcp',
    projectId,
    pattern,
    environment,
    fetchedAt: new Date().toISOString(),
    targets,
    ...(mcpMessage ? { mcpMessage } : {})
  }, null, 2));
}

/**
 * Get BPA findings, batched. See module header for the two-path contract.
 *
 * Returns `{ success, source, message, targets, paging, … }` where
 * `paging = { total, returned, offset, limit, nextOffset, hasMore }`.
 */
async function getBpaFindings(pattern = 'all', options = {}) {
  const {
    bpaFilePath,
    collectionsDir = DEFAULT_COLLECTIONS_DIR,
    projectId,
    environment = 'prod',
    mcpFetcher,
    offset = 0,
    limit = DEFAULT_BATCH_SIZE
  } = options;

  // ── Path A: MCP (one fetch per (projectId, pattern), cached, then paged) ──
  if (mcpFetcher && projectId) {
    return getFromMcp({
      pattern, projectId, environment, mcpFetcher, collectionsDir, offset, limit
    });
  }

  // ── Path B: CSV / cached CSV collection ──
  if (bpaFilePath || hasUnifiedCollection(collectionsDir)) {
    return getFromCsvOrCache({
      pattern, bpaFilePath, collectionsDir, offset, limit
    });
  }

  // ── Nothing configured ──
  return {
    success: false,
    source: 'no-source',
    error: 'No BPA findings source available',
    message: 'No BPA data found. Configure MCP (mcpFetcher + projectId) or provide a BPA CSV file path.',
    troubleshooting: [
      'Configure MCP access with mcpFetcher and projectId',
      'Or provide the path to your BPA CSV report',
      'Or point to specific Java files for manual migration'
    ]
  };
}

/**
 * MCP path: first call fetches & caches; subsequent calls read cache.
 * Every call returns exactly one batch.
 */
async function getFromMcp({ pattern, projectId, environment, mcpFetcher, collectionsDir, offset, limit }) {
  let cache = readMcpCache(collectionsDir, projectId, pattern);

  if (!cache) {
    try {
      const mcp = await mcpFetcher({ projectId, pattern, environment });
      if (!mcp || mcp.success === false) {
        return {
          ...(mcp || {}),
          success: false,
          source: 'mcp-server',
          message: `MCP fetch did not succeed (project: ${projectId}).`
        };
      }
      const targets = Array.isArray(mcp.targets) ? mcp.targets : [];
      writeMcpCache(collectionsDir, projectId, pattern, environment, targets, mcp.message);
      cache = readMcpCache(collectionsDir, projectId, pattern);
    } catch (error) {
      return {
        success: false,
        source: 'mcp-error',
        error: `MCP server error: ${error.message}`,
        message: `Could not fetch from MCP server: ${error.message}`,
        troubleshooting: [
          'Check MCP server connectivity',
          'Verify project ID and credentials',
          'Provide a BPA CSV file path as an alternative'
        ]
      };
    }
  }

  const { targets, paging } = paginate(cache.targets, { offset, limit });
  const defaultMessage = `Using MCP cache for project ${projectId} (fetched ${formatTimestamp(cache.fetchedAt)}).`;
  return {
    success: true,
    source: 'mcp-server',
    projectId,
    environment,
    message: (cache.targets.length === 0 && cache.mcpMessage) ? cache.mcpMessage : defaultMessage,
    targets,
    paging
  };
}

/**
 * CSV / cached-collection path: first call parses CSV and writes the unified
 * collection; subsequent calls read it. Every call returns exactly one batch.
 */
function getFromCsvOrCache({ pattern, bpaFilePath, collectionsDir, offset, limit }) {
  // Create the cache on first invocation if it doesn't exist yet.
  if (!hasUnifiedCollection(collectionsDir)) {
    if (!bpaFilePath) {
      return {
        success: false,
        source: 'bpa-file',
        error: 'No BPA CSV path provided and no cached collection exists',
        message: `No cached collection at ${collectionsDir}; provide bpaFilePath to create one.`
      };
    }
    try {
      validateBpaFile(bpaFilePath);
      createUnifiedCollection(parseBpaFile(bpaFilePath), collectionsDir);
    } catch (error) {
      return {
        success: false,
        source: 'bpa-file-error',
        error: `Failed to process BPA file: ${error.message}`,
        message: `Could not process BPA file at ${bpaFilePath}: ${error.message}`,
        troubleshooting: [
          'Verify the file exists and is a valid BPA CSV',
          'Expected CSV headers: code, type, subtype, importance, identifier, message, context'
        ]
      };
    }
  }

  const patterns = getAvailablePatterns(collectionsDir);
  const hasPattern = pattern === 'all' ? patterns.length > 0 : patterns.includes(pattern);
  if (!hasPattern) {
    return {
      success: false,
      source: 'bpa-file',
      error: `Pattern '${pattern}' not found in BPA report`,
      message: `Pattern '${pattern}' not found. Available patterns: ${patterns.join(', ')}`,
      availablePatterns: patterns
    };
  }

  const summary = getUnifiedCollectionSummary(collectionsDir);
  const result = fetchUnifiedBpaFindings(pattern, collectionsDir, { offset, limit });
  result.source = 'bpa-file';
  result.message = `Using CSV collection (${summary?.totalFindings ?? result.paging.total} findings, ${formatTimestamp(summary?.timestamp)}).`;
  return result;
}

/**
 * Check what BPA sources are currently available.
 */
function checkAvailableSources(options = {}) {
  const {
    bpaFilePath,
    collectionsDir = DEFAULT_COLLECTIONS_DIR,
    mcpFetcher,
    projectId
  } = options;

  const sources = {
    unifiedCollection: {
      available: hasUnifiedCollection(collectionsDir),
      patterns: [],
      path: collectionsDir,
      summary: null
    },
    bpaFile: {
      available: false,
      path: bpaFilePath || null
    },
    mcpServer: {
      available: !!(mcpFetcher && projectId),
      projectId: projectId || null,
      cached: !!(projectId && readMcpCache(collectionsDir, projectId, 'all'))
    }
  };

  if (sources.unifiedCollection.available) {
    sources.unifiedCollection.patterns = getAvailablePatterns(collectionsDir);
    sources.unifiedCollection.summary = getUnifiedCollectionSummary(collectionsDir);
  }

  if (bpaFilePath) {
    try {
      validateBpaFile(bpaFilePath);
      sources.bpaFile.available = true;
    } catch (e) {
      sources.bpaFile.available = false;
      sources.bpaFile.error = e.message;
    }
  }

  return sources;
}

/**
 * Format an ISO timestamp into a human-readable relative string.
 */
function formatTimestamp(isoTimestamp) {
  if (!isoTimestamp) return 'unknown date';
  try {
    const date = new Date(isoTimestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } catch {
    return isoTimestamp;
  }
}

/**
 * CLI interface for testing
 *
 * Usage: node bpa-findings-helper.js <pattern> [collectionsDir] [bpaFilePath] [offset] [limit]
 *   offset defaults to 0
 *   limit  defaults to 5 (use 'all' to disable batching)
 */
async function main() {
  const args = process.argv.slice(2);
  const pattern = args[0] || 'all';
  const collectionsDir = args[1] || DEFAULT_COLLECTIONS_DIR;
  const bpaFilePath = args[2];
  const offset = args[3] !== undefined ? Number(args[3]) : 0;
  const limit = args[4] === 'all' ? null
    : args[4] !== undefined ? Number(args[4])
    : DEFAULT_BATCH_SIZE;

  console.log('BPA Findings Helper');
  console.log('==================');
  console.log(`Pattern: ${pattern}`);
  console.log(`Collections Dir: ${collectionsDir}`);
  if (bpaFilePath) console.log(`BPA File: ${bpaFilePath}`);
  console.log(`Offset: ${offset}`);
  console.log(`Limit:  ${limit === null ? 'all' : limit}`);
  console.log('');

  const sources = checkAvailableSources({ collectionsDir, bpaFilePath });

  console.log('Available Sources:');
  console.log(`  Unified Collection: ${sources.unifiedCollection.available ? '✅' : '❌'}`);
  if (sources.unifiedCollection.available) {
    console.log(`    Patterns: ${sources.unifiedCollection.patterns.join(', ')}`);
    console.log(`    Created: ${sources.unifiedCollection.summary?.timestamp || 'unknown'}`);
  }
  console.log(`  BPA File: ${sources.bpaFile.available ? '✅' : '❌'} ${sources.bpaFile.path || '(not provided)'}`);
  console.log(`  MCP Server: ${sources.mcpServer.available ? '✅' : '❌'}`);
  console.log('');

  const result = await getBpaFindings(pattern, { collectionsDir, bpaFilePath, offset, limit });

  console.log(`Source: ${result.source}`);
  console.log(`Message: ${result.message}`);
  console.log('');

  if (result.success) {
    const p = result.paging;
    console.log(p
      ? `✅ Batch ${p.returned}/${p.total} (offset ${p.offset}, next ${p.nextOffset ?? 'none'}, hasMore=${p.hasMore})`
      : `✅ Loaded ${result.targets.length} findings`);
    if (result.summary) {
      Object.entries(result.summary).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
  } else {
    console.error(`❌ ${result.error}`);
    if (result.troubleshooting?.length > 0) {
      console.error('');
      console.error('Troubleshooting:');
      result.troubleshooting.forEach(tip => console.error(`  - ${tip}`));
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getBpaFindings,
  checkAvailableSources
};
