'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planLegacyComponents, canApply, renderDryRun } = require('./legacy-component-planner.js');
const richtext = require('./richtext-overlay.js');
const fx = require('./fixtures/filevault-fixtures.js');

const APPS = 'ui.apps/src/main/content/jcr_root/apps';

function workspace() {
  const root = fx.tmpRoot('rt-');
  fx.writeTree(root, `${APPS}/sample/components`, {
    // 1. Declarative Classic Rich Text dialog → hand off to convert-extjs.
    'classic/.content.xml': fx.component(),
    'classic/dialog/.content.xml': fx.classicRteDialog(),
    // Coral 2 Rich Text dialog → hand off to upgrade-coral2.
    'coraltwo/.content.xml': fx.component(),
    'coraltwo/_cq_dialog/.content.xml': fx.coral2RteDialog(),
    // 2. Component script named after the component (Sling default) with import + condition.
    'named/.content.xml': fx.component(),
    'named/dialog/.content.xml': fx.classicRteDialog(),
    'named/named.jsp': '<%@ page import="org.example.Helper" %>\n<% if (slingRequest.getParameter("mode") != null) { %><p>on</p><% } %>\n',
    // Static JSP markup only.
    'staticjsp/.content.xml': fx.component(),
    'staticjsp/_cq_dialog/.content.xml': fx.coral3RteDialog(),
    'staticjsp/staticjsp.jsp': '<div class="text"><p>static</p></div>\n',
    // 3. Dynamic/unknown JSP behavior.
    'dyn/.content.xml': fx.component(),
    'dyn/_cq_dialog/.content.xml': fx.coral3RteDialog(),
    'dyn/dyn.jsp': '<div data-x="${properties.value}"><jsp:include page="missing.jsp"/></div>\n',
    // Custom RTE plugin code next to a Classic dialog.
    'plugin/.content.xml': fx.component(),
    'plugin/dialog/.content.xml': fx.classicRteDialog(),
    'plugin/clientlibs/.content.xml': fx.clientLibraryFolder('sample.rte'),
    'plugin/clientlibs/plugin.js': 'CUI.rte.plugins.PluginRegistry.register("sample", function () {});\n',
    // 4. Unrelated JSP (no Rich Text) and a compliant Coral 3 + HTL text component.
    'unrelated/.content.xml': fx.component(),
    'unrelated/unrelated.jsp': '<%@ page import="org.example.Other" %><% if (true) { %>x<% } %>\n',
    'modern/.content.xml': fx.component('core/wcm/components/text/v2/text'),
    'modern/_cq_dialog/.content.xml': fx.coral3RteDialog(),
    'modern/modern.html': '<div data-sly-text="${properties.text}"></div>\n',
    // Nested component boundary: only the inner component is a candidate.
    'outer/.content.xml': fx.component(),
    'outer/inner/.content.xml': fx.component(),
    'outer/inner/dialog/.content.xml': fx.classicRteDialog(),
  });
  // Product overlay of a /libs Rich Text path with script behavior.
  fx.writeTree(root, `${APPS}/cq/gui/components/authoring/dialog/richtext`, {
    '.content.xml': fx.fv('jcr:primaryType="nt:unstructured"'),
    'richtext.jsp': '<%@ page import="org.example.Helper" %>\n<% out.print(Helper.value()); %>\n',
  });
  return root;
}

const byName = plan => Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));

test('Rich Text: structural detection, classification, and handoff to the dialog converter', async () => {
  const root = workspace();
  const plan = await planLegacyComponents(root, { scanWorkspace: true });
  const by = byName(plan);

  assert.deepStrictEqual(Object.keys(by).sort(), ['classic', 'coraltwo', 'dyn', 'inner', 'named', 'plugin', 'richtext', 'staticjsp']);
  assert.strictEqual(by.unrelated, undefined, 'JSP without Rich Text evidence must not match');
  assert.strictEqual(by.modern, undefined, 'Coral 3 Rich Text rendered by HTL is already supported');
  assert.strictEqual(by.outer, undefined, 'parent must not absorb nested component evidence');

  assert.strictEqual(by.classic.richtext.classification, 'configuration-only');
  assert.strictEqual(by.classic.action, 'handoff-convert-extjs');
  assert.deepStrictEqual(by.classic.handoff.dialogs.map(h => [h.action, path.basename(path.dirname(h.dialog))]), [['convert-extjs', 'dialog']]);
  assert.strictEqual(by.coraltwo.action, 'handoff-upgrade-coral2');

  assert.strictEqual(by.named.richtext.classification, 'custom-jsp-behavioral', '<name>.jsp must be inspected, not only render.jsp');
  assert.deepStrictEqual(by.named.richtext.customizations.jspFiles, ['named.jsp']);
  assert.strictEqual(by.named.action, 'manual-review');
  assert.strictEqual(by.staticjsp.richtext.classification, 'custom-jsp-ui');
  assert.strictEqual(by.staticjsp.action, 'needs-user-confirm');
  assert.strictEqual(by.dyn.richtext.classification, 'unknown');
  assert.strictEqual(by.dyn.action, 'manual-review');
  assert.strictEqual(by.plugin.action, 'needs-user-confirm');
  assert.deepStrictEqual(by.plugin.richtext.customizations.customRtePlugins, [path.join('clientlibs', 'plugin.js')]);

  assert.strictEqual(by.richtext.componentPath, '/apps/cq/gui/components/authoring/dialog/richtext');
  assert.strictEqual(by.richtext.richtext.customizations.overlay.libsPath, '/libs/cq/gui/components/authoring/dialog/richtext');
  assert.strictEqual(by.richtext.action, 'manual-review');
  assert.match(by.richtext.risk, /\/libs is immutable/);

  for (const e of plan.entries) {
    assert.deepStrictEqual(e.filesToChange, [], `${e.componentPath}: the Rich Text flow never edits files`);
    assert.strictEqual(canApply(e, true), false);
  }
  assert.match(renderDryRun(plan), /handoff: references\/legacy-ui\/dialog\/context\.md: convert-extjs/);
});

test('Rich Text: dry-run leaves no git diff and the module exposes no apply path', async () => {
  const root = workspace();
  const status = fx.gitInit(root);
  await planLegacyComponents(root, { scanWorkspace: true });
  assert.strictEqual(status(), '');
  assert.strictEqual(richtext.applyRichTextConversion, undefined);
});

test('Rich Text: a BPA-reported /libs overlay is inventoried via the real BPA parser', async () => {
  const root = workspace();
  const csv = path.join(root, 'bpa.csv');
  fs.writeFileSync(csv, [
    'code,type,subtype,importance,identifier,message,context',
    'LUI,legacy.user.interface,legacy.custom.component,MAJOR,/apps/cq/gui/components/authoring/dialog/richtext,Overlay,ctx',
  ].join('\n') + '\n');
  const log = console.log;
  console.log = () => {};
  let plan;
  try {
    plan = await planLegacyComponents(root, { bpaOptions: { bpaFilePath: csv, collectionsDir: fx.tmpRoot('uc-'), limit: null, offset: 0 } });
  } finally { console.log = log; }
  assert.strictEqual(plan.entries.length, 1);
  const e = plan.entries[0];
  assert.strictEqual(e.evidenceSource, 'bpa');
  assert.strictEqual(e.classification, 'richtext-overlay');
  assert.strictEqual(e.richtext.classification, 'custom-jsp-behavioral');
  assert.ok(e.richtext.customizations.overlay);
  assert.strictEqual(e.action, 'manual-review');
});
