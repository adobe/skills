'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { planLegacyComponents, renderDryRun, canApply } = require('./legacy-component-planner.js');
const { applyParsysConversion } = require('./custom-parsys.js');
const fx = require('./fixtures/filevault-fixtures.js');

const PARSYS = 'wcm/foundation/components/parsys';
const TARGET = 'sample/components/supported-container'; // synthetic, supplied explicitly by the caller
const BASE = 'pkg/content/jcr_root/apps/sample/components';

function workspace() {
  const root = fx.tmpRoot('ps-');
  fx.writeTree(root, BASE, {
    // 1. Plain parsys (with an ordinary Coral 3 dialog and an edit config).
    'plain/.content.xml': fx.component(PARSYS),
    'plain/_cq_dialog/.content.xml': fx.coral3TextfieldDialog(),
    'plain/_cq_editConfig.xml': fx.fv('jcr:primaryType="cq:EditConfig" cq:actions="[edit,delete]"'),
    // /libs-prefixed supertype is the same legacy parsys.
    'libspar/.content.xml': fx.component(`/libs/${PARSYS}`),
    // 2. Column control.
    'cols/.content.xml': fx.component(`${PARSYS}/colctrl`),
    // 3. Virtual/dynamic children.
    'dyn/.content.xml': fx.component(PARSYS),
    'dyn/dyn.jsp': '<% Resource r = new SyntheticResource(resolver, path, type); %>\n',
    // 4. Nested/custom parsys: base includes two parsys, child inherits it and adds a clientlib.
    'base/.content.xml': fx.component(PARSYS),
    'base/base.html': '<div data-sly-resource="${\'a\' @ resourceType=\'wcm/foundation/components/parsys\'}"></div>\n'
      + '<div data-sly-resource="${\'b\' @ resourceType=\'wcm/foundation/components/parsys\'}"></div>\n',
    'nested/.content.xml': fx.component('sample/components/base'),
    'nested/clientlibs/.content.xml': fx.clientLibraryFolder('sample.nested'),
    // 5. Unrelated modern container.
    'modern/.content.xml': fx.component('core/wcm/components/container/v1/container'),
    'modern/modern.html': '<div data-sly-resource="${\'p\' @ resourceType=\'core/wcm/components/container/v1/container\'}"></div>\n',
  });
  return root;
}

const byName = plan => Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));

test('Parsys: structural classification; custom cases never replaced; modern container not reported', async () => {
  const root = workspace();
  const plan = await planLegacyComponents(root, { scanParsys: true, supportedTarget: TARGET, contentValidated: true, policiesMapped: true });
  const by = byName(plan);
  assert.strictEqual(by.modern, undefined);
  assert.strictEqual(by.plain.parsys.classification, 'plain-legacy-parsys', 'dialog sling:resourceType is not an override');
  assert.deepStrictEqual(by.plain.parsys.inventory.editConfigFiles, ['_cq_editConfig.xml']);
  assert.strictEqual(by.libspar.parsys.classification, 'plain-legacy-parsys', '/libs-prefixed supertype is detected');
  assert.strictEqual(by.cols.parsys.classification, 'custom-column-control');
  assert.strictEqual(by.cols.action, 'needs-user-confirm');
  assert.strictEqual(by.dyn.parsys.classification, 'custom-virtual-or-dynamic-children');
  assert.strictEqual(by.dyn.action, 'manual-review');
  assert.strictEqual(by.base.parsys.classification, 'custom-layout');
  assert.ok(by.base.parsys.inventory.nestedContainers.length);
  assert.notStrictEqual(by.nested.action, 'convert-parsys-supertype');
  for (const k of ['cols', 'dyn', 'base', 'nested']) {
    assert.deepStrictEqual(by[k].filesToChange, []);
    assert.strictEqual(canApply(by[k], true), false);
    assert.strictEqual(applyParsysConversion(by[k], root, true).applied.length, 0);
  }
  assert.match(renderDryRun(plan), /content-compatibility risk: .*policy mapping/);
});

test('Parsys: no target guessed; content and policy gates block apply; dry-run leaves no git diff', async () => {
  const root = workspace();
  const status = fx.gitInit(root);
  const plain = async opts => byName(await planLegacyComponents(root, { scanParsys: true, ...opts })).plain;

  let e = await plain({});
  assert.strictEqual(e.proposedTarget, null);
  assert.strictEqual(e.action, 'needs-user-confirm');

  e = await plain({ supportedTarget: TARGET });
  assert.strictEqual(e.action, 'needs-content-validation');
  assert.strictEqual(canApply(e, true), false);

  e = await plain({ supportedTarget: TARGET, contentValidated: true });
  assert.strictEqual(e.action, 'needs-policy-mapping');
  assert.strictEqual(e.policyCompatibility, 'needs-policy-mapping');
  assert.match(e.blockedReason, /_cq_editConfig\.xml/);
  assert.strictEqual(canApply(e, true), false);
  assert.strictEqual(applyParsysConversion(e, root, true).applied.length, 0);
  assert.strictEqual(status(), '');

  e = await plain({ supportedTarget: TARGET, contentValidated: true, policiesMapped: true });
  assert.strictEqual(e.action, 'convert-parsys-supertype');
  assert.strictEqual(canApply(e, false), false);
  assert.strictEqual(applyParsysConversion(e, root, false).applied.length, 0);
  assert.strictEqual(status(), '');

  // Forged paths outside the workspace or to non-.content.xml files are ignored.
  const forged = { ...e, filesToChange: ['../outside/.content.xml', path.join(BASE, 'dyn/dyn.jsp')] };
  assert.strictEqual(applyParsysConversion(forged, root, true).applied.length, 0);
  assert.strictEqual(status(), '');

  assert.strictEqual(applyParsysConversion(e, root, true).applied.length, 1);
  assert.strictEqual(status(), ` M ${BASE}/plain/.content.xml\n`);
});
