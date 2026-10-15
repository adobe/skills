#!/usr/bin/env node
// skills/deploy/scripts/test/rehost-docs.test.mjs — rehost-docs.mjs on a synthetic project (fixtures/rehost-docs/:
// two captured pages linking documents root-relative, relative, absolute on the www host, with an entity in the
// query and a fragment, inside a script and a comment, an external document, a page, a photo and a mailto).
// Pure: the document links a capture yields and the file names they get. Run: an injected fetch (no server) —
// each same-site document fetched once, the ledger's exact bytes (sorted keys), a name collision resolved by a
// URL hash, identical bytes sharing one file, 404 / 403 / an HTML answer reported as FAIL and never recorded;
// a re-run skips by sha without a request; a changed docs file is restored. CLI: --help in an empty dir; against a
// local server (the fixture's origin rewritten to it) — the browser-shaped request, exit 1 on any FAIL, a re-run
// that touches only the failures; --dry-run sends nothing and writes nothing; usage errors. Never the network.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_EXT, docFileName, docLinks, rehostDocs } from '../rehost-docs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'rehost-docs.mjs');
const FIXTURE = join(HERE, 'fixtures', 'rehost-docs');
const SCHEMA = JSON.parse(readFileSync(join(HERE, '..', '..', 'schemas', 'deploy-asset-ledger.schema.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'rehost-docs-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
let n = 0;
const project = () => { const dir = join(scratch, `p${n += 1}`); cpSync(FIXTURE, dir, { recursive: true }); return dir; };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const LEDGER = (dir) => join(dir, 'stardust', 'deploy', 'asset-ledger.json');

const BYTES = { guide: Buffer.from('%PDF-1.4 the guide\n'), other: Buffer.from('%PDF-1.4 another guide\n'), xlsx: Buffer.from('PK\u0003\u0004 price list'), annual: Buffer.from('%PDF-1.4 annual report\n') };
// path (+query) → [status, content-type, body]; shared by the injected fetch and the local server
const ROUTES = {
  '/content/dam/site/en/guide.pdf.coredownload.pdf': [200, 'application/pdf', BYTES.guide],
  '/files/guide.pdf': [200, 'application/pdf', BYTES.other],
  '/files/same-as-guide.pdf': [200, 'application/pdf', BYTES.guide],
  '/files/price-list.xlsx?v=2&lang=en': [200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', BYTES.xlsx],
  '/files/Annual%20Report%202024.PDF': [200, 'application/pdf; qs=0.001', BYTES.annual],
  '/files/missing.pdf': [404, 'text/plain', Buffer.from('not found')],
  '/files/walled.docx': [403, 'text/html', Buffer.from('denied')],
  '/files/challenge.pdf': [200, 'text/html; charset=utf-8', Buffer.from('<html>challenge</html>')],
};
const respond = (pathAndQuery) => {
  const [status, type, body] = ROUTES[pathAndQuery] || [404, 'text/plain', Buffer.from('no route')];
  return new Response(body, { status, headers: { 'content-type': type } });
};
const fakeFetch = (calls) => async (url, init) => { calls.push({ url, init }); const u = new URL(url); return respond(u.pathname + u.search); };

const OTHER = `/docs/guide-${createHash('sha1').update('https://example.com/files/guide.pdf').digest('hex').slice(0, 8)}.pdf`;
const EXPECTED_LEDGER = {
  'https://example.com/content/dam/site/en/guide.pdf.coredownload.pdf': { bytes: BYTES.guide.length, path: '/docs/guide.pdf', sha256: sha256(BYTES.guide) },
  'https://example.com/files/Annual%20Report%202024.PDF': { bytes: BYTES.annual.length, path: '/docs/annual-report-2024.pdf', sha256: sha256(BYTES.annual) },
  'https://example.com/files/guide.pdf': { bytes: BYTES.other.length, path: OTHER, sha256: sha256(BYTES.other) },
  'https://example.com/files/same-as-guide.pdf': { bytes: BYTES.guide.length, path: '/docs/guide.pdf', sha256: sha256(BYTES.guide) },
  'https://www.example.com/files/price-list.xlsx?v=2&lang=en': { bytes: BYTES.xlsx.length, path: '/docs/price-list.xlsx', sha256: sha256(BYTES.xlsx) },
};

// ---- pure ------------------------------------------------------------------------------------------------
await check('docLinks: <a href> to documents, resolved against the page url, entities decoded, fragment dropped; script, comment, pages and photos ignored', () => {
  const html = readFileSync(join(FIXTURE, 'stardust', 'current', 'pages', 'home.html'), 'utf8');
  assert.deepEqual(docLinks(html, 'https://example.com/'), [
    'https://example.com/content/dam/site/en/guide.pdf.coredownload.pdf',
    'https://example.com/files/Annual%20Report%202024.PDF',
    'https://partner.example.org/brochure.pdf',
    'https://www.example.com/files/price-list.xlsx?v=2&lang=en',
  ]);
  assert.deepEqual(docLinks('<a href=files/a.docx>x</a><A HREF="b.pdf">y</A>', 'https://example.com/x/y.html'), ['https://example.com/x/b.pdf', 'https://example.com/x/files/a.docx']);
  assert.deepEqual(docLinks('<a href="/robots.txt">r</a><a href="/llms.txt">l</a><a href="/a.html">p</a>', 'https://example.com/'), [], 'plain-text plumbing and pages are not documents');
  assert.ok(['/a.pdf', '/a.XLSX', '/a.odp', '/a.epub'].every((p) => DOC_EXT.test(p)) && !DOC_EXT.test('/robots.txt'), 'the exported list the encoder classifies by');
});
await check('docFileName: the last segment up to its first document extension, lower-case, [a-z0-9-] stem', () => {
  assert.equal(docFileName('https://example.com/content/dam/site/en/guide.pdf.coredownload.pdf'), 'guide.pdf');
  assert.equal(docFileName('https://example.com/files/Annual%20Report%202024.PDF'), 'annual-report-2024.pdf');
  assert.equal(docFileName('https://example.com/files/price-list.xlsx?v=2'), 'price-list.xlsx');
  assert.equal(docFileName('https://example.com/a/my.pdfs.pdf'), 'my-pdfs.pdf');
  assert.equal(docFileName('https://example.com/a/%E2%9C%93.pdf'), 'document.pdf');
});

// ---- run with an injected fetch -------------------------------------------------------------------------
const DIR = project();
await check('a run fetches each same-site document once, writes docs/<file> and the ledger (sorted keys); failures are reported, never recorded', async () => {
  const calls = []; const lines = [];
  const r = await rehostDocs({ root: DIR, fetch: fakeFetch(calls), backoffMs: 1, say: (s) => lines.push(s) });
  assert.deepEqual(r.counts, { links: 8, rehosted: 5, skipped: 0, failed: 3, dry: 0, external: 1 });
  assert.deepEqual(calls.map((c) => c.url), [
    'https://example.com/content/dam/site/en/guide.pdf.coredownload.pdf', 'https://example.com/files/Annual%20Report%202024.PDF',
    'https://example.com/files/challenge.pdf', 'https://example.com/files/guide.pdf', 'https://example.com/files/missing.pdf',
    'https://example.com/files/same-as-guide.pdf', 'https://example.com/files/walled.docx', 'https://www.example.com/files/price-list.xlsx?v=2&lang=en',
  ], 'sorted, each once, the external document never');
  assert.match(calls[0].init.headers['user-agent'], /Mozilla/); assert.equal(calls[0].init.headers.referer, 'https://example.com/');
  const text = readFileSync(LEDGER(DIR), 'utf8');
  assert.equal(text, `${JSON.stringify(EXPECTED_LEDGER, null, 2)}\n`, 'exact bytes: keys sorted at both levels, trailing newline');
  assert.ok(readFileSync(join(DIR, 'docs', 'guide.pdf')).equals(BYTES.guide)); assert.ok(readFileSync(join(DIR, OTHER.slice(1))).equals(BYTES.other));
  assert.deepEqual(readdirSync(join(DIR, 'docs')).sort(), ['annual-report-2024.pdf', OTHER.slice(6), 'guide.pdf', 'price-list.xlsx'].sort(), 'identical bytes share one file');
  assert.ok(lines.includes('OK https://example.com/files/same-as-guide.pdf -> /docs/guide.pdf (same bytes as an earlier document)'));
  assert.ok(lines.includes('FAIL https://example.com/files/missing.pdf source 404 (missing at origin — the link stays absolute and is reported; never substitute)'));
  assert.ok(lines.some((l) => /^FAIL https:\/\/example\.com\/files\/walled\.docx source 403 \(bot wall: blocked for a script, NOT missing/.test(l)));
  assert.ok(lines.includes('FAIL https://example.com/files/challenge.pdf source 200 (answered text/html, not a document)'));
  assert.deepEqual(readdirSync(dirname(LEDGER(DIR))), ['asset-ledger.json'], 'no tmp file, no lock dir left');
});
await check('a re-run skips every rehosted document by sha without a request; the ledger and docs are left untouched', async () => {
  const before = statSync(LEDGER(DIR)).mtimeMs; const docBefore = statSync(join(DIR, 'docs', 'guide.pdf')).mtimeMs;
  const calls = []; const lines = [];
  const r = await rehostDocs({ root: DIR, fetch: fakeFetch(calls), backoffMs: 1, say: (s) => lines.push(s) });
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/files/challenge.pdf', '/files/missing.pdf', '/files/walled.docx'], 'only the failures are tried again');
  assert.equal(r.counts.skipped, 5); assert.ok(lines.includes('SKIP https://example.com/files/guide.pdf already rehosted (ledger) -> ' + OTHER));
  assert.equal(statSync(LEDGER(DIR)).mtimeMs, before); assert.equal(statSync(join(DIR, 'docs', 'guide.pdf')).mtimeMs, docBefore);
});
await check('a docs file changed on disk is fetched again and restored; the ledger stays byte-identical', async () => {
  const text = readFileSync(LEDGER(DIR), 'utf8');
  writeFileSync(join(DIR, 'docs', 'price-list.xlsx'), 'edited');
  const calls = [];
  const r = await rehostDocs({ root: DIR, fetch: fakeFetch(calls), backoffMs: 1, say: () => {} });
  assert.ok(calls.some((c) => c.url.endsWith('price-list.xlsx?v=2&lang=en'))); assert.equal(r.counts.rehosted, 1);
  assert.ok(readFileSync(join(DIR, 'docs', 'price-list.xlsx')).equals(BYTES.xlsx)); assert.equal(readFileSync(LEDGER(DIR), 'utf8'), text);
});
await check('--dry-run (function): no fetch, no write, the planned paths listed', async () => {
  const dir = project(); const lines = [];
  const r = await rehostDocs({ root: dir, dryRun: true, fetch: () => { throw new Error('fetched in a dry run'); }, say: (s) => lines.push(s) });
  assert.equal(r.counts.dry, 8); assert.ok(lines.includes('DRY https://example.com/files/guide.pdf -> ' + OTHER));
  assert.ok(!existsSync(join(dir, 'docs')) && !existsSync(join(dir, 'stardust', 'deploy')));
});
await check('--source-host adds a host: a document on it is rehosted, not counted external', async () => {
  const dir = project(); const calls = [];
  const r = await rehostDocs({ root: dir, hosts: ['partner.example.org'], dryRun: true, fetch: fakeFetch(calls), say: () => {} });
  assert.equal(r.counts.links, 9); assert.equal(r.counts.external, 0);
});
await check('schema-shaped: ledger keys are absolute URLs; each entry is exactly {path, sha256, bytes} in the schema\'s patterns', () => {
  const ledger = JSON.parse(readFileSync(LEDGER(DIR), 'utf8'));
  const entry = SCHEMA.$defs.entry;
  for (const [k, v] of Object.entries(ledger)) {
    assert.match(k, new RegExp(SCHEMA.propertyNames.pattern));
    assert.deepEqual(Object.keys(v).sort(), [...entry.required].sort()); assert.match(v.path, new RegExp(entry.properties.path.pattern)); assert.match(v.sha256, new RegExp(entry.properties.sha256.pattern));
  }
});

// ---- CLI against a local server ----------------------------------------------------------------------------
const requests = [];
const server = createServer((req, res) => {
  requests.push({ url: req.url, headers: req.headers });
  const [status, type, body] = ROUTES[req.url] || [404, 'text/plain', Buffer.from('no route')];
  res.writeHead(status, { 'content-type': type }); res.end(body);
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const localProject = () => {
  const dir = project();
  const pages = join(dir, 'stardust', 'current', 'pages');
  for (const f of readdirSync(pages)) writeFileSync(join(pages, f), readFileSync(join(pages, f), 'utf8').replace(/https:\/\/(www\.)?example\.com/g, ORIGIN));
  return dir;
};
const run = (args, cwd) => new Promise((resolve) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { cwd });
  let out = ''; let err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out, err }));
});

await check('--help answers before any I/O: exit 0, usage on stdout, the empty cwd stays empty', async () => {
  const dir = join(scratch, 'empty'); mkdirSync(dir);
  const r = await run(['--help'], dir);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^Usage: node rehost-docs\.mjs/m); assert.deepEqual(readdirSync(dir), []);
});
await check('CLI: fetches from the origin with a browser-shaped request, writes docs + ledger, exit 1 on any FAIL; a re-run asks only for the failures', async () => {
  const dir = localProject();
  const r = await run(['--backoff-ms', '1'], dir);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^rehost-docs: 8 document link\(s\) — 5 rehosted, 0 skipped, 3 failed · 1 external left absolute · ledger stardust\/deploy\/asset-ledger\.json$/m);
  assert.ok(requests.length === 8 && requests.every((q) => /Mozilla/.test(q.headers['user-agent']) && q.headers.referer === `${ORIGIN}/`));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(LEDGER(dir), 'utf8'))).length, 5);
  assert.ok(readFileSync(join(dir, 'docs', 'guide.pdf')).equals(BYTES.guide));
  const again = await run(['--backoff-ms', '1'], dir);
  assert.equal(again.code, 1); assert.match(again.out, /— 0 rehosted, 5 skipped, 3 failed/); assert.equal(requests.length, 8 + 3);
});
await check('CLI --dry-run: nothing requested, nothing written, exit 0', async () => {
  const dir = localProject(); const before = requests.length;
  const r = await run(['--dry-run'], dir);
  assert.equal(r.code, 0, r.out + r.err); assert.match(r.out, /^DRY \S+\/files\/walled\.docx -> \/docs\/walled\.docx$/m);
  assert.match(r.out, /8 document link\(s\) — 0 rehosted, 0 skipped, 0 failed, 8 dry-run · 1 external left absolute$/m);
  assert.equal(requests.length, before); assert.ok(!existsSync(join(dir, 'docs')) && !existsSync(join(dir, 'stardust', 'deploy')));
});
await check('CLI usage errors exit 2; no captured pages → nothing to do, exit 0', async () => {
  const bad = await run(['--bogus'], scratch); assert.equal(bad.code, 2); assert.match(bad.err, /unknown argument --bogus/);
  const noval = await run(['--source-host'], scratch); assert.equal(noval.code, 2); assert.match(noval.err, /--source-host needs a value/);
  const neg = await run(['--retries', '-1'], scratch); assert.equal(neg.code, 2); assert.match(neg.err, /--retries needs a number ≥ 0/);
  const none = await run([], join(scratch, 'empty')); assert.equal(none.code, 0, none.err); assert.match(none.out, /no captured pages under stardust\/current\/pages/);
  assert.deepEqual(readdirSync(join(scratch, 'empty')), []);
});

server.close();
rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nrehost-docs: all checks passed');
process.exit(failed ? 1 : 0);
