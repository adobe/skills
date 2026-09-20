#!/usr/bin/env node
/**
 * Fixture test: deploy/scripts/localize-links.mjs — the URL map and the rewrite rules.
 * Run: node skills/deploy/scripts/test/localize-links.test.mjs   (exit 1 on failure)
 *
 *   - canonicalPath folds through stardust/scripts/da-path.mjs (T27.3): `/Über_uns.html` → `/uber-uns`,
 *     `/x/index.html` → `/x`, root stays `/`; a tree with unsafe FILE names still maps hrefs to the
 *     path DA serves (the same fold deploy-batch applies before the PUT), so the rewrite target is the
 *     delivered path, never the on-disk one;
 *   - source-host / delivery-host / root-relative hrefs resolve; query + fragment survive; mailto/tel/
 *     anchors/assets untouched; a source-host href with no local page is kept absolute and reported;
 *   - `--check` exits 2 while a link would change, 0 after the write pass; the write pass is idempotent.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPath, localizeHref } from '../localize-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'localize-links.mjs');

// pure: canonicalPath = query/ext/slash/index fold, then the delivery-safe fold
assert.equal(canonicalPath('/Über_uns.html'), '/uber-uns');
assert.equal(canonicalPath('/x/index.html'), '/x');
assert.equal(canonicalPath('/'), '/');
assert.equal(canonicalPath('index.html'), '/');
assert.equal(canonicalPath('/a/b/'), '/a/b');
assert.equal(canonicalPath('/A.HTML?q=1#f'), '/a');
assert.equal(canonicalPath('/日本語'), '/日本語', 'no safe form → lower-cased shape kept, never a guess');
{
  const map = new Map([['/uber-uns', '/uber-uns'], ['/old', '/new']]);
  const hosts = ['src.example'];
  assert.deepEqual(localizeHref('https://www.src.example/Über_uns.html?x=1#top', { map, hosts }), { href: '/uber-uns?x=1#top', action: 'localized', key: '/uber-uns' });
  assert.deepEqual(localizeHref('/Über_uns/', { map, hosts }), { href: '/uber-uns', action: 'normalized', key: '/uber-uns' });
  assert.equal(localizeHref('/old', { map, hosts }).href, '/new', 'a redirect pair rewrites to its destination');
  assert.equal(localizeHref('https://src.example/nowhere', { map, hosts }).action, 'kept-absolute');
  assert.equal(localizeHref('mailto:a@b.c', { map, hosts }).action, 'skip');
  assert.equal(localizeHref('/uber-uns', { map, hosts }).action, 'already');
}

const dir = mkdtempSync(join(tmpdir(), 'localize-links-'));
const content = join(dir, 'content');
mkdirSync(join(content, 'en'), { recursive: true });
const w = (rel, body) => writeFileSync(join(content, rel), body);
const doc = (links) => `<body><header></header><main><div><h1>T</h1>${links.map((h) => `<p><a href="${h}">l</a></p>`).join('')}</div></main><footer></footer></body>\n`;
w('en/Über_uns.html', doc(['https://www.src.example/en/Über_uns.html', '/en/b/', '/en/index.html', 'https://src.example/en/gone', 'mailto:x@y.z', '/img/x.png']));
w('en/b.html', doc(['/en/%C3%9Cber_uns?x=1#f']));
w('en/index.html', doc(['/en/b.html']));
const run = (args) => spawnSync(process.execPath, [CLI, '--source-host', 'www.src.example', '--content', content, ...args], { encoding: 'utf8', cwd: dir });

try {
  let r = run(['--check']);
  assert.equal(r.status, 2, `links still localizable → exit 2: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /CHECK FAIL — 5 link\(s\) still localizable/);
  r = run([]);
  assert.equal(r.status, 0, r.stderr);
  const a = readFileSync(join(content, 'en/Über_uns.html'), 'utf8');
  assert.match(a, /href="\/en\/uber-uns"/, 'source-host href → the delivered (safe) path, not the on-disk name');
  assert.match(a, /href="\/en\/b"/, 'trailing slash normalized');
  assert.match(a, /href="\/en"/, '/en/index.html → /en');
  assert.match(a, /href="https:\/\/src\.example\/en\/gone"/, 'no local page → kept absolute (honest boundary)');
  assert.match(a, /href="mailto:x@y\.z"/); assert.match(a, /href="\/img\/x\.png"/, 'assets untouched');
  assert.match(r.stdout, /\/en\/gone/, 'kept-absolute target reported');
  assert.match(readFileSync(join(content, 'en/b.html'), 'utf8'), /href="\/en\/uber-uns\?x=1#f"/, 'percent-encoded root-relative href → safe path, query + fragment kept');
  r = run(['--check']);
  assert.equal(r.status, 0, `after the write pass --check is clean: ${r.stdout}`);
  assert.match(r.stdout, /CHECK PASS — 0 link\(s\) still localizable/);
  const before = readFileSync(join(content, 'en/Über_uns.html'), 'utf8');
  run([]);
  assert.equal(readFileSync(join(content, 'en/Über_uns.html'), 'utf8'), before, 'idempotent');
  console.log('localize-links test: ok (canonicalPath via da-path.mjs, safe-path targets, kept-absolute, --check 2→0, idempotent)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
