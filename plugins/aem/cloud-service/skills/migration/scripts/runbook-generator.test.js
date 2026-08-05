'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runHtlLint, classify } = require('./htl-lint-runner.js');
const { runOsgiConfigScan } = require('./osgi-config-runner.js');
const { runLuiScan, runCdwScan } = require('./legacy-ui-runner.js');
const { runTemplateScan } = require('./template-scan-runner.js');
const { runAnalyzer } = require('./analyzer-runner.js');
const {
  gatherFindings, generateRunbook, renderRunbook, writeRunbookCache,
  samplePrompt, CANONICAL_PATTERNS, PATTERN_META,
} = require('./runbook-generator.js');

function mkworkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runbook-test-'));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// ── Pattern registry ────────────────────────────────────────────────────────

test('registry includes all 10 migration patterns with a valid strategy', () => {
  const expected = [
    'scheduler', 'resourceChangeListener', 'event-migration', 'assetApi', 'replication',
    'htlLint', 'osgiConfig', 'lui', 'cdw', 'templateModernization',
  ];
  assert.strictEqual(CANONICAL_PATTERNS.length, expected.length, 'no unexpected patterns');
  for (const key of expected) {
    assert.ok(CANONICAL_PATTERNS.includes(key), `${key} in CANONICAL_PATTERNS`);
    assert.ok(
      ['cascade', 'html-scan', 'config-scan', 'content-scan'].includes(PATTERN_META[key].strategy),
      `${key} has a valid strategy`
    );
  }
});

test('inject-in-sling-model and outdated-dependencies stay out of scope', () => {
  assert.ok(!CANONICAL_PATTERNS.includes('inject-in-sling-model'));
  assert.ok(!CANONICAL_PATTERNS.includes('outdated-dependencies'));
});

// ── htl-lint-runner ───────────────────────────────────────────────────────

test('classify labels each anti-pattern class', () => {
  assert.strictEqual(classify('<div data-sly-test="${x == true}">'), 'boolean-literal');
  assert.strictEqual(classify("<div data-sly-test='/apps/foo'>"), 'apps-string-as-test');
  assert.strictEqual(classify('<div data-sly-test="${a} || ${b}">'), 'split-logical-across-expr');
  assert.strictEqual(classify('<div data-sly-test="${x == 5}">'), 'numeric-literal');
});

test('runHtlLint finds data-sly-test anti-patterns in .html', () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/comp/hero.html', '<div data-sly-test="${properties.x == true}">hi</div>\n');
  write(root, 'ui.apps/jcr_root/apps/comp/clean.html', '<div data-sly-test="${properties.enabled}">ok</div>\n');
  const res = runHtlLint(root);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.findings.length, 1);
  assert.match(res.findings[0].detail, /boolean-literal/);
  assert.strictEqual(res.rawFindings[0].pattern, 'htlLint');
  assert.ok(res.rawFindings[0].line > 0);
});

test('runHtlLint returns empty (ok) when nothing matches', () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/comp/clean.html', '<div data-sly-test="${properties.enabled}">ok</div>\n');
  const res = runHtlLint(root);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.findings.length, 0);
});

// ── osgi-config-runner ──────────────────────────────────────────────────────

test('runOsgiConfigScan flags plaintext secret keys WITHOUT leaking the value', () => {
  const root = mkworkspace();
  const secretValue = 'sup3rSecretP@ss';
  write(root, 'ui.config/src/main/content/jcr_root/apps/my/config/com.my.Svc.cfg.json',
    `{\n  "api-key": "${secretValue}",\n  "endpoint": "https://example.com"\n}\n`);
  const res = runOsgiConfigScan(root);
  assert.strictEqual(res.ok, true);
  const secretFinding = res.rawFindings.find(f => f.kind === 'plaintext-secret');
  assert.ok(secretFinding, 'a plaintext-secret finding is produced');
  assert.match(secretFinding.snippet, /<redacted>/);
  // The value must never appear anywhere in the output.
  const blob = JSON.stringify(res);
  assert.ok(!blob.includes(secretValue), 'secret value must not leak into findings');
});

test('runOsgiConfigScan flags already-placeholdered files and legacy formats', () => {
  const root = mkworkspace();
  write(root, 'ui.config/src/main/content/jcr_root/apps/my/config.publish/com.my.Placeheld.cfg.json',
    '{\n  "password": "$[secret:my-pw]"\n}\n');
  write(root, 'ui.config/src/main/content/jcr_root/apps/my/config/com.my.Legacy.config',
    'my.prop="value"\n');
  const res = runOsgiConfigScan(root);
  const kinds = res.rawFindings.map(f => f.kind);
  assert.ok(kinds.includes('already-placeholdered'));
  assert.ok(kinds.includes('legacy-format'));
  // A key already using a placeholder is NOT flagged as plaintext-secret.
  assert.ok(!kinds.includes('plaintext-secret'));
});

test('runOsgiConfigScan ignores non-config folders and repoinit secret keys', () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/my/components/notaconfig.cfg.json', '{ "password": "x" }\n');
  write(root, 'ui.config/jcr_root/apps/my/config/org.apache.sling.jcr.repoinit.RepositoryInitializer-my.cfg.json',
    '{ "scripts": ["create user with password abc"] }\n');
  const res = runOsgiConfigScan(root);
  assert.ok(!res.rawFindings.some(f => f.kind === 'plaintext-secret'),
    'files outside config folders and repoinit files are not flagged for plaintext secrets');
});

// ── orchestrator dispatch + cache tagging ────────────────────────────────────

test('gatherFindings dispatches rg + config-scan and tags heuristic in cache', async () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/comp/hero.html', '<div data-sly-test="${x == false}">x</div>\n');
  write(root, 'ui.config/jcr_root/apps/my/config/com.my.Svc.cfg.json', '{ "secret-token": "abc123" }\n');
  // No BPA source, no Java project → cascade patterns go to needsLlmScan or analyzer(empty).
  const gathered = await gatherFindings({ workspaceRoot: root });

  assert.strictEqual(gathered.sourceByPattern.htlLint, 'html-scan');
  assert.ok(gathered.findingsByPattern.htlLint.length >= 1);
  assert.strictEqual(gathered.sourceByPattern.osgiConfig, 'config-scan');
  assert.ok(gathered.findingsByPattern.osgiConfig.length >= 1);

  const cachePath = path.join(root, 'cache.json');
  writeRunbookCache(gathered, { generatedAt: 'now' }, cachePath);
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const f of cache.findingsByPattern.osgiConfig) {
    assert.strictEqual(f.confidence, 'heuristic');
  }
  for (const f of cache.findingsByPattern.htlLint) {
    assert.strictEqual(f.confidence, 'heuristic');
  }
});

test('cascade findings are NOT tagged heuristic', async () => {
  const root = mkworkspace();
  const gathered = await gatherFindings({ workspaceRoot: root });
  const cachePath = path.join(root, 'cache.json');
  writeRunbookCache(gathered, { generatedAt: 'now' }, cachePath);
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const f of cache.findingsByPattern.scheduler || []) {
    assert.notStrictEqual(f.confidence, 'heuristic');
  }
});

test('samplePrompt uses the OSGi natural-language override', () => {
  assert.match(samplePrompt('osgiConfig', {}), /scan my config files/i);
  assert.match(samplePrompt('scheduler', {}), /migration skill: \*\*scheduler\*\* only/);
});

test('renderRunbook shows a heuristic note and never emits secret values', async () => {
  const root = mkworkspace();
  write(root, 'ui.config/jcr_root/apps/my/config/com.my.Svc.cfg.json', '{ "password": "leakme-please-9000" }\n');
  const gathered = await gatherFindings({ workspaceRoot: root });
  const md = renderRunbook(gathered, { generatedAt: 'now' });
  assert.match(md, /Heuristic detection/);
  assert.ok(!md.includes('leakme-please-9000'), 'secret value must not appear in the rendered runbook');
});

// ── regression: compact / multi-property JSON must not hide secrets ─────────

test('runOsgiConfigScan catches a secret that is not the first property on a line', () => {
  const root = mkworkspace();
  write(root, 'ui.config/jcr_root/apps/my/config/com.my.Svc.cfg.json',
    '{"endpoint":"https://x","apiPassword":"HUNTER2_LEAK","token":"$[secret:t]"}');
  const res = runOsgiConfigScan(root);
  assert.ok(res.rawFindings.some(f => f.kind === 'plaintext-secret' && /apiPassword/.test(f.snippet)),
    'secret after the first property on a compact line must be caught');
  assert.ok(!JSON.stringify(res).includes('HUNTER2_LEAK'), 'secret value must not leak');
});

test('runOsgiConfigScan emits no XML warning when there are no config files', () => {
  const root = mkworkspace();
  write(root, 'core/src/main/java/J.java', 'class J {}\n');
  const res = runOsgiConfigScan(root);
  assert.strictEqual(res.warnings.length, 0);
});

// ── already-placeholdered is informational, not counted as work ─────────────

test('already-placeholdered findings do not count as outstanding work', async () => {
  const root = mkworkspace();
  write(root, 'ui.config/jcr_root/apps/my/config/com.my.Done.cfg.json', '{ "password": "$[secret:pw]" }\n');
  const out = path.join(root, 'rb.md');
  const cache = path.join(root, 'rb.json');
  const result = await generateRunbook({ workspaceRoot: root, outputPath: out, cachePath: cache });
  // informational only → zero actionable findings for osgiConfig
  assert.strictEqual(result.patternCounts.osgiConfig, 0);
  // but the informational row is still present in the gathered findings + cache
  assert.ok(result.gathered.findingsByPattern.osgiConfig.some(f => f.informational));
  const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.ok(cached.findingsByPattern.osgiConfig.some(f => f.kind === 'already-placeholdered' && f.informational));
});

// ── paths are workspace-relative in both the runbook and the cache ──────────

test('generateRunbook writes workspace-relative paths, not absolute', async () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/comp/hero.html', '<div data-sly-test="${x == true}">x</div>\n');
  const out = path.join(root, 'rb.md');
  const cache = path.join(root, 'rb.json');
  await generateRunbook({ workspaceRoot: root, outputPath: out, cachePath: cache });

  const md = fs.readFileSync(out, 'utf8');
  assert.ok(!md.includes(root), 'rendered runbook must not contain the absolute workspace path');
  assert.match(md, /ui\.apps\/jcr_root\/apps\/comp\/hero\.html/);

  const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.strictEqual(cached.workspaceRoot, root);
  for (const f of cached.findingsByPattern.htlLint) {
    assert.ok(!path.isAbsolute(f.file), 'cache file paths must be relative');
  }
});

// ── htlLint word boundary: identifiers starting with true/false not flagged ─

test('classify does not flag identifiers like trueFlag / falseHood', () => {
  assert.strictEqual(classify('<div data-sly-test="${x == trueFlag}">'), null);
  assert.strictEqual(classify('<div data-sly-test="${x != falseHood}">'), null);
  assert.strictEqual(classify('<div data-sly-test="${x == true}">'), 'boolean-literal');
});

// ── content-scan: lui / cdw / template ──────────────────────────────────────

test('runCdwScan flags custom xtypes but not known-safe ones', () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/my/components/c/dialog/.content.xml',
    '<jcr:root><items><a jcr:primaryType="cq:Widget" xtype="textfield"/><b jcr:primaryType="cq:Widget" xtype="my-colorpicker"/></items></jcr:root>');
  const res = runCdwScan(root);
  const xtypes = res.rawFindings.map(f => f.xtype);
  assert.ok(xtypes.includes('my-colorpicker'), 'custom xtype flagged');
  assert.ok(!xtypes.includes('textfield'), 'known-safe xtype not flagged');
});

test('runLuiScan flags classic and coral2 dialogs, not coral3', () => {
  const root = mkworkspace();
  write(root, 'a/dialog/.content.xml', '<jcr:root jcr:primaryType="cq:Dialog"/>');
  write(root, 'b/_cq_dialog/.content.xml', '<jcr:root sling:resourceType="granite/ui/components/foundation/container"/>');
  write(root, 'c/_cq_dialog/.content.xml', '<jcr:root sling:resourceType="granite/ui/components/coral/foundation/container"/>');
  const res = runLuiScan(root);
  const subs = res.rawFindings.map(f => f.subType);
  assert.ok(subs.includes('legacy.dialog.classic'));
  assert.ok(subs.includes('legacy.dialog.coral2'));
  assert.strictEqual(res.rawFindings.length, 2, 'coral3 dialog must not be flagged');
});

test('runTemplateScan flags static templates under apps/*/templates/*', () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/my/templates/content-page/.content.xml',
    '<jcr:root jcr:primaryType="cq:Template"/>');
  write(root, 'ui.apps/jcr_root/apps/my/components/foo/.content.xml',
    '<jcr:root jcr:primaryType="cq:Template"/>'); // not under templates/ → ignored
  const res = runTemplateScan(root);
  assert.strictEqual(res.rawFindings.length, 1);
  assert.strictEqual(res.rawFindings[0].subType, 'legacy.static.template');
  assert.match(res.findings[0].detail, /content-page/);
});

test('gatherFindings dispatches content-scan patterns as heuristic', async () => {
  const root = mkworkspace();
  write(root, 'ui.apps/jcr_root/apps/my/components/c/dialog/.content.xml',
    '<jcr:root jcr:primaryType="cq:Dialog"><items><w jcr:primaryType="cq:Widget" xtype="my-widget"/></items></jcr:root>');
  write(root, 'ui.apps/jcr_root/apps/my/templates/t/.content.xml', '<jcr:root jcr:primaryType="cq:Template"/>');
  // Isolate collectionsDir so no ambient BPA collection pre-empts content-scan.
  const gathered = await gatherFindings({ workspaceRoot: root, collectionsDir: path.join(root, 'no-collections') });
  for (const p of ['lui', 'cdw', 'templateModernization']) {
    assert.strictEqual(gathered.sourceByPattern[p], 'content-scan', `${p} scanned via content-scan`);
    assert.ok(gathered.findingsByPattern[p].length >= 1, `${p} has a finding`);
  }
  const cache = path.join(root, 'c.json');
  writeRunbookCache(gathered, { generatedAt: 'now', workspaceRoot: root }, cache);
  const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
  for (const p of ['lui', 'cdw', 'templateModernization']) {
    for (const f of cached.findingsByPattern[p]) assert.strictEqual(f.confidence, 'heuristic');
  }
});

test('lui/cdw/template sample prompts route to the migration branches', () => {
  assert.match(samplePrompt('lui', {}), /LUI dialog|Coral 3/i);
  assert.match(samplePrompt('cdw', {}), /CDW|custom ExtJS/i);
  assert.match(samplePrompt('templateModernization', {}), /editable templates/i);
});

// ── analyzer-runner: slug normalization + ok:false branches (stub analyze.sh) ─

function writeAnalyzeStub(root, body) {
  const p = path.join(root, 'analyze.sh');
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

test('runAnalyzer normalizes analyzer slugs and skips non-migration patterns', () => {
  const root = mkworkspace();
  const payload = { findings: [
    { pattern: 'scheduler', file: 'A.java', line: 3, snippet: 'Scheduler s;' },
    { pattern: 'resource-change-listener', file: 'B.java', line: 5, snippet: 'impl RCL' },
    { pattern: 'asset-manager', file: 'C.java', line: 7, snippet: 'AssetManager.createAsset' },
    { pattern: 'inject-in-sling-model', file: 'D.java', line: 9, snippet: '@Inject' },
  ], warnings: ['w1'] };
  const stub = writeAnalyzeStub(root, `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify(payload)}\nJSON\n`);
  const res = runAnalyzer(root, { analyzeScript: stub });
  assert.strictEqual(res.ok, true);
  assert.ok(res.findingsByPattern.scheduler, 'scheduler kept');
  assert.ok(res.findingsByPattern.resourceChangeListener, 'resource-change-listener → resourceChangeListener');
  assert.ok(res.findingsByPattern.assetApi, 'asset-manager → assetApi');
  assert.ok(!res.findingsByPattern['inject-in-sling-model'], 'non-migration slug dropped');
  assert.deepStrictEqual(res.warnings, ['w1']);
  assert.strictEqual(res.rawFindingsByPattern.scheduler[0].line, 3);
});

test('runAnalyzer returns ok:false on non-zero exit', () => {
  const root = mkworkspace();
  const stub = writeAnalyzeStub(root, '#!/usr/bin/env bash\necho "compile error" >&2\nexit 5\n');
  const res = runAnalyzer(root, { analyzeScript: stub });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /compile error|code 5/);
});

test('runAnalyzer returns ok:false on unparseable output', () => {
  const root = mkworkspace();
  const stub = writeAnalyzeStub(root, '#!/usr/bin/env bash\necho "not json at all"\n');
  const res = runAnalyzer(root, { analyzeScript: stub });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /parse/i);
});

// ── BPA parsing of the new subtypes (parser + reader) ───────────────────────

const { getBpaFindings } = require('./bpa-findings-helper.js');

function writeBpaCsv(root) {
  const rows = [
    'code,type,subtype,importance,identifier,message,context',
    // CDW — note underscore in path (design_dialog) must survive round-trip.
    'CDW,custom.dialog.widget,custom.classic.widget,MAJOR,/apps/x/components/c/design_dialog/items/w1,Custom widget,ctx',
    'CDW,custom.dialog.widget,custom.classic.widget,MAJOR,/apps/x/components/c/dialog/items/w2,Custom widget,ctx',
    // LUI — dialogs + a static-template sub-type (should NOT count under lui).
    'LUI,legacy.user.interface,legacy.dialog.classic,MAJOR,/apps/x/components/c/dialog,Classic dialog,ctx',
    'LUI,legacy.user.interface,legacy.dialog.coral2,MAJOR,/apps/x/components/c/_cq_dialog,Coral2 dialog,ctx',
    'LUI,legacy.user.interface,legacy.static.template,MINOR,/apps/x/templates/t1,Static template,ctx',
    // CTEM — another static template.
    'CTEM,custom.template,custom.static.template,MINOR,/apps/x/templates/t2,Static template,ctx',
    // REP — one real forward finding + a summary row that must be excluded.
    'REP,replication.agent,forward.replication,MAJOR,agent-1,Forward replication agent,ctx',
    '_COUNT_REP,_count.replication.agent,forward.replication,INFO,\\N,summary,ctx',
  ];
  const p = path.join(root, 'bpa.csv');
  fs.writeFileSync(p, rows.join('\n') + '\n', 'utf8');
  return p;
}

test('BPA parser extracts cdw/lui/template/replication and excludes _COUNT rows', async () => {
  const root = mkworkspace();
  const csv = writeBpaCsv(root);
  const opts = { bpaFilePath: csv, collectionsDir: path.join(root, 'uc'), limit: null, offset: 0 };

  const cdw = await getBpaFindings('cdw', opts);
  assert.strictEqual(cdw.targets.length, 2);
  // Underscore path must survive the unified round-trip (no design_dialog → design.dialog).
  assert.ok(cdw.targets.some(t => t.className.includes('design_dialog')), 'underscore path preserved');

  const rep = await getBpaFindings('replication', opts);
  assert.strictEqual(rep.targets.length, 1, '_COUNT_REP summary row excluded');

  const tpl = await getBpaFindings('templateModernization', opts);
  assert.strictEqual(tpl.targets.length, 2, 'legacy.static.template + custom.static.template');
});

test('a real BPA fetch failure is surfaced (warning + needsLlmScan), NOT reported clean', async () => {
  const root = mkworkspace();
  const gathered = await gatherFindings({
    workspaceRoot: root,
    collectionsDir: path.join(root, 'uc'),                 // no cached collection
    projectId: 'proj-1',                                   // + mcpFetcher ⇒ bpaMode='mcp'
    mcpFetcher: async () => { throw new Error('MCP down'); },
    analyzeScript: path.join(root, 'missing-analyze.sh'),  // analyzer unavailable
  });
  // scheduler is a cascade BPA pattern; the fetch threw — it must NOT be marked
  // as cleanly scanned by BPA, and must be surfaced for follow-up.
  assert.notStrictEqual(gathered.sourceByPattern.scheduler, 'mcp');
  assert.ok(gathered.needsLlmScan.includes('scheduler'), 'failed pattern surfaced in needsLlmScan');
  assert.ok(
    gathered.analyzerWarnings.some(w => /BPA fetch failed.*scheduler/.test(w)),
    'a Scan-warnings entry names the failed pattern'
  );
});

test('benign "pattern not in CSV" stays silent and counts as clean', async () => {
  const root = mkworkspace();
  const csv = writeBpaCsv(root); // has cdw/lui/etc but NOT scheduler
  const gathered = await gatherFindings({
    workspaceRoot: root, bpaFilePath: csv, collectionsDir: path.join(root, 'uc'),
    analyzeScript: path.join(root, 'missing-analyze.sh'),
  });
  // scheduler is absent from the report → genuinely clean, sourced from csv, no warning.
  assert.strictEqual(gathered.sourceByPattern.scheduler, 'csv');
  assert.strictEqual(gathered.findingsByPattern.scheduler.length, 0);
  assert.ok(!gathered.needsLlmScan.includes('scheduler'));
  assert.ok(!gathered.analyzerWarnings.some(w => /scheduler/.test(w)), 'no warning for a benign absence');
});

test('runbook lui is filtered to dialog sub-types when sourced from BPA', async () => {
  const root = mkworkspace();
  const csv = writeBpaCsv(root);
  const out = path.join(root, 'rb.md');
  const cache = path.join(root, 'rb.json');
  const result = await generateRunbook({
    workspaceRoot: root, bpaFilePath: csv, collectionsDir: path.join(root, 'uc'),
    outputPath: out, cachePath: cache,
  });
  assert.strictEqual(result.patternCounts.lui, 2, 'only classic + coral2, not static.template');
  assert.strictEqual(result.patternCounts.cdw, 2);
  assert.strictEqual(result.patternCounts.templateModernization, 2);
  assert.strictEqual(result.gathered.sourceByPattern.lui, 'csv');
});
