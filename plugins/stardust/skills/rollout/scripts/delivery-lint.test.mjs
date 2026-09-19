#!/usr/bin/env node
// Fixture test: rollout/scripts/delivery-lint.mjs — the pre-PUT mirror rules and the
// chrome-variant guard, both directions (fires on the shape it names, silent on a clean page).
//
//   empty-block P2      `<div class="x"></div>` inside <main>; --allow-empty x exempts it
//                       (advisory — the mirror of deploy lint D1-EMPTY 🟡, B7)
//   one-cta-per-p P1    only a links-only <p> with > 1 emphasized link; prose with inline
//                       links is silent (T30.4 a)
//   h1 / h1-deviation   0 h1 is P0; with --allow-no-h1 it is P2 h1-deviation and --json
//                       carries deviation: "no h1 (source has none)" (T30.4 b)
//   description-alt P2  description "Image: …" or equal to an <img alt> (T30.4 c)
//   href-scheme P1      `javascript:` or a bare `#` / `#!` href
//   href-whitespace P1  leading/trailing whitespace inside the href value
//   chrome-variant P1   --chrome-docs with > 1 distinct nav (or footer) document: a page
//                       without a `nav:` (or `footer:`) metadata row, the --file page and
//                       every page under --content; single-variant sites are silent
//   chrome-variant-count P2  > 3 distinct documents of one kind
//
// Usage: node plugins/stardust/skills/rollout/scripts/delivery-lint.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const LINT = join(import.meta.dirname, 'delivery-lint.mjs');
const T = mkdtempSync(join(tmpdir(), 'delivery-lint-test-'));
const w = (rel, body) => { const p = join(T, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); return p; };
const page = (main, meta = '') => `<body><header></header><main><div><h1>T</h1>${main}</div>${meta ? `<div><div class="metadata">${meta}</div></div>` : ''}</main><footer></footer></body>`;
const metaRow = (k, v) => `<div><div>${k}</div><div>${v}</div></div>`;
const run = (args) => { const r = spawnSync(process.execPath, [LINT, ...args, '--json'], { encoding: 'utf8', cwd: T }); let j = null; try { j = JSON.parse(r.stdout); } catch { /* usage error */ } return { status: r.status, stderr: r.stderr, json: j, rules: j ? j.findings.map((f) => `${f.sev} ${f.rule}`) : null }; };
const count = (r, rule) => r.rules.filter((x) => x.endsWith(` ${rule}`)).length;

// ---- mirror rules fire once per shape, exit 1; the clean page is silent -----------
{
  const fail = w('fail.html', page('<div class="cards"></div><p><a href="javascript:void(0)">go</a></p><p><a href="#">top</a></p><p><a href=" /about">about</a></p>'));
  let r = run(['--file', fail, '--path', '/fail']);
  assert.equal(r.status, 1, 'P1 findings → exit 1');
  assert.deepEqual([count(r, 'empty-block'), count(r, 'href-scheme'), count(r, 'href-whitespace')], [1, 2, 1], `one finding per shape: ${r.rules}`);
  assert.ok(r.rules.every((x) => /^P1 (href-scheme|href-whitespace)$|^P2 (empty-block|metadata)$/.test(x)), `empty-block is P2 (mirror of D1-EMPTY 🟡), no other rule fires: ${r.rules}`);
  r = run(['--file', fail, '--path', '/fail', '--allow-empty', 'cards']);
  assert.equal(count(r, 'empty-block'), 0, '--allow-empty exempts the declared placeholder');
  const onlyEmpty = w('only-empty.html', page('<div class="cards"></div>', metaRow('title', 'T')));
  r = run(['--file', onlyEmpty, '--path', '/only-empty']);
  assert.deepEqual([r.status, r.rules], [0, ['P2 empty-block']], `a 0-row block alone is advisory, exit 0: ${r.rules}`);
  const pass = w('pass.html', page('<div class="cards"><div><div>a</div></div></div><p><a href="/about">about</a></p><p><a href="#main">skip</a></p>', metaRow('title', 'T')));
  r = run(['--file', pass, '--path', '/pass']);
  assert.deepEqual([r.status, r.rules], [0, []], `clean page is silent: ${r.rules}`);
}

// ---- T30.4 (a): one-cta-per-p fires only on a links-only paragraph -----------------
{
  // running prose with inline links (a phone link + an emphasized request link) never buttonizes
  const prose = w('prose.html', page('<p>Call us at <a href="tel:+15551234">555-1234</a> or <strong><a href="/request">request an appointment</a></strong>.</p><p>Read the <strong>annual report</strong>: <a href="/a">part one</a> and <a href="/b">part two</a>.</p>', metaRow('title', 'T')));
  let r = run(['--file', prose, '--path', '/prose']);
  assert.deepEqual([r.status, count(r, 'one-cta-per-p')], [0, 0], `prose with inline links is silent: ${r.rules}`);
  // two emphasized links and nothing else (whitespace / &nbsp; between them) is the true positive
  const twoCta = w('two-cta.html', page('<p><strong><a href="/a">Apply</a></strong>&nbsp; <em><a href="/b">Learn more</a></em></p>', metaRow('title', 'T')));
  r = run(['--file', twoCta, '--path', '/two-cta']);
  assert.deepEqual([r.status, count(r, 'one-cta-per-p')], [1, 1], `two emphasized links alone in a <p> is one P1: ${r.rules}`);
  // two plain links with no emphasis stay silent (unchanged shape)
  const twoPlain = w('two-plain.html', page('<p><a href="/a">A</a> <a href="/b">B</a></p>', metaRow('title', 'T')));
  assert.equal(count(run(['--file', twoPlain, '--path', '/two-plain']), 'one-cta-per-p'), 0, 'two unemphasized links do not fire');
}

// ---- T30.4 (b): --allow-no-h1 → P2 h1-deviation + deviation in --json ---------------
{
  const noH1 = w('no-h1.html', `<body><header></header><main><div><h2>Subscribe</h2><p>x</p></div><div><div class="metadata">${metaRow('title', 'T')}</div></div></main><footer></footer></body>`);
  let r = run(['--file', noH1, '--path', '/no-h1']);
  assert.deepEqual([r.status, count(r, 'h1'), r.json.deviation], [1, 1, null], `default: 0 h1 stays P0 and no deviation: ${r.rules}`);
  assert.ok(r.rules.includes('P0 h1'), 'P0 h1 by default');
  r = run(['--file', noH1, '--path', '/no-h1', '--allow-no-h1']);
  assert.deepEqual([r.status, count(r, 'h1'), count(r, 'h1-deviation'), r.json.deviation, r.json.gate], [0, 0, 1, 'no h1 (source has none)', 'PASS'], `--allow-no-h1: P2 h1-deviation, deviation recorded, exit 0: ${r.rules}`);
  assert.ok(r.rules.includes('P2 h1-deviation'), 'h1-deviation is P2');
  // the flag never downgrades > 1 h1 (P1) and is a no-op on a page with one h1
  const twoH1 = w('two-h1.html', page('<h1>Again</h1>', metaRow('title', 'T')));
  r = run(['--file', twoH1, '--path', '/two-h1', '--allow-no-h1']);
  assert.deepEqual([r.status, r.rules, r.json.deviation], [1, ['P1 h1'], null], `> 1 h1 stays P1 under --allow-no-h1: ${r.rules}`);
  const oneH1 = w('one-h1.html', page('<p>x</p>', metaRow('title', 'T')));
  r = run(['--file', oneH1, '--path', '/one-h1', '--allow-no-h1']);
  assert.deepEqual([r.status, r.rules, r.json.deviation], [0, [], null], 'one h1 + --allow-no-h1: clean, no deviation');
}

// ---- T30.4 (c): description-alt P2 ----------------------------------------------------
{
  const img = '<p><img src="https://content.da.live/o/r/media/x.jpg" alt="Clinic entrance at dusk"></p>';
  let r = run(['--file', w('d1.html', page(img, metaRow('title', 'T') + metaRow('description', 'Image: Clinic entrance at dusk'))), '--path', '/d1']);
  assert.deepEqual([r.status, r.rules], [0, ['P2 description-alt']], `"Image: …" description is one P2: ${r.rules}`);
  r = run(['--file', w('d2.html', page(img, metaRow('title', 'T') + metaRow('description', '<p>clinic entrance at DUSK</p>'))), '--path', '/d2']);
  assert.deepEqual([r.status, r.rules], [0, ['P2 description-alt']], `description equal to an <img alt> (case-insensitive, <p>-wrapped) is one P2: ${r.rules}`);
  r = run(['--file', w('d3.html', page(img, metaRow('title', 'T') + metaRow('description', 'Opening hours, directions and parking for the downtown clinic.'))), '--path', '/d3']);
  assert.deepEqual([r.status, r.rules], [0, []], `a real description is silent: ${r.rules}`);
  r = run(['--file', w('d4.html', page(img, metaRow('title', 'T') + metaRow('description', 'Imagery of the campus'))), '--path', '/d4']);
  assert.equal(count(r, 'description-alt'), 0, '"Imagery…" does not match the word Image');
}

// ---- chrome variants -------------------------------------------------------------
{
  const chrome = (name, body) => w(`content/${name}.html`, `<body><header></header><main><div><ul><li><a href="/">${body}</a></li></ul></div></main><footer></footer></body>`);
  const nav = chrome('nav', 'Home'); const footer = chrome('footer', 'Legal');
  const noRow = w('content/a.html', page('<p>x</p>', metaRow('title', 'A')));
  const withRow = w('content/b/index.html', page('<p>y</p>', metaRow('title', 'B') + metaRow('nav', '/nav-minimal')));
  w('content/fragments/promo.html', page('<p>fragment</p>'));

  // single variant per kind: silent
  let r = run(['--file', noRow, '--path', '/a', '--chrome-docs', `${nav},${footer}`]);
  assert.deepEqual([r.status, count(r, 'chrome-variant')], [0, 0], 'single-variant site: no chrome-variant finding');

  // two nav variants: the --file page without a nav: row is P1; the page naming its nav is clean; footer (single) never asked for
  const navMin = chrome('nav-minimal', 'Minimal');
  r = run(['--file', noRow, '--path', '/a', '--chrome-docs', `${nav},${navMin},${footer}`]);
  assert.deepEqual([r.status, count(r, 'chrome-variant')], [1, 1], `multi-variant nav: missing nav: row is one P1 (${r.rules})`);
  r = run(['--file', withRow, '--path', '/b', '--chrome-docs', `${nav},${navMin},${footer}`]);
  assert.equal(count(r, 'chrome-variant'), 0, 'a page naming its nav: document is clean');
  // --content walks the tree: a + b, chrome docs and fragments excluded → one finding (a)
  r = run(['--file', withRow, '--path', '/b', '--chrome-docs', `${nav},${navMin},${footer}`, '--content', join(T, 'content')]);
  assert.equal(count(r, 'chrome-variant'), 1, `--content: one finding for the page without a row (${r.rules})`);
  // an identical copy is not a new variant (content hash); four distinct ones are a P2 count smell
  chrome('nav-copy', 'Home');
  r = run(['--file', withRow, '--path', '/b', '--chrome-docs', `${nav},${navMin},${join(T, 'content/nav-copy.html')},${footer}`]);
  assert.equal(count(r, 'chrome-variant-count'), 0, 'byte-identical chrome docs dedupe to one variant');
  const more = ['nav-c', 'nav-d'].map((n) => chrome(n, n));
  r = run(['--file', withRow, '--path', '/b', '--chrome-docs', [nav, navMin, ...more, footer].join(',')]);
  assert.deepEqual([r.status, count(r, 'chrome-variant-count')], [0, 1], `> 3 nav variants is one P2 (advisory, exit 0): ${r.rules}`);
  // usage: a missing chrome doc is exit 2
  assert.equal(run(['--file', noRow, '--chrome-docs', join(T, 'content/nope.html')]).status, 2, 'missing --chrome-docs file → exit 2');
}

rmSync(T, { recursive: true, force: true });
console.log('delivery-lint.test: ok (empty-block P2/--allow-empty, href-scheme, href-whitespace, one-cta-per-p links-only, --allow-no-h1/h1-deviation/deviation, description-alt, chrome-variant/--content, chrome-variant-count, single-variant silence)');
