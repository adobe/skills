/**
 * Unified Collection Reader
 * 
 * Reads unified code transformer collections (cloud-adoption-service format)
 * and returns data in the same format as the CAM BPA fetcher MCP tool.
 */

const fs = require('fs');
const path = require('path');

// Default batch size for paged access to findings. Keep this in sync with
// the documented batch size in migration/SKILL.md and cam-mcp.md.
const DEFAULT_BATCH_SIZE = 5;

// Pattern to subtype mapping (matching cam-bpa-fetcher.ts)
const PATTERN_TO_SUBTYPE = {
  scheduler: "sling.commons.scheduler",
  assetApi: "unsupported.asset.api",
  eventListener: "javax.jcr.observation.EventListener",
  resourceChangeListener: "org.apache.sling.api.resource.observation.ResourceChangeListener", 
  eventHandler: "org.osgi.service.event.EventHandler"
};

// MongoDB-safe to pattern mapping
const MONGO_SAFE_TO_PATTERN = {
  "sling_commons_scheduler": "scheduler",
  "unsupported_asset_api": "assetApi",
  "javax_jcr_observation_EventListener": "eventListener",
  "org_apache_sling_api_resource_observation_ResourceChangeListener": "resourceChangeListener",
  "org_osgi_service_event_EventHandler": "eventHandler"
};

// Known scheduler identifier
const SCHEDULER_IDENTIFIER = "org.apache.sling.commons.scheduler";

/**
 * BPA Target type (matching cam-bpa-fetcher.ts)
 */
class BpaTarget {
  constructor(pattern, className, identifier, issue, severity = "high") {
    this.pattern = pattern;
    this.className = className;
    this.identifier = identifier;
    this.issue = issue;
    this.severity = severity;
  }
}

/**
 * BPA Result type (matching cam-bpa-fetcher.ts)
 */
class BpaResult {
  constructor(success = false) {
    this.success = success;
    this.environment = 'local';
    this.projectId = 'unified-collection';
    this.targets = [];
    this.summary = {};
    this.message = null;
    this.error = null;
    this.errorDetails = null;
    this.troubleshooting = [];
    this.suggestion = [];
  }
}

/**
 * Convert MongoDB-safe field name back to original format
 */
function fromMongoSafeFieldName(mongoSafeFieldName) {
  return mongoSafeFieldName ? mongoSafeFieldName.replace(/_/g, '.') : null;
}

/**
 * Slice a flat array of findings and return `{ targets, paging }`.
 *
 * Caller must produce `items` in a stable, deterministic order so that
 * incrementing `offset` across calls yields contiguous, non-overlapping batches.
 * `limit: null` disables batching (returns everything).
 */
function paginate(items, { offset = 0, limit = DEFAULT_BATCH_SIZE } = {}) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const start = Math.max(0, Math.floor(Number(offset)) || 0);
  const unbounded = limit === null;
  const size = unbounded ? total : Math.max(1, Math.floor(Number(limit)) || DEFAULT_BATCH_SIZE);
  const targets = list.slice(start, unbounded ? total : start + size);
  const reached = start + targets.length;
  const nextOffset = reached < total ? reached : null;
  return {
    targets,
    paging: {
      total,
      returned: targets.length,
      offset: start,
      limit: unbounded ? null : size,
      nextOffset,
      hasMore: nextOffset !== null
    }
  };
}

/**
 * Check if unified collection exists
 */
function hasUnifiedCollection(collectionsDir = './unified-collections') {
  const unifiedPath = path.join(collectionsDir, 'unified-collection.json');
  try {
    return fs.existsSync(unifiedPath) && fs.statSync(unifiedPath).isFile();
  } catch (error) {
    return false;
  }
}

/**
 * Get available patterns in unified collection
 */
function getAvailablePatterns(collectionsDir = './unified-collections') {
  if (!hasUnifiedCollection(collectionsDir)) {
    return [];
  }
  
  try {
    const unifiedCollection = readUnifiedCollection(collectionsDir);
    if (!unifiedCollection || !unifiedCollection.subtypes) {
      return [];
    }
    
    const patterns = Object.keys(unifiedCollection.subtypes)
      .map(mongoSafeSubtype => MONGO_SAFE_TO_PATTERN[mongoSafeSubtype])
      .filter(pattern => pattern);
    
    return patterns;
  } catch (error) {
    console.error('Error reading unified collection:', error.message);
    return [];
  }
}

/**
 * Read unified collection file
 */
function readUnifiedCollection(collectionsDir = './unified-collections') {
  const unifiedPath = path.join(collectionsDir, 'unified-collection.json');
  
  if (!fs.existsSync(unifiedPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(unifiedPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading unified collection:', error.message);
    return null;
  }
}

/**
 * Process scheduler data from unified collection
 */
function processSchedulerFromUnified(subtypeData, targets) {
  let count = 0;
  
  // Sort identifiers alphabetically so the iteration order is deterministic
  // across runs, independent of how the unified-collection JSON was written.
  const identifierKeys = Object.keys(subtypeData || {}).sort();
  for (const mongoSafeIdentifier of identifierKeys) {
    const classNames = subtypeData[mongoSafeIdentifier] || [];
    const identifier = fromMongoSafeFieldName(mongoSafeIdentifier);
    
    for (const className of classNames) {
      count++;
      targets.push(new BpaTarget(
        "scheduler",
        className,
        identifier,
        "Uses imperative Scheduler API instead of declarative @SlingScheduled annotation",
        "high"
      ));
    }
  }
  
  return count;
}

/**
 * Process asset API data from unified collection
 */
function processAssetApiFromUnified(subtypeData, targets) {
  let count = 0;
  
  // Sort identifiers alphabetically so the iteration order is deterministic
  // across runs, independent of how the unified-collection JSON was written.
  const identifierKeys = Object.keys(subtypeData || {}).sort();
  for (const mongoSafeIdentifier of identifierKeys) {
    const classNames = subtypeData[mongoSafeIdentifier] || [];
    const identifier = fromMongoSafeFieldName(mongoSafeIdentifier);
    
    for (const className of classNames) {
      count++;
      targets.push(new BpaTarget(
        "assetApi",
        className,
        identifier,
        `Uses unsupported Asset API: ${identifier}`,
        "critical"
      ));
    }
  }
  
  return count;
}

/**
 * Process event listener data from unified collection
 */
function processEventListenerFromUnified(subtypeData, targets) {
  let count = 0;
  
  // Sort identifiers alphabetically so the iteration order is deterministic
  // across runs, independent of how the unified-collection JSON was written.
  const identifierKeys = Object.keys(subtypeData || {}).sort();
  for (const mongoSafeIdentifier of identifierKeys) {
    const classNames = subtypeData[mongoSafeIdentifier] || [];
    const identifier = fromMongoSafeFieldName(mongoSafeIdentifier);
    
    for (const className of classNames) {
      count++;
      targets.push(new BpaTarget(
        "eventListener",
        className,
        identifier,
        `Uses JCR Event Listener: ${identifier}`,
        "high"
      ));
    }
  }
  
  return count;
}

/**
 * Process resource change listener data from unified collection
 */
function processResourceChangeListenerFromUnified(subtypeData, targets) {
  let count = 0;
  
  // Sort identifiers alphabetically so the iteration order is deterministic
  // across runs, independent of how the unified-collection JSON was written.
  const identifierKeys = Object.keys(subtypeData || {}).sort();
  for (const mongoSafeIdentifier of identifierKeys) {
    const classNames = subtypeData[mongoSafeIdentifier] || [];
    const identifier = fromMongoSafeFieldName(mongoSafeIdentifier);
    
    for (const className of classNames) {
      count++;
      targets.push(new BpaTarget(
        "resourceChangeListener",
        className,
        identifier,
        `Uses Resource Change Listener: ${identifier}`,
        "high"
      ));
    }
  }
  
  return count;
}

/**
 * Process event handler data from unified collection
 */
function processEventHandlerFromUnified(subtypeData, targets) {
  let count = 0;
  
  // Sort identifiers alphabetically so the iteration order is deterministic
  // across runs, independent of how the unified-collection JSON was written.
  const identifierKeys = Object.keys(subtypeData || {}).sort();
  for (const mongoSafeIdentifier of identifierKeys) {
    const classNames = subtypeData[mongoSafeIdentifier] || [];
    const identifier = fromMongoSafeFieldName(mongoSafeIdentifier);
    
    for (const className of classNames) {
      count++;
      targets.push(new BpaTarget(
        "eventHandler",
        className,
        identifier,
        `Uses OSGi Event Handler: ${identifier}`,
        "high"
      ));
    }
  }
  
  return count;
}

/**
 * Fetch findings from unified collection (mimics cam-bpa-fetcher behavior).
 *
 * The full ordered list for the requested `pattern` is assembled, then
 * sliced into a batch via {@link paginate}. The returned object contains
 * `targets` (the batch) and `paging` (batch metadata for resuming).
 *
 * Ordering contract: for a given unified-collection.json file and a given
 * `pattern`, successive calls with incrementing `offset` return contiguous,
 * non-overlapping batches covering the full list.
 *
 * @param {string} pattern
 * @param {string} collectionsDir
 * @param {{offset?: number, limit?: number|null|'all'}} [paging]
 */
function fetchUnifiedBpaFindings(pattern = "all", collectionsDir = './unified-collections', paging = {}) {
  const result = new BpaResult();
  
  // Check if unified collection exists
  if (!hasUnifiedCollection(collectionsDir)) {
    result.error = `Unified collection not found: ${collectionsDir}/unified-collection.json`;
    result.troubleshooting = [
      "Run bpa-local-parser.js with --unified flag to create unified collection",
      "Ensure the collections directory path is correct",
      "Check that BPA file has been processed successfully"
    ];
    result.suggestion = [
      "Use: node bpa-local-parser.js <bpa-file-path> [output-directory] --unified",
      "Verify BPA file contains valid findings data"
    ];
    return result;
  }
  
  // Read unified collection
  const unifiedCollection = readUnifiedCollection(collectionsDir);
  if (!unifiedCollection || !unifiedCollection.subtypes) {
    result.error = "Invalid unified collection format";
    result.troubleshooting = [
      "Check that unified-collection.json contains valid JSON",
      "Verify the file has 'subtypes' property",
      "Re-run bpa-local-parser.js if file is corrupted"
    ];
    return result;
  }
  
  // Determine patterns to fetch
  const availablePatterns = getAvailablePatterns(collectionsDir);
  
  if (availablePatterns.length === 0) {
    result.error = "No valid pattern collections found in unified collection";
    result.troubleshooting = [
      "Check that unified collection contains supported subtypes",
      "Verify pattern files contain valid data",
      "Re-run bpa-local-parser.js if data is missing"
    ];
    return result;
  }
  
  // Sort patterns alphabetically so "all" returns findings in a deterministic
  // order independent of how availablePatterns was produced.
  const patternsToFetch = pattern === "all"
    ? [...availablePatterns].sort()
    : availablePatterns.filter(p => p === pattern);
  
  if (patternsToFetch.length === 0) {
    result.error = `Pattern '${pattern}' not found in unified collection. Available: ${availablePatterns.join(', ')}`;
    result.suggestion = [
      `Use one of: ${availablePatterns.join(', ')}, all`,
      "Check that the requested pattern was included in the BPA report"
    ];
    return result;
  }
  
  console.log(`[Unified Collection Reader] Reading patterns: ${patternsToFetch.join(', ')}`);
  
  // Process each pattern
  for (const pat of patternsToFetch) {
    const mongoSafeSubtype = Object.keys(MONGO_SAFE_TO_PATTERN).find(key => 
      MONGO_SAFE_TO_PATTERN[key] === pat
    );
    
    if (!mongoSafeSubtype) {
      console.warn(`[Unified Collection Reader] Unknown pattern: ${pat}, skipping`);
      continue;
    }
    
    const subtypeData = unifiedCollection.subtypes[mongoSafeSubtype];
    if (!subtypeData) {
      console.warn(`[Unified Collection Reader] No data for pattern: ${pat}, skipping`);
      continue;
    }
    
    // Process data based on pattern type
    let count = 0;
    if (pat === "scheduler") {
      count = processSchedulerFromUnified(subtypeData, result.targets);
      result.summary.schedulerCount = count;
    } else if (pat === "assetApi") {
      count = processAssetApiFromUnified(subtypeData, result.targets);
      result.summary.assetApiCount = count;
    } else if (pat === "eventListener") {
      count = processEventListenerFromUnified(subtypeData, result.targets);
      result.summary.eventListenerCount = count;
    } else if (pat === "resourceChangeListener") {
      count = processResourceChangeListenerFromUnified(subtypeData, result.targets);
      result.summary.resourceChangeListenerCount = count;
    } else if (pat === "eventHandler") {
      count = processEventHandlerFromUnified(subtypeData, result.targets);
      result.summary.eventHandlerCount = count;
    }
    
    console.log(`[Unified Collection Reader] Processed ${count} findings for pattern: ${pat}`);
  }
  
  if (result.targets.length === 0) {
    result.error = "No findings found in unified collection";
    result.suggestion = [
      "Verify that BPA file contained relevant findings",
      "Check that bpa-local-parser.js processed the file correctly",
      "Inspect unified collection file for expected data structure"
    ];
    return result;
  }

  const { targets, paging: p } = paginate(result.targets, paging);
  result.targets = targets;
  result.paging = p;
  result.success = true;
  console.log(
    `[Unified Collection Reader] Batch ${p.returned}/${p.total} ` +
    `(offset ${p.offset}, hasMore=${p.hasMore})`
  );
  return result;
}

/**
 * Get summary of unified collection (derived from unified-collection.json).
 * Returns { timestamp, subtypes, totalFindings } for display purposes.
 */
function getUnifiedCollectionSummary(collectionsDir = './unified-collections') {
  const unifiedCollection = readUnifiedCollection(collectionsDir);
  if (!unifiedCollection || !unifiedCollection.subtypes) {
    return null;
  }

  const subtypes = Object.keys(unifiedCollection.subtypes);
  let totalFindings = 0;
  for (const subtypeKey of subtypes) {
    const subtypeData = unifiedCollection.subtypes[subtypeKey] || {};
    for (const classNames of Object.values(subtypeData)) {
      totalFindings += (classNames || []).length;
    }
  }

  return {
    timestamp: unifiedCollection.meta?.timestamp || null,
    subtypes,
    totalFindings: unifiedCollection.meta?.totalFindings ?? totalFindings
  };
}

/**
 * CLI interface for testing
 *
 * Usage: node unified-collection-reader.js <pattern> [collectionsDir] [offset] [limit]
 *   offset defaults to 0
 *   limit  defaults to 5 (use 'all' to disable batching)
 */
function main() {
  const args = process.argv.slice(2);
  const pattern = args[0] || 'all';
  const collectionsDir = args[1] || './unified-collections';
  const offset = args[2] !== undefined ? Number(args[2]) : 0;
  const limit = args[3] !== undefined
    ? (args[3] === 'all' ? null : Number(args[3]))
    : DEFAULT_BATCH_SIZE;

  console.log('Unified Collection Reader');
  console.log('========================');
  console.log(`Pattern: ${pattern}`);
  console.log(`Collections Directory: ${collectionsDir}`);
  console.log(`Offset: ${offset}`);
  console.log(`Limit:  ${limit === null ? 'all' : limit}`);
  console.log('');
  
  // Check if unified collection exists
  if (!hasUnifiedCollection(collectionsDir)) {
    console.error(`❌ Unified collection not found: ${collectionsDir}/unified-collection.json`);
    console.error('');
    console.error('To create unified collection:');
    console.error('  node bpa-local-parser.js <bpa-file-path> [output-directory] --unified');
    process.exit(1);
  }
  
  // Show available patterns
  const availablePatterns = getAvailablePatterns(collectionsDir);
  console.log(`Available patterns: ${availablePatterns.join(', ')}`);
  
  // Show summary
  const summary = getUnifiedCollectionSummary(collectionsDir);
  if (summary) {
    console.log(`Total subtypes: ${summary.subtypes?.length || 0}`);
    console.log(`Total findings: ${summary.totalFindings || 0}`);
    console.log(`Created: ${summary.timestamp || '(unknown)'}`);
  }
  
  console.log('');
  
  // Fetch findings
  const result = fetchUnifiedBpaFindings(pattern, collectionsDir, { offset, limit });

  if (result.success) {
    const p = result.paging;
    console.log(`✅ Batch ${p.returned}/${p.total} (offset ${p.offset}, next ${p.nextOffset ?? 'none'}, hasMore=${p.hasMore})`);
    console.log('');
    
    // Group by pattern
    const byPattern = result.targets.reduce((acc, target) => {
      if (!acc[target.pattern]) acc[target.pattern] = [];
      acc[target.pattern].push(target);
      return acc;
    }, {});
    
    Object.entries(byPattern).forEach(([pat, targets]) => {
      console.log(`${pat.toUpperCase()}:`);
      targets.forEach(target => {
        console.log(`  - ${target.className} (${target.severity}): ${target.issue}`);
      });
      console.log('');
    });
  } else {
    console.error('❌ Error:', result.error);
    if (result.troubleshooting?.length > 0) {
      console.error('');
      console.error('Troubleshooting:');
      result.troubleshooting.forEach(tip => console.error(`  - ${tip}`));
    }
    if (result.suggestion?.length > 0) {
      console.error('');
      console.error('Suggestions:');
      result.suggestion.forEach(tip => console.error(`  - ${tip}`));
    }
    process.exit(1);
  }
}

// Run CLI if called directly
if (require.main === module) {
  main();
}

module.exports = {
  hasUnifiedCollection,
  getAvailablePatterns,
  fetchUnifiedBpaFindings,
  getUnifiedCollectionSummary,
  readUnifiedCollection,
  paginate,
  DEFAULT_BATCH_SIZE,
  BpaTarget,
  BpaResult
};
