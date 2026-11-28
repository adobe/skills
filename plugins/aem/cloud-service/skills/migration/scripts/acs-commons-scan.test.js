'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAcsCommonsScan, featureOf, isAcsCommonsName } = require('./acs-commons-scan-runner.js');
const { gatherFindings, generateRunbook, renderRunbook, PATTERN_META, CANONICAL_PATTERNS } = require('./runbook-generator.js');
const { getBpaFindings } = require('./bpa-findings-helper.js');

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

test('acsCommons is a report-only pattern: BPA first, an empty BPA result is not clean, the local scan always adds repo usage', () => {
  assert.ok(CANONICAL_PATTERNS.includes('acsCommons'));
  const meta = PATTERN_META.acsCommons;
  assert.strictEqual(meta.strategy, 'content-scan');
  assert.deepStrictEqual(meta.bpaSlugs, ['acsCommons']);
  assert.ok(meta.bpaIncomplete, 'CAM returns no ACS rows, so zero BPA rows must not read as clean');
  assert.ok(meta.unionLocal);
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

// A container pom whose ACS dependency gets its version and classifier from elsewhere.
const ACS_DEP = (inner) => `<project><dependencies><dependency><groupId>com.adobe.acs</groupId><artifactId>acs-aem-commons-all</artifactId>${inner}</dependency></dependencies></project>`;
const PARENT_POM = '<project><dependencyManagement><dependencies><dependency><groupId>com.adobe.acs</groupId><artifactId>acs-aem-commons-all</artifactId><version>6.17.4</version><classifier>cloud</classifier><type>zip</type></dependency></dependencies></dependencyManagement></project>';
const allDetail = (root, rel) => runAcsCommonsScan(root).findings.find((f) => f.location.startsWith(path.join(root, rel))).detail;

test('a dependency whose version and classifier are managed in another pom is not flagged as missing `cloud`', () => {
  const root = mkworkspace();
  write(root, 'pom.xml', PARENT_POM);
  write(root, 'all/pom.xml', ACS_DEP('<type>zip</type>'));
  const detail = allDetail(root, 'all/pom.xml');
  assert.doesNotMatch(detail, /no `cloud` classifier/);
  assert.match(detail, /managed outside this pom: confirm .*`cloud`/);
});

test('a classifier set by a property this pom does not define is reported as unknown, not missing', () => {
  const root = mkworkspace();
  write(root, 'all/pom.xml', ACS_DEP('<version>6.17.4</version><classifier>${acs.classifier}</classifier><type>zip</type>'));
  const detail = allDetail(root, 'all/pom.xml');
  assert.doesNotMatch(detail, /no `cloud` classifier/);
  assert.match(detail, /`\$\{acs\.classifier\}` is set outside this pom/);
});

test('a FileVault <embedded> entry is not a second finding: the dependency carries version and classifier', () => {
  const root = mkworkspace();
  write(root, 'all/pom.xml', `<project><build><plugins><plugin><configuration><embeddeds><embedded><groupId>com.adobe.acs</groupId><artifactId>acs-aem-commons-all</artifactId><target>/apps/acme-vendor-packages/container/install</target></embedded></embeddeds></configuration></plugin></plugins></build>${ACS_DEP('<version>6.17.4</version><classifier>cloud</classifier><type>zip</type>').replace('<project>', '').replace('</project>', '')}</project>`);
  const deps = runAcsCommonsScan(root).findings.filter((f) => /acs-aem-commons-all/.test(f.detail));
  assert.strictEqual(deps.length, 1);
  assert.doesNotMatch(deps[0].detail, /cloud` classifier:|confirm/);
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

// ── BPA first: ACS AEM Commons rows of a BPA CSV (installed artifacts and findings of any code) ──

const BPA_HEADER = 'code,type,subtype,importance,identifier,other,message,moreInfo,context';
const BPA_ACS_ROWS = [
  'INST,installed.artifact,custom.bundle,INFO,com.adobe.acs.acs-aem-commons-bundle,\\N,The com.adobe.acs.acs-aem-commons-bundle custom bundle was detected.,https://www.adobe.com/go/aem_pd_INST,"{""data"":{""symbolicName"":""com.adobe.acs.acs-aem-commons-bundle"",""state"":""ACTIVE"",""version"":""4.3.4""},""type"":""custom.bundle""}"',
  'INST,installed.artifact,custom.package,INFO,adobe/consulting:acs-aem-commons-content:4.1.0,\\N,The adobe/consulting:acs-aem-commons-content:4.1.0 custom package was detected.,https://www.adobe.com/go/aem_pd_INST,"{""data"":{""canonicalId"":""adobe/consulting:acs-aem-commons-content:4.1.0""},""type"":""custom.package""}"',
  'INST,installed.artifact,custom.bundle,INFO,com.acme.core,\\N,The com.acme.core custom bundle was detected.,https://www.adobe.com/go/aem_pd_INST,"{""data"":{""symbolicName"":""com.acme.core"",""state"":""ACTIVE"",""version"":""1.0.0""},""type"":""custom.bundle""}"',
  'CAV,content.area.violation,\\N,MAJOR,/apps/acs-commons/components/authoring/graphiciconselect,/libs/granite/ui/components/foundation/form/select,The path violates content areas.,https://www.adobe.com/go/aem_pd_CAV,\\N',
  'CAV,content.area.violation,\\N,MAJOR,/apps/acs-commons/components/content/audio/cq:dialog/content/items,/libs/granite/ui/components/foundation/container/items,The path violates content areas.,https://www.adobe.com/go/aem_pd_CAV,\\N',
  'LUI,legacy.user.interface,legacy.dialog.classic,MAJOR,/apps/acs-commons/components/utilities/sitemap/dialog,\\N,A classic dialog was found.,https://www.adobe.com/go/aem_pd_LUI,\\N',
  'LUI,legacy.user.interface,legacy.dialog.classic,MAJOR,/apps/acme/components/teaser/dialog,\\N,A classic dialog was found.,https://www.adobe.com/go/aem_pd_LUI,\\N',
  '_COUNT_INST,_count.installed.artifact,custom.bundle,INFO,3,\\N,Count: 3,\\N,"{""data"": {""unfilteredTotal"": 3}}"',
];
function bpaCsv(root, rows = BPA_ACS_ROWS) {
  return write(root, 'bpa.csv', `${[BPA_HEADER, ...rows].join('\n')}\n`);
}

test('getBpaFindings(acsCommons) returns the ACS AEM Commons rows of any BPA code, with version and state', async () => {
  const root = mkworkspace();
  const res = await getBpaFindings('acsCommons', { bpaFilePath: bpaCsv(root), collectionsDir: path.join(root, 'uc'), limit: null, offset: 0 });
  assert.ok(res.success, res.error);
  const ids = res.targets.map(t => t.className).sort();
  assert.deepStrictEqual(ids, [
    '/apps/acs-commons/components/authoring/graphiciconselect',
    '/apps/acs-commons/components/content/audio/cq:dialog/content/items',
    '/apps/acs-commons/components/utilities/sitemap/dialog',
    'adobe/consulting:acs-aem-commons-content:4.1.0',
    'com.adobe.acs.acs-aem-commons-bundle',
  ], 'customer rows and summary rows are not ACS rows');
  const bundle = res.targets.find(t => t.className === 'com.adobe.acs.acs-aem-commons-bundle');
  assert.strictEqual(bundle.code, 'INST');
  assert.strictEqual(bundle.version, '4.3.4');
  assert.strictEqual(bundle.state, 'ACTIVE');
  assert.strictEqual(res.targets.find(t => t.className.startsWith('adobe/consulting')).version, '4.1.0');
});

test('with a BPA CSV the ACS section lists the installed artifacts and one row per BPA code, plus the repo usage', async () => {
  const root = acsProject();
  const gathered = await gatherFindings({ workspaceRoot: root, bpaFilePath: bpaCsv(root), collectionsDir: path.join(root, 'uc'), getEffectivePom: noPom });
  const rows = gathered.findingsByPattern.acsCommons;
  const bundle = rows.find(f => f.location === 'com.adobe.acs.acs-aem-commons-bundle');
  assert.match(bundle.detail, /installed bundle 4\.3\.4 \(ACTIVE\)/);
  assert.match(rows.find(f => f.location === 'adobe/consulting:acs-aem-commons-content:4.1.0').detail, /installed package 4\.1\.0/);
  assert.match(rows.find(f => /BPA `CAV`/.test(f.detail)).detail, /2 finding\(s\)/);
  assert.match(rows.find(f => /BPA `LUI`/.test(f.detail)).detail, /1 finding\(s\)/);
  assert.ok(rows.some(f => /Generic Lists/.test(f.detail)), 'the local scan still adds the repo usage');
  assert.ok(!rows.some(f => /com\.acme/.test(f.location)), 'customer bundles are not ACS rows');
  assert.strictEqual(rows.filter(f => /BPA `LUI`/.test(f.detail)).length, 1, 'no second row from the cross-pattern link');
  assert.strictEqual(gathered.sourceByPattern.acsCommons, 'csv+content-scan');
  assert.ok(!rows.some(f => /ACS Commons filter/.test(f.detail)), 'an unfiltered export has no filter row');
});

test('a BPA source without ACS rows (CAM today) does not mark ACS clean: the local scan runs', async () => {
  const root = acsProject();
  const gathered = await gatherFindings({ workspaceRoot: root, preFetchedBpa: { scheduler: [] }, getEffectivePom: noPom });
  assert.ok(gathered.findingsByPattern.acsCommons.some(f => /Generic Lists/.test(f.detail)));
  assert.strictEqual(gathered.sourceByPattern.acsCommons, 'content-scan');
});

test('the cross-pattern BPA link also recognises /apps/acs-commons paths', async () => {
  const root = acsProject();
  const preFetchedBpa = { lui: [{ className: '/apps/acs-commons/components/utilities/sitemap/dialog', identifier: 'legacy.dialog.classic' }] };
  const gathered = await gatherFindings({ workspaceRoot: root, preFetchedBpa, getEffectivePom: noPom });
  assert.ok(gathered.findingsByPattern.acsCommons.some(f => f.informational && /BPA `lui`/.test(f.detail)));
});

test('names match ACS AEM Commons only, like the BPA ACS Commons filter: not ACS AEM Tools', () => {
  for (const name of ['com.adobe.acs.acs-aem-commons-bundle', 'adobe/consulting:acs-aem-commons-content:4.1.0', 'com.adobe.acs.commons.util.ParameterUtil',
    'acscommons.com.google.common.cache.LocalCache', '/apps/acs-commons/components/content/audio', 'acme_packages:acs-commons-generic-lists']) {
    assert.ok(isAcsCommonsName(name), name);
  }
  for (const name of ['com.adobe.acs.acs-aem-tools-bundle', 'com.adobe.acs.tools.csv.impl.CsvUtil', '/apps/acs-tools/components/aemfiddle',
    'adobe/consulting:acs-aem-tools-content:1.0.2', 'adobe/consulting:com.adobe.acs.bundles.sling-models:1.1.0', 'com.acme.core']) {
    assert.ok(!isAcsCommonsName(name), name);
  }
});

test('a BPA CSV exported with the ACS Commons filter is flagged: the section and the warnings say how many findings are hidden', async () => {
  const root = acsProject();
  const rows = [
    'LUI,legacy.user.interface,legacy.dialog.classic,MAJOR,/apps/acme/components/teaser/dialog,\\N,A classic dialog was found.,https://www.adobe.com/go/aem_pd_LUI,\\N',
    '_COUNT,__count.total,\\N,\\N,2,\\N, count: 2,\\N,"{""data"": {""unfilteredTotal"": 9}}"',
  ];
  const gathered = await gatherFindings({ workspaceRoot: root, bpaFilePath: bpaCsv(root, rows), collectionsDir: path.join(root, 'uc'), getEffectivePom: noPom });
  const filterRow = gathered.findingsByPattern.acsCommons.find(f => /ACS Commons filter/.test(f.detail));
  assert.ok(filterRow, 'the section names the filtered export');
  assert.ok(filterRow.informational);
  assert.match(filterRow.detail, /7 of 9 findings/);
  assert.ok(gathered.analyzerWarnings.some(w => /ACS Commons filter/.test(w) && /7 of 9/.test(w)));
  assert.ok(gathered.findingsByPattern.acsCommons.some(f => /Generic Lists/.test(f.detail)), 'the repository scan still runs');
});

test('the parser total counts each BPA finding once: ACS rows are copies of rows other subtypes hold', () => {
  const root = mkworkspace();
  const rows = [
    'LUI,legacy.user.interface,legacy.dialog.classic,MAJOR,/apps/acs-commons/components/utilities/sitemap/dialog,\\N,A classic dialog was found.,https://www.adobe.com/go/aem_pd_LUI,\\N',
    'LUI,legacy.user.interface,legacy.dialog.classic,MAJOR,/apps/acme/components/teaser/dialog,\\N,A classic dialog was found.,https://www.adobe.com/go/aem_pd_LUI,\\N',
  ];
  const { parseBpaFile, createUnifiedCollection } = require('./bpa-local-parser.js');
  const summary = createUnifiedCollection(parseBpaFile(bpaCsv(root, rows)), path.join(root, 'uc'));
  assert.ok(summary.subtypes.includes('acs_commons'), 'the ACS row is kept for the runbook');
  assert.strictEqual(summary.totalFindings, 2, 'two LUI findings, not three');
});

test('a filtered BPA CSV that still has ACS rows is not blamed on the ACS Commons filter', async () => {
  const root = acsProject();
  const rows = [
    BPA_ACS_ROWS[0],
    '_COUNT,__count.total,\\N,\\N,2,\\N, count: 2,\\N,"{""data"": {""unfilteredTotal"": 9}}"',
  ];
  const gathered = await gatherFindings({ workspaceRoot: root, bpaFilePath: bpaCsv(root, rows), collectionsDir: path.join(root, 'uc'), getEffectivePom: noPom });
  assert.ok(!gathered.findingsByPattern.acsCommons.some(f => /filter/.test(f.detail)), 'no filter row in the ACS section');
  const warning = gathered.analyzerWarnings.find(w => /exported with a filter/.test(w));
  assert.ok(warning, 'a neutral filtered-export warning');
  assert.match(warning, /7 of 9 findings/);
  assert.doesNotMatch(warning, /ACS Commons filter/);
});
