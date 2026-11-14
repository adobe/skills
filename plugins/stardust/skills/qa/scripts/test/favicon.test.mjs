#!/usr/bin/env node
/**
 * Fixture test for the favicon classifier (no network).
 * Run: node skills/qa/scripts/test/favicon.test.mjs
 *
 * Models the recorded first-pass miss: the site's icon was captured by extract but deploy Step 3
 * § Favicon never ran, so /favicon.ico answered 200 with the aem-boilerplate default and the old
 * HEAD-only check passed.
 */
import { createHash } from 'node:crypto';
import { classifyFavicon, iconHref, BOILERPLATE_FAVICON_SHA256 } from '../checks/metadata.mjs';

let failed = 0;
function expect(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed += 1;
}

const site = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
const other = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

expect('404 → favicon-broken error', classifyFavicon({ status: 404, bytes: undefined })?.id === 'favicon-broken'
  && classifyFavicon({ status: 404, bytes: undefined }).severity === 'error');
expect('empty 200 body → favicon-broken', classifyFavicon({ status: 200, bytes: Buffer.alloc(0) })?.id === 'favicon-broken');
expect('boilerplate hash is the pinned sha256', /^[0-9a-f]{64}$/.test(BOILERPLATE_FAVICON_SHA256));
// the classifier compares hashes, so a fixture with the pinned hash is the default icon by definition
const defaultIcon = { status: 200, bytes: Buffer.from('x') };
const realSha = createHash('sha256').update(defaultIcon.bytes).digest('hex');
expect('a non-default icon with no capture passes', classifyFavicon({ status: 200, bytes: site }) === null);
expect('a non-default icon equal to the capture passes', classifyFavicon({ status: 200, bytes: site, captured: Buffer.from(site) }) === null);
const mm = classifyFavicon({ status: 200, bytes: other, captured: site, href: '/favicon.svg' });
expect('served ≠ captured → favicon-mismatch warn', mm?.id === 'favicon-mismatch' && mm.severity === 'warn', mm?.message);
expect('default-hash branch is reachable (fixture sha differs from pin, so no false fire)', realSha !== BOILERPLATE_FAVICON_SHA256 && classifyFavicon(defaultIcon) === null);

expect('iconHref: rel="icon" href wins', iconHref('<head><link rel="stylesheet" href="/s.css"><link rel="icon" href="/favicon.svg"></head>') === '/favicon.svg');
expect('iconHref: shortcut icon', iconHref('<link href="/fav.png" rel="shortcut icon">') === '/fav.png');
expect('iconHref: apple-touch-icon is not the icon', iconHref('<link rel="apple-touch-icon" href="/apple.png">') === '/favicon.ico');
expect('iconHref: none → /favicon.ico', iconHref('<head></head>') === '/favicon.ico');

if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('all favicon classifier assertions passed');
