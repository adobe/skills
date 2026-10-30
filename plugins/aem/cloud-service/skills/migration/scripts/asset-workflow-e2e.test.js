'use strict';
// Branch H end to end with the real wf-migrator JAR. Opt in with ASSET_WF_E2E=1 (needs Java 11+ and git;
// the catalog check also needs unzip).
//   ASSET_WF_JAR=<path>     use a local wf-migrator jar instead of downloading the pinned release
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
const RUN = require('./asset-workflow-run.js');
const CAT = require('./asset-workflow-catalog.js');
const F = require('./asset-workflow-followup.js');
const T = require('./fixtures/asset-workflow.js');

function skipReason() {
  if (process.env.ASSET_WF_E2E !== '1') return 'set ASSET_WF_E2E=1 to run the real migration tool';
  const java = RUN.checkJava();
  if (!java.ok) return java.error;
  if (spawnSync('git', ['--version']).error) return 'git not found';
  return false;
}
const SKIP = skipReason();

function jar() {
  if (process.env.ASSET_WF_JAR) return path.resolve(process.env.ASSET_WF_JAR);
  const inst = RUN.ensureToolInstalled(RUN.TOOL_DIR);
  assert.ok(inst.installed, inst.error);
  return inst.jar;
}

function withTmp(fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'awe2e-'));
  try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
};

test('E2E: the step catalog matches the tool\'s workflowSteps.properties', { skip: SKIP }, t => {
  const r = spawnSync('unzip', ['-p', jar(), 'workflowSteps.properties'], { encoding: 'utf8' });
  if (r.error) return t.skip('unzip not found');
  assert.strictEqual(r.status, 0, r.stderr);
  const fromJar = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m) fromJar[m[1]] = m[2].split(',').map(s => s.trim()).filter(Boolean).sort();
  }
  const fromCatalog = Object.fromEntries(Object.entries(CAT.CATALOG).map(([k, v]) => [k, [...v].sort()]));
  assert.deepStrictEqual(fromCatalog, fromJar, 'update CATALOG in asset-workflow-catalog.js to match the tool release');
});

test('E2E: wf-migrator output still matches the recorded output the unit tests use', { skip: SKIP }, () => withTmp(d => {
  const project = T.materializeProject(path.join(d, 'project'));
  const run = RUN.runMigrator(project, path.join(d, 'report'), jar());
  assert.ok(run.ok, `${run.error}\n${run.stdout}`);
  assert.deepStrictEqual(T.diffAgainstSnapshot(project), [], 'the tool output changed; update TOOL_WRITTEN / TOOL_DELETED in fixtures/asset-workflow.js');
  assert.deepStrictEqual(F.parseToolIssues(fs.readFileSync(run.reportPath, 'utf8')), F.parseToolIssues(T.TOOL_REPORT), 'update TOOL_REPORT in fixtures/asset-workflow.js');
}));

test('E2E: migrate runs the tool and passes verification; a verify-only re-run agrees', { skip: SKIP }, () => withTmp(d => {
  const project = T.materializeProject(path.join(d, 'project'));
  git(project, 'init', '-q');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'baseline');
  const args = [project, '--jar', jar(), '--acknowledge', 'CommandLineProcess,/var/workflow/models/wfmin-legacy'];

  const lines = [];
  assert.strictEqual(RUN.main(args, l => lines.push(l)), 0, lines.join('\n'));
  const reportDir = path.join(project, 'target', 'asset-workflow-migration');
  const result = JSON.parse(fs.readFileSync(path.join(reportDir, 'asset-workflow-result.json'), 'utf8'));
  assert.ok(result.tool.ok && result.verify.ok);
  if (!process.env.ASSET_WF_JAR) assert.strictEqual(result.tool.version, RUN.TOOL_VERSION);
  assert.ok(fs.existsSync(path.join(reportDir, 'tool', 'migration-report.md')));
  assert.ok(fs.existsSync(path.join(reportDir, 'asset-workflow-report.md')));
  const changed = git(project, 'status', '--porcelain', '-uall', '--', '.', ':(exclude)target').split('\n').filter(Boolean);
  assert.ok(changed.some(l => l.includes('CustomDamWorkflowRunnerImpl.cfg.json')), changed.join('\n'));

  assert.ok(result.followUps.manual.some(m => m.code === 'needs-custom-worker'), 'issues from the tool report reach the checklist');

  const again = RUN.migrate(RUN.parseArgs([...args, '--verify-only']));
  assert.strictEqual(again.exitCode, 0, again.error);
  assert.ok(again.verify.ok);
}));
