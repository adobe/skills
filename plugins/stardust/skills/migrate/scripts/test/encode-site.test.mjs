#!/usr/bin/env node
// Unit test: the encoder's site inputs — encode/deps.mjs (deploy's scripts in both layouts) and encode/site.mjs (roster,
// page paths, media / document / chrome / link resolvers, siteSha) on the synthetic project fixtures/encode-site/project.
// No browser, no network. Scratch projects (the project-copy layout, edited inputs) live in fixtures/encode-site/.scratch/
// (git-ignored, removed afterwards).
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-site.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deployCandidates, deployPath, loadDeploy } from '../encode/deps.mjs';
import { loadSite } from '../encode/site.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENCODE = join(HERE, '..', 'encode');
const DEPLOY = join(HERE, '..', '..', '..', 'deploy', 'scripts');
const SCRATCH = join(HERE, 'fixtures', 'encode-site', '.scratch');
const FIXTURE = join(HERE, 'fixtures', 'encode-site', 'project');

// --- deps.mjs, plugin tree ------------------------------------------------------------------------------------
{
  assert.equal(deployPath('eds-path.mjs'), join(DEPLOY, 'eds-path.mjs'), 'the plugin-tree candidate comes first');
  const a = await loadDeploy('eds-path.mjs');
  assert.equal(a.deliveredUrl('/en/About_Us.html'), '/en/about-us', 'the loaded module is deploy\'s eds-path.mjs');
  assert.equal(await loadDeploy('eds-path.mjs'), a, 'cached: one namespace per file');
  const c = deployCandidates('nope.mjs');
  await assert.rejects(loadDeploy('nope.mjs'), (e) => e.message.includes(c[0]) && e.message.includes(c[1]), 'a missing script names both candidate paths');
  assert.throws(() => deployPath('nope.mjs'), /nope\.mjs/);
}

// --- deps.mjs, project copy: stardust/scripts/migrate/encode/ beside stardust/scripts/deploy/ --------------------
rmSync(SCRATCH, { recursive: true, force: true });
try {
  const proj = join(SCRATCH, 'project', 'stardust', 'scripts');
  mkdirSync(join(proj, 'migrate', 'encode'), { recursive: true });
  mkdirSync(join(proj, 'deploy'), { recursive: true });
  copyFileSync(join(ENCODE, 'deps.mjs'), join(proj, 'migrate', 'encode', 'deps.mjs'));
  writeFileSync(join(proj, 'deploy', 'probe.mjs'), "export const layout = 'project';\n");
  const deps = await import(pathToFileURL(join(proj, 'migrate', 'encode', 'deps.mjs')).href);
  assert.equal(deps.deployPath('probe.mjs'), join(proj, 'deploy', 'probe.mjs'), 'the project-copy candidate resolves');
  assert.equal((await deps.loadDeploy('probe.mjs')).layout, 'project');
  await assert.rejects(deps.loadDeploy('eds-path.mjs'), /eds-path\.mjs.*stardust[/\\]scripts[/\\]deploy[/\\]eds-path\.mjs/, 'never falls back to the plugin tree');
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}

// --- site.mjs: roster and template membership -------------------------------------------------------------------
const site = await loadSite(FIXTURE);
{
  assert.deepEqual(site.slugs, ['home', 'news', 'story-first', 'story-second', 'story-third'], 'every roster slug, sorted');
  assert.deepEqual(site.templates.map((t) => t.id), ['home', 'listing', 'story'], 'templates sorted by id');
  const story = { id: 'story', archetype: 'story-first', pages: ['story-first', 'story-second', 'story-third'] };
  assert.deepEqual(site.templateOf('story-first'), story, 'found by its archetype (representativeSlug)');
  assert.deepEqual(site.templateOf('story'), story, 'found by its id');
  assert.equal(site.templateOf('orphan'), null, 'a state.json page outside templates.json is in no template');
  assert.equal(site.pageJson('news').title, 'News');
  assert.equal(site.pageJson('story-third'), null, 'no page JSON');
  assert.equal(site.pageJson('../state'), null, 'a slug never escapes current/pages/');
  assert.equal(site.pageUrl('home'), 'https://www.example.com/', 'the page JSON url wins over state.json');
  assert.equal(site.pageUrl('story-third'), 'https://example.com/en/stories/third', 'state.json url, resolved against site.originUrl');
  assert.deepEqual(site.sourceHosts, ['example.com'], 'bare hosts of the roster pages (www. folded)');
}

// --- site.mjs: page paths (eds-path deliveredUrl → daPath) ------------------------------------------------------
{
  assert.equal(site.capturePath('news'), 'stardust/current/pages/news.html');
  assert.equal(site.outputPathFor('home'), 'stardust/encoded/index.html', 'the root page is index.html');
  assert.equal(site.contentPathFor('home'), 'content/index.html');
  assert.equal(site.outputPathFor('news'), 'stardust/encoded/en/news/index.html', 'a folder index');
  assert.equal(site.contentPathFor('news'), 'content/en/news/index.html');
  assert.equal(site.outputPathFor('story-first'), 'stardust/encoded/en/stories/first.html', 'a leaf, .html dropped');
  assert.equal(site.outputPathFor('story-second'), 'stardust/encoded/en/stories/second-story.html', 'segments sanitised');
  assert.equal(site.contentPathFor('story-third'), 'content/en/stories/third.html');
  assert.equal(site.outputPathFor('nope'), null, 'an unknown slug has no path');
  const p = site.page('story-second');
  assert.equal(p.deliveredUrl, '/en/stories/second-story');
  assert.equal(p.daPath, '/en/stories/second-story');
  assert.equal(p.template, 'story');
}

// --- site.mjs: media (ledger sources[] and source → contentUrl) ---------------------------------------------------
{
  const hero = 'https://content.da.live/org/repo/media/site/hero-1a2b3c4d.jpg';
  assert.equal(site.resolveMedia('https://example.com/img/hero.jpg'), hero, 'sources[] entry');
  assert.equal(site.resolveMedia('https://www.example.com/img/hero.jpg?w=800'), hero, 'every URL in sources[]');
  assert.equal(site.resolveMedia('https://EXAMPLE.com/img/hero.jpg'), hero, 'URLs compare in their parsed form');
  assert.equal(site.resolveMedia('https://example.com/img/logo.png'), 'https://content.da.live/org/repo/media/site/logo.png', 'a non-null source');
  assert.equal(site.resolveMedia('https://example.com/img/broken.jpg'), null, 'a failed upload never resolves');
  assert.equal(site.resolveMedia('https://example.com/img/unknown.jpg'), null, 'no entry → null (the caller records mediaUnresolved)');
}

// --- site.mjs: documents (asset ledger) ---------------------------------------------------------------------------
{
  assert.equal(site.resolveDoc('https://example.com/files/guide.pdf'), '/docs/guide.pdf');
  assert.equal(site.resolveDoc('https://example.com/files/other.pdf'), null);
}

// --- site.mjs: chrome (chrome map groups, pathKey of the delivered path) ----------------------------------------------
{
  const en = { nav: '/en/nav', footer: '/en/footer', lang: 'en' };
  assert.deepEqual(site.chromeFor('https://example.com/en/stories/first.html'), en, 'a source URL');
  assert.deepEqual(site.chromeFor('https://example.com/en/stories/Second_Story.html'), en, 'matched on the delivered path');
  assert.deepEqual(site.chromeFor('/en/news/'), en, 'a delivered path');
  assert.deepEqual(site.chromeFor('https://www.example.com/'), { nav: '/nav', footer: '/footer', lang: 'en' });
  assert.deepEqual(site.chromeFor('https://example.com/en/stories/third'), { nav: '/nav', footer: '/footer', lang: null }, 'no group → the defaults');
}

// --- site.mjs: links (roster + redirects.tsv through localize-links / eds-path; documents through the asset ledger) ---
{
  const base = 'https://example.com/en/stories/first.html';
  const L = (href) => site.localizeHref(href, base);
  assert.deepEqual(L('Second_Story.html'), { href: '/en/stories/second-story', internal: true, kind: 'page' }, 'relative → delivered URL');
  assert.deepEqual(L('https://www.example.com/en/news/index.html?tab=2#top'), { href: '/en/news/?tab=2#top', internal: true, kind: 'page' }, 'folder index; query and fragment kept');
  assert.deepEqual(L('/'), { href: '/', internal: true, kind: 'page' });
  assert.deepEqual(L('//example.com/en/stories/third'), { href: '/en/stories/third', internal: true, kind: 'page' });
  assert.deepEqual(L('HTTPS://EXAMPLE.COM/EN/Stories/First.html'), { href: '/en/stories/first', internal: true, kind: 'page' });
  assert.deepEqual(L('https://example.com/old/first-story.html'), { href: '/en/stories/first', internal: true, kind: 'page' }, 'a redirect to a roster page');
  assert.deepEqual(L('https://example.com/en/news/'), { href: '/en/news/', internal: true, kind: 'page' }, 'a redirect never shadows a page');
  assert.deepEqual(L('https://example.com/retired'), { href: 'https://example.com/retired', internal: false, unresolved: true, kind: 'page' }, 'a redirect to a page outside the roster stays absolute');
  assert.deepEqual(L('/en/orphan'), { href: 'https://example.com/en/orphan', internal: false, unresolved: true, kind: 'page' }, 'not in the roster → absolute, unresolved');
  assert.deepEqual(L('https://example.com/files/guide.pdf#page=2'), { href: '/docs/guide.pdf#page=2', internal: true, kind: 'doc' }, 'asset ledger');
  assert.deepEqual(L('/files/missing.pdf'), { href: 'https://example.com/files/missing.pdf', internal: false, unresolved: true, kind: 'doc' }, 'a document with no ledger entry');
  assert.deepEqual(L('https://other.example.org/report.pdf'), { href: 'https://other.example.org/report.pdf', internal: false, unresolved: true, kind: 'doc' }, 'on any host');
  assert.deepEqual(L('https://other.example.org/page'), { href: 'https://other.example.org/page', internal: false, kind: 'external' });
  assert.deepEqual(L('https://other.example.org'), { href: 'https://other.example.org', internal: false, kind: 'external' }, 'an absolute external href is kept as written');
  for (const h of ['#section', 'mailto:team@example.com', 'tel:+100', 'javascript:void(0)', '']) assert.deepEqual(L(h), { href: h, internal: false, kind: 'skip' }, `left alone: ${h || '(empty)'}`);
}

// --- site.mjs: siteSha (what the encoder reads from the site inputs, canonicalised) ------------------------------------
rmSync(SCRATCH, { recursive: true, force: true });
try {
  assert.match(site.siteSha, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await loadSite(FIXTURE)).siteSha, site.siteSha, 'stable across loads');
  const copy = join(SCRATCH, 'copy');
  const shaAfter = async (rel, edit) => {
    rmSync(copy, { recursive: true, force: true });
    cpSync(FIXTURE, copy, { recursive: true });
    const f = join(copy, 'stardust', rel);
    if (edit === null) rmSync(f); else writeFileSync(f, edit(readFileSync(f, 'utf8')));
    return (await loadSite(copy)).siteSha;
  };
  const reorder = (raw) => { const j = JSON.parse(raw); return JSON.stringify(Object.fromEntries(Object.entries(j).reverse().map(([k, v]) => [k, { ...v, ts: '2026-02-02T00:00:00.000Z', attempts: 3 }]))); };
  assert.equal(await shaAfter('deploy/media-ledger.json', reorder), site.siteSha, 'ledger key order, timestamps and attempt counters never move it');
  assert.notEqual(await shaAfter('deploy/media-ledger.json', (r) => r.replace('repo/media/site/logo.png', 'repo/media/site/logo-2.png')), site.siteSha, 'a contentUrl');
  assert.notEqual(await shaAfter('deploy/asset-ledger.json', (r) => r.replace('/docs/guide.pdf', '/docs/guide-2.pdf')), site.siteSha, 'an asset path');
  assert.notEqual(await shaAfter('rollout/chrome-map.json', (r) => r.replace('"/en/nav"', '"/en/nav-2"')), site.siteSha, 'a chrome group');
  assert.notEqual(await shaAfter('redirects.tsv', (r) => r.replace('/old/first-story.html', '/old/first.html')), site.siteSha, 'a redirect');
  assert.notEqual(await shaAfter('current/pages/story-first.json', (r) => r.replace('first.html', 'one.html')), site.siteSha, 'a roster URL');
  assert.notEqual(await shaAfter('rollout/coverage/templates.json', (r) => r.replace('"pages": ["news"]', '"pages": ["news", "orphan"]')), site.siteSha, 'the roster');
  assert.notEqual(await shaAfter('rollout/chrome-map.json', null), site.siteSha, 'a removed input');

  // a project with none of the inputs: everything empty, nothing throws
  const empty = join(SCRATCH, 'empty');
  mkdirSync(empty, { recursive: true });
  const e = await loadSite(empty);
  assert.deepEqual([e.slugs, e.templates, e.sourceHosts], [[], [], []]);
  assert.equal(e.resolveMedia('https://example.com/img/hero.jpg'), null);
  assert.equal(e.resolveDoc('https://example.com/files/guide.pdf'), null);
  assert.deepEqual(e.chromeFor('https://example.com/'), { nav: '/nav', footer: '/footer', lang: null });
  assert.match(e.siteSha, /^sha256:[0-9a-f]{64}$/);

  // a malformed input fails loud, naming the file
  mkdirSync(join(empty, 'stardust', 'deploy'), { recursive: true });
  writeFileSync(join(empty, 'stardust', 'deploy', 'media-ledger.json'), '{ "media/x.png": ');
  await assert.rejects(loadSite(empty), /media-ledger\.json/);
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log('encode-site: ok');
