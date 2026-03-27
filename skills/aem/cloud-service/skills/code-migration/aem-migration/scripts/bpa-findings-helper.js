/**
 * BPA Findings Helper
 * 
 * Provides a seamless interface for getting BPA findings. The skill calls this
 * helper and it handles everything automatically:
 * 
 * 1. Check if unified collection already exists → use it
 * 2. If not, and BPA CSV path provided → parse it, create collection, then use it
 * 3. If no BPA path → try MCP server
 * 4. If nothing available → return guidance for manual flow
 */

const path = require('path');
const fs = require('fs');
const { hasUnifiedCollection, fetchUnifiedBpaFindings, getAvailablePatterns, getUnifiedCollectionSummary } = require('./unified-collection-reader.js');
const { validateBpaFile, parseBpaFile, createUnifiedCollection } = require('./bpa-local-parser.js');

const DEFAULT_COLLECTIONS_DIR = './unified-collections';

/**
 * Get BPA findings with automatic collection management.
 * 
 * Flow:
 *   1. Unified collection exists? → Use it directly
 *   2. BPA CSV file provided? → Create collection, then use it
 *   3. MCP server available? → Fetch from MCP
 *   4. Nothing available → Return manual flow guidance
 * 
 * @param {string} pattern - Pattern to fetch ('scheduler', 'assetApi', 'all', etc.)
 * @param {Object} options
 * @param {string} [options.bpaFilePath] - Path to BPA CSV file
 * @param {string} [options.collectionsDir] - Where to store/read unified collections
 * @param {string} [options.projectId] - Cloud Manager project ID (for MCP fallback)
 * @param {string} [options.environment] - Environment (for MCP)
 * @param {Function} [options.mcpFetcher] - MCP fetcher function
 * @returns {Object} BPA findings result with `source` and `message` fields
 */
async function getBpaFindings(pattern = 'all', options = {}) {
  const {
    bpaFilePath,
    collectionsDir = DEFAULT_COLLECTIONS_DIR,
    projectId,
    environment = 'prod',
    mcpFetcher
  } = options;

  // ── 1. Check for existing unified collection ──
  if (hasUnifiedCollection(collectionsDir)) {
    const availablePatterns = getAvailablePatterns(collectionsDir);
    const hasPattern = pattern === 'all'
      ? availablePatterns.length > 0
      : availablePatterns.includes(pattern);

    if (hasPattern) {
      const summary = getUnifiedCollectionSummary(collectionsDir);
      const result = fetchUnifiedBpaFindings(pattern, collectionsDir);
      result.source = 'unified-collection';
      result.message = `Using existing BPA collection (${summary?.totalFindings || result.targets.length} findings across ${availablePatterns.length} patterns, created ${formatTimestamp(summary?.timestamp)})`;
      return result;
    }
  }

  // ── 2. BPA CSV file provided → parse and create collection ──
  if (bpaFilePath) {
    try {
      validateBpaFile(bpaFilePath);

      const bpaData = parseBpaFile(bpaFilePath);
      const summary = createUnifiedCollection(bpaData, collectionsDir);

      const availablePatterns = getAvailablePatterns(collectionsDir);
      const hasPattern = pattern === 'all'
        ? availablePatterns.length > 0
        : availablePatterns.includes(pattern);

      if (!hasPattern) {
        return {
          success: false,
          source: 'bpa-file',
          error: `Pattern '${pattern}' not found in BPA report`,
          message: `Processed BPA report but pattern '${pattern}' was not found. Available patterns: ${availablePatterns.join(', ')}`,
          availablePatterns
        };
      }

      const result = fetchUnifiedBpaFindings(pattern, collectionsDir);
      result.source = 'bpa-file';
      result.message = `Processed BPA report (${summary?.totalFindings || 0} findings across ${summary?.subtypes?.length || 0} patterns). Collection saved for future use.`;
      return result;
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

  // ── 3. Try MCP server ──
  if (mcpFetcher && projectId) {
    try {
      const result = await mcpFetcher({ projectId, pattern, environment });
      if (result) {
        result.source = 'mcp-server';
        result.message = `Fetched findings from MCP server (project: ${projectId})`;
        return result;
      }
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

  // ── 4. Nothing available → guide the user ──
  return {
    success: false,
    source: 'no-source',
    error: 'No BPA findings source available',
    message: 'No BPA data found. Please provide a BPA CSV file path, or use the manual flow for specific files.',
    troubleshooting: [
      'Provide the path to your BPA CSV report',
      'Or provide MCP server access with projectId',
      'Or point to specific Java files for manual migration'
    ]
  };
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
      projectId: projectId || null
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
 */
async function main() {
  const args = process.argv.slice(2);
  const pattern = args[0] || 'all';
  const collectionsDir = args[1] || DEFAULT_COLLECTIONS_DIR;
  const bpaFilePath = args[2];

  console.log('BPA Findings Helper');
  console.log('==================');
  console.log(`Pattern: ${pattern}`);
  console.log(`Collections Dir: ${collectionsDir}`);
  if (bpaFilePath) console.log(`BPA File: ${bpaFilePath}`);
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

  const result = await getBpaFindings(pattern, { collectionsDir, bpaFilePath });

  console.log(`Source: ${result.source}`);
  console.log(`Message: ${result.message}`);
  console.log('');

  if (result.success) {
    console.log(`✅ Loaded ${result.targets.length} findings`);
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
