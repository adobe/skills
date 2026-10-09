#!/usr/bin/env node
/*
 * Runs the shared rules engine over a context matrix and prints, per
 * placeholder, the expected variant and the preview override URL that
 * reproduces it. verify-preview.mjs consumes the same cases.
 *
 * Usage:
 *   node simulate.mjs <content/page.html> [--matrix contexts.json]
 *     [--api-decisions decisions.json] [--consent] [--page-url http://localhost:3000/home] [--json]
 *   node simulate.mjs <page.html | URL> --edge [--country IN] [--region KA]
 *     [--cookie "pzn-seen=1"] [--ua "Googlebot"] [--api-endpoint http://localhost:4100/decide]
 *
 * contexts.json: [{ "name": "india mobile", "geo": "IN", "device": "mobile",
 *   "visitor": "returning", "params": {"utm_campaign": "x"}, "state": {"k": "v"},
 *   "audiences": ["vip"] }]   ("bot": true expects the default)
 * decisions.json: the mock engine's file (see mock-decision-api.mjs); with it,
 * `source | api` placeholders are decided as that engine would, per case.
 * The runtime only calls the engine with consent, so their override URLs add
 * ?pzn-consent=1. --consent adds it to every case (except bots), e.g. to test
 * rule fallbacks while the mock engine fails.
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EDGE_DIR, RUNTIME_DIR, SHARED_WITH_EDGE, exitOnHelp, importAsset, isMain, parseArgs, readJson,
  readText, sitePrefixes,
} from './lib.mjs';

export const USAGE = `Usage:
  node simulate.mjs <content/page.html> [--matrix contexts.json]
    [--api-decisions decisions.json] [--consent] [--page-url http://localhost:3000/page] [--json]
  node simulate.mjs <content/page.html | URL> --edge [--country IN] [--region KA]
    [--cookie "pzn-seen=1"] [--ua "Googlebot"] [--api-endpoint http://localhost:4100/decide]
Runs the shared rules engine over a context matrix: expected variant per
placeholder and the ?pzn= override URL that reproduces it. --edge prints the
edge worker's output and headers instead. Exit 2 = usage.`;


const { parseSpec, decide } = await importAsset('runtime', 'scripts', 'personalization', 'rules.js');
const { parseGeo } = await importAsset('runtime', 'scripts', 'personalization', 'context.js');
const { buildRequest } = await importAsset('runtime', 'scripts', 'personalization', 'contract.js');
const { findBlocks } = await importAsset('edge', 'cloudflare', 'src', 'personalization', 'html.js');
const { engineDecide } = await import('./mock-decision-api.mjs');

/**
 * Turns a matrix entry into a rules context plus the override query that
 * reproduces it in the browser.
 * @param {object} entry
 * @returns {{context: object, audiences: string[], query: string}}
 */
export function toCase(entry) {
  const context = { params: { ...(entry.params || {}) }, state: { ...(entry.state || {}) } };
  const query = new URLSearchParams();
  const geo = typeof entry.geo === 'string' ? parseGeo(entry.geo) : entry.geo;
  if (geo) {
    context.geo = geo;
    query.set('pzn-geo', geo.region ? `${geo.country}-${geo.region}` : geo.country);
  }
  if (entry.device) {
    context.device = entry.device;
    query.set('pzn-device', entry.device);
  }
  if (entry.visitor) {
    context.visitor = entry.visitor;
    query.set('pzn-visitor', entry.visitor);
  }
  const state = Object.entries(context.state);
  if (state.length) query.set('pzn-state', state.map(([key, value]) => `${key}:${value}`).join(','));
  const audiences = entry.audiences || [];
  if (audiences.length) query.set('pzn-audience', audiences.join(','));
  Object.entries(context.params).forEach(([key, value]) => query.set(key, value));
  if (entry.forced) query.set('pzn', entry.forced);
  return { context, audiences, query: query.toString() };
}

/**
 * Builds a matrix that exercises every rule of a spec: a baseline with no
 * context, a bot (always the default), one entry satisfying each rule's
 * positive clauses, and one forced override per variant.
 * @param {object} spec
 * @returns {object[]}
 */
export function autoMatrix(spec) {
  const matrix = [{ name: 'no context' }, { name: 'bot', bot: true }];
  spec.rules.forEach((rule) => {
    const entry = { name: `matches "${rule.condition}"`, params: {}, state: {} };
    rule.clauses.filter((clause) => !clause.negate).forEach(({ criterion, values }) => {
      const [value] = values;
      const [key, ...rest] = value.split('=');
      if (criterion === 'geo') entry.geo = value;
      if (criterion === 'device') entry.device = value;
      if (criterion === 'visitor') entry.visitor = value;
      if (criterion === 'param') entry.params[key.trim()] = rest.length ? rest.join('=').trim() : '1';
      if (criterion === 'state') entry.state[key.trim()] = rest.length ? rest.join('=').trim() : '1';
      if (criterion === 'audience') entry.audiences = [...(entry.audiences || []), value];
    });
    matrix.push(entry);
  });
  [...spec.rules.map((rule) => rule.variant), 'default'].forEach((variant) => {
    matrix.push({ name: `forced ${variant}`, forced: `${spec.id}:${variant}` });
  });
  return matrix;
}

/**
 * Expected decisions for each placeholder of a page.
 * @param {string} html page HTML
 * @param {object} options
 * @param {object[]} [options.matrix] shared matrix; default: autoMatrix per placeholder
 * @param {object} [options.engine] mock-decision-api decisions file, applied per case
 * @param {string[]} [options.prefixes]
 * @param {boolean} [options.consent] grant consent in every non-bot case
 * @returns {Promise<object[]>} cases
 */
export async function buildCases(html, {
  matrix, engine, prefixes, consent = false,
} = {}) {
  const specs = findBlocks(html).map((block) => parseSpec(block.rows, { prefixes }));
  const cases = [];
  await Promise.all(specs.map(async (spec) => {
    if (spec.errors.length) {
      cases.push({ placeholder: spec.id || null, name: 'invalid placeholder', errors: spec.errors });
      return;
    }
    const entries = matrix || autoMatrix(spec);
    const results = await Promise.all(entries.map(async (entry) => {
      const { context, audiences, query } = toCase(entry);
      const forcedVariant = entry.forced
        ? entry.forced.split(',').map((pair) => pair.split(':')).find(([id]) => id === spec.id)?.[1]
        : undefined;
      if (entry.bot) {
        const decision = await decide(spec, {}, { forcedVariant: 'default', prefixes });
        return {
          placeholder: spec.id,
          name: entry.name,
          query,
          context: entry,
          expected: decision.variant,
          source: 'bot',
          rule: decision.rule,
          target: decision.target,
        };
      }
      const engineCase = !!engine && spec.source === 'api';
      const caseQuery = consent || engineCase
        ? [query, 'pzn-consent=1'].filter(Boolean).join('&') : query;
      let apiDecision;
      if (engineCase && !forcedVariant) {
        const body = buildRequest({
          path: '/', specs: [spec], context, consent: true, mode: 'client',
        });
        apiDecision = (await engineDecide(engine, body)).decisions[spec.id];
      }
      const decision = await decide(spec, context, {
        audiences: Object.fromEntries(audiences.map((name) => [name, true])),
        apiDecision,
        forcedVariant,
        prefixes,
      });
      return {
        placeholder: spec.id,
        name: entry.name,
        query: caseQuery,
        context: entry,
        expected: decision.variant,
        source: decision.source,
        rule: decision.rule,
        target: decision.target,
      };
    }));
    cases.push(...results);
  }));
  return cases.sort((a, b) => String(a.placeholder).localeCompare(String(b.placeholder)));
}

/**
 * Assembles the edge worker modules in a temp dir (as install-edge would)
 * and runs personalizeResponse over the HTML.
 * @param {string} html
 * @param {object} options
 * @returns {Promise<{html: string, headers: object, blocks: object[]}>}
 */
export async function simulateEdge(html, {
  url = 'https://www.example.com/', country, region, cookie, ua = 'Mozilla/5.0', apiEndpoint, prefixes,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pzn-edge-'));
  try {
    cpSync(join(EDGE_DIR, 'src', 'personalization'), dir, { recursive: true });
    SHARED_WITH_EDGE.forEach((name) => cpSync(join(RUNTIME_DIR, 'scripts', 'personalization', name), join(dir, name)));
    const { personalizeResponse } = await import(pathToFileURL(join(dir, 'personalize.js')).href);
    const { default: baseConfig } = await import(pathToFileURL(join(dir, 'edge-config.js')).href);
    const config = {
      ...baseConfig,
      fragmentPrefixes: prefixes || baseConfig.fragmentPrefixes,
      api: { ...baseConfig.api, endpoint: apiEndpoint || baseConfig.api.endpoint },
    };
    const headers = { 'user-agent': ua };
    if (cookie) headers.cookie = cookie;
    const request = new Request(url, { headers });
    const response = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const out = await personalizeResponse(request, response, {
      config, cf: country ? { country, regionCode: region } : undefined, cache: null,
    });
    const text = await out.text();
    const blocks = findBlocks(text).map((block) => ({
      id: block.rows.find((row) => row.key.toLowerCase() === 'id')?.value,
      source: /data-pzn-source="([^"]*)"/.exec(block.attrs)?.[1] || 'deferred to browser',
      variant: /data-pzn-variant="([^"]*)"/.exec(block.attrs)?.[1] || null,
      fragment: /data-pzn-fragment="([^"]*)"/.exec(block.attrs)?.[1] || null,
    }));
    return { html: text, headers: Object.fromEntries(out.headers), blocks };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadHtml(target) {
  if (/^https?:\/\//.test(target)) {
    const response = await fetch(target);
    if (!response.ok) throw new Error(`${target}: HTTP ${response.status}`);
    return response.text();
  }
  const html = readText(resolve(target));
  if (html === null) throw new Error(`${target} not found`);
  return html;
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const target = args._[0];
  if (!target) {
    console.error(`❌ ${USAGE}`);
    process.exit(2);
  }
  const prefixes = sitePrefixes(resolve(args.repo || process.cwd()));
  const html = await loadHtml(target);
  if (args.edge) {
    const result = await simulateEdge(html, {
      url: /^https?:\/\//.test(target) ? target : undefined,
      country: args.country,
      region: args.region,
      cookie: args.cookie,
      ua: args.ua,
      apiEndpoint: args['api-endpoint'],
      prefixes,
    });
    if (args.json) console.log(JSON.stringify({ headers: result.headers, blocks: result.blocks }, null, 2));
    else {
      console.log(`cache-control: ${result.headers['cache-control'] || '(unchanged)'}  x-pzn: ${result.headers['x-pzn'] || '-'}`);
      console.table(result.blocks);
    }
  } else {
    const matrix = args.matrix ? readJson(resolve(args.matrix)) : undefined;
    const engine = args['api-decisions'] ? readJson(resolve(args['api-decisions'])) : undefined;
    const cases = await buildCases(html, {
      matrix, engine, prefixes, consent: !!args.consent,
    });
    const pageUrl = typeof args['page-url'] === 'string' ? args['page-url'] : '';
    cases.forEach((entry) => {
      if (pageUrl && entry.query !== undefined) entry.url = `${pageUrl}${entry.query ? `?${entry.query}` : ''}`;
    });
    if (args.json) console.log(JSON.stringify(cases, null, 2));
    else {
      console.table(cases.map((entry) => ({
        placeholder: entry.placeholder,
        case: entry.name,
        expected: entry.expected ?? `INVALID: ${(entry.errors || []).join('; ')}`,
        source: entry.source,
        url: entry.url || (entry.query ? `?${entry.query}` : ''),
      })));
    }
  }
}
