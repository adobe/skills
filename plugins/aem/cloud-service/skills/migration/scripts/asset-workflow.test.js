'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseJavaVersion, checkProject, checkCleanGitTree, runMigrator, parseArgs, main, runAssetWorkflowScan,
} = require('./asset-workflow-run.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'awf-'));
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}
function project(root) {
  write(root, 'pom.xml', '<project><modules><module>ui.content</module><module>core</module></modules></project>');
  write(root, 'ui.content/pom.xml', '<project><packaging>content-package</packaging></project>');
  write(root, 'core/pom.xml', '<project><packaging>bundle</packaging></project>');
}
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

test('parseJavaVersion reads old and new version schemes', () => {
  assert.strictEqual(parseJavaVersion('openjdk version "21.0.2" 2024-01-16').major, 21);
  assert.strictEqual(parseJavaVersion('java version "1.8.0_392"').major, 8);
  assert.strictEqual(parseJavaVersion('nothing'), null);
});

test('checkProject needs a multi-module project with a content-package module', () => {
  const root = tmp();
  assert.match(checkProject(root).error, /no pom\.xml/);
  write(root, 'pom.xml', '<project/>');
  assert.match(checkProject(root).error, /no <modules>/);
  write(root, 'pom.xml', '<project><modules><module>core</module></modules></project>');
  write(root, 'core/pom.xml', '<project><packaging>bundle</packaging></project>');
  assert.match(checkProject(root).error, /content-package/);
  project(root);
  assert.deepStrictEqual(checkProject(root).contentModules, ['ui.content']);
});

test('checkCleanGitTree: not git, dirty, clean, and excluded report dir', () => {
  const root = tmp();
  assert.strictEqual(checkCleanGitTree(root).git, false);
  git(root, 'init', '-q');
  git(root, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  assert.strictEqual(checkCleanGitTree(root).ok, true);
  write(root, 'target/report/x.md', 'x');
  assert.strictEqual(checkCleanGitTree(root).ok, false);
  assert.strictEqual(checkCleanGitTree(root, [path.join(root, 'target', 'report')]).ok, true);
});

test('parseArgs', () => {
  assert.deepStrictEqual(parseArgs(['p', '--jar', 'a.jar', '--allow-dirty']), { root: 'p', jar: 'a.jar', reportDir: null, allowDirty: true });
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['p', '--nope']), /unknown option/);
  assert.throws(() => parseArgs(['p', '--jar']), /needs a value/);
});

test('main stops with exit 2 before running anything', () => {
  const out = [];
  const log = m => out.push(m);
  assert.strictEqual(main([], log), 2);
  const bad = tmp();
  assert.strictEqual(main([bad], log), 2);
  assert.match(out.join('\n'), /no pom\.xml/);
  const root = tmp();
  project(root);
  git(root, 'init', '-q');
  write(root, 'dirty.txt', 'x');
  out.length = 0;
  assert.strictEqual(main([root, '--jar', path.join(root, 'missing.jar')], log), 2);
  assert.match(out.join('\n'), /uncommitted/);
  out.length = 0;
  assert.strictEqual(main([root, '--allow-dirty', '--jar', path.join(root, 'missing.jar')], log), 2);
  assert.match(out.join('\n'), /does not exist/);
});

// A stub "java" lets us test the success check without the real tool: the tool exits 0 even when it fails.
function stubJava(script) {
  const dir = tmp();
  const bin = path.join(dir, 'java');
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return bin;
}

test('runMigrator succeeds only when the tool says it completed and wrote the report', { skip: process.platform === 'win32' }, () => {
  const report = tmp();
  const ok = runMigrator('/p', report, 'x.jar', stubJava('echo "Migration complete."; echo "# report" > migration-report.md'));
  assert.strictEqual(ok.ok, true);
  const noReport = runMigrator('/p', report, 'x.jar', stubJava('echo "Migration complete."'));
  assert.match(noReport.error, /migration-report\.md was not written/);
  const failed = runMigrator('/p', report, 'x.jar', stubJava('echo "ERROR something"; echo "# report" > migration-report.md'));
  assert.match(failed.error, /Migration complete/);
  const stale = tmp();
  write(stale, 'migration-report.md', 'old');
  assert.strictEqual(runMigrator('/p', stale, 'x.jar', stubJava('echo "Migration complete."')).ok, false, 'a leftover report must not count');
});

test('runAssetWorkflowScan lists only enabled DAM asset launchers', () => {
  const root = tmp();
  const base = 'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/launcher/config';
  const l = (enabled, glob) => `<jcr:root jcr:primaryType="cq:WorkflowLauncher" enabled="{Boolean}${enabled}" glob="${glob}" workflow="/var/workflow/models/m"/>`;
  write(root, `${base}/a/.content.xml`, l(true, '/content/dam/x/.*/renditions/original'));
  write(root, `${base}/b/.content.xml`, l(false, '/content/dam/x/.*'));
  write(root, `${base}/c/.content.xml`, l(true, '/content/dam/collections/.*'));
  write(root, `${base}/d/.content.xml`, l(true, '/content/site/.*'));
  write(root, `target/${base}/e/.content.xml`, l(true, '/content/dam/x/.*'));
  const r = runAssetWorkflowScan(root);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.findings.length, 1);
  assert.match(r.findings[0].detail, /launcher a .*Branch H/);
  assert.strictEqual(r.rawFindings[0].pattern, 'assetWorkflowMigration');
  assert.strictEqual(runAssetWorkflowScan('').ok, false);
});
