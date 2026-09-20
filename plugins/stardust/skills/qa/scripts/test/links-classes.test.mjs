#!/usr/bin/env node
/**
 * Fixture test: qa/checks/links.mjs classifyHref() — the T27.8 link classes as pure decisions.
 * Run: node skills/qa/scripts/test/links-classes.test.mjs   (exit 1 on failure)
 *
 *   - a `--source-host` href whose path is in the inventory is `source-host-link` error (a bounce link
 *     localize-links should have rewritten); a path outside the inventory is the honest boundary (warn);
 *   - with no source hosts configured the same href is plain `external` (class off, never a false error);
 *   - a root-relative target listed in link-gaps.tsv is flagged `planned` (→ planned-link-gap, never
 *     broken-internal-link); fragments, assets, mailto/tel well-formedness and same-host absolutes.
 */
import assert from 'node:assert/strict';
import { classifyHref } from '../checks/links.mjs';

const base = 'https://main--site--org.aem.page';
const known = new Set(['/', '/about', '/nav', '/footer']);
const sourceHosts = new Set(['www.example-source.test']);
const plannedGaps = new Set(['/legacy/brochure']);
const c = (href, o = {}) => classifyHref(href, { base, known, sourceHosts, plannedGaps, ...o });

assert.deepEqual(c(''), { kind: 'empty-href' });
assert.deepEqual(c('#'), { kind: 'empty-href' });
assert.deepEqual(c('#top'), { kind: 'anchor', id: 'top' });
assert.deepEqual(c('mailto:hello@example.test?subject=x'), { kind: 'mailto', malformed: false });
assert.deepEqual(c('mailto:nope'), { kind: 'mailto', malformed: true });
assert.deepEqual(c('tel:+1 (555) 010-0100'), { kind: 'tel', malformed: false });
assert.deepEqual(c('tel:12'), { kind: 'tel', malformed: true });

// internal: known / unknown / planned gap / fragment / asset
assert.deepEqual(c('/about/'), { kind: 'internal', target: '/about', frag: null, known: true, planned: false });
assert.deepEqual(c('/about?utm=1#team'), { kind: 'internal', target: '/about', frag: 'team', known: true, planned: false });
assert.deepEqual(c('/missing'), { kind: 'internal', target: '/missing', frag: null, known: false, planned: false });
assert.deepEqual(c('/legacy/brochure'), { kind: 'internal', target: '/legacy/brochure', frag: null, known: false, planned: true }, 'link-gaps.tsv row → planned, never broken');
assert.deepEqual(c('/styles/styles.css'), { kind: 'asset', target: '/styles/styles.css' });
assert.deepEqual(c(`${base}/about`), { kind: 'internal', target: '/about', frag: null, known: true, planned: false }, 'same-host absolute is internal');
assert.deepEqual(c(`${base}/media/x.png`), { kind: 'asset', target: '/media/x.png' });

// source-host links: in inventory → error (bounce the localize stage missed); outside → warn (honest boundary)
assert.deepEqual(c('https://www.example-source.test/about'), { kind: 'source-host-link', host: 'www.example-source.test', target: '/about', inInventory: true, severity: 'error' });
assert.deepEqual(c('https://www.example-source.test/pricing/'), { kind: 'source-host-link', host: 'www.example-source.test', target: '/pricing', inInventory: false, severity: 'warn' });
assert.deepEqual(c('HTTPS://WWW.EXAMPLE-SOURCE.TEST/about').kind, 'source-host-link', 'host match is case-insensitive');
// class off when no host is configured: the same href is a plain external, never a false error
assert.deepEqual(c('https://www.example-source.test/about', { sourceHosts: new Set() }), { kind: 'external', url: 'https://www.example-source.test/about' });
assert.deepEqual(c('https://other.example/x'), { kind: 'external', url: 'https://other.example/x' });
assert.deepEqual(c('javascript:void(0)'), { kind: 'other' });
assert.deepEqual(c('https://[bad'), { kind: 'external', url: 'https://[bad' }, 'unparseable absolute stays external (no throw)');

console.log('links-classes test: ok (source-host-link error/warn + class off, planned gap, fragment, asset, mailto/tel, same-host absolute)');
