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

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bpa-helper-test-'));
}

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
