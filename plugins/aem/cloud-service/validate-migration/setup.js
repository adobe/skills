'use strict';

/**
 * setup.js — phase 1 of validate-migration: make the local instances and MCP ready
 * once, remember which instance is which, and only block on what a run needs.
 */
const fs = require('fs');
const path = require('path');

const ABOUT_PATH = '/mnt/overlay/granite/ui/content/shell/about.html';
// Patterns that never touch an instance.
const OFFLINE_PATTERNS = new Set(['legacy-ui', 'cdw']);
// Patterns that also need the legacy Quickstart for side-by-side comparison.
const QUICKSTART_PATTERNS = new Set(['custom-templates']);
const SAVED_KEYS = ['sdk_url', 'quickstart_url', 'sdk_version', 'quickstart_version'];

const trimUrl = (url) => (url ? String(url).replace(/\/$/, '') : null);

/** Cloud SDK versions start with a year (2026.8…); AEM 6.5 reports 6.5.x. */
async function detectRole(url, auth) {
  if (!auth) return { role: 'unknown', reason: 'login_missing' };
  let res;
  try {
    res = await fetch(`${trimUrl(url)}${ABOUT_PATH}`, {
      headers: { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') }, signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { role: 'unknown', reason: 'unreachable' };
  }
  if (res.status === 401 || res.status === 403) return { role: 'unknown', reason: 'login_rejected' };
  const version = ((await res.text()).match(/Adobe Experience Manager\s+([0-9][\w.-]*)/) || [])[1];
  if (!version) return { role: 'unknown', reason: 'version_not_found' };
  if (/^20\d{2}\./.test(version)) return { role: 'cloud-sdk', version };
  if (/^6\./.test(version)) return { role: 'aem65', version };
  return { role: 'unknown', reason: 'version_not_recognized', version };
}

/** Checks that must pass before validating these patterns (empty list → all patterns). */
function requiredChecks(patterns) {
  const scope = patterns.length ? patterns : ['scheduler'];
  if (scope.every((p) => OFFLINE_PATTERNS.has(p))) return [];
  return ['sdk', 'mcp', ...(scope.some((p) => QUICKSTART_PATTERNS.has(p)) ? ['quickstart'] : [])];
}

function setupPath(projectDir) {
  return path.join(projectDir, '.validate-migration', 'setup.json');
}

function readSetup(projectDir) {
  try { return JSON.parse(fs.readFileSync(setupPath(projectDir), 'utf8')); } catch { return {}; }
}

/** Saves instance URLs and versions only; any other key (credentials) is dropped. */
function writeSetup(projectDir, values) {
  const saved = Object.fromEntries(SAVED_KEYS.filter((k) => values[k]).map((k) => [k, values[k]]));
  fs.mkdirSync(path.dirname(setupPath(projectDir)), { recursive: true });
  fs.writeFileSync(setupPath(projectDir), JSON.stringify({ ...saved, confirmed_at: new Date().toISOString() }, null, 2));
}

/** Explicit flags win, then the user-confirmed saved setup, then auto-detection. */
function resolveInstances(args, saved, detected) {
  if (args.sdk || args.quickstart) {
    return { sdk_url: trimUrl(args.sdk || saved.sdk_url), quickstart_url: trimUrl(args.quickstart || saved.quickstart_url), source: 'flags' };
  }
  if (saved.sdk_url) return { sdk_url: saved.sdk_url, quickstart_url: saved.quickstart_url || null, source: 'saved' };
  if (detected.sdk_url || detected.quickstart_url) {
    return { sdk_url: detected.sdk_url || null, quickstart_url: detected.quickstart_url || null, source: 'detected' };
  }
  return { sdk_url: null, quickstart_url: null, source: 'none' };
}

module.exports = { detectRole, requiredChecks, readSetup, writeSetup, resolveInstances, setupPath };
