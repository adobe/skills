'use strict';

// Synthetic FileVault (.content.xml) builders for the legacy-component tests.
// Generic content only: no product source and no customer paths or names.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NS = [
  'xmlns:sling="http://sling.apache.org/jcr/sling/1.0"',
  'xmlns:cq="http://www.day.com/jcr/cq/1.0"',
  'xmlns:jcr="http://www.jcp.org/jcr/1.0"',
  'xmlns:nt="http://www.jcp.org/jcr/nt/1.0"',
].join(' ');

const fv = (rootAttrs, inner = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root ${NS}\n    ${rootAttrs}>${inner}</jcr:root>\n`;

const component = superType => fv(`jcr:primaryType="cq:Component" jcr:title="Synthetic" componentGroup="Synthetic"${superType ? ` sling:resourceSuperType="${superType}"` : ''}`);

const RTE_PLUGINS = '<rtePlugins jcr:primaryType="nt:unstructured"><links jcr:primaryType="nt:unstructured" features="*"/></rtePlugins>';

/** Classic (ExtJS) dialog: lives in dialog/.content.xml. */
const classicRteDialog = (extraAttrs = '') => fv('jcr:primaryType="cq:Dialog" xtype="dialog"',
  `<items jcr:primaryType="cq:WidgetCollection"><text jcr:primaryType="cq:Widget" name="./text" xtype="richtext"${extraAttrs}>${RTE_PLUGINS}</text></items>`);

const touchRteDialog = containerType => fv('jcr:primaryType="nt:unstructured" jcr:title="Synthetic" sling:resourceType="cq/gui/components/authoring/dialog"',
  `<content jcr:primaryType="nt:unstructured" sling:resourceType="${containerType}"><items jcr:primaryType="nt:unstructured">`
  + `<text jcr:primaryType="nt:unstructured" name="./text" sling:resourceType="cq/gui/components/authoring/dialog/richtext" useFixedInlineToolbar="{Boolean}true">${RTE_PLUGINS}</text>`
  + '</items></content>');

/** Coral 3 dialog: lives in _cq_dialog/.content.xml. */
const coral3RteDialog = () => touchRteDialog('granite/ui/components/coral/foundation/container');
/** Coral 2 dialog: lives in _cq_dialog/.content.xml. */
const coral2RteDialog = () => touchRteDialog('granite/ui/components/foundation/container');

const coral3TextfieldDialog = () => fv('jcr:primaryType="nt:unstructured" sling:resourceType="cq/gui/components/authoring/dialog"',
  '<content jcr:primaryType="nt:unstructured" sling:resourceType="granite/ui/components/coral/foundation/container"><items jcr:primaryType="nt:unstructured">'
  + '<title jcr:primaryType="nt:unstructured" name="./title" sling:resourceType="granite/ui/components/coral/foundation/form/textfield"/></items></content>');

const clientLibraryFolder = category => fv(`jcr:primaryType="cq:ClientLibraryFolder" categories="[${category}]"`);

/** Write { relPath: content } under <root>/<base>. */
function writeTree(root, base, files) {
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, base, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
}

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else out[f] = fs.readFileSync(f, 'utf8');
    }
  })(dir);
  return out;
}

/** Commit the fixture so `gitStatus` can prove the workspace was not modified. */
function gitInit(root) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  return () => git('status', '--porcelain');
}

module.exports = {
  fv, component, classicRteDialog, coral3RteDialog, coral2RteDialog, coral3TextfieldDialog, clientLibraryFolder,
  writeTree, tmpRoot, snapshot, gitInit,
};
