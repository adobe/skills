'use strict';

/**
 * build.js — wraps `mvn clean package` for an RV project.
 *
 * Input : { projectDir }
 * Output: { ok, artifactPath, log, elapsedMs }
 *
 * Requires Java 11 on PATH (or JAVA_HOME). The RV bundle-plugin pom sets
 * source/target=11; a Java 21 default JDK targeting 11 bytecode also works,
 * but users can force Java 11 via RV_JAVA_HOME.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_JAVA_11 = '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home';

function build({ projectDir }) {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(projectDir, 'pom.xml'))) {
    return { ok: false, log: `no pom.xml at ${projectDir}` };
  }
  const env = { ...process.env };
  if (process.env.RV_JAVA_HOME) env.JAVA_HOME = process.env.RV_JAVA_HOME;
  else if (!env.JAVA_HOME && fs.existsSync(DEFAULT_JAVA_11)) env.JAVA_HOME = DEFAULT_JAVA_11;

  let log;
  try {
    log = execFileSync('mvn', ['-q', '-B', 'clean', 'package'],
      { cwd: projectDir, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, log: (e.stdout || '') + (e.stderr || e.message), elapsedMs: Date.now() - t0 };
  }

  const targetDir = path.join(projectDir, 'target');
  const jar = fs.readdirSync(targetDir).find(f => f.endsWith('.jar') && !f.endsWith('-sources.jar'));
  if (!jar) return { ok: false, log: 'no artifact under target/', elapsedMs: Date.now() - t0 };
  return { ok: true, artifactPath: path.join(targetDir, jar), log, elapsedMs: Date.now() - t0 };
}

module.exports = { build };
