'use strict';

/**
 * deploy.js — install an OSGi bundle on a running AEM Cloud SDK via the Felix
 * Web Console, then poll until the bundle reports `state == "Active"`.
 *
 * Input : { artifactPath, sdkUrl, user='admin', password='admin', timeoutMs=60000 }
 * Output: { ok, bundleId, state, symbolicName, elapsedMs, log }
 */
const fs = require('fs');
const path = require('path');

async function deploy({ artifactPath, sdkUrl, user = 'admin', password = 'admin', timeoutMs = 60000 } = {}) {
  const t0 = Date.now();
  if (!fs.existsSync(artifactPath)) return { ok: false, log: `artifact missing: ${artifactPath}` };
  const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  const symbolicName = readBundleSymbolicName(artifactPath);
  if (!symbolicName) return { ok: false, log: 'could not read Bundle-SymbolicName from artifact' };

  // 1. install via Felix Web Console (multipart/form-data)
  const form = new FormData();
  form.append('action', 'install');
  form.append('bundlestart', 'start');
  form.append('bundlestartlevel', '20');
  form.append('bundlefile', new Blob([fs.readFileSync(artifactPath)]), path.basename(artifactPath));
  const installRes = await fetch(`${sdkUrl}/system/console/bundles`, { method: 'POST', headers: { Authorization: auth }, body: form });
  if (installRes.status !== 200 && installRes.status !== 302) {
    return { ok: false, symbolicName, log: `install failed: HTTP ${installRes.status}`, elapsedMs: Date.now() - t0 };
  }

  // 2. poll until Active (or fail). Felix quirk: same-BSN reinstalls land in
  //    `Installed` and ignore bundlestart=start — issue an explicit start once
  //    we see it stuck there.
  const deadline = t0 + timeoutMs;
  let last = null, startNudged = false;
  while (Date.now() < deadline) {
    await sleep(1500);
    const res = await fetch(`${sdkUrl}/system/console/bundles/${symbolicName}.json`, { headers: { Authorization: auth } });
    if (!res.ok) continue;
    const data = await res.json();
    const b = (data.data || [])[0];
    if (!b) continue;
    last = { id: b.id, state: b.state, symbolicName: b.symbolicName };
    if (b.state === 'Active') {
      return { ok: true, bundleId: b.id, state: b.state, symbolicName: b.symbolicName, elapsedMs: Date.now() - t0 };
    }
    if (b.state === 'Installed' && !startNudged) {
      startNudged = true;
      const nudge = new FormData(); nudge.append('action', 'start');
      await fetch(`${sdkUrl}/system/console/bundles/${b.id}`, { method: 'POST', headers: { Authorization: auth }, body: nudge });
    }
  }
  return { ok: false, symbolicName, state: last && last.state, log: `bundle did not reach Active within ${timeoutMs}ms (state=${last && last.state})`, elapsedMs: Date.now() - t0 };
}

// Reads Bundle-SymbolicName from the jar's MANIFEST.MF via `unzip -p`.
function readBundleSymbolicName(jarPath) {
  const { execFileSync } = require('child_process');
  try {
    const mf = execFileSync('unzip', ['-p', jarPath, 'META-INF/MANIFEST.MF'], { encoding: 'utf8' });
    // MANIFEST folds long lines with "\r\n " continuations — unfold before matching
    const unfolded = mf.replace(/\r?\n /g, '');
    const m = unfolded.match(/^Bundle-SymbolicName:\s*(.+?)\s*$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { deploy };
