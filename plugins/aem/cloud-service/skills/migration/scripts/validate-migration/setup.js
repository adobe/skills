'use strict';

/**
 * setup.js — phase 1 of validate-migration: remember the local instance URLs once.
 * AEM 6.5 Quickstart runs on 4502 and the Cloud SDK on 4602 unless overridden.
 * Nothing here contacts AEM: deployment goes through the project's Maven profile
 * and runtime state comes only from the AEM Quickstart MCP.
 */
const fs = require('fs');
const path = require('path');
const { RULES } = require('./plan.js');
const { canonicalPattern } = require('./check/patterns/aliases.js');

const QUICKSTART_URL = 'http://localhost:4502';
const SDK_URL = 'http://localhost:4602';
const SAVED_KEYS = ['sdk_url', 'quickstart_url'];

const trimUrl = (url) => (url ? String(url).replace(/\/$/, '') : null);

/** True when both URLs address the same host and port (loopback aliases count as one host). */
function sameInstance(a, b) {
  const key = (value) => {
    const url = new URL(value);
    const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname;
    return `${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  };
  try { return key(a) === key(b); } catch { return false; }
}

/** Select prerequisites for the supported patterns, rejecting misspelled scopes. */
function requiredChecks(names) {
  const patterns = names.map(canonicalPattern);
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

module.exports = { readSetup, writeSetup, resolveInstances, setupPath, requiredChecks, sameInstance, SDK_URL, QUICKSTART_URL };
