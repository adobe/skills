#!/usr/bin/env node
// martech-scaffold: contract → scripts/martech.js + hooks (idempotent, conflict-safe, validated), and the generated
// runtime against a stubbed window/document (host gate, ?martech=on / &consent=accept, category gating, boot);
// on the current boilerplate, tags hook into consented.js and consent-check.js asks martech.js (only the exact
// placeholder is replaced; an older run's loadDelayed()/delayed.js hook is removed).
// Run: node plugins/stardust/skills/deploy/scripts/test/martech-scaffold.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCAFFOLD = join(dirname(fileURLToPath(import.meta.url)), '..', 'martech-scaffold.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'martech-scaffold-'));
const SCRIPTS = `async function loadEager(doc) {
  document.documentElement.lang = 'en';
}

async function loadLazy(doc) {
  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));
  loadFonts();
}

function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
}
`;
const CMP = 'https://cmp.example.test/otSDKStub.js';
const LAUNCH = 'https://assets.example.test/launch-1.min.js';
const GTM = 'https://tags.example.test/gtm.js?id=GTM-TEST';
const contract = (over = {}) => ({
  productionHosts: ['www.example.test'],
  consent: {
    cmp: { vendor: 'OneTrust', src: CMP, attrs: { 'data-domain-script': 'test-id' }, groups: 'OnetrustActiveGroups', event: 'OneTrustGroupsUpdated', enabled: true },
    model: 'per-tag',
  },
  routes: [
    { id: 'adobe-launch', src: LAUNCH, boot: null, category: null, enabled: true },
    { id: 'gtm', src: GTM, boot: 'gtm', category: 'C0004', enabled: true },
    { id: 'off', src: 'https://off.example.test/x.js', boot: null, category: null, enabled: false },
  ],
  ...over,
});

// aem-boilerplate since d966eff9: loadDelayed() imports consent-check.js, which loads consented.js on consent.
const BP_SCRIPTS = SCRIPTS.replace(/function loadDelayed\(\) \{[\s\S]*?\n\}/, "function loadDelayed() {\n  import('./consent-check.js');\n  // load anything that can be postponed to the latest here\n}");
const BP_CHECK = `let consentedLoaded = false;

/**
 * Dummy consent implementation.
 *
 * By default consent is declined, so consented scripts (analytics, martech, etc.)
 * are not loaded. This stands in for a real CMP (OneTrust, etc.) and can be
 * swapped out later.
 *
 * The default can be overridden with a query parameter for testing:
 *   ?consent=accept   grant consent (loads consented.js)
 *   ?consent=decline  decline consent (default behavior)
 *
 * @returns {boolean} true if the user has consented
 */
function hasConsent() {
  const consent = new URLSearchParams(window.location.search).get('consent');
  if (consent !== null) {
    return ['accept', 'true', '1', 'yes'].includes(consent.toLowerCase());
  }
  // default: decline
  return false;
}

/**
 * Loads consented scripts once consent is available.
 */
function loadConsented() {
  if (consentedLoaded) return;
  consentedLoaded = true;
  import('./consented.js');
}

/**
 * Notifies listeners of the current consent state and loads consented
 * scripts if consent has been granted.
 */
function onConsentUpdate() {
  const consented = hasConsent();
  window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
  if (consented) {
    loadConsented();
  }
}

onConsentUpdate();
`;
const BP_CONSENTED = '// add functionality that requires user consent here (analytics, martech, etc.)\n';

let seq = 0;
function site({ data = contract(), delayed = '// add delayed functionality here\n', scripts = SCRIPTS, consent = false } = {}) {
  seq += 1;
  const root = join(TMP, `site-${seq}`);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'stardust'));
  writeFileSync(join(root, 'scripts/scripts.js'), scripts);
  if (delayed !== null) writeFileSync(join(root, 'scripts/delayed.js'), delayed);
  if (consent) {
    writeFileSync(join(root, 'scripts/consent-check.js'), consent === true ? BP_CHECK : consent);
    writeFileSync(join(root, 'scripts/consented.js'), BP_CONSENTED);
  }
  writeFileSync(join(root, 'stardust/martech-contract.json'), JSON.stringify(data));
  return root;
}
const run = (root, ...args) => spawnSync(process.execPath, [SCAFFOLD, '--root', root, ...args], { encoding: 'utf8' });
const file = (root, p) => readFileSync(join(root, p), 'utf8');

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

await check('writes martech.js with enabled routes only, hooks loadEager + delayed.js; re-run is unchanged', () => {
  const root = site();
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  const js = file(root, 'scripts/martech.js');
  assert.ok(js.includes(LAUNCH) && js.includes(GTM) && !js.includes('off.example.test'));
  assert.ok(!js.includes('"'), 'config is emitted with single quotes');
  assert.match(file(root, 'scripts/scripts.js'), /function loadEager\(doc\) \{\n {2}import\('\.\/martech\.js'\)\.then\(\(m\) => m\.loadConsent\(\)\);/);
  assert.match(file(root, 'scripts/delayed.js'), /m\.loadTags\(\)/);
  assert.ok(!file(root, 'scripts/scripts.js').includes('loadAnalytics'), 'no lazy hook without aemMartech');
  const again = run(root);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /unchanged/);
});

await check('no delayed.js: loadTags goes into loadDelayed(); missing loadEager is a usage error', () => {
  const root = site({ delayed: null });
  assert.equal(run(root).status, 0);
  assert.match(file(root, 'scripts/scripts.js'), /function loadDelayed\(\) \{\n {2}import\('\.\/martech\.js'\)\.then\(\(m\) => m\.loadTags\(\)\);/);
  const bare = run(site({ scripts: 'export {};\n' }));
  assert.equal(bare.status, 1); assert.match(bare.stderr, /no loadEager\(\)/);
});

await check('current boilerplate: loadTags goes into consented.js, consent-check.js asks martech.js; re-run is unchanged', () => {
  const root = site({ scripts: BP_SCRIPTS, delayed: null, consent: true });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(file(root, 'scripts/consented.js'), `${BP_CONSENTED}import('./martech.js').then((m) => m.loadTags());\n`);
  const check = file(root, 'scripts/consent-check.js');
  assert.ok(check.startsWith("import { hasConsent as martechConsent } from './martech.js';\n\nlet consentedLoaded"));
  assert.match(check, /function hasConsent\(\) \{\n {2}return martechConsent\(\);\n\}/);
  assert.ok(!/Dummy consent|default: decline/.test(check), 'placeholder and its JSDoc are gone');
  assert.ok(check.includes('function onConsentUpdate()'), 'the rest of consent-check.js is kept');
  const scripts = file(root, 'scripts/scripts.js');
  assert.ok(!scripts.includes('loadTags') && scripts.includes("import('./consent-check.js');"), 'loadDelayed() is left to the boilerplate');
  assert.match(scripts, /m\.loadConsent\(\)/);
  assert.match(run(root).stdout, /unchanged/);
});

const PLACEHOLDER_RE = /function hasConsent\(\) \{[\s\S]*?\n\}/;
const ownCheck = (fn) => BP_CHECK.replace(PLACEHOLDER_RE, fn);

await check('current boilerplate: any hasConsent() but the exact placeholder is a conflict, --force or not; nothing is written', () => {
  const cases = {
    'one-line': 'function hasConsent() { return true; }',
    async: `async ${BP_CHECK.match(PLACEHOLDER_RE)[0]}`,
    arrow: 'const hasConsent = () => window.myCmp.ok();',
    'CMP wired, placeholder comment kept': BP_CHECK.match(PLACEHOLDER_RE)[0].replace('return false;', 'return window.myCmp.ok();'),
    'placeholder reworded upstream': BP_CHECK.match(PLACEHOLDER_RE)[0].replace('// default: decline', '// declined unless overridden'),
  };
  Object.entries(cases).forEach(([name, fn]) => {
    const text = ownCheck(fn);
    const root = site({ scripts: BP_SCRIPTS, delayed: null, consent: text });
    [run(root), run(root, '--force')].forEach((r) => {
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, /has a hasConsent\(\) that is not the boilerplate placeholder .* make hasConsent\(\) return true when martechConsent\(\) does/, name);
    });
    assert.equal(file(root, 'scripts/consent-check.js'), text, `${name}: consent-check.js untouched`);
    assert.equal(file(root, 'scripts/consented.js'), BP_CONSENTED, `${name}: consented.js untouched`);
    assert.ok(!existsSync(join(root, 'scripts/martech.js')), `${name}: martech.js not written`);
  });
  const none = run(site({ scripts: BP_SCRIPTS, delayed: null, consent: 'export {};\n' }));
  assert.equal(none.status, 1); assert.match(none.stderr, /has no hasConsent\(\)/);
});

await check("current boilerplate: an owner's hasConsent() that calls martechConsent() is accepted as is; without the import it is an error", () => {
  const wired = `import { hasConsent as martechConsent } from './martech.js';\n\n${ownCheck('function hasConsent() {\n  return martechConsent() && window.myCmp.ok();\n}')}`;
  const root = site({ scripts: BP_SCRIPTS, delayed: null, consent: wired });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(file(root, 'scripts/consent-check.js'), wired);
  assert.match(file(root, 'scripts/consented.js'), /m\.loadTags\(\)/);
  assert.match(run(root).stdout, /unchanged/);
  const noImport = run(site({ scripts: BP_SCRIPTS, delayed: null, consent: wired.split('\n').slice(2).join('\n') }));
  assert.equal(noImport.status, 1); assert.match(noImport.stderr, /imports nothing from \.\/martech\.js/);
});

await check('current boilerplate: the JSDoc above the placeholder goes with it, blank line or not', () => {
  const root = site({ scripts: BP_SCRIPTS, delayed: null, consent: BP_CHECK.replace('*/\nfunction hasConsent', '*/\n\nfunction hasConsent') });
  assert.equal(run(root).status, 0);
  const check = file(root, 'scripts/consent-check.js');
  assert.ok(!/Dummy consent|By default consent is declined/.test(check));
  assert.ok(check.includes('function loadConsented()') && check.includes('Loads consented scripts once consent is available.'));
});

await check('upgrade: a site hooked by an older run (loadDelayed() or delayed.js) keeps a single loadTags() hook, in consented.js', () => {
  const inScripts = site({ scripts: BP_SCRIPTS, delayed: null });
  assert.equal(run(inScripts).status, 0);
  assert.match(file(inScripts, 'scripts/scripts.js'), /m\.loadTags\(\)/, 'the older layout: hook in loadDelayed()');
  const inDelayed = site({ scripts: BP_SCRIPTS });
  assert.equal(run(inDelayed).status, 0);
  assert.match(file(inDelayed, 'scripts/delayed.js'), /m\.loadTags\(\)/, 'the older layout: hook in delayed.js');
  [inScripts, inDelayed].forEach((root) => {
    writeFileSync(join(root, 'scripts/consent-check.js'), BP_CHECK);
    writeFileSync(join(root, 'scripts/consented.js'), BP_CONSENTED);
    assert.equal(run(root).status, 0);
    const all = ['scripts.js', 'delayed.js', 'consented.js'].map((f) => (existsSync(join(root, 'scripts', f)) ? file(root, `scripts/${f}`) : '')).join('\n');
    assert.equal(all.match(/m\.loadTags\(\)/g).length, 1, 'one hook');
    assert.match(file(root, 'scripts/consented.js'), /m\.loadTags\(\)/);
    assert.match(file(root, 'scripts/scripts.js'), /function loadDelayed\(\) \{\n {2}import\('\.\/consent-check\.js'\);/);
    assert.match(run(root).stdout, /unchanged/);
  });
});

await check('--dry-run writes nothing; a foreign martech.js is a conflict unless --force', () => {
  const root = site();
  assert.match(run(root, '--dry-run').stdout, /would write scripts\/martech\.js/);
  assert.equal(file(root, 'scripts/scripts.js'), SCRIPTS);
  writeFileSync(join(root, 'scripts/martech.js'), 'export default 1;\n');
  const conflict = run(root);
  assert.equal(conflict.status, 1); assert.match(conflict.stderr, /not written by this scaffold/);
  assert.equal(run(root, '--force').status, 0);
  assert.match(file(root, 'scripts/martech.js'), /^\/\/ Generated by stardust/);
});

await check('invalid contract: enabled CMP without its id, or a category the CMP cannot gate', () => {
  const noId = contract();
  noId.consent.cmp.attrs['data-domain-script'] = null;
  const a = run(site({ data: noId }));
  assert.equal(a.status, 1); assert.match(a.stderr, /data-domain-script/);
  const noGroups = contract();
  Object.assign(noGroups.consent.cmp, { vendor: 'Cookiebot', groups: null, event: null });
  const b = run(site({ data: noGroups }));
  assert.equal(b.status, 1); assert.match(b.stderr, /route `gtm` has a category/);
});

const SITE = site();
run(SITE);
async function boot({ host = 'main--site--org.aem.page', search = '', groups, root = SITE, delayed = true } = {}) {
  const added = [];
  const listeners = {};
  globalThis.window = {
    location: { host, search },
    OnetrustActiveGroups: groups,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  globalThis.document = {
    createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    head: { append: (s) => added.push(s) },
  };
  seq += 1;
  const m = await import(`${pathToFileURL(join(root, 'scripts/martech.js')).href}?${seq}`);
  m.loadConsent();
  m.loadAnalytics();
  if (delayed) m.loadTags();
  return { m, win: globalThis.window, srcs: () => added.map((s) => s.src), added, fire: () => listeners.OneTrustGroupsUpdated?.() };
}

await check('runtime: off the production hosts nothing loads without ?martech=on', async () => {
  assert.deepEqual((await boot()).srcs(), []);
});

await check('runtime: ?martech=on&consent=accept loads the CMP and every enabled route; gtm gets its bootstrap', async () => {
  const b = await boot({ search: '?martech=on&consent=accept' });
  assert.deepEqual(b.srcs(), [CMP, LAUNCH, GTM]);
  assert.equal(b.added[0].attrs['data-domain-script'], 'test-id');
  assert.equal(b.win.dataLayer[0].event, 'gtm.js');
});

await check('runtime: production — ungated route loads at once, the C0004 route waits for the CMP to grant it', async () => {
  const b = await boot({ host: 'www.example.test', groups: ',C0001,' });
  assert.deepEqual(b.srcs(), [CMP, LAUNCH]);
  b.fire();
  assert.deepEqual(b.srcs(), [CMP, LAUNCH]);
  b.win.OnetrustActiveGroups = ',C0001,C0004,';
  b.fire();
  assert.deepEqual(b.srcs(), [CMP, LAUNCH, GTM]);
});

await check('runtime: consent=accept is ignored on a production host', async () => {
  const b = await boot({ host: 'www.example.test', search: '?consent=accept', groups: ',C0001,' });
  assert.deepEqual(b.srcs(), [CMP, LAUNCH]);
});

await check('runtime: hasConsent() — always on a production host; off it ?consent= decides as in the boilerplate, else ?martech=on', async () => {
  assert.equal((await boot()).m.hasConsent(), false);
  assert.equal((await boot({ search: '?martech=on' })).m.hasConsent(), true);
  assert.equal((await boot({ search: '?martech=on&consent=decline' })).m.hasConsent(), false);
  assert.equal((await boot({ search: '?consent=accept' })).m.hasConsent(), true, 'the boilerplate switch still loads consented.js');
  assert.deepEqual((await boot({ search: '?consent=accept' })).srcs(), [], 'without ?martech=on no tag loads');
  assert.equal((await boot({ host: 'www.example.test', groups: ',C0001,' })).m.hasConsent(), true);
  assert.equal((await boot({ host: 'www.example.test', search: '?consent=decline', groups: ',C0001,' })).m.hasConsent(), true);
});

await check('runtime: current boilerplate end to end — consent-check.js loads consented.js, which loads the tags', async () => {
  const root = site({ scripts: BP_SCRIPTS, delayed: null, consent: true });
  assert.equal(run(root).status, 0);
  const b = await boot({ root, host: 'www.example.test', groups: ',C0001,', delayed: false });
  assert.deepEqual(b.srcs(), [CMP]);
  b.win.dispatchEvent = () => true;
  await import(`${pathToFileURL(join(root, 'scripts/consent-check.js')).href}?${seq}`);
  await new Promise((done) => { setTimeout(done, 20); });
  assert.deepEqual(b.srcs(), [CMP, LAUNCH]);
});

await check('runtime: a gtag route defines gtag and configures the id from its src', async () => {
  const GTAG = 'https://www.googletagmanager.com/gtag/js?id=G-TEST';
  const root = site({ data: contract({ routes: [{ id: 'gtag', src: GTAG, boot: 'gtag', category: null, enabled: true }] }) });
  assert.equal(run(root).status, 0);
  const b = await boot({ root, search: '?martech=on' });
  assert.deepEqual(b.srcs(), [CMP, GTAG]);
  assert.deepEqual(b.win.dataLayer.map((a) => [...a]), [['js', b.win.dataLayer[0][1]], ['config', 'G-TEST']]);
});

const AM = (over = {}) => ({
  plugin: { name: 'aem-martech', path: 'plugins/martech', repo: 'https://example.test/aem-martech.git' },
  config: { orgId: 'TEST@AdobeOrg', datastreamId: 'ds-test', alloyInstanceName: 'alloy', edgeDomain: null, defaultConsent: 'in', launchUrls: [LAUNCH] },
  category: null,
  enabled: true,
  ...over,
});
const STUB = `const log = (globalThis.martechCalls ||= []);
export const initMartech = async (w, o) => { log.push(['init', w, o]); };
export const martechEager = async () => { log.push(['eager']); };
export const martechLazy = async () => { log.push(['lazy']); };
export const martechDelayed = async () => { log.push(['delayed']); };
export const updateUserConsent = async (c) => { log.push(['consent', c]); };
`;
const amSite = (am, routes = [{ id: 'adobe-launch', src: LAUNCH, boot: null, category: null, enabled: false }]) => {
  const root = site({ data: contract({ routes, aemMartech: am }) });
  mkdirSync(join(root, 'plugins/martech/src'), { recursive: true });
  writeFileSync(join(root, 'plugins/martech/src/index.js'), STUB);
  return root;
};

await check('aemMartech: missing plugin, empty ids, the Launch route still enabled, or pending with no category are errors', () => {
  const noPlugin = run(site({ data: contract({ aemMartech: AM() }) }));
  assert.equal(noPlugin.status, 1); assert.match(noPlugin.stderr, /git subtree add --squash --prefix plugins\/martech/);
  const noDs = run(amSite(AM({ config: { ...AM().config, datastreamId: null } })));
  assert.equal(noDs.status, 1); assert.match(noDs.stderr, /config\.datastreamId/);
  const twice = run(amSite(AM(), [{ id: 'adobe-launch', src: LAUNCH, boot: null, category: null, enabled: true }]));
  assert.equal(twice.status, 1); assert.match(twice.stderr, /route `adobe-launch` is enabled and also in aemMartech\.config\.launchUrls/);
  const pending = run(amSite(AM({ config: { ...AM().config, defaultConsent: 'pending' } })));
  assert.equal(pending.status, 1); assert.match(pending.stderr, /nothing would ever be sent/);
});

await check('aemMartech disabled: martech.js is byte-identical to a contract without it', () => {
  const a = site(); const b = site({ data: contract({ aemMartech: AM({ enabled: false }) }) });
  run(a); run(b);
  assert.equal(file(a, 'scripts/martech.js'), file(b, 'scripts/martech.js'));
});

await check('runtime: aemMartech inits the Web SDK with the source consent, then lazy + delayed (which loads Launch)', async () => {
  const root = amSite(AM());
  const r = run(root);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Web SDK via aem-martech/);
  globalThis.martechCalls = [];
  const b = await boot({ root, search: '?martech=on' });
  await new Promise((done) => { setTimeout(done, 20); });
  assert.deepEqual(b.srcs(), [CMP]);
  const [init, ...rest] = globalThis.martechCalls;
  assert.deepEqual(init, ['init', { orgId: 'TEST@AdobeOrg', datastreamId: 'ds-test', defaultConsent: 'in' }, { alloyInstanceName: 'alloy', launchUrls: [LAUNCH], personalization: false }]);
  assert.deepEqual(rest.map((c) => c[0]), ['eager', 'lazy', 'delayed']);
});

await check('aemMartech: loadAnalytics is hooked into loadLazy after loadFooter; re-run is unchanged; no loadLazy is an error', () => {
  const root = amSite(AM());
  assert.equal(run(root).status, 0);
  assert.match(file(root, 'scripts/scripts.js'), /\n {2}loadFooter\(doc\.querySelector\('footer'\)\);\n {2}import\('\.\/martech\.js'\)\.then\(\(m\) => m\.loadAnalytics\(\)\);\n {2}loadFonts\(\);/);
  assert.match(run(root).stdout, /unchanged/);
  const noLazy = amSite(AM());
  writeFileSync(join(noLazy, 'scripts/scripts.js'), SCRIPTS.replace(/async function loadLazy[\s\S]*?\n}\n/, ''));
  const r = run(noLazy);
  assert.equal(r.status, 1); assert.match(r.stderr, /no loadLazy\(\)/);
});

await check('runtime: aemMartech sends from the lazy phase, before (and without) the delayed phase', async () => {
  const root = amSite(AM());
  assert.equal(run(root).status, 0);
  globalThis.martechCalls = [];
  await boot({ root, search: '?martech=on', delayed: false });
  await new Promise((done) => { setTimeout(done, 20); });
  assert.deepEqual(globalThis.martechCalls.map((c) => c[0]), ['init', 'eager', 'lazy']);
});

await check('runtime: an aemMartech category starts the Web SDK pending (whatever the source value) and sets collect only once the CMP grants it', async () => {
  const root = amSite(AM({ category: 'C0002' }));
  assert.equal(run(root).status, 0);
  globalThis.martechCalls = [];
  const b = await boot({ root, host: 'www.example.test', groups: ',C0001,' });
  await new Promise((done) => { setTimeout(done, 20); });
  assert.equal(globalThis.martechCalls[0][1].defaultConsent, 'pending');
  assert.ok(!globalThis.martechCalls.some((c) => c[0] === 'consent'));
  b.win.OnetrustActiveGroups = ',C0001,C0002,';
  b.fire();
  assert.deepEqual(globalThis.martechCalls.find((c) => c[0] === 'consent'), ['consent', { collect: true }]);
});

await check('target: needs aemMartech and Web SDK decisions; enabled, it turns personalization on; off, martech.js is unchanged', async () => {
  const T = (over = {}) => ({ atjs: null, webSdk: { renderRules: [{ id: 'RL5', name: 'Page view' }], prehiding: true }, enabled: true, ...over });
  const withT = (am, target) => { const root = amSite(am); writeFileSync(join(root, 'stardust/martech-contract.json'), JSON.stringify({ ...JSON.parse(file(root, 'stardust/martech-contract.json')), target })); return root; };
  const noAm = run(withT(AM({ enabled: false }), T()));
  assert.equal(noAm.status, 1); assert.match(noAm.stderr, /target is enabled but aemMartech is not/);
  const atjs = run(withT(AM(), T({ atjs: { from: 'launch', extension: 'adobe-target-v2' }, webSdk: null })));
  assert.equal(atjs.status, 1); assert.match(atjs.stderr, /move the at\.js activities to the Web SDK first/);
  const off = withT(AM(), T({ enabled: false })); run(off);
  const plain = amSite(AM()); run(plain);
  assert.equal(file(off, 'scripts/martech.js'), file(plain, 'scripts/martech.js'));
  const root = withT(AM(), T());
  assert.equal(run(root).status, 0);
  globalThis.martechCalls = [];
  await boot({ root, search: '?martech=on' });
  await new Promise((done) => { setTimeout(done, 20); });
  assert.equal(globalThis.martechCalls[0][2].personalization, true);
});

await check('--help prints the usage header', () => {
  const r = spawnSync(process.execPath, [SCAFFOLD, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /--dry-run/);
});

rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\nmartech-scaffold: ${failed} check(s) failed` : '\nmartech-scaffold: all checks passed');
process.exit(failed ? 1 : 0);
