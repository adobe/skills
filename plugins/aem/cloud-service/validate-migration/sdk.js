'use strict';

/**
 * sdk.js — shared "make sure a local AEM SDK is running" logic used by init.js and check.js.
 * If the SDK is down: search for the Quickstart jar, boot it, wait until it answers;
 * if no jar is found, point the user at Adobe Software Distribution.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SDK_JAR_RE = /^aem-sdk-quickstart.*\.jar$/i;
const SDK_BOOT_TIMEOUT_MS = 180000;
const SDK_POLL_MS = 3000;
const DOWNLOAD_URL = 'https://experience.adobe.com/#/downloads/content/software-distribution/en/aemcloud.html';

async function isReachable(url, timeoutMs = 3000) {
  try {
    const res = await fetch(`${url}/`, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch { return false; }
}

async function findRunningSdk() {
  for (const port of [4502, 4602, 4503]) {
    const url = `http://localhost:${port}`;
    if (await isReachable(url, 500)) return url;
  }
  return null;
}

// Skips heavy build/VCS dirs; returns every matching jar path under `root`.
function findQuickstartJars(root, depth = 4) {
  const found = [];
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build']);
  const walk = (dir, left) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (left > 0 && !skip.has(e.name)) walk(path.join(dir, e.name), left - 1);
      } else if (SDK_JAR_RE.test(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  walk(root, depth);
  return found;
}

// Boots the jar detached (logging next to it) and polls until the SDK answers or times out.
async function startSdk(jar, url) {
  console.log(`[validate-migration] starting SDK: ${jar} (first boot can take several minutes)`);
  const log = fs.openSync(path.join(path.dirname(jar), 'validate-migration-sdk.log'), 'a');
  const child = spawn('java', ['-jar', path.basename(jar)], {
    cwd: path.dirname(jar), detached: true, stdio: ['ignore', log, log],
  });
  child.unref();

  const deadline = Date.now() + SDK_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SDK_POLL_MS));
    if (await isReachable(url)) return true;
  }
  console.error(`[validate-migration] SDK did not answer on ${url} within ${SDK_BOOT_TIMEOUT_MS / 1000}s — see validate-migration-sdk.log next to the jar.`);
  return false;
}

/**
 * @param {string} url SDK base URL expected once booted
 * @param {{search?: string, noStart?: boolean}} [opts] search root (default cwd); noStart = detect only
 * @returns {Promise<boolean>} true once the SDK is reachable
 */
async function ensureSdk(url, opts = {}) {
  if (await isReachable(url)) return true;
  if (opts.noStart) return false;

  const root = path.resolve(typeof opts.search === 'string' ? opts.search : process.cwd());
  console.log(`[validate-migration] SDK not reachable — searching for Quickstart jar under ${root}`);
  const jars = findQuickstartJars(root);

  if (jars.length === 0) {
    console.error('[validate-migration] no AEM SDK Quickstart jar found. Download it from Adobe Software Distribution:');
    console.error(`  ${DOWNLOAD_URL}`);
    return false;
  }
  if (jars.length > 1) {
    console.error('[validate-migration] multiple Quickstart jars found — pass --search <dir> to disambiguate:');
    for (const j of jars) console.error(`  ${j}`);
    return false;
  }
  return startSdk(jars[0], url);
}

module.exports = { ensureSdk, isReachable, findRunningSdk, findQuickstartJars };
