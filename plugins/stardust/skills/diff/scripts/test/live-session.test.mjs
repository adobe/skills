#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — the pure part of the shared live-session library: the exported
// surface every instrument imports, the consent-accept candidate list (the cmp-prefixed candidates are present,
// no duplicates, the OneTrust id first), isLiveHttpUrl and defaultWaitUntil. No browser: dismissOverlays itself
// runs inside stitch-shot / the diff probes against a page.
// Run: node plugins/stardust/skills/diff/scripts/test/live-session.test.mjs
import assert from 'node:assert/strict';
import * as session from '../live-session.mjs';

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('the exported surface the instruments import', () => {
  for (const name of ['REAL_CHROME_UA', 'CONSENT_CANDIDATES', 'isLiveHttpUrl', 'defaultWaitUntil', 'newLiveContext', 'gotoLive', 'dismissOverlays', 'launchStealthHeaded', 'browserTier']) assert.ok(name in session, `${name} exported`);
  assert.equal(typeof session.dismissOverlays, 'function');
});
check('consent candidates: OneTrust first, the cmp-prefixed consent-manager buttons present, text fallbacks last, no duplicates', () => {
  const c = session.CONSENT_CANDIDATES;
  assert.ok(Array.isArray(c) && c.length >= 9, `${c.length} candidates`);
  assert.equal(c[0], '#onetrust-accept-btn-handler');
  for (const sel of ['#cmpwelcomebtnyes', '.cmpboxbtnyes', '#cmpbntyestxt']) assert.ok(c.includes(sel), `${sel} is a candidate`);
  assert.ok(c.indexOf('#cmpwelcomebtnyes') < c.indexOf('button:has-text("Accept all")'), 'id selectors before the text fallbacks');
  assert.equal(new Set(c).size, c.length, 'no duplicate candidate');
  assert.ok(c.every((sel) => typeof sel === 'string' && sel.trim() === sel && sel.length), 'every candidate is a trimmed selector string');
});
check('isLiveHttpUrl: live http(s) only — never localhost, loopback, file: or garbage', () => {
  assert.equal(session.isLiveHttpUrl('https://www.example.com/page'), true);
  assert.equal(session.isLiveHttpUrl('http://example.org'), true);
  for (const u of ['http://localhost:8791/x.html', 'http://127.0.0.1:8791/', 'http://[::1]/', 'http://0.0.0.0/', 'file:///tmp/x.html', 'not a url', '']) assert.equal(session.isLiveHttpUrl(u), false, u);
});
check('defaultWaitUntil: networkidle for local and EDS origins, domcontentloaded for other live sites', () => {
  assert.equal(session.defaultWaitUntil('http://localhost:8791/x.html'), 'networkidle');
  assert.equal(session.defaultWaitUntil('https://main--site--org.aem.page/'), 'networkidle');
  assert.equal(session.defaultWaitUntil('https://main--site--org.hlx.live/'), 'networkidle');
  assert.equal(session.defaultWaitUntil('https://www.example.com/'), 'domcontentloaded');
});

console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nlive-session: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
