'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classify, planLegacyComponents, canApply, renderDryRun } = require('./legacy-component-planner.js');

function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else out[f] = fs.readFileSync(f, 'utf8');
    }
  })(dir);
  return out;
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lcp-'));
  const base = path.join(root, 'ui.apps/src/main/content/jcr_root/apps/demo/components');
  const put = (rel, body) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  put('rte/_cq_dialog/.content.xml', '<x sling:resourceType="cq/gui/components/authoring/dialog/richtext"><rtePlugins/></x>');
  put('par/.content.xml', '<jcr:root sling:resourceSuperType="wcm/foundation/components/parsys"/>');
  put('par2/.content.xml', '<jcr:root sling:resourceSuperType="wcm/foundation/components/parsys"/>');
  put('par2/par2.html', '<div data-sly-use.m="x.Y"></div>');
  put('mystery/.content.xml', '<jcr:root jcr:title="x"/>');
  return root;
}

test('classifies richtext overlay, custom parsys, and unknown', () => {
  assert.strictEqual(classify('/apps/demo/components/a', 'cq/gui/components/authoring/dialog/richtext rtePlugins').classification, 'richtext-overlay');
  assert.strictEqual(classify('/apps/demo/components/a', 'sling:resourceSuperType="wcm/foundation/components/parsys"').classification, 'custom-parsys');
  assert.strictEqual(classify('/apps/demo/components/a', '<x/>').classification, 'unknown');
  assert.strictEqual(classify('/apps/demo/components/a', 'cq/gui/components/authoring/dialog/richtext rtePlugins sling:resourceSuperType="x/parsys"').classification, 'unknown');
});

test('dry-run is read-only, uses getBpaFindings, and gates unknown cases', async () => {
  const root = workspace();
  const before = snapshot(root);
  const calls = [];
  const getBpaFindings = async (pattern, opts) => {
    calls.push([pattern, opts]);
    return { targets: [
      { className: '/apps/demo/components/rte', identifier: 'legacy.custom.component' },
      { className: '/apps/demo/components/par', identifier: 'legacy.custom.component' },
      { className: '/apps/demo/components/par2', identifier: 'legacy.custom.component' },
      { className: '/apps/demo/components/gone', identifier: 'legacy.custom.component' },
      { className: '/apps/demo/components/d', identifier: 'legacy.dialog.classic' },
    ] };
  };
  const plan = await planLegacyComponents(root, {
    getBpaFindings, bpaOptions: { bpaFilePath: 'x.csv' }, extraPaths: ['/apps/demo/components/mystery', '/etc/other'],
  });
  assert.deepStrictEqual(calls[0][0], 'lui');
  assert.strictEqual(plan.entries.length, 6);
  const by = Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));
  assert.strictEqual(by.rte.classification, 'richtext-overlay');
  assert.strictEqual(by.rte.evidenceSource, 'bpa');
  assert.strictEqual(by.par.classification, 'custom-parsys');
  assert.strictEqual(by.par2.action, 'manual-review');
  assert.strictEqual(by.gone.action, 'manual-review');
  assert.strictEqual(by.mystery.action, 'needs-user-confirm');
  assert.strictEqual(by.mystery.evidenceSource, 'heuristic/local-inspection');
  assert.strictEqual(by.other.action, 'needs-user-confirm');
  for (const e of plan.entries.filter(e => e.classification === 'unknown' || e.blockedReason)) assert.strictEqual(canApply(e, true), false);
  assert.strictEqual(canApply(by.rte, false), false);
  assert.strictEqual(canApply(by.rte, true), false, 'no-change is not an applicable action');
  assert.match(renderDryRun(plan), /files that would change/);
  assert.deepStrictEqual(snapshot(root), before);
});

test('end-to-end gates: git-proven immutability, no false findings, unknown cannot apply, no template routing', async () => {
  const { execFileSync } = require('child_process');
  const { applyRichTextConversion } = require('./richtext-overlay.js');
  const { applyParsysConversion } = require('./custom-parsys.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const base = path.join(root, 'pkg/jcr_root/apps/sample/c');
  const put = (rel, body) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  const comp = st => `<r jcr:primaryType="cq:Component"${st ? ` sling:resourceSuperType="${st}"` : ''}/>`;
  put('rtsafe/.content.xml', comp());
  put('rtsafe/dialog/.content.xml', '<r><b xtype="richtext"><rtePlugins/></b></r>');
  put('rtjsp/.content.xml', comp());
  put('rtjsp/dialog/.content.xml', '<r sling:resourceType="cq/gui/components/authoring/dialog/richtext"><rtePlugins/></r>');
  put('rtjsp/render.jsp', '<%@ page import="a.B" %><% if (x) {} %>');
  put('cols/.content.xml', comp('wcm/foundation/components/parsys/colctrl'));
  put('virt/.content.xml', comp('wcm/foundation/components/parsys'));
  put('virt/v.jsp', '<% new SyntheticResource(a, b, c); %>');
  put('other/.content.xml', comp('core/wcm/components/container/v1/container'));
  put('other/render.jsp', '<%@ page import="a.B" %><% if (x) {} %>');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');

  const plan = await planLegacyComponents(root, { scanWorkspace: true, scanParsys: true });
  assert.strictEqual(git('status', '--porcelain'), '', 'dry-run produced a source diff');
  const names = plan.entries.map(e => e.componentPath.split('/').pop()).sort();
  assert.deepStrictEqual(names, ['cols', 'rtjsp', 'rtsafe', 'virt']);
  const by = Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));
  assert.strictEqual(by.rtsafe.action, 'convert-richtext-xtype');
  assert.strictEqual(by.rtjsp.action, 'manual-review');
  assert.strictEqual(by.cols.action, 'needs-user-confirm');
  assert.match(by.virt.action, /manual-review|needs-content-validation/);

  // Forged "unknown" or custom entries can never apply, even when confirmed.
  for (const e of [by.rtjsp, by.cols, by.virt, { ...by.rtsafe, classification: 'unknown', richtext: { classification: 'unknown' } }]) {
    assert.strictEqual(canApply(e, true), false);
    assert.strictEqual(applyRichTextConversion(e, root, true).applied.length, 0);
    assert.strictEqual(applyParsysConversion(e, root, true).applied.length, 0);
  }
  assert.strictEqual(git('status', '--porcelain'), '');

  // Routing boundary: the flow never loads template-modernization code.
  const src = ['legacy-component-planner.js', 'richtext-overlay.js', 'custom-parsys.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  assert.ok(!/template-scan-runner|template-modernization|runTemplate/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.ok(!/unlink|rmSync|rmdirSync/.test(src));
});

test('a coarse signal not confirmed by structural inspection cannot apply', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lcp-coarse-'));
  const dir = path.join(root, 'ui.apps/src/main/content/jcr_root/apps/demo/components/lookalike');
  fs.mkdirSync(dir, { recursive: true });
  // Supertype name ends in "parsys" but does not resolve to the legacy parsys.
  fs.writeFileSync(path.join(dir, '.content.xml'), '<jcr:root jcr:primaryType="cq:Component" sling:resourceSuperType="other/components/myparsys"/>');
  const plan = await planLegacyComponents(root, { extraPaths: ['/apps/demo/components/lookalike'] });
  const e = plan.entries[0];
  assert.strictEqual(e.action, 'needs-user-confirm');
  assert.match(e.blockedReason, /structural inspection did not confirm/);
  assert.deepStrictEqual(e.filesToChange, []);
  assert.strictEqual(canApply(e, true), false);
});
