'use strict';
// Branch F (asset workflow migration): catalog, XML, inventory, verification and runner helpers.
// No Java needed — the tool's output is recorded in fixtures/asset-workflow.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./asset-workflow-catalog.js');
const X = require('./asset-workflow-xml.js');
const I = require('./asset-workflow-inventory.js');
const F = require('./asset-workflow-fix.js');
const V = require('./asset-workflow-verify.js');
const RUN = require('./asset-workflow-run.js');
const T = require('./fixtures/asset-workflow.js');

const MODELS = '/conf/global/settings/workflow/models';
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const withTmp = (prefix, fn) => { const d = tmp(prefix); try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); } };
const categories = r => [...new Set(r.failures.map(f => f.category))].sort();

// ── Catalog ───────────────────────────────────────────────────────────

test('catalog: classifies steps like workflowSteps.properties, plus custom, script and noop', () => {
  assert.strictEqual(C.classifyStep('com.day.cq.dam.core.process.CommandLineProcess'), 'UNSUPPORTED');
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
  assert.ok(C.triggersMigration('CUSTOM') && !C.triggersMigration('REQUIRED') && !C.triggersMigration('NOOP'));
  assert.strictEqual(C.shortName('com.day.cq.dam.core.process.CommandLineProcess'), 'CommandLineProcess');
  assert.strictEqual(C.shortName('/apps/x/step.ecma'), '/apps/x/step.ecma');
});

// ── XML ───────────────────────────────────────────────────────────────

test('xml: multi-value round trip keeps commas inside values escaped', () => {
  assert.deepStrictEqual(X.parseMultiValue('[a,b\\,c]'), ['a', 'b,c']);
  assert.deepStrictEqual(X.parseMultiValue('[]'), []);
  assert.deepStrictEqual(X.parseMultiValue(X.formatMultiValue(['a', 'b,c'])), ['a', 'b,c']);
});

test('xml: inserting a template child indents every line to the sibling level', () => {
  const text = '<a>\n    <flow>\n        <x/>\n    </flow>\n</a>\n';
  const doc = X.parseXml(text);
  const flow = X.child(X.rootElement(doc), 'flow');
  const out = X.applyEdits(text, [X.insertChildEdit(text, flow, '<y\n    k="v">\n    <m/>\n</y>')]);
  assert.strictEqual(out, '<a>\n    <flow>\n        <x/>\n        <y\n            k="v">\n            <m/>\n        </y>\n    </flow>\n</a>\n');
});

test('xml: a formatting-only rewrite is restored to the original text', () => {
  const a = '<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"\n    jcr:primaryType="nt:unstructured"\n    b="2"/>\n';
  const b = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" b="2" jcr:primaryType="nt:unstructured"/>';
  const r = X.minimizeDiff(a, b);
  assert.ok(r.minimized && r.identical);
  assert.strictEqual(r.text, a);
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

test('inventory: predicts which workflows the tool migrates (top-level real work only)', () => {
  const inv = I.buildInventory(T.PROJECT);
  const wf = name => inv.workflows.find(w => w.model && w.model.confPath === `${MODELS}/${name}`);
  assert.strictEqual(inv.workflows.length, 3);
  assert.strictEqual(wf('dam/update_asset').launchers.length, 2);
  assert.ok(wf('dam/update_asset').toolWillMigrate);
  assert.ok(wf('wfmin-marketing').toolWillMigrate);
  // Only an AND split holds the custom step: the tool skips it, but it still has real work.
  assert.ok(!wf('wfmin-campaigns').toolWillMigrate);
  assert.ok(wf('wfmin-campaigns').summary.hasRealWork);
  const s = wf('dam/update_asset').summary;
  assert.ok(s.completed.present && !s.completed.last);
  assert.deepStrictEqual(s.unsupported.map(u => C.shortName(u.process)), ['CommandLineProcess']);
  assert.ok(!wf('wfmin-campaigns').model.transient);
});

test('inventory: launcher globs become runner entries like WorkflowRunnerConfigCreator', () => {
  assert.deepStrictEqual(I.globToRunnerEntry('/content/dam/wfmin(/.*/)renditions/original'), { type: 'expression', pattern: '/content/dam/wfmin(/.*)' });
  assert.deepStrictEqual(I.globToRunnerEntry('/content/dam/(a|b)/.*/renditions/original'), { type: 'expression', pattern: '/content/dam/(a|b)/.*' });
  assert.deepStrictEqual(I.globToRunnerEntry('/content/dam/plain'), { type: 'path', pattern: '/content/dam/plain' });
  assert.deepStrictEqual(I.globToRunnerEntry('/content/dam/x/jcr:content/metadata'), { type: 'path', pattern: '/content/dam/x' });
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
  assert.ok(r.findings.every(f => /Branch F/.test(f.detail)));
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
  const v = V.verifyMigration(pre, I.buildInventory(d), { acknowledge: ['CommandLineProcess', '/var/workflow/models/wfmin-legacy'] });
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

test('verify: the raw tool output fails on every problem the fixture reproduces', () => withTmp('awv-', d => {
  T.materializeToolOutput(d);
  const v = V.verifyMigration(I.buildInventory(T.PROJECT), I.buildInventory(d), {});
  assert.ok(!v.ok);
  assert.deepStrictEqual(categories(v), [
    'completed-step-not-last', 'custom-workflow-not-wired', 'filter-root-not-absolute', 'missing-completed-step',
    'runner-config-duplicate-pid', 'runtime-model-without-design-time', 'split-contains-unsupported-step', 'unsupported-step-removed',
  ]);
}));

test('verify: the fixed output passes, and the orphan runtime model is a failure until acknowledged', () => withTmp('awv-', d => {
  T.materializeToolOutput(d);
  const fix = F.applyFixes(d, T.PROJECT, { acknowledge: ['CommandLineProcess'], renameOotbModels: true });
  const pre = I.buildInventory(T.PROJECT); const post = I.buildInventory(d);
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['CommandLineProcess'] });
  assert.deepStrictEqual(categories(v), ['runtime-model-without-design-time']);
  const ok = V.verifyMigration(pre, post, { fix, acknowledge: ['CommandLineProcess', '/var/workflow/models/wfmin-legacy'] });
  assert.ok(ok.ok, JSON.stringify(ok.failures));
  assert.ok(ok.warnings.some(w => w.category === 'runner-model-not-in-project'));
  assert.ok(ok.warnings.some(w => w.category === 'model-not-transient'));
}));

test('verify: an unacknowledged custom ImageMagick command fails the gate', () => withTmp('awv-', d => {
  T.materializeToolOutput(d);
  const fix = F.applyFixes(d, T.PROJECT, {});
  const v = V.verifyMigration(I.buildInventory(T.PROJECT), I.buildInventory(d), { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.deepStrictEqual(categories(v), ['unsupported-step-removed']);
}));

// ── Runner helpers ────────────────────────────────────────────────────

test('run: parseArgs reads flags and comma-separated acknowledgements', () => {
  const o = RUN.parseArgs(['proj', '--dry-run', '--acknowledge', 'CommandLineProcess, /var/workflow/models/x', '--acknowledge', 'all', '--rename-ootb-models', '--emit-repoinit', '--report-dir', 'r', '--jar', 'j.jar', '--allow-dirty', '--json']);
  assert.strictEqual(o.root, 'proj');
  assert.deepStrictEqual(o.acknowledge, ['CommandLineProcess', '/var/workflow/models/x', 'all']);
  assert.ok(o.dryRun && o.renameOotbModels && o.emitRepoinit && o.allowDirty && o.json);
  assert.strictEqual(o.reportDir, 'r');
  assert.strictEqual(o.jar, 'j.jar');
  assert.throws(() => RUN.parseArgs([]), /usage/);
  assert.throws(() => RUN.parseArgs(['p', '--nope']), /unknown option/);
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
  assert.strictEqual(RUN.TOOL_VERSION, '0.6.0');
  assert.strictEqual(RUN.TOOL_URL, 'https://github.com/adobe/aem-cloud-migration/releases/download/v0.6.0/wf-migrator-0.6.0.jar');
  assert.match(RUN.TOOL_SHA256, /^[0-9a-f]{64}$/);
});

test('run: checkProject needs a multi-module project with a content package', () => withTmp('awp-', d => {
  const ok = RUN.checkProject(T.PROJECT);
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.contentModules.sort(), ['all', 'ui.apps', 'ui.content']);
  assert.match(RUN.checkProject(d).error, /no pom.xml/);
  fs.writeFileSync(path.join(d, 'pom.xml'), '<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version></project>');
  assert.match(RUN.checkProject(d).error, /no <modules>/);
}));

test('run: the gate stops on custom commands and runtime-only models until acknowledged', () => {
  const pre = I.buildInventory(T.PROJECT);
  const g = RUN.gateUnsupported(pre, []);
  assert.ok(!g.ok);
  assert.deepStrictEqual(g.pending.map(s => C.shortName(s.process)), ['CommandLineProcess']);
  assert.ok(g.pending[0].custom.some(c => /25%/.test(c)));
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
  assert.deepStrictEqual(p('dam/update_asset').remove.map(s => s.category), ['NUI_OOTB', 'NUI_MIGRATED', 'UNSUPPORTED']);
  assert.ok(!p('wfmin-campaigns').toolWillMigrate);
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

test('run: --fix-only with --baseline runs fixers, verification and the report without Java', () => withTmp('awr-', d => {
  const root = path.join(d, 'p'); const reportDir = path.join(d, 'report');
  T.materializeToolOutput(root);
  const lines = [];
  const code = RUN.main([root, '--fix-only', '--baseline', T.PROJECT, '--acknowledge', 'CommandLineProcess,/var/workflow/models/wfmin-legacy', '--rename-ootb-models', '--report-dir', reportDir], l => lines.push(l));
  assert.strictEqual(code, 0, lines.join('\n'));
  assert.ok(lines.some(l => /Verification: PASS/.test(l)));
  const result = JSON.parse(fs.readFileSync(path.join(reportDir, 'asset-workflow-result.json'), 'utf8'));
  assert.ok(result.ok && result.verify.ok);
  assert.ok(result.tool.skipped);
  const md = fs.readFileSync(path.join(reportDir, 'asset-workflow-report.md'), 'utf8');
  assert.match(md, /\*\*PASS\*\*/);
  assert.match(md, /Re-create deleted runtime-only models[\s\S]*\/var\/workflow\/models\/wfmin-legacy/);
  // Second pass over the fixed project is a no-op.
  const again = RUN.migrate(RUN.parseArgs([root, '--fix-only', '--baseline', T.PROJECT, '--acknowledge', 'all', '--rename-ootb-models', '--report-dir', reportDir]));
  assert.strictEqual(again.exitCode, 0);
  assert.deepStrictEqual(again.fix.changedFiles, []);
}));

test('run: a --report-dir that is or contains the project is refused before anything is deleted', () => withTmp('awr-', d => {
  const root = path.join(d, 'baseline');
  T.materializeToolOutput(root);
  const before = T.listFiles(root);
  const r = RUN.migrate(RUN.parseArgs([root, '--fix-only', '--report-dir', d]));
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(r.stage, 'preflight');
  assert.match(r.error, /--report-dir/);
  assert.strictEqual(RUN.migrate(RUN.parseArgs([root, '--fix-only', '--baseline', T.PROJECT, '--report-dir', root])).exitCode, 2);
  assert.deepStrictEqual(T.listFiles(root), before);
}));

test('run: an existing baseline folder the runner did not create is never deleted', () => withTmp('awr-', d => {
  const root = path.join(d, 'p'); const kept = path.join(d, 'report', 'baseline');
  T.materializeToolOutput(root);
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, 'keep.txt'), 'mine');
  const r = RUN.migrate(RUN.parseArgs([root, '--fix-only', '--report-dir', path.join(d, 'report')]));
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(r.stage, 'baseline');
  assert.match(r.error, /not created by/);
  assert.strictEqual(fs.readFileSync(path.join(kept, 'keep.txt'), 'utf8'), 'mine');
}));

test('run: --fix-only --dry-run reads HEAD into a temporary folder and leaves the report baseline alone', () => withTmp('awr-', d => {
  const root = path.join(d, 'p'); const reportDir = path.join(d, 'report'); const kept = path.join(reportDir, 'baseline');
  T.materializeProject(root);
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: root, encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr); };
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'init');
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, RUN.BASELINE_MARKER), ''); fs.writeFileSync(path.join(kept, 'sentinel.txt'), 'x');
  const r = RUN.migrate(RUN.parseArgs([root, '--fix-only', '--dry-run', '--report-dir', reportDir]));
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
