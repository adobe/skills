'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { runPrecheck, scanJavaBlockers, parseJacocoXml } = require('./cm-quality-precheck.js');

function mkworkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cm-precheck-test-'));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}
function pom({ properties = '', plugins = '', profiles = '' } = {}) {
  return `<project><modelVersion>4.0.0</modelVersion><artifactId>core</artifactId>
  <properties>${properties}</properties>
  <build><plugins>${plugins}</plugins></build>
  <profiles>${profiles}</profiles></project>`;
}
const surefire = (config) => `<plugin><artifactId>maven-surefire-plugin</artifactId><configuration>${config}</configuration></plugin>`;
const jacoco = (version) => `<plugin><groupId>org.jacoco</groupId><artifactId>jacoco-maven-plugin</artifactId><version>${version}</version></plugin>`;
const rules = (r, severity) => r.findings.filter((f) => !severity || f.severity === severity).map((f) => f.rule);
const javaRules = (body) => scanJavaBlockers(`package a;\nimport java.io.*;\nimport java.nio.file.*;\npublic class T {\n${body}\n}`).map((f) => f.rule);

// ── Tooling that zeroes coverage ─────────────────────────────────────────────

test('a literal surefire argLine drops the JaCoCo agent; @{argLine} keeps it', () => {
  const bad = mkworkspace();
  write(bad, 'pom.xml', pom({ plugins: surefire('<argLine>-Xmx1024m</argLine>') }));
  assert.deepStrictEqual(rules(runPrecheck(bad), 'gate'), ['argline-drops-jacoco-agent']);

  const good = mkworkspace();
  write(good, 'pom.xml', pom({ properties: '<argLine></argLine>', plugins: surefire('<argLine>@{argLine} -Xmx1024m</argLine>') }));
  assert.deepStrictEqual(rules(runPrecheck(good), 'gate'), []);
});

test('${argLine} is fatal only when a pom declares the argLine property', () => {
  const declared = mkworkspace();
  write(declared, 'pom.xml', pom({ properties: '<argLine>-Xmx1g</argLine>', plugins: surefire('<argLine>${argLine} -Dx=1</argLine>') }));
  assert.deepStrictEqual(rules(runPrecheck(declared), 'gate'), ['argline-drops-jacoco-agent']);

  const selfClosing = mkworkspace();
  write(selfClosing, 'pom.xml', pom({ properties: '<argLine/>', plugins: surefire('<argLine>${argLine} -Dx=1</argLine>') }));
  assert.deepStrictEqual(rules(runPrecheck(selfClosing), 'gate'), ['argline-drops-jacoco-agent']);

  const undeclared = mkworkspace();
  write(undeclared, 'pom.xml', pom({ plugins: surefire('<argLine>${argLine} -Dx=1</argLine>') }));
  assert.deepStrictEqual(rules(runPrecheck(undeclared)), ['argline-early-evaluation']);
});

test('an argLine in an inactive profile is info only', () => {
  const root = mkworkspace();
  write(root, 'pom.xml', pom({
    properties: '<argLine></argLine>',
    plugins: surefire('<argLine>@{argLine} -Xmx1g</argLine>'),
    profiles: `<profile><id>debug</id><build><plugins>${surefire('<argLine>-agentlib:jdwp=transport=dt_socket</argLine>')}</plugins></build></profile>`,
  }));
  const r = runPrecheck(root);
  assert.deepStrictEqual(rules(r, 'gate'), []);
  assert.deepStrictEqual(rules(r, 'info'), ['argline-drops-jacoco-agent']);
});

test('--base marks new untracked files as changed when the project is a subfolder of the repo', () => {
  const repo = mkworkspace();
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  const leak = 'package a;\nimport java.io.*;\nclass X { void a(File f) throws IOException { InputStream in = new FileInputStream(f); in.read(); } }';
  write(repo, 'site/pom.xml', pom());
  write(repo, 'site/src/main/java/a/Old.java', leak.replace('class X', 'class Old'));
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  write(repo, 'site/src/main/java/a/New.java', leak.replace('class X', 'class New'));
  const r = runPrecheck(path.join(repo, 'site'), { base: 'HEAD' });
  const changed = Object.fromEntries(r.findings.filter((f) => f.rule === 'java:S2095').map((f) => [path.basename(f.file), f.changed]));
  assert.deepStrictEqual(changed, { 'Old.java': false, 'New.java': true });
});

test('JaCoCo older than the Cloud Manager JDK is a gate failure; a supported version is not', () => {
  const old = mkworkspace();
  write(old, '.cloudmanager/java-version', '21\n');
  write(old, 'pom.xml', pom({ properties: '<jacoco.version>0.8.8</jacoco.version>', plugins: jacoco('${jacoco.version}') }));
  const r = runPrecheck(old);
  assert.deepStrictEqual(rules(r, 'gate'), ['jacoco-too-old']);
  assert.match(r.findings[0].message, /0\.8\.11/);

  const ok = mkworkspace();
  write(ok, '.cloudmanager/java-version', '21\n');
  write(ok, 'pom.xml', pom({ plugins: jacoco('0.8.12') }));
  assert.deepStrictEqual(rules(runPrecheck(ok), 'gate'), []);
});

test('skipTests in main properties fails the gate; in an inactive profile it is info only', () => {
  const main = mkworkspace();
  write(main, 'pom.xml', pom({ properties: '<skipTests>true</skipTests>', plugins: surefire('<skipTests>${skipTests}</skipTests>') }));
  assert.deepStrictEqual(rules(runPrecheck(main), 'gate'), ['tests-skipped']);

  const profile = mkworkspace();
  write(profile, 'pom.xml', pom({ profiles: '<profile><id>fast</id><properties><skipTests>true</skipTests></properties></profile>' }));
  assert.deepStrictEqual(rules(runPrecheck(profile), 'gate'), []);
  assert.deepStrictEqual(rules(runPrecheck(profile), 'info'), ['tests-skipped']);
});

// ── Java Blocker heuristics ──────────────────────────────────────────────────

test('S2095 flags unclosed resources and leaves owned/closed ones alone', () => {
  assert.deepStrictEqual(javaRules('void a(File f) throws IOException { InputStream in = new FileInputStream(f); in.read(); }'), ['java:S2095']);
  assert.deepStrictEqual(javaRules('void b(java.util.Properties p, File f) throws IOException { p.load(new FileInputStream(f)); }'), ['java:S2095']);
  assert.deepStrictEqual(javaRules('long c(Path p) throws IOException { return Files.lines(p).count(); }'), []);
  assert.deepStrictEqual(javaRules('void d(Path p) throws IOException { Files.lines(p).forEach(System.out::println); }'), ['java:S2095']);

  assert.deepStrictEqual(javaRules('void e(File f) throws IOException { try (InputStream in = new FileInputStream(f)) { in.read(); } }'), []);
  assert.deepStrictEqual(javaRules('void f(File f) throws IOException { try (BufferedReader r = new BufferedReader(new FileReader(f))) { r.readLine(); } }'), []);
  assert.deepStrictEqual(javaRules('InputStream g(File f) throws IOException { return new FileInputStream(f); }'), []);
  assert.deepStrictEqual(javaRules('void h(File f) throws IOException { InputStream in = null; try { in = new FileInputStream(f); in.read(); } finally { if (in != null) in.close(); } }'), []);
  assert.deepStrictEqual(javaRules('private InputStream field; void i(File f) throws IOException { field = new FileInputStream(f); }'), []);
  assert.deepStrictEqual(javaRules('void j() { InputStream in = new ByteArrayInputStream(new byte[0]); }'), []);
  // Wrapping a caller-owned stream: closing the wrapper would close the caller's stream.
  assert.deepStrictEqual(javaRules('void k(OutputStream out, InputStream is) throws IOException { PrintWriter w = new PrintWriter(new OutputStreamWriter(out)); BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8")); w.println(r.readLine()); }'), []);
  assert.deepStrictEqual(javaRules('void l(File f) throws IOException { BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f))); r.readLine(); }'), ['java:S2095']);
  assert.deepStrictEqual(javaRules('void m() throws IOException { PrintWriter w = new PrintWriter("out.txt"); w.println(); }'), ['java:S2095']);
});

test('S2276 flags Thread.sleep only inside synchronized code', () => {
  assert.deepStrictEqual(javaRules('synchronized void a() throws Exception { Thread.sleep(10); }'), ['java:S2276']);
  assert.deepStrictEqual(javaRules('void b(Object lock) throws Exception { synchronized (lock) { Thread.sleep(10); } }'), ['java:S2276']);
  assert.deepStrictEqual(javaRules('void c() throws Exception { Thread.sleep(10); }'), []);
});

test('S2168 flags double-checked locking unless the field is volatile', () => {
  const dcl = (decl) => javaRules(`${decl} static T get() { if (instance == null) { synchronized (T.class) { if (instance == null) { instance = new T(); } } } return instance; }`);
  assert.deepStrictEqual(dcl('private static T instance;'), ['java:S2168']);
  assert.deepStrictEqual(dcl('private static volatile T instance;'), []);
});

test('comments and strings never produce Java findings', () => {
  assert.deepStrictEqual(javaRules('// new FileInputStream(f)\nString s = "Thread.sleep(1) new FileInputStream(x)";'), []);
});

// ── Content packages ─────────────────────────────────────────────────────────

test('Oak index Blocker rules: type, async, tika and damAssetLucene', () => {
  const root = mkworkspace();
  const idx = 'ui.apps/src/main/content/jcr_root/_oak_index';
  write(root, `${idx}/.content.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:oak="http://jackrabbit.apache.org/oak/ns/1.0">
  <damAssetLucene-8-custom-1 jcr:primaryType="oak:QueryIndexDefinition" type="lucene" compatVersion="{Long}2"/>
  <acme.product-1-custom-1 jcr:primaryType="oak:QueryIndexDefinition" type="property"/>
  <lucene-2-custom-1 jcr:primaryType="oak:QueryIndexDefinition" type="lucene" async="[async,nrt]" compatVersion="{Long}2">
    <tika jcr:primaryType="nt:unstructured"><config.xml jcr:primaryType="nt:file"/></tika>
  </lucene-2-custom-1>
</jcr:root>`);
  write(root, `${idx}/acme.page-1-custom-1/.content.xml`, '<jcr:root xmlns:jcr="x" jcr:primaryType="oak:QueryIndexDefinition" type="lucene" async="[async]"/>');
  const got = runPrecheck(root).findings.map((f) => `${f.rule}:${f.message.split(':')[0]}`).sort();
  assert.deepStrictEqual(got, [
    'IndexAsyncProperty:damAssetLucene-8-custom-1',
    'IndexDamAssetLucene:damAssetLucene-8-custom-1',
    'IndexTikaNode:damAssetLucene-8-custom-1',
    'IndexType:acme.product-1-custom-1',
  ]);
});

test('a /libs filter root is a Critical BannedPath finding, not a gate failure', () => {
  const root = mkworkspace();
  write(root, 'ui.apps/src/main/content/META-INF/vault/filter.xml', '<workspaceFilter version="1.0"><filter root="/apps/acme"/><filter root="/libs/cq/core/content/nav"/></workspaceFilter>');
  const r = runPrecheck(root);
  assert.deepStrictEqual(rules(r), ['BannedPath']);
  assert.strictEqual(r.findings[0].severity, 'critical');
  assert.strictEqual(r.status, 'unverified');
});

// ── Coverage mode ────────────────────────────────────────────────────────────

const jacocoXml = (classes, total) => `<?xml version="1.0"?><report name="core"><sessioninfo id="s" start="0" dump="0"/>
<package name="com/acme">${classes}<counter type="LINE" missed="${total.lm}" covered="${total.lc}"/></package>
<counter type="INSTRUCTION" missed="1" covered="1"/><counter type="BRANCH" missed="${total.bm}" covered="${total.bc}"/><counter type="LINE" missed="${total.lm}" covered="${total.lc}"/></report>`;
const cls = (name, lm, lc, bm, bc) => `<class name="com/acme/${name}" sourcefilename="${name}.java"><method name="m" desc="()V" line="1"><counter type="LINE" missed="99" covered="99"/></method><counter type="BRANCH" missed="${bm}" covered="${bc}"/><counter type="LINE" missed="${lm}" covered="${lc}"/></class>`;

test('parseJacocoXml reads report-level and class-level counters, not method counters', () => {
  const r = parseJacocoXml(jacocoXml(cls('Job', 30, 10, 4, 0), { lm: 30, lc: 10, bm: 4, bc: 0 }));
  assert.deepStrictEqual(r.line, { missed: 30, covered: 10 });
  assert.deepStrictEqual(r.branch, { missed: 4, covered: 0 });
  assert.deepStrictEqual(r.classes[0].line, { missed: 30, covered: 10 });
});

function coverageProject({ lm, lc, bm, bc, untestedModule = false }) {
  const root = mkworkspace();
  write(root, 'pom.xml', pom({ properties: '<argLine></argLine>', plugins: surefire('<argLine>@{argLine}</argLine>') }));
  write(root, 'core/pom.xml', pom());
  write(root, 'core/src/main/java/com/acme/Job.java', 'package com.acme;\npublic class Job { void run() { int a = 1; } }');
  write(root, 'core/src/test/java/com/acme/JobTest.java', 'class JobTest {}');
  write(root, 'core/target/jacoco.exec', 'x');
  write(root, 'core/target/surefire-reports/TEST-com.acme.JobTest.xml', '<testsuite name="JobTest" tests="3" skipped="0" failures="0" errors="0"></testsuite>');
  write(root, 'core/target/site/jacoco/jacoco.xml', jacocoXml(cls('Job', lm, lc, bm, bc), { lm, lc, bm, bc }));
  if (untestedModule) {
    write(root, 'extra/pom.xml', pom());
    write(root, 'extra/src/main/java/com/acme/Util.java', 'package com.acme;\npublic class Util {\n  int a() {\n    int x = 1;\n    if (x > 0) {\n      return x;\n    }\n    return 0;\n  }\n}');
  }
  return root;
}

test('coverage uses (covered lines + covered branches) / (lines + branches) and fails below 50%', () => {
  const r = runPrecheck(coverageProject({ lm: 60, lc: 36, bm: 4, bc: 0 }), { coverage: true });
  assert.strictEqual(r.coverage.percent.toFixed(1), '36.0');
  assert.strictEqual(r.status, 'fail');
  assert.ok(rules(r, 'gate').includes('coverage-below-gate'));
  assert.strictEqual(r.coverage.neededForGate, 14);
  assert.strictEqual(r.coverage.topUncovered[0].file, 'core/src/main/java/com/acme/Job.java');
});

test('a module without a JaCoCo report counts as uncovered and lowers the estimate', () => {
  const alone = runPrecheck(coverageProject({ lm: 4, lc: 6, bm: 0, bc: 0 }), { coverage: true });
  assert.strictEqual(alone.coverage.percent, 60);
  assert.strictEqual(alone.status, 'ready');

  const withExtra = runPrecheck(coverageProject({ lm: 4, lc: 6, bm: 0, bc: 0, untestedModule: true }), { coverage: true });
  assert.ok(withExtra.coverage.estimatedUnits > 0);
  assert.ok(withExtra.coverage.percent < 60);
  assert.ok(rules(withExtra, 'info').includes('module-without-tests'));
});

test('tests that ran without jacoco.exec are reported as a detached agent', () => {
  const root = coverageProject({ lm: 4, lc: 6, bm: 0, bc: 0 });
  fs.rmSync(path.join(root, 'core/target/jacoco.exec'));
  fs.rmSync(path.join(root, 'core/target/site'), { recursive: true });
  const r = runPrecheck(root, { coverage: true });
  assert.ok(rules(r, 'gate').includes('jacoco-agent-not-attached'));
  assert.strictEqual(r.coverage.modules[0].status, 'agent-not-attached');
});

// ── Baseline delta (Step 6) ──────────────────────────────────────────────────

test('against the runbook baseline, only new findings decide the session status', () => {
  const { readinessBaseline, applyBaseline, renderMarkdown } = require('./cm-quality-precheck.js');
  const root = mkworkspace();
  const leak = (cls) => `package a;\nimport java.io.*;\nclass ${cls} { void a(File f) throws IOException { InputStream in = new FileInputStream(f); in.read(); } }`;
  write(root, 'pom.xml', pom());
  write(root, 'src/main/java/a/Old.java', leak('Old'));
  const baseline = readinessBaseline(runPrecheck(root), 'then');

  const inheritedOnly = applyBaseline(runPrecheck(root), baseline);
  assert.strictEqual(inheritedOnly.status, 'unverified');
  assert.deepStrictEqual(inheritedOnly.delta, { baselineAt: 'then', newCount: 0, inheritedCount: 2, resolvedCount: 0 });
  assert.match(renderMarkdown(inheritedOnly), /NO NEW GATE ISSUE[\s\S]*`java:S2095` × 1/);

  // The CLI reads the baseline from the runbook cache and exits 0 on inherited-only findings.
  const cache = write(root, 'migration-runbook.json', JSON.stringify({ cmReadiness: baseline }));
  const script = path.join(__dirname, 'cm-quality-precheck.js');
  assert.strictEqual(spawnSync(process.execPath, [script, root], { encoding: 'utf8' }).status, 1);
  assert.strictEqual(spawnSync(process.execPath, [script, root, '--baseline', cache], { encoding: 'utf8' }).status, 0);
  assert.strictEqual(spawnSync(process.execPath, [script, root, '--baseline', write(root, 'empty.json', '{}')], { encoding: 'utf8' }).status, 2);

  write(root, 'src/main/java/a/New.java', leak('New'));
  const introduced = applyBaseline(runPrecheck(root), baseline);
  assert.strictEqual(introduced.status, 'fail');
  assert.deepStrictEqual(introduced.findings.filter((f) => f.rule === 'java:S2095' && !f.inherited).map((f) => f.file), ['src/main/java/a/New.java']);

  fs.rmSync(path.join(root, 'src/main/java/a/Old.java'));
  assert.strictEqual(applyBaseline(runPrecheck(root), baseline).delta.resolvedCount, 1);
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test('CLI exits 1 on a predicted gate failure, 0 otherwise, 2 on usage errors', () => {
  const script = path.join(__dirname, 'cm-quality-precheck.js');
  const bad = mkworkspace();
  write(bad, 'pom.xml', pom({ plugins: surefire('<argLine>-Xmx1g</argLine>') }));
  const failRun = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
  assert.strictEqual(failRun.status, 1);
  assert.match(failRun.stdout, /argline-drops-jacoco-agent/);

  const ok = mkworkspace();
  write(ok, 'pom.xml', pom());
  assert.strictEqual(spawnSync(process.execPath, [script, ok], { encoding: 'utf8' }).status, 0);
  assert.strictEqual(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2);
});
