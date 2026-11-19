'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planLegacyComponents, renderDryRun, canApply } = require('./legacy-component-planner.js');
const { applyParsysConversion } = require('./custom-parsys.js');

const PARSYS = 'wcm/foundation/components/parsys';
const comp = (superType) => `<jcr:root jcr:primaryType="cq:Component" sling:resourceSuperType="${superType}"/>`;
const TARGET = 'sample/components/supported-container'; // synthetic, supplied explicitly by the caller

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
  const base = path.join(root, 'pkg/content/jcr_root/apps/sample/components');
  const put = (rel, body) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  put('plain/.content.xml', comp(PARSYS));
  put('cols/.content.xml', comp(`${PARSYS}/colctrl`));
  put('dyn/.content.xml', comp(PARSYS));
  put('dyn/dyn.jsp', '<% new SyntheticResource(r, "x", "y"); %>');
  put('base/.content.xml', comp(PARSYS));
  put('base/base.html', '<div data-sly-resource="${\'a\' @ resourceType=\'wcm/foundation/components/parsys\'}"></div><div data-sly-resource="${\'b\' @ resourceType=\'wcm/foundation/components/parsys\'}"></div>');
  put('nested/.content.xml', comp('sample/components/base'));
  put('nested/clientlibs/.content.xml', '<jcr:root jcr:primaryType="cq:ClientLibraryFolder" categories="[x.y]"/>');
  put('modern/.content.xml', comp('core/wcm/components/container/v1/container'));
  put('modern/modern.html', '<div data-sly-resource="${\'p\' @ resourceType=\'core/wcm/components/container/v1/container\'}"></div>');
  return { root };
}

test('classifies parsys candidates structurally; modern container is not reported', async () => {
  const { root } = workspace();
  const plan = await planLegacyComponents(root, { scanParsys: true });
  const by = Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));
  assert.strictEqual(by.modern, undefined);
  assert.strictEqual(by.plain.parsys.classification, 'plain-legacy-parsys');
  assert.strictEqual(by.cols.parsys.classification, 'custom-column-control');
  assert.strictEqual(by.dyn.parsys.classification, 'custom-virtual-or-dynamic-children');
  assert.strictEqual(by.dyn.action, 'manual-review');
  assert.strictEqual(by.base.parsys.classification, 'custom-layout');
  assert.ok(by.base.parsys.inventory.nestedContainers.length);
  assert.ok(['mixed-custom', 'custom-layout', 'unknown'].includes(by.nested.parsys.classification));
  assert.notStrictEqual(by.nested.action, 'convert-parsys-supertype');
  assert.strictEqual(by.cols.action, 'needs-user-confirm');
  for (const k of ['cols', 'dyn', 'base', 'nested']) {
    assert.strictEqual(by[k].filesToChange.length, 0);
    assert.strictEqual(canApply(by[k], true), false);
  }
  assert.match(renderDryRun(plan), /content-compatibility risk/);
});

test('no target is guessed; content validation gates apply; dry-run writes nothing', async () => {
  const { root } = workspace();
  const before = snapshot(root);

  let plan = await planLegacyComponents(root, { scanParsys: true });
  let plain = plan.entries.find(e => e.componentPath.endsWith('/plain'));
  assert.strictEqual(plain.proposedTarget, null);
  assert.strictEqual(plain.action, 'needs-user-confirm');

  plan = await planLegacyComponents(root, { scanParsys: true, supportedTarget: TARGET });
  plain = plan.entries.find(e => e.componentPath.endsWith('/plain'));
  assert.strictEqual(plain.action, 'needs-content-validation');
  assert.strictEqual(plain.contentCompatibility, 'needs-content-validation');
  assert.strictEqual(canApply(plain, true), false);
  assert.strictEqual(applyParsysConversion(plain, root, true).applied.length, 0);
  assert.deepStrictEqual(snapshot(root), before);

  plan = await planLegacyComponents(root, { scanParsys: true, supportedTarget: TARGET, contentValidated: true });
  plain = plan.entries.find(e => e.componentPath.endsWith('/plain'));
  assert.strictEqual(plain.action, 'convert-parsys-supertype');
  assert.strictEqual(applyParsysConversion(plain, root, false).applied.length, 0);
  assert.deepStrictEqual(snapshot(root), before);
  for (const e of plan.entries.filter(e => e !== plain)) assert.strictEqual(applyParsysConversion(e, root, true).applied.length, 0);
  assert.deepStrictEqual(snapshot(root), before);

  assert.strictEqual(applyParsysConversion(plain, root, true).applied.length, 1);
  const after = snapshot(root);
  const changed = Object.keys(after).filter(f => after[f] !== before[f]);
  assert.strictEqual(changed.length, 1);
  assert.match(after[changed[0]], new RegExp(`sling:resourceSuperType="${TARGET}"`));
});
