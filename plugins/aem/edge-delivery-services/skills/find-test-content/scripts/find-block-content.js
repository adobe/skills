#!/usr/bin/env node

/**
 * Find pages containing a specific block in AEM Edge Delivery projects.
 *
 * This script queries the query-index to find instances of a block,
 * helping developers identify existing content for testing during development.
 *
 * Usage:
 *   node find-block-content.js <block-name> [host] [--concurrency N] [--delay MS]
 *
 * Examples:
 *   node find-block-content.js hero
 *   node find-block-content.js hero localhost:3000
 *   node find-block-content.js hero main--mysite--owner.aem.live
 *   node find-block-content.js hero main--mysite--owner.aem.page
 *   node find-block-content.js hero main--mysite--owner.aem.page --concurrency 3 --delay 100
 *
 * The script will:
 * 1. Query the site's query-index for all pages
 * 2. Check each page for the specified block (with retry on 429/503)
 * 3. Report all pages containing the block with their URLs and variant info
 * 4. Report any pages that could not be checked after retries
 *
 * Defaults to localhost:3000 if no host specified
 */

import { JSDOM } from 'jsdom';

const USER_AGENT = 'AdobeSkills/1.0 (https://github.com/adobe/skills; skill:find-test-content)';

/** Maximum number of retry attempts for a single request. */
const MAX_RETRIES = 4;

/** Base delay in ms for exponential backoff when no Retry-After header is present. */
const BASE_BACKOFF_MS = 1000;

/** Upper bound for computed backoff delay (before jitter). */
const MAX_BACKOFF_MS = 30000;

/** HTTP status codes that are retryable (transient). */
const RETRYABLE_STATUSES = new Set([429, 503]);

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a Retry-After header value into a delay in milliseconds.
 * The header may be a non-negative integer (seconds) or an HTTP-date.
 * Returns null if the header is absent or unparseable.
 * @param {string|null} headerValue
 * @returns {number|null} delay in ms, or null
 */
function parseRetryAfter(headerValue) {
  if (!headerValue) return null;

  // Try as integer seconds first
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  // Try as HTTP-date
  const date = new Date(headerValue);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return Math.max(0, delayMs);
  }

  return null;
}

/**
 * Compute backoff delay for a given attempt number.
 * Uses exponential backoff with jitter, capped at MAX_BACKOFF_MS.
 * @param {number} attempt - zero-based attempt number
 * @returns {number} delay in ms
 */
function computeBackoff(attempt) {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** attempt));
  // Add jitter: 0.5x to 1.0x of the computed delay
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(exponential * jitter);
}

/**
 * Fetch a URL with retry on transient errors (429, 503).
 * Honours Retry-After header when present.
 * @param {string} url
 * @param {object} options - fetch options
 * @param {number} maxRetries
 * @returns {Promise<{response: Response|null, error: string|null, retryExhausted: boolean}>}
 */
async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetch(url, options);

      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
        const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
        const delay = retryAfterMs != null
          ? Math.min(retryAfterMs, MAX_BACKOFF_MS)
          : computeBackoff(attempt);
        await sleep(delay);
        continue;
      }

      return { response: res, error: null, retryExhausted: false };
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(computeBackoff(attempt));
        continue;
      }
      return { response: null, error: err.message, retryExhausted: true };
    }
  }
  // Should not reach here, but guard
  return { response: null, error: 'max retries exceeded', retryExhausted: true };
}

/**
 * Fetch all URLs from the query index with pagination.
 * Retries on 429/503. If pagination cannot complete, returns what was
 * collected and sets the truncated flag.
 * @param {string} host - The host to query
 * @returns {Promise<{paths: string[], truncated: boolean, truncationReason: string|null}>}
 */
async function fetchQueryIndex(host) {
  const limit = 512;
  let offset = 0;
  const paths = [];
  let more = true;
  let truncated = false;
  let truncationReason = null;

  do {
    // Use http for localhost, https for everything else
    const protocol = host.startsWith('localhost') ? 'http' : 'https';
    const url = `${protocol}://${host}/query-index.json?offset=${offset}&limit=${limit}`;

    const { response: res, error, retryExhausted } = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (error || !res) {
      truncated = true;
      truncationReason = `Network error fetching query index at offset ${offset}: ${error}`;
      console.error(truncationReason);
      break;
    }

    if (!res.ok) {
      truncated = true;
      truncationReason = `HTTP ${res.status} fetching query index at offset ${offset}${retryExhausted ? ' (after retries)' : ''}`;
      console.error(truncationReason);
      break;
    }

    try {
      const json = await res.json();
      const data = json.data || [];

      data.forEach((item) => {
        if (item.path) {
          paths.push(item.path);
        }
      });

      more = data.length === limit;
      offset += limit;
    } catch (err) {
      truncated = true;
      truncationReason = `Error parsing query index response at offset ${offset}: ${err.message}`;
      console.error(truncationReason);
      break;
    }
  } while (more);

  return { paths, truncated, truncationReason };
}

/**
 * Result from checking a single page for a block.
 * - found: { status: 'found', count, variants }
 * - absent: { status: 'absent' }
 * - error: { status: 'error', reason }
 */

/**
 * Check if a page contains the specified block and extract variant info.
 * Retries on 429/503. Distinguishes three outcomes: found, absent, error.
 * @param {string} host - The host to query
 * @param {string} path - The page path
 * @param {string} blockName - Name of block to find
 * @returns {Promise<{status: string, count?: number, variants?: string[], reason?: string}>}
 */
async function pageContainsBlock(host, path, blockName) {
  // Use http for localhost, https for everything else
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const url = `${protocol}://${host}${path}`;

  const { response: res, error } = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (error || !res) {
    return { status: 'error', reason: error || 'no response' };
  }

  if (!res.ok) {
    return { status: 'error', reason: `HTTP ${res.status}` };
  }

  try {
    const html = await res.text();

    // Parse HTML with jsdom
    const dom = new JSDOM(html);
    const { document } = dom.window;

    // Look for block using proper DOM query
    // Blocks appear as elements with the block name as a class
    const selector = `.${blockName}`;
    const blockElements = document.querySelectorAll(selector);

    if (blockElements.length === 0) {
      return { status: 'absent' };
    }

    // Extract variants from all block instances
    const variants = new Set();
    Array.from(blockElements).forEach((element) => {
      // Get all classes except the block name itself
      Array.from(element.classList).forEach((className) => {
        if (className !== blockName && className !== 'block') {
          variants.add(className);
        }
      });
    });

    return {
      status: 'found',
      count: blockElements.length,
      variants: Array.from(variants).sort(),
    };
  } catch (err) {
    return { status: 'error', reason: `Parse error: ${err.message}` };
  }
}

/**
 * Process URLs in batches with concurrency control.
 * Tracks pages that could not be checked (errors after retries).
 * @param {string} host - The host to query
 * @param {string[]} paths - Array of page paths
 * @param {string} blockName - Name of block to find
 * @param {number} concurrency - Number of concurrent requests
 * @param {number} delayMs - Minimum delay between launching successive requests (ms)
 * @returns {Promise<{matches: Array, errors: Array}>}
 */
async function findBlockInPages(host, paths, blockName, concurrency = 5, delayMs = 50) {
  const matches = [];
  const errors = [];
  const inFlight = new Set();

  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];

    const promise = pageContainsBlock(host, path, blockName).then((result) => {
      if (result.status === 'found') {
        matches.push({
          path,
          count: result.count,
          variants: result.variants,
        });
      } else if (result.status === 'error') {
        errors.push({ path, reason: result.reason });
      }
      inFlight.delete(promise);
    });

    inFlight.add(promise);

    // Inter-request delay to avoid bursting
    if (delayMs > 0 && i < paths.length - 1) {
      await sleep(delayMs);
    }

    // Wait if we've hit concurrency limit
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
  }

  // Wait for remaining requests
  await Promise.all(inFlight);

  return { matches, errors };
}

/**
 * Get the host to query
 * @param {string} host - Host string or undefined for default
 * @returns {string} The host to query
 */
function getHost(host) {
  if (!host) {
    return 'localhost:3000';
  }

  // Strip https:// or http:// if provided
  return host.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Parse CLI arguments.
 * Positional: <block-name> [host]
 * Flags: --concurrency N, --delay MS
 */
function parseArgs(argv) {
  const args = { blockName: null, host: null, concurrency: 5, delay: 50 };
  const positional = [];

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--concurrency' && i + 1 < argv.length) {
      i += 1;
      args.concurrency = Math.max(1, parseInt(argv[i], 10) || 5);
    } else if (arg === '--delay' && i + 1 < argv.length) {
      i += 1;
      args.delay = Math.max(0, parseInt(argv[i], 10) || 0);
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  args.blockName = positional[0] || null;
  args.host = positional[1] || null;
  return args;
}

/**
 * Main execution
 */
async function main() {
  const args = parseArgs(process.argv);

  if (!args.blockName) {
    console.error('Error: Block name is required');
    console.error('\nUsage: node find-block-content.js <block-name> [host] [--concurrency N] [--delay MS]');
    console.error('\nOptions:');
    console.error('  --concurrency N   Max concurrent requests (default: 5)');
    console.error('  --delay MS        Min delay between requests in ms (default: 50)');
    console.error('\nExamples:');
    console.error('  node find-block-content.js hero');
    console.error('  node find-block-content.js hero localhost:3000');
    console.error('  node find-block-content.js hero main--mysite--owner.aem.live');
    console.error('  node find-block-content.js cards main--mysite--owner.aem.page');
    console.error('  node find-block-content.js hero main--mysite--owner.aem.page --concurrency 3 --delay 100');
    process.exit(1);
  }

  const host = getHost(args.host);

  // Fetch all pages from query index
  const { paths, truncated, truncationReason } = await fetchQueryIndex(host);

  if (paths.length === 0 && !truncated) {
    console.log('No pages found in query index.');
    console.log('\nMake sure:');
    console.log('- Your dev server is running (aem up)');
    console.log('- The site has been indexed');
    return;
  }

  if (truncated) {
    console.error(`\nWARNING: Query index pagination was incomplete. ${truncationReason}`);
    console.error(`Collected ${paths.length} path(s) before truncation. Results may be partial.\n`);
    if (paths.length === 0) {
      console.error('No paths collected. Cannot proceed.');
      process.exit(1);
    }
  }

  // Search for block in pages
  const { matches, errors } = await findBlockInPages(
    host, paths, args.blockName, args.concurrency, args.delay,
  );

  // Report results
  if (matches.length === 0 && errors.length === 0) {
    console.log(`No pages found containing the "${args.blockName}" block.`);
    console.log('\nThis might mean:');
    console.log('- The block is new and no content exists yet');
    console.log('- The block name is spelled differently');
    console.log('- Content exists but hasn\'t been published');
  } else if (matches.length === 0 && errors.length > 0) {
    console.log(`No pages confirmed to contain the "${args.blockName}" block.`);
  } else {
    console.log(`Found ${matches.length} page(s) containing the "${args.blockName}" block:\n`);

    matches.forEach((match, index) => {
      const protocol = host.startsWith('localhost') ? 'http' : 'https';
      const countInfo = match.count > 1 ? ` (${match.count} instances)` : '';
      const variantInfo = match.variants.length > 0 ? ` - variants: ${match.variants.join(', ')}` : '';
      console.log(`${index + 1}. ${protocol}://${host}${match.path}${countInfo}${variantInfo}`);
    });
  }

  // Report errors explicitly so the user knows the result may be incomplete
  if (errors.length > 0) {
    console.error(`\nWARNING: ${errors.length} page(s) could not be checked (after retries). Results are incomplete.`);
    errors.forEach((e) => {
      console.error(`  - ${e.path}: ${e.reason}`);
    });
  }

  if (truncated) {
    console.error('\nNOTE: The query index could not be fully retrieved. The page inventory is partial.');
  }
}

// Export for testing
export { fetchWithRetry, parseRetryAfter, computeBackoff, pageContainsBlock, fetchQueryIndex, findBlockInPages, sleep };

// Only run main() when executed directly (not when imported for testing)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('find-block-content.js')
  || process.argv[1].endsWith('find-block-content.mjs')
);

if (isDirectRun) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
