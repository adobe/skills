#!/usr/bin/env node
// martech.mjs — contract from runtime scripts + spec-martech evidence: CMP, routes, consent model, rewrite sheet.
// Run: node plugins/stardust/skills/dynamics/scripts/test/martech.test.mjs
import assert from 'node:assert/strict';
import { buildContract, renderHandoff } from '../martech.mjs';

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

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('martech: all checks passed');
