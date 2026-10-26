#!/usr/bin/env node
// martech.mjs — contract from runtime scripts + spec-martech evidence: CMP, routes, consent model, rewrite sheet.
// Run: node plugins/stardust/skills/dynamics/scripts/test/martech.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelRead, buildContract, readEvidence, renderHandoff } from '../martech.mjs';

let failures = 0;
function check(name, fn) {
  try { fn(); } catch (e) { failures += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}

const OT_ID = '0a1b2c3d-1111-2222-3333-444455556666';
const SCRIPTS = {
  ot: 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js',
  launch: 'https://assets.adobedtm.com/abc/def/launch-0f1e2d3c.min.js',
  gtm: 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST',
  gtag: 'https://www.googletagmanager.com/gtag/js?id=G-TEST',
  aa: 'https://smetrics.example.com/b/ss/rsid/1/JS-2.22.0/s1',
};
const dynamics = (...scripts) => ({ pages: { '/': { host: 'www.example.com', scripts }, '/about': { host: 'www.example.com', scripts: scripts.slice(0, 1) } } });
const ONETRUST = [{
  domainScript: OT_ID,
  ruleSets: [
    { name: 'Global', default: true, groups: [{ id: 'C0001', name: 'Strictly Necessary', status: 'always active', hosts: [] }, { id: 'C0002', name: 'Performance', status: 'inactive', hosts: ['adobedtm.com'] }] },
    { name: 'US', default: false, groups: [] },
  ],
}];
const LAUNCH = {
  url: SCRIPTS.launch,
  rules: [
    { id: 'RL1', name: 'Page view', paths: ['/en/a.html', '/en/'], selectors: [], consentGroups: ['C0002'] },
    { id: 'RL2', name: 'Click', paths: [], selectors: ['.cta a'], consentGroups: [] },
    { id: 'RL3', name: 'Global', paths: [], selectors: [], consentGroups: [] },
  ],
  dataElements: [{ name: 'promoTitle', selectors: ['.promo h2'] }, { name: 'pageType', source: 'web.page.type', selectors: [] }],
};
const build = (scripts, martech, previous) => buildContract({ dynamics: dynamics(...scripts), martech, provenance: { writtenBy: 'test' }, previous });

check('CMP, routes and production hosts from the runtime scripts; everything disabled', () => {
  const c = build([SCRIPTS.ot, SCRIPTS.launch], { launch: LAUNCH, onetrust: ONETRUST });
  assert.deepEqual(c.productionHosts, ['www.example.com']);
  assert.deepEqual(c.consent.cmp, {
    vendor: 'OneTrust', src: SCRIPTS.ot, attrs: { 'data-domain-script': OT_ID }, groups: 'OnetrustActiveGroups', event: 'OneTrustGroupsUpdated', viaTagManager: false, enabled: false,
  });
  assert.deepEqual(c.routes, [{ id: 'adobe-launch', vendor: 'Adobe Launch', src: SCRIPTS.launch, boot: null, category: null, cmpGroups: ['C0002'], enabled: false }]);
});

check('consent categories come from the CMP default rule set, never vendor defaults', () => {
  const c = build([SCRIPTS.ot, SCRIPTS.launch], { launch: LAUNCH, onetrust: ONETRUST });
  assert.deepEqual(c.consent.categories.map((g) => g.id), ['C0001', 'C0002']);
  assert.equal(c.consent.ruleSets, 2);
  assert.deepEqual(build([SCRIPTS.ot, SCRIPTS.launch], { launch: null, onetrust: [] }).consent.categories, []);
});

check('per-tag when the tag manager gates its own rules by consent, else owner-decision', () => {
  assert.equal(build([SCRIPTS.launch], { launch: LAUNCH, onetrust: [] }).consent.model, 'per-tag');
  const ungated = { ...LAUNCH, rules: LAUNCH.rules.map((r) => ({ ...r, consentGroups: [] })) };
  assert.equal(build([SCRIPTS.launch], { launch: ungated, onetrust: [] }).consent.model, 'owner-decision');
  assert.equal(build([SCRIPTS.launch], { launch: null, onetrust: [] }).consent.model, 'owner-decision');
});

check('the first loader with a hit wins: GTM container, not the gtag it loads', () => {
  const c = build([SCRIPTS.gtm, SCRIPTS.gtag], { launch: null, onetrust: [] });
  assert.deepEqual(c.routes.map((r) => [r.id, r.src, r.boot]), [['google-tag-manager', SCRIPTS.gtm, 'gtm']]);
  assert.deepEqual(build([SCRIPTS.gtag], { launch: null, onetrust: [] }).routes.map((r) => r.boot), ['gtag']);
});

check('tags the routes do not load are listed, not routed', () => {
  const c = build([SCRIPTS.launch, SCRIPTS.aa], { launch: null, onetrust: [] });
  assert.deepEqual(c.otherTags, ['analytics: Adobe Analytics / Experience Cloud ID']);
  assert.equal(c.consent.cmp, null);
});

check('rewrite sheet: rules with .html paths or DOM selectors, data elements reading the DOM', () => {
  const { rewrite } = build([SCRIPTS.launch], { launch: LAUNCH, onetrust: [] });
  assert.deepEqual(rewrite.rules, [{ id: 'RL1', name: 'Page view', paths: ['/en/a.html'], selectors: [] }, { id: 'RL2', name: 'Click', paths: [], selectors: ['.cta a'] }]);
  assert.deepEqual(rewrite.dataElements, [{ name: 'promoTitle', selectors: ['.promo h2'] }]);
});

check('a CMP the tag manager injects is flagged so it is not loaded twice', () => {
  const launch = { ...LAUNCH, rules: [{ ...LAUNCH.rules[2], otDomainScripts: [OT_ID] }] };
  const c = build([SCRIPTS.ot, SCRIPTS.launch], { launch, onetrust: ONETRUST });
  assert.equal(c.consent.cmp.viaTagManager, true);
  assert.match(renderHandoff(c), /loads it twice/);
});

check('a rebuild keeps the owner choices', () => {
  const first = build([SCRIPTS.ot, SCRIPTS.launch], { launch: null, onetrust: [] });
  assert.equal(first.consent.cmp.attrs['data-domain-script'], null);
  first.consent.cmp.enabled = true; first.consent.cmp.attrs['data-domain-script'] = OT_ID;
  Object.assign(first.routes[0], { enabled: true, category: 'C0002' });
  const next = build([SCRIPTS.ot, SCRIPTS.launch], { launch: null, onetrust: [] }, first);
  assert.deepEqual([next.consent.cmp.enabled, next.consent.cmp.attrs['data-domain-script']], [true, OT_ID]);
  assert.deepEqual([next.routes[0].enabled, next.routes[0].category], [true, 'C0002']);
});

check('handoff: how to enable, the model, routes and the rewrite sheet', () => {
  const md = renderHandoff(build([SCRIPTS.ot, SCRIPTS.launch], { launch: LAUNCH, onetrust: ONETRUST }));
  assert.match(md, /scaffolded \*\*off\*\*/);
  assert.match(md, /`www\.example\.com`/);
  assert.match(md, /Model `per-tag`/);
  assert.match(md, /`C0002` Performance/);
  assert.match(md, /\| adobe-launch \| Adobe Launch \|/);
  assert.match(md, /rule `RL1` Page view — paths `\/en\/a\.html`/);
  assert.match(md, /data element `promoTitle`/);
  assert.match(renderHandoff(build([SCRIPTS.ot], { launch: null, onetrust: [] })), /not found — copy it from the CMP admin/);
});

const DS = ['11111111-2222-4333-8444-555555555555', '66666666-7777-4888-9999-aaaaaaaaaaaa'];
const SDK = (ids = [DS[0]], defaultConsent = null) => ({
  ...LAUNCH,
  orgId: 'TEST@AdobeOrg',
  extensions: ['Core', 'Adobe Experience Platform Web SDK'],
  webSdk: { version: '2.34.2', selfHostable: true, library: 'managed', instances: [{ name: 'alloy', edgeDomain: null, defaultConsent, datastream: { ref: '%DS%', ids }, stagingDatastream: { ref: null, ids: [] } }] },
  rules: [...LAUNCH.rules, { id: 'RL4', name: 'Cart add', events: ['datalayerPushListener'], pushEvents: ['cart:add'], paths: [], selectors: [], consentGroups: [] }],
});

check('aemMartech: off and null without Web SDK evidence; from the Launch extension otherwise', () => {
  assert.equal(build([SCRIPTS.launch], { launch: LAUNCH, onetrust: [] }).aemMartech, null);
  const a = build([SCRIPTS.launch], { launch: SDK(), onetrust: [] }).aemMartech;
  assert.equal(a.enabled, false);
  assert.deepEqual(a.config, { orgId: 'TEST@AdobeOrg', datastreamId: DS[0], alloyInstanceName: 'alloy', edgeDomain: null, defaultConsent: 'in', launchUrls: [SCRIPTS.launch] });
  assert.deepEqual(a.missingExtensions, ['Adobe Client Data Layer']);
  const two = build([SCRIPTS.launch], { launch: SDK(DS, 'pending'), onetrust: [] }).aemMartech;
  assert.deepEqual([two.config.datastreamId, two.candidates.datastreamId, two.config.defaultConsent], [null, DS, 'pending']);
  const page = build(['https://cdn.example.com/js/alloy.min.js'], { launch: null, onetrust: [] }).aemMartech;
  assert.deepEqual([page.config.orgId, page.config.defaultConsent, page.extension], [null, null, null]);
});

check('aemMartech: a rebuild keeps the owner choices; the handoff lists data-layer rules and the switch steps', () => {
  const first = build([SCRIPTS.launch], { launch: SDK(DS), onetrust: [] });
  Object.assign(first.aemMartech, { enabled: true, category: 'C0002' }); first.aemMartech.config.datastreamId = DS[1];
  const next = build([SCRIPTS.launch], { launch: SDK(DS), onetrust: [] }, first).aemMartech;
  assert.deepEqual([next.enabled, next.category, next.config.datastreamId], [true, 'C0002', DS[1]]);
  const md = renderHandoff(build([SCRIPTS.launch], { launch: SDK(DS), onetrust: [] }));
  assert.match(md, /must push the same events: `cart:add` \(1\)/);
  assert.match(md, /tagging plan \(solution design reference\)[\s\S]*add each push in the block that owns the interaction/);
  assert.match(md, /## Data layer[\s\S]*Adobe Launch rules fire on data-layer pushes[\s\S]*rule `RL4` Cart add — listens for `cart:add`/);
  assert.match(md, /re-run `deploy\/scripts\/martech-scaffold\.mjs` and `dynamics\/scripts\/dynamics-check\.mjs`/);
  assert.match(md, /extension 2\.34\.2 \(managed library, self-hosted build supported\)/);
  assert.match(md, /choose one/);
  assert.match(md, /git subtree add --squash --prefix plugins\/martech/);
  assert.match(md, /Missing Launch extension:\*\* Adobe Client Data Layer/);
  assert.doesNotMatch(renderHandoff(build([SCRIPTS.launch], { launch: LAUNCH, onetrust: [] })), /Web SDK|owner project/);
});

check('target: null without evidence; Web SDK decisions or at.js recorded off; a rebuild keeps the owner choice; the handoff says how', () => {
  assert.equal(build([SCRIPTS.launch], { launch: SDK(), onetrust: [] }).target, null);
  const ws = { ...SDK(), target: { atjs: null, renderRules: [{ id: 'RL5', name: 'Page view' }], prehiding: true } };
  const first = build([SCRIPTS.launch], { launch: ws, onetrust: [] });
  assert.deepEqual(first.target, { atjs: null, webSdk: { renderRules: [{ id: 'RL5', name: 'Page view' }], prehiding: true }, enabled: false });
  first.target.enabled = true;
  assert.equal(build([SCRIPTS.launch], { launch: ws, onetrust: [] }, first).target.enabled, true);
  const md = renderHandoff(build([SCRIPTS.launch], { launch: ws, onetrust: [] }));
  assert.match(md, /## Personalization \(Target\)[\s\S]*rules `RL5` render them, with a prehiding style[\s\S]*set `target\.enabled`/);
  assert.doesNotMatch(md, /not wired/);
  const ext = build([SCRIPTS.launch], { launch: { ...LAUNCH, target: { atjs: 'adobe-target-v2', renderRules: [], prehiding: false } }, onetrust: [] }).target;
  assert.deepEqual([ext.atjs, ext.webSdk], [{ from: 'launch', extension: 'adobe-target-v2' }, null]);
  const pageSrc = 'https://www.example.com/etc/at.min.js';
  const page = build([pageSrc], { launch: null, onetrust: [] });
  assert.deepEqual(page.target.atjs, { from: 'page', src: pageSrc });
  assert.ok(!page.otherTags.some((r) => /Target/.test(r)), 'Target has its own section, not otherTags');
  assert.match(renderHandoff(page), /not routed: it will not load[\s\S]*moving the activities to the Web SDK is an owner project/);
});

check('readEvidence: a spec knowledge folder (martech.json#evidence) reads as the raw spec-martech folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mt-ev-'));
  try {
    const launch = { rules: [{ name: 'r', consentGroups: ['C0002'], paths: [], selectors: [] }], dataElements: [] };
    const onetrust = [{ domainScript: 'abc', ruleSets: [] }];
    const consentMode = { pages: 1, of: 2, libraries: [] };
    mkdirSync(join(dir, 'raw')); writeFileSync(join(dir, 'raw', 'launch.json'), JSON.stringify(launch)); writeFileSync(join(dir, 'raw', 'onetrust.json'), JSON.stringify(onetrust));
    writeFileSync(join(dir, 'raw', 'consent-mode.json'), JSON.stringify(consentMode));
    mkdirSync(join(dir, 'knowledge')); writeFileSync(join(dir, 'knowledge', 'martech.json'), JSON.stringify({ vendors: [], evidence: { launch, onetrust, consentMode } }));
    assert.deepEqual(readEvidence(join(dir, 'knowledge')), readEvidence(join(dir, 'raw')));
    assert.deepEqual(readEvidence(join(dir, 'none')), { launch: null, onetrust: [], consentMode: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check('data layer: any tag manager or data-layer global gets the section; unread tag managers are named', () => {
  const d = { pages: { '/': { host: 'www.example.com', scripts: [SCRIPTS.gtm], cms: { dataLayer: ['0'], digitalData: ['page'] } } } };
  const c = buildContract({ dynamics: d, provenance: { writtenBy: 'test' } });
  assert.deepEqual([c.tagManagers, c.dataLayers], [['Google Tag Manager'], ['dataLayer', 'digitalData']]);
  const md = renderHandoff(c);
  assert.match(md, /## Data layer\n\nThe source pages expose `dataLayer`, `digitalData`; keep the same global names\./);
  assert.match(md, /Rules in Google Tag Manager were not parsed\. Read each library listed in `martech\/tags\.json`/);
  assert.match(md, /add each push in the block that owns the interaction/);
  assert.doesNotMatch(renderHandoff(buildContract({ dynamics: { pages: { '/': { host: 'x.test', scripts: [] } } }, provenance: {} })), /## Data layer/);
  assert.doesNotMatch(renderHandoff(build([SCRIPTS.launch], { launch: SDK(DS), onetrust: [] })), /Rules in Adobe Launch were not read/);
});
check('Google Consent Mode: an inline consent default makes the model google-consent-mode; a library-only hint stays evidence', () => {
  const d = { pages: { '/': { host: 'www.example.com', scripts: ['https://www.googletagmanager.com/gtm.js?id=GTM-TEST'] } } };
  const inline = buildContract({ dynamics: d, provenance: {}, martech: { launch: null, onetrust: [], consentMode: { pages: 2, of: 3, libraries: [] } } });
  assert.equal(inline.consent.model, 'google-consent-mode');
  const md = renderHandoff(inline);
  assert.match(md, /\*\*Model `google-consent-mode`:\*\* .*copy the inline consent default into `head\.html`/);
  assert.match(md, /\*\*Google Consent Mode:\*\* inline `consent` default on 2 of 3 probed pages\./);
  const lib = buildContract({ dynamics: d, provenance: {}, martech: { launch: null, onetrust: [], consentMode: { pages: 0, of: 3, libraries: ['tags/gtm.js'] } } });
  assert.equal(lib.consent.model, 'owner-decision');
  assert.match(renderHandoff(lib), /consent-mode calls in `tags\/gtm\.js`\. Check it with the owner before gating a route on a category\./);
  assert.equal(buildContract({ dynamics: d, provenance: {} }).consent.consentMode, null);
});
check('other tag managers: a custom GTM data-layer name; tagNotes read in Launch shape render in the same sections', () => {
  const d = { pages: { '/': { host: 'www.example.com', scripts: ['https://www.googletagmanager.com/gtm.js?id=GTM-TEST&l=gtmDataLayer'] } } };
  const first = buildContract({ dynamics: d, provenance: {} });
  assert.deepEqual([first.dataLayers, first.tagNotes, first.consent.model], [['gtmDataLayer'], {}, 'owner-decision']);
  first.tagNotes['Google Tag Manager'] = {
    rules: [
      { name: 'GA4 add_to_cart', events: ['addToCart'], consentGroups: ['C0004'], from: 'tags/gtm.js: trigger 12 (customEvent addToCart)' },
      { name: 'Promo click', selectors: ['.promo a'], paths: ['/offers.html'], from: 'tags/gtm.js: trigger 7 (linkClick)' },
      { name: 'uncited', events: ['x'] },
    ],
    dataElements: [{ name: 'DLV - product', source: 'ecommerce.items', selectors: ['h1.title'], from: 'tags/gtm.js: variable 3' }],
    notes: 'Container also loads a heatmap tag on every page.',
  };
  const next = buildContract({ dynamics: d, provenance: {}, previous: first });
  assert.deepEqual(next.tagNotes, first.tagNotes);
  assert.deepEqual([next.consent.model, next.consent.modelFrom], ['owner-decision', undefined], 'the model reading never changes the consent model');
  const md = renderHandoff(next);
  assert.match(md, /\*\*Model `owner-decision`:\*\*/);
  assert.match(md, /\*\*Consent checks read by the model \(evidence only; the model above comes from parsed evidence and does not change\):\*\*/);
  assert.match(md, /- Google Tag Manager rule GA4 add_to_cart checks `C0004` — read by the model at tags\/gtm\.js: trigger 12/);
  assert.match(md, /- Google Tag Manager rule Promo click — paths `\/offers\.html` — selectors `\.promo a` — read by the model at tags\/gtm\.js: trigger 7/);
  assert.match(md, /- Google Tag Manager data element DLV - product — selectors `h1\.title` — read by the model at tags\/gtm\.js: variable 3/);
  assert.match(md, /Google Tag Manager \(read by the model, not parsed\) rules fire on data-layer pushes; the migrated pages must push the same events: `addToCart` \(1\)\./);
  assert.match(md, /Data elements read these data-layer paths: `ecommerce\.items`\./);
  assert.match(md, /- Google Tag Manager rule GA4 add_to_cart — listens for `addToCart` — read by the model at/);
  assert.match(md, /\*\*Google Tag Manager:\*\* Container also loads a heatmap tag/);
  assert.match(md, /1 `tagNotes` entry without a name or a `from` citation was left out/);
  assert.doesNotMatch(md, /were not parsed|uncited/);
  assert.equal(modelRead({ T: 'free text only' }).rules.length, 0);
});
check('tagNotes keyed by the route id (slug) count as read; array notes render as bullets', () => {
  const c = buildContract({ dynamics: { pages: { '/': { host: 'www.example.com', scripts: [SCRIPTS.gtm] } } }, provenance: {} });
  c.tagNotes['google-tag-manager'] = { rules: [], dataElements: [], notes: ['first note', 'second note'] };
  const md = renderHandoff(c);
  assert.doesNotMatch(md, /were not parsed/);
  assert.match(md, /\*\*google-tag-manager:\*\*\n- first note\n- second note/);
});
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('martech: all checks passed');
