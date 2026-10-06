#!/usr/bin/env node
// Generated martech runtime against a stubbed window/document: host gate, QA overrides, CMP adapters, plugin consent.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LAUNCH, GTM, ALLOY, ONETRUST, COOKIEBOT, FAKE_MARTECH, contract, site, run } from './martech-fixtures.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const settle = () => new Promise((res) => { setTimeout(res, 50); });

async function boot({ host = 'main--site--org.aem.page', search = '', data = contract(), files = {}, before } = {}) {
  const root = site({ data, files });
  assert.equal(run(root).status, 0);
  const scripts = [];
  const events = [];
  const listeners = {};
  globalThis.window = {
    location: { host, search },
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    dispatchEvent: (e) => { events.push(e); (listeners[e.type] || []).forEach((fn) => fn(e)); return true; },
  };
  globalThis.document = {
    createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    head: { append: (s) => { scripts.push(s); if (s.onload) setTimeout(s.onload, 0); } },
  };
  if (before) before(globalThis.window);
  await import(pathToFileURL(join(root, 'scripts/consent-check.js')).href);
  await settle();
  return { win: globalThis.window, srcs: () => scripts.map((s) => s.src), scripts, events };
}

await check('off production without ?martech=on nothing loads, not even the CMP', async () => {
  const b = await boot();
  assert.deepEqual(b.srcs(), []);
  assert.equal(b.events.length, 0);
});

await check('?martech=on&consent=accept loads every enabled route once; gtm gets its bootstrap', async () => {
  const b = await boot({ search: '?martech=on&consent=accept' });
  assert.deepEqual(b.srcs().sort(), [ALLOY, LAUNCH, GTM].sort());
  assert.equal(b.win.dataLayer[0].event, 'gtm.js');
  assert.deepEqual(b.events[0].detail.categories, { analytics: true, functional: true, personalization: true, marketing: true });
});

await check('?martech=on&consent=reject publishes all-denied and loads nothing', async () => {
  const b = await boot({ search: '?martech=on&consent=reject' });
  assert.deepEqual(b.srcs(), []);
  assert.equal(b.events[0].detail.categories.analytics, false);
});

await check('production + OneTrust waits for OptanonWrapper; C0002 loads analytics only; prior wrapper chained', async () => {
  let prior = 0;
  const b = await boot({ host: 'www.example.test', before: (w) => { Object.assign(w, { OptanonWrapper: () => { prior += 1; } }); } });
  assert.deepEqual(b.srcs(), [ONETRUST.src]);
  assert.equal(b.scripts[0].attrs['data-domain-script'], 'test-domain-id');
  b.win.OnetrustActiveGroups = ',C0001,C0002,';
  b.win.OptanonWrapper();
  await settle();
  assert.equal(prior, 1);
  assert.deepEqual(b.srcs().slice(1).sort(), [ALLOY, LAUNCH].sort());
});

await check('production + Cookiebot reads Cookiebot.consent on its events', async () => {
  const b = await boot({ host: 'www.example.test', data: contract({ consent: COOKIEBOT }) });
  assert.equal(b.scripts[0].attrs['data-cbid'], 'cb-test-id');
  b.win.Cookiebot = { consent: { necessary: true, statistics: false, marketing: true } };
  b.win.dispatchEvent({ type: 'CookiebotOnConsentReady' });
  await settle();
  assert.deepEqual(b.srcs().slice(1), [GTM]);
});

await check('production + none-required loads everything with no CMP', async () => {
  const b = await boot({ host: 'www.example.test', data: contract({ consent: { policy: 'none-required', categories: {} } }) });
  assert.deepEqual(b.srcs().sort(), [ALLOY, LAUNCH, GTM].sort());
});

await check('installed aem-martech gets contract ids, mapped consent, phases in order; revocation reaches it', async () => {
  globalThis.martechCalls = [];
  const b = await boot({ host: 'www.example.test', files: { 'plugins/martech/src/index.js': FAKE_MARTECH } });
  b.win.OnetrustActiveGroups = 'C0001,C0002';
  b.win.OptanonWrapper();
  await settle();
  const calls = globalThis.martechCalls;
  assert.deepEqual(calls[0], ['init', { datastreamId: 'ds-test', orgId: 'TESTORG@AdobeOrg' }, { personalization: false, launchUrls: [] }]);
  assert.deepEqual(calls[1], ['consent', { collect: true, marketing: false, personalize: false, share: false }]);
  assert.deepEqual(calls.slice(2, 5).map((c) => c[0]), ['eager', 'lazy', 'delayed']);
  assert.ok(!b.srcs().includes(ALLOY), 'fallback unused once the plugin is installed');
  b.win.OnetrustActiveGroups = 'C0001';
  b.win.OptanonWrapper();
  await settle();
  assert.deepEqual(calls.at(-1), ['consent', { collect: false, marketing: false, personalize: false, share: false }]);
});

delete globalThis.window;
delete globalThis.document;
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nmartech-runtime.test: all checks passed');
