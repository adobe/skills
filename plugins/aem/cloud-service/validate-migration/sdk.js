'use strict';

/**
 * sdk.js — shared "make sure a local AEM instance is running" logic used by init.js and check.js.
 * If the Cloud SDK or AEM 6.5 is down: search for its jar, boot it on the expected port,
 * and wait until it answers.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KINDS = {
  sdk: { name: 'AEM SDK', jarRe: /^aem-sdk-quickstart.*\.jar$/i,
    download: 'https://experience.adobe.com/#/downloads/content/software-distribution/en/aemcloud.html' },
  quickstart: { name: 'AEM 6.5 Quickstart', jarRe: /^(cq-quickstart-6\.5|aem_6\.5_quickstart)(?!.*standalone).*\.jar$/i },
};
// Fixed local ports: AEM 6.5 Quickstart (source) on 4502, Cloud SDK (target) on 4602.
const QUICKSTART_URL = 'http://localhost:4502';
const SDK_URL = 'http://localhost:4602';
const BOOT_TIMEOUT_MS = 600000;
const POLL_MS = 3000;
const ABOUT_PATH = '/mnt/overlay/granite/ui/content/shell/about.html';

async function verifyInstanceRole(url, kindKey) {
  const kind = KINDS[kindKey];
  const authVar = kindKey === 'sdk' ? 'AEM_TARGET_AUTH' : 'AEM_SOURCE_AUTH';
  const auth = process.env[authVar];
  let response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}${ABOUT_PATH}`, {
      headers: auth ? { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {},
      redirect: 'manual', signal: AbortSignal.timeout(5000),
    });
  } catch {
    console.error(`[validate-migration] cannot verify ${kind.name} at ${url}: About page unavailable.`);
    return false;
  }
  if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
    console.error(`[validate-migration] cannot verify ${kind.name} at ${url}: login required or rejected. Set ${authVar}=<user>:<password> in your terminal and rerun; never share the value in chat.`);
    return false;
  }
  if (response.status !== 200) {
    console.error(`[validate-migration] cannot verify ${kind.name} at ${url}: About page returned HTTP ${response.status}.`);
    return false;
  }
  const version = ((await response.text()).match(/Adobe Experience Manager\s+([0-9][\w.-]*)/) || [])[1];
  const matches = kindKey === 'sdk' ? /^20\d{2}\./.test(version || '') : /^6\.5(?:\.|$)/.test(version || '');
  if (!matches) {
    console.error(`[validate-migration] expected ${kind.name} at ${url}, but ${version ? `found AEM ${version}` : 'no recognizable AEM version was found'}. Check the selected instance URL.`);
  }
  return matches;
}

async function isReachable(url, timeoutMs = 3000) {
  try {
    const res = await fetch(`${url}/`, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch { return false; }
}

// Skips heavy build/VCS dirs; returns every matching jar path under `root`.
function findQuickstartJars(root, jarRe = KINDS.sdk.jarRe, depth = 4) {
  const found = [];
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'crx-quickstart']);
  const walk = (dir, left) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (left > 0 && !skip.has(e.name)) walk(path.join(dir, e.name), left - 1);
      } else if (jarRe.test(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  walk(root, depth);
  return found;
}

// Boots the jar detached on the URL's port (logging next to it) and polls until it answers or times out.
async function startInstance(jar, url, kindKey) {
  const { name } = KINDS[kindKey];
  console.log(`[validate-migration] starting ${name}: ${jar} on ${url} (first boot can take several minutes)`);
  const log = fs.openSync(path.join(path.dirname(jar), 'validate-migration-sdk.log'), 'a');
  const port = new URL(url).port || '4502';
  const child = spawn('java', ['-jar', path.basename(jar), '-p', port, '-nobrowser'], {
    cwd: path.dirname(jar), detached: true, stdio: ['ignore', log, log],
  });
  child.unref();

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (await isReachable(url)) return verifyInstanceRole(url, kindKey);
  }
  console.error(`[validate-migration] ${name} did not answer on ${url} within ${BOOT_TIMEOUT_MS / 1000}s — see validate-migration-sdk.log next to the jar.`);
  return false;
}

/**
 * @param {string} url base URL expected once booted
 * @param {{kind?: 'sdk'|'quickstart', search?: string, noStart?: boolean}} [opts] search root (default cwd); noStart = detect only
 * @returns {Promise<boolean>} true once the instance is reachable and its product role is verified
 */
async function ensureInstance(url, opts = {}) {
  const kindKey = opts.kind || 'sdk';
  const kind = KINDS[kindKey];
  if (await isReachable(url)) return verifyInstanceRole(url, kindKey);
  if (opts.noStart) {
    console.error(`[validate-migration] ${kind.name} is not reachable on ${url}; start it or rerun without --no-start.`);
    return false;
  }

  const root = path.resolve(typeof opts.search === 'string' ? opts.search : process.cwd());
  console.log(`[validate-migration] ${kind.name} not reachable on ${url} — searching for its jar under ${root}`);
  const jars = findQuickstartJars(root, kind.jarRe);

  if (jars.length === 0) {
    console.error(`[validate-migration] no ${kind.name} jar found under ${root}.`);
    if (kind.download) console.error(`  Download: ${kind.download}`);
    return false;
  }
  if (jars.length > 1) {
    console.error(`[validate-migration] multiple ${kind.name} jars found — pass --search <dir> to disambiguate:`);
    for (const j of jars) console.error(`  ${j}`);
    return false;
  }
  return startInstance(jars[0], url, kindKey);
}

const ensureSdk = (url, opts = {}) => ensureInstance(url, { ...opts, kind: 'sdk' });

module.exports = { ensureSdk, ensureInstance, isReachable, findQuickstartJars, SDK_URL, QUICKSTART_URL };
