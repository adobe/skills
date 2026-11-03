#!/usr/bin/env node
// skills/rollout/scripts/test/delivery-lint.test.mjs — internal link hygiene judged by the target: a trailing slash on a leaf is P1 (404), on a folder index it is right, a folder index without it is P1 (404), an unknown target is a P2 advisory, .html stays P1 — except the widget mount /widgets/<path>/<name>.html?<params>, which must exist under widgets/ (P1 unknown-widget) and carry a block-safe stem (P1 widget-name).
// Run: node plugins/stardust/skills/rollout/scripts/test/delivery-lint.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const root = mkdtempSync(join(tmpdir(), 'delivery-lint-'));
const content = join(root, 'content'); mkdirSync(join(content, 'en', 'news'), { recursive: true });
writeFileSync(join(content, 'en', 'news', 'index.html'), '<main></main>');
writeFileSync(join(content, 'en', 'news', 'story.html'), '<main></main>');
mkdirSync(join(root, 'widgets', 'search'), { recursive: true }); writeFileSync(join(root, 'widgets', 'search', 'site-search.html'), '<div></div>');
const links = ['/en/news/', '/en/news', '/en/news/story/', '/en/news/story', '/en/other/', '/en/news/story.html', '/widgets/search/site-search.html?q=docs', '/widgets/search/finder.html', '/widgets/search/widget.html', '/widgets/search/results-wrapper.html'];
const page = join(content, 'page.html');
writeFileSync(page, `<main><div><p>${links.map((h) => `<a href="${h}">x</a>`).join(' ')}</p></div><div class="metadata"></div></main>`);
const lint = (...extra) => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json', ...extra], { cwd: root, encoding: 'utf8' }); return JSON.parse(r.stdout).findings.filter((f) => /slash|html-extension|widget/.test(f.rule)); };
const by = (fs) => Object.fromEntries(fs.map((f) => [f.msg.match(/: (\/\S*)/)[1], `${f.sev} ${f.rule}`]));

check('with the content tree: each link judged by its target', () => {
  assert.deepEqual(by(lint()), {
    '/en/news': 'P1 folder-index-slash',
    '/en/news/story/': 'P1 trailing-slash',
    '/en/other/': 'P2 trailing-slash',
    '/en/news/story.html': 'P1 html-extension',
    '/widgets/search/finder.html': 'P1 unknown-widget',
    '/widgets/search/widget.html': 'P1 widget-name',
    '/widgets/search/results-wrapper.html': 'P1 widget-name',
  }, 'the one sanctioned .html link is the widget mount; it is judged by its code file and stem, never by html-extension');
});
check('without a content tree: a trailing slash is only an advisory (it may be a folder index)', () => {
  const fs = by(lint('--content', join(root, 'missing')));
  assert.equal(fs['/en/news/'], 'P2 trailing-slash'); assert.equal(fs['/en/news/story/'], 'P2 trailing-slash'); assert.equal(fs['/en/news'], undefined);
  assert.equal(fs['/widgets/search/finder.html'], 'P1 unknown-widget', 'the code tree is the content tree\'s parent, missing content dir or not'); assert.equal(fs['/widgets/search/widget.html'], 'P1 widget-name');
});
check('no widgets/ in the code tree: the existence check is skipped, the stem rule still applies', () => {
  const other = mkdtempSync(join(tmpdir(), 'delivery-lint-nocode-')); mkdirSync(join(other, 'content'));
  const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json', '--content', join(other, 'content')], { cwd: other, encoding: 'utf8' });
  const fs = by(JSON.parse(r.stdout).findings.filter((f) => /widget/.test(f.rule)));
  assert.deepEqual(fs, { '/widgets/search/widget.html': 'P1 widget-name', '/widgets/search/results-wrapper.html': 'P1 widget-name' });
  rmSync(other, { recursive: true });
});
check('--help prints usage before any I/O', () => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--help'], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.match(r.stdout, /delivery-lint/); });
rmSync(root, { recursive: true });
process.exit(failed ? 1 : 0);
