'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runIntegrationScan, renderIntegrationDiscovery, loadCatalog, scoreConfidence, fileKind,
} = require('./integration-scanner.js');
const { generateRunbook, renderRunbook } = require('./runbook-generator.js');

function mkworkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'integration-scan-test-'));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}
const JAVA = 'core/src/main/java/com/acme';
const CONFIG = 'ui.config/src/main/content/jcr_root/apps/acme/osgiconfig/config';
const APPS = 'ui.apps/src/main/content/jcr_root/apps/acme/components';
const byId = (res, id) => res.integrations.find(r => r.id === id);
const pom = deps => `<project><modelVersion>4.0.0</modelVersion><dependencies>\n${deps.map(([g, a]) => `  <dependency>\n    <groupId>${g}</groupId>\n    <artifactId>${a}</artifactId>\n  </dependency>`).join('\n')}\n</dependencies></project>\n`;

// ── Catalog ──────────────────────────────────────────────────────────────────

test('catalog loads, compiles every regex, and uses only the three categories', () => {
  const catalog = loadCatalog();
  assert.ok(catalog.integrations.length >= 12);
  for (const integ of catalog.integrations) {
    assert.ok(['adobe-product', 'third-party', 'customer-external'].includes(integ.category));
    assert.ok(integ.signals.length > 0, `${integ.id} has signals`);
    for (const c of integ.migrationConsiderations) assert.ok(catalog.considerations[c], `${integ.id}: unknown consideration ${c}`);
  }
});

test('catalog keeps third-party integrations out of the adobe-product category', () => {
  const catalog = loadCatalog();
  const adobe = catalog.integrations.filter(i => i.category === 'adobe-product').map(i => i.id).sort();
  assert.deepStrictEqual(adobe, ['adobe-commerce-cif', 'adobe-target']);
});

test('loadCatalog rejects duplicate signal ids and unknown strengths', () => {
  const dir = mkworkspace();
  const sig = { id: 'x', type: 'endpoint', strength: 'strong', pattern: 'x', indicator: 'x' };
  const base = { id: 'a', name: 'A', category: 'third-party', migrationConsiderations: [] };
  const dup = write(dir, 'dup.json', JSON.stringify({ integrations: [{ ...base, signals: [sig, sig] }], genericExternalApi: {} }));
  assert.throws(() => loadCatalog(dup), /duplicate or missing signal id/);
  const bad = write(dir, 'bad.json', JSON.stringify({ integrations: [{ ...base, signals: [{ ...sig, strength: 'maybe' }] }] }));
  assert.throws(() => loadCatalog(bad), /unknown strength/);
});

test('an unreadable catalog yields a not-run result with a warning, never a clean scan', () => {
  const root = mkworkspace();
  const res = runIntegrationScan(root, { catalogPath: path.join(root, 'missing.json') });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'not-run');
  assert.match(res.warnings[0], /catalog could not be loaded/);
});

// ── Confidence ───────────────────────────────────────────────────────────────

test('scoreConfidence is deterministic and conservative', () => {
  assert.strictEqual(scoreConfidence({ strong: 1, dependency: 1 }), 'high');
  assert.strictEqual(scoreConfidence({ strong: 2 }), 'high');
  assert.strictEqual(scoreConfidence({ strong: 1 }), 'medium');
  assert.strictEqual(scoreConfidence({ supporting: 1, contextual: 1 }), 'medium');
  assert.strictEqual(scoreConfidence({ supporting: 1 }), 'low');
  assert.strictEqual(scoreConfidence({ dependency: 1 }), 'low');
  assert.strictEqual(scoreConfidence({ contextual: 3 }), null, 'contextual signals never establish an integration');
  assert.strictEqual(scoreConfidence({ strong: 1 }, 2), null, 'minDistinctSignals requires corroboration');
  assert.strictEqual(scoreConfidence({}), null);
});

// ── 1. Positive evidence for every catalog integration ──────────────────────

const POSITIVE = {
  'adobe-target': {
    files: {
      [`${JAVA}/TargetOffers.java`]: 'package com.acme;\nimport com.adobe.target.edge.client.TargetClient;\nclass TargetOffers {}\n',
      'core/pom.xml': pom([['com.adobe.target', 'target-java-sdk']]),
    },
    confidence: 'high',
  },
  'adobe-commerce-cif': {
    files: {
      [`${CONFIG}/com.adobe.cq.commerce.graphql.client.impl.GraphqlClientImpl~default.cfg.json`]:
        '{\n  "identifier": "default",\n  "url": "$[env:COMMERCE_ENDPOINT;default=http://localhost/graphql]"\n}\n',
    },
    confidence: 'high',
  },
  'google-recaptcha': {
    files: { [`${APPS}/form/form.html`]: '<script src="https://www.google.com/recaptcha/api.js"></script>\n<div class="g-recaptcha"></div>\n' },
    confidence: 'high',
  },
  'aws-s3': {
    files: { [`${JAVA}/Storage.java`]: 'package com.acme;\nimport software.amazon.awssdk.services.s3.S3Client;\nclass Storage {}\n' },
    confidence: 'medium',
  },
  'jira-cloud': {
    files: {
      [`${JAVA}/Tickets.java`]: 'package com.acme;\nclass Tickets { String u = "https://acme.atlassian.net/rest/api/3/issue"; }\n',
      [`${CONFIG}/com.acme.Tickets.cfg.json`]: '{\n  "jira.project": "WEB"\n}\n',
    },
    confidence: 'high',
  },
  'akamai-netstorage': {
    files: { [`${JAVA}/Upload.java`]: 'package com.acme;\nclass Upload {\n  String a = "X-Akamai-ACS-Auth-Data";\n  String b = "X-Akamai-ACS-Auth-Sign";\n}\n' },
    confidence: 'high',
  },
  workday: {
    files: { [`${CONFIG}/com.acme.Careers.cfg.json`]: '{\n  "endpoint": "https://wd5-services1.workday.com/ccx/service/acme/Recruiting/v40.0"\n}\n' },
    confidence: 'medium',
  },
  'cdn-akamai': {
    files: { 'dispatcher/src/conf.d/available_vhosts/acme.vhost': '<VirtualHost *:80>\n  ServerAlias www.acme.com.edgekey.net\n  Header set Edge-Control "max-age=300"\n</VirtualHost>\n' },
    confidence: 'high',
  },
  'cdn-fastly': {
    files: { [`${JAVA}/Purge.java`]: 'package com.acme;\nclass Purge { String u = "https://api.fastly.com/service/x/purge_all"; }\n' },
    confidence: 'medium',
  },
  'cdn-cloudfront': {
    files: { 'infra/cdn.yaml': 'origin:\n  domain: d111111abcdef8.cloudfront.net\n' },
    confidence: 'medium',
  },
  'cdn-cloudflare': {
    files: { 'dispatcher/src/conf.d/available_vhosts/acme.vhost': '<VirtualHost *:80>\n  SetEnvIf CF-Connecting-IP "(.*)" CLIENT_IP=$1\n</VirtualHost>\n' },
    confidence: 'low',
  },
  pim: {
    files: { [`${CONFIG}/com.acme.Products.cfg.json`]: '{\n  "pim.endpoint": "https://app.salsify.com/api/v1/orgs/x/products",\n  "pim.service.timeout": 30\n}\n' },
    confidence: 'high',
  },
};

test('every catalog integration has a positive-evidence fixture', () => {
  const ids = loadCatalog().integrations.map(i => i.id).sort();
  assert.deepStrictEqual(Object.keys(POSITIVE).sort(), ids);
});

for (const [id, { files, confidence }] of Object.entries(POSITIVE)) {
  test(`detects ${id} from deterministic evidence (${confidence})`, () => {
    const root = mkworkspace();
    for (const [rel, content] of Object.entries(files)) write(root, rel, content);
    const res = runIntegrationScan(root);
    const rec = byId(res, id);
    assert.ok(rec, `${id} not detected: ${JSON.stringify(res.integrations.map(r => r.id))}`);
    assert.strictEqual(rec.confidence, confidence);
    assert.strictEqual(rec.status, confidence === 'low' ? 'candidate' : 'detected');
    for (const e of rec.evidence) {
      assert.ok(Object.prototype.hasOwnProperty.call(files, e.file), `evidence file ${e.file} is relative`);
      assert.ok(e.type && e.signal && e.indicator);
    }
  });
}

test('PIM vendor host alone is not reported as a PIM integration (requires corroboration)', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Feed.java`, 'package com.acme;\nclass Feed { String u = "https://app.salsify.com/api/v1/x"; }\n');
  assert.strictEqual(byId(runIntegrationScan(root), 'pim'), undefined);
});

// ── 2. Generic external APIs ─────────────────────────────────────────────────

test('generic REST API: HTTP client + endpoint config for one host → one medium record, vendor not guessed', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Orders.java`, 'package com.acme;\nimport org.apache.http.impl.client.HttpClients;\nclass Orders { String u = "https://api.partner-corp.com/v2/orders"; }\n');
  write(root, `${CONFIG}/com.acme.Orders.cfg.json`, '{\n  "serviceUrl": "https://api.partner-corp.com/v2"\n}\n');
  const res = runIntegrationScan(root);
  assert.strictEqual(res.integrations.length, 1);
  const rec = res.integrations[0];
  assert.match(rec.id, /^external-api-[0-9a-f]{8}$/);
  assert.strictEqual(rec.category, 'customer-external');
  assert.strictEqual(rec.name, 'Custom External API (HTTP/REST)');
  assert.strictEqual(rec.confidence, 'medium');
  assert.deepStrictEqual(rec.signals, ['http-client-endpoint', 'osgi-endpoint-config']);
  assert.deepStrictEqual(rec.host, { fingerprint: rec.id.replace('external-api-', 'sha256:'), hint: '*.com', private: false });
  assert.strictEqual(res.summary.unknown, 1);
  assert.strictEqual(res.summary.known, 0);
});

test('generic SOAP API is classified by SOAP client import; private IP adds private-connectivity', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Hr.java`, 'package com.acme;\nimport javax.xml.ws.Service;\nclass Hr { String w = "http://10.20.30.40:8080/HrService?wsdl"; }\n');
  const rec = runIntegrationScan(root).integrations[0];
  assert.strictEqual(rec.protocol, 'soap');
  assert.strictEqual(rec.name, 'Custom External API (SOAP)');
  assert.strictEqual(rec.confidence, 'low');
  assert.strictEqual(rec.host.hint, 'ip-address');
  assert.ok(rec.migrationConsiderations.includes('private-connectivity'));
  assert.ok(rec.migrationConsiderations.includes('non-standard-port'), 'port 8080 needs flexible port egress on AEMaaCS');
});

test('default HTTPS port adds no non-standard-port consideration', () => {
  const root = mkworkspace();
  write(root, `${CONFIG}/com.acme.Api.cfg.json`, '{\n  "serviceUrl": "https://api.partner-corp.com:443/v1"\n}\n');
  const rec = runIntegrationScan(root).integrations[0];
  assert.ok(!rec.migrationConsiderations.includes('non-standard-port'));
});

test('importing only HttpStatus constants is not HTTP client usage', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Servlet.java`, 'package com.acme;\nimport org.apache.http.HttpStatus;\nclass Servlet { String u = "https://www.partner-corp.com/terms"; }\n');
  assert.deepStrictEqual(runIntegrationScan(root).integrations, []);
});

test('minified / bundled JS (e.g. generated clientlibs) is skipped and counted', () => {
  const root = mkworkspace();
  write(root, `${APPS}/clientlibs/clientlib-site/js/site.js`, `var a=1;${'x'.repeat(2500)};grecaptcha.execute();`);
  const res = runIntegrationScan(root);
  assert.deepStrictEqual(res.integrations, []);
  assert.strictEqual(res.summary.minifiedSkipped, 1);
  assert.strictEqual(res.status, 'complete');
});

test('URLs without HTTP client usage, placeholders, localhost and namespace hosts are not generic APIs', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Links.java`, 'package com.acme;\nclass Links { String u = "https://www.partner-corp.com/about"; }\n');
  write(root, `${JAVA}/Client.java`, [
    'package com.acme;',
    'import java.net.http.HttpClient;',
    'class Client {',
    '  String a = "http://localhost:4502/content";',
    '  String b = "https://${host}/api";',
    '  String c = "http://www.w3.org/2001/XMLSchema";',
    '  String d = "https://api-" + env + ".acme.com";',
    '}',
  ].join('\n'));
  write(root, `${CONFIG}/com.day.cq.commons.impl.ExternalizerImpl.cfg.json`, '{\n  "externalizer.domains": ["publish https://www.acme.com"]\n}\n');
  write(root, `${CONFIG}/com.acme.Site.cfg.json`, '{\n  "logoText": "https://www.acme.com"\n}\n');
  assert.deepStrictEqual(runIntegrationScan(root).integrations, []);
});

// ── 3. No matches ────────────────────────────────────────────────────────────

test('a project with no integrations reports zero, status complete', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Hello.java`, 'package com.acme;\nclass Hello { String s = "hi"; }\n');
  const res = runIntegrationScan(root);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'complete');
  assert.deepStrictEqual(res.integrations, []);
  assert.strictEqual(res.summary.total, 0);
  assert.deepStrictEqual(res.warnings, []);
});

// ── 4. Weak signals and false positives ─────────────────────────────────────

test('generic terms (target, jira, s3, pim, workday, commerce) never establish an integration', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/TargetResolver.java`, [
    'package com.acme;',
    'class TargetResolver {',
    '  String target = "_blank"; String jira = "WEB-1"; String s3 = "x"; String pim = "y";',
    '  String workday = "Monday"; String commerce = "shop";',
    '}',
  ].join('\n'));
  write(root, `${CONFIG}/com.acme.Links.cfg.json`, '{\n  "jira.link": "https://acme.atlassian.net/wiki",\n  "pim.label": "Products",\n  "workday.label": "Careers"\n}\n');
  assert.deepStrictEqual(runIntegrationScan(root).integrations, []);
});

test('comments, markup comments and documentation files are not evidence', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Old.java`, 'package com.acme;\n// import software.amazon.awssdk.services.s3.S3Client;\n/* "https://bucket.s3.amazonaws.com" */\nclass Old {}\n');
  write(root, `${APPS}/old/old.html`, '<!-- <div class="g-recaptcha"></div> -->\n<!--/* grecaptcha.execute() */-->\n<div></div>\n');
  write(root, `${CONFIG}/com.acme.Old.config`, '# endpoint="https://acme.atlassian.net/rest/api/3"\nenabled=B"true"\n');
  write(root, 'README.md', 'We use grecaptcha and software.amazon.awssdk.services.s3');
  const res = runIntegrationScan(root);
  assert.deepStrictEqual(res.integrations, []);
});

// ── 5. Dependency-only ───────────────────────────────────────────────────────

test('a Maven dependency alone is only a low-confidence candidate', () => {
  const root = mkworkspace();
  write(root, 'core/pom.xml', pom([['com.amazonaws', 'aws-java-sdk-s3'], ['org.slf4j', 'slf4j-api']]));
  const res = runIntegrationScan(root);
  assert.strictEqual(res.integrations.length, 1);
  const rec = byId(res, 'aws-s3');
  assert.strictEqual(rec.confidence, 'low');
  assert.strictEqual(rec.status, 'candidate');
  assert.deepStrictEqual(rec.evidence.map(e => [e.type, e.file, e.line]), [['maven-dependency', 'core/pom.xml', 2]]);
  assert.strictEqual(res.summary.detected, 0);
  assert.strictEqual(res.summary.candidates, 1);
});

test('a commented-out Maven dependency and devDependencies are ignored', () => {
  const root = mkworkspace();
  write(root, 'core/pom.xml', '<project>\n<!--\n<dependency><groupId>com.amazonaws</groupId><artifactId>aws-java-sdk-s3</artifactId></dependency>\n-->\n</project>\n');
  write(root, 'ui.frontend/package.json', JSON.stringify({ devDependencies: { '@aws-sdk/client-s3': '^3' } }, null, 2));
  assert.deepStrictEqual(runIntegrationScan(root).integrations, []);
});

// ── 6. Multiple files ────────────────────────────────────────────────────────

test('one integration matched in several files/modules is one record with every location', () => {
  const root = mkworkspace();
  write(root, 'core/src/main/java/com/acme/A.java', 'package com.acme;\nimport com.amazonaws.services.s3.AmazonS3;\nclass A {}\n');
  write(root, 'bundle2/src/main/java/com/acme/B.java', 'package com.acme;\nimport com.amazonaws.services.s3.AmazonS3;\nclass B {}\n');
  write(root, 'core/pom.xml', pom([['com.amazonaws', 'aws-java-sdk-s3']]));
  const res = runIntegrationScan(root);
  assert.strictEqual(res.integrations.filter(r => r.id === 'aws-s3').length, 1);
  const rec = byId(res, 'aws-s3');
  assert.strictEqual(rec.confidence, 'high');
  assert.strictEqual(rec.evidenceCount, 3);
  assert.deepStrictEqual(rec.evidence.map(e => e.file), [
    'bundle2/src/main/java/com/acme/B.java', 'core/pom.xml', 'core/src/main/java/com/acme/A.java',
  ]);
});

test('several signals on one line count once (strongest wins) — no self-corroboration', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/J.java`, 'package com.acme;\nclass J { String u = "https://acme.atlassian.net/rest/api/3/search"; }\n');
  const rec = byId(runIntegrationScan(root), 'jira-cloud');
  assert.deepStrictEqual(rec.signals, ['jira-cloud-rest-api']);
  assert.strictEqual(rec.confidence, 'medium');
});

// ── 7. Secret redaction ─────────────────────────────────────────────────────

test('no secret, token, customer hostname, URL path or source snippet reaches the output', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Partner.java`, [
    'package com.acme;',
    'import okhttp3.OkHttpClient;',
    'import software.amazon.awssdk.services.s3.S3Client;',
    'class Partner {',
    '  String u = "https://svc-user:Sup3rS3cret@orders.secret-partner.io/v1/orders?apiKey=FAKE-API-KEY-0000";',
    '  String b = "https://acme-private-bucket.s3.eu-west-1.amazonaws.com/reports";',
    '}',
  ].join('\n'));
  write(root, `${CONFIG}/com.acme.Partner.cfg.json`, '{\n  "serviceUrl": "https://orders.secret-partner.io/v1",\n  "password": "hunter2"\n}\n');
  const res = runIntegrationScan(root);
  const out = JSON.stringify(res) + renderIntegrationDiscovery(res).join('\n');
  for (const leak of ['Sup3rS3cret', 'svc-user', 'FAKE-API-KEY-0000', 'apiKey=', 'secret-partner', '/v1/orders', 'hunter2', 'acme-private-bucket', 'String u =']) {
    assert.ok(!out.includes(leak), `output leaks ${leak}`);
  }
  const generic = res.integrations.find(r => r.category === 'customer-external');
  assert.match(generic.host.fingerprint, /^sha256:[0-9a-f]{8}$/);
  assert.strictEqual(generic.host.hint, '*.io');
});

// ── 8. Ignored directories ──────────────────────────────────────────────────

test('build output, dependencies, VCS, test and docs trees are not scanned', () => {
  const root = mkworkspace();
  const s3 = 'package com.acme;\nimport software.amazon.awssdk.services.s3.S3Client;\nclass X {}\n';
  for (const dir of ['node_modules/pkg', 'core/target/classes', '.git/x', 'ui.frontend/dist', 'core/src/test/java', 'ui.tests/src', 'docs', 'build']) {
    write(root, `${dir}/X.java`, s3);
  }
  write(root, 'ui.frontend/src/vendor.min.js', 'grecaptcha.execute()');
  const res = runIntegrationScan(root);
  assert.deepStrictEqual(res.integrations, []);
  assert.strictEqual(res.summary.filesScanned, 0);
});

test('fileKind maps supported sources and skips lockfiles / minified bundles', () => {
  assert.strictEqual(fileKind('pom.xml'), 'pom');
  assert.strictEqual(fileKind('com.acme.X.cfg.json'), 'osgi-json');
  assert.strictEqual(fileKind('com.acme.X.config'), 'osgi-config');
  assert.strictEqual(fileKind('.content.xml'), 'xml');
  assert.strictEqual(fileKind('a.vhost'), 'dispatcher');
  assert.strictEqual(fileKind('a.html'), 'htl');
  assert.strictEqual(fileKind('package-lock.json'), null);
  assert.strictEqual(fileKind('app.min.js'), null);
  assert.strictEqual(fileKind('README.md'), null);
});

// ── 9. No BPA, no Cloud environment ─────────────────────────────────────────

test('runbook generation with no BPA source and no Cloud env still produces the integration inventory', async () => {
  const root = mkworkspace();
  write(root, `${APPS}/form/form.html`, '<div class="g-recaptcha"></div>\n<script src="https://www.google.com/recaptcha/api.js"></script>\n');
  const out = path.join(root, 'migration-runbook.md');
  const cache = path.join(root, 'migration-runbook.json');
  const result = await generateRunbook({ workspaceRoot: root, collectionsDir: path.join(root, 'none'), outputPath: out, cachePath: cache });
  assert.strictEqual(result.gathered.bpaMode, null);
  assert.strictEqual(result.integrationSummary.total, 1);
  const md = fs.readFileSync(out, 'utf8');
  assert.match(md, /## Integration Discovery \(`integrationDiscovery`\)/);
  assert.match(md, /\| Google reCAPTCHA \| Known third-party integration \| High \|/);
  const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.strictEqual(cached.integrationDiscovery.strategy, 'integration-scan');
  assert.strictEqual(cached.integrationDiscovery.integrations[0].id, 'google-recaptcha');
  assert.ok(!('integrationDiscovery' in cached.findingsByPattern), 'not a remediation pattern');
  assert.ok(!result.needsLlmScan.includes('integrationDiscovery'));
  assert.ok(!md.includes(root), 'runbook must not leak the absolute workspace path');
});

test('a missing workspace root yields not-run with a warning', () => {
  const res = runIntegrationScan(path.join(os.tmpdir(), 'does-not-exist-integration-scan'));
  assert.strictEqual(res.status, 'not-run');
  assert.strictEqual(res.ok, false);
  assert.ok(res.warnings.length > 0);
});

// ── 10. Malformed configuration ─────────────────────────────────────────────

test('malformed JSON / pom files produce warnings and a partial status, while still scanning', () => {
  const root = mkworkspace();
  write(root, `${CONFIG}/com.acme.Broken.cfg.json`, '{ "endpoint": "https://wd5-services1.workday.com/ccx/service/acme" \n');
  write(root, 'core/pom.xml', '<project><dependencies><dependency><groupId>com.amazonaws</groupId>\n</dependencies></project>\n');
  write(root, `${APPS}/x/x.html`, '<!-- never closed\n<div></div>\n');
  const res = runIntegrationScan(root);
  assert.strictEqual(res.status, 'partial');
  assert.ok(res.warnings.some(w => /malformed JSON in `.*com\.acme\.Broken\.cfg\.json`/.test(w)));
  assert.ok(res.warnings.some(w => /unbalanced <dependency> elements in `core\/pom\.xml`/.test(w)));
  assert.ok(res.warnings.some(w => /unterminated XML\/HTML comment in `.*x\.html`/.test(w)));
  assert.ok(byId(res, 'workday'), 'malformed file is still scanned as text');
  assert.match(renderIntegrationDiscovery(res).join('\n'), /### Integration scan warnings/);
});

// ── 11. Stable output ───────────────────────────────────────────────────────

test('output is deterministic and sorted (category, confidence, id)', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/Z.java`, 'package com.acme;\nimport org.apache.http.client.HttpClient;\nclass Z { String a = "https://api.zeta-corp.com/x"; String b = "https://api.alpha-corp.com/y"; }\n');
  write(root, `${APPS}/f/f.html`, '<div class="g-recaptcha"></div>\n');
  write(root, `${JAVA}/T.java`, 'package com.acme;\nimport com.adobe.target.edge.client.TargetClient;\nclass T {}\n');
  write(root, 'core/pom.xml', pom([['com.amazonaws', 'aws-java-sdk-s3']]));
  const a = runIntegrationScan(root);
  const b = runIntegrationScan(root);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a.integrations.map(r => r.category), ['adobe-product', 'third-party', 'third-party', 'customer-external', 'customer-external']);
  assert.deepStrictEqual(a.integrations.slice(1, 3).map(r => r.id), ['google-recaptcha', 'aws-s3'], 'medium before low');
  const generic = a.integrations.slice(3).map(r => r.id);
  assert.deepStrictEqual(generic, generic.slice().sort());
});

// ── 12. Runbook rendering with and without integration findings ─────────────

const emptyGathered = () => ({
  findingsByPattern: Object.fromEntries(require('./runbook-generator.js').CANONICAL_PATTERNS.map(p => [p, []])),
  sourceByPattern: {},
  needsLlmScan: [],
  analyzerWarnings: [],
});

test('renderRunbook omits the section when no integration scan result is present', () => {
  const md = renderRunbook(emptyGathered(), { generatedAt: 'now' });
  assert.ok(!md.includes('Integration Discovery'));
});

test('renderRunbook shows "No integrations detected." for a clean scan', () => {
  const root = mkworkspace();
  const md = renderRunbook({ ...emptyGathered(), integrationDiscovery: runIntegrationScan(root) }, { generatedAt: 'now' });
  assert.match(md, /## Integration Discovery/);
  assert.match(md, /\| Integrations detected \| \*\*0\*\* \(0 known, 0 unknown external\) \|/);
  assert.match(md, /No integrations detected\./);
});

test('renderRunbook lists integrations, evidence references and candidates', () => {
  const root = mkworkspace();
  write(root, `${JAVA}/S.java`, 'package com.acme;\nimport software.amazon.awssdk.services.s3.S3Client;\nclass S {}\n');
  write(root, 'core/pom.xml', pom([['software.amazon.awssdk', 's3'], ['com.atlassian.jira', 'jira-rest-java-client-core']]));
  const md = renderRunbook({ ...emptyGathered(), integrationDiscovery: runIntegrationScan(root) }, { generatedAt: 'now' });
  assert.match(md, /\| AWS S3 \| Known third-party integration \| High \| Java import \(1\), Maven dependency \(1\) \|/);
  assert.match(md, /\| Jira Cloud \| Known third-party integration \| Low \(candidate\) \|/);
  assert.match(md, /### Integration evidence/);
  assert.match(md, /`core\/src\/main\/java\/com\/acme\/S\.java:2` \(software\.amazon\.awssdk\.services\.s3\)/);
});
