'use strict';
// Opt-in end-to-end test against the real wf-migrator JAR. Needs Java 11+ and network (or ASSET_WF_JAR).
//   ASSET_WF_E2E=1 node --test asset-workflow-e2e.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkJava, ensureToolInstalled, TOOL_DIR, migrate } = require('./asset-workflow-run.js');

const enabled = process.env.ASSET_WF_E2E === '1';
const skip = !enabled ? 'set ASSET_WF_E2E=1 to run' : !checkJava().ok ? 'Java 11+ not available' : false;

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const PKG = 'ui.content/src/main/content';
const STEP = (name, process) => `<${name} jcr:primaryType="nt:unstructured" jcr:title="${name}" sling:resourceType="cq/workflow/components/model/process">
      <metaData jcr:primaryType="nt:unstructured" PROCESS="${process}" PROCESS_AUTO_ADVANCE="true"/>
    </${name}>`;

function buildProject(root) {
  write(root, 'pom.xml', '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>wfmin</artifactId><version>1.0.0-SNAPSHOT</version><packaging>pom</packaging><modules><module>ui.content</module></modules></project>');
  write(root, 'ui.content/pom.xml', '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>com.example</groupId><artifactId>wfmin</artifactId><version>1.0.0-SNAPSHOT</version></parent><artifactId>wfmin.ui.content</artifactId><packaging>content-package</packaging></project>');
  write(root, `${PKG}/META-INF/vault/filter.xml`, '<?xml version="1.0" encoding="UTF-8"?>\n<workspaceFilter version="1.0">\n  <filter root="/conf/global/settings/workflow"/>\n  <filter root="/var/workflow/models"/>\n</workspaceFilter>\n');
  write(root, `${PKG}/jcr_root/conf/global/settings/workflow/launcher/config/wfmin-campaigns/.content.xml`,
    '<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0"\n  jcr:primaryType="cq:WorkflowLauncher" condition="" conditions="[]" description="WF Min campaigns" enabled="{Boolean}true" eventType="{Long}1"\n  excludeList="event-user-data:changedByWorkflowProcess" glob="/content/dam/(wfmin-campaigns|wfmin-events)/.*/renditions/original" nodetype="nt:file" runModes="author"\n  workflow="/var/workflow/models/wfmin-campaigns"/>\n');
  write(root, `${PKG}/jcr_root/conf/global/settings/workflow/models/wfmin-campaigns/.content.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0"
  jcr:primaryType="cq:Page">
  <jcr:content cq:template="/libs/cq/workflow/templates/model" jcr:primaryType="cq:PageContent" jcr:title="wfmin campaigns" transient="false" sling:resourceType="cq/workflow/components/pages/model">
    <flow jcr:primaryType="nt:unstructured" sling:resourceType="foundation/components/parsys">
      ${STEP('tag', 'com.example.wfmin.core.workflow.TagByFolderProcess')}
      ${STEP('gate', 'com.day.cq.dam.core.process.GateKeeperProcess')}
    </flow>
  </jcr:content>
</jcr:root>
`);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
}

test('the real tool migrates a small project', { skip, timeout: 900000 }, () => {
  let jar = process.env.ASSET_WF_JAR;
  if (!jar) {
    const inst = ensureToolInstalled(TOOL_DIR);
    assert.ok(inst.installed, inst.error);
    jar = inst.jar;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-e2e-'));
  buildProject(root);
  const r = migrate({ root, jar });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.warnings, []);
  assert.ok(fs.statSync(r.reportPath).size > 0, 'migration-report.md is written');
  const files = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.match(files, /aem-cloud-migration/, 'the tool adds its aem-cloud-migration.* modules');
  assert.match(files, /CustomDamWorkflowRunnerImpl\.cfg\.json/, 'the tool writes the post-processing runner config');
});
