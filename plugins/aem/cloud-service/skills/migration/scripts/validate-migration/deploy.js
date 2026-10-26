'use strict';

/**
 * deploy.js — install an OSGi bundle on a running AEM Cloud SDK.
 *
 * Uses only the customer project's own `autoInstallBundle` (or
 * `autoInstallPackage`) Maven profile — the AEM archetype standard. The
 * project's pom/settings own the install endpoint and credentials; this skill
 * never talks to the SDK console or holds credentials. Only the target host
 * and port are passed so the project deploys to the selected local SDK.
 *
 * If no such profile exists, deploy returns `ok: false` and the developer
 * deploys the bundle themselves before the MCP diagnosis step.
 *
 * Bundle/component *state* is not asserted here; that's the runtime verify
 * step's job via the diagnose-osgi-bundle MCP tool.
 *
 * Input : { projectDir, artifactPath, sdkUrl, timeoutMs=180000 }
 * Output: { ok, symbolicName, mode, elapsedMs, log }
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function deploy({ projectDir, artifactPath, sdkUrl, timeoutMs = 180_000 } = {}) {
  const t0 = Date.now();
  if (!fs.existsSync(artifactPath)) return { ok: false, log: `artifact missing: ${artifactPath}` };
  const symbolicName = readBundleSymbolicName(artifactPath);
  if (!symbolicName) return { ok: false, log: 'could not read Bundle-SymbolicName from artifact' };

  const profile = projectDir ? detectAutoInstallProfile(projectDir) : null;
  if (!profile) {
    return {
      ok: false, symbolicName, mode: 'manual', elapsedMs: Date.now() - t0,
      log: 'No autoInstallBundle/autoInstallPackage Maven profile found in the project. '
        + `Deploy ${symbolicName} to the local SDK with your project's usual deployment, then re-run.`,
    };
  }

  const sdk = new URL(sdkUrl);
  const args = [
    '-q', '-B', '-DskipTests',
    '-P', profile,
    '-Daem.host=' + sdk.hostname,
    '-Daem.port=' + (sdk.port || (sdk.protocol === 'https:' ? '443' : '80')),
    'install',
  ];
  try {
    const log = execFileSync('mvn', args, { cwd: projectDir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, symbolicName, mode: 'profile:' + profile, log, elapsedMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, symbolicName, mode: 'profile:' + profile, log: (e.stdout || '') + (e.stderr || e.message), elapsedMs: Date.now() - t0 };
  }
}

// Walks up from projectDir looking for the AEM archetype's install profile in
// any pom.xml. Prefers `autoInstallBundle` for jar packaging and
// `autoInstallPackage` for content-package packaging. Returns null when
// neither is defined anywhere in the ancestor chain.
function detectAutoInstallProfile(projectDir) {
  const modulePkg = readPackagingType(path.join(projectDir, 'pom.xml'));
  const preferred = modulePkg === 'content-package' || modulePkg === 'zip' ? 'autoInstallPackage' : 'autoInstallBundle';
  let dir = projectDir;
  for (let i = 0; i < 6; i++) {
    const pom = path.join(dir, 'pom.xml');
    if (fs.existsSync(pom)) {
      const xml = fs.readFileSync(pom, 'utf8');
      if (new RegExp(`<id>\\s*${preferred}\\s*</id>`).test(xml)) return preferred;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackagingType(pomPath) {
  try {
    const xml = fs.readFileSync(pomPath, 'utf8');
    const m = xml.match(/<packaging>\s*([\w-]+)\s*<\/packaging>/);
    return m ? m[1] : 'jar';
  } catch { return 'jar'; }
}

// Reads Bundle-SymbolicName from the jar's MANIFEST.MF via `unzip -p`.
function readBundleSymbolicName(jarPath) {
  try {
    const mf = execFileSync('unzip', ['-p', jarPath, 'META-INF/MANIFEST.MF'], { encoding: 'utf8' });
    // MANIFEST folds long lines with "\r\n " continuations — unfold before matching
    const unfolded = mf.replace(/\r?\n /g, '');
    const m = unfolded.match(/^Bundle-SymbolicName:\s*(.+?)\s*$/m);
    // Strip directives/attributes: `com.foo;singleton:=true` → `com.foo`.
    return m ? m[1].split(';')[0].trim() : null;
  } catch { return null; }
}

module.exports = { deploy, readBundleSymbolicName };
