#!/usr/bin/env node
// skills/qa/scripts/test/from-knowledge.test.mjs — qa inputs from spec knowledge: the template map by layout variant at served URLs (delivered pages only when coverage exists), source-inherited 404 allowlist entries without duplicates; the CLI writes both and keeps existing entries.
// Run: node plugins/stardust/skills/qa/scripts/test/from-knowledge.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inheritedEntries, templateMap } from '../from-knowledge.mjs';
import { buildInventory, plainUrl } from '../lib.mjs';
import { deliveredUrl } from '../../../deploy/scripts/eds-path.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const O = 'https://example.com';
const urls = [
  { url: `${O}/en/news`, outcome: 'page', in_sitemap: 1, eds_path: '/en/news/', variant_code: 'news#1' },
  { url: `${O}/en/news/a`, outcome: 'page', in_sitemap: 1, eds_path: '/en/news/a', variant_code: 'news#1' },
  { url: `${O}/en/about`, outcome: 'page', in_sitemap: 1, eds_path: '/en/about', template: 'page' },
  { url: `${O}/en/old`, outcome: 'redirect', in_sitemap: 1, eds_path: null },
];
const broken = [
  { url: `${O}/en/Gone_Page.html`, status: 404, source: 'link', kind: 'page', in_scope: 1 },
  { url: `${O}/en/file.pdf`, status: 404, source: 'link', kind: 'asset', in_scope: 1 },
  { url: `${O}/fr/gone`, status: 404, source: 'link', kind: 'page', in_scope: 0 },
];
await check('templateMap: live sitemap pages by variant (else template) at their served URL; a filter keeps delivered ones', () => {
  assert.deepEqual(templateMap(urls), { templates: { 'news#1': { urls: ['/en/news/', '/en/news/a'] }, page: { urls: ['/en/about'] } } });
  assert.deepEqual(templateMap(urls, (u) => u.eds_path !== '/en/news/a'), { templates: { 'news#1': { urls: ['/en/news/'] }, page: { urls: ['/en/about'] } } });
});
await check('inheritedEntries: in-scope broken page links, as authored and as served; assets, other scopes and listed paths skipped', () => {
  const e = inheritedEntries(broken, [{ check: 'links', path: '/en/gone-page', reason: 'already known here' }], { deliveredUrl }, '2026-10-08T10:00:00');
  assert.deepEqual(e.map((x) => [x.check, x.id, x.path]), [['links', 'broken-internal-link', '/en/Gone_Page.html']]);
  assert.match(e[0].reason, /^source-inherited: .* answered 404 on the source site \(spec knowledge, built 2026-10-08T10:00:00\)/);
});
await check('CLI: writes the template map, appends allowlist entries once, honours coverage', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-from-knowledge-'));
  const k = join(cwd, 'stardust', 'spec', 'knowledge'); mkdirSync(k, { recursive: true });
  writeFileSync(join(k, 'urls.jsonl'), urls.map((u) => JSON.stringify(u)).join('\n'));
  writeFileSync(join(k, 'broken.jsonl'), broken.map((u) => JSON.stringify(u)).join('\n'));
  mkdirSync(join(cwd, 'stardust', 'rollout', 'coverage'), { recursive: true });
  writeFileSync(join(cwd, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages: [{ slug: 'en-news', path: '/en/news' }, { slug: 'renamed', path: '/en/who-we-are', source: { sourceUrl: `${O}/en/about` } }] }));
  const run = () => spawnSync(process.execPath, [join(HERE, '..', 'from-knowledge.mjs')], { cwd, encoding: 'utf8' });
  const r1 = run(); assert.equal(r1.status, 0, r1.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'stardust', 'template-map.json'), 'utf8')), { templates: { 'news#1': { urls: ['/en/news/'] }, page: { urls: ['/en/about'] } } }); // /en/about by its source URL
  const n = JSON.parse(readFileSync(join(cwd, 'stardust', 'qa', 'allowlist.json'), 'utf8')).entries.length; assert.equal(n, 2);
  const r2 = run(); assert.match(r2.stdout, /0 source-inherited/);
  assert.equal(JSON.parse(readFileSync(join(cwd, 'stardust', 'qa', 'allowlist.json'), 'utf8')).entries.length, n);
  rmSync(cwd, { recursive: true });
});
await check('qa keeps a folder index\'s served URL (/x/) next to its key, and fetches its plain document there', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-inv-')); const f = join(cwd, 'map.json');
  writeFileSync(f, JSON.stringify(templateMap(urls)));
  const inv = await buildInventory({ base: null, templateMap: f, mergeSitemap: false });
  const news = inv.pages.find((x) => x.path === '/en/news');
  assert.equal(news.url, '/en/news/'); assert.equal(inv.pages.find((x) => x.path === '/en/about').url, '/en/about');
  assert.equal(plainUrl('https://h', '/en/news/'), 'https://h/en/news/index.plain.html'); assert.equal(plainUrl('https://h', '/en/about'), 'https://h/en/about.plain.html'); assert.equal(plainUrl('https://h', '/'), 'https://h/index.plain.html');
  rmSync(cwd, { recursive: true });
});
await check('--help prints usage; a missing knowledge folder exits 1', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-fk-help-'));
  const h = spawnSync(process.execPath, [join(HERE, '..', 'from-knowledge.mjs'), '--help'], { cwd, encoding: 'utf8' }); assert.equal(h.status, 0); assert.match(h.stdout, /from-knowledge\.mjs/);
  assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'from-knowledge.mjs')], { cwd, encoding: 'utf8' }).status, 1);
  rmSync(cwd, { recursive: true });
});
process.exit(failed ? 1 : 0);
