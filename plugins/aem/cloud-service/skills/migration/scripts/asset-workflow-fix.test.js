'use strict';
// Branch F fixers on the recorded wf-migrator 0.6.0 output for the fixture project
// (fixtures/asset-workflow.js), plus the report. No Java needed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');
const F = require('./asset-workflow-fix.js');
const V = require('./asset-workflow-verify.js');
const R = require('./asset-workflow-report.js');
const RUN = require('./asset-workflow-run.js');
const T = require('./fixtures/asset-workflow.js');
const X = require('./asset-workflow-xml.js');

const MODELS = '/conf/global/settings/workflow/models';
const CONTENT = 'ui.content/src/main/content';
const MODEL_DIR = `${CONTENT}/jcr_root/conf/global/settings/workflow/models`;
const LAUNCHER_DIR = `${CONTENT}/jcr_root/conf/global/settings/workflow/launcher/config`;
const RUNNER_CFG = 'ui.apps/src/main/content/jcr_root/apps/wfmin/osgiconfig/config.author/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.cfg.json';
const LEGACY_RUNNER_XML = RUNNER_CFG.replace('.cfg.json', '.xml');
const TOOL_RUNNER_XML = 'aem-cloud-migration.apps/src/main/content/jcr_root/apps/aem-cloud-migration/config/com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl.xml';
const PROFILE_DIR = 'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/migrated_from_update_asset';
const REPOINIT = 'aem-cloud-migration.apps/src/main/content/jcr_root/apps/aem-cloud-migration/config.author/org.apache.sling.jcr.repoinit.RepositoryInitializer~asset-processing-profiles.cfg.json';
const ACKS = ['CommandLineProcess'];

const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const has = (d, f) => fs.existsSync(path.join(d, f));
const lineDiff = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return { removed: x.filter(l => !y.includes(l)), added: y.filter(l => !x.includes(l)) }; };
const steps = (inv, conf) => inv.models.find(m => m.confPath === conf).steps.map(s => [C.shortName(s.process), !!s.inSplit]);

function fixed(opts, fn) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'awfix-'));
  try {
    T.materializeToolOutput(d);
    const fix = F.applyFixes(d, T.PROJECT, Object.assign({ acknowledge: ACKS, renameOotbModels: true }, opts));
    return fn(d, fix);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

// ── Fixers ────────────────────────────────────────────────────────────

test('fix: DAM Update Asset Workflow Completed is the last step of every post-processing model', () => fixed({}, (d, fix) => {
  const post = I.buildInventory(d);
  for (const m of post.models) assert.ok(I.summarizeModel(m).completed.last, m.confPath);
  assert.deepStrictEqual(steps(post, `${MODELS}/update_asset-postprocessing`), [['WatermarkProcess', false], ['DamUpdateAssetWorkflowCompletedProcess', false]]);
  const before = fix.manual.find(m => m.code === 'steps-now-before-completed');
  assert.match(before.detail, /WatermarkProcess/);
  // The added step is indented like its siblings.
  assert.match(read(d, `${MODEL_DIR}/wfmin-campaigns/.content.xml`), /\n {12}<damupdateassetworkflowcompletedprocess\n {16}jcr:primaryType/);
}));

test('fix: unsupported steps are removed from splits, emptied splits go, and split-only workflows get wired', () => fixed({}, (d, fix) => {
  const post = I.buildInventory(d);
  assert.deepStrictEqual(steps(post, `${MODELS}/wfmin-campaigns`), [['TagByFolderProcess', false], ['DamUpdateAssetWorkflowCompletedProcess', false]]);
  assert.deepStrictEqual(steps(post, `${MODELS}/wfmin-marketing`), [['AutoPublishProcess', false], ['DamUpdateAssetWorkflowCompletedProcess', false]]);
  assert.ok(fix.runner.byExpression.includes('/content/dam/(wfmin-campaigns|wfmin-events)/.*:/var/workflow/models/wfmin-campaigns'));
  assert.ok(fix.actions.some(a => a.change === 'non-runnable-steps' && /wired .*wfmin-campaigns/.test(a.detail)));
}));

test('fix: simple ImageMagick commands become processing-profile renditions; the rest need a custom worker', () => fixed({}, (d, fix) => {
  const xml = read(d, `${PROFILE_DIR}/cq5dam_print_1200_1200_jpeg/.content.xml`);
  for (const a of ['fmt="jpeg"', 'name="cq5dam.print.1200.1200.jpeg"', 'wid="1200"', 'hei="1200"', 'includeMimeTypes="image/tiff,image/png"', 'sling:resourceType="dam/processing/profile/rendition"']) assert.ok(xml.includes(a), a);
  const worker = fix.manual.filter(m => m.code === 'needs-custom-worker');
  assert.strictEqual(worker.length, 1);
  assert.match(worker[0].detail, /-resize 25%/);
  const removed = fix.manual.find(m => m.code === 'unsupported-step-removed');
  assert.strictEqual(removed.process, 'com.day.cq.dam.core.process.CommandLineProcess');
  assert.ok(removed.acknowledged && !removed.fullyMapped);
}));

test('fix: one author .cfg.json replaces the legacy and tool runner configs', () => fixed({}, (d, fix) => {
  assert.ok(!has(d, LEGACY_RUNNER_XML) && !has(d, TOOL_RUNNER_XML));
  assert.deepStrictEqual(JSON.parse(read(d, RUNNER_CFG)), {
    postProcWorkflowsByPath: ['/content/dam/wfmin/brand:/var/workflow/models/wfmin-brand'],
    postProcWorkflowsByExpression: [
      '/content/dam/wfmin/marketing(/.*):/var/workflow/models/wfmin-marketing',
      '/content/dam/wfmin(/.*):/var/workflow/models/update_asset-postprocessing',
      '/content/dam/(wfmin-campaigns|wfmin-events)/.*:/var/workflow/models/wfmin-campaigns',
    ],
  });
  assert.strictEqual(fix.runner.file, RUNNER_CFG);
  const cfgs = I.buildInventory(d).runnerConfigs;
  assert.deepStrictEqual(cfgs.map(c => [c.format, c.runMode]), [['cfg.json', 'author']]);
}));

test('fix: an unparseable runner config stops the merge so no entries are lost', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'awfix-'));
  try {
    T.materializeToolOutput(d);
    const broken = RUNNER_CFG.replace('.cfg.json', '.config');
    fs.rmSync(path.join(d, LEGACY_RUNNER_XML), { force: true });
    fs.writeFileSync(path.join(d, broken), 'postProcWorkflowsByPath=["/content/dam/wfmin/brand:/var/workflow/models/wfmin-brand"\n');
    const fix = F.applyFixes(d, T.PROJECT, { acknowledge: ACKS, renameOotbModels: true });
    assert.ok(fix.manual.some(m => m.code === 'runner-config-unparseable' && m.detail.includes(path.basename(broken))));
    assert.ok(has(d, broken) && has(d, TOOL_RUNNER_XML) && !has(d, RUNNER_CFG));
    const v = V.verifyMigration(I.buildInventory(T.PROJECT), I.buildInventory(d), { fix, acknowledge: [...ACKS, '/var/workflow/models/wfmin-legacy'] });
    assert.ok(v.failures.some(f => f.category === 'runner-config-unparseable'));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('fix: the overlaid DAM Update Asset model is renamed only on request', () => {
  fixed({}, (d, fix) => {
    assert.ok(!has(d, `${MODEL_DIR}/dam/update_asset/.content.xml`));
    assert.ok(has(d, `${MODEL_DIR}/update_asset-postprocessing/.content.xml`));
    assert.strictEqual(fix.workflows.find(w => w.confPath === `${MODELS}/update_asset-postprocessing`).renamedFrom, `${MODELS}/dam/update_asset`);
  });
  fixed({ renameOotbModels: false }, (d, fix) => {
    assert.ok(has(d, `${MODEL_DIR}/dam/update_asset/.content.xml`));
    assert.ok(fix.runner.byExpression.includes('/content/dam/wfmin(/.*):/var/workflow/models/dam/update_asset'));
    assert.ok(!fix.actions.some(a => a.change === 'model-rename'));
  });
});

test('fix: the profile-to-folder mapping is always reported; repoinit is written only on request', () => {
  fixed({}, (d, fix) => {
    const attach = fix.manual.find(m => m.code === 'profiles-to-attach');
    assert.strictEqual(attach.profile, '/conf/global/settings/dam/processing/migrated_from_update_asset');
    assert.deepStrictEqual(attach.folders.map(f => f.folder), ['/content/dam/wfmin']);
    assert.ok(!has(d, REPOINIT));
  });
  fixed({ emitRepoinit: true }, d => {
    assert.deepStrictEqual(JSON.parse(read(d, REPOINIT)), { scripts: [F.repoinitScript([{ folder: '/content/dam/wfmin', profile: '/conf/global/settings/dam/processing/migrated_from_update_asset' }])] });
  });
});

test('fix: files the tool only reformatted keep their layout; diffs show just the real change', () => fixed({}, d => {
  for (const id of ['update_asset_create', 'update_asset_mod', 'wfmin-marketing', 'wfmin-campaigns']) {
    const f = `${LAUNCHER_DIR}/${id}/.content.xml`;
    assert.deepStrictEqual(lineDiff(read(T.PROJECT, f), read(d, f)), { removed: ['    enabled="{Boolean}true"'], added: ['    enabled="{Boolean}false"'] }, id);
  }
  const filter = `${CONTENT}/META-INF/vault/filter.xml`;
  assert.deepStrictEqual(lineDiff(read(T.PROJECT, filter), read(d, filter)), { removed: ['    <filter root="/var/workflow/models" mode="merge"/>'], added: [] });
  assert.deepStrictEqual(lineDiff(read(T.PROJECT, 'pom.xml'), read(d, 'pom.xml')), { removed: [], added: ['        <module>aem-cloud-migration.content</module>', '        <module>aem-cloud-migration.apps</module>'] });
}));

test('fix: processing-profile filter roots are absolute', () => fixed({}, d => {
  assert.match(read(d, 'aem-cloud-migration.content/src/main/content/META-INF/vault/filter.xml'), /<filter root="\/conf\/global\/settings\/dam\/processing"\/>/);
}));

test('fix: overlapping runner entries are ordered most specific first and flagged', () => fixed({}, (d, fix) => {
  assert.ok(fix.actions.some(a => a.change === 'runner-order'));
  const notes = fix.manual.filter(m => m.code === 'overlapping-workflows');
  assert.deepStrictEqual(notes.map(n => n.models), [
    ['/var/workflow/models/wfmin-brand', '/var/workflow/models/update_asset-postprocessing'],
    ['/var/workflow/models/wfmin-marketing', '/var/workflow/models/update_asset-postprocessing'],
  ]);
  assert.match(notes[1].detail, /more specific expression is listed first/);
  assert.match(notes[0].detail, /separate lists/);
}));

test('fixers report the expected follow-ups', () => fixed({}, (d, fix) => {
  assert.deepStrictEqual([...new Set(fix.manual.map(m => m.code))].sort(), [
    'launcher-condition-dropped', 'models-to-sync', 'needs-custom-worker', 'overlapping-workflows', 'participant-or-nontransient-step',
    'profiles-to-attach', 'steps-now-before-completed', 'unsupported-step-removed',
  ]);
  assert.match(fix.manual.find(m => m.code === 'launcher-condition-dropped').detail, /jcr:mimeType!=video.*update_asset_create, update_asset_mod/);
  assert.match(fix.manual.find(m => m.code === 'participant-or-nontransient-step').model, /wfmin-campaigns$/);
  assert.strictEqual(fix.manual.filter(m => m.code === 'models-to-sync').length, 3);
}));

test('fixers are idempotent: a second pass changes nothing and reports the same follow-ups', () => {
  for (const opts of [{}, { renameOotbModels: false }, { emitRepoinit: true }]) {
    fixed(opts, (d, first) => {
      const again = F.applyFixes(d, T.PROJECT, Object.assign({ acknowledge: ACKS, renameOotbModels: true }, opts));
      assert.deepStrictEqual(again.changedFiles, [], JSON.stringify(opts));
      assert.deepStrictEqual(again.manual, first.manual, JSON.stringify(opts));
      assert.deepStrictEqual(again.runner, first.runner);
    });
  }
});

test('verification passes after the fixers and flags the overlaps as warnings', () => fixed({}, (d, fix) => {
  const v = V.verifyMigration(I.buildInventory(T.PROJECT), I.buildInventory(d), { fix, acknowledge: [...ACKS, '/var/workflow/models/wfmin-legacy'] });
  assert.ok(v.ok, JSON.stringify(v.failures));
  assert.strictEqual(v.warnings.filter(w => w.category === 'overlapping-workflows').length, 2);
}));

// ── Renditions-only workflows ─────────────────────────────────────────
// Only OOTB steps plus an ImageMagick CommandLineProcess: the tool disables the launcher and leaves
// the model alone, so without the rendition mapping the renditions would silently stop being generated.

const PRINT = `${MODELS}/wfmin-print`;
const PRINT_MODEL = `${MODEL_DIR}/wfmin-print/.content.xml`;
const PRINT_LAUNCHER = `${LAUNCHER_DIR}/wfmin-print/.content.xml`;
const PRINT_PROFILE = 'aem-cloud-migration.content/src/main/content/jcr_root/conf/global/settings/dam/processing/migrated_from_wfmin-print';
const MAPPABLE = 'convert ${filename} -resize 2048x2048 cq5dam.print.2048.2048.jpeg';
const UNMAPPABLE = 'convert ${filename} -sepia-tone 80% cq5dam.sepia.jpeg';

const printModel = commands => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content cq:template="/libs/cq/workflow/templates/model" jcr:primaryType="cq:PageContent" jcr:title="WF Min print" sling:resourceType="cq/workflow/components/pages/model" transient="true">
        <flow jcr:primaryType="nt:unstructured" sling:resourceType="foundation/components/parsys">
            <metadataprocessor jcr:primaryType="nt:unstructured" sling:resourceType="cq/workflow/components/model/process">
                <metaData jcr:primaryType="nt:unstructured" PROCESS="com.day.cq.dam.core.process.MetadataProcessorProcess" PROCESS_AUTO_ADVANCE="true"/>
            </metadataprocessor>
            <commandlineprocess jcr:primaryType="nt:unstructured" sling:resourceType="dam/components/workflow/commandlineprocess">
                <metaData jcr:primaryType="nt:unstructured" COMMANDS="[${commands.join(',')}]" MIME_TYPES="[image/tiff]" PROCESS="com.day.cq.dam.core.process.CommandLineProcess" PROCESS_AUTO_ADVANCE="true"/>
            </commandlineprocess>
            <damupdateassetworkflowcompletedprocess jcr:primaryType="nt:unstructured" sling:resourceType="dam/components/workflow/damupdateassetworkflowcompletedprocess">
                <metaData jcr:primaryType="nt:unstructured" PROCESS="com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess" PROCESS_AUTO_ADVANCE="true"/>
            </damupdateassetworkflowcompletedprocess>
        </flow>
    </jcr:content>
</jcr:root>
`;

const printLauncher = enabled => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:WorkflowLauncher"
    conditions="[jcr:content/jcr:mimeType==image/tiff]"
    enabled="{Boolean}${enabled}"
    eventType="{Long}1"
    glob="/content/dam/wfmin-print(/.*/)renditions/original"
    nodetype="nt:file"
    runModes="author"
    workflow="/var/workflow/models/wfmin-print"/>
`;

const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };

// Baseline = fixture project + the print workflow; tool output = recorded output + the same files with the
// launcher disabled (all the tool does to a workflow it does not migrate). `model` replaces the print model;
// `prepare(d)` edits the tool output before the fixers run.
function renditionsOnly(commands, opts, fn, { model, prepare } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awro-base-')), d = fs.mkdtempSync(path.join(os.tmpdir(), 'awro-'));
  try {
    T.materializeProject(base); T.materializeToolOutput(d);
    for (const [dir, enabled] of [[base, true], [d, false]]) { put(dir, PRINT_MODEL, model || printModel(commands)); put(dir, PRINT_LAUNCHER, printLauncher(enabled)); }
    if (prepare) prepare(d);
    const fix = F.applyFixes(d, base, Object.assign({ acknowledge: ACKS, renameOotbModels: true }, opts));
    return fn({ base, d, fix, pre: I.buildInventory(base), post: I.buildInventory(d) });
  } finally { for (const x of [base, d]) fs.rmSync(x, { recursive: true, force: true }); }
}

test('renditions-only: detected, previewed and gated like any other unsupported step', () => {
  for (const [commands, mapped] of [[[MAPPABLE], true], [[MAPPABLE, UNMAPPABLE], false]]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awro-gate-'));
    try {
      T.materializeProject(base);
      fs.mkdirSync(path.dirname(path.join(base, PRINT_MODEL)), { recursive: true });
      fs.writeFileSync(path.join(base, PRINT_MODEL), printModel(commands));
      fs.mkdirSync(path.dirname(path.join(base, PRINT_LAUNCHER)), { recursive: true });
      fs.writeFileSync(path.join(base, PRINT_LAUNCHER), printLauncher(true));
      const pre = I.buildInventory(base);
      const w = pre.workflows.find(x => x.model && x.model.confPath === PRINT);
      assert.ok(!w.toolWillMigrate && !w.summary.hasRealWork && I.isAffected(w) && I.isRenditionsOnly(w));
      assert.strictEqual(RUN.planPreview(pre).find(p => p.model === PRINT).renditionsOnly, true);
      const gate = RUN.gateUnsupported(pre, []).steps.find(s => s.model === PRINT);
      assert.strictEqual(gate.fullyMapped, mapped);
      assert.strictEqual(gate.acknowledged, mapped);
      const lines = [];
      RUN.main([base, '--dry-run'], l => lines.push(l));
      assert.ok(lines.some(l => l.includes(`${PRINT} (renditions only: launcher disabled, no post-processing workflow)`)), lines.join('\n'));
      const scan = I.runAssetWorkflowScan(base).findings.find(f => f.detail.includes(PRINT));
      assert.match(scan.detail, /processing-profile renditions only/);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  }
});

test('renditions-only: mapped commands become profile renditions; the model is neither wired nor changed', () => renditionsOnly([MAPPABLE], {}, ({ base, d, fix, pre, post }) => {
  const wf = fix.workflows.find(w => w.confPath === PRINT);
  assert.ok(wf.renditionsOnly);
  assert.strictEqual(wf.profile, '/conf/global/settings/dam/processing/migrated_from_wfmin-print');
  assert.match(read(d, `${PRINT_PROFILE}/cq5dam_print_2048_2048_jpeg/.content.xml`), /wid="2048" hei="2048" includeMimeTypes="image\/tiff"/);
  assert.strictEqual(read(d, PRINT_MODEL), read(base, PRINT_MODEL));
  assert.ok(![...fix.runner.byPath, ...fix.runner.byExpression].some(e => e.includes('wfmin-print')));
  const notes = fix.manual.filter(m => m.model === PRINT);
  assert.deepStrictEqual([...new Set(notes.map(m => m.code))].sort(), ['profiles-to-attach', 'unsupported-step-removed']);
  assert.deepStrictEqual(notes.find(m => m.code === 'profiles-to-attach').folders.map(f => f.folder), ['/content/dam/wfmin-print']);
  const removed = notes.find(m => m.code === 'unsupported-step-removed');
  assert.ok(removed.fullyMapped && removed.acknowledged);
  assert.match(removed.detail, /no longer runs/);
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(PRINT)), JSON.stringify(v.failures));
  const md = R.renderReport({ pre, post, fix, verify: v, tool: { version: '0.6.0', ok: true } });
  assert.match(md, /\| Renditions-only workflows \(processing profile only\) \| 1 \|/);
  assert.match(md, /`\/conf\/global\/settings\/workflow\/models\/wfmin-print` \(renditions only — not migrated\)/);
  const again = F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true });
  assert.deepStrictEqual(again.changedFiles, []);
  assert.deepStrictEqual(again.manual, fix.manual);
}));

test('renditions-only: verify fails when a command has no replacement and was not acknowledged', () => renditionsOnly([MAPPABLE, UNMAPPABLE], { acknowledge: [] }, ({ fix, pre, post }) => {
  assert.ok(fix.manual.some(m => m.model === PRINT && m.code === 'needs-custom-worker' && /-sepia-tone/.test(m.detail)));
  const failures = V.verifyMigration(pre, post, { fix, acknowledge: [] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(failures.map(f => f.category), ['unsupported-step-removed']);
  assert.match(failures[0].detail, /no longer runs/);
  const acked = V.verifyMigration(pre, post, { fix, acknowledge: ['CommandLineProcess'] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(acked, []);
}));

// ── Same-name siblings after flattening ───────────────────────────────
// The surviving AND branch's steps move up next to a kept OPTIONAL step that has the same node name.

const SPLIT = `${MODELS}/wfmin-split`;
const SPLIT_MODEL = `${MODEL_DIR}/wfmin-split/.content.xml`;
const SPLIT_LAUNCHER = `${LAUNCHER_DIR}/wfmin-split/.content.xml`;
const EMAIL = 'com.day.cq.dam.core.impl.process.SendTransientWorkflowCompletedEmailProcess';
const proc = (node, process, extra = '') => `<${node} jcr:primaryType="nt:unstructured" sling:resourceType="cq/workflow/components/model/process">
    <metaData jcr:primaryType="nt:unstructured" PROCESS="${process}" PROCESS_AUTO_ADVANCE="true"${extra}/>
</${node}>`;
const indent = (s, n) => s.split('\n').map(l => ' '.repeat(n) + l).join('\n');
const splitModel = () => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content cq:template="/libs/cq/workflow/templates/model" jcr:primaryType="cq:PageContent" jcr:title="WF Min split" sling:resourceType="cq/workflow/components/pages/model" transient="true">
        <flow jcr:primaryType="nt:unstructured" sling:resourceType="foundation/components/parsys">
${indent(proc('process', EMAIL), 12)}
            <and jcr:primaryType="nt:unstructured" sling:resourceType="cq/workflow/components/model/and">
                <branch_1 jcr:primaryType="nt:unstructured" sling:resourceType="cq/flow/components/parsys">
${indent(proc('process', 'com.example.wfmin.StepB'), 20)}
${indent(proc('process_1', 'com.example.wfmin.StepC'), 20)}
                </branch_1>
                <branch_2 jcr:primaryType="nt:unstructured" sling:resourceType="cq/flow/components/parsys">
${indent(proc('process', 'com.day.cq.dam.core.process.CommandLineProcess', ` COMMANDS="[${MAPPABLE}]" MIME_TYPES="[image/tiff]"`), 20)}
                </branch_2>
            </and>
${indent(proc('damupdateassetworkflowcompletedprocess', C.COMPLETED_PROCESS), 12)}
        </flow>
    </jcr:content>
</jcr:root>
`;

function withSplitWorkflow(fn, model = splitModel()) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awsns-base-')), d = fs.mkdtempSync(path.join(os.tmpdir(), 'awsns-'));
  const launcher = enabled => printLauncher(enabled).replace(/wfmin-print/g, 'wfmin-split');
  try {
    T.materializeProject(base); T.materializeToolOutput(d);
    for (const [dir, enabled] of [[base, true], [d, false]]) { put(dir, SPLIT_MODEL, model); put(dir, SPLIT_LAUNCHER, launcher(enabled)); }
    const fix = F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true });
    return fn({ base, d, fix, pre: I.buildInventory(base), post: I.buildInventory(d) });
  } finally { for (const x of [base, d]) fs.rmSync(x, { recursive: true, force: true }); }
}

test('fix: flattening never leaves same-name siblings; later duplicates get the first free suffix', () => withSplitWorkflow(({ base, d, fix, pre, post }) => {
  const m = post.models.find(x => x.confPath === SPLIT);
  assert.deepStrictEqual(m.steps.map(s => [s.node, C.shortName(s.process)]), [
    ['process', 'SendTransientWorkflowCompletedEmailProcess'], ['process_2', 'StepB'], ['process_1', 'StepC'], ['damupdateassetworkflowcompletedprocess', 'DamUpdateAssetWorkflowCompletedProcess'],
  ]);
  assert.ok(fix.actions.some(a => a.change === 'non-runnable-steps' && a.detail === 'node process renamed to process_2: a sibling already had that name after flattening'));
  const wf = fix.workflows.find(w => w.confPath === SPLIT);
  assert.deepStrictEqual(wf.removed.map(s => C.shortName(s.process)), ['CommandLineProcess']);
  assert.deepStrictEqual(wf.kept.map(s => s.node), ['process', 'process_2', 'process_1', 'damupdateassetworkflowcompletedprocess']);
  assert.ok(fix.runner.byExpression.some(e => e.endsWith(':/var/workflow/models/wfmin-split')));
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(SPLIT)), JSON.stringify(v.failures));
  const again = F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true });
  assert.deepStrictEqual(again.changedFiles, []);
}));

test('uniqueSiblingsPass renames nested duplicates too, start and end tags alike', () => {
  const text = `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"><jcr:content><flow><a/><b><x></x><x><y/></x><x_1/></b><a></a></flow></jcr:content></jcr:root>`;
  const st = { renamed: [] };
  assert.strictEqual(F.uniqueSiblingsPass(text, st), `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"><jcr:content><flow><a/><b><x></x><x_2><y/></x_2><x_1/></b><a_1></a_1></flow></jcr:content></jcr:root>`);
  assert.deepStrictEqual(st.renamed, [{ from: 'x', to: 'x_2' }, { from: 'a', to: 'a_1' }]);
});

test('verify fails on same-name siblings in a wired model', () => withSplitWorkflow(({ d, fix, pre }) => {
  const file = path.join(d, SPLIT_MODEL);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/process_2\b/g, 'process'));
  const failures = V.verifyMigration(pre, I.buildInventory(d), { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] }).failures;
  assert.deepStrictEqual(failures.filter(f => f.category === 'duplicate-node-name').map(f => f.detail.split(':')[0]), [SPLIT]);
}));

// ── One rendition name, two definitions ───────────────────────────────

const OUT_800 = 'convert ${filename} -resize 800x800 cq5dam.print.png';
const OUT_400 = 'convert ${filename} -resize 400x400 cq5dam.print.png';

test('renditions-only: two commands writing one rendition name with different settings stop instead of dropping one', () => renditionsOnly([OUT_800, OUT_400], { acknowledge: [] }, ({ d, fix, pre, post }) => {
  const gate = RUN.gateUnsupported(pre, []).steps.find(s => s.model === PRINT);
  assert.ok(!gate.fullyMapped && !gate.acknowledged);
  assert.match(gate.custom.join('\n'), /400x400 .*already produces cq5dam\.print\.png with different settings/);
  assert.match(read(d, `${PRINT_PROFILE}/cq5dam_print_png/.content.xml`), /wid="800"/);
  assert.ok(!has(d, `${PRINT_PROFILE}/cq5dam_print_png_1/.content.xml`));
  assert.ok(fix.manual.some(m => m.model === PRINT && m.code === 'needs-custom-worker' && /400x400/.test(m.detail)));
  const failures = V.verifyMigration(pre, post, { fix, acknowledge: [] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(failures.map(f => f.category), ['unsupported-step-removed']);
}));

const PROFILE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Page">
    <jcr:content jcr:primaryType="nt:unstructured" jcr:title="Migrated from wfmin-print" sling:resourceType="dam/processing/profile"/>
</jcr:root>
`;
const profileWith = rendition => d => { put(d, `${PRINT_PROFILE}/.content.xml`, PROFILE_XML); put(d, `${PRINT_PROFILE}/print/.content.xml`, F.renditionXml(rendition)); };
const existingPrint = wid => ({ name: 'cq5dam.print.2048.2048.jpeg', fmt: 'jpeg', wid, hei: wid, qlt: null, include: 'image/png' });

test('renditions-only: a rendition already in the profile is merged when identical and stopped when it differs', () => {
  renditionsOnly([MAPPABLE], {}, ({ base, d, fix }) => {
    assert.match(read(d, `${PRINT_PROFILE}/print/.content.xml`), /includeMimeTypes="image\/png,image\/tiff"/);
    assert.ok(!has(d, `${PRINT_PROFILE}/cq5dam_print_2048_2048_jpeg/.content.xml`));
    assert.ok(fix.manual.find(m => m.model === PRINT && m.code === 'unsupported-step-removed').fullyMapped);
    assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);
  }, { prepare: profileWith(existingPrint('2048')) });
  renditionsOnly([MAPPABLE], { acknowledge: [] }, ({ d, fix, pre, post }) => {
    assert.match(read(d, `${PRINT_PROFILE}/print/.content.xml`), /wid="1024"[^>]*includeMimeTypes="image\/png"/);
    assert.ok(!has(d, `${PRINT_PROFILE}/cq5dam_print_2048_2048_jpeg/.content.xml`));
    assert.ok(fix.manual.some(m => m.model === PRINT && m.code === 'needs-custom-worker' && /already has cq5dam\.print\.2048\.2048\.jpeg with different settings/.test(m.detail)));
    const removed = fix.manual.find(m => m.model === PRINT && m.code === 'unsupported-step-removed');
    assert.ok(!removed.fullyMapped && !removed.acknowledged);
    const failures = V.verifyMigration(pre, post, { fix, acknowledge: [] }).failures.filter(f => f.detail.includes(PRINT));
    assert.deepStrictEqual(failures.map(f => f.category), ['unsupported-step-removed']);
  }, { prepare: profileWith(existingPrint('1024')) });
});

// Two steps of one model produce the same rendition; the profile already has it with other settings.
const twoPrintSteps = () => {
  const m = printModel([MAPPABLE]);
  const clp = /( *<commandlineprocess [\s\S]*?<\/commandlineprocess>\n)/.exec(m)[1];
  return m.replace(clp, clp + clp.replace(/commandlineprocess(?=[ >])/g, 'commandlineprocess_2'));
};

test('renditions-only: a profile rendition that differs stops every step that needs it, not just the first', () => renditionsOnly(null, { acknowledge: [] }, ({ fix, pre, post }) => {
  const notes = fix.manual.filter(m => m.model === PRINT && m.code === 'unsupported-step-removed');
  assert.deepStrictEqual(notes.map(m => [m.path.split('/').pop(), m.fullyMapped, m.acknowledged]), [['commandlineprocess', false, false], ['commandlineprocess_2', false, false]]);
  const failures = V.verifyMigration(pre, post, { fix, acknowledge: [] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(failures.map(f => f.detail.match(/at \S+/)[0].split('/').pop()), ['commandlineprocess', 'commandlineprocess_2']);
}, { model: twoPrintSteps(), prepare: profileWith(existingPrint('1024')) }));

// ── Rendition steps inside a split ────────────────────────────────────
// The tool adds a step's renditions to the processing profile only when the step is top-level.

const THUMBS = 'com.day.cq.dam.core.process.ThumbnailProcess';
const WEB = 'com.day.cq.dam.core.process.CreateWebEnabledImageProcess';
const FFMPEG_THUMBS = 'com.day.cq.dam.video.FFMpegThumbnailProcess';
const COMPLETED = proc('damupdateassetworkflowcompletedprocess', C.COMPLETED_PROCESS);
const SPLIT_PROFILE = PRINT_PROFILE.replace('wfmin-print', 'wfmin-split');
const modelWith = (title, steps) => `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="cq:Page">
    <jcr:content cq:template="/libs/cq/workflow/templates/model" jcr:primaryType="cq:PageContent" jcr:title="${title}" sling:resourceType="cq/workflow/components/pages/model" transient="true">
        <flow jcr:primaryType="nt:unstructured" sling:resourceType="foundation/components/parsys">
${steps.map(s => indent(s, 12)).join('\n')}
        </flow>
    </jcr:content>
</jcr:root>
`;
const split = (kind, branches, attrs = '') => `<${kind} jcr:primaryType="nt:unstructured" sling:resourceType="cq/workflow/components/model/${kind}"${attrs}>
${branches.map((b, i) => `    <branch_${i + 1} jcr:primaryType="nt:unstructured" sling:resourceType="cq/flow/components/parsys">
${indent(b, 8)}
    </branch_${i + 1}>`).join('\n')}
</${kind}>`;

test('mapRemovedStep: rendition steps map the way the tool maps them at the top level', () => {
  const names = r => r.map(x => [x.status, x.rendition ? x.rendition.name : x.output]);
  assert.deepStrictEqual(names(C.mapRemovedStep({ process: THUMBS, args: { PROCESS_ARGS: '[48:48],[140:100],[319:319],[600:600]' } })), [
    ['standard', 'cq5dam.thumbnail.48.48.png'], ['standard', 'cq5dam.thumbnail.140.100.png'], ['standard', 'cq5dam.thumbnail.319.319.png'], ['mapped', 'cq5dam.thumbnail.600.600.png'],
  ]);
  const cfg = C.mapRemovedStep({ process: 'com.day.cq.dam.core.impl.process.ThumbnailProcess', args: {
    CONFIGS: '[700:700:false]', SKIP_MIME_TYPES: '[skip:video/.*]', MIME_TYPE: 'image/webp', WIDTH: '{Long}640', HEIGHT: '480', QUALITY: '80',
    KEEP_FORMAT_LIST: 'image/tiff,image/png', SKIP: '[skip:image/gif]', FPO_CREATION_ENABLED: 'true', CREATE_FPO_MIMETYPES: 'image/tiff', FPO_QUALITY: '10' } });
  assert.deepStrictEqual(cfg.map(x => x.rendition), [
    { name: 'cq5dam.thumbnail.700.700.png', fmt: 'png', wid: '700', hei: '700', qlt: null, include: 'image/.*', exclude: 'video/.*' },
    { name: 'cq5dam.thumbnail.640.480.webp', fmt: 'webp', wid: '640', hei: '480', qlt: '80', include: 'image/tiff,image/png', exclude: 'image/gif' },
    { name: 'cq5dam.fpo.jpeg', fmt: 'jpeg', wid: null, hei: null, qlt: '10', include: 'image/tiff', exclude: null },
  ]);
  assert.deepStrictEqual(names(C.mapRemovedStep({ process: WEB, args: { WIDTH: '1280', HEIGHT: '1280', MIME_TYPE: 'image/jpeg', QUALITY: '90' } })), [['standard', 'cq5dam.web.1280.1280.jpeg']]);
  const bmp = C.mapRemovedStep({ process: WEB, args: { WIDTH: '10', HEIGHT: '10', MIME_TYPE: 'image/bmp' } });
  assert.deepStrictEqual(bmp.map(x => x.status), ['custom']);
  assert.match(bmp[0].reason, /bmp/);
  assert.deepStrictEqual(C.mapRemovedStep({ process: FFMPEG_THUMBS, args: {} }), []);
});

test('fix: a rendition step inside a split keeps its renditions in the processing profile', () => withSplitWorkflow(({ base, d, fix, pre, post }) => {
  const wf = fix.workflows.find(w => w.confPath === SPLIT);
  assert.deepStrictEqual(wf.removed.map(s => [C.shortName(s.process), s.inSplit]), [['ThumbnailProcess', true]]);
  assert.match(read(d, `${SPLIT_PROFILE}/cq5dam_thumbnail_700_700_png/.content.xml`), /fmt="png" name="cq5dam.thumbnail.700.700.png" wid="700" hei="700" includeMimeTypes="image\/\.\*"/);
  assert.ok(!has(d, `${SPLIT_PROFILE}/cq5dam_thumbnail_48_48_png`));
  const note = fix.manual.find(m => m.model === SPLIT && m.code === 'unsupported-step-removed');
  assert.ok(note.fullyMapped && note.acknowledged, JSON.stringify(note));
  const gate = RUN.gateUnsupported(pre, []).steps.filter(s => s.model === SPLIT);
  assert.deepStrictEqual(gate.map(s => [C.shortName(s.process), s.fullyMapped]), [['ThumbnailProcess', true]]);
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(SPLIT)), JSON.stringify(v.failures));
  assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);
}, modelWith('WF Min split', [
  proc('process', EMAIL),
  split('and', [proc('process', 'com.example.wfmin.StepB'), proc('process', THUMBS, ' PROCESS_ARGS="[48:48],[700:700]"')]),
  COMPLETED,
])));

test('renditions-only: rendition steps inside an OR split are found, mapped and gated', () => renditionsOnly([], {}, ({ base, d, fix, pre, post }) => {
  const w = pre.workflows.find(x => x.model && x.model.confPath === PRINT);
  assert.ok(I.isAffected(w) && I.isRenditionsOnly(w));
  assert.match(I.runAssetWorkflowScan(base).findings.find(f => f.detail.includes(PRINT)).detail, /2 rendition step\(s\) inside a split/);
  assert.deepStrictEqual(RUN.gateUnsupported(pre, []).steps.filter(s => s.model === PRINT).map(s => [C.shortName(s.process), s.fullyMapped]), [['ThumbnailProcess', true], ['CreateWebEnabledImageProcess', true]]);
  assert.match(read(d, `${PRINT_PROFILE}/cq5dam_thumbnail_700_700_png/.content.xml`), /wid="700" hei="700" includeMimeTypes="image\/\.\*" excludeMimeTypes="video\/\.\*"/);
  assert.match(read(d, `${PRINT_PROFILE}/cq5dam_web_2000_2000_png/.content.xml`), /wid="2000" hei="2000" includeMimeTypes="image\/tiff,image\/png"/);
  assert.ok(!fs.readdirSync(path.join(d, PRINT_PROFILE)).some(n => /140_100|1280/.test(n)));
  assert.deepStrictEqual(fix.manual.filter(m => m.model === PRINT && m.code === 'unsupported-step-removed').map(m => m.fullyMapped), [true, true]);
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(PRINT)), JSON.stringify(v.failures));
  assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);
}, { model: modelWith('WF Min print', [
  split('or', [
    proc('thumbnailprocess', THUMBS, ' CONFIGS="[140:100:false,700:700:false]" SKIP_MIME_TYPES="[skip:video/.*]" WIDTH="{Long}1280" HEIGHT="{Long}1280" MIME_TYPE="image/jpeg" QUALITY="{Long}90"'),
    proc('webenabled', WEB, ' WIDTH="2000" HEIGHT="2000" MIME_TYPE="image/png" KEEP_FORMAT_LIST="image/tiff,image/png"'),
  ]),
  COMPLETED,
]) }));

test('renditions-only: a nested rendition step the skill cannot map stops the run until acknowledged', () => renditionsOnly([], { acknowledge: [] }, ({ fix, pre, post }) => {
  const gate = RUN.gateUnsupported(pre, []).steps.filter(s => s.model === PRINT);
  assert.deepStrictEqual(gate.map(s => [C.shortName(s.process), s.fullyMapped, s.acknowledged]), [['FFMpegThumbnailProcess', false, false], ['ThumbnailProcess', true, true]]);
  assert.match(gate[0].remediation, /top level/);
  assert.ok(RUN.gateUnsupported(pre, ['FFMpegThumbnailProcess']).steps.filter(s => s.model === PRINT).every(s => s.acknowledged));
  assert.ok(!fix.manual.some(m => m.model === PRINT && m.code === 'needs-custom-worker'));
  const failures = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(failures.map(f => f.category), ['unsupported-step-removed']);
  assert.match(failures[0].detail, /FFMpegThumbnailProcess .*top level/);
  const acked = V.verifyMigration(pre, post, { fix, acknowledge: ['FFMpegThumbnailProcess', '/var/workflow/models/wfmin-legacy'] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(acked, []);
}, { model: modelWith('WF Min print', [
  split('or', [proc('ffmpeg', FFMPEG_THUMBS, ' CONFIGS="[140:100:false]"'), proc('thumbnailprocess', THUMBS, ' PROCESS_ARGS="[700:700]"')]),
  COMPLETED,
]) }));

test('verify: a fully mapped step does not cover another step of the same process that is not', () => renditionsOnly([], { acknowledge: [] }, ({ fix, pre, post }) => {
  const notes = fix.manual.filter(m => m.model === PRINT && m.code === 'unsupported-step-removed');
  assert.deepStrictEqual(notes.map(m => [m.path.split('/').pop(), m.fullyMapped, m.acknowledged]), [['thumbs_a', true, true], ['thumbs_b', false, false]]);
  const failures = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] }).failures.filter(f => f.detail.includes(PRINT));
  assert.deepStrictEqual(failures.map(f => f.detail.split(' ').slice(1, 4).join(' ')), [`ThumbnailProcess at ${pre.workflows.find(w => w.model && w.model.confPath === PRINT).model.flat.find(s => s.node === 'thumbs_b').path}`]);
}, { model: modelWith('WF Min print', [
  split('or', [proc('thumbs_a', THUMBS, ' PROCESS_ARGS="[700:700]"'), proc('thumbs_b', THUMBS, ' CONFIGS="[140:100:false]" MIME_TYPE="image/bmp"')]),
  COMPLETED,
]) }));

// ── Top-level rendition steps ─────────────────────────────────────────
// The tool puts their non-standard renditions in a "Migrated from <model>" processing profile and
// disables the launcher; unless that profile is attached to the folders, the renditions stop.

const PDF_PREVIEW = 'com.day.cq.dam.core.process.CreatePdfPreviewProcess';
const FFMPEG_TRANSCODE = 'com.day.cq.dam.video.FFMpegTranscodeProcess';
const OOTB_THUMBS = ' CONFIGS="[140:100:false,48:48:false,319:319:false]" WIDTH="{Long}1280" HEIGHT="{Long}1280" MIME_TYPE="image/jpeg" QUALITY="{Long}90"';

test('profileRenditionSteps: top-level rendition steps whose renditions go to the profile; standard ones do not count', () => {
  const nui = (node, process, args = {}) => ({ node, kind: 'process', category: 'NUI_MIGRATED', process, args });
  const deletePreview = { node: 'deletepreview', kind: 'process', category: 'UNNECESSARY', process: 'com.day.cq.dam.core.process.DeleteImagePreviewProcess', args: {} };
  const picks = steps => C.profileRenditionSteps(steps).map(s => s.node);
  assert.deepStrictEqual(picks([
    nui('ootb', THUMBS, { CONFIGS: '[140:100:false,48:48:false,319:319:false]', WIDTH: '{Long}1280', HEIGHT: '{Long}1280', MIME_TYPE: 'image/jpeg', QUALITY: '{Long}90' }),
    nui('args', THUMBS, { PROCESS_ARGS: '[48:48],[140:100],[319:319]' }),
    nui('web', WEB, { WIDTH: '1280', HEIGHT: '1280', MIME_TYPE: 'image/jpeg', QUALITY: '90' }),
    nui('ffmpeg', FFMPEG_THUMBS, { CONFIGS: '[140:100:false,48:48:false,319:319:false]' }),
    nui('transcode', FFMPEG_TRANSCODE, { CONFIGS: '[hq]' }),
    nui('pdf', PDF_PREVIEW, { MAX_WIDTH: '2048', MAX_HEIGHT: '2048' }),
    deletePreview,
  ]), []);
  assert.deepStrictEqual(picks([
    nui('args', THUMBS, { PROCESS_ARGS: '[48:48],[140:100],[319:319],[600:600]' }),
    nui('web', WEB, { WIDTH: '800', HEIGHT: '800', MIME_TYPE: 'image/jpeg', QUALITY: '90' }),
    nui('ffmpeg', FFMPEG_THUMBS, { PROCESS_ARGS: '[140:100],[640:360]' }),
    nui('pdf', PDF_PREVIEW, { MAX_WIDTH: '2048', MAX_HEIGHT: '2048' }),
  ]), ['args', 'web', 'ffmpeg', 'pdf']);
});

test('renditions-only: a top-level rendition step makes the workflow affected and its profile is attached', () => renditionsOnly([], {}, ({ base, d, fix, pre, post }) => {
  const w = pre.workflows.find(x => x.model && x.model.confPath === PRINT);
  assert.ok(I.isAffected(w) && I.isRenditionsOnly(w));
  assert.strictEqual(RUN.planPreview(pre).find(p => p.model === PRINT).renditionsOnly, true);
  assert.match(I.runAssetWorkflowScan(base).findings.find(f => f.detail.includes(PRINT)).detail, /1 rendition step\(s\) whose renditions move to a processing profile/);
  assert.deepStrictEqual(RUN.gateUnsupported(pre, []).steps.filter(s => s.model === PRINT), []);
  assert.deepStrictEqual(fix.manual.filter(m => m.model === PRINT).map(m => m.code), ['profiles-to-attach']);
  assert.strictEqual(read(d, PRINT_MODEL), read(base, PRINT_MODEL));
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(PRINT)), JSON.stringify(v.failures));
  assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);
}, {
  model: modelWith('WF Min print', [proc('thumbnailprocess', THUMBS, ' PROCESS_ARGS="[48:48],[140:100],[319:319],[600:600]"'), COMPLETED]),
  prepare: profileWith({ name: 'cq5dam.thumbnail.600.600.png', fmt: 'png', wid: '600', hei: '600', qlt: null, include: 'image/.*' }),
}));

test('renditions-only: a workflow whose rendition steps produce only standard renditions is not affected', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awro-std-'));
  try {
    T.materializeProject(base);
    put(base, PRINT_MODEL, modelWith('WF Min print', [proc('thumbnailprocess', THUMBS, OOTB_THUMBS), proc('ffmpeg', FFMPEG_THUMBS, ' CONFIGS="[140:100:false,48:48:false,319:319:false]"'), COMPLETED]));
    put(base, PRINT_LAUNCHER, printLauncher(true));
    const pre = I.buildInventory(base);
    assert.ok(!I.isAffected(pre.workflows.find(x => x.model && x.model.confPath === PRINT)));
    assert.ok(!RUN.planPreview(pre).some(p => p.model === PRINT));
    assert.ok(!I.runAssetWorkflowScan(base).findings.some(f => f.detail.includes(PRINT)));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('fix: a profile the tool created for a workflow it did not migrate is reported for attaching', () => renditionsOnly([], {}, ({ fix, pre }) => {
  assert.ok(!I.isAffected(pre.workflows.find(x => x.model && x.model.confPath === PRINT)));
  const wf = fix.workflows.find(w => w.confPath === PRINT);
  assert.ok(wf && wf.renditionsOnly);
  const attach = fix.manual.filter(m => m.model === PRINT && m.code === 'profiles-to-attach');
  assert.deepStrictEqual(attach.map(m => m.folders.map(f => f.folder)), [['/content/dam/wfmin-print']]);
}, {
  model: modelWith('WF Min print', [proc('transcode', FFMPEG_TRANSCODE, ' CONFIGS="[hq]"'), COMPLETED]),
  prepare: profileWith({ name: 'cq5dam.video.hq.mp4', fmt: 'png', wid: '1280', hei: '720', qlt: null, include: 'video/.*' }),
}));

// ── Namespaces after flattening ───────────────────────────────────────

test('fix: a namespace declared on a flattened split moves to the root so the model still installs', () => withSplitWorkflow(({ base, d, fix, pre, post }) => {
  const text = read(d, SPLIT_MODEL);
  assert.match(text, /xmlns:nt="http:\/\/www\.jcp\.org\/jcr\/nt\/1\.0" xmlns:custom="http:\/\/example\.com\/wfmin\/custom"\n/);
  assert.match(text, /custom:flag="true"/);
  assert.deepStrictEqual(X.unboundPrefixes(X.parseXml(text)), []);
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(SPLIT)), JSON.stringify(v.failures));
  assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);

  fs.writeFileSync(path.join(d, SPLIT_MODEL), text.replace(/ xmlns:custom="[^"]*"/, ''));
  const failures = V.verifyMigration(pre, I.buildInventory(d), { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] }).failures.filter(f => f.category === 'unbound-namespace-prefix');
  assert.deepStrictEqual(failures.map(f => f.detail.split(':')[0]), [SPLIT]);
  assert.match(failures[0].detail, /custom/);
}, modelWith('WF Min split', [
  proc('process', EMAIL),
  split('and', [
    proc('process', 'com.example.wfmin.StepB', ' custom:flag="true"'),
    proc('process', 'com.day.cq.dam.core.process.CommandLineProcess', ` COMMANDS="[${MAPPABLE}]" MIME_TYPES="[image/tiff]"`),
  ], ' xmlns:custom="http://example.com/wfmin/custom"'),
  COMPLETED,
])));

const shadowedModel = () => modelWith('WF Min split', [
  proc('process', EMAIL, ' custom:outer="true"'),
  split('and', [
    proc('process_b', 'com.example.wfmin.StepB', ' custom:flag="true"'),
    proc('process_c', 'com.day.cq.dam.core.process.CommandLineProcess', ` COMMANDS="[${MAPPABLE}]" MIME_TYPES="[image/tiff]"`),
  ], ' xmlns:custom="urn:inner"'),
  COMPLETED,
]).replace('xmlns:nt="http://www.jcp.org/jcr/nt/1.0"', '$& xmlns:custom="urn:outer"');

test('fix: a split that binds a prefix to another namespace is kept, so no property changes meaning', () => withSplitWorkflow(({ base, d, fix, pre, post }) => {
  const text = read(d, SPLIT_MODEL);
  assert.match(text, /<and [^>]*xmlns:custom="urn:inner"/);
  assert.match(text, /<branch_1 [\s\S]*custom:flag="true"[\s\S]*<\/branch_1>/);
  assert.ok(!/CommandLineProcess/.test(text));
  assert.ok(fix.actions.some(a => /AND split and: kept \(flattening it would change the namespace of prefix custom\)/.test(a.detail)), JSON.stringify(fix.actions.filter(a => a.change === 'non-runnable-steps')));
  const v = V.verifyMigration(pre, post, { fix, acknowledge: ['/var/workflow/models/wfmin-legacy'] });
  assert.ok(!v.failures.some(f => f.detail.includes(SPLIT)), JSON.stringify(v.failures));
  assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);
}, shadowedModel()));

test('fix: a second run changes nothing when the model has blank lines around a flattened split', () => withSplitWorkflow(({ base, d }) => {
  const once = read(d, SPLIT_MODEL);
  assert.ok(!/<and /.test(once));
  assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);
  assert.strictEqual(read(d, SPLIT_MODEL), once);
}, splitModel().replace('\n            <and ', '\n\n            <and ').replace('</process>\n                    <process_1', '</process>\n\n                    <process_1')));

const ANCESTOR_FILTERS = ['launcher', 'models/dam', 'models/wfmin-campaigns', 'models/wfmin-marketing'].map(p => `<filter root="/conf/global/settings/workflow/${p}"/>`);
const UI_FILTER = 'ui.content/src/main/content/META-INF/vault/filter.xml';

test('fix: a renamed model gets its own filter root when only an ancestor of the old path was covered', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awflt-base-')), d = fs.mkdtempSync(path.join(os.tmpdir(), 'awflt-'));
  try {
    T.materializeProject(base); T.materializeToolOutput(d);
    for (const dir of [base, d]) {
      const f = path.join(dir, UI_FILTER);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<filter root="/conf/global/settings/workflow"/>', ANCESTOR_FILTERS.join('\n    ')));
    }
    const fix = F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true });
    const renamed = `${MODELS}/update_asset-postprocessing`;
    assert.ok(read(d, UI_FILTER).endsWith(`    <filter root="/conf/global/settings/workflow/models/wfmin-marketing"/>\n    <filter root="${renamed}"/>\n</workspaceFilter>\n`), read(d, UI_FILTER));
    assert.ok(fix.actions.some(a => a.change === 'model-rename' && a.detail === `added filter root ${renamed}: no filter covered the renamed model`));
    const pre = I.buildInventory(base), post = I.buildInventory(d);
    assert.strictEqual(post.models.find(m => m.confPath === renamed).filtered, true);
    const v = V.verifyMigration(pre, post, { fix, acknowledge: [...ACKS, '/var/workflow/models/wfmin-legacy'] });
    assert.ok(!v.failures.some(f => f.category === 'model-not-in-filter'), JSON.stringify(v.failures));
    assert.deepStrictEqual(F.applyFixes(d, base, { acknowledge: ACKS, renameOotbModels: true }).changedFiles, []);

    // Without that root the gate catches it.
    fs.writeFileSync(path.join(d, UI_FILTER), read(d, UI_FILTER).replace(`<filter root="${renamed}"/>`, ''));
    const failed = V.verifyMigration(pre, I.buildInventory(d), { fix, acknowledge: [...ACKS, '/var/workflow/models/wfmin-legacy'] }).failures;
    assert.deepStrictEqual(failed.filter(f => f.category === 'model-not-in-filter').map(f => f.detail.split(' ')[0]), [renamed]);
  } finally { for (const x of [base, d]) fs.rmSync(x, { recursive: true, force: true }); }
});

// ── Helpers ───────────────────────────────────────────────────────────

test('mapCommand: WxH resizes and format conversions map; other ImageMagick options do not', () => {
  const inc = 'image/.*';
  assert.deepStrictEqual(C.mapCommand('convert ${filename} -resize 1200x1200 cq5dam.print.1200.1200.jpeg', inc).rendition, { name: 'cq5dam.print.1200.1200.jpeg', fmt: 'jpeg', wid: '1200', hei: '1200', qlt: null, include: inc });
  assert.strictEqual(C.mapCommand('magick convert ${filename} -quality 80 -strip out.webp', inc).rendition.qlt, '80');
  assert.strictEqual(C.mapCommand('convert ${filename} out.png', inc).rendition.wid, null);
  assert.strictEqual(C.mapCommand('convert ${filename} -thumbnail 48x48 cq5dam.thumbnail.48.48.png', inc).status, 'standard');
  const dyn = C.mapCommand('convert ${filename} -resize 10x10 ${basename}-small.png', inc);
  assert.ok(dyn.nameChanged);
  assert.strictEqual(dyn.rendition.name, 'small.png');
  assert.match(C.mapCommand('convert ${filename} -resize 25% x.png', inc).reason, /geometry 25%/);
  assert.match(C.mapCommand('convert ${filename} -colorspace Gray x.png', inc).reason, /-colorspace/);
  assert.match(C.mapCommand('convert ${filename} x.bmp', inc).reason, /output format/);
  assert.match(C.mapCommand('ffmpeg -i ${filename} x.mp4', inc).reason, /not an ImageMagick/);
  assert.match(C.mapCommand('convert other.png -resize 1x1 x.png', inc).reason, /input/);
});

test('mapCommand: -define options are kept unless they only hint the JPEG decoder', () => {
  const inc = 'image/.*';
  const r = C.mapCommand('convert ${filename} -define webp:lossless=true -resize 200x200 out.webp', inc);
  assert.strictEqual(r.status, 'custom');
  assert.match(r.reason, /-define webp:lossless=true/);
  assert.strictEqual(C.mapCommand('convert -define jpeg:size=2400x2400 ${filename} -resize 1200x1200 cq5dam.print.1200.1200.jpeg', inc).status, 'mapped');
});

test('mapCommand: a standard rendition name is standard only when the command produces that rendition', () => {
  const inc = 'image/.*';
  assert.strictEqual(C.mapCommand('convert ${filename} -thumbnail 319x319> cq5dam.thumbnail.319.319.png', inc).status, 'standard');
  for (const cmd of ['convert ${filename} -resize 800x800 cq5dam.thumbnail.319.319.png', 'convert ${filename} cq5dam.thumbnail.48.48.png']) {
    const r = C.mapCommand(cmd, inc);
    assert.strictEqual(r.status, 'custom', cmd);
    assert.match(r.reason, /standard rendition/);
  }
  const CLP = 'com.day.cq.dam.core.process.CommandLineProcess';
  const two = C.mapUnsupported({ process: CLP, args: { COMMANDS: '[convert ${filename} -resize 800x800 cq5dam.thumbnail.319.319.png,convert ${filename} -resize 400x400 cq5dam.thumbnail.319.319.png]' } });
  assert.deepStrictEqual(two.map(m => m.status), ['custom', 'custom']);
});

test('mapSteps: a rendition name produced twice is merged when identical and stopped when the settings differ', () => {
  const CLP = 'com.day.cq.dam.core.process.CommandLineProcess';
  const step = (cmds, mimes) => ({ process: CLP, args: { MIME_TYPES: `[${mimes}]`, COMMANDS: `[${cmds.join(',')}]` } });
  const big = 'convert ${filename} -resize 800x800 out.png', small = 'convert ${filename} -resize 400x400 out.png';
  const same = C.mapSteps([step([big], 'image/png'), step([big], 'image/tiff')]);
  assert.deepStrictEqual(same.map(l => l.map(m => m.status)), [['mapped'], ['duplicate']]);
  assert.strictEqual(same[0][0].rendition.include, 'image/png,image/tiff');
  const diff = C.mapSteps([step([big], 'image/png'), step([small], 'image/tiff')]);
  assert.deepStrictEqual(diff.map(l => l.map(m => m.status)), [['mapped'], ['custom']]);
  assert.match(diff[1][0].reason, /already produces out\.png with different settings/);
  assert.deepStrictEqual(C.mapUnsupported(step([big, small], 'image/png')).map(m => m.status), ['mapped', 'custom']);
});

test('mapUnsupported: CommandLineProcess THUMBNAILS map too, and duplicates are reported once', () => {
  const step = { process: 'com.day.cq.dam.core.process.CommandLineProcess', args: { MIME_TYPES: '[image/png]', COMMANDS: '[convert ${filename} -resize 600x600 cq5dam.thumbnail.600.600.png]', THUMBNAILS: '[48:48,600:600:false]' } };
  const r = C.mapUnsupported(step);
  assert.deepStrictEqual(r.map(x => [x.status, x.rendition ? x.rendition.name : x.output]), [['mapped', 'cq5dam.thumbnail.600.600.png'], ['standard', 'cq5dam.thumbnail.48.48.png']]);
  assert.strictEqual(r[0].rendition.include, 'image/png');
  assert.deepStrictEqual(C.mapUnsupported({ process: 'com.day.cq.dam.core.process.GateKeeperProcess', args: {} }), []);
});

test('literalPrefix and foldersFor: launcher globs become folders to attach profiles to', () => {
  assert.deepStrictEqual(F.literalPrefix('/content/dam/wfmin(/.*/)renditions/original'), { folder: '/content/dam/wfmin', exact: false });
  assert.deepStrictEqual(F.literalPrefix('/content/dam/a/b'), { folder: '/content/dam/a/b', exact: true });
  assert.deepStrictEqual(F.literalPrefix('/content/dam/ab.*/x'), { folder: '/content/dam', exact: false });
  const f = F.foldersFor([{ glob: '/content/dam/wfmin(/.*/)renditions/original' }, { glob: '/content/dam/(?!skip)(/.*/)renditions/original' }, { glob: '/content/dam/(a|b)/.*/renditions/original' }]);
  assert.deepStrictEqual(f.map(x => [x.folder, x.subtree, x.wholeDam, x.excludes]), [
    ['/content/dam/wfmin', true, false, []], ['/content/dam', true, true, ['skip']], ['/content/dam', false, false, []],
  ]);
});

test('repoinitScript, renditionXml and jcrSafe produce valid JCR content', () => {
  assert.strictEqual(F.repoinitScript([{ folder: '/content/dam/a', profile: '/conf/p' }]), 'create path /content/dam/a/jcr:content(nt:unstructured)\nset properties on /content/dam/a/jcr:content\n  set processingProfile{String} to "/conf/p"\nend');
  const xml = F.renditionXml({ name: 'x.png', fmt: 'png', wid: null, hei: null, qlt: null, include: 'image/.*' });
  assert.ok(!/wid=/.test(xml) && /includeMimeTypes="image\/\.\*"/.test(xml));
  assert.strictEqual(F.jcrSafe('cq5dam.print.1200.1200.JPEG'), 'cq5dam_print_1200_1200_jpeg');
});

test('runner overlap: sample paths, overlaps and ordering', () => {
  const e = (type, match, model) => ({ type, match, model, raw: `${match}:${model}` });
  assert.strictEqual(I.sampleAssetPath(e('expression', '/content/dam(/.*/)(marketing/seasonal)(/.*)')), '/content/dam/sample/marketing/seasonal/sample');
  assert.strictEqual(I.sampleAssetPath(e('expression', '/content/dam/(a|b)/.*')), '/content/dam/a/sample');
  assert.strictEqual(I.sampleAssetPath(e('path', '/content/dam/a/')), '/content/dam/a/sample');
  const all = e('expression', '/content/dam(/.*)', '/var/m/all');
  const a = e('expression', '/content/dam/a(/.*)', '/var/m/a');
  const other = e('expression', '/content/dam/other-(x|y)/.*', '/var/m/other');
  const b = e('expression', '/content/dam/b(/.*)', '/var/m/b');
  assert.deepStrictEqual(I.orderMostSpecificFirst([all, other, a]), [other, a, all]);
  assert.deepStrictEqual(I.orderMostSpecificFirst([other, b, a]), [other, b, a], 'entries that do not overlap keep their order');
  assert.deepStrictEqual(I.runnerOverlaps([all, a, other]).map(o => [o.narrow.model, o.broad.model, o.mutual]), [['/var/m/a', '/var/m/all', false], ['/var/m/other', '/var/m/all', false]]);
  assert.deepStrictEqual(I.runnerOverlaps([a, e('expression', '/content/dam/a(/.*)', '/var/m/a')]), []);
  assert.strictEqual(I.runnerOverlaps([a, e('path', '/content/dam/a', '/var/m/b')])[0].mutual, true);
});

// ── Report ────────────────────────────────────────────────────────────

test('report: summary, changes by kind, checklist and acknowledged runtime-only models', () => fixed({}, (d, fix) => {
  const pre = I.buildInventory(T.PROJECT); const post = I.buildInventory(d);
  const acks = [...ACKS, '/var/workflow/models/wfmin-legacy'];
  const verify = V.verifyMigration(pre, post, { fix, acknowledge: acks });
  const gate = RUN.gateUnsupported(pre, acks);
  const md = R.renderReport({ pre, post, fix, verify, tool: { version: '0.6.0', ok: true }, opts: {}, gate });
  assert.match(md, /\| Verification \| \*\*PASS\*\* \|/);
  assert.match(md, /wf-migrator 0\.6\.0 — completed/);
  for (const k of ['completed-step', 'non-runnable-steps', 'renditions', 'runner-config', 'model-rename', 'formatting', 'filter-roots', 'runner-order']) assert.ok(md.includes(`### ${R.CHANGES[k]}\n`), k);
  assert.ok(!md.includes(`### ${R.CHANGES['profile-folders']}`));
  assert.doesNotMatch(md, /\bG\d+\b/, 'no internal labels in the report');
  for (const [code, title] of R.CHECKLIST) if (fix.manual.some(m => m.code === code)) assert.ok(md.includes(`**${title}**`), code);
  assert.match(md, /\*\*Re-create deleted runtime-only models\*\*[^\n]*\n {2}- `\/var\/workflow\/models\/wfmin-legacy` _\(acknowledged\)_/);
  assert.match(md, /CommandLineProcess \(commandlineprocess\) removed\.[^\n]*_\(acknowledged\)_/);
  assert.doesNotMatch(md, /warning `overlapping-workflows`/, 'checklist items are not repeated as warnings');
  const failed = R.renderReport({ pre, post, fix, verify: { ok: false, failures: [{ category: 'x', detail: 'y' }], warnings: [] }, tool: { skipped: true } });
  assert.match(failed, /\*\*FAIL\*\* \(1\)/);
  assert.match(failed, /not run \(fix-only\)/);
  assert.match(failed, /- `x`: y/);
}));
