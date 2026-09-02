'use strict';

/**
 * run-tests.js — run the customer's own JUnit + integration tests against the
 * migrated bundle deployed on the Cloud SDK.
 *
 *   mvn verify -Dsling.it.instance.url=<sdk>
 *
 * The customer's tests are the ground truth for business functionality. If
 * their tests were passing before the migration and pass after against the
 * SDK, business behaviour is preserved.
 *
 * Input : { projectDir, sdkUrl, user='admin', password='admin' }
 * Output: { ok, log, summary: { tests, failures, errors, skipped }, elapsedMs }
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_JAVA_11 = '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home';

function runTests({ projectDir, sdkUrl, user = 'admin', password = 'admin' }) {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(projectDir, 'pom.xml'))) return { ok: false, log: `no pom.xml at ${projectDir}` };
  const env = { ...process.env };
  if (process.env.RV_JAVA_HOME) env.JAVA_HOME = process.env.RV_JAVA_HOME;
  else if (!env.JAVA_HOME && fs.existsSync(DEFAULT_JAVA_11)) env.JAVA_HOME = DEFAULT_JAVA_11;

  // Set every property name we've seen customers use for their integration-
  // test target URL. Whichever their framework reads, it will find one.
  const args = ['-B', 'verify',
    '-DskipTests=false', '-DskipITs=false',
    '-Dsling.it.instance.url=' + sdkUrl,
    '-Dsling.it.instance.user=' + user,
    '-Dsling.it.instance.password=' + password,
    '-Dsling.it.instances=1',
    '-Dsling.it.server.url=' + sdkUrl,
    '-Dsling.it.server.username=' + user,
    '-Dsling.it.server.password=' + password,
    '-Dit.launchpad.url=' + sdkUrl,
    '-Daem.host=' + sdkUrl.replace(/^https?:\/\//,'').replace(/:.*$/,''),
    '-Daem.port=' + (sdkUrl.match(/:(\d+)/) || [])[1],
    '-Dsling.host=' + sdkUrl.replace(/^https?:\/\//,'').replace(/:.*$/,''),
    '-Dsling.port=' + (sdkUrl.match(/:(\d+)/) || [])[1],
  ];

  let log;
  try {
    log = execFileSync('mvn', args, { cwd: projectDir, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: 'pipe' });
  } catch (e) {
    log = (e.stdout || '') + (e.stderr || e.message);
    const summary = parseMavenTestSummary(log);
    return { ok: false, log, summary, elapsedMs: Date.now() - t0 };
  }
  const summary = parseMavenTestSummary(log);
  const ok = summary.failures === 0 && summary.errors === 0;
  return { ok, log, summary, elapsedMs: Date.now() - t0 };
}

/**
 * Parse the last surefire/failsafe summary line:
 *   Tests run: 42, Failures: 0, Errors: 0, Skipped: 0
 * Returns { tests, failures, errors, skipped, note? }.
 * A project with no tests reports `note: 'no test summary found …'`.
 */
function parseMavenTestSummary(log) {
  const rows = [...log.matchAll(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/g)];
  if (!rows.length) return { tests: 0, failures: 0, errors: 0, skipped: 0, note: 'no test summary found (project may have no tests)' };
  const last = rows[rows.length - 1];
  return { tests: +last[1], failures: +last[2], errors: +last[3], skipped: +last[4] };
}

module.exports = { runTests };
