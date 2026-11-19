'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const planner = require('./legacy-component-planner.js');
const { classify, planLegacyComponents, canApply, renderDryRun, main, CONTEXT_FILE } = planner;
const { applyParsysConversion } = require('./custom-parsys.js');
const fx = require('./fixtures/filevault-fixtures.js');

const APPS = 'ui.apps/src/main/content/jcr_root/apps';
const PARSYS = 'wcm/foundation/components/parsys';

function workspace() {
  const root = fx.tmpRoot('lcp-');
  fx.writeTree(root, `${APPS}/demo/components`, {
    'rte/.content.xml': fx.component(),
    'rte/dialog/.content.xml': fx.classicRteDialog(),
    'par/.content.xml': fx.component(PARSYS),
    'par2/.content.xml': fx.component(PARSYS),
    'par2/par2.html': '<div data-sly-use.model="org.example.Model"></div>\n',
    'mystery/.content.xml': fx.component(),
    'lookalike/.content.xml': fx.component('other/components/myparsys'),
    'unrelated/.content.xml': fx.component('core/wcm/components/container/v1/container'),
    'unrelated/unrelated.jsp': '<%@ page import="org.example.B" %><% if (x) {} %>\n',
    'virt/.content.xml': fx.component(PARSYS),
    'virt/virt.jsp': '<% new SyntheticResource(resolver, path, type); %>\n',
    'cols/.content.xml': fx.component(`${PARSYS}/colctrl`),
  });
  return root;
}

const byName = plan => Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));
const quiet = async fn => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test('coarse classifier: richtext, parsys, conflicting and unknown', () => {
  assert.strictEqual(classify('/apps/demo/components/a', 'xtype="richtext" rtePlugins').classification, 'richtext-overlay');
  assert.strictEqual(classify('/apps/demo/components/a', `sling:resourceSuperType="${PARSYS}"`).classification, 'custom-parsys');
  assert.strictEqual(classify('/apps/demo/components/a', '<x/>').classification, 'unknown');
  assert.strictEqual(classify('/apps/demo/components/a', 'xtype="richtext" rtePlugins sling:resourceSuperType="x/parsys"').classification, 'unknown');
});

test('BPA + extra paths: structural inspection first, unknown and missing cases gated', async () => {
  const root = workspace();
  const calls = [];
  const getBpaFindings = async (pattern, opts) => {
    calls.push([pattern, opts]);
    return { targets: ['rte', 'par', 'par2', 'gone', 'lookalike'].map(n => ({ className: `/apps/demo/components/${n}`, identifier: 'legacy.custom.component' }))
      .concat([{ className: '/apps/demo/components/d', identifier: 'legacy.dialog.classic' }]) };
  };
  const plan = await planLegacyComponents(root, {
    getBpaFindings, bpaOptions: { bpaFilePath: 'x.csv' }, extraPaths: ['/apps/demo/components/mystery', '/etc/other'],
  });
  assert.strictEqual(calls[0][0], 'lui');
  assert.strictEqual(plan.entries.length, 7, 'legacy.dialog.classic is left to the dialog flow');
  const by = byName(plan);
  assert.strictEqual(by.rte.classification, 'richtext-overlay');
  assert.strictEqual(by.rte.action, 'handoff-convert-extjs');
  assert.strictEqual(by.rte.evidenceSource, 'bpa');
  assert.strictEqual(by.par.classification, 'custom-parsys');
  assert.strictEqual(by.par2.action, 'manual-review');
  assert.strictEqual(by.gone.action, 'manual-review');
  assert.strictEqual(by.lookalike.action, 'needs-user-confirm');
  assert.match(by.lookalike.blockedReason, /structural inspection did not confirm/);
  assert.strictEqual(by.mystery.action, 'needs-user-confirm');
  assert.strictEqual(by.mystery.evidenceSource, 'heuristic/local-inspection');
  assert.strictEqual(by.other.action, 'needs-user-confirm');
  for (const e of plan.entries) assert.strictEqual(canApply(e, true), false);
  assert.match(renderDryRun(plan), /files that would change/);
});

test('end-to-end gates: git-proven immutability, no false findings, unknown cannot apply, no template routing', async () => {
  const root = workspace();
  const status = fx.gitInit(root);
  const plan = await planLegacyComponents(root, { scanWorkspace: true, scanParsys: true });
  assert.strictEqual(status(), '', 'dry-run produced a source diff');
  const by = byName(plan);
  assert.deepStrictEqual(Object.keys(by).sort(), ['cols', 'par', 'par2', 'rte', 'virt']);
  assert.strictEqual(by.cols.action, 'needs-user-confirm');
  assert.strictEqual(by.virt.action, 'manual-review');

  const forgedUnknown = { ...by.par, parsys: { ...by.par.parsys, classification: 'unknown' }, action: 'convert-parsys-supertype', proposedTarget: 'x/y', contentCompatibility: 'established', policyCompatibility: 'established', blockedReason: null, filesToChange: [path.join(APPS, 'demo/components/par/.content.xml')] };
  for (const e of [by.rte, by.cols, by.virt, by.par2, forgedUnknown]) {
    assert.strictEqual(applyParsysConversion(e, root, true).applied.length, 0);
  }
  assert.strictEqual(status(), '');

  const src = ['legacy-component-planner.js', 'richtext-overlay.js', 'custom-parsys.js']
    .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).join('\n');
  assert.ok(!/template-scan-runner|template-modernization|runTemplate/.test(src), 'no template-branch code path');
  assert.ok(!/unlink|rmSync|rmdirSync/.test(src), 'no delete operations');
});

test('CLI: default dry-run writes nothing; --write-context writes only the plan file', async () => {
  const root = workspace();
  const status = fx.gitInit(root);
  const out = [];
  const io = { out: s => out.push(s), err: () => {} };
  assert.strictEqual(await quiet(() => main([root], io)), 0);
  assert.match(out.join(''), /# Legacy component dry-run/);
  assert.strictEqual(status(), '');

  out.length = 0;
  assert.strictEqual(await quiet(() => main([root, '--json'], io)), 0);
  assert.ok(JSON.parse(out.join('')).entries.length > 0);

  assert.strictEqual(await quiet(() => main([root, '--write-context'], io)), 0);
  assert.strictEqual(status(), `?? ${path.dirname(CONTEXT_FILE)}/\n`);
  const yml = fs.readFileSync(path.join(root, CONTEXT_FILE), 'utf8');
  assert.match(yml, /\n {2}- componentPath: "\/apps\/demo\/components\/cols"\n/);
  assert.match(yml, /userConfirmed: false/);
});

test('CLI: --apply needs --confirm and every gate; applies exactly one plain Parsys', async () => {
  const root = workspace();
  const status = fx.gitInit(root);
  const err = [];
  const io = { out: () => {}, err: s => err.push(s) };
  const par = '/apps/demo/components/par';
  const gates = ['--target', 'demo/components/supported-container', '--content-validated', '--policies-mapped'];

  assert.strictEqual(await quiet(() => main([root, '--apply', par, ...gates], io)), 2);
  assert.match(err.join(''), /--confirm is required/);
  assert.strictEqual(await quiet(() => main([root, '--apply', par, '--confirm', '--target', 'x/y', '--content-validated'], io)), 2);
  assert.strictEqual(await quiet(() => main([root, '--apply', '/apps/demo/components/rte', '--confirm', ...gates], io)), 2);
  assert.strictEqual(await quiet(() => main([root, '--apply', '/apps/demo/components/cols', '--confirm', ...gates], io)), 2);
  assert.strictEqual(status(), '');

  assert.strictEqual(await quiet(() => main([root, '--apply', par, '--confirm', ...gates], io)), 0);
  assert.strictEqual(status(), ` M ${APPS}/demo/components/par/.content.xml\n`);
});
