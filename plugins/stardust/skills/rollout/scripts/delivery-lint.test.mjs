#!/usr/bin/env node
// Fixture test: rollout/scripts/delivery-lint.mjs — the pre-PUT mirror rules and the
// chrome-variant guard, both directions (fires on the shape it names, silent on a clean page).
//
//   empty-block P1      `<div class="x"></div>` inside <main>; --allow-empty x exempts it
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
const run = (args) => { const r = spawnSync(process.execPath, [LINT, ...args, '--json'], { encoding: 'utf8', cwd: T }); let j = null; try { j = JSON.parse(r.stdout); } catch { /* usage error */ } return { status: r.status, stderr: r.stderr, rules: j ? j.findings.map((f) => `${f.sev} ${f.rule}`) : null }; };
const count = (r, rule) => r.rules.filter((x) => x.endsWith(` ${rule}`)).length;

// ---- mirror rules fire once per shape, exit 1; the clean page is silent -----------
{
  const fail = w('fail.html', page('<div class="cards"></div><p><a href="javascript:void(0)">go</a></p><p><a href="#">top</a></p><p><a href=" /about">about</a></p>'));
  let r = run(['--file', fail, '--path', '/fail']);
  assert.equal(r.status, 1, 'P1 findings → exit 1');
  assert.deepEqual([count(r, 'empty-block'), count(r, 'href-scheme'), count(r, 'href-whitespace')], [1, 2, 1], `one finding per shape: ${r.rules}`);
  assert.ok(r.rules.every((x) => /^P1 (empty-block|href-scheme|href-whitespace)$|^P2 metadata$/.test(x)), `no other rule fires: ${r.rules}`);
  r = run(['--file', fail, '--path', '/fail', '--allow-empty', 'cards']);
  assert.equal(count(r, 'empty-block'), 0, '--allow-empty exempts the declared placeholder');
  const pass = w('pass.html', page('<div class="cards"><div><div>a</div></div></div><p><a href="/about">about</a></p><p><a href="#main">skip</a></p>', metaRow('title', 'T')));
  r = run(['--file', pass, '--path', '/pass']);
  assert.deepEqual([r.status, r.rules], [0, []], `clean page is silent: ${r.rules}`);
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
console.log('delivery-lint.test: ok (empty-block/--allow-empty, href-scheme, href-whitespace, chrome-variant/--content, chrome-variant-count, single-variant silence)');
