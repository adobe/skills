'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planLegacyComponents, renderDryRun, canApply } = require('./legacy-component-planner.js');
const { applyRichTextConversion } = require('./richtext-overlay.js');

const COMP = '<jcr:root jcr:primaryType="cq:Component" jcr:title="Synthetic"/>';

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

// Synthetic, minimal fixtures; layout deliberately not tied to any app path.
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
  const base = path.join(root, 'module/src/main/content/jcr_root/apps/sample/widgets');
  const put = (rel, body) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  put('cfg/.content.xml', COMP);
  put('cfg/dialog/.content.xml', '<root><body xtype="richtext" features="bold,link"><rtePlugins/></body></root>');
  put('ui/.content.xml', COMP);
  put('ui/dialog/.content.xml', '<root sling:resourceType="cq/gui/components/authoring/dialog/richtext"><rtePlugins/></root>');
  put('ui/render.jsp', '<div class="box"><span>static markup</span></div>');
  put('beh/.content.xml', COMP);
  put('beh/dialog/.content.xml', '<root sling:resourceType="cq/gui/components/authoring/dialog/richtext"><rtePlugins/></root>');
  put('beh/render.jsp', '<%@ page import="java.util.List" %>\n<c:if test="${a}"><% slingRequest.getParameter("x"); %></c:if>');
  put('dyn/.content.xml', COMP);
  put('dyn/dialog/.content.xml', '<root sling:resourceType="cq/gui/components/authoring/dialog/richtext"><rtePlugins/></root>');
  put('dyn/render.jsp', '<div title="${model.title}"><jsp:include page="missing.jsp"/></div>');
  put('plain/.content.xml', COMP);
  put('plain/render.jsp', '<%@ page import="java.util.Date" %><% if (true) { %>hi<% } %>');
  return { root, base };
}

test('detects only structural Rich Text candidates and classifies each', async () => {
  const { root } = workspace();
  const plan = await planLegacyComponents(root, { scanWorkspace: true });
  const by = Object.fromEntries(plan.entries.map(e => [e.componentPath.split('/').pop(), e]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['beh', 'cfg', 'dyn', 'ui']);
  assert.strictEqual(by.plain, undefined, 'unrelated JSP must not match');
  assert.strictEqual(by.cfg.richtext.classification, 'configuration-only');
  assert.strictEqual(by.cfg.action, 'convert-richtext-xtype');
  assert.deepStrictEqual(by.cfg.filesToChange.map(f => path.basename(path.dirname(f))), ['dialog']);
  assert.strictEqual(by.ui.richtext.classification, 'custom-jsp-ui');
  assert.strictEqual(by.ui.action, 'needs-user-confirm');
  assert.strictEqual(by.beh.richtext.classification, 'custom-jsp-behavioral');
  assert.strictEqual(by.beh.action, 'manual-review');
  assert.strictEqual(by.dyn.richtext.classification, 'unknown');
  assert.strictEqual(by.dyn.action, 'manual-review');
  for (const e of plan.entries) assert.ok(!e.filesToChange.some(f => f.endsWith('.jsp')));
  assert.match(renderDryRun(plan), /detected customizations/);
});

test('dry-run changes nothing; guarded apply converts only confirmed configuration-only entries', async () => {
  const { root } = workspace();
  const before = snapshot(root);
  const plan = await planLegacyComponents(root, { scanWorkspace: true });
  assert.deepStrictEqual(snapshot(root), before);

  for (const e of plan.entries.filter(e => e.richtext.classification !== 'configuration-only')) {
    assert.strictEqual(canApply(e, true), false);
    assert.strictEqual(applyRichTextConversion(e, root, true).applied.length, 0);
  }
  const cfg = plan.entries.find(e => e.componentPath.endsWith('/cfg'));
  assert.strictEqual(applyRichTextConversion(cfg, root, false).applied.length, 0);
  assert.deepStrictEqual(snapshot(root), before);

  assert.strictEqual(applyRichTextConversion(cfg, root, true).applied.length, 1);
  const after = snapshot(root);
  const changed = Object.keys(after).filter(f => after[f] !== before[f]);
  assert.strictEqual(changed.length, 1);
  assert.match(after[changed[0]], /sling:resourceType="cq\/gui\/components\/authoring\/dialog\/richtext" useFixedInlineToolbar="\{Boolean\}true"/);
  assert.match(after[changed[0]], /<rtePlugins\/>/);
  assert.ok(Object.keys(after).filter(f => f.endsWith('.jsp')).every(f => after[f] === before[f]));
});

test('existing useFixedInlineToolbar blocks conversion; apply never duplicates the attribute', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-tb-'));
  const dir = path.join(root, 'pkg/jcr_root/apps/sample/c/tb');
  fs.mkdirSync(path.join(dir, 'dialog'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.content.xml'), COMP);
  const dialog = path.join(dir, 'dialog/.content.xml');
  fs.writeFileSync(dialog, '<root><text xtype="richtext" useFixedInlineToolbar="{Boolean}false"><rtePlugins/></text></root>');
  const before = snapshot(root);

  const plan = await planLegacyComponents(root, { scanWorkspace: true });
  const e = plan.entries[0];
  assert.strictEqual(e.richtext.classification, 'configuration-only');
  assert.strictEqual(e.action, 'needs-user-confirm');
  assert.match(e.blockedReason, /useFixedInlineToolbar already set/);
  assert.deepStrictEqual(e.filesToChange, []);
  assert.strictEqual(canApply(e, true), false);

  // Even a forged convertible entry must not produce a duplicate attribute.
  const forged = { ...e, action: 'convert-richtext-xtype', blockedReason: null, filesToChange: [path.relative(root, dialog)] };
  assert.strictEqual(applyRichTextConversion(forged, root, true).applied.length, 0);
  assert.deepStrictEqual(snapshot(root), before);
});

test('a parent component never absorbs a nested child component\'s Rich Text evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-nest-'));
  const parent = path.join(root, 'pkg/jcr_root/apps/sample/c/outer');
  const child = path.join(parent, 'inner');
  fs.mkdirSync(path.join(child, 'dialog'), { recursive: true });
  fs.writeFileSync(path.join(parent, '.content.xml'), COMP);
  fs.writeFileSync(path.join(child, '.content.xml'), COMP);
  fs.writeFileSync(path.join(child, 'dialog/.content.xml'), '<root><b xtype="richtext"><rtePlugins/></b></root>');

  const plan = await planLegacyComponents(root, { scanWorkspace: true });
  assert.deepStrictEqual(plan.entries.map(e => e.componentPath.split('/').pop()), ['inner']);
  for (const f of plan.entries[0].filesToChange) assert.ok(f.includes(`${path.sep}inner${path.sep}`));
});
