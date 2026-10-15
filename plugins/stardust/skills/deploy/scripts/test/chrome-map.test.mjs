#!/usr/bin/env node
// skills/deploy/scripts/test/chrome-map.test.mjs — chrome-map.mjs on a synthetic project (fixtures/chrome-map/:
// nav/footer documents in both conventions — `content/<prefix>/nav.html` and `content/nav-<id>.html` — a lone
// footer, a variant nav no page resolves to, a mega-menu fragment and a content page that are not chrome, and
// captured pages with and without an <html lang> sidecar): the map equals the expected bytes (sorted keys, trailing
// newline, no timestamp); a re-run leaves the file untouched; a change rewrites it; --dry-run writes nothing;
// no chrome documents → exit 1, no captures → nothing to map; the result does not depend on input order; the
// output keys are the schema's. No network, no browser. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeMap, findChromeDocs, readCaptures, stableJSON } from '../chrome-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'chrome-map.mjs');
const FIXTURE = join(HERE, 'fixtures', 'chrome-map');
const SCHEMA = JSON.parse(readFileSync(join(HERE, '..', '..', 'schemas', 'deploy-chrome-map.schema.json'), 'utf8'));
const EXPECTED = readFileSync(join(FIXTURE, 'expected-chrome-map.json'), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'chrome-map-test-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
let n = 0;
const project = () => {
  const dir = join(scratch, `p${n += 1}`);
  cpSync(join(FIXTURE, 'content'), join(dir, 'content'), { recursive: true });
  cpSync(join(FIXTURE, 'stardust'), join(dir, 'stardust'), { recursive: true });
  return dir;
};
const run = (args, cwd) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const MAP = (dir) => join(dir, 'stardust', 'rollout', 'chrome-map.json');

check('--help answers before any I/O: exit 0, usage on stdout, the empty cwd stays empty', () => {
  const dir = join(scratch, 'empty'); mkdirSync(dir);
  const r = run(['--help'], dir);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^Usage: node chrome-map\.mjs/m);
  assert.deepEqual(readdirSync(dir), [], 'nothing written');
});

check('writes the expected map: one group per resolved chrome pair, longest delivered-path prefix wins, both naming conventions', () => {
  const dir = project();
  const r = run([], dir);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(readFileSync(MAP(dir), 'utf8'), EXPECTED, 'byte-equal to the expected map (sorted keys, trailing newline, no timestamp)');
  assert.match(r.out, /^chrome-map: 4 group\(s\), 9 page\(s\) → stardust\/rollout\/chrome-map\.json \(written\)$/m);
  assert.match(r.out, /^NOTE \/ca\/en: lang en-CA on 2 page\(s\), fr-CA on 1 — the most common is recorded$/m);
  assert.match(r.out, /^NOTE \/de\/de: nav \/nav and footer \/footer-de-de resolve from different prefixes/m);
  assert.match(r.out, /^NOTE \/nav-minimal: no captured page resolves to it/m);
  assert.doesNotMatch(r.out, /products|about-us\.html/, 'a mega-menu fragment and a content page are not chrome documents');
  assert.deepEqual(readdirSync(dirname(MAP(dir))), ['chrome-map.json'], 'no tmp file left');
});

check('a re-run with the same inputs leaves the file untouched; a changed input rewrites it', () => {
  const dir = project();
  assert.equal(run([], dir).code, 0);
  const before = statSync(MAP(dir)).mtimeMs;
  const again = run([], dir);
  assert.equal(again.code, 0, again.err); assert.match(again.out, /\(unchanged\)$/m);
  assert.equal(statSync(MAP(dir)).mtimeMs, before, 'not rewritten');
  writeFileSync(join(dir, 'content', 'nav-us-es.html'), '<body><main><div><p>nav</p></div></main></body>\n');
  writeFileSync(join(dir, 'content', 'footer-us-es.html'), '<body><main><div><p>footer</p></div></main></body>\n');
  writeFileSync(join(dir, 'stardust', 'current', 'pages', 'us-es.json'), JSON.stringify({ slug: 'us-es', url: 'https://example.com/us/es.html' }));
  writeFileSync(join(dir, 'stardust', 'current', 'pages', 'us-es.html'), '<html lang="es-US"><body></body></html>');
  const changed = run([], dir);
  assert.equal(changed.code, 0, changed.err); assert.match(changed.out, /5 group\(s\), 10 page\(s\) .* \(written\)$/m);
  const map = JSON.parse(readFileSync(MAP(dir), 'utf8'));
  assert.deepEqual(map.groups['/us/es'], { footer: '/footer-us-es', footerFile: 'content/footer-us-es.html', lang: 'es-US', nav: '/nav-us-es', navFile: 'content/nav-us-es.html', pages: ['/us/es'] });
  assert.deepEqual(map.groups['/'].pages, ['/', '/us/en', '/us/en/about-us'], '/us/es left the site-wide group');
});

check('--dry-run prints the summary and writes nothing', () => {
  const dir = project();
  const r = run(['--dry-run'], dir);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /\(dry-run: would write\)$/m);
  assert.ok(!existsSync(join(dir, 'stardust', 'rollout')), 'nothing written');
});

check('--root and --content: the paths in the map stay relative to the project root', () => {
  const dir = project();
  cpSync(join(dir, 'content'), join(dir, 'site', 'content'), { recursive: true }); rmSync(join(dir, 'content'), { recursive: true });
  const r = run(['--root', dir, '--content', 'site/content'], scratch);
  assert.equal(r.code, 0, r.out + r.err);
  const map = JSON.parse(readFileSync(MAP(dir), 'utf8'));
  assert.equal(map.groups['/fr'].navFile, 'site/content/fr/nav.html'); assert.equal(map.groups['/fr'].nav, '/fr/nav');
  assert.deepEqual(map._provenance.readArtifacts, ['site/content/', 'stardust/current/pages/']);
});

check('no nav/footer document under content/ → exit 1, nothing written; no captured pages → nothing to map, exit 0', () => {
  const dir = project();
  rmSync(join(dir, 'content'), { recursive: true });
  const r = run([], dir);
  assert.equal(r.code, 1, r.out + r.err); assert.match(r.err, /no nav or footer document under content\//);
  assert.ok(!existsSync(join(dir, 'stardust', 'rollout')));
  const dir2 = project();
  rmSync(join(dir2, 'stardust', 'current'), { recursive: true });
  const r2 = run([], dir2);
  assert.equal(r2.code, 0, r2.out + r2.err); assert.match(r2.out, /no captured pages under stardust\/current\/pages — nothing to map/);
  assert.ok(!existsSync(join(dir2, 'stardust', 'rollout')));
});

check('usage errors exit 2', () => {
  const r = run(['--bogus'], scratch); assert.equal(r.code, 2); assert.match(r.err, /unknown argument --bogus/);
  const r2 = run(['--root'], scratch); assert.equal(r2.code, 2); assert.match(r2.err, /--root needs a value/);
});

check('pure: the map does not depend on input order; a folder pair beats a flat pair at the same depth', () => {
  const dir = project();
  const docs = findChromeDocs(join(dir, 'content'));
  const pages = readCaptures(join(dir, 'stardust', 'current', 'pages'));
  const a = buildChromeMap({ docs, pages, contentRel: 'content' });
  const b = buildChromeMap({ docs: [...docs].reverse(), pages: [...pages].reverse(), contentRel: 'content' });
  assert.equal(stableJSON(a.map), stableJSON(b.map)); assert.deepEqual(a.notes, b.notes);
  assert.equal(stableJSON(a.map), EXPECTED);
  const both = [...docs, { kind: 'nav', file: 'ca/en/nav.html', daPath: '/ca/en/nav', folder: 'ca/en', flat: null }];
  assert.equal(buildChromeMap({ docs: both, pages, contentRel: 'content' }).map.groups['/ca/en'].nav, '/ca/en/nav');
});

check('schema-shaped: every group carries the required keys and only the schema\'s properties', () => {
  const map = JSON.parse(EXPECTED);
  const def = SCHEMA.$defs.group;
  assert.deepEqual(Object.keys(map).filter((k) => !(k in SCHEMA.properties)), []);
  for (const g of Object.values(map.groups)) {
    for (const k of def.required) assert.ok(k in g, `required ${k}`);
    assert.deepEqual(Object.keys(g).filter((k) => !(k in def.properties)), []);
    assert.ok(g.pages.every((p) => p.startsWith('/')) && [...g.pages].sort().join() === g.pages.join(), 'pages sorted, delivered paths');
  }
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nchrome-map: all checks passed');
process.exit(failed ? 1 : 0);
