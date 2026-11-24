// Tests for index-report.mjs. Run: node --test index-report.test.mjs
// The script runs as a child process with fetch replaced by a stub that serves a scenario and
// records every URL that was requested.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'index-report.mjs');
const HOST = 'https://main--site--org.aem.live';

const stub = `
import { appendFileSync, readFileSync } from 'node:fs';
const scenario = JSON.parse(readFileSync(process.env.SCENARIO, 'utf8'));
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  appendFileSync(process.env.REQUESTS, (init.method ?? 'GET') + ' ' + url.href + '\\n');
  if (url.pathname === '/query-index.json') {
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    const data = scenario.entries.slice(offset, offset + limit);
    const body = JSON.stringify({ total: scenario.entries.length, offset, limit: data.length, data, columns: scenario.columns, ':type': 'sheet' });
    return { ok: true, status: 200, text: async () => body };
  }
  const page = scenario.pages[url.pathname];
  if (page === undefined) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  if (typeof page === 'number') return { ok: page === 200, status: page, headers: new Headers(), text: async () => '' };
  return { ok: true, status: 200, headers: new Headers(), text: async () => page };
};
`;

const run = (scenario, ...args) => {
  const dir = mkdtempSync(join(tmpdir(), 'index-report-'));
  const files = { stub: join(dir, 'stub.mjs'), scenario: join(dir, 'scenario.json'), requests: join(dir, 'requests.txt') };
  writeFileSync(files.stub, stub);
  writeFileSync(files.scenario, JSON.stringify({ columns: ['path'], pages: {}, ...scenario }));
  writeFileSync(files.requests, '');
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(files.stub).href, script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SCENARIO: files.scenario, REQUESTS: files.requests },
  });
  const requests = readFileSync(files.requests, 'utf8').split('\n').filter(Boolean);
  return { ...result, requests, report: result.status === 0 ? JSON.parse(result.stdout) : null };
};
const hosts = (requests) => [...new Set(requests.map((line) => new URL(line.split(' ')[1]).host))];

test('reads an index of more than 1000 entries completely', () => {
  const entries = Array.from({ length: 1501 }, (_, i) => ({ path: `/page-${i}` }));
  const { report } = run({ entries }, `${HOST}/query-index.json`, '--check=0');
  assert.equal(report.total, 1501);
  assert.equal(report.fetched, 1501);
  assert.equal(report.requests, 2);
});

test('reports fill rates, and a value that is the same on every page', () => {
  const entries = [
    { path: '/a', title: 'A', robots: '', template: 'x', tags: [] },
    { path: '/b', title: 'B', robots: 'noindex', template: 'x', tags: ['t'] },
  ];
  const { report } = run({ entries, columns: ['path', 'title', 'robots', 'template', 'tags'] }, `${HOST}/query-index.json`, '--check=0');
  const property = (name) => report.properties.find((entry) => entry.name === name);
  assert.equal(property('title').fillRate, 1);
  assert.equal(property('robots').fillRate, 0.5);
  assert.equal(property('robots').sameEverywhere, undefined);
  assert.equal(property('template').sameEverywhere, 'x');
  assert.equal(property('tags').filled, 1);
});

test('an indexed path that names another host is not requested', () => {
  const entries = [{ path: '//outside.test/probe' }, { path: 'https://outside.test/absolute' }, { path: '/\\\\outside.test/x' }, { path: '/ok' }];
  const { report, requests } = run({ entries, pages: { '/ok': 200 } }, `${HOST}/query-index.json`, '--check=10');
  assert.deepEqual(hosts(requests), ['main--site--org.aem.live']);
  assert.equal(report.status.checked, 4);
  assert.deepEqual(report.status.notOk.map((entry) => entry.path), ['//outside.test/probe', 'https://outside.test/absolute', '/\\\\outside.test/x']);
  assert.ok(report.status.notOk.every((entry) => entry.error === 'not a path on the host of the index'));
});

test('a sitemap index is followed on the host of --sitemap only', () => {
  const sitemapIndex = `<sitemapindex>
    <sitemap><loc>https://www.production.test/sitemap-en.xml</loc></sitemap>
    <sitemap><loc>https://www.production.test//outside.test/child.xml</loc></sitemap>
    <sitemap><loc>nonsense</loc></sitemap>
  </sitemapindex>`;
  const child = '<urlset><url><loc>https://www.production.test/a</loc></url><url><loc>https://www.production.test/missing</loc></url></urlset>';
  const { report, requests } = run(
    { entries: [{ path: '/a' }, { path: '/b' }], pages: { '/sitemap-index.xml': sitemapIndex, '/sitemap-en.xml': child } },
    `${HOST}/query-index.json`,
    `--sitemap=${HOST}/sitemap-index.xml`,
    '--check=0',
  );
  assert.deepEqual(hosts(requests), ['main--site--org.aem.live']);
  assert.equal(report.sitemap.skipped.length, 2);
  assert.deepEqual(report.sitemap.notInIndex, ['/missing']);
  assert.deepEqual(report.sitemap.notInSitemap, ['/b']);
});

test('noindex pages and an .html extension of the sitemap are not differences', () => {
  const entries = [{ path: '/a', robots: '' }, { path: '/hidden', robots: 'noindex, nofollow' }];
  const sitemap = '<urlset><url><loc>https://www.production.test/a.html</loc></url></urlset>';
  const { report } = run(
    { entries, columns: ['path', 'robots'], pages: { '/sitemap.xml': sitemap } },
    `${HOST}/query-index.json`,
    `--sitemap=${HOST}/sitemap.xml`,
    '--check=0',
  );
  assert.equal(report.sitemap.extension, '.html');
  assert.equal(report.sitemap.notInIndexCount, 0);
  assert.equal(report.sitemap.notInSitemapWithNoindex, 1);
  assert.deepEqual(report.sitemap.notInSitemap, []);
});

test('lists indexed paths that redirect or are gone, oldest first', () => {
  const entries = [
    { path: '/new', lastModified: 300 },
    { path: '/moved', lastModified: 100 },
    { path: '/gone', lastModified: 200 },
  ];
  const { report } = run({ entries, columns: ['path', 'lastModified'], pages: { '/new': 200, '/moved': 301 } }, `${HOST}/query-index.json`, '--check=2');
  assert.equal(report.status.checked, 2);
  assert.deepEqual(report.status.notOk.map((entry) => [entry.path, entry.status]), [['/moved', 301], ['/gone', 404]]);
});

test('a failed request ends with a message, and a bad argument with the usage', () => {
  const missing = run({ entries: [] }, `${HOST}/other-index.json`);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /answered 404/);
  assert.doesNotMatch(missing.stderr, /at /);
  const insecure = run({ entries: [] }, 'http://main--site--org.aem.live/query-index.json');
  assert.equal(insecure.status, 2);
  assert.match(insecure.stderr, /usage:/);
});
