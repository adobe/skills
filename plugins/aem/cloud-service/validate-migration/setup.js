'use strict';

/**
 * setup.js — phase 1 of validate-migration: remember the local instance URLs once.
 * AEM 6.5 Quickstart runs on 4502 and the Cloud SDK on 4602 unless overridden.
 */
const fs = require('fs');
const path = require('path');
const { SDK_URL, QUICKSTART_URL } = require('./sdk.js');
const { RULES } = require('./plan.js');

const SAVED_KEYS = ['sdk_url', 'quickstart_url'];

const trimUrl = (url) => (url ? String(url).replace(/\/$/, '') : null);

/** Select prerequisites for the supported patterns, rejecting misspelled scopes. */
function requiredChecks(patterns) {
  const supported = new Set([...RULES.map((rule) => rule.pattern), 'cdw']);
  for (const pattern of patterns) {
    if (!supported.has(pattern)) throw new Error(`unknown validation pattern: ${pattern}`);
  }
  if (patterns.every((pattern) => ['legacy-ui', 'cdw'].includes(pattern))) return [];
  return ['sdk', 'mcp', ...(patterns.includes('custom-templates') ? ['quickstart'] : [])];
}

function setupPath(projectDir) {
  return path.join(projectDir, '.validate-migration', 'setup.json');
}

function readSetup(projectDir) {
  try { return JSON.parse(fs.readFileSync(setupPath(projectDir), 'utf8')); } catch { return {}; }
}

/** Saves instance URLs only; any other key (credentials) is dropped. */
function writeSetup(projectDir, values) {
  const saved = Object.fromEntries(SAVED_KEYS.filter((k) => values[k]).map((k) => [k, values[k]]));
  fs.mkdirSync(path.dirname(setupPath(projectDir)), { recursive: true });
  fs.writeFileSync(setupPath(projectDir), JSON.stringify({ ...saved, confirmed_at: new Date().toISOString() }, null, 2));
}

/** Explicit flags win, then the saved setup, then the fixed ports (SDK 4602, AEM 6.5 4502). */
function resolveInstances(args, saved) {
  return {
    sdk_url: trimUrl(args.sdk) || saved.sdk_url || SDK_URL,
    quickstart_url: trimUrl(args.quickstart) || saved.quickstart_url || QUICKSTART_URL,
  };
}

module.exports = { readSetup, writeSetup, resolveInstances, setupPath, requiredChecks };
