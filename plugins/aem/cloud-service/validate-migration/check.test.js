'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { parseArgs, readContext, prepareStopDecision } = require('./check.js');
const PATTERNS = require('./check/patterns');
const { parseBundleDiagnosticReport, parseComponentsFromReport, normalizeState, mcpUnavailableOutcome, clearDiagnosisMap } = require('./check/lib/diagnosis.js');
const { classifyDialog } = require('./check/lib/dialogs.js');
const { manifestImportsPackage, referencesClassName } = require('./check/lib/jar.js');
const { topicFromDescriptor, rclFlagsFromDescriptor } = require('./check/lib/descriptor.js');
const { buildMcpPayload, renderLocalReport, writeLocalReport, finalizeReporting, toClassEntry, stripEmpty, truncate, camReportingNote } = require('./reporting.js');
const { ALL_FAILURE_CLASSES, FAILURE_CLASSES, isFailureClass } = require('./failure-classes.js');
const { changedFiles, RULES, SOURCE_ONLY_PATTERNS } = require('./plan.js');
const { selectArtifact } = require('./build.js');
const { readBundleSymbolicName } = require('./deploy.js');
const { findRunningSdk } = require('./sdk.js');

test('scheduler rejects a built component without scheduler.runOn before runtime diagnosis', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-contract-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'OSGI-INF'));
  fs.writeFileSync(path.join(root, 'OSGI-INF', 'job.xml'),
    '<scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.3.0" name="com.acme.Job">' +
    '<implementation class="com.acme.Job"/><service><provide interface="java.lang.Runnable"/></service>' +
    '<property name="scheduler.expression" value="0 0 * * * ?"/>' +
    '</scr:component>');
  const jar = path.join(root, 'bundle.jar');
  execFileSync('zip', ['-qr', jar, 'OSGI-INF'], { cwd: root });
  const discovered = PATTERNS.scheduler.discover(jar, { fqcn: 'com.acme.Job' });
  const outcome = await PATTERNS.scheduler.verify({ bundleBSN: 'com.acme.scheduler-contract', discovered, args: {} });
  assert.strictEqual(outcome.result, 'fail');
  assert.strictEqual(outcome.failure_class, FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH);
  assert.match(outcome.evidence, /scheduler\.runOn/);
});

function verifyContractFixture(context, pattern, properties, service, manifest = 'Import-Package: org.osgi.framework\n', options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-contract-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['OSGI-INF', 'META-INF', '.validate-migration']) fs.mkdirSync(path.join(root, directory));
  const fqcn = 'com.acme.ContractComponent';
  fs.writeFileSync(path.join(root, 'OSGI-INF', 'component.xml'),
    `<scr:component xmlns:scr="http://www.osgi.org/xmlns/scr/v1.3.0" name="${fqcn}">` +
    `<implementation class="${fqcn}"/><service>${[].concat(service).map((serviceName) => `<provide interface="${serviceName}"/>`).join('')}</service>${properties}</scr:component>`);
  fs.writeFileSync(path.join(root, 'META-INF', 'MANIFEST.MF'), 'Bundle-SymbolicName: com.acme.contract\n' + manifest);
  fs.writeFileSync(path.join(root, 'ContractComponent.class'), Buffer.from('fixture without legacy API references'));
  const jar = path.join(root, 'bundle.jar');
  execFileSync('zip', ['-qr', jar, 'OSGI-INF', 'META-INF', 'ContractComponent.class'], { cwd: root });
  const discovered = PATTERNS[pattern].discover(jar, { fqcn });
  if (options.omitContract) delete discovered.contract;
  fs.writeFileSync(path.join(root, '.validate-migration', 'state.json'), JSON.stringify({
    started_at: '2026-10-08T00:00:00.000Z',
    prepared: [{ pattern, discovered, mode: 'bundle-runtime', symbolicName: 'com.acme.contract', artifactPath: jar }],
  }));
  fs.writeFileSync(path.join(root, '.validate-migration', 'diagnosis-map.json'), JSON.stringify({
    'com.acme.contract': `Bundle: com.acme.contract\nState: Active\n\nDeclarative Services Components\nComponent: ${fqcn}\n  State: Active\n`,
  }));
  const execution = spawnSync(process.execPath, [path.join(__dirname, 'check.js'), '--stage', 'verify', '--pattern', pattern, '--project', root], { encoding: 'utf8' });
  const reportName = fs.readdirSync(path.join(root, '.validate-migration')).find((name) => /^rvc-\d+\.json$/.test(name));
  assert.ok(reportName, execution.stderr || execution.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(root, '.validate-migration', reportName), 'utf8'));
  return { outcome: report.classes[0], execution, report };
}

for (const example of [
  { pattern: 'scheduler', service: 'com.acme.NotRunnable', properties: '<property name="scheduler.expression" value="0 0 * * * ?"/><property name="scheduler.runOn" value="SINGLE"/>', missing: /Runnable/ },
  { pattern: 'scheduler', service: 'java.lang.Runnable', properties: '<property name="scheduler.expression" value="0 0 * * * ?"/><property name="scheduler.runOn" value="ALL"/>', missing: /scheduler\.runOn/ },
  { pattern: 'scheduler', service: 'java.lang.Runnable', properties: '<property name="scheduler.expression" value="0 0 * * * ?"/><property name="scheduler.runOn" value="LEADER"/><property name="scheduler.concurrent" value="false"/>', missing: /scheduler\.concurrent/ },
  { pattern: 'event-migration', service: 'org.osgi.service.event.EventHandler', properties: '<property name="job.topics" value="acme/job"/>', missing: /JobConsumer/ },
  { pattern: 'event-migration', service: 'org.apache.sling.event.jobs.consumer.JobConsumer', properties: '<property name="job.topics" value=" "/>', missing: /job\.topics/ },
  { pattern: 'resource-change-listener', service: 'com.acme.NotAListener', properties: '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="ADDED"/>', missing: /ResourceChangeListener/ },
  { pattern: 'resource-change-listener', service: 'org.apache.sling.api.resource.observation.ResourceChangeListener', properties: '<property name="resource.paths" value=" "/><property name="resource.change.types" value="ADDED"/>', missing: /resource\.paths/ },
  { pattern: 'resource-change-listener', service: 'org.apache.sling.api.resource.observation.ResourceChangeListener', properties: '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="INVALID"/>', missing: /resource\.change\.types/ },
]) {
  test(`migration contract rejects ${example.pattern}: ${example.missing.source}`, (context) => {
    const { outcome, execution } = verifyContractFixture(context, example.pattern, example.properties, example.service);
    assert.strictEqual(execution.status, 1);
    assert.strictEqual(outcome.result, 'fail');
    assert.strictEqual(outcome.failure_class, FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH);
    assert.match(outcome.evidence, example.missing);
    assert.strictEqual(outcome.checks.business_behavior, 'not_tested');
  });
}

for (const example of [
  { pattern: 'scheduler', service: 'java.lang.Runnable', properties: '<property value="0 0 * * * ?" name="scheduler.expression"/><property name="scheduler.runOn" value="SINGLE"/><property type="Boolean" name="scheduler.concurrent" value="false"/>' },
  { pattern: 'event-migration', service: 'org.apache.sling.event.jobs.consumer.JobConsumer', properties: '<property name="job.topics">\nacme/job\nacme/other\n</property>' },
  { pattern: 'resource-change-listener', service: 'org.apache.sling.api.resource.observation.ResourceChangeListener', properties: '<property name="resource.paths">\n/content\n/content/dam\n</property><property name="resource.change.types">\nADDED\nCHANGED\nREMOVED\n</property>' },
  { pattern: 'asset-manager', service: 'com.acme.AssetService', properties: '' },
  { pattern: 'replication', service: 'com.acme.DistributionService', properties: '', manifest: 'Import-Package: org.apache.sling.distribution\n' },
]) {
  test(`migration contract accepts ${example.pattern} without claiming business behavior`, (context) => {
    const { outcome, execution } = verifyContractFixture(context, example.pattern, example.properties, example.service, example.manifest);
    assert.strictEqual(execution.status, 3, execution.stderr || execution.stdout);
    assert.strictEqual(outcome.result, 'pass');
    assert.strictEqual(outcome.checks.business_behavior, 'not_tested');
    assert.strictEqual(outcome.checks.migration_contract, 'pass');
  });
}

for (const pattern of Object.keys(PATTERNS)) {
  test(`business behavior stays untested in the ${pattern} MCP outcome`, () => {
    const entry = toClassEntry({ pattern, result: 'pass', checks: { migration_contract: 'pass' } });
    assert.strictEqual(entry.checks.business_behavior, 'not_tested');
    const failure = toClassEntry({ pattern, result: 'fail', failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH });
    assert.strictEqual(failure.checks.business_behavior, 'not_tested');
  });
}

test('business behavior is explicitly not tested in the local report', () => {
  const report = renderLocalReport({ run_id: 'rvc-1', result: 'pass', classes: [{ pattern: 'scheduler', result: 'pass' }] });
  assert.match(report, /business behavior: not tested/i);
  assert.match(report, /migration.contract/i);
});

for (const example of [
  { pattern: 'event-migration', service: 'org.apache.sling.event.jobs.consumer.JobConsumer', properties: '<property name="job.topics" value="acme/job"/>' },
  { pattern: 'resource-change-listener', service: 'org.apache.sling.api.resource.observation.ResourceChangeListener', properties: '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="ADDED"/>' },
]) {
  test(`migration contract distinguishes built and effective ${example.pattern} properties`, (context) => {
    const { outcome } = verifyContractFixture(context, example.pattern, example.properties, example.service);
    assert.strictEqual(outcome.result, 'pass');
    assert.strictEqual(outcome.restricted, true);
    assert.match(outcome.restricted_reason, /effective.*properties.*not exposed/i);
  });
}

test('validation guidance forbids customer business actions and source changes', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'validate-migration', 'SKILL.md'), 'utf8');
  const reference = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  for (const text of [skill, reference]) {
    assert.match(text, /business_behavior.*not_tested/);
    assert.match(text, /do not invoke customer business actions/i);
    assert.match(text, /before deployment/i);
    assert.match(text, /existing customer tests/i);
  }
});

test('runtime recovery guidance bounds fresh diagnosis and migration-owned repair', () => {
  const paths = [
    path.join(__dirname, '..', 'skills', 'validate-migration', 'SKILL.md'),
    path.join(__dirname, 'README.md'),
  ];
  for (const filePath of paths) {
    const text = fs.readFileSync(filePath, 'utf8');
    const section = text.match(/(?:^|\n)## Bounded runtime recovery\n([\s\S]*?)(?=\n## |$)/);
    assert.ok(section, `${filePath} must define bounded runtime recovery`);
    const recovery = section[1];
    assert.match(recovery, /3 diagnosis checks total/);
    assert.match(recovery, /wait 5 seconds/);
    assert.match(recovery, /fresh[^\n]*`diagnose-osgi-bundle`/);
    assert.match(recovery, /replace[^\n]*`diagnosis-map\.json`/);
    assert.match(recovery, /Do not rebuild or redeploy during activation checks/);
    assert.match(recovery, /at most one repair cycle/);
    assert.match(recovery, /`migration` owns customer source changes/);
    assert.match(recovery, /original scope/);
    assert.match(recovery, /stop[^\n]*`setup\.mcp_unavailable`/i);
    assert.match(recovery, /unresolved imports, missing services, or activation exceptions/);
    assert.match(recovery, /Unrelated out-of-scope component errors do not fail a scoped validation/);
    assert.match(recovery, /remove affected BSN entries/);
    assert.match(recovery, /recheck deployment safety[\s\S]*?(?:--stage prepare|run prepare)/i);
    assert.match(recovery, /final verification attempt/);
  }
});

test('external listener marker alone does not register a ResourceChangeListener', (context) => {
  const properties = '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="ADDED"/>';
  const { outcome, execution } = verifyContractFixture(context, 'resource-change-listener', properties, 'org.apache.sling.api.resource.observation.ExternalResourceChangeListener');
  assert.strictEqual(execution.status, 1);
  assert.strictEqual(outcome.failure_class, FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH);
  assert.match(outcome.evidence, /ResourceChangeListener/);
});

test('external listener marker supplements ResourceChangeListener registration', (context) => {
  const properties = '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="ADDED"/>';
  const { outcome, execution } = verifyContractFixture(context, 'resource-change-listener', properties, [
    'org.apache.sling.api.resource.observation.ResourceChangeListener',
    'org.apache.sling.api.resource.observation.ExternalResourceChangeListener',
  ]);
  assert.strictEqual(execution.status, 3);
  assert.strictEqual(outcome.result, 'pass');
});

for (const example of [
  { name: 'scheduler.expression', properties: '<property name="scheduler.expression">0 0 * * * ?</property><property name="scheduler.runOn" value="SINGLE"/>' },
  { name: 'scheduler.runOn', properties: '<property name="scheduler.expression" value="0 0 * * * ?"/><property name="scheduler.runOn">SINGLE</property>' },
  { name: 'scheduler.concurrent', properties: '<property name="scheduler.expression" value="0 0 * * * ?"/><property name="scheduler.runOn" value="SINGLE"/><property name="scheduler.concurrent" type="Boolean">false</property>' },
]) {
  test(`scheduler rejects array-valued ${example.name}`, (context) => {
    const { outcome, execution } = verifyContractFixture(context, 'scheduler', example.properties, 'java.lang.Runnable');
    assert.strictEqual(execution.status, 1);
    assert.strictEqual(outcome.failure_class, FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH);
    assert.match(outcome.evidence, /scalar/);
  });
}

for (const example of [
  { pattern: 'scheduler', service: 'java.lang.Runnable', properties: '<property name="scheduler.expression" value="0 0 * * * ?"/><property name="scheduler.runOn" value="SINGLE"/>' },
  { pattern: 'event-migration', service: 'org.apache.sling.event.jobs.consumer.JobConsumer', properties: '<property name="job.topics" value="acme/job"/>' },
  { pattern: 'resource-change-listener', service: 'org.apache.sling.api.resource.observation.ResourceChangeListener', properties: '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="ADDED"/>' },
]) {
  test(`missing built contract evidence prevents a ${example.pattern} pass`, (context) => {
    const { outcome, execution } = verifyContractFixture(context, example.pattern, example.properties, example.service, undefined, { omitContract: true });
    assert.strictEqual(execution.status, 1);
    assert.strictEqual(outcome.result, 'fail');
    assert.strictEqual(outcome.checks.migration_contract, 'not_verified');
    assert.match(outcome.evidence, /prepare/);
  });
}
// ── Failure-class taxonomy ────────────────────────────────────────

test('every failure_class the skill emits is in the frozen taxonomy', () => {
  for (const value of Object.values(FAILURE_CLASSES)) {
    assert.ok(isFailureClass(value), `${value} in ALL_FAILURE_CLASSES`);
  }
  assert.ok(ALL_FAILURE_CLASSES.includes('setup.mcp_unavailable'));
});

test('mcpUnavailableOutcome uses setup.mcp_unavailable with setup guidance', () => {
  const outcome = mcpUnavailableOutcome('com.acme.core');
  assert.strictEqual(outcome.result, 'fail');
  assert.strictEqual(outcome.failure_class, 'setup.mcp_unavailable');
  assert.ok(isFailureClass(outcome.failure_class), 'class is in the frozen taxonomy (MCP parity)');
  assert.match(outcome.evidence, /diagnose-osgi-bundle/);
  assert.match(outcome.evidence, /com\.acme\.core/);
});

// ── diagnose-osgi-bundle report parsing ─────────────────────────────────────

test('parseBundleDiagnosticReport reads an Active bundle state', () => {
  const report = 'Bundle: com.acme.core\nState: ACTIVE\n';
  const r = parseBundleDiagnosticReport(report);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.bundle_state, 'Active');
});

test('parseBundleDiagnosticReport reads a Resolved bundle state', () => {
  const r = parseBundleDiagnosticReport('Bundle: com.acme.core\nState: RESOLVED\n');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.bundle_state, 'Resolved');
});

test('parseBundleDiagnosticReport marks a missing bundle not found', () => {
  const r = parseBundleDiagnosticReport('no such bundle: com.acme.core');
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.bundle_state, 'Unknown');
});

test('parseComponentsFromReport extracts component states', () => {
  const report = [
    'Bundle: com.acme.core',
    'State: ACTIVE',
    '--- Declarative Services Components ---',
    'Component: com.acme.core.MyJob',
    '  State: ACTIVE',
    'Component: com.acme.core.Broken',
    '  State: UNSATISFIED',
  ].join('\n');
  const comps = parseComponentsFromReport(report);
  assert.strictEqual(comps.get('com.acme.core.MyJob').state, 'Active');
  assert.strictEqual(comps.get('com.acme.core.Broken').state, 'Unsatisfied');
});

test('normalizeState title-cases OSGi upper-case states', () => {
  assert.strictEqual(normalizeState('ACTIVE'), 'Active');
  assert.strictEqual(normalizeState('resolved'), 'Resolved');
  assert.strictEqual(normalizeState(''), 'Unknown');
});

// ── Payload builders (submit-migration-validation-result schema) ──────────────────────

test('toClassEntry keeps failure_class on fail and omits it on pass', () => {
  const fail = toClassEntry({
    result: 'fail',
    pattern: 'scheduler',
    failure_class: 'runtime.bundle_not_active',
    bundle_state: 'Resolved',
    evidence: 'bundle state=Resolved',
  });
  assert.strictEqual(fail.result, 'fail');
  assert.strictEqual(fail.failure_class, 'runtime.bundle_not_active');

  const pass = toClassEntry({ result: 'pass', pattern: 'scheduler', discovered: { fqcn: 'com.acme.MyJob' } });
  assert.strictEqual(pass.result, 'pass');
  assert.strictEqual(pass.class_name, 'com.acme.MyJob');
  assert.ok(!('failure_class' in pass), 'no failure_class on a pass entry');
});

test('buildMcpPayload derives summary counts and carries a setup.mcp_unavailable class', () => {
  const record = {
    run_id: 'run-1',
    result: 'fail',
    verification_level: 'runtime',
    started_at: '2026-09-23T00:00:00.000Z',
    finished_at: '2026-09-23T00:00:01.000Z',
    classes: [
      { result: 'pass', pattern: 'scheduler', discovered: { fqcn: 'com.acme.Ok' } },
      mcpUnavailableOutcome('com.acme.core'),
    ],
  };
  const payload = buildMcpPayload(record, { 'project-id': 'p1', pattern: 'scheduler' });
  assert.strictEqual(payload.project_id, 'p1');
  assert.strictEqual(payload.summary.classes_total, 2);
  assert.strictEqual(payload.summary.classes_pass, 1);
  assert.strictEqual(payload.summary.classes_fail, 1);
  const setupClass = payload.classes.find((c) => c.failure_class === 'setup.mcp_unavailable');
  assert.ok(setupClass, 'setup.mcp_unavailable class survives into the payload');
});

test('stripEmpty removes undefined and null but keeps falsy values', () => {
  const out = stripEmpty({ a: 1, b: undefined, c: null, d: 0, e: '' });
  assert.deepStrictEqual(out, { a: 1, d: 0, e: '' });
});

test('truncate caps long strings with an ellipsis', () => {
  assert.strictEqual(truncate('hello', 10), 'hello');
  assert.strictEqual(truncate('hello world', 6), 'hello…');
});

// ── CLI arg parsing ─────────────────────────────────────────────────────────

test('parseArgs reads a leading pattern and --flags', () => {
  const args = parseArgs(['scheduler', '--stage', 'verify', '--project-id', 'p1']);
  assert.strictEqual(args.pattern, 'scheduler');
  assert.strictEqual(args.stage, 'verify');
  assert.strictEqual(args['project-id'], 'p1');
});

test('parseArgs treats a leading flag as no pattern', () => {
  const args = parseArgs(['--stage', 'prepare']);
  assert.strictEqual(args.pattern, undefined);
  assert.strictEqual(args.stage, 'prepare');
});

// ── plan.js change scoping (CF0005) ─────────────────────────────────────────

function git(cwd, ...a) {
  return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
}

test('changedFiles unions committed, staged, unstaged, and untracked changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-plan-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t.t');
  git(root, 'config', 'user.name', 't');
  git(root, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', 'base.txt');
  git(root, 'commit', '-q', '-m', 'base');

  git(root, 'checkout', '-q', '-b', 'feature');
  const write = (rel, c) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, c);
  };
  // committed on feature
  write('committed.java', 'x');
  git(root, 'add', 'committed.java');
  git(root, 'commit', '-q', '-m', 'committed');
  // staged
  write('staged.java', 'x');
  git(root, 'add', 'staged.java');
  // unstaged (modify a tracked file)
  fs.appendFileSync(path.join(root, 'base.txt'), 'more\n');
  // untracked
  write('untracked.java', 'x');

  const files = changedFiles(root, 'main');
  assert.ok(files.includes('committed.java'), 'committed change detected');
  assert.ok(files.includes('staged.java'), 'staged change detected');
  assert.ok(files.includes('base.txt'), 'unstaged change detected');
  assert.ok(files.includes('untracked.java'), 'untracked change detected');

  fs.rmSync(root, { recursive: true, force: true });
});

// ── Pattern registry parity (plan.js ↔ check.js) ──────────────────

test('every plan.js RULE pattern is verifiable in check.js PATTERNS', () => {
  for (const { pattern } of RULES) {
    assert.ok(PATTERNS[pattern], `plan.js emits '${pattern}' but check.js PATTERNS has no such verifier`);
  }
});

test('SOURCE_ONLY_PATTERNS matches the source-only patterns plan.js can emit', () => {
  const rulePatterns = new Set(RULES.map((r) => r.pattern));
  // SOURCE_ONLY_PATTERNS only governs plan-derived tasks, so it must equal
  // exactly the RULE patterns whose check.js verifier declares source-only mode.
  const expected = new Set(
    [...rulePatterns].filter((p) => PATTERNS[p].mode === 'source-only'),
  );
  assert.deepStrictEqual(
    [...SOURCE_ONLY_PATTERNS].sort(),
    [...expected].sort(),
    'plan.js SOURCE_ONLY_PATTERNS is out of sync with check.js source-only modes',
  );
});

// ── Build artifact selection (bundle .jar vs content-package .zip) ──

test('selectArtifact picks the .jar for bundle patterns', () => {
  const files = ['core-1.0.jar', 'core-1.0-sources.jar'];
  assert.strictEqual(selectArtifact(files, 'bundle'), 'core-1.0.jar');
});

test('selectArtifact picks the .zip for content-package (source-only) patterns', () => {
  // ui.apps module: a content package .zip, no bundle jar — the legacy-ui/cdw case.
  const files = ['ui.apps-1.0.zip'];
  assert.strictEqual(selectArtifact(files, 'content-package'), 'ui.apps-1.0.zip');
});

test('selectArtifact prefers .zip over .jar for content-package', () => {
  const files = ['ui.apps-1.0.jar', 'ui.apps-1.0.zip'];
  assert.strictEqual(selectArtifact(files, 'content-package'), 'ui.apps-1.0.zip');
});

test('selectArtifact falls back to a content-embedding jar when no zip', () => {
  const files = ['bundle-with-content-1.0.jar'];
  assert.strictEqual(selectArtifact(files, 'content-package'), 'bundle-with-content-1.0.jar');
});

test('selectArtifact ignores -sources.jar and returns undefined when nothing matches', () => {
  assert.strictEqual(selectArtifact(['app-sources.jar', 'app.pom'], 'bundle'), undefined);
});

// ── --project path resolution (read paths match write paths) ──

test('readContext reads the CAM project from migration-runbook.json in args.project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-ctx-'));
  fs.writeFileSync(
    path.join(root, 'migration-runbook.json'),
    JSON.stringify({ project: { id: 'P123', name: 'WKND Legacy' } }),
  );
  const ctx = readContext({ project: root });
  assert.strictEqual(ctx.projectId, 'P123');
  assert.strictEqual(ctx.projectName, 'WKND Legacy');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Review-fix regressions ────────────────────────────────────────

test('RULES: a ResourceChangeListener that uses ResourceResolverFactory is not classified as asset-manager', () => {
  const text = 'class X implements ResourceChangeListener { @Reference ResourceResolverFactory rrf; }';
  const hit = RULES.find((r) => r.test('X.java', text));
  assert.strictEqual(hit.pattern, 'resource-change-listener');
});

test('parseBundleDiagnosticReport reads Active state even when the report mentions a reference not found', () => {
  const report = 'Bundle com.acme.core\nState: ACTIVE\n  reference com.foo.Bar not found (optional)';
  const r = parseBundleDiagnosticReport(report);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.bundle_state, 'Active');
});

test('parseBundleDiagnosticReport does not read a component State: as the bundle state', () => {
  const report = 'Bundle com.acme.core\n\nDeclarative Services Components\nComponent: com.acme.Comp\n  State: ACTIVE';
  const r = parseBundleDiagnosticReport(report);
  assert.strictEqual(r.bundle_state, 'Unknown');
});

test('toClassEntry surfaces restricted in checks on a restricted pass', () => {
  const cls = toClassEntry({
    pattern: 'scheduler',
    result: 'pass',
    bundle_state: 'Active',
    component_state: 'Active',
    restricted: true,
    restricted_reason: 'scheduler DS properties not exposed by diagnose-osgi-bundle',
  });
  assert.strictEqual(cls.result, 'pass');
  assert.strictEqual(cls.checks.restricted, true);
  assert.match(cls.checks.restricted_reason, /scheduler DS properties/);
});

test('classifyDialog distinguishes classic, coral 2, and coral 3 by field type', () => {
  assert.strictEqual(classifyDialog('<n xtype="textfield"/>'), 'classic');
  assert.strictEqual(classifyDialog('<n sling:resourceType="granite/ui/components/foundation/form/textfield"/>'), 'coral2');
  assert.strictEqual(classifyDialog('<n sling:resourceType="granite/ui/components/coral/foundation/form/textfield"/>'), 'coral3');
  // Shared Touch UI dialog root alone is not a Coral 2 signal.
  assert.strictEqual(classifyDialog('<n sling:resourceType="cq/gui/components/authoring/dialog"/>'), 'other');
});

test('clearDiagnosisMap removes a stale default map', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-map-'));
  fs.mkdirSync(path.join(root, '.validate-migration'), { recursive: true });
  const mapPath = path.join(root, '.validate-migration', 'diagnosis-map.json');
  fs.writeFileSync(mapPath, '{"com.acme.core":"x"}');
  clearDiagnosisMap(root);
  assert.strictEqual(fs.existsSync(mapPath), false);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Phase 0 fixes ─────────────────────────────────────────────────

test('readBundleSymbolicName strips directives (singleton:=true)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-bsn-'));
  const metaInf = path.join(root, 'META-INF');
  fs.mkdirSync(metaInf, { recursive: true });
  fs.writeFileSync(path.join(metaInf, 'MANIFEST.MF'), 'Manifest-Version: 1.0\r\nBundle-SymbolicName: com.acme.core;singleton:=true\r\n');
  const jar = path.join(root, 'b.jar');
  execFileSync('zip', ['-qr', jar, 'META-INF'], { cwd: root });
  assert.strictEqual(readBundleSymbolicName(jar), 'com.acme.core');
  fs.rmSync(root, { recursive: true, force: true });
});

test('deploy uses only the project profile, with no console URL or credentials', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-deploy-'));
  const artifactPath = path.join(root, 'bundle.jar');
  fs.writeFileSync(artifactPath, '');
  const childProcess = require('child_process');
  const deployPath = require.resolve('./deploy.js');
  const cachedDeploy = require.cache[deployPath];
  const commands = [];
  let rejectProfile = false;
  context.after(() => {
    require.cache[deployPath] = cachedDeploy;
    fs.rmSync(root, { recursive: true, force: true });
  });
  context.mock.method(childProcess, 'execFileSync', (command, args) => {
    if (command === 'unzip') return 'Bundle-SymbolicName: com.acme.core\n';
    assert.strictEqual(command, 'mvn');
    commands.push(args);
    if (rejectProfile && args.includes('install')) throw new Error('profile failed');
    return 'installed';
  });
  delete require.cache[deployPath];
  const { deploy } = require('./deploy.js');
  const scenarios = [
    { profile: 'autoInstallBundle', packaging: 'bundle', reject: false },
    { profile: 'autoInstallPackage', packaging: 'content-package', reject: false },
    { profile: 'autoInstallBundle', packaging: 'bundle', reject: true },
    { profile: null, packaging: 'bundle', reject: false },
  ];
  const targets = [
    { url: 'http://localhost:4602', host: 'localhost', port: '4602' },
    { url: 'http://127.0.0.1:5505/', host: '127.0.0.1', port: '5505' },
    { url: 'https://sdk.example.test', host: 'sdk.example.test', port: '443' },
    { url: 'http://sdk.example.test', host: 'sdk.example.test', port: '80' },
  ];
  for (const scenario of scenarios) {
    const profiles = scenario.profile ? `<profiles><profile><id>${scenario.profile}</id></profile></profiles>` : '';
    fs.writeFileSync(path.join(root, 'pom.xml'), `<project><packaging>${scenario.packaging}</packaging>${profiles}</project>`);
    rejectProfile = scenario.reject;
    for (const target of targets) {
      commands.length = 0;
      const result = deploy({ projectDir: root, artifactPath, sdkUrl: target.url });
      if (!scenario.profile) {
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.mode, 'manual');
        assert.strictEqual(commands.length, 0, 'no Maven call without a project profile');
        continue;
      }
      assert.strictEqual(result.ok, !scenario.reject);
      assert.strictEqual(commands.length, 1, 'no fallback deployment path');
      const args = commands[0];
      assert.ok(args.includes(scenario.profile));
      assert.ok(args.includes(`-Daem.host=${target.host}`), `SDK host must reach Maven: ${args}`);
      assert.ok(args.includes(`-Daem.port=${target.port}`), `SDK port must reach Maven: ${args}`);
      assert.ok(!args.some((a) => /system\/console|sling\.url|sling\.user|sling\.password|install-file/.test(a)), `no direct console access: ${args}`);
    }
  }
});

test('selectArtifact ignores -javadoc.jar and -tests.jar for bundle', () => {
  assert.strictEqual(selectArtifact(['x-javadoc.jar', 'x-tests.jar', 'x.jar'], 'bundle'), 'x.jar');
  assert.strictEqual(selectArtifact(['x-javadoc.jar', 'x-tests.jar', 'x-sources.jar'], 'bundle'), undefined);
});

test('prepareStopDecision: --stage all with bundle tasks and no map stops and exits 3', () => {
  assert.deepStrictEqual(prepareStopDecision('all', 1, false), { stop: true, exitCode: 3 });
});

test('prepareStopDecision: --stage prepare stops and exits 0', () => {
  assert.deepStrictEqual(prepareStopDecision('prepare', 0, false), { stop: true, exitCode: 0 });
});

test('prepareStopDecision: --stage all source-only (no bundle tasks) does not stop', () => {
  assert.strictEqual(prepareStopDecision('all', 0, false).stop, false);
});

test('prepareStopDecision: --stage all with an explicit map does not stop', () => {
  assert.strictEqual(prepareStopDecision('all', 2, true).stop, false);
});

test('every failure_class named in SKILL.md is in the taxonomy and emitted by check.js', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'validate-migration', 'SKILL.md'), 'utf8');
  const sources = [path.join(__dirname, 'check.js')];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) sources.push(p);
  });
  walk(path.join(__dirname, 'check'));
  const checkSrc = sources.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const keyOf = Object.fromEntries(Object.entries(FAILURE_CLASSES).map(([k, v]) => [v, k]));
  const named = new Set((skill.match(/`([a-z]+\.[a-z_]+)`/g) || []).map((s) => s.replace(/`/g, '')));
  for (const token of named) {
    if (!/^(runtime|source|setup|deploy|build|input|discovery|tests|sdk)\./.test(token)) continue;
    assert.ok(ALL_FAILURE_CLASSES.includes(token), `SKILL.md names '${token}' which is not in the frozen taxonomy`);
    assert.ok(checkSrc.includes(`FAILURE_CLASSES.${keyOf[token]}`), `SKILL.md names '${token}' but check.js never emits it`);
  }
});

test('legacy-ui plan rule requires a path boundary (confirmdialog.xml does not match)', () => {
  const rule = RULES.find((r) => r.pattern === 'legacy-ui');
  assert.strictEqual(rule.test('apps/x/comp/_cq_dialog/.content.xml'), true);
  assert.strictEqual(rule.test('apps/x/comp/dialog.xml'), true);
  assert.strictEqual(rule.test('apps/x/clientlibs/confirmdialog.xml'), false);
  assert.strictEqual(rule.test('apps/x/custom-dialog.xml'), false);
});

// ── offline manifest / bytecode detection ─────────────────────────

test('manifestImportsPackage matches the package within Import-Package only', () => {
  const mf = 'Import-Package: org.apache.sling.distribution;version="[1,2)",org.osgi.framework\n';
  assert.strictEqual(manifestImportsPackage(mf, 'org.apache.sling.distribution'), true);
});

test('manifestImportsPackage matches a sub-package namespace of the import', () => {
  const mf = 'Import-Package: org.apache.sling.distribution.agent,org.osgi.framework\n';
  assert.strictEqual(manifestImportsPackage(mf, 'org.apache.sling.distribution'), true);
});

test('manifestImportsPackage does not match a sibling package by prefix', () => {
  const mf = 'Import-Package: org.apache.sling.distributionx\n';
  assert.strictEqual(manifestImportsPackage(mf, 'org.apache.sling.distribution'), false);
});

test('manifestImportsPackage ignores packages that appear only in other headers', () => {
  const mf = 'Import-Package: org.osgi.framework\nExport-Package: org.apache.sling.distribution\n';
  assert.strictEqual(manifestImportsPackage(mf, 'org.apache.sling.distribution'), false);
});

test('referencesClassName detects a class by its internal (slash) name', () => {
  const buf = Buffer.from('....!com/day/cq/dam/api/AssetManager.', 'utf8');
  assert.strictEqual(referencesClassName(buf, 'com.day.cq.dam.api.AssetManager'), true);
});

test('referencesClassName does not match the package when the class is absent', () => {
  const buf = Buffer.from('com/day/cq/dam/api/Asset', 'utf8');
  assert.strictEqual(referencesClassName(buf, 'com.day.cq.dam.api.AssetManager'), false);
});

test('topicFromDescriptor reads job.topics and returns null when absent', () => {
  assert.strictEqual(topicFromDescriptor('<property name="job.topics" value="acme/job"/>'), 'acme/job');
  assert.strictEqual(topicFromDescriptor('<scr:component name="x"/>'), null);
});

test('rclFlagsFromDescriptor reads resource.paths and resource.change.types', () => {
  const xml = '<property name="resource.paths" value="/content"/><property name="resource.change.types" value="ADDED"/>';
  assert.deepStrictEqual(rclFlagsFromDescriptor(xml), { hasPaths: true, hasChangeTypes: true });
  assert.deepStrictEqual(rclFlagsFromDescriptor('<x/>'), { hasPaths: false, hasChangeTypes: false });
});



// ── CAM project linkage (migration-runbook.json) ──────────────────

function writeRunbook(dir, project) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'migration-runbook.json'), JSON.stringify({ project }));
}

test('readContext finds migration-runbook.json in a parent directory of the module', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-ctx-up-'));
  writeRunbook(root, { id: 'P9', name: null });
  const module = path.join(root, 'core');
  fs.mkdirSync(module);
  assert.strictEqual(readContext({ project: module }).projectId, 'P9');
  fs.rmSync(root, { recursive: true, force: true });
});

test('readContext prefers the nearest migration-runbook.json over a parent one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-ctx-near-'));
  const module = path.join(root, 'core');
  writeRunbook(root, { id: 'PARENT', name: null });
  writeRunbook(module, { id: 'NEAR', name: null });
  assert.strictEqual(readContext({ project: module }).projectId, 'NEAR');
  fs.rmSync(root, { recursive: true, force: true });
});

test('readContext returns no project when the runbook has project null or is unreadable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-ctx-none-'));
  writeRunbook(root, null);
  assert.strictEqual(readContext({ project: root }).projectId, undefined);
  fs.writeFileSync(path.join(root, 'migration-runbook.json'), '{not json');
  assert.deepStrictEqual(readContext({ project: root }), {});
  fs.rmSync(root, { recursive: true, force: true });
});

test('camReportingNote tells the user when no CAM project is linked and stays silent when one is', () => {
  assert.match(camReportingNote({}), /not reported to CAM: no project linked/);
  assert.strictEqual(camReportingNote({ 'project-id': 'P1' }), null);
});

// ── report by project name (developers don't know the 24-char id) ──────────

test('buildMcpPayload carries project_name when only a name is linked', () => {
  const record = {
    run_id: 'rvc-1', result: 'pass', verification_level: 'runtime',
    started_at: 'a', finished_at: 'b',
    classes: [{ result: 'pass', pattern: 'scheduler', discovered: { fqcn: 'com.acme.Ok' } }],
  };
  const payload = buildMcpPayload(record, { 'project-name': 'WKND Legacy', pattern: 'scheduler' });
  assert.strictEqual(payload.project_name, 'WKND Legacy');
  assert.ok(!('project_id' in payload), 'no project_id when only a name is linked');
});

test('camReportingNote stays silent when a project name is linked', () => {
  assert.strictEqual(camReportingNote({ 'project-name': 'WKND Legacy' }), null);
});

// ── local run report (the no-CAM record) ───────────────────────────────────

test('renderLocalReport includes the run id, result, and each class row', () => {
  const md = renderLocalReport({
    run_id: 'rvc-9', result: 'fail', verification_level: 'runtime',
    started_at: 's', finished_at: 'f',
    classes: [
      { pattern: 'scheduler', result: 'pass', bundle: { symbolic_name: 'com.acme.core', state: 'Active' }, component_state: 'Active', discovered: { fqcn: 'com.acme.Job' } },
      { pattern: 'event-migration', result: 'fail', failure_class: 'runtime.component_unsatisfied', component_state: 'Unsatisfied', class_name: 'com.acme.Bad' },
    ],
  });
  assert.match(md, /rvc-9/);
  assert.match(md, /fail/);
  assert.match(md, /com\.acme\.Job/);
  assert.match(md, /runtime\.component_unsatisfied/);
});

test('renderLocalReport distinguishes a restricted pass from pending reporting', () => {
  const md = renderLocalReport({
    run_id: 'rvc-9', result: 'pass', verification_level: 'runtime',
    classes: [{
      pattern: 'scheduler', result: 'pass',
      discovered: { fqcn: 'com.acme.Job' },
      restricted: true,
      restricted_reason: 'scheduler DS properties not exposed by diagnose-osgi-bundle',
    }],
  });
  assert.match(md, /validation result: pass/);
  assert.match(md, /reporting: pending/);
  assert.match(md, /completion: incomplete/);
  assert.match(md, /com\.acme\.Job: scheduler DS properties not exposed/);
});

test('finalizeReporting requires an acknowledgement for the same run', () => {
  const record = { run_id: 'rvc-9', result: 'pass', classes: [] };
  const finalized = finalizeReporting(record, {
    ok: true, run_id: 'rvc-9', stored_at: '2026-10-08T00:00:00Z', duplicate: false,
  });
  assert.strictEqual(finalized.reporting.status, 'recorded');
  assert.strictEqual(finalized.reporting.stored_at, '2026-10-08T00:00:00Z');
  assert.match(renderLocalReport(finalized), /completion: complete/);
  assert.ok(!record.reporting, 'the validation record is not mutated');
});

test('finalizeReporting leaves failed or mismatched submissions incomplete', () => {
  const record = { run_id: 'rvc-9', result: 'pass', classes: [] };
  for (const receipt of [null, {}, { ok: true }, { ok: true, run_id: 'other' }]) {
    const finalized = finalizeReporting(record, receipt);
    assert.strictEqual(finalized.reporting.status, 'failed');
    assert.match(renderLocalReport(finalized), /completion: incomplete/);
  }
  const finalized = finalizeReporting(record, { ok: false, error: 'cam.apiBaseUrl is not defined' });
  assert.strictEqual(finalized.result, 'pass', 'submission failure does not change validation');
  assert.match(renderLocalReport(finalized), /cam\.apiBaseUrl is not defined/);
});

test('finalizeReporting does not claim downstream event delivery or persist credentials', () => {
  const finalized = finalizeReporting({ run_id: 'rvc-9', result: 'fail', classes: [] }, {
    ok: true, run_id: 'rvc-9', apiToken: 'secret',
  });
  assert.strictEqual(finalized.result, 'fail');
  assert.ok(!JSON.stringify(finalized).includes('secret'));
  assert.match(renderLocalReport(finalized), /event delivery: unconfirmed/);
});

test('finalizeReporting rejects acknowledgements when the validation run id is missing', () => {
  const finalized = finalizeReporting({ result: 'pass', classes: [] }, { ok: true });
  assert.strictEqual(finalized.reporting.status, 'failed');
});

test('writeLocalReport rejects run ids that could escape the report directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-safe-report-'));
  try {
    for (const run_id of ['../migration-runbook', 'rvc-9/../../outside', undefined]) {
      assert.throws(() => writeLocalReport({ run_id, classes: [] }, root), /invalid run_id/);
    }
    assert.ok(!fs.existsSync(path.join(root, 'migration-runbook.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('finalizeReporting does not persist potentially sensitive failure text', () => {
  const finalized = finalizeReporting({ run_id: 'rvc-9', result: 'pass', classes: [] }, {
    ok: false, error: 'Request rejected: Authorization: Bearer secret-value; password=another-secret',
  });
  assert.strictEqual(finalized.reporting.status, 'failed');
  assert.ok(!JSON.stringify(finalized).includes('secret-value'));
  assert.ok(!renderLocalReport(finalized).includes('another-secret'));
});

test('explicit project name is not combined with an inherited runbook project id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-explicit-project-'));
  try {
    fs.writeFileSync(path.join(root, 'migration-runbook.json'), JSON.stringify({
      project: { id: 'inherited-id', name: 'Inherited Project' },
    }));
    fs.mkdirSync(path.join(root, '.validate-migration'));
    fs.writeFileSync(path.join(root, '.validate-migration', 'state.json'), JSON.stringify({
      prepared: [{ pattern: 'scheduler', failure: { result: 'fail', failure_class: 'build.failed' } }],
    }));
    const execution = spawnSync(process.execPath, [
      path.join(__dirname, 'check.js'), '--stage', 'verify', '--project', root,
      '--project-name', 'Requested Project',
    ], { encoding: 'utf8' });
    assert.strictEqual(execution.status, 1, execution.stderr);
    const payloadText = execution.stdout.split('=== submit-migration-validation-result payload ===')[1].split('=== end payload ===')[0];
    const payload = JSON.parse(payloadText);
    assert.strictEqual(payload.project_name, 'Requested Project');
    assert.ok(!('project_id' in payload));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('finalize stage persists reporting status and exits according to the acknowledgement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-finalize-'));
  try {
    const receiptPath = path.join(root, 'receipt.json');
    for (const [result, receipt, exitCode, reportingStatus] of [
      ['pass', { ok: false, error: 'cam.apiBaseUrl is not defined' }, 3, 'failed'],
      ['pass', { ok: true, run_id: 'rvc-9', stored_at: '2026-10-08T00:00:00Z' }, 0, 'recorded'],
      ['fail', { ok: true, run_id: 'rvc-9' }, 1, 'recorded'],
    ]) {
      const report = writeLocalReport({ run_id: 'rvc-9', result, classes: [] }, root);
      fs.writeFileSync(receiptPath, JSON.stringify(receipt));
      const execution = spawnSync(process.execPath, [
        path.join(__dirname, 'check.js'), '--stage', 'finalize',
        '--project', root, '--report', report.jsonPath, '--receipt', receiptPath,
      ], { encoding: 'utf8' });
      assert.strictEqual(execution.status, exitCode, execution.stderr);
      assert.strictEqual(JSON.parse(fs.readFileSync(report.jsonPath, 'utf8')).reporting.status, reportingStatus);
      assert.match(fs.readFileSync(report.mdPath, 'utf8'), new RegExp(`reporting: ${reportingStatus}`));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findRunningSdk discovers an existing SDK on 4602 before considering startup', async (context) => {
  const probes = [];
  context.mock.method(globalThis, 'fetch', async (url) => {
    probes.push(url);
    return { status: url.includes(':4602/') ? 401 : 503 };
  });
  assert.strictEqual(await findRunningSdk(), 'http://localhost:4602');
  assert.deepStrictEqual(probes, [
    'http://localhost:4502/', 'http://localhost:4602/',
  ]);
});

test('findRunningSdk checks 4503 and returns null when no SDK answers', async (context) => {
  const probes = [];
  context.mock.method(globalThis, 'fetch', async (url) => {
    probes.push(url);
    throw new Error('connection refused');
  });
  assert.strictEqual(await findRunningSdk(), null);
  assert.strictEqual(probes.length, 3);
  assert.match(probes[2], /:4503\/$/);
});


test('custom-templates verifies template definition, structure and initial content offline', async () => {
  const TEMPLATE = '/conf/wknd/settings/wcm/templates/content-page-template';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-template-'));
  try {
    const write = (rel, body) => {
      const f = path.join(dir, 'jcr_root', TEMPLATE.slice(1), rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    };
    const staticFile = path.join(dir, 'ui.apps/src/main/content/jcr_root/apps/wknd/templates/content-page-template/.content.xml');
    fs.mkdirSync(path.dirname(staticFile), { recursive: true });
    fs.writeFileSync(staticFile, '<jcr:root jcr:primaryType="cq:Template"><jcr:content sling:resourceType="wknd/components/page">'
      + '<root sling:resourceType="wknd/components/container"><par sling:resourceType="wcm/foundation/components/parsys">'
      + '<title sling:resourceType="wknd/components/title"/><text sling:resourceType="wknd/components/text"/></par></root></jcr:content></jcr:root>');
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir });
    git('init', '-q');
    git('add', 'ui.apps');
    git('commit', '-q', '-m', 'static template');
    const page = (children) => '<jcr:root jcr:primaryType="cq:Page"><jcr:content sling:resourceType="wknd/components/page">'
      + `<root sling:resourceType="wknd/components/container">${children}</root></jcr:content></jcr:root>`;
    write('.content.xml', '<jcr:root jcr:primaryType="cq:Template"/>');
    write('structure/.content.xml', page('<container sling:resourceType="wknd/components/container" editable="{Boolean}true"/>'));
    execFileSync('zip', ['-q', '-r', 'package.zip', 'jcr_root'], { cwd: dir });
    const pkg = path.join(dir, 'package.zip');
    const pat = PATTERNS['custom-templates'];
    assert.strictEqual(pat.mode, 'source-only');
    assert.deepStrictEqual(pat.discover(pkg, {}), { templates: [TEMPLATE] });

    const missing = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE } });
    assert.strictEqual(missing.result, 'fail');
    assert.match(missing.evidence, /missing initial/);

    write('initial/.content.xml', page('<container sling:resourceType="wknd/components/container"><title sling:resourceType="wknd/components/title"/></container>'));
    execFileSync('zip', ['-q', '-r', 'package.zip', 'jcr_root'], { cwd: dir });
    const lost = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir });
    assert.strictEqual(lost.result, 'fail');
    assert.match(lost.evidence, /text \(wknd\/components\/text\)/);

    write('initial/.content.xml', page('<container sling:resourceType="wknd/components/container">'
      + '<title sling:resourceType="wknd/components/title"/><text sling:resourceType="wknd/components/text"/></container>'));
    execFileSync('zip', ['-q', '-r', 'package.zip', 'jcr_root'], { cwd: dir });
    const ok = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir });
    assert.strictEqual(ok.result, 'pass');
    assert.deepStrictEqual(ok.checks, { template_definition: true, structure: true, initial: true, policies: false, component_mapping: true });

    const noBaseline = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir, staticTemplate: '/apps/wknd/templates/missing' });
    const optionRef = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir, baselineRef: '--output=/tmp/vm-injected' });
    assert.strictEqual(optionRef.checks.component_mapping, 'not_verified');
    assert.ok(!fs.existsSync('/tmp/vm-injected'));
    assert.strictEqual(noBaseline.result, 'pass');
    assert.strictEqual(noBaseline.restricted, true);
    assert.strictEqual(noBaseline.checks.component_mapping, 'not_verified');
    const noBaselineRuntime = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir,
      staticTemplate: '/apps/wknd/templates/missing', requireRuntime: true });
    assert.strictEqual(noBaselineRuntime.result, 'fail');

    const runtime = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir, requireRuntime: true });
    assert.strictEqual(runtime.result, 'fail');
    assert.strictEqual(runtime.checks.runtime_evidence, false);

    const { createHash } = require('crypto');
    const { PNG } = require('pngjs');
    const evidencePath = path.join(dir, 'template-evidence.json');
    const captures = [
      { viewport: { width: 1440, height: 900 }, source: 'source-desktop.png', target: 'target-desktop.png', result: 'pass', differences: [] },
      { viewport: { width: 390, height: 844 }, source: 'source-mobile.png', target: 'target-mobile.png', result: 'pass', differences: [] },
    ];
    for (const capture of captures) {
      const png = PNG.sync.write(new PNG({ width: capture.viewport.width, height: capture.viewport.height }));
      fs.writeFileSync(path.join(dir, capture.source), png);
      fs.writeFileSync(path.join(dir, capture.target), png);
    }
    const evidence = {
      template: TEMPLATE,
      artifact_sha256: createHash('sha256').update(fs.readFileSync(pkg)).digest('hex'),
      captured_at: new Date().toISOString(),
      deployment: { target_origin: 'http://localhost:4602', status: 'succeeded',
        bundles: [{ symbolic_name: 'com.adobe.aem.guides.aem-guides-wknd.core', state: 'Active' }] },
      source: { url: 'http://localhost:4502/content/wknd/test.html?wcmmode=disabled', template: '/apps/wknd/templates/content-page', status: 200,
        components: ['legacy/topnav', 'legacy/hero', 'legacy/hero'], texts: ['WKND Adventures'], images: ['/content/dam/wknd/hero.jpg'] },
      target: { url: 'http://localhost:4602/content/wknd/test.html?wcmmode=disabled', template: TEMPLATE, status: 200,
        components: ['modern/topnav', 'legacy/hero', 'legacy/hero'], texts: ['WKND Adventures'], images: ['/content/dam/wknd/hero.jpg'] },
      component_mapping: { 'legacy/topnav': 'modern/topnav' },
      captures,
      cleanup: { status: 'not_required', created_pages: [] },
    };
    const verifyEvidence = async (value) => {
      fs.writeFileSync(evidencePath, JSON.stringify(value));
      return pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir, requireRuntime: true, runtimeEvidencePath: evidencePath });
    };
    const compared = await verifyEvidence(evidence);
    assert.strictEqual(compared.result, 'pass');
    assert.strictEqual(compared.verification_level, 'runtime');
    assert.strictEqual(compared.checks.component_parity, true);
    assert.strictEqual(compared.checks.bundles_active, true);
    assert.strictEqual(compared.checks.business_behavior, 'not_tested');

    const record = { run_id: 'template-runtime-test', result: compared.result, verification_level: compared.verification_level,
      started_at: evidence.captured_at, finished_at: evidence.captured_at,
      classes: [{ pattern: 'custom-templates', discovered: { template: TEMPLATE }, ...compared }] };
    const markdown = renderLocalReport(record, path.join(dir, '.validate-migration'));
    assert.match(markdown, /## Template Comparison/);
    assert.match(markdown, /\(\.\.\/source-desktop\.png\)/);
    assert.match(markdown, /authoring and business behavior not tested/);
    const payload = buildMcpPayload(record, { pattern: 'custom-templates', 'project-id': 'template-test' });
    assert.strictEqual(payload.verification_level, 'runtime');
    assert.ok(JSON.stringify(payload).includes('target-mobile.png'));
    assert.ok(!JSON.stringify(payload).includes(dir) && !JSON.stringify(payload).includes(fs.realpathSync(dir)), 'payload must not leak local paths');

    const { spawnSync } = require('child_process');
    const prepare = spawnSync(process.execPath, [require.resolve('./check.js'), '--stage', 'prepare', '--pattern', 'custom-templates',
      '--project', dir, '--jar', pkg, '--template', TEMPLATE, '--template-mode', 'runtime'], { encoding: 'utf8' });
    assert.ok([0, 3].includes(prepare.status), prepare.stderr || prepare.stdout);
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.validate-migration/state.json'), 'utf8'));
    assert.strictEqual(state.prepared[0].requireRuntime, true);
    const withoutEvidence = spawnSync(process.execPath, [require.resolve('./check.js'), '--stage', 'verify', '--project', dir], { encoding: 'utf8' });
    assert.strictEqual(withoutEvidence.status, 1, withoutEvidence.stderr || withoutEvidence.stdout);
    evidence.captured_at = new Date().toISOString();
    for (const capture of captures) {
      const png = PNG.sync.write(new PNG({ width: capture.viewport.width, height: capture.viewport.height }));
      fs.writeFileSync(path.join(dir, capture.source), png);
      fs.writeFileSync(path.join(dir, capture.target), png);
    }
    fs.writeFileSync(evidencePath, JSON.stringify(evidence));
    const withEvidence = spawnSync(process.execPath, [require.resolve('./check.js'), '--stage', 'verify', '--project', dir,
      '--template-evidence', evidencePath], { encoding: 'utf8' });
    assert.strictEqual(withEvidence.status, 3, withEvidence.stderr || withEvidence.stdout);
    const reports = fs.readdirSync(path.join(dir, '.validate-migration')).filter((name) => /^rvc-.*\.json$/.test(name));
    assert.ok(reports.some((name) => {
      const report = JSON.parse(fs.readFileSync(path.join(dir, '.validate-migration', name), 'utf8'));
      return report.result === 'pass' && report.verification_level === 'runtime';
    }));

    const invalidCases = [
      ['missing duplicate component', (value) => value.target.components.pop()],
      ['missing text', (value) => { value.target.texts = []; }],
      ['missing image', (value) => { value.target.images = []; }],
      ['visual difference', (value) => { value.captures[0].result = 'fail'; value.captures[0].differences = ['Hero overlaps the title']; }],
      ['visual check not performed', (value) => { value.captures[0].result = 'not_verified'; }],
      ['missing mobile capture', (value) => { value.captures.pop(); }],
      ['wrong artifact', (value) => { value.artifact_sha256 = '0'.repeat(64); }],
      ['stale evidence', (value) => { value.captured_at = '2000-01-01T00:00:00.000Z'; }],
      ['wrong template', (value) => { value.target.template = '/conf/wknd/settings/wcm/templates/other'; }],
      ['same instance', (value) => { value.target.url = value.source.url; }],
      ['credentials in URL', (value) => { value.source.url = 'http://user:private@localhost:4502/content/source.html'; }],
      ['failed page render', (value) => { value.target.status = 500; }],
      ['failed deployment', (value) => { value.deployment.status = 'failed'; }],
      ['bundle state not checked', (value) => { delete value.deployment.bundles; }],
      ['different page', (value) => { value.target.url = 'http://localhost:4602/content/wknd/other.html?wcmmode=disabled'; }],
      ['bundle not active', (value) => { value.deployment.bundles[0].state = 'Resolved'; }],
      ['cleanup failure', (value) => { value.cleanup = { status: 'failed', created_pages: ['/content/rv-test/page'] }; }],
      ['unconfirmed cleanup', (value) => { value.cleanup.created_pages = ['/content/rv-test/page']; }],
      ['empty inventory', (value) => { value.source.components = []; }],
      ['malformed source template', (value) => { value.source.template = {}; }],
      ['malformed capture', (value) => { value.captures = [null, null]; }],
    ];
    for (const [name, mutate] of invalidCases) {
      const invalid = structuredClone(evidence);
      mutate(invalid);
      const outcome = await verifyEvidence(invalid);
      assert.strictEqual(outcome.result, 'fail', name);
    }
    await verifyEvidence(evidence);
    const stale = await pat.verify({ artifactPath: pkg, discovered: { template: TEMPLATE }, projectDir: dir, requireRuntime: true,
      runtimeEvidencePath: evidencePath, runStartedAt: new Date(Date.now() + 60_000).toISOString() });
    assert.strictEqual(stale.result, 'fail', 'evidence from before the prepared run');
    const missingCleanup = structuredClone(evidence);
    delete missingCleanup.cleanup;
    const failedCleanup = await verifyEvidence(missingCleanup);
    assert.strictEqual(failedCleanup.result, 'fail');
    assert.doesNotThrow(() => renderLocalReport({ ...record, result: 'fail', classes: [{ pattern: 'custom-templates', ...failedCleanup }] }));
    await verifyEvidence(evidence);
    fs.writeFileSync(path.join(dir, captures[0].source), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(25)]));
    assert.strictEqual((await verifyEvidence(evidence)).result, 'fail', 'corrupt PNG screenshot');
    const tiny = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    fs.writeFileSync(path.join(dir, captures[0].source), tiny);
    assert.strictEqual((await verifyEvidence(evidence)).result, 'fail', 'screenshot dimensions must match the viewport');
    fs.unlinkSync(path.join(dir, captures[0].source));
    assert.strictEqual((await verifyEvidence(evidence)).result, 'fail', 'missing screenshot artifact');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('discoverTemplates finds and selects editable templates in a content package', () => {
  const { discoverTemplates } = require('./check/patterns/custom-templates/discover.js');
  const TEMPLATE = '/conf/wknd/settings/wcm/templates/content-page-template';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-discover-'));
  try {
    const entry = path.join(dir, 'jcr_root', TEMPLATE.slice(1), '.content.xml');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '<jcr:root/>');
    execFileSync('zip', ['-q', '-r', 'package.zip', 'jcr_root'], { cwd: dir });
    const pkg = path.join(dir, 'package.zip');
    assert.deepStrictEqual(discoverTemplates(pkg), [TEMPLATE]);
    assert.deepStrictEqual(discoverTemplates(pkg, TEMPLATE), [TEMPLATE]);
    assert.deepStrictEqual(discoverTemplates(pkg, TEMPLATE.replace('content-page', 'other')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify emits independent payloads and reports for two templates', () => {
  const TEMPLATE = '/conf/wknd/settings/wcm/templates/content-page-template';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-template-reports-'));
  try {
    const state = path.join(dir, '.validate-migration');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'state.json'), JSON.stringify({ prepared: [TEMPLATE, TEMPLATE.replace('content-page', 'article-page')].map((template) => ({
      pattern: 'custom-templates', discovered: { template }, failure: {
        result: 'fail', failure_class: 'source.contract_mismatch', evidence: 'test fixture', verification_level: 'source-only',
      },
    })) }));
    const execution = spawnSync(process.execPath, [path.join(__dirname, 'check.js'), '--stage', 'verify', '--project', dir, '--project-id', 'test-project'], { encoding: 'utf8' });
    assert.strictEqual(execution.status, 1, execution.stderr);
    const payloads = [...execution.stdout.matchAll(/=== submit-migration-validation-result payload ===\n([^\n]+)/g)].map((m) => JSON.parse(m[1]));
    assert.strictEqual(payloads.length, 2);
    assert.notStrictEqual(payloads[0].run_id, payloads[1].run_id);
    assert.strictEqual(payloads[0].skill_pattern, 'custom-templates');
    assert.strictEqual(payloads[0].summary.classes_total, 1);
    assert.strictEqual(fs.readdirSync(state).filter((file) => /^rvc-\d+\.json$/.test(file)).length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeLocalReport writes <run_id>.md and <run_id>.json under .validate-migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-report-'));
  const record = {
    run_id: 'rvc-7', result: 'pass', verification_level: 'source-only',
    started_at: 's', finished_at: 'f',
    classes: [{ pattern: 'legacy-ui', result: 'pass' }],
  };
  const out = writeLocalReport(record, root);
  assert.ok(fs.existsSync(out.mdPath), 'markdown report written');
  assert.ok(fs.existsSync(out.jsonPath), 'json report written');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out.jsonPath, 'utf8')).run_id, 'rvc-7');
  assert.match(fs.readFileSync(out.mdPath, 'utf8'), /rvc-7/);
  fs.rmSync(root, { recursive: true, force: true });
});
