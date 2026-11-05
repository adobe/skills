'use strict';
// Branch H (asset workflow migration): catalog, XML reading, inventory, verification, follow-ups, report,
// custom Java step review and runner helpers. No Java needed — the tool's output is recorded in
// fixtures/asset-workflow.js, and the skill only reads it.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');
const { X } = I;
const K = require('./asset-workflow-check.js');
const S = require('./asset-workflow-custom-steps.js');
const RUN = require('./asset-workflow-run.js');
const T = require('./fixtures/asset-workflow.js');

const MODELS = '/conf/global/settings/workflow/models';
const CONTENT = 'ui.content/src/main/content';
const MODEL_DIR = `${CONTENT}/jcr_root/conf/global/settings/workflow/models`;
const LAUNCHER_DIR = `${CONTENT}/jcr_root/conf/global/settings/workflow/launcher/config`;
const ACKS = ['CommandLineProcess'];
const ORPHAN = '/var/workflow/models/wfmin-legacy';
const PKG = 'com.example.wfmin.core.workflow';
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const withTmp = (prefix, fn) => { const d = tmp(prefix); try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); } };
const categories = r => [...new Set(r.failures.map(f => f.category))].sort();

// ── Catalog ───────────────────────────────────────────────────────────

test('catalog: classifies steps like workflowSteps.properties, plus custom, script and noop', () => {
  assert.strictEqual(C.classifyStep('com.day.cq.dam.core.process.CommandLineProcess'), 'NUI_MIGRATED');
  assert.strictEqual(C.classifyStep('com.day.cq.dam.core.process.CreateSubAssetsProcess'), 'UNSUPPORTED');
  assert.strictEqual(C.classifyStep('com.day.cq.dam.core.process.ThumbnailProcess'), 'NUI_MIGRATED');
  assert.strictEqual(C.classifyStep('com.day.cq.dam.core.process.MetadataProcessorProcess'), 'NUI_OOTB');
  assert.strictEqual(C.classifyStep('com.day.cq.dam.scene7.impl.process.Scene7UploadProcess'), 'DMS7_OOTB');
  assert.strictEqual(C.classifyStep('com.day.cq.dam.core.process.GateKeeperProcess'), 'UNNECESSARY');
  assert.strictEqual(C.classifyStep(C.COMPLETED_PROCESS), 'REQUIRED');
  assert.strictEqual(C.classifyStep('com.example.MyProcess'), 'CUSTOM');
  assert.strictEqual(C.classifyStep('/apps/x/workflow/step.ecma'), 'SCRIPT');
  assert.strictEqual(C.classifyStep(C.NOOP_SCRIPT), 'NOOP');
  assert.strictEqual(C.classifyStep(null), 'NONE');
});

test('catalog: real work is SUPPORTED, CUSTOM or SCRIPT; NOOP is kept but is not work', () => {
  for (const c of ['SUPPORTED', 'CUSTOM', 'SCRIPT']) assert.ok(C.isRealWork(c), c);
  for (const c of ['NOOP', 'REQUIRED', 'OPTIONAL', 'UNSUPPORTED', 'NUI_OOTB']) assert.ok(!C.isRealWork(c), c);
  assert.ok(C.isKept('NOOP') && C.isKept('CUSTOM') && !C.isKept('UNSUPPORTED'));
  assert.strictEqual(C.shortName('com.day.cq.dam.core.process.CommandLineProcess'), 'CommandLineProcess');
});

test('catalog: steps the tool may drop without a replacement need acknowledging: UNSUPPORTED ones and command lines', () => {
  assert.ok(C.requiresAck('com.day.cq.dam.core.process.CommandLineProcess'), 'only simple ImageMagick commands become renditions');
  assert.ok(C.requiresAck('com.day.cq.dam.core.process.CreateSubAssetsProcess'));
  for (const p of ['com.day.cq.dam.core.process.ThumbnailProcess', 'com.example.MyProcess', C.COMPLETED_PROCESS, null]) assert.ok(!C.requiresAck(p), p);
  assert.strictEqual(C.shortName('/apps/x/step.ecma'), '/apps/x/step.ecma');
});

// ── XML ───────────────────────────────────────────────────────────────

test('xml: multi-value properties keep commas inside values escaped', () => {
  assert.deepStrictEqual(X.parseMultiValue('[a,b\\,c]'), ['a', 'b,c']);
  assert.deepStrictEqual(X.parseMultiValue('[]'), []);
});

test('xml: only the read and check helpers remain; the skill does not edit XML', () => {
  for (const fn of ['parseXml', 'rootElement', 'child', 'getAttr', 'parseMultiValue', 'unboundPrefixes']) assert.strictEqual(typeof X[fn], 'function', fn);
  for (const fn of ['applyEdits', 'minimizeDiff', 'insertChildEdit', 'setAttrEdit']) assert.strictEqual(X[fn], undefined, fn);
});

// ── Inventory ─────────────────────────────────────────────────────────

test('inventory: reads models, launchers, runtime models and the legacy runner config of the fixture', () => {
  const inv = I.buildInventory(T.PROJECT);
  assert.deepStrictEqual(inv.models.map(m => m.confPath).sort(), [`${MODELS}/dam/update_asset`, `${MODELS}/wfmin-campaigns`, `${MODELS}/wfmin-marketing`]);
  assert.strictEqual(inv.launchers.length, 4);
  assert.ok(inv.launchers.every(l => l.enabled && l.isAsset));
  assert.strictEqual(inv.runtimeModels.length, 4);
  assert.strictEqual(inv.runnerConfigs.length, 1);
  const rc = inv.runnerConfigs[0];
  assert.strictEqual(rc.format, 'xml');
  assert.strictEqual(rc.runMode, 'author');
  assert.deepStrictEqual(rc.byPath.map(e => [e.match, e.model]), [['/content/dam/wfmin/brand', '/var/workflow/models/wfmin-brand']]);
});

test('inventory: predicts which workflows the tool migrates (real work anywhere, splits included)', () => {
  const inv = I.buildInventory(T.PROJECT);
  const wf = name => inv.workflows.find(w => w.model && w.model.confPath === `${MODELS}/${name}`);
  assert.strictEqual(inv.workflows.length, 3);
  assert.strictEqual(wf('dam/update_asset').launchers.length, 2);
  assert.ok(wf('dam/update_asset').toolWillMigrate);
  assert.ok(wf('wfmin-marketing').toolWillMigrate);
  // Only an AND split holds the custom step; the tool looks inside splits.
  assert.ok(wf('wfmin-campaigns').toolWillMigrate);
  const s = wf('dam/update_asset').summary;
  assert.ok(s.completed.present && !s.completed.last);
  assert.deepStrictEqual(s.unsupported.map(u => C.shortName(u.process)), ['CommandLineProcess']);
  assert.ok(!wf('wfmin-campaigns').model.transient);
});

test('inventory: model paths map between /conf, /var and /etc', () => {
  assert.strictEqual(I.confPathFor('/var/workflow/models/dam/update_asset'), `${MODELS}/dam/update_asset`);
  assert.strictEqual(I.confPathFor('/etc/workflow/models/x/jcr:content/model'), '/etc/workflow/models/x');
  assert.strictEqual(I.runtimePathFor(`${MODELS}/x`), '/var/workflow/models/x');
  assert.strictEqual(I.modelIdOf('/var/workflow/models/dam/update_asset'), 'dam/update_asset');
  assert.strictEqual(I.modelIdOf(`${MODELS}/dam/update_asset`), 'dam/update_asset');
});

test('inventory: runbook content scan reports one finding per asset workflow', () => {
  const r = I.runAssetWorkflowScan(T.PROJECT);
  assert.ok(r.ok);
  assert.strictEqual(r.findings.length, 3);
  assert.ok(r.findings.every(f => /Branch H/.test(f.detail)));
  assert.ok(r.rawFindings.every(f => f.pattern === 'assetWorkflowMigration'));
  const high = r.findings.filter(f => f.severity === 'high').length;
  assert.strictEqual(high, 3, 'every fixture workflow has custom or unsupported steps');
  assert.deepStrictEqual(I.runAssetWorkflowScan(null).findings, []);
});

// ── Verification ──────────────────────────────────────────────────────

test('inventory: a runtime model stored as <name>/.content.xml is found; plain folders are not', () => withTmp('awi-', d => {
  T.materializeProject(d);
  const vm = path.join(d, 'ui.content/src/main/content/jcr_root/var/workflow/models');
  const ns = 'xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"';
  fs.mkdirSync(path.join(vm, 'legacy-folder'), { recursive: true });
  fs.writeFileSync(path.join(vm, 'legacy-folder', '.content.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root ${ns} jcr:primaryType="cq:WorkflowModel" title="Legacy"/>\n`);
  fs.writeFileSync(path.join(vm, '.content.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root ${ns} jcr:primaryType="sling:Folder"/>\n`);
  const pre = I.buildInventory(d);
  const paths = pre.runtimeModels.map(r => r.path);
  assert.ok(paths.includes('/var/workflow/models/legacy-folder'), paths.join());
  assert.ok(!paths.includes('/var/workflow/models'));
  assert.deepStrictEqual(RUN.gateUnsupported(pre, ['CommandLineProcess', '/var/workflow/models/wfmin-legacy']).pendingOrphans.map(o => o.path), ['/var/workflow/models/legacy-folder']);
  fs.rmSync(path.join(vm, 'legacy-folder'), { recursive: true });
  const v = K.verifyMigration(pre, I.buildInventory(d), { acknowledge: ['CommandLineProcess', '/var/workflow/models/wfmin-legacy'] });
  assert.ok(v.failures.some(f => f.category === 'runtime-model-without-design-time' && /legacy-folder/.test(f.detail)));
}));

test('inventory: Felix .config arrays keep brackets inside quoted values; a broken array is an error', () => withTmp('awc-', d => {
  const jcr = path.join(d, 'jcr_root'); const dir = path.join(jcr, 'apps', 'x', 'osgiconfig', 'config.author');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${I.RUNNER_PID}.config`);
  fs.writeFileSync(f, 'postProcWorkflowsByPath=[ \\\n  "/content/dam/[a-z]+(/.*):/var/workflow/models/x", \\\n  "/content/dam/b\\"q:/var/workflow/models/y", \\\n  ]\npostProcWorkflowsByExpression=[]\n');
  const c = I.readRunnerConfig(f, jcr);
  assert.strictEqual(c.error, null);
  assert.deepStrictEqual(c.byPath.map(e => e.raw), ['/content/dam/[a-z]+(/.*):/var/workflow/models/x', '/content/dam/b"q:/var/workflow/models/y']);
  fs.writeFileSync(f, 'postProcWorkflowsByPath=["/content/dam/a:/var/workflow/models/x"\n');
  assert.match(String(I.readRunnerConfig(f, jcr).error), /postProcWorkflowsByPath/);
}));

test('verify: the tool output fails only on what needs a decision: removed unsupported steps and runtime-only models', () => withTmp('awv-', d => {
  T.materializeToolOutput(d);
  const v = K.verifyMigration(I.buildInventory(T.PROJECT), I.buildInventory(d), {});
  assert.ok(!v.ok);
  assert.deepStrictEqual(categories(v), ['runtime-model-without-design-time', 'unsupported-step-removed']);
}));

test('verify: the tool output passes once acknowledged, with warnings for what to check', () => withTmp('awv-', d => {
  T.materializeToolOutput(d);
  const pre = I.buildInventory(T.PROJECT); const post = I.buildInventory(d);
  assert.deepStrictEqual(categories(K.verifyMigration(pre, post, { acknowledge: ['CommandLineProcess'] })), ['runtime-model-without-design-time']);
  assert.deepStrictEqual(categories(K.verifyMigration(pre, post, { acknowledge: ['/var/workflow/models/wfmin-legacy'] })), ['unsupported-step-removed']);
  const ok = K.verifyMigration(pre, post, { acknowledge: ['CommandLineProcess', '/var/workflow/models/wfmin-legacy'] });
  assert.ok(ok.ok, JSON.stringify(ok.failures));
  assert.ok(ok.warnings.some(w => w.category === 'runner-model-not-in-project'));
  assert.ok(ok.warnings.some(w => w.category === 'model-not-transient'));
}));

test('verify: catches what a broken tool run would leave behind', () => withTmp('awv-', d => {
  // Simulate the 0.6.0 behaviour: update_asset left as it was and the old runner config kept next to the new one.
  T.materializeToolOutput(d);
  const model = 'ui.content/src/main/content/jcr_root/conf/global/settings/workflow/models/dam/update_asset/.content.xml';
  const runner = 'ui.apps/src/main/content/jcr_root/apps/wfmin/osgiconfig/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.xml';
  for (const f of [model, runner]) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.copyFileSync(path.join(T.PROJECT, f), path.join(d, f)); }
  const c = categories(K.verifyMigration(I.buildInventory(T.PROJECT), I.buildInventory(d), { acknowledge: ['all'] }));
  for (const k of ['completed-step-not-last', 'runner-config-duplicate-pid']) assert.ok(c.includes(k), c.join());
}));

// ── Runner helpers ────────────────────────────────────────────────────

test('run: parseArgs reads flags and comma-separated acknowledgements', () => {
  const o = RUN.parseArgs(['proj', '--dry-run', '--acknowledge', 'CommandLineProcess, /var/workflow/models/x', '--acknowledge', 'all', '--verify-only', '--report-dir', 'r', '--jar', 'j.jar', '--allow-dirty', '--json']);
  assert.strictEqual(o.root, 'proj');
  assert.deepStrictEqual(o.acknowledge, ['CommandLineProcess', '/var/workflow/models/x', 'all']);
  assert.ok(o.dryRun && o.verifyOnly && o.allowDirty && o.json);
  assert.strictEqual(o.reportDir, 'r');
  assert.strictEqual(o.jar, 'j.jar');
  assert.throws(() => RUN.parseArgs([]), /usage/);
  assert.throws(() => RUN.parseArgs(['p', '--nope']), /unknown option/);
  for (const gone of ['--fix-only', '--rename-ootb-models', '--emit-repoinit']) assert.throws(() => RUN.parseArgs(['p', gone]), /unknown option/, gone);
  assert.throws(() => RUN.parseArgs(['p', '--jar']), /needs a value/);
  assert.throws(() => RUN.parseArgs(['p', 'q']), /unexpected argument/);
});

test('run: parseJavaVersion handles modern and 1.x version strings', () => {
  assert.deepStrictEqual(RUN.parseJavaVersion('openjdk version "17.0.2" 2022-01-18'), { version: '17.0.2', major: 17 });
  assert.deepStrictEqual(RUN.parseJavaVersion('java version "1.8.0_292"'), { version: '1.8.0_292', major: 8 });
  assert.strictEqual(RUN.parseJavaVersion('garbage'), null);
  assert.ok(RUN.MIN_JAVA >= 11);
});

test('run: pinned tool coordinates', () => {
  assert.strictEqual(RUN.TOOL_VERSION, '0.7.0');
  assert.strictEqual(RUN.TOOL_URL, 'https://github.com/adobe/aem-cloud-migration/releases/download/v0.7.0/wf-migrator-0.7.0.jar');
  // SHA-256 of the wf-migrator-0.7.0.jar asset of the published v0.7.0 release.
  assert.strictEqual(RUN.TOOL_SHA256, '735eb507c4844df41bc36fd67c2bd0b57415f2873fa3c2b907af747c063a3e30');
});

test('run: a downloaded jar whose checksum does not match is not treated as installed', () => withTmp('awt-', d => {
  assert.ok(!RUN.isToolInstalled(d));
  fs.writeFileSync(path.join(d, RUN.TOOL_JAR), 'not the release jar');
  assert.ok(!RUN.isToolInstalled(d));
}));

test('run: checkProject needs a multi-module project with a content package', () => withTmp('awp-', d => {
  const ok = RUN.checkProject(T.PROJECT);
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.contentModules.sort(), ['all', 'ui.apps', 'ui.content']);
  assert.match(RUN.checkProject(d).error, /no pom.xml/);
  fs.writeFileSync(path.join(d, 'pom.xml'), '<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version></project>');
  assert.match(RUN.checkProject(d).error, /no <modules>/);
}));

test('run: the gate stops on unsupported steps and runtime-only models until acknowledged', () => {
  const pre = I.buildInventory(T.PROJECT);
  const g = RUN.gateUnsupported(pre, []);
  assert.ok(!g.ok);
  assert.deepStrictEqual(g.pending.map(s => [C.shortName(s.process), s.model]), [['CommandLineProcess', `${MODELS}/dam/update_asset`]]);
  assert.match(g.pending[0].remediation, /Asset Compute custom worker/);
  assert.deepStrictEqual(g.pendingOrphans.map(o => o.path), ['/var/workflow/models/wfmin-legacy']);
  assert.ok(!RUN.gateUnsupported(pre, ['CommandLineProcess']).ok);
  assert.ok(RUN.gateUnsupported(pre, ['CommandLineProcess', '/var/workflow/models/wfmin-legacy']).ok);
  assert.ok(RUN.gateUnsupported(pre, ['com.day.cq.dam.core.process.CommandLineProcess', '/var/workflow/models/wfmin-legacy']).ok);
  assert.ok(RUN.gateUnsupported(pre, ['all']).ok);
});

test('run: planPreview lists what each workflow keeps and loses', () => {
  const plan = RUN.planPreview(I.buildInventory(T.PROJECT));
  const p = name => plan.find(x => x.model === `${MODELS}/${name}`);
  assert.strictEqual(plan.length, 3);
  assert.deepStrictEqual(p('dam/update_asset').keep.map(s => s.step), ['DamUpdateAssetWorkflowCompletedProcess', 'WatermarkProcess']);
  assert.deepStrictEqual(p('dam/update_asset').remove.map(s => s.category), ['NUI_OOTB', 'NUI_MIGRATED', 'NUI_MIGRATED']);
  assert.ok(p('wfmin-campaigns').toolWillMigrate);
  assert.deepStrictEqual(p('wfmin-marketing').remove.map(s => [s.step, s.inSplit]), [['Scene7UploadProcess', true]]);
});

test('run: copyTree copies only config files and skips excluded and build folders', () => withTmp('awc-', d => {
  const src = path.join(d, 'src');
  fs.mkdirSync(path.join(src, 'a', 'target'), { recursive: true });
  fs.mkdirSync(path.join(src, 'skip'), { recursive: true });
  for (const f of ['a/x.xml', 'a/y.cfg.json', 'a/z.config', 'a/w.java', 'a/target/t.xml', 'skip/s.xml']) fs.writeFileSync(path.join(src, f), '');
  const n = RUN.copyTree(src, path.join(d, 'dest'), [path.join(src, 'skip')]);
  assert.strictEqual(n, 3);
  assert.deepStrictEqual(T.listFiles(path.join(d, 'dest')), ['a/x.xml', 'a/y.cfg.json', 'a/z.config']);
}));

test('run: checkCleanGitTree treats a folder outside git as clean', () => withTmp('awg-', d => {
  assert.deepStrictEqual(RUN.checkCleanGitTree(d, []), { ok: true, git: false, dirty: [] });
}));

test('run: --dry-run and a gate stop leave the project untouched', () => withTmp('awr-', d => {
  T.materializeProject(d);
  const before = T.listFiles(d);
  const dry = RUN.migrate(RUN.parseArgs([d, '--dry-run', '--report-dir', path.join(d, 'target', 'r')]));
  assert.strictEqual(dry.exitCode, 0);
  assert.strictEqual(dry.stage, 'dry-run');
  assert.strictEqual(dry.plan.length, 3);
  const stop = RUN.migrate(RUN.parseArgs([d, '--report-dir', path.join(d, 'target', 'r')]));
  assert.strictEqual(stop.exitCode, 2);
  assert.strictEqual(stop.stage, 'gate');
  assert.deepStrictEqual(T.listFiles(d), before);
}));

test('run: --verify-only with --baseline checks the tool output and writes the report without Java', () => withTmp('awr-', d => {
  const root = path.join(d, 'p'); const reportDir = path.join(d, 'report');
  T.materializeToolOutput(root);
  const lines = [];
  fs.mkdirSync(path.join(reportDir, 'tool'), { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'tool', 'migration-report.md'), T.TOOL_REPORT);
  const before = T.listFiles(root).map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);
  const code = RUN.main([root, '--verify-only', '--baseline', T.PROJECT, '--acknowledge', 'CommandLineProcess,/var/workflow/models/wfmin-legacy', '--report-dir', reportDir], l => lines.push(l));
  assert.strictEqual(code, 0, lines.join('\n'));
  assert.ok(lines.some(l => /Verification: PASS/.test(l)));
  const result = JSON.parse(fs.readFileSync(path.join(reportDir, 'asset-workflow-result.json'), 'utf8'));
  assert.ok(result.ok && result.verify.ok);
  assert.ok(result.tool.skipped);
  const md = fs.readFileSync(path.join(reportDir, 'asset-workflow-report.md'), 'utf8');
  assert.match(md, /\*\*PASS\*\*/);
  assert.match(md, /Re-create deleted runtime-only models[\s\S]*\/var\/workflow\/models\/wfmin-legacy/);
  assert.match(md, /-resize 25%/, 'issues from the tool report are carried into the checklist');
  assert.deepStrictEqual(T.listFiles(root).map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]), before, 'the project is not changed');
}));

test('run: a --report-dir that is or contains the project is refused before anything is deleted', () => withTmp('awr-', d => {
  const root = path.join(d, 'baseline');
  T.materializeToolOutput(root);
  const before = T.listFiles(root);
  const r = RUN.migrate(RUN.parseArgs([root, '--verify-only', '--report-dir', d]));
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(r.stage, 'preflight');
  assert.match(r.error, /--report-dir/);
  assert.strictEqual(RUN.migrate(RUN.parseArgs([root, '--verify-only', '--baseline', T.PROJECT, '--report-dir', root])).exitCode, 2);
  assert.deepStrictEqual(T.listFiles(root), before);
}));

test('run: an existing baseline folder the runner did not create is never deleted', () => withTmp('awr-', d => {
  const root = path.join(d, 'p'); const kept = path.join(d, 'report', 'baseline');
  T.materializeToolOutput(root);
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, 'keep.txt'), 'mine');
  const r = RUN.migrate(RUN.parseArgs([root, '--verify-only', '--report-dir', path.join(d, 'report')]));
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(r.stage, 'baseline');
  assert.match(r.error, /not created by/);
  assert.strictEqual(fs.readFileSync(path.join(kept, 'keep.txt'), 'utf8'), 'mine');
}));

test('run: --verify-only --dry-run reads HEAD into a temporary folder and leaves the report baseline alone', () => withTmp('awr-', d => {
  const root = path.join(d, 'p'); const reportDir = path.join(d, 'report'); const kept = path.join(reportDir, 'baseline');
  T.materializeProject(root);
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: root, encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr); };
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'init');
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, RUN.BASELINE_MARKER), ''); fs.writeFileSync(path.join(kept, 'sentinel.txt'), 'x');
  const r = RUN.migrate(RUN.parseArgs([root, '--verify-only', '--dry-run', '--report-dir', reportDir]));
  assert.strictEqual(r.exitCode, 0, r.error);
  assert.strictEqual(r.stage, 'dry-run');
  assert.strictEqual(r.plan.length, 3);
  assert.ok(fs.existsSync(path.join(kept, 'sentinel.txt')) && fs.existsSync(path.join(kept, RUN.BASELINE_MARKER)));
  assert.ok(r.baseline && !fs.existsSync(r.baseline), 'temporary baseline is removed');
}));

test('run: main prints usage and exits 2 on bad arguments', () => {
  const lines = [];
  assert.strictEqual(RUN.main(['--bogus'], l => lines.push(l)), 2);
  assert.match(lines.join('\n'), /unknown option/);
});

// ── Follow-ups, verification and report on the recorded tool output ───

const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const codes = fu => [...new Set(fu.manual.map(m => m.code))].sort();

function toolRun(fn, { prepare } = {}) {
  const base = tmp('awfu-base-'), d = tmp('awfu-');
  try {
    T.materializeProject(base); T.materializeToolOutput(d);
    if (prepare) prepare(base, d);
    return fn({ base, d, pre: I.buildInventory(base), post: I.buildInventory(d) });
  } finally { for (const x of [base, d]) fs.rmSync(x, { recursive: true, force: true }); }
}

test('parseToolIssues reads the Migration Issues table of the tool report', () => {
  const issues = K.parseToolIssues(T.TOOL_REPORT);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].action, 'Failed');
  assert.strictEqual(issues[0].model, 'update_asset');
  assert.match(issues[0].step, /convert -resize 25% \$\{filename\} cq5dam\.preview-25\.png/);
  assert.match(issues[0].reason, /geometry 25% is not supported/);
  assert.deepStrictEqual(K.parseToolIssues(''), []);
  assert.deepStrictEqual(K.parseToolIssues('## Migration Issues\nNo issues.\n'), []);
});

test('followUps: one entry per affected workflow, with what the tool kept, removed and profiled', () => toolRun(({ pre, post }) => {
  const fu = K.collectFollowUps({ pre, post, acknowledge: ACKS, toolReport: T.TOOL_REPORT });
  const wf = name => fu.workflows.find(w => w.confPath === `${MODELS}/${name}`);
  assert.deepStrictEqual(fu.workflows.map(w => w.confPath).sort(), ['dam/update_asset', 'wfmin-campaigns', 'wfmin-marketing'].map(n => `${MODELS}/${n}`));
  assert.ok(fu.workflows.every(w => w.migrated));
  assert.deepStrictEqual(wf('dam/update_asset').removed.map(s => C.shortName(s.process)), ['MetadataProcessorProcess', 'ThumbnailProcess', 'CommandLineProcess']);
  assert.deepStrictEqual(wf('dam/update_asset').kept.map(s => C.shortName(s.process)), ['WatermarkProcess']);
  assert.strictEqual(wf('dam/update_asset').profile, '/conf/global/settings/dam/processing/migrated_from_update_asset');
  assert.deepStrictEqual(wf('wfmin-campaigns').removed.map(s => [C.shortName(s.process), s.inSplit]), [['GateKeeperProcess', true]]);
  assert.strictEqual(wf('wfmin-campaigns').profile, null);
  assert.match(fu.runner.file, /aem-cloud-migration\.apps\/.*\/config\.author\/com\.adobe\.cq\.dam\.processor\.nui\.impl\.workflow\.CustomDamWorkflowRunnerImpl\.cfg\.json$/);
  assert.strictEqual(fu.runner.byExpression.length, 3);
}));

test('followUps: the post-deploy checklist covers what cannot be done in code', () => toolRun(({ pre, post }) => {
  const fu = K.collectFollowUps({ pre, post, acknowledge: ACKS, toolReport: T.TOOL_REPORT });
  assert.deepStrictEqual(codes(fu), [
    'launcher-condition-dropped', 'models-to-sync', 'needs-custom-worker', 'overlapping-workflows', 'participant-or-nontransient-step',
    'profiles-to-attach', 'steps-now-before-completed', 'unsupported-step-removed',
  ]);
  const one = code => fu.manual.find(m => m.code === code);
  assert.strictEqual(fu.manual.filter(m => m.code === 'models-to-sync').length, 3);
  assert.match(one('profiles-to-attach').detail, /migrated_from_update_asset to: \/content\/dam\/wfmin \(covers its sub-folders\)/);
  assert.deepStrictEqual(one('profiles-to-attach').folders.map(f => f.folder), ['/content/dam/wfmin']);
  assert.match(one('launcher-condition-dropped').detail, /jcr:mimeType!=video.*update_asset_create, update_asset_mod/);
  assert.match(one('steps-now-before-completed').detail, /WatermarkProcess/);
  assert.match(one('participant-or-nontransient-step').model, /wfmin-campaigns$/);
  assert.match(one('needs-custom-worker').detail, /-resize 25%.*geometry 25%/);
  assert.strictEqual(one('needs-custom-worker').model, `${MODELS}/dam/update_asset`);
  assert.ok(one('unsupported-step-removed').acknowledged);
  assert.ok(fu.manual.some(m => m.code === 'overlapping-workflows' && /wfmin\/marketing.*only one post-processing workflow runs per asset/.test(m.detail)));
}));

test('followUps: a removed unsupported step is acknowledged only by name, full class or "all"', () => toolRun(({ pre, post }) => {
  for (const [acks, expected] of [[[], false], [['CommandLineProcess'], true], [['com.day.cq.dam.core.process.CommandLineProcess'], true], [['all'], true]]) {
    const fu = K.collectFollowUps({ pre, post, acknowledge: acks });
    assert.strictEqual(fu.manual.find(m => m.code === 'unsupported-step-removed').acknowledged, expected, JSON.stringify(acks));
  }
}));

test('followUps: never writes to the project', () => toolRun(({ d, pre, post }) => {
  const before = T.listFiles(d).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]);
  K.collectFollowUps({ pre, post, acknowledge: ACKS, toolReport: T.TOOL_REPORT });
  assert.deepStrictEqual(T.listFiles(d).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]), before);
}));

// Workflows the tool does not migrate, and OR splits.

const PRINT = `${MODELS}/wfmin-print`;
const PRINT_MODEL = `${MODEL_DIR}/wfmin-print/.content.xml`;
const PRINT_LAUNCHER = `${LAUNCHER_DIR}/wfmin-print/.content.xml`;
const PRINT_PROFILE = 'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/migrated_from_wfmin-print/.content.xml';

const proc = (node, process, extra = '') => `<${node} jcr:primaryType="nt:unstructured" sling:resourceType="cq/workflow/components/model/process"><metaData jcr:primaryType="nt:unstructured" PROCESS="${process}" PROCESS_AUTO_ADVANCE="true"${extra}/></${node}>`;
const model = (flow, transient = true) => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="cq:PageContent" jcr:title="t" sling:resourceType="cq/workflow/components/pages/model" transient="${transient}">
        <flow jcr:primaryType="nt:unstructured" sling:resourceType="foundation/components/parsys">${flow}</flow>
    </jcr:content>
</jcr:root>
`;
const launcher = (name, enabled) => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:WorkflowLauncher" conditions="[]" enabled="{Boolean}${enabled}" eventType="{Long}1" glob="/content/dam/${name}(/.*/)renditions/original" nodetype="nt:file" runModes="author" workflow="/var/workflow/models/${name}"/>
`;
const profile = title => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="nt:unstructured" jcr:title="${title}" sling:resourceType="dam/processing/profile"/>
</jcr:root>
`;
const CLP = proc('commandlineprocess', 'com.day.cq.dam.core.process.CommandLineProcess', ' COMMANDS="[convert ${filename} -resize 2048x2048 cq5dam.print.2048.2048.jpeg]"');
const COMPLETED = proc('damupdateassetworkflowcompletedprocess', C.COMPLETED_PROCESS);

test('followUps: a workflow the tool does not migrate gets its profile attached, but no sync or wiring', () => toolRun(({ pre, post }) => {
  const fu = K.collectFollowUps({ pre, post, acknowledge: ACKS });
  const wf = fu.workflows.find(w => w.confPath === PRINT);
  assert.ok(wf && !wf.migrated && wf.renditionsOnly);
  assert.strictEqual(wf.profile, '/conf/global/settings/dam/processing/migrated_from_wfmin-print');
  const notes = fu.manual.filter(m => m.model === PRINT);
  assert.deepStrictEqual([...new Set(notes.map(m => m.code))].sort(), ['profiles-to-attach', 'unsupported-step-removed']);
  assert.match(notes.find(m => m.code === 'unsupported-step-removed').detail, /no longer runs/);
}, {
  prepare: (base, d) => {
    for (const [dir, enabled] of [[base, true], [d, false]]) { put(dir, PRINT_MODEL, model(CLP + COMPLETED)); put(dir, PRINT_LAUNCHER, launcher('wfmin-print', enabled)); }
    put(d, PRINT_PROFILE, profile('Migrated from wfmin-print'));
  },
}));

const ROUTE = `${MODELS}/wfmin-route`;
const ROUTE_MODEL = `${MODEL_DIR}/wfmin-route/.content.xml`;
const orSplit = branches => `<or jcr:primaryType="nt:unstructured" sling:resourceType="cq/workflow/components/model/or" script1="/apps/x/a.ecma" script2="/apps/x/b.ecma">${branches.map((b, i) => `<branch_${i + 1} jcr:primaryType="nt:unstructured">${b}</branch_${i + 1}>`).join('')}</or>`;
const STEP_A = proc('a', 'com.example.StepA');
const STEP_B = proc('b', 'com.example.StepB');
const GATE = proc('gatekeeper', 'com.day.cq.dam.core.process.GateKeeperProcess');
const NOOP = proc('noop', C.NOOP_SCRIPT);

test('followUps: an OR split that lost steps but still routes work is flagged for review', () => toolRun(({ pre, post }) => {
  const fu = K.collectFollowUps({ pre, post, acknowledge: ACKS });
  const notes = fu.manual.filter(m => m.model === ROUTE && m.code === 'or-routing-script-review');
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0].detail, /flow\/or/);
}, {
  prepare: (base, d) => {
    put(base, ROUTE_MODEL, model(orSplit([STEP_A + GATE, STEP_B]) + COMPLETED));
    put(base, `${LAUNCHER_DIR}/wfmin-route/.content.xml`, launcher('wfmin-route', true));
    put(d, ROUTE_MODEL, model(orSplit([STEP_A, STEP_B]) + COMPLETED));
    put(d, `${LAUNCHER_DIR}/wfmin-route/.content.xml`, launcher('wfmin-route', false));
  },
}));

test('followUps: an OR split whose branches only lost no-op steps needs no review', () => toolRun(({ pre, post }) => {
  const fu = K.collectFollowUps({ pre, post, acknowledge: ACKS });
  assert.ok(!fu.manual.some(m => m.model === ROUTE && m.code === 'or-routing-script-review'));
}, {
  prepare: (base, d) => {
    put(base, ROUTE_MODEL, model(orSplit([STEP_A, STEP_B + NOOP]) + COMPLETED));
    put(base, `${LAUNCHER_DIR}/wfmin-route/.content.xml`, launcher('wfmin-route', true));
    put(d, ROUTE_MODEL, model(orSplit([STEP_A, STEP_B + NOOP]) + COMPLETED));
    put(d, `${LAUNCHER_DIR}/wfmin-route/.content.xml`, launcher('wfmin-route', false));
  },
}));

test('literalPrefix and foldersFor: launcher globs become folders to attach profiles to', () => {
  assert.deepStrictEqual(K.literalPrefix('/content/dam/wfmin(/.*/)renditions/original'), { folder: '/content/dam/wfmin', exact: false });
  assert.deepStrictEqual(K.literalPrefix('/content/dam/a/b'), { folder: '/content/dam/a/b', exact: true });
  assert.deepStrictEqual(K.literalPrefix('/content/dam/ab.*/x'), { folder: '/content/dam', exact: false });
  const f = K.foldersFor([{ glob: '/content/dam/wfmin(/.*/)renditions/original' }, { glob: '/content/dam/(?!skip)(/.*/)renditions/original' }, { glob: '/content/dam/(a|b)/.*/renditions/original' }]);
  assert.deepStrictEqual(f.map(x => [x.folder, x.subtree, x.wholeDam, x.excludes]), [
    ['/content/dam/wfmin', true, false, []], ['/content/dam', true, true, ['skip']], ['/content/dam', false, false, []],
  ]);
});

test('runner overlap: sample paths and overlaps', () => {
  const e = (type, match, model) => ({ type, match, model, raw: `${match}:${model}` });
  assert.strictEqual(I.sampleAssetPath(e('expression', '/content/dam(/.*/)(marketing/seasonal)(/.*)')), '/content/dam/sample/marketing/seasonal/sample');
  assert.strictEqual(I.sampleAssetPath(e('expression', '/content/dam/(a|b)/.*')), '/content/dam/a/sample');
  assert.strictEqual(I.sampleAssetPath(e('path', '/content/dam/a/')), '/content/dam/a/sample');
  const all = e('expression', '/content/dam(/.*)', '/var/m/all');
  const a = e('expression', '/content/dam/a(/.*)', '/var/m/a');
  const other = e('expression', '/content/dam/other-(x|y)/.*', '/var/m/other');
  assert.deepStrictEqual(I.runnerOverlaps([all, a, other]).map(o => [o.narrow.model, o.broad.model, o.mutual]), [['/var/m/a', '/var/m/all', false], ['/var/m/other', '/var/m/all', false]]);
  assert.deepStrictEqual(I.runnerOverlaps([a, e('expression', '/content/dam/a(/.*)', '/var/m/a')]), []);
  assert.strictEqual(I.runnerOverlaps([a, e('path', '/content/dam/a', '/var/m/b')])[0].mutual, true);
});

test('verify: the tool output passes once removed steps and the runtime-only model are acknowledged', () => toolRun(({ pre, post }) => {
  const fu = K.collectFollowUps({ pre, post, acknowledge: [...ACKS, ORPHAN] });
  const v = K.verifyMigration(pre, post, { followUps: fu, acknowledge: [...ACKS, ORPHAN] });
  assert.ok(v.ok, JSON.stringify(v.failures));
  assert.strictEqual(v.warnings.filter(w => w.category === 'overlapping-workflows').length, 2);
}));

test('report: summary, tool issues, checklist and acknowledged runtime-only models', () => toolRun(({ pre, post }) => {
  const acks = [...ACKS, ORPHAN];
  const fu = K.collectFollowUps({ pre, post, acknowledge: acks, toolReport: T.TOOL_REPORT });
  const verify = K.verifyMigration(pre, post, { followUps: fu, acknowledge: acks });
  const gate = RUN.gateUnsupported(pre, acks);
  const md = K.renderReport({ pre, post, followUps: fu, verify, tool: { version: RUN.TOOL_VERSION, ok: true }, gate });
  assert.match(md, /\| Verification \| \*\*PASS\*\* \|/);
  assert.match(md, new RegExp(`wf-migrator ${RUN.TOOL_VERSION.replace(/\./g, '\\.')} — completed`));
  assert.match(md, /\| Post-processing workflows \| 3 \|/);
  assert.doesNotMatch(md, /Changes made by this skill/, 'the skill does not change the project');
  for (const [code, title] of K.CHECKLIST) if (fu.manual.some(m => m.code === code)) assert.ok(md.includes(`**${title}**`), code);
  assert.match(md, /\*\*Re-create deleted runtime-only models\*\*[^\n]*\n {2}- `\/var\/workflow\/models\/wfmin-legacy` _\(acknowledged\)_/);
  assert.match(md, /CommandLineProcess \(commandlineprocess\) removed\.[^\n]*_\(acknowledged\)_/);
  assert.doesNotMatch(md, /warning `overlapping-workflows`/, 'checklist items are not repeated as warnings');
  const failed = K.renderReport({ pre, post, followUps: fu, verify: { ok: false, failures: [{ category: 'x', detail: 'y' }], warnings: [] }, tool: { skipped: true } });
  assert.match(failed, /\*\*FAIL\*\* \(1\)/);
  assert.match(failed, /not run \(verify-only\)/);
  assert.match(failed, /- `x`: y/);
}));

// ── Custom Java step review ───────────────────────────────────────────

const byStep = (review, short) => review.steps.find(s => s.shortName === short);
const kinds = c => [...new Set(c.signals.map(s => s.kind))].sort();
const javaClass = body => `package x;\npublic class A {\n${body}\n}\n`;

function treeHash(dir) {
  const h = crypto.createHash('sha256');
  for (const f of T.listFiles(dir).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex');
}

test('custom steps: rendition writes and image work → processing profile or custom worker', () => {
  for (const body of ['asset.addRendition("x", in, "image/png");', 'RenditionMaker maker;', 'Layer l = new Layer(in);', 'import com.day.cq.gfx.Gfx;', 'AssetHandler h;']) {
    assert.strictEqual(S.classifySource(javaClass(body)).outcome, 'processing-profile-or-worker', body);
  }
});

test('custom steps: shelling out → custom worker', () => {
  for (const body of ['Runtime.getRuntime().exec("convert");', 'new ProcessBuilder("convert").start();', 'import com.day.cq.dam.core.process.CommandLineProcess;', 'import org.apache.commons.exec.CommandLine;']) {
    assert.strictEqual(S.classifySource(javaClass(body)).outcome, 'custom-worker', body);
  }
});

test('custom steps: original binary or local filesystem → manual review', () => {
  for (const body of ['InputStream in = asset.getOriginal().getStream();', 'Rendition o = asset.getOriginal();\nInputStream in = o.getStream();', 'File t = File.createTempFile("a", "b");', 'import java.io.FileOutputStream;', 'Path p = Files.createTempDirectory("x");']) {
    assert.strictEqual(S.classifySource(javaClass(body)).outcome, 'manual-review', body);
  }
});

test('custom steps: APIs a Branch B pattern covers → hand off to that pattern', () => {
  const am = S.classifySource(`import com.day.cq.dam.api.AssetManager;\n${javaClass('AssetManager m;')}`);
  assert.strictEqual(am.outcome, 'pattern-handoff');
  assert.deepStrictEqual(am.handoffs.map(h => [h.id, h.pattern]), [['asset-manager', 'assetApi']]);
  const rep = S.classifySource(`import com.day.cq.replication.Replicator;\nimport org.apache.felix.scr.annotations.Component;\n${javaClass('Replicator r;')}`);
  assert.deepStrictEqual(rep.handoffs.map(h => h.id), ['replication', 'scr-to-osgi-ds']);
  assert.strictEqual(S.classifySource(`import com.adobe.granite.asset.api.AssetManager;\n${javaClass('AssetManager m;')}`).outcome, 'keep-post-processing', 'the Granite AssetManager is the supported API');
});

test('custom steps: nothing found → keep as a post-processing step; comments are ignored', () => {
  const r = S.classifySource(javaClass('/* Runtime.getRuntime().exec("x") */\n// asset.addRendition(x)\nString s = "a";'));
  assert.strictEqual(r.outcome, 'keep-post-processing');
  assert.deepStrictEqual(r.signals, []);
});

test('custom steps: the strongest outcome wins; every signal and hand-off is still listed with its line', () => {
  const r = S.classifySource(`import com.day.cq.replication.Replicator;\n${javaClass('void a() { new ProcessBuilder("x"); asset.addRendition("r", in, "t"); }')}`);
  assert.strictEqual(r.outcome, 'processing-profile-or-worker');
  assert.deepStrictEqual(kinds(r), ['renditions', 'shell']);
  assert.deepStrictEqual(r.handoffs.map(h => h.id), ['replication']);
  assert.ok(r.signals.every(s => Number.isInteger(s.line) && s.line > 1), JSON.stringify(r.signals));
});

test('custom steps: resolves PROCESS by class name, nested classes to the outer file', () => withTmp('awcs-', d => {
  T.writeJavaSources(d);
  const files = S.findJavaSources(d);
  const r = S.resolveStepClass(`${PKG}.WatermarkProcess`, files, d);
  assert.deepStrictEqual([r.resolved, r.by, r.file], [true, 'class', 'core/src/main/java/com/example/wfmin/core/workflow/WatermarkProcess.java']);
  assert.strictEqual(S.resolveStepClass(`${PKG}.WatermarkProcess$Inner`, files, d).file, r.file);
}));

test('custom steps: falls back to the process.label property (DS and SCR annotations)', () => withTmp('awcs-', d => {
  T.writeJavaSources(d);
  const files = S.findJavaSources(d);
  const ds = S.resolveStepClass('Tag by folder', files, d);
  assert.deepStrictEqual([ds.resolved, ds.by, path.basename(ds.file)], [true, 'process.label', 'TagByFolderProcess.java']);
  assert.strictEqual(path.basename(S.resolveStepClass('Auto publish', files, d).file), 'AutoPublishProcess.java');
}));

test('custom steps: missing or ambiguous classes are unresolved, never guessed', () => withTmp('awcs-', d => {
  T.writeJavaSources(d);
  const dup = 'other/src/main/java/com/example/wfmin/core/workflow/WatermarkProcess.java';
  T.writeJavaSources(d, { [dup]: T.JAVA_FILES['core/src/main/java/com/example/wfmin/core/workflow/WatermarkProcess.java'] });
  const files = S.findJavaSources(d);
  const amb = S.resolveStepClass(`${PKG}.WatermarkProcess`, files, d);
  assert.strictEqual(amb.resolved, false);
  assert.strictEqual(amb.candidates.length, 2);
  assert.match(amb.reason, /ambiguous/);
  const label = S.resolveStepClass('Watermark renditions', files, d);
  assert.strictEqual(label.resolved, false, 'two classes carry the label');
  const none = S.resolveStepClass('com.acme.NotHere', files, d);
  assert.deepStrictEqual([none.resolved, none.candidates], [false, []]);
  assert.match(none.reason, /not found/);
}));

test('custom steps: only src/main/java is searched; target and node_modules are skipped', () => withTmp('awcs-', d => {
  T.writeJavaSources(d, {
    'core/target/generated/src/main/java/a/B.java': 'package a; class B {}',
    'core/src/test/java/a/C.java': 'package a; class C {}',
    'node_modules/x/src/main/java/a/D.java': 'package a; class D {}',
    'core/src/main/java/a/E.java': 'package a; class E {}',
  });
  assert.deepStrictEqual(S.findJavaSources(d).map(f => path.relative(d, f).split(path.sep).join('/')), ['core/src/main/java/a/E.java']);
}));

test('custom steps: reviews every kept custom step of the affected workflows, read-only', () => withTmp('awcs-', d => {
  T.materializeProject(d); T.writeJavaSources(d);
  const before = treeHash(d);
  const review = S.reviewCustomSteps(I.buildInventory(d), d);
  assert.strictEqual(treeHash(d), before, 'the review must not change the project');
  assert.deepStrictEqual(review.steps.map(s => s.shortName).sort(), ['AutoPublishProcess', 'TagByFolderProcess', 'WatermarkProcess']);

  const wm = byStep(review, 'WatermarkProcess');
  assert.strictEqual(wm.outcome, 'processing-profile-or-worker');
  assert.deepStrictEqual(kinds(wm), ['binary', 'renditions']);
  assert.deepStrictEqual(wm.usedIn.map(u => u.model), ['/conf/global/settings/workflow/models/dam/update_asset']);

  const tag = byStep(review, 'TagByFolderProcess');
  assert.strictEqual(tag.outcome, 'keep-post-processing');
  assert.ok(tag.usedIn[0].inSplit, 'the step sits inside an OR split');
  assert.deepStrictEqual(tag.helpers, ['core/src/main/java/com/example/wfmin/core/util/FolderTags.java']);

  const pub = byStep(review, 'AutoPublishProcess');
  assert.strictEqual(pub.outcome, 'pattern-handoff');
  assert.deepStrictEqual(pub.handoffs.map(h => h.id), ['replication', 'scr-to-osgi-ds']);
  assert.ok(review.scope && /helpers/.test(review.scope));
  assert.deepStrictEqual(review.counts, { 'processing-profile-or-worker': 1, 'keep-post-processing': 1, 'pattern-handoff': 1 });
}));

test('custom steps: without the sources every custom step is unresolved', () => {
  const review = S.reviewCustomSteps(I.buildInventory(T.PROJECT), T.PROJECT);
  assert.strictEqual(review.steps.length, 3);
  for (const s of review.steps) assert.deepStrictEqual([s.outcome, s.source, s.signals], ['unresolved', null, []], s.shortName);
});

test('custom steps: the dry run, the result JSON and the report carry the review', () => withTmp('awcs-', d => {
  const root = path.join(d, 'project');
  T.materializeProject(root); T.writeJavaSources(root);
  const dry = RUN.migrate(RUN.parseArgs([root, '--dry-run', '--report-dir', path.join(d, 'dry')]));
  assert.strictEqual(byStep(dry.customSteps, 'WatermarkProcess').outcome, 'processing-profile-or-worker');
  const lines = [];
  RUN.main([root, '--dry-run', '--report-dir', path.join(d, 'dry')], l => lines.push(l));
  assert.match(lines.join('\n'), /Custom Java steps: 3[\s\S]*WatermarkProcess → processing-profile-or-worker/);

  const after = path.join(d, 'after');
  T.copyDir(root, after); T.materializeToolOutput(after);
  const reportDir = path.join(d, 'report');
  RUN.migrate(RUN.parseArgs([after, '--verify-only', '--baseline', root, '--acknowledge', 'CommandLineProcess,/var/workflow/models/wfmin-legacy', '--report-dir', reportDir]));
  const json = JSON.parse(fs.readFileSync(path.join(reportDir, 'asset-workflow-result.json'), 'utf8'));
  assert.strictEqual(byStep(json.customSteps, 'AutoPublishProcess').outcome, 'pattern-handoff');
  const md = fs.readFileSync(path.join(reportDir, 'asset-workflow-report.md'), 'utf8');
  assert.match(md, /## Custom Java steps/);
  assert.match(md, /\| `AutoPublishProcess` \|.*pattern-handoff/);
  assert.match(md, /replication/);
  assert.match(md, /Custom Java steps reviewed \| 3 \(2 need action\)/);
}));

test('custom steps: the report section is left out when there are no custom steps', () => {
  const md = K.renderReport({ pre: null, post: null, followUps: null, verify: { ok: true, failures: [], warnings: [] }, tool: { skipped: true }, customSteps: { steps: [] } });
  assert.doesNotMatch(md, /## Custom Java steps/);
});
