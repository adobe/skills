#!/usr/bin/env node
// martech-scaffold.mjs CLI: hook placement, idempotence, overwrite protection, plugin fallback, --dry-run.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MARK, SCRIPTS, DELAYED, FAKE_MARTECH, contract, site, run, help, at, parses } from './martech-fixtures.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const config = async (root) => (await import(pathToFileURL(join(root, 'scripts/martech-config.js')).href)).default;

await check('generates config, consent-check, consented; appends one import to delayed.js', async () => {
  const root = site();
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  ['martech-config.js', 'consent-check.js', 'consented.js', 'delayed.js'].forEach((f) => assert.ok(parses(root, `scripts/${f}`), f));
  assert.ok(at(root, 'scripts/consent-check.js').startsWith(`// ${MARK}`));
  assert.equal(at(root, 'scripts/delayed.js'), `${DELAYED}\nimport('./consent-check.js');\n`);
  assert.ok(!existsSync(join(root, 'scripts/martech.js')));
  const cfg = await config(root);
  assert.deepEqual(cfg.productionHosts, ['www.example.test']);
  assert.equal(cfg.consent.cmpId, 'test-domain-id');
  assert.deepEqual(cfg.routes[2], { id: 'websdk', loader: 'url', src: 'https://assets.example.test/alloy-launch.min.js', config: null, category: 'analytics', enabled: true });
  assert.match(r.stdout, /websdk: runs on its fallback/);
  assert.match(r.stdout, /git subtree add --squash --prefix plugins\/martech /);
});

await check('rerun is a no-op', () => {
  const root = site();
  run(root);
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /delayed\.js imports consent-check\.js/);
  assert.equal((r.stdout.match(/: unchanged/g) || []).length, 3);
  assert.doesNotMatch(r.stdout, /: (create|update)$/m);
  assert.equal((at(root, 'scripts/delayed.js').match(/consent-check/g) || []).length, 1);
});

await check('hand-written consent-check.js is a conflict; --force overwrites', () => {
  const own = "export default function check() { loadScript('https://cmp.example.test/own.js'); }\n";
  const root = site({ files: { 'scripts/consent-check.js': own } });
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not overwriting scripts\/consent-check\.js/);
  assert.equal(at(root, 'scripts/consent-check.js'), own);
  assert.ok(!existsSync(join(root, 'scripts/martech-config.js')), 'nothing written on conflict');
  assert.equal(run(root, '--force').status, 0);
  assert.ok(at(root, 'scripts/consent-check.js').includes(MARK));
});

await check('boilerplate placeholder hooks are replaced and their exports kept as start() aliases', () => {
  const placeholder = "/**\n * Checks consent before loading martech.\n */\nexport function waitForConsent() {\n  import('./consented.js');\n}\n";
  const root = site({ files: { 'scripts/consent-check.js': placeholder, 'scripts/consented.js': '// consented martech goes here\n' } });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /consent-check\.js: update/);
  assert.match(at(root, 'scripts/consent-check.js'), /export \{ start as waitForConsent \};/);
  assert.ok(parses(root, 'scripts/consent-check.js'));
});

await check('static named import in scripts.js: no self-start, the imported name is exported', () => {
  const root = site({ scripts: `import { initConsent } from './consent-check.js';\n\n${SCRIPTS}initConsent();\n` });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /hook: consent-check/);
  const cc = at(root, 'scripts/consent-check.js');
  assert.doesNotMatch(cc, /^start\(\);$/m);
  assert.match(cc, /export \{ start as initConsent \};/);
  assert.equal(at(root, 'scripts/delayed.js'), DELAYED);
});

await check('no delayed.js: import inserted into loadDelayed(); no hook at all exits 1', () => {
  const root = site({ delayed: null });
  assert.equal(run(root).status, 0);
  assert.match(at(root, 'scripts/scripts.js'), /function loadDelayed\(\) \{\n {2}import\('\.\/consent-check\.js'\);\n/);
  assert.ok(parses(root, 'scripts/scripts.js'));
  const r = run(site({ scripts: 'export default 1;\n', delayed: null }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no consent hook/);
});

await check('--dry-run writes nothing', () => {
  const root = site();
  const r = run(root, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(dry run\)/);
  assert.ok(!existsSync(join(root, 'scripts/martech-config.js')));
  assert.equal(at(root, 'scripts/delayed.js'), DELAYED);
});

await check('installed plugin: martech.js, runtime-contract + .eslintignore updated', () => {
  const root = site({ files: { 'plugins/martech/src/index.js': FAKE_MARTECH, '.eslintignore': 'helix-importer-ui\n', 'stardust/runtime-contract.json': '{"runtime":"vanilla-eds"}\n' } });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(parses(root, 'scripts/martech.js'));
  assert.match(at(root, 'scripts/consented.js'), /import\('\.\/martech\.js'\)/);
  assert.equal(at(root, '.eslintignore'), 'helix-importer-ui\nplugins/\n');
  assert.deepEqual(JSON.parse(at(root, 'stardust/runtime-contract.json')), { runtime: 'vanilla-eds', consentHook: 'delayed-js', martechPlugins: ['plugins/martech'] });
});

await check('plugin route without fallback and url route without src stay off; ids never invented', async () => {
  const routes = [
    { id: 'ga', loader: 'aem-gtm-martech', config: { tags: ['G-TEST'], containers: { lazy: [], delayed: [] }, dataLayerInstanceName: 'dataLayer' }, category: 'analytics', enabled: true },
    { id: 'aa', loader: 'aem-martech', config: { datastreamId: null, orgId: null, launchUrls: [] }, category: 'analytics', enabled: false },
    { id: 'pixel', loader: 'url', category: 'marketing', enabled: true },
  ];
  const root = site({ data: contract({ routes }) });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ga: off until aem-gtm-martech is installed/);
  assert.match(r.stdout, /pixel: off — loader "url" needs a src/);
  const cfg = await config(root);
  assert.deepEqual(cfg.routes.map((x) => x.enabled), [false, false, false]);
  assert.deepEqual(cfg.routes[1].config, { datastreamId: null, orgId: null, launchUrls: [] });
});

await check('bad contract exits 1; --help prints usage', () => {
  assert.equal(run(site({ data: { version: 2 } })).status, 1);
  const h = help();
  assert.equal(h.status, 0);
  assert.match(h.stdout, /--contract/);
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nmartech-scaffold.test: all checks passed');
