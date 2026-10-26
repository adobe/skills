/**
 * Unit tests for BPA findings helper (node --test).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getBpaFindings, checkAvailableSources } = require('./bpa-findings-helper.js');
const { paginate, DEFAULT_BATCH_SIZE } = require('./unified-collection-reader.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bpa-helper-test-'));
}

const MANY_CSV = path.join(__dirname, 'fixtures', 'many-scheduler-bpa.csv');
const MANY_CSV_TOTAL = 12; // classes in many-scheduler-bpa.csv

test('getBpaFindings with no CSV, collection, or MCP returns no-source', async () => {
  const dir = tempDir();
  const result = await getBpaFindings('scheduler', { collectionsDir: dir });
  assert.equal(result.success, false);
  assert.equal(result.source, 'no-source');
});

test('getBpaFindings uses mcpFetcher when projectId is set', async () => {
  const dir = tempDir();
  const mcpFetcher = async () => ({
    success: true,
    targets: [
      {
        pattern: 'scheduler',
        className: 'com.example.Job',
        identifier: 'org.apache.sling.commons.scheduler',
        issue: 'test'
      }
    ]
  });
  const result = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    projectId: 'proj-1',
    mcpFetcher
  });
  assert.equal(result.success, true);
  assert.equal(result.source, 'mcp-server');
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].className, 'com.example.Job');
});

test('getBpaFindings ingests BPA CSV into empty collections dir', async () => {
  const dir = tempDir();
  const csvPath = path.join(__dirname, 'fixtures', 'minimal-scheduler-bpa.csv');
  const result = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    bpaFilePath: csvPath
  });
  assert.equal(result.success, true);
  assert.equal(result.source, 'bpa-file');
  assert.ok(Array.isArray(result.targets));
  assert.ok(result.targets.length >= 1);
  assert.ok(
    result.targets.some(
      (t) => t.pattern === 'scheduler' && t.className.includes('SampleJob')
    )
  );
});

test('checkAvailableSources reflects MCP only when fetcher and projectId present', () => {
  const dir = tempDir();
  const noMcp = checkAvailableSources({ collectionsDir: dir });
  assert.equal(noMcp.mcpServer.available, false);

  const withMcp = checkAvailableSources({
    collectionsDir: dir,
    mcpFetcher: async () => ({}),
    projectId: 'p'
  });
  assert.equal(withMcp.mcpServer.available, true);
});

// ─────────────────────────────────────────────────────────────
// Batching: pure paginate()
// ─────────────────────────────────────────────────────────────

test('paginate() returns a batch of DEFAULT_BATCH_SIZE by default', () => {
  assert.equal(DEFAULT_BATCH_SIZE, 5);
  const items = Array.from({ length: 12 }, (_, i) => ({ i }));
  const { targets, paging } = paginate(items);
  assert.equal(targets.length, 5);
  assert.deepEqual(paging, {
    total: 12, returned: 5, offset: 0, limit: 5, nextOffset: 5, hasMore: true
  });
});

test('paginate() advances via nextOffset contiguously', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ i }));
  const seen = [];
  let offset = 0;
  for (let safety = 0; safety < 10; safety++) {
    const { targets, paging } = paginate(items, { offset, limit: 5 });
    for (const it of targets) seen.push(it.i);
    if (!paging.hasMore) break;
    offset = paging.nextOffset;
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('paginate() handles offset past end without error', () => {
  const { targets, paging } = paginate([{ i: 0 }, { i: 1 }], { offset: 5 });
  assert.equal(targets.length, 0);
  assert.equal(paging.hasMore, false);
  assert.equal(paging.nextOffset, null);
});

test('paginate() with limit=null returns everything', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ i }));
  const { targets, paging } = paginate(items, { limit: null });
  assert.equal(targets.length, 12);
  assert.equal(paging.hasMore, false);
  assert.equal(paging.limit, null);
});

// ─────────────────────────────────────────────────────────────
// Batching: local BPA CSV path end-to-end
// ─────────────────────────────────────────────────────────────

test('getBpaFindings (CSV path) returns a batch of 5 by default', async () => {
  const dir = tempDir();
  const r = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    bpaFilePath: MANY_CSV
  });
  assert.equal(r.success, true);
  assert.equal(r.source, 'bpa-file');
  assert.equal(r.targets.length, 5);
  assert.ok(r.paging);
  assert.equal(r.paging.total, MANY_CSV_TOTAL);
  assert.equal(r.paging.returned, 5);
  assert.equal(r.paging.offset, 0);
  assert.equal(r.paging.limit, 5);
  assert.equal(r.paging.nextOffset, 5);
  assert.equal(r.paging.hasMore, true);
});

test('CSV path advances by nextOffset with stable contiguous order', async () => {
  const dir = tempDir();

  // First call parses CSV → writes cache → returns first batch.
  const first = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    bpaFilePath: MANY_CSV
  });
  assert.equal(first.source, 'bpa-file');
  assert.equal(first.targets.length, 5);

  // Subsequent calls read the cache — same source, no re-parse.
  const second = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    offset: first.paging.nextOffset
  });
  assert.equal(second.source, 'bpa-file');
  assert.equal(second.targets.length, 5);
  assert.equal(second.paging.offset, 5);
  assert.equal(second.paging.nextOffset, 10);
  assert.equal(second.paging.hasMore, true);

  const third = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    offset: second.paging.nextOffset
  });
  assert.equal(third.source, 'bpa-file');
  assert.equal(third.targets.length, 2);
  assert.equal(third.paging.total, MANY_CSV_TOTAL);
  assert.equal(third.paging.offset, 10);
  assert.equal(third.paging.nextOffset, null);
  assert.equal(third.paging.hasMore, false);

  // No overlap, no gap.
  const allClassNames = [
    ...first.targets,
    ...second.targets,
    ...third.targets
  ].map((t) => t.className);
  assert.equal(new Set(allClassNames).size, allClassNames.length, 'batches must not overlap');
  assert.equal(allClassNames.length, MANY_CSV_TOTAL);
});

test('getBpaFindings (collection path) re-issuing the same offset returns the same batch', async () => {
  const dir = tempDir();
  await getBpaFindings('scheduler', { collectionsDir: dir, bpaFilePath: MANY_CSV });

  const a = await getBpaFindings('scheduler', { collectionsDir: dir, offset: 5 });
  const b = await getBpaFindings('scheduler', { collectionsDir: dir, offset: 5 });
  assert.deepEqual(
    a.targets.map((t) => t.className),
    b.targets.map((t) => t.className),
    'stable ordering: same offset, same batch'
  );
});

test('getBpaFindings (collection path) with limit=null returns every finding', async () => {
  const dir = tempDir();
  await getBpaFindings('scheduler', { collectionsDir: dir, bpaFilePath: MANY_CSV });
  const r = await getBpaFindings('scheduler', { collectionsDir: dir, limit: null });
  assert.equal(r.targets.length, MANY_CSV_TOTAL);
  assert.equal(r.paging.hasMore, false);
  assert.equal(r.paging.limit, null);
});

// ─────────────────────────────────────────────────────────────
// Batching: MCP path (one-shot fetch, cached to disk, paged client-side)
// ─────────────────────────────────────────────────────────────

/** MCP fetcher that returns `total` findings and counts how many times it was called. */
function mkCountingMcpFetcher(total) {
  const fetcher = async (args) => {
    fetcher.calls.push(args);
    return {
      success: true,
      targets: Array.from({ length: total }, (_, i) => ({
        pattern: 'scheduler',
        className: `com.example.Job${String(i).padStart(3, '0')}`,
        identifier: 'org.apache.sling.commons.scheduler',
        issue: 'mcp-test'
      }))
    };
  };
  fetcher.calls = [];
  return fetcher;
}

test('MCP path: first call fetches + caches + returns a batch of 5', async () => {
  const dir = tempDir();
  const mcpFetcher = mkCountingMcpFetcher(12);
  const r = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    projectId: 'proj-A',
    mcpFetcher
  });
  assert.equal(r.success, true);
  assert.equal(r.source, 'mcp-server');
  assert.equal(r.targets.length, 5);
  assert.equal(r.paging.total, 12);
  assert.equal(r.paging.offset, 0);
  assert.equal(r.paging.nextOffset, 5);
  assert.equal(r.paging.hasMore, true);

  // Cache file written in the expected location.
  const cacheFile = path.join(dir, 'mcp', 'proj-A', 'scheduler.json');
  assert.ok(fs.existsSync(cacheFile), 'MCP cache file should exist after first call');
});

test('MCP path: subsequent batches read the cache — mcpFetcher is called once', async () => {
  const dir = tempDir();
  const mcpFetcher = mkCountingMcpFetcher(12);

  // Drive three batches: 5 + 5 + 2.
  const seen = [];
  let offset = 0;
  for (let safety = 0; safety < 10; safety++) {
    const r = await getBpaFindings('scheduler', {
      collectionsDir: dir,
      projectId: 'proj-A',
      mcpFetcher,
      offset
    });
    for (const t of r.targets) seen.push(t.className);
    if (!r.paging.hasMore) break;
    offset = r.paging.nextOffset;
  }

  assert.equal(seen.length, 12);
  assert.equal(new Set(seen).size, 12, 'no duplicates across batches');
  assert.equal(mcpFetcher.calls.length, 1, 'mcpFetcher must be called only once');
});

test('MCP path: mcpFetcher receives projectId/pattern/environment only (no limit/offset)', async () => {
  const dir = tempDir();
  const mcpFetcher = mkCountingMcpFetcher(3);
  await getBpaFindings('scheduler', {
    collectionsDir: dir,
    projectId: 'proj-A',
    environment: 'stage',
    mcpFetcher,
    offset: 10      // user-supplied offset must NOT be forwarded
  });
  assert.equal(mcpFetcher.calls.length, 1);
  const args = mcpFetcher.calls[0];
  assert.equal(args.projectId, 'proj-A');
  assert.equal(args.pattern, 'scheduler');
  assert.equal(args.environment, 'stage');
  assert.equal(args.limit, undefined, 'limit must not be sent to MCP');
  assert.equal(args.offset, undefined, 'offset must not be sent to MCP');
});

test('MCP path is preferred over a pre-existing CSV-derived cache', async () => {
  const dir = tempDir();

  // Seed a CSV-derived cache — simulates a previous CSV session.
  await getBpaFindings('scheduler', { collectionsDir: dir, bpaFilePath: MANY_CSV });

  // Now call with MCP configured; the CSV cache must NOT shadow MCP.
  const mcpFetcher = mkCountingMcpFetcher(3);
  const r = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    projectId: 'proj-A',
    mcpFetcher
  });

  assert.equal(r.source, 'mcp-server');
  assert.equal(r.paging.total, 3, 'must read MCP count, not CSV count');
  assert.equal(mcpFetcher.calls.length, 1);
});

test('MCP cache files are keyed by (projectId, pattern) — different keys do not collide', async () => {
  const dir = tempDir();
  const fA = mkCountingMcpFetcher(3);
  const fB = mkCountingMcpFetcher(7);

  const ra = await getBpaFindings('scheduler', {
    collectionsDir: dir, projectId: 'proj-A', mcpFetcher: fA
  });
  const rb = await getBpaFindings('scheduler', {
    collectionsDir: dir, projectId: 'proj-B', mcpFetcher: fB
  });

  assert.equal(ra.paging.total, 3);
  assert.equal(rb.paging.total, 7);

  // Both caches present.
  assert.ok(fs.existsSync(path.join(dir, 'mcp', 'proj-A', 'scheduler.json')));
  assert.ok(fs.existsSync(path.join(dir, 'mcp', 'proj-B', 'scheduler.json')));
});

test('MCP path: success:true with empty targets propagates message and caches', async () => {
  const dir = tempDir();
  const mcpFetcher = async () => ({
    success: true,
    targets: [],
    summary: { schedulerCount: 0 },
    message: "No 'scheduler' findings in the latest BPA report for project proj-X."
  });
  const r = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    projectId: 'proj-X',
    mcpFetcher
  });
  assert.equal(r.success, true);
  assert.equal(r.source, 'mcp-server');
  assert.equal(r.targets.length, 0);
  assert.equal(r.paging.total, 0);
  assert.equal(r.paging.hasMore, false);
  assert.ok(r.message.includes("No 'scheduler' findings"), 'message should reflect empty pattern result');

  const cacheFile = path.join(dir, 'mcp', 'proj-X', 'scheduler.json');
  assert.ok(fs.existsSync(cacheFile), 'cache file should be written even for empty results');

  // Second call should read cache and not invoke fetcher again.
  let fetcherCalled = false;
  const deadFetcher = async () => { fetcherCalled = true; return { success: true, targets: [] }; };
  const r2 = await getBpaFindings('scheduler', {
    collectionsDir: dir,
    projectId: 'proj-X',
    mcpFetcher: deadFetcher
  });
  assert.equal(fetcherCalled, false, 'fetcher must not be called when cache exists');
  assert.equal(r2.success, true);
  assert.ok(r2.message.includes("No 'scheduler' findings"), 'cached message should persist');
});

test('MCP path: second session reuses the cache across processes (no fetch)', async () => {
  const dir = tempDir();
  const fA = mkCountingMcpFetcher(8);

  // First session — populates the cache.
  await getBpaFindings('scheduler', {
    collectionsDir: dir, projectId: 'proj-A', mcpFetcher: fA
  });
  assert.equal(fA.calls.length, 1);

  // Second session with a "dead" fetcher that should never be called.
  const fDead = async () => {
    throw new Error('mcp fetcher must not be called when cache exists');
  };
  const r = await getBpaFindings('scheduler', {
    collectionsDir: dir, projectId: 'proj-A', mcpFetcher: fDead, offset: 5
  });
  assert.equal(r.success, true);
  assert.equal(r.source, 'mcp-server');
  assert.equal(r.paging.offset, 5);
});

// ── Cached collections that predate a pattern ───────────────────────────────

function writeInputStreamAndSchedulerCsv(dir) {
  const p = path.join(dir, 'bpa.csv');
  fs.writeFileSync(p, [
    'code,type,subtype,importance,identifier,other,message,moreInfo,context',
    'DG,development.guideline,java.io.inputstream,ADVISORY,com.acme.core.Foo,java.io.InputStream,The com.acme.core.Foo class in the com.acme.core bundle uses java.io.InputStream.,x,ctx',
    'DG,development.guideline,sling.commons.scheduler,MAJOR,com.acme.core.Job,\\N,The com.acme.core.Job class uses the scheduler.,x,ctx',
  ].join('\n') + '\n', 'utf8');
  return p;
}

/** Rewrite the cache the way a parser from before inputStream support left it. */
function makeCacheLegacy(collectionsDir) {
  const file = path.join(collectionsDir, 'unified-collection.json');
  const collection = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete collection.subtypes.java_io_inputstream;
  delete collection.meta.parsedSubtypes;
  delete collection.meta.inputStreamBundles;
  fs.writeFileSync(file, JSON.stringify(collection), 'utf8');
}

test('a cached collection from before a pattern was supported is rebuilt from the CSV', async () => {
  const dir = tempDir();
  const csv = writeInputStreamAndSchedulerCsv(dir);
  const collectionsDir = path.join(dir, 'uc');
  await getBpaFindings('scheduler', { bpaFilePath: csv, collectionsDir, limit: null });
  makeCacheLegacy(collectionsDir);

  const result = await getBpaFindings('inputStream', { bpaFilePath: csv, collectionsDir, limit: null });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.targets.map(t => t.className), ['com.acme.core.Foo']);
  const rebuilt = JSON.parse(fs.readFileSync(path.join(collectionsDir, 'unified-collection.json'), 'utf8'));
  assert.ok(rebuilt.meta.parsedSubtypes.includes('java.io.inputstream'));
});

test('without a CSV, a cache that predates the pattern is an error, not "pattern absent"', async () => {
  const dir = tempDir();
  const csv = writeInputStreamAndSchedulerCsv(dir);
  const collectionsDir = path.join(dir, 'uc');
  await getBpaFindings('scheduler', { bpaFilePath: csv, collectionsDir, limit: null });
  makeCacheLegacy(collectionsDir);

  const result = await getBpaFindings('inputStream', { collectionsDir, limit: null });
  assert.equal(result.success, false);
  assert.match(result.error, /created before 'inputStream' was supported/);
  assert.equal(result.availablePatterns, undefined, 'callers must not read this as a clean report');

  // Patterns the old parser already handled are still served from that cache.
  const scheduler = await getBpaFindings('scheduler', { collectionsDir, limit: null });
  assert.equal(scheduler.success, true);
  assert.deepEqual(scheduler.targets.map(t => t.className), ['com.acme.core.Job']);
});

test('an up-to-date cache is reused without re-reading the CSV', async () => {
  const dir = tempDir();
  const csv = writeInputStreamAndSchedulerCsv(dir);
  const collectionsDir = path.join(dir, 'uc');
  await getBpaFindings('inputStream', { bpaFilePath: csv, collectionsDir, limit: null });
  fs.unlinkSync(csv); // a re-parse would now fail
  const again = await getBpaFindings('inputStream', { bpaFilePath: csv, collectionsDir, limit: null });
  assert.equal(again.success, true, again.error);
  assert.equal(again.targets.length, 1);
});

test('default `all` with a legacy cache and no CSV returns the patterns the cache covers and names the missing ones', async () => {
  const dir = tempDir();
  const csv = writeInputStreamAndSchedulerCsv(dir);
  const collectionsDir = path.join(dir, 'uc');
  await getBpaFindings('scheduler', { bpaFilePath: csv, collectionsDir, limit: null });
  makeCacheLegacy(collectionsDir);

  const result = await getBpaFindings('all', { collectionsDir, limit: null });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.targets.map(t => t.className), ['com.acme.core.Job'], 'the scheduler findings the cache holds');
  assert.deepEqual(result.staleCache.missingPatterns, ['oakIndex', 'inputStream']);
  assert.match(result.message, /predates 'oakIndex', 'inputStream'/);
  assert.match(result.message, /provide the BPA CSV/);
  // The cache itself is left untouched.
  const cache = JSON.parse(fs.readFileSync(path.join(collectionsDir, 'unified-collection.json'), 'utf8'));
  assert.equal(cache.meta.parsedSubtypes, undefined);
});

test('default `all` with a legacy cache and a CSV rebuilds the cache and includes the new pattern', async () => {
  const dir = tempDir();
  const csv = writeInputStreamAndSchedulerCsv(dir);
  const collectionsDir = path.join(dir, 'uc');
  await getBpaFindings('scheduler', { bpaFilePath: csv, collectionsDir, limit: null });
  makeCacheLegacy(collectionsDir);

  const result = await getBpaFindings('all', { bpaFilePath: csv, collectionsDir, limit: null });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.targets.map(t => t.className).sort(), ['com.acme.core.Foo', 'com.acme.core.Job']);
  assert.equal(result.staleCache, undefined);
});

test('default `all` with an up-to-date cache reports no stale-cache warning', async () => {
  const dir = tempDir();
  const csv = writeInputStreamAndSchedulerCsv(dir);
  const collectionsDir = path.join(dir, 'uc');
  await getBpaFindings('all', { bpaFilePath: csv, collectionsDir, limit: null });
  const again = await getBpaFindings('all', { collectionsDir, limit: null });
  assert.equal(again.success, true, again.error);
  assert.equal(again.staleCache, undefined);
  assert.equal(again.targets.length, 2);
});
