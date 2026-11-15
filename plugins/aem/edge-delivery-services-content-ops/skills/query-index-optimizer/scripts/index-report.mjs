#!/usr/bin/env node
// Reads a whole query index of an AEM Edge Delivery Services site, page by page, and prints a
// JSON report: size, fill rate of every property, paths the sitemap has and the index lacks,
// and indexed paths that don't answer with 200.
//
//   node index-report.mjs <index-url> [--sitemap=<url>] [--check=25]
//
// <index-url> is for example https://main--site--org.aem.live/query-index.json
// --sitemap  compare with this sitemap (a sitemap index is followed on the same host)
// --check    request this many indexed paths, oldest first, and list those that are not 200.
//            0 skips the check. Default 25.
// Only sends GET and HEAD requests, to the host of <index-url> and of --sitemap. Paths that the
// index or a sitemap names are data: they are requested on those hosts and nowhere else.
// No dependencies.

const PAGE = 1000;
const LISTED = 50;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const fail = (message) => {
  console.error(`${message}\nusage: node index-report.mjs <index-url> [--sitemap=<url>] [--check=25]`);
  process.exit(2);
};
const parse = (value, what) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('not https');
    return url;
  } catch {
    return fail(`${what} must be an https URL.`);
  }
};
const [first] = args.filter((arg) => !arg.startsWith('--'));
if (!first) fail('Name the URL of the index.');
const indexUrl = parse(first, 'The index URL');
const sitemapUrl = option('sitemap') ? parse(option('sitemap'), '--sitemap') : null;
const check = Number(option('check', '25'));
if (!Number.isInteger(check) || check < 0) fail('--check takes a number, 0 or more.');

// A request that fails ends the run with its message, not with a stack trace.
process.on('uncaughtException', (error) => {
  console.error(error.message);
  process.exit(1);
});

// The URL of a path on the host of base, or null when the value is not a path: an absolute URL,
// or a reference like //other.host/x that a URL parser would resolve to another host.
const onHost = (base, path) => {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  const url = new URL(base.origin);
  url.pathname = path;
  return url.origin === base.origin ? url : null;
};
const pathOf = (value) => {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
};

const get = async (url) => {
  const response = await fetch(url, { redirect: 'manual' });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
};

// 1. The whole index. The default limit is 1000 entries, so one request is not the index.
const entries = [];
let total;
let columns = [];
let bytes = 0;
let requests = 0;
do {
  const url = new URL(indexUrl);
  url.searchParams.set('offset', String(entries.length));
  url.searchParams.set('limit', String(PAGE));
  const text = await (await get(url)).text();
  const sheet = JSON.parse(text);
  if (!Array.isArray(sheet.data)) {
    fail(sheet[':type'] === 'multi-sheet'
      ? `This is a workbook with the sheets ${sheet[':names'].join(', ')}. Add ?sheet=<name> to the URL.`
      : 'This is not a query index: it has no data array.');
  }
  bytes += Buffer.byteLength(text);
  requests += 1;
  total = sheet.total;
  columns = sheet.columns ?? columns;
  entries.push(...sheet.data);
  if (sheet.data.length === 0) break;
} while (entries.length < total);

const filled = (value) => !(value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0));
const properties = columns.map((name) => {
  const values = entries.map((entry) => entry[name]).filter(filled);
  const distinct = new Set(values.map((value) => JSON.stringify(value))).size;
  return {
    name,
    filled: values.length,
    fillRate: entries.length ? Math.round((values.length / entries.length) * 100) / 100 : 0,
    distinct,
    ...(distinct === 1 && values.length === entries.length && entries.length > 1 ? { sameEverywhere: values[0] } : {}),
  };
});
const paths = entries.map((entry) => entry.path);
const pathSet = new Set(paths);
const report = {
  index: indexUrl.href,
  total,
  fetched: entries.length,
  requests,
  uncompressedBytes: bytes,
  properties,
  duplicatePaths: paths.length - pathSet.size,
};

// 2. The sitemap, when asked for.
if (sitemapUrl) {
  const locs = async (url) => [...(await (await get(url)).text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
  const top = await (await get(sitemapUrl)).text();
  let urls = [...top.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
  const skipped = [];
  if (top.includes('<sitemapindex')) {
    const children = urls;
    urls = [];
    for (const child of children) {
      // The sitemap index names the production host. Read the child from the host we were given.
      const target = onHost(sitemapUrl, pathOf(child));
      if (!target) {
        skipped.push({ sitemap: child, error: 'not a path on the host of --sitemap' });
        continue;
      }
      try {
        urls.push(...(await locs(target)));
      } catch (error) {
        skipped.push({ sitemap: target.href, error: error.message });
      }
    }
  }
  // A sitemap configuration can add an extension such as .html to every path. The index has none.
  const raw = urls.map(pathOf).filter((path) => path !== null);
  const extension = raw.length > 0 && raw.every((path) => path.endsWith('.html')) && !paths.some((path) => String(path).endsWith('.html')) ? '.html' : '';
  const inSitemap = new Set(raw.map((path) => path.slice(0, path.length - extension.length)));
  const noindex = new Set(entries.filter((entry) => /noindex/i.test(String(entry.robots ?? ''))).map((entry) => entry.path));
  const notInIndex = [...inSitemap].filter((path) => !pathSet.has(path));
  const notInSitemap = [...pathSet].filter((path) => !inSitemap.has(path));
  report.sitemap = {
    url: sitemapUrl.href,
    urls: inSitemap.size,
    ...(extension ? { extension } : {}),
    skipped,
    notInIndexCount: notInIndex.length,
    notInIndex: notInIndex.slice(0, LISTED),
    notInSitemapCount: notInSitemap.length,
    notInSitemapWithNoindex: notInSitemap.filter((path) => noindex.has(path)).length,
    notInSitemap: notInSitemap.filter((path) => !noindex.has(path)).slice(0, LISTED),
  };
}

// 3. Do indexed paths answer? Oldest first, because those are the likeliest to be gone.
if (check > 0) {
  const byAge = columns.includes('lastModified')
    ? [...entries].sort((a, b) => Number(a.lastModified) - Number(b.lastModified))
    : entries;
  const sample = byAge.slice(0, check).map((entry) => entry.path);
  const notOk = [];
  for (const path of sample) {
    const target = onHost(indexUrl, path);
    if (!target) {
      notOk.push({ path, error: 'not a path on the host of the index' });
      continue;
    }
    try {
      const response = await fetch(target, { method: 'HEAD', redirect: 'manual' });
      if (response.status !== 200) notOk.push({ path, status: response.status, location: response.headers.get('location') ?? undefined });
    } catch (error) {
      notOk.push({ path, error: error.message });
    }
  }
  report.status = { checked: sample.length, of: entries.length, order: columns.includes('lastModified') ? 'oldest lastModified first' : 'index order', notOk };
}

console.log(JSON.stringify(report, null, 2));
