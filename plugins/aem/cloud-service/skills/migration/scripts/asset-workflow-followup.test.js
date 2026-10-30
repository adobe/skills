'use strict';
// Branch H follow-ups and report, on the recorded wf-migrator output for the fixture project
// (fixtures/asset-workflow.js). The skill never edits the tool's output; it only reads it. No Java needed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');
const F = require('./asset-workflow-followup.js');
const V = require('./asset-workflow-verify.js');
const R = require('./asset-workflow-report.js');
const RUN = require('./asset-workflow-run.js');
const T = require('./fixtures/asset-workflow.js');

const MODELS = '/conf/global/settings/workflow/models';
const CONTENT = 'ui.content/src/main/content';
const MODEL_DIR = `${CONTENT}/jcr_root/conf/global/settings/workflow/models`;
const LAUNCHER_DIR = `${CONTENT}/jcr_root/conf/global/settings/workflow/launcher/config`;
const ACKS = ['CommandLineProcess'];
const ORPHAN = '/var/workflow/models/wfmin-legacy';

const put = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const codes = fu => [...new Set(fu.manual.map(m => m.code))].sort();

function toolRun(fn, { prepare } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awfu-base-')), d = fs.mkdtempSync(path.join(os.tmpdir(), 'awfu-'));
  try {
    T.materializeProject(base); T.materializeToolOutput(d);
    if (prepare) prepare(base, d);
    return fn({ base, d, pre: I.buildInventory(base), post: I.buildInventory(d) });
  } finally { for (const x of [base, d]) fs.rmSync(x, { recursive: true, force: true }); }
}

// ── Tool report ───────────────────────────────────────────────────────

test('parseToolIssues reads the Migration Issues table of the tool report', () => {
  const issues = F.parseToolIssues(T.TOOL_REPORT);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].action, 'Failed');
  assert.strictEqual(issues[0].model, 'update_asset');
  assert.match(issues[0].step, /convert -resize 25% \$\{filename\} cq5dam\.preview-25\.png/);
  assert.match(issues[0].reason, /geometry 25% is not supported/);
  assert.deepStrictEqual(F.parseToolIssues(''), []);
  assert.deepStrictEqual(F.parseToolIssues('## Migration Issues\nNo issues.\n'), []);
});

// ── Follow-ups ────────────────────────────────────────────────────────

test('followUps: one entry per affected workflow, with what the tool kept, removed and profiled', () => toolRun(({ pre, post }) => {
  const fu = F.collectFollowUps({ pre, post, acknowledge: ACKS, toolReport: T.TOOL_REPORT });
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
  const fu = F.collectFollowUps({ pre, post, acknowledge: ACKS, toolReport: T.TOOL_REPORT });
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
    const fu = F.collectFollowUps({ pre, post, acknowledge: acks });
    assert.strictEqual(fu.manual.find(m => m.code === 'unsupported-step-removed').acknowledged, expected, JSON.stringify(acks));
  }
}));

test('followUps: never writes to the project', () => toolRun(({ d, pre, post }) => {
  const before = T.listFiles(d).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]);
  F.collectFollowUps({ pre, post, acknowledge: ACKS, toolReport: T.TOOL_REPORT });
  assert.deepStrictEqual(T.listFiles(d).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]), before);
}));

// ── Workflows the tool does not migrate, and OR splits ────────────────

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
  const fu = F.collectFollowUps({ pre, post, acknowledge: ACKS });
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
  const fu = F.collectFollowUps({ pre, post, acknowledge: ACKS });
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
  const fu = F.collectFollowUps({ pre, post, acknowledge: ACKS });
  assert.ok(!fu.manual.some(m => m.model === ROUTE && m.code === 'or-routing-script-review'));
}, {
  prepare: (base, d) => {
    put(base, ROUTE_MODEL, model(orSplit([STEP_A, STEP_B + NOOP]) + COMPLETED));
    put(base, `${LAUNCHER_DIR}/wfmin-route/.content.xml`, launcher('wfmin-route', true));
    put(d, ROUTE_MODEL, model(orSplit([STEP_A, STEP_B + NOOP]) + COMPLETED));
    put(d, `${LAUNCHER_DIR}/wfmin-route/.content.xml`, launcher('wfmin-route', false));
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────

test('literalPrefix and foldersFor: launcher globs become folders to attach profiles to', () => {
  assert.deepStrictEqual(F.literalPrefix('/content/dam/wfmin(/.*/)renditions/original'), { folder: '/content/dam/wfmin', exact: false });
  assert.deepStrictEqual(F.literalPrefix('/content/dam/a/b'), { folder: '/content/dam/a/b', exact: true });
  assert.deepStrictEqual(F.literalPrefix('/content/dam/ab.*/x'), { folder: '/content/dam', exact: false });
  const f = F.foldersFor([{ glob: '/content/dam/wfmin(/.*/)renditions/original' }, { glob: '/content/dam/(?!skip)(/.*/)renditions/original' }, { glob: '/content/dam/(a|b)/.*/renditions/original' }]);
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

// ── Verification of the tool's output ─────────────────────────────────

test('verify: the tool output passes once removed steps and the runtime-only model are acknowledged', () => toolRun(({ pre, post }) => {
  const fu = F.collectFollowUps({ pre, post, acknowledge: [...ACKS, ORPHAN] });
  const v = V.verifyMigration(pre, post, { followUps: fu, acknowledge: [...ACKS, ORPHAN] });
  assert.ok(v.ok, JSON.stringify(v.failures));
  assert.strictEqual(v.warnings.filter(w => w.category === 'overlapping-workflows').length, 2);
}));

// ── Report ────────────────────────────────────────────────────────────

test('report: summary, tool issues, checklist and acknowledged runtime-only models', () => toolRun(({ pre, post }) => {
  const acks = [...ACKS, ORPHAN];
  const fu = F.collectFollowUps({ pre, post, acknowledge: acks, toolReport: T.TOOL_REPORT });
  const verify = V.verifyMigration(pre, post, { followUps: fu, acknowledge: acks });
  const gate = RUN.gateUnsupported(pre, acks);
  const md = R.renderReport({ pre, post, followUps: fu, verify, tool: { version: RUN.TOOL_VERSION, ok: true }, gate });
  assert.match(md, /\| Verification \| \*\*PASS\*\* \|/);
  assert.match(md, new RegExp(`wf-migrator ${RUN.TOOL_VERSION.replace(/\./g, '\\.')} — completed`));
  assert.match(md, /\| Post-processing workflows \| 3 \|/);
  assert.doesNotMatch(md, /Changes made by this skill/, 'the skill does not change the project');
  for (const [code, title] of R.CHECKLIST) if (fu.manual.some(m => m.code === code)) assert.ok(md.includes(`**${title}**`), code);
  assert.match(md, /\*\*Re-create deleted runtime-only models\*\*[^\n]*\n {2}- `\/var\/workflow\/models\/wfmin-legacy` _\(acknowledged\)_/);
  assert.match(md, /CommandLineProcess \(commandlineprocess\) removed\.[^\n]*_\(acknowledged\)_/);
  assert.doesNotMatch(md, /warning `overlapping-workflows`/, 'checklist items are not repeated as warnings');
  const failed = R.renderReport({ pre, post, followUps: fu, verify: { ok: false, failures: [{ category: 'x', detail: 'y' }], warnings: [] }, tool: { skipped: true } });
  assert.match(failed, /\*\*FAIL\*\* \(1\)/);
  assert.match(failed, /not run \(verify-only\)/);
  assert.match(failed, /- `x`: y/);
}));
