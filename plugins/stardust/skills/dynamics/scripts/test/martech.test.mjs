#!/usr/bin/env node
// martech.mjs: evidence fixtures per source stack → contract routes, consent, vendors.
// Run: node plugins/stardust/skills/dynamics/scripts/test/martech.test.mjs
import assert from 'node:assert/strict';
import {
  reduceUrl, isMartechUrl, parseStaticHtml, extractIds, fingerprint, buildContract, renderHandoff,
} from '../martech.mjs';

let failures = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}

const OT = '0a1b2c3d-1111-2222-3333-444455556666';
const CB = '9f8e7d6c-1111-2222-3333-444455556666';
const DS = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const ORG_HEX = '0123456789ABCDEF01234567';
const LAUNCH = 'https://assets.adobedtm.com/abc123/def456/launch-0f1e2d3c4b5a.min.js';
const contract = (evidence) => buildContract({ evidence, hosts: ['www.example.test'], provenance: { writtenBy: 'test' } });
const routeById = (c, id) => c.routes.find((r) => r.id === id);
const vendorById = (c, id) => c.vendors.find((v) => v.id === id);

check('reduceUrl keeps id params and drops per-visitor values', () => {
  assert.equal(reduceUrl('https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC1234&cid=123.456&_p=9'), 'https://region1.google-analytics.com/g/collect?tid=G-ABC1234');
  assert.equal(reduceUrl(`https://edge.adobedc.net/ee/v1/interact?configId=${DS}&requestId=r-1`), `https://edge.adobedc.net/ee/v1/interact?configId=${DS}`);
  assert.equal(reduceUrl('https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD&l=dl2'), 'https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD&l=dl2');
  assert.equal(reduceUrl('https://px.example.test/p?id=user@example.test'), 'https://px.example.test/p');
  assert.equal(reduceUrl('not a url'), null);
});

check('isMartechUrl matches vendor rows and collector paths, not first-party pages', () => {
  assert.ok(isMartechUrl(LAUNCH));
  assert.ok(isMartechUrl('https://metrics.example.test/b/ss/rs1/1/JS-2.22.0/s123'));
  assert.ok(isMartechUrl('https://sgtm.example.test/gtm.js?id=GTM-AB12CD'));
  assert.ok(!isMartechUrl('https://www.example.test/share?to=pinterest'));
  assert.ok(!isMartechUrl('data:text/javascript,1'));
});

check('parseStaticHtml reads static tags, CMP attributes, inline hosts and ids', () => {
  const html = `<head>
    <script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js" data-domain-script="${OT}" charset="UTF-8"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script>
    <script>window.dataLayer=window.dataLayer||[];gtag('config','G-ABC1234');</script>
    <script>(function(){var s=document.createElement('script');s.src='https://static.hotjar.com/c/hotjar-1.js';})();</script>
    <script type="application/ld+json">{"x":"G-ZZZZ9999"}</script>
    <script src="/scripts/app.js"></script>
  </head>`;
  const p = parseStaticHtml(html, 'https://www.example.test/');
  assert.deepEqual(p.staticScripts.map((s) => s.src), ['https://cdn.cookielaw.org/scripttemplates/otSDKStub.js', 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234']);
  assert.deepEqual(p.staticScripts[0].attrs, { 'data-domain-script': OT });
  assert.deepEqual(p.inlineIds, ['G-ABC1234']);
  assert.deepEqual(p.inlineHosts, ['static.hotjar.com']);
});

// acceptance: OneTrust + Launch (Web SDK inside) + direct gtag + a pixel Launch loads
const acceptance = {
  staticScripts: [
    { src: 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js', attrs: { 'data-domain-script': OT } },
    { src: LAUNCH, attrs: {} },
    { src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234', attrs: {} },
  ],
  urls: [
    `https://edge.adobedc.net/ee/v1/interact?configId=${DS}`,
    'https://connect.facebook.net/en_US/fbevents.js',
    'https://region1.google-analytics.com/g/collect?tid=G-ABC1234',
  ],
  inlineIds: ['G-ABC1234'],
  cookieNames: [`AMCV_${ORG_HEX}%40AdobeOrg`, '_ga', 'OptanonConsent'],
  preConsentHosts: ['cdn.cookielaw.org'],
};

check('acceptance: OneTrust gates Launch as-is and direct GA4 via aem-gtm-martech', () => {
  const c = contract(acceptance);
  assert.deepEqual(c.productionHosts, ['www.example.test']);
  assert.equal(c.consent.cmp, 'onetrust');
  assert.equal(c.consent.cmpId, OT);
  assert.equal(c.consent.policy, 'cmp');
  assert.equal(c.consent.categories.analytics, 'C0002');
  assert.deepEqual(c.consent.flags, []);
  const launch = routeById(c, 'adobe-launch');
  assert.equal(launch.loader, 'url');
  assert.equal(launch.src, LAUNCH);
  assert.equal(launch.upgrade, 'aem-martech');
  assert.equal(launch.enabled, true);
  assert.equal(launch.status, 'host-gated');
  const ga = routeById(c, 'google-gtm-martech');
  assert.equal(ga.loader, 'aem-gtm-martech');
  assert.deepEqual(ga.config, { tags: ['G-ABC1234'], containers: { lazy: [], delayed: [] }, dataLayerInstanceName: 'dataLayer' });
  assert.equal(ga.fallback, null);
  assert.equal(c.routes.length, 2);
  assert.equal(vendorById(c, 'ad-pixel').status, 'via-tag-manager');
  assert.equal(vendorById(c, 'adobe-websdk').status, 'via-tag-manager');
  assert.equal(vendorById(c, 'onetrust').status, 'host-gated');
  assert.deepEqual(c.ids.orgIds, [`${ORG_HEX}@AdobeOrg`]);
  assert.deepEqual(c.ids.datastreamIds, [DS]);
  assert.ok(c.stack.includes('Adobe Web SDK (in Launch)'));
});

check('no invented ids: every id in the contract appears in the evidence', () => {
  const c = contract(acceptance);
  const evidence = JSON.stringify(acceptance);
  const found = JSON.stringify({ ...c, _provenance: null }).match(/\b(?:GTM-[A-Z0-9]+|G-[A-Z0-9]+|[0-9a-f]{8}-[0-9a-f-]{27})\b/g) || [];
  for (const id of found) assert.ok(evidence.includes(id), `${id} not in evidence`);
});

check('self-hosted alloy with datastream + org ships aem-martech enabled', () => {
  const c = contract({
    staticScripts: [{ src: 'https://www.example.test/js/alloy.min.js', attrs: {} }],
    urls: [`https://edge.adobedc.net/ee/v1/interact?configId=${DS}`],
    cookieNames: [`kndctr_${ORG_HEX}_AdobeOrg_identity`],
  });
  const r = routeById(c, 'adobe-websdk');
  assert.equal(r.loader, 'aem-martech');
  assert.deepEqual(r.config, { datastreamId: DS, orgId: `${ORG_HEX}@AdobeOrg`, launchUrls: [] });
  assert.equal(r.enabled, true);
  assert.equal(r.status, 'host-gated');
  assert.equal(vendorById(c, 'adobe-websdk').status, 'host-gated');
});

check('self-hosted alloy without an org id ships disabled, awaiting the owner', () => {
  const c = contract({ staticScripts: [{ src: 'https://www.example.test/js/alloy.js', attrs: {} }], inlineConfigIds: [DS] });
  const r = routeById(c, 'adobe-websdk');
  assert.equal(r.enabled, false);
  assert.equal(r.status, 'scaffolded-awaiting-owner');
  assert.deepEqual(r.missing, ['orgId']);
  assert.equal(r.config.orgId, null);
});

check('Web SDK loaded by GTM stays in the container, no second copy', () => {
  const c = contract({ urls: ['https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD', `https://edge.adobedc.net/ee/v1/interact?configId=${DS}`] });
  assert.deepEqual(c.routes.map((r) => r.id), ['google-tag-manager']);
  assert.equal(vendorById(c, 'adobe-websdk').status, 'via-tag-manager');
  assert.ok(c.stack.includes('Adobe Web SDK (in tag manager)'));
});

check('legacy Launch (AppMeasurement) ships the Launch URL with an aem-martech upgrade', () => {
  const c = contract({ urls: [LAUNCH, 'https://metrics.example.test/b/ss/rs1,rs2/1/JS-2.22.0/s1'] });
  assert.equal(routeById(c, 'adobe-launch').upgrade, 'aem-martech');
  assert.deepEqual(c.ids.rsids, ['rs1', 'rs2']);
  assert.ok(c.stack.includes('Adobe Analytics (AppMeasurement)'));
});

check('AppMeasurement without Launch or Web SDK is scaffolded, never guessed', () => {
  const c = contract({ urls: ['https://metrics.example.test/b/ss/rs1/1/JS-2.22.0/s1'] });
  const r = routeById(c, 'adobe-analytics');
  assert.equal(r.enabled, false);
  assert.equal(r.config.datastreamId, null);
});

check('GA4 only via GTM ships the GTM loader with an aem-gtm-martech upgrade', () => {
  const ev = { urls: ['https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD&l=siteLayer', 'https://region1.google-analytics.com/g/collect?tid=G-ABC1234'] };
  const c = contract(ev);
  const r = routeById(c, 'google-tag-manager');
  assert.equal(r.loader, 'gtm');
  assert.equal(r.src, 'https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD&l=siteLayer');
  assert.deepEqual(r.config, { dataLayerInstanceName: 'siteLayer' });
  assert.equal(r.upgrade, 'aem-gtm-martech');
  assert.equal(vendorById(c, 'ga4').status, 'via-tag-manager');
  assert.ok(!fingerprint(ev).ga4Direct);
});

check('direct GA4 next to GTM keeps the container in the plugin with a GTM fallback', () => {
  const c = contract({
    staticScripts: [{ src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234', attrs: {} }],
    urls: ['https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD'],
  });
  const r = routeById(c, 'google-gtm-martech');
  assert.deepEqual(r.config.containers, { lazy: ['GTM-AB12CD'], delayed: [] });
  assert.equal(r.fallback.loader, 'gtm');
  assert.equal(c.routes.length, 1);
});

check('Tealium ships utag.js as-is', () => {
  const src = 'https://tags.tiqcdn.com/utag/acct/main/prod/utag.js';
  const c = contract({ staticScripts: [{ src, attrs: {} }] });
  assert.deepEqual([routeById(c, 'tealium').loader, routeById(c, 'tealium').src], ['url', src]);
});

check('direct, inline and runtime vendors: url route, inline snippet, owner item', () => {
  const c = contract({
    staticScripts: [{ src: 'https://static.hotjar.com/c/hotjar-1.js?sv=6', attrs: {} }],
    inlineHosts: ['snap.licdn.com'],
    urls: ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'https://widget.intercom.io/widget/x1'],
  });
  const replay = routeById(c, 'session-replay');
  assert.equal(replay.loader, 'url');
  assert.equal(replay.category, 'analytics');
  assert.equal(vendorById(c, 'session-replay').via, 'direct');
  const pixel = vendorById(c, 'ad-pixel');
  assert.deepEqual([pixel.via, pixel.status, pixel.upgrade], ['inline', 'scaffolded-awaiting-owner', 'inline-snippet']);
  const chat = vendorById(c, 'chat');
  assert.deepEqual([chat.via, chat.status], ['runtime', 'scaffolded-awaiting-owner']);
});

check('no CMP on the source: consent stays an owner decision', () => {
  const c = contract({ urls: [LAUNCH] });
  assert.equal(c.consent.policy, 'owner-decision');
  assert.equal(c.consent.cmp, null);
  assert.equal(c.consent.categories.analytics, null);
  assert.match(c.consent.flags[0], /^no-cmp-on-source/);
});

check('Cookiebot: id from the tag, categories mapped, auto-blocking dropped', () => {
  const c = contract({ staticScripts: [{ src: 'https://consent.cookiebot.com/uc.js', attrs: { id: 'Cookiebot', 'data-cbid': CB, 'data-blockingmode': 'auto' } }] });
  assert.equal(c.consent.cmpId, CB);
  assert.equal(c.consent.policy, 'cmp');
  assert.equal(c.consent.categories.marketing, 'marketing');
  assert.ok(c.consent.flags.some((f) => f.startsWith('cookiebot-auto-blocking-dropped')));
});

check('OneTrust loaded by a tag manager: id read from the consent JSON path', () => {
  const ids = extractIds({ urls: [`https://cdn.cookielaw.org/consent/${OT}/${OT}.json`] });
  assert.equal(ids.onetrust, OT);
});

check('unsupported CMP falls back to an owner decision', () => {
  const c = contract({ urls: ['https://app.usercentrics.eu/browser-ui/latest/loader.js'] });
  assert.equal(c.consent.cmp, 'usercentrics');
  assert.equal(c.consent.policy, 'owner-decision');
  assert.ok(c.consent.flags.some((f) => f.startsWith('cmp-adapter-missing')));
});

check('pre-consent firing on the source is flagged', () => {
  const c = contract({ ...acceptance, preConsentHosts: ['cdn.cookielaw.org', 'connect.facebook.net'] });
  assert.ok(c.consent.flags.some((f) => /source-fires-before-consent: connect\.facebook\.net/.test(f)));
});

check('handoff lists hosts, routes, vendors and owner actions', () => {
  const md = renderHandoff(contract({ urls: [LAUNCH, 'https://connect.facebook.net/en_US/fbevents.js'] }));
  assert.match(md, /^<!-- stardust provenance: test/);
  assert.match(md, /`www\.example\.test`/);
  assert.match(md, /\| adobe-launch \| url \| analytics \| true \| host-gated \| aem-martech \|/);
  assert.match(md, /Set `consent\.policy`/);
  assert.match(md, /Confirm in the tag manager .*ad \/ retargeting pixel/);
});

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('martech: all checks passed');
