'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAcsCommonsScan, featureOf } = require('./acs-commons-scan-runner.js');
const { gatherFindings, generateRunbook, renderRunbook, PATTERN_META, CANONICAL_PATTERNS } = require('./runbook-generator.js');

function mkworkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acs-scan-test-'));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

const POM = [
  '<project>',
  '  <properties><acs.version>5.3.4</acs.version></properties>',
  '  <dependencies>',
  '    <dependency>',
  '      <groupId>com.adobe.acs</groupId>',
  '      <artifactId>acs-aem-commons-all</artifactId>',
  '      <version>${acs.version}</version>',
  '      <type>zip</type>',
  '    </dependency>',
  '  </dependencies>',
  '</project>',
].join('\n');

function acsProject() {
  const root = mkworkspace();
  write(root, 'pom.xml', POM);
  write(root, 'core/src/main/java/com/acme/A.java', 'package com.acme;\nimport com.adobe.acs.commons.genericlists.GenericList;\nclass A {}\n');
  write(root, 'core/src/main/java/com/acme/B.java', 'package com.acme;\nimport com.adobe.acs.commons.genericlists.GenericList;\nimport com.adobe.acs.commons.util.ParameterUtil;\nclass B {}\n');
  write(root, 'ui.config/src/main/content/jcr_root/apps/acme/osgiconfig/config/com.adobe.acs.commons.users.impl.EnsureServiceUser~acme.cfg.json', '{ "principalName": "acme-service" }\n');
  const rows = [1, 2, 3].map((i) => `<rule${i} jcr:primaryType="nt:unstructured" sling:resourceType="acs-commons/components/utilities/manage-redirects/redirect-row" source="/old${i}" target="/new${i}"/>`).join('\n');
  write(root, 'ui.content/src/main/content/jcr_root/conf/acme/settings/redirects/.content.xml', `<jcr:root>\n${rows}\n</jcr:root>\n`);
  write(root, 'core/target/classes/Skip.java', 'import com.adobe.acs.commons.mcp.ProcessDefinition;\n');
  write(root, 'node_modules/x/Skip.java', 'import com.adobe.acs.commons.mcp.ProcessDefinition;\n');
  return root;
}

test('acsCommons is a report-only, heuristic content-scan pattern with no BPA tier', () => {
  assert.ok(CANONICAL_PATTERNS.includes('acsCommons'));
  const meta = PATTERN_META.acsCommons;
  assert.strictEqual(meta.strategy, 'content-scan');
  assert.deepStrictEqual(meta.bpaSlugs, []);
  assert.ok(meta.heuristic);
  assert.ok(meta.reportOnly);
  assert.strictEqual(meta.reference, 'references/integrations/acs-commons.md', 'the report-only banner links the pattern\'s own reference');
  assert.match(meta.description, /customer-owned/i);
});

test('runAcsCommonsScan reports the dependency version, resolving a ${property}', () => {
  const res = runAcsCommonsScan(acsProject());
  assert.ok(res.ok);
  const dep = res.rawFindings.find((f) => f.kind === 'dependency');
  assert.strictEqual(dep.version, '5.3.4');
  assert.strictEqual(dep.artifactId, 'acs-aem-commons-all');
  assert.match(dep.snippet, /acs-aem-commons-all 5\.3\.4/);
  assert.match(res.findings.find((f) => /acs-aem-commons-all/.test(f.detail)).detail, /no `cloud` classifier/);
  assert.match(res.findings.find((f) => /acs-aem-commons-all/.test(f.detail)).location, /pom\.xml:6$/);
});

test('runAcsCommonsScan groups Java imports by feature and counts files', () => {
  const res = runAcsCommonsScan(acsProject());
  const lists = res.rawFindings.find((f) => f.kind === 'java' && f.feature === 'genericlists');
  assert.strictEqual(lists.count, 2);
  assert.match(res.findings.find((f) => /Generic Lists/.test(f.detail)).detail, /2 Java file\(s\)/);
  assert.ok(res.rawFindings.some((f) => f.kind === 'java' && f.feature === 'util'));
  assert.ok(!res.rawFindings.some((f) => f.feature === 'mcp'), 'target/ and node_modules/ are skipped');
});

test('runAcsCommonsScan finds ACS OSGi configs and names the feature', () => {
  const res = runAcsCommonsScan(acsProject());
  const cfg = res.rawFindings.find((f) => f.kind === 'osgi-config');
  assert.strictEqual(cfg.feature, 'users');
  assert.match(res.findings.find((f) => /Ensure Service User/.test(f.detail)).detail, /repoinit/);
});

test('runAcsCommonsScan counts redirect rules in content', () => {
  const res = runAcsCommonsScan(acsProject());
  const redirects = res.rawFindings.find((f) => f.kind === 'content' && f.feature === 'redirects');
  assert.strictEqual(redirects.count, 3);
  assert.match(res.findings.find((f) => /Redirect Manager/.test(f.detail)).detail, /3 redirect rule\(s\)/);
});

test('runAcsCommonsScan on a project without ACS Commons is clean', () => {
  const root = mkworkspace();
  write(root, 'pom.xml', '<project><dependencies><dependency><groupId>org.apache.sling</groupId><artifactId>x</artifactId><version>1</version></dependency></dependencies></project>');
  write(root, 'core/src/main/java/com/acme/A.java', 'import org.apache.sling.api.SlingHttpServletRequest;\n');
  const res = runAcsCommonsScan(root);
  assert.deepStrictEqual([res.ok, res.findings.length], [true, 0]);
});

test('featureOf maps packages and PIDs to readable features', () => {
  assert.deepStrictEqual(featureOf('com.adobe.acs.commons.redirects.models.RedirectRule'), { key: 'redirects', label: 'Redirect Manager' });
  assert.strictEqual(featureOf('com.adobe.acs.commons.oak.impl.EnsureOakIndex~acme').label, 'Ensure Oak Index');
  assert.strictEqual(featureOf('com.adobe.acs.commons.somethingnew.Foo').label, 'somethingnew');
});

test('gatherFindings runs the ACS scan and the runbook marks it report-only and customer-owned', async () => {
  const root = acsProject();
  const gathered = await gatherFindings({ workspaceRoot: root, getEffectivePom: () => ({ ok: false, error: 'stub' }) });
  assert.strictEqual(gathered.sourceByPattern.acsCommons, 'content-scan');
  const md = renderRunbook(gathered, { workspaceRoot: root, generatedAt: 'now' });
  const section = md.split('## ACS AEM Commons')[1].split('\n## ')[0];
  assert.match(section, /Report only/);
  assert.match(section, /never upgrades/i);
  assert.match(section, /references\/integrations\/acs-commons\.md/);
  assert.match(section, /acs-aem-commons-all 5\.3\.4/);
  assert.doesNotMatch(section, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'paths are workspace-relative');
});

// BPA rows a CAM/CSV report raises against the ACS AEM Commons bundle itself (shaded
// Guava, its own InputStream use, …), grouped per (BPA pattern, bundle).
const ACS_BUNDLE = 'com.adobe.acs.acs-aem-commons-bundle';
const BPA_WITH_ACS = {
  inputStream: [
    { className: 'acscommons.com.google.common.io.ByteSource', identifier: 'java.io.InputStream', bundle: ACS_BUNDLE },
    { className: 'acscommons.com.google.common.io.Files', identifier: 'java.io.FileInputStream', bundle: ACS_BUNDLE },
    { className: 'com.acme.Upload', identifier: 'java.io.InputStream', bundle: 'com.acme.core' },
  ],
  guavaCache: [{ className: ACS_BUNDLE, identifier: 'custom.guava.cache' }],
};
const noPom = () => ({ ok: false, error: 'stub' });

test('gatherFindings links BPA findings on ACS AEM Commons into the ACS section, one row per BPA pattern and bundle', async () => {
  const root = acsProject();
  const gathered = await gatherFindings({ workspaceRoot: root, preFetchedBpa: BPA_WITH_ACS, getEffectivePom: noPom });
  const linked = gathered.findingsByPattern.acsCommons.filter(f => f.informational);
  assert.strictEqual(linked.length, 2, 'inputStream and guavaCache rows on the ACS bundle');
  const byPattern = Object.fromEntries(linked.map(f => [f.detail.match(/BPA `(\w+)`/)[1], f]));
  assert.strictEqual(byPattern.inputStream.location, ACS_BUNDLE);
  assert.match(byPattern.inputStream.detail, /2 finding\(s\)/);
  assert.match(byPattern.inputStream.detail, /customer-owned/);
  assert.strictEqual(byPattern.guavaCache.location, ACS_BUNDLE);
  assert.ok(!linked.some(f => /com\.acme/.test(f.location + f.detail)), 'customer-code rows are not linked');
  const raw = gathered.rawFindingsByPattern.acsCommons.filter(r => r.kind === 'bpa');
  assert.deepStrictEqual(raw.map(r => r.bpaPattern).sort(), ['guavaCache', 'inputStream']);
  assert.strictEqual(gathered.sourceByPattern.acsCommons, 'content-scan+mcp');
});

test('linked BPA rows are informational: the ACS finding count and the runbook total do not change', async () => {
  const root = acsProject();
  const local = runAcsCommonsScan(root).findings.length;
  const gathered = await gatherFindings({ workspaceRoot: root, preFetchedBpa: BPA_WITH_ACS, getEffectivePom: noPom });
  const actionable = gathered.findingsByPattern.acsCommons.filter(f => !f.informational);
  assert.strictEqual(actionable.length, local, 'BPA rows are already counted under their own pattern');
  const md = renderRunbook(gathered, { workspaceRoot: root, generatedAt: 'now' });
  const section = md.split('## ACS AEM Commons')[1].split('\n## ')[0];
  assert.match(section, new RegExp(`\\*\\*Findings:\\*\\* ${local} \\(\\+2 informational\\)`));
  assert.match(section, /content scan \+ BPA \/ CAM/);
});

test('report-only findings stay out of the runbook totals: there is nothing to migrate in them', async () => {
  const root = acsProject();
  const outputPath = path.join(root, 'runbook.md');
  const res = await generateRunbook({ workspaceRoot: root, outputPath, cachePath: path.join(root, 'runbook.json'), getEffectivePom: noPom });
  assert.ok(res.patternCounts.acsCommons > 0, 'ACS findings are still counted per pattern');
  const migratable = Object.entries(res.patternCounts).filter(([p]) => p !== 'acsCommons');
  assert.strictEqual(res.totalFindings, migratable.reduce((n, [, c]) => n + c, 0));
  assert.match(res.message, new RegExp(`${res.totalFindings} findings across ${migratable.filter(([, c]) => c > 0).length} pattern`));
  const md = fs.readFileSync(outputPath, 'utf8');
  assert.match(md, new RegExp(`\\| Total findings \\| \\*\\*${res.totalFindings}\\*\\* \\|`));
  assert.match(md, /\| ACS AEM Commons \(third-party\) \| report only \|/);
});

test('features ACS documents as incompatible with Cloud Service are named and say so', () => {
  const root = mkworkspace();
  write(root, 'core/src/main/java/com/acme/C.java', 'package com.acme;\nimport com.adobe.acs.commons.oak.EnsureOakIndexManager;\nclass C {}\n');
  write(root, 'ui.config/src/main/content/jcr_root/apps/acme/osgiconfig/config/com.adobe.acs.commons.rewriter.impl.VersionedClientlibsTransformerFactory.cfg.json', '{}\n');
  const { findings } = runAcsCommonsScan(root);
  for (const label of ['Ensure Oak Index', 'Versioned ClientLibs']) {
    const f = findings.find(x => x.detail.startsWith(`${label}:`));
    assert.ok(f, `${label} is recognised`);
    assert.match(f.detail, /not supported on AEM as a Cloud Service/);
  }
});

test('cli: node acs-commons-scan-runner.js <root> prints workspace-relative findings as JSON; no root is exit 2', () => {
  const { spawnSync } = require('child_process');
  const root = acsProject();
  const r = spawnSync(process.execPath, [path.join(__dirname, 'acs-commons-scan-runner.js'), root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.findings.length >= 4);
  assert.ok(out.findings.every((f) => !f.location.startsWith(root)), 'locations are relative to the workspace');
  assert.strictEqual(spawnSync(process.execPath, [path.join(__dirname, 'acs-commons-scan-runner.js')], { encoding: 'utf8' }).status, 2);
});
