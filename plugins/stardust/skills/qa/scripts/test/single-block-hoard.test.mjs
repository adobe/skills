#!/usr/bin/env node
/**
 * Fixture test for the single-block-hoard detector (no network).
 * Run: node skills/qa/scripts/test/single-block-hoard.test.mjs
 *
 * The defect it exists for: a structured source page (hero + several sections)
 * migrated into hero + ONE `service-body` block that swallows everything —
 * `unblocked-page` misses it (there ARE blocks) and `flattened-collection`
 * misses it (the dump is inside a block, not default content). Must NOT fire on
 * genuine prose (article body), on a rich block that legitimately holds content
 * (cards), or when the source itself was flat.
 */
import { parseSections, detectSingleBlockHoard } from '../checks/content.mjs';

const P = (n, extra = '') => Array.from({ length: n }, () => '<p>A sentence of ordinary body copy that carries the page narrative forward.</p>').join('') + extra;
const HERO = '<div><div class="service-hero"><div><h1>Cancer Services</h1></div></div></div>';

// DEFECT: hero + one service-body hoarding everything, with latent headings/list inside
const HOARD = `${HERO}<div><div class="service-body"><div>`
  + '<h2>Overview</h2>' + P(6)
  + '<h2>Conditions We Treat</h2><ul><li>A</li><li>B</li><li>C</li></ul>'
  + '<h2>Treatment</h2>' + P(6)
  + '<h2>Schedule</h2>' + P(4)
  + '</div></div></div>';

// INTENTIONAL 1: genuine article — prose family, one article-body, few headings
const ARTICLE = `<div><div class="article-hero"><div><h1>A Patient Story</h1></div></div></div>`
  + `<div><div class="article-body"><div>${P(20)}</div></div></div>`;

// INTENTIONAL 2: a rich block (cards) legitimately holds most content — not a prose container
const CARDS = `${HERO}<div><div class="cards"><div>`
  + Array.from({ length: 8 }, (_, i) => `<div><h3>Card ${i}</h3><p>Some card copy here that is reasonably long.</p></div>`).join('')
  + '</div></div></div>';

// INTENTIONAL 3: source was itself flat (1 region) — single body is faithful
const FLAT_SOURCE_SCRAPE = { nodes: [{ type: 'heading', level: 1, text: 'Title' }, { type: 'p', text: 'x' }] };
// source was rich (4 heading regions) — collapse is a defect (error via source parity)
const RICH_SOURCE_SCRAPE = { nodes: [{ type: 'heading', level: 1 }, { type: 'heading', level: 2 }, { type: 'heading', level: 2 }, { type: 'heading', level: 2 }, { type: 'heading', level: 3 }] };

let failed = 0;
const expect = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!cond) failed += 1; };

// defect fires via latent structure (structured template, no source)
const d = detectSingleBlockHoard(parseSections(HOARD), { template: 'service' });
expect('hoard fires on collapsed service page', !!d && d.block === 'service-body', JSON.stringify(d));
expect('hoard reason is latent-structure, warn at 4 headings (no source)', d?.reason === 'latent-structure' && d?.severity === 'warn', JSON.stringify(d));

// intentional: prose-family article never fires
const a = detectSingleBlockHoard(parseSections(ARTICLE), { template: 'article-post' });
expect('article (prose family) does NOT fire', a === null, JSON.stringify(a));

// intentional: rich block (cards) is not a prose container
const c = detectSingleBlockHoard(parseSections(CARDS), { template: 'service' });
expect('rich cards block does NOT fire', c === null, JSON.stringify(c));

// source parity: rich source collapsed → error; flat source → skip
const rs = detectSingleBlockHoard(parseSections(HOARD), { template: 'service', scrape: RICH_SOURCE_SCRAPE });
expect('rich source → source-parity error', rs?.reason === 'source-parity' && rs?.severity === 'error', JSON.stringify(rs));
// a hoard whose block has NO latent structure, but source was flat → intentional
const FLAT_BODY = `${HERO}<div><div class="service-body"><div>${P(20)}</div></div></div>`;
const fs = detectSingleBlockHoard(parseSections(FLAT_BODY), { template: 'service', scrape: FLAT_SOURCE_SCRAPE });
expect('flat source + no latent structure → intentional (skip)', fs === null, JSON.stringify(fs));

// a plain flowing-prose body in a structured family, no source, no latent structure → left alone
const pf = detectSingleBlockHoard(parseSections(FLAT_BODY), { template: 'service' });
expect('flowing prose, no latent structure, no source → skip', pf === null, JSON.stringify(pf));

process.exit(failed ? 1 : 0);
