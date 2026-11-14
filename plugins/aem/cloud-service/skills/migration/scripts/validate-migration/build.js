'use strict';

/**
 * build.js — wraps `mvn clean package -DskipTests` for a validate-migration project.
 *
 * Input : { projectDir }
 * Output: { ok, artifactPath, log, elapsedMs }
 *
 * Uses whatever `java` / JAVA_HOME the customer has. Set AEM_JAVA_HOME to pin
 * a specific JDK for validate-migration builds without touching JAVA_HOME globally.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Pick the build output a pattern needs from target/: bundle-runtime patterns
// deploy an OSGi `.jar`; source-only patterns (legacy-ui, cdw) inspect a
// content-package `.zip`, falling back to a content-embedding jar. Returns the
// filename or undefined.
function selectArtifact(files, artifact) {
  const jar = files.find((f) => f.endsWith('.jar') && !/-(sources|javadoc|tests)\.jar$/.test(f));
  const zip = files.find((f) => f.endsWith('.zip'));
  return artifact === 'content-package' ? (zip || jar) : (jar || zip);
}

function build({ projectDir, artifact = 'bundle' }) {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(projectDir, 'pom.xml'))) {
    return { ok: false, log: `no pom.xml at ${projectDir}` };
  }
  const env = { ...process.env };
  if (process.env.AEM_JAVA_HOME) env.JAVA_HOME = process.env.AEM_JAVA_HOME;

  let log;
  try {
    // validate-migration verifies runtime contract on the SDK, not customer test correctness.
    log = execFileSync('mvn', ['-q', '-B', '-DskipTests', 'clean', 'package'],
      { cwd: projectDir, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, log: (e.stdout || '') + (e.stderr || e.message), elapsedMs: Date.now() - t0 };
  }

  const targetDir = path.join(projectDir, 'target');
  const chosen = selectArtifact(fs.readdirSync(targetDir), artifact);
  if (!chosen) {
    const want = artifact === 'content-package' ? '.zip content package (or content-embedding .jar)' : '.jar bundle';
    return { ok: false, log: `no ${want} under target/`, elapsedMs: Date.now() - t0 };
  }
  return { ok: true, artifactPath: path.join(targetDir, chosen), log, elapsedMs: Date.now() - t0 };
}

module.exports = { build, selectArtifact };
