#!/usr/bin/env node
// skills/rollout/scripts/test/media-manifest.test.mjs — the media-manifest.mjs contract: per delivered document, every
// media reference (img src/srcset, picture source, video/audio src, poster) in document order, each once, classified
// against the deploy media ledger — rehosted (source URL(s) → the ledger's media/<scope>/<file>), unmapped (a content-
// host media path the ledger does not record), external, code (a path on the code origin) or broken; the page path
// from the document path; the summary line, the per-page lines, --json to stdout or a file; usage errors; --help
// writes nothing. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, docRefs, pagePath, parseArgs, summaryLine } from '../media-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'media-manifest.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'media-manifest-test-')));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };

const CH = 'https://content.example.test/org/repo';
const LEDGER = {
  'media/site/hero-1a2b.jpg': { status: 'uploaded', file: 'stardust/current/assets/media/hero-1a2b.jpg', contentUrl: `${CH}/media/site/hero-1a2b.jpg`, sources: ['https://www.example.test/img/hero.jpg', 'https://www.example.test/img/hero@2x.jpg'] },
  'media/site/card-3c4d.png': { status: 'uploaded', file: 'stardust/current/assets/media/card-3c4d.png', contentUrl: `${CH}/media/site/card-3c4d.png`, sources: [] },
  'media/site/failed-5e6f.png': { status: 'failed', file: 'x.png', contentUrl: `${CH}/media/site/failed-5e6f.png`, error: 'http 500' },
};

check('docRefs: img src + srcset, picture source srcset/src, video src + poster, audio src — document order, each once; data:, empty and #fragment refs dropped; comments and scripts not read', () => {
  const html = `<!-- <img src="/no.png"> --><script>var x='<img src="/no2.png">'</script>
<picture><source srcset="${CH}/media/site/hero-1a2b.jpg?width=750 750w, ${CH}/media/site/hero-1a2b.jpg?width=2000 2000w"><img src="${CH}/media/site/hero-1a2b.jpg?width=750" alt=""></picture>
<img src="data:image/gif;base64,R0l"><img src=""><img src="#x"><img src="/icons/search.svg">
<video src="https://cdn.example.test/v.mp4" poster="${CH}/media/site/card-3c4d.png"></video><audio src="/assets/a.mp3"></audio>`;
  assert.deepEqual(docRefs(html), [
    `${CH}/media/site/hero-1a2b.jpg?width=750`, `${CH}/media/site/hero-1a2b.jpg?width=2000`, '/icons/search.svg',
    'https://cdn.example.test/v.mp4', `${CH}/media/site/card-3c4d.png`, '/assets/a.mp3',
  ]);
});

check('classify: a ledger contentUrl (query and fragment ignored) or a media path ending in a ledger key → rehosted with its sources; an uploaded entry only; another content-host media path → unmapped; another absolute URL → external; a path → code; about:error → broken', () => {
  assert.deepEqual(classify(`${CH}/media/site/hero-1a2b.jpg?width=750#a`, LEDGER), { status: 'rehosted', delivered: `${CH}/media/site/hero-1a2b.jpg?width=750#a`, daPath: 'media/site/hero-1a2b.jpg', sources: ['https://www.example.test/img/hero.jpg', 'https://www.example.test/img/hero@2x.jpg'], local: 'stardust/current/assets/media/hero-1a2b.jpg' });
  assert.equal(classify('./media/site/card-3c4d.png', LEDGER).status, 'rehosted');
  assert.equal(classify('./media/site/card-3c4d.png', LEDGER).daPath, 'media/site/card-3c4d.png');
  assert.deepEqual(classify(`${CH}/media/site/failed-5e6f.png`, LEDGER), { status: 'unmapped', delivered: `${CH}/media/site/failed-5e6f.png` }, 'a failed upload is not delivered media');
  assert.deepEqual(classify(`${CH}/media/site/gone.png`, LEDGER), { status: 'unmapped', delivered: `${CH}/media/site/gone.png` });
  assert.deepEqual(classify('https://cdn.example.test/v.mp4', LEDGER), { status: 'external', delivered: 'https://cdn.example.test/v.mp4' });
  assert.deepEqual(classify('/icons/search.svg', LEDGER), { status: 'code', delivered: '/icons/search.svg' });
  assert.deepEqual(classify('about:error', LEDGER), { status: 'broken', delivered: 'about:error' });
});

check('pagePath: the document path under --content, .html dropped, index → its folder', () => {
  assert.equal(pagePath('index.html'), '/');
  assert.equal(pagePath('de/index.html'), '/de/');
  assert.equal(pagePath('de/about-us.html'), '/de/about-us');
});

check('parseArgs: defaults; every flag; a value flag without its value and an unknown argument are usage errors', () => {
  assert.deepEqual(parseArgs([]), { content: 'content', ledger: 'stardust/deploy/media-ledger.json', json: false, jsonFile: null });
  assert.deepEqual(parseArgs(['--content', 'c', '--ledger', 'l.json', '--json', 'o.json']), { content: 'c', ledger: 'l.json', json: true, jsonFile: 'o.json' });
  assert.deepEqual(parseArgs(['--json']), { content: 'content', ledger: 'stardust/deploy/media-ledger.json', json: true, jsonFile: null });
  for (const [argv, re] of [[['--content'], /--content needs a value/], [['--ledger', '--json'], /--ledger needs a value/], [['--bogus'], /unknown argument --bogus/]]) {
    assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), argv.join(' '));
  }
});

check('summaryLine: pages, references, then each status count in a fixed order', () => {
  assert.equal(summaryLine({ pages: 2, totals: { rehosted: 3, unmapped: 1, external: 1, code: 2, broken: 0 } }),
    'media-manifest: 2 page(s) · 7 reference(s) — rehosted 3 · unmapped 1 · external 1 · code 2 · broken 0');
});

// ---- CLI on a project tree --------------------------------------------------------------------------------
const proj = join(root, 'proj');
mkdirSync(join(proj, 'content/de'), { recursive: true });
mkdirSync(join(proj, 'stardust/deploy'), { recursive: true });
writeFileSync(join(proj, 'stardust/deploy/media-ledger.json'), `${JSON.stringify(LEDGER, null, 2)}\n`);
writeFileSync(join(proj, 'content/index.html'), `<main><picture><source srcset="${CH}/media/site/hero-1a2b.jpg?width=2000 2000w"><img src="${CH}/media/site/hero-1a2b.jpg?width=750"></picture><img src="/icons/search.svg"></main>`);
writeFileSync(join(proj, 'content/de/about.html'), `<main><img src="./media/site/card-3c4d.png"><img src="${CH}/media/site/gone.png"><img src="about:error"><img src="https://cdn.example.test/x.jpg"></main>`);
writeFileSync(join(proj, 'content/nav.html'), '<ul><li>no media</li></ul>');
const TEXT = [
  'media-manifest: 3 page(s) · 7 reference(s) — rehosted 3 · unmapped 1 · external 1 · code 1 · broken 1',
  '/  (content/index.html) 3',
  `  rehosted  https://www.example.test/img/hero.jpg (+1) → media/site/hero-1a2b.jpg  [${CH}/media/site/hero-1a2b.jpg?width=2000]`,
  `  rehosted  https://www.example.test/img/hero.jpg (+1) → media/site/hero-1a2b.jpg  [${CH}/media/site/hero-1a2b.jpg?width=750]`,
  '  code      /icons/search.svg',
  '/de/about  (content/de/about.html) 4',
  '  rehosted  (source unknown) → media/site/card-3c4d.png  [./media/site/card-3c4d.png]',
  `  unmapped  ${CH}/media/site/gone.png`,
  '  broken    about:error',
  '  external  https://cdn.example.test/x.jpg',
  '/nav  (content/nav.html) 0',
  '',
].join('\n');

check('CLI text: the summary, then per page (document order of paths, sorted) its references in document order; exit 0; nothing written', () => {
  const before = readdirSync(proj).sort();
  const r = run([], proj);
  assert.equal(r.code, 0, r.err); assert.equal(r.out, TEXT);
  assert.deepEqual(readdirSync(proj).sort(), before);
});

check('CLI --json: the same data on stdout; --json <file> writes it (directories created), the text still prints plus a json: line; deterministic', () => {
  const r = run(['--json'], proj);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.tool, 'media-manifest'); assert.equal(j.content, 'content'); assert.equal(j.ledger, 'stardust/deploy/media-ledger.json');
  assert.deepEqual(j.totals, { rehosted: 3, unmapped: 1, external: 1, code: 1, broken: 1 });
  assert.deepEqual(j.pages.map((p) => [p.path, p.file, p.media.length]), [['/', 'content/index.html', 3], ['/de/about', 'content/de/about.html', 4], ['/nav', 'content/nav.html', 0]]);
  assert.deepEqual(j.pages[1].media[0], { status: 'rehosted', delivered: './media/site/card-3c4d.png', daPath: 'media/site/card-3c4d.png', sources: [], local: 'stardust/current/assets/media/card-3c4d.png' });
  const f = run(['--json', 'out/manifest.json'], proj);
  assert.equal(f.code, 0, f.err); assert.equal(f.out, `${TEXT}json: out/manifest.json\n`);
  assert.deepEqual(JSON.parse(readFileSync(join(proj, 'out/manifest.json'), 'utf8')), j);
  assert.equal(run(['--json'], proj).out, r.out, 'deterministic');
});

check('no ledger: a content-relative media path is unmapped, an absolute URL on a host the ledger cannot name is external (a NOTE on stderr names the missing ledger), exit 0', () => {
  const r = run(['--ledger', 'nope.json'], proj);
  assert.equal(r.code, 0, r.err); assert.match(r.err, /no media ledger at nope\.json/);
  assert.match(r.out, /rehosted 0 · unmapped 1 · external 4 · code 1 · broken 1\n/);
});

check('usage errors exit 2: --content not a directory, a ledger that is not a JSON object, an unknown flag — one line naming it, nothing on stdout', () => {
  const bad = join(root, 'bad'); mkdirSync(join(bad, 'content'), { recursive: true }); writeFileSync(join(bad, 'l.json'), '[1]');
  for (const [args, cwd, re] of [[['--content', 'none'], proj, /--content none is not a directory/], [['--ledger', 'l.json'], bad, /l\.json is not a JSON object/], [['--bogus'], proj, /unknown argument --bogus/]]) {
    const r = run(args, cwd);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.out, ''); assert.match(r.err, re);
  }
});

check('--help (and -h) in an empty cwd: exit 0, usage, inputs, output and exit codes; nothing written', () => {
  const cwd = join(root, 'help'); mkdirSync(cwd);
  for (const a of ['--help', '-h']) {
    const r = run([a], cwd);
    assert.equal(r.code, 0); for (const s of ['Usage:', '--content <dir>', '--ledger <file>', '--json', 'rehosted', 'unmapped', 'Exit codes:']) assert.ok(r.out.includes(s), s);
  }
  assert.deepEqual(readdirSync(cwd), []); assert.equal(existsSync(join(cwd, 'out')), false);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nmedia-manifest: all checks passed');
process.exit(failed ? 1 : 0);
