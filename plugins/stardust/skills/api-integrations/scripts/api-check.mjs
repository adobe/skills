#!/usr/bin/env node
/**
 * api-check.mjs — Verify rebuilt backend API integrations with L1-L4 replay.
 *
 * Runs contract, mocked-flow, live-read / confirmed invalid-write, and confirmed
 * valid-write checks against the migrated origin, writes api parity and QA reports,
 * and can write safe summary rows back to Stardust dynamics artefacts.
 *
 *   node scripts/api-check.mjs --origin <url> [--levels 1,2,3,4] [--confirm "METHOD /path,..."] [--confirm-live-write <id>] [--writeback]
 *
 * Writes: stardust/api/parity.json, stardust/qa/api-report.md, stardust/qa/api-report.json
 * With --writeback also writes stardust/dynamic-features.md and stardust/dynamics/parity.json.
 * Exit 0 when requested non-skipped checks pass, 1 when any requested check fails, 2 on usage.
 */
/* eslint-disable no-await-in-loop */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  ART,
  arg,
  flag,
  isMain,
  list,
  loadPlaywright,
  pathPattern,
  printHelpIfAsked,
  provenance,
  readJSON,
  writeJSON,
  writeText,
} from './lib/lib.mjs';
import { RUNNERS } from './lib/check-runners.mjs';
import { writeBack } from './lib/writeback.mjs';

export { RUNNERS } from './lib/check-runners.mjs';
export { writeBack } from './lib/writeback.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function endpointPath(endpoint) {
  try {
    const url = new URL(endpoint, 'https://example.invalid');
    return `${url.pathname}${url.search}`;
  } catch {
    return endpoint || '';
  }
}

function pagePath(contract) {
  const page = asArray(contract.pages)[0] || '/';
  try { return new URL(page).pathname || '/'; } catch { return page || '/'; }
}

function checkBase(contract) {
  return {
    path: pagePath(contract),
    selector: contract.trigger?.selector || null,
    trigger: contract.trigger || { type: 'load', selector: null },
    fill: asArray(contract.fieldMap).map((entry) => ({ ...entry })),
  };
}

function isWrite(contract) {
  const method = String(contract.method || 'GET').toUpperCase();
  const kind = String(contract.kind || '').toLowerCase();
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || kind.includes('write') || kind.includes('mutation');
}

export function buildParity(inventory = {}, contractsInput = []) {
  const contracts = Array.isArray(contractsInput) ? contractsInput : Object.values(contractsInput || {});
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const features = [];
  for (const integration of asArray(inventory.integrations)) {
    const contract = byId.get(integration.id) || integration;
    const base = checkBase(contract);
    const write = isWrite(contract);
    const checks = [
      { type: 'api-contract', ...base },
      { type: 'api-mocked-flow', ...base },
      write ? { type: 'api-live-write-invalid', ...base } : { type: 'api-live-read', ...base },
    ];
    if (write) checks.push({ type: 'api-live-write-valid', requiresConfirmation: true, ...base });
    features.push({
      id: `api-${contract.id || integration.id}`,
      contractId: contract.id || integration.id,
      feature: contract.id || integration.id,
      endpoint: endpointPath(contract.endpoint || integration.endpoint),
      kind: contract.kind || integration.kind,
      path: base.path,
      status: contract.status || integration.status,
      checks,
    });
  }
  return { _provenance: provenance('api-check'), features };
}

function levelForType(type) {
  if (type === 'api-contract') return 1;
  if (type === 'api-mocked-flow') return 2;
  if (type === 'api-live-read' || type === 'api-live-write-invalid') return 3;
  if (type === 'api-live-write-valid') return 4;
  return 0;
}

function contractPath(dir, integration) {
  return join(dir, integration.contract || `contracts/${integration.id}.json`);
}

function loadContracts(dir, inventory) {
  return asArray(inventory.integrations).map((integration) => readJSON(contractPath(dir, integration)));
}

function parseConfirm() {
  return new Set(list(arg('confirm', '')).map((entry) => {
    const [method, ...rest] = String(entry).trim().split(/\s+/);
    const path = rest.join(' ');
    return `${String(method || '').toUpperCase()} ${pathPattern(path)}`;
  }).filter((entry) => !entry.endsWith(' ')));
}

function requestedLevels() {
  const raw = arg('levels', '1,2,3,4');
  const levels = new Set(list(raw).map((value) => Number(value)));
  if (![...levels].every((level) => [1, 2, 3, 4].includes(level))) throw new Error('levels must be a comma-separated subset of 1,2,3,4');
  return levels;
}

function summarizeResults(results, origin) {
  const pass = results.filter((result) => result.pass).length;
  const fail = results.filter((result) => !result.pass && !result.skipped).length;
  const skipped = results.filter((result) => result.skipped).length;
  const lines = [
    `# API parity check — ${origin} — ${new Date().toISOString()}`,
    '',
    `Replayed ${results.length} checks · pass ${pass} · fail ${fail} · skipped ${skipped}.`,
    '',
    '| integration | check | result | detail |',
    '|---|---|---|---|',
    ...results.map((result) => `| ${result.id} | ${result.type} | ${result.skipped ? 'SKIP' : result.pass ? 'PASS' : 'FAIL'} | ${String(result.detail || '').replace(/\|/g, '/')} |`),
    '',
  ];
  return lines.join('\n');
}

function statusFromResults(results, previous) {
  const passed = results.filter((result) => result.pass && !result.skipped);
  if (!passed.length) return previous;
  const hasL4 = passed.some((result) => result.level === 4);
  if (hasL4) return 'verified-L4';
  const corsLimit = passed.some((result) => result.level === 3 && String(result.environmentLimit || '').startsWith('cors-blocked'));
  if (corsLimit) return 'blocked-cors';
  const highest = Math.max(...passed.map((result) => result.level));
  return `verified-L${highest}`;
}

function updateStatuses({ inventory, contracts, results, dir }) {
  const byId = new Map();
  for (const result of results) {
    if (!byId.has(result.contractId)) byId.set(result.contractId, []);
    byId.get(result.contractId).push(result);
  }
  for (const contract of contracts) {
    const next = statusFromResults(byId.get(contract.id) || [], contract.status);
    contract.status = next;
    writeJSON(join(dir, 'contracts', `${contract.id}.json`), contract);
    const integration = asArray(inventory.integrations).find((entry) => entry.id === contract.id);
    if (integration) integration.status = next;
  }
  writeJSON(join(dir, 'inventory.json'), inventory);
}

async function readTextIfExists(path) {
  return existsSync(path) ? readFile(path, 'utf8') : null;
}

async function runChecks({ origin, levels, inventory, contracts, parity, cors, confirm, confirmLiveWrite, headed = false }) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const results = [];
  try {
    for (const feature of parity.features || []) {
      const contract = contractsById.get(feature.contractId);
      for (const check of feature.checks || []) {
        const level = levelForType(check.type);
        if (!levels.has(level)) continue;
        const runner = RUNNERS[check.type];
        let result;
        const started = Date.now();
        try {
          result = runner ? await runner(check, { ctx, origin, contract, cors, confirm, confirmLiveWrite }) : { pass: false, detail: `unknown check type ${check.type}` };
        } catch (error) {
          result = { pass: false, detail: `error: ${String(error.message || error).slice(0, 180)}` };
        }
        results.push({
          id: feature.id,
          contractId: feature.contractId,
          type: check.type,
          level,
          pass: Boolean(result.pass),
          skipped: Boolean(result.skipped),
          detail: result.detail || '',
          environmentLimit: result.environmentLimit || null,
          ms: Date.now() - started,
        });
      }
    }
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return results;
}

async function main() {
  printHelpIfAsked(import.meta.url);
  const origin = (arg('origin') || '').replace(/\/$/, '');
  if (!origin) {
    console.error('usage: api-check.mjs --origin <url> [--levels 1,2,3,4] [--confirm "METHOD /path,..."] [--confirm-live-write <id>] [--writeback]');
    process.exit(2);
  }
  let levels;
  try { levels = requestedLevels(); } catch (error) { console.error(error.message); process.exit(2); }
  const dir = dirname(ART.inventory);
  const inventory = readJSON(ART.inventory);
  const contracts = loadContracts(dir, inventory);
  const parity = buildParity(inventory, contracts);
  const cors = existsSync(ART.cors) ? readJSON(ART.cors) : null;
  const results = await runChecks({
    origin,
    levels,
    inventory,
    contracts,
    parity,
    cors,
    confirm: parseConfirm(),
    confirmLiveWrite: arg('confirm-live-write'),
    headed: flag('headed'),
  });
  updateStatuses({ inventory, contracts, results, dir });
  await mkdir(dirname(ART.parity), { recursive: true });
  await mkdir(dirname(ART.qaMd), { recursive: true });
  writeJSON(ART.parity, { ...parity, results });
  writeJSON(ART.qaJson, { _provenance: provenance('api-check', { origin }), results });
  writeText(ART.qaMd, summarizeResults(results, origin));

  if (flag('writeback')) {
    const currentFeatures = await readTextIfExists('stardust/dynamic-features.md');
    const currentParity = existsSync('stardust/dynamics/parity.json') ? readJSON('stardust/dynamics/parity.json') : null;
    const written = writeBack(inventory, { featuresMd: currentFeatures, dynamicsParity: currentParity });
    await mkdir('stardust/dynamics', { recursive: true });
    writeText('stardust/dynamic-features.md', written.featuresMd);
    writeJSON('stardust/dynamics/parity.json', written.dynamicsParity);
  }

  const failed = results.some((result) => !result.pass && !result.skipped);
  process.exit(failed ? 1 : 0);
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
