#!/usr/bin/env node
// skills/rollout/scripts/test/delivery-lint.test.mjs — internal link hygiene judged by the target: a trailing slash on a leaf is P1 (404), on a folder index it is right, a folder index without it is P1 (404), an unknown target is a P2 advisory, .html stays P1. Whitespace-only spacers are a P2 per tag kind.
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
const links = ['/en/news/', '/en/news', '/en/news/story/', '/en/news/story', '/en/other/', '/en/news/story.html'];
const page = join(content, 'page.html');
writeFileSync(page, `<main><div><p>${links.map((h) => `<a href="${h}">x</a>`).join(' ')}</p></div><div class="metadata"></div></main>`);
const lint = (...extra) => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', page, '--json', ...extra], { cwd: root, encoding: 'utf8' }); return JSON.parse(r.stdout).findings.filter((f) => /slash|html-extension/.test(f.rule)); };
const by = (fs) => Object.fromEntries(fs.map((f) => [f.msg.match(/: (\/\S*)/)[1], `${f.sev} ${f.rule}`]));

check('with the content tree: each link judged by its target', () => {
  assert.deepEqual(by(lint()), {
    '/en/news': 'P1 folder-index-slash',
    '/en/news/story/': 'P1 trailing-slash',
    '/en/other/': 'P2 trailing-slash',
    '/en/news/story.html': 'P1 html-extension',
  });
});
check('without a content tree: a trailing slash is only an advisory (it may be a folder index)', () => {
  const fs = by(lint('--content', join(root, 'missing')));
  assert.equal(fs['/en/news/'], 'P2 trailing-slash'); assert.equal(fs['/en/news/story/'], 'P2 trailing-slash'); assert.equal(fs['/en/news'], undefined);
});
check('--help prints usage before any I/O', () => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--help'], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.match(r.stdout, /delivery-lint/); });

// --- spacer-whitespace (P2, #112): whitespace-only <p>/<h1>–<h6> and <br>-only <div>, one finding per tag kind ---
const doc = (main) => `<html><body><header></header><main>${main}<div class="metadata"></div></main><footer></footer></body></html>`;
const lintFile = (file, ...extra) => { const r = spawnSync(process.execPath, [join(HERE, '..', 'delivery-lint.mjs'), '--file', file, '--json', ...extra], { cwd: root, encoding: 'utf8' }); return { status: r.status, ...JSON.parse(r.stdout) }; };
const spacerPage = join(root, 'spacers.html');
writeFileSync(spacerPage, doc(['<h1>Title</h1>', '<p>&nbsp;</p>', '<h2>  </h2>', '<p><br></p>', '<p>&#160;<br/></p>', '<P>\u00a0</P>', '<div><br><br></div>',
  '<p>Line one<br></p>', '<p>Text&nbsp;<br></p>', '<h3>Heading <br></h3>', '<div><div></div></div>', '<div>Cell<br></div>'].join('')));
check('spacer-whitespace: one P2 per tag kind with its count; text with a trailing <br> and empty divs are not flagged; exit stays 0', () => {
  const r = lintFile(spacerPage);
  const spacers = r.findings.filter((f) => f.rule === 'spacer-whitespace');
  assert.deepEqual(spacers.map((f) => `${f.sev} ${f.msg.split(' — ')[0]}`), ['P2 4 whitespace-only <p>', 'P2 1 whitespace-only <h2>', 'P2 1 whitespace-only <div>']);
  assert.match(spacers[0].msg, /dropped by the content pipeline: model the height as spacing CSS \(deploy SKILL\.md § The ENCODE contract, #112\)$/);
  assert.equal(r.status, 0); assert.equal(r.gate, 'PASS');
});
rmSync(root, { recursive: true });
process.exit(failed ? 1 : 0);
