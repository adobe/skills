#!/usr/bin/env node
// skills/reskin/scripts/test/content-behaviour.test.mjs — measurement normalisation (source-normalize.mjs
// measurePrep): a source behaviour the render keeps (a collapsed accordion, a sticky ISI tray loaded as an EDS
// fragment, an EDS modal) never fails dom-equality or slot-coverage, and content one side shows that the other lacks
// still fails. Also the embed inventory (an embed with no counterpart fails slot-coverage) and alt-text flags
// (advisory). The pure cases run anywhere; the page cases serve fixtures over node:http and run the CLIs in plain
// Chromium (needs playwright; prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKS, parseMarked, flattenSegments, groupRanges, alignOptional, keptItems, embedIdentity, altFlags } from '../source-normalize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'content-behaviour-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const [O, C] = MARKS;
const flat = (raw) => flattenSegments(parseMarked(raw));
const align = (src, rnd) => { const a = flat(src); const b = flat(rnd); const r = alignOptional(a.words, b.words, a.opt, b.opt); return { ...r, src: keptItems(a.words, a.opt, r.skipA).join(' '), rnd: keptItems(b.words, b.opt, r.skipB).join(' ') }; };

await check('a closed answer on the rendered side counts where the source shows the same words', () => {
  const r = align('FAQ\nHow is it taken?\nOnce a day.\nCan I stop?\nAsk your doctor.', `FAQ\nHow is it taken?\n${O}Once a day.${C}\nCan I stop?\n${O}\nAsk your doctor.\n${C}`);
  assert.ok(r.pass);
  assert.equal(r.rnd, 'FAQ How is it taken? Once a day. Can I stop? Ask your doctor.');
});

await check('an answer the rendered side lacks fails, revealed or not', () => {
  assert.equal(align('How is it taken? Once a day. Can I stop?', `How is it taken? ${O}${C} Can I stop?`).pass, false);
  assert.equal(align('How is it taken? Once a day. Can I stop?', `How is it taken? ${O}Twice a day.${C} Can I stop?`).pass, false);
});

await check('optional content only one side has drops out of both; required words never do', () => {
  const r = align(`Hero ${O}Leaving this site? Continue${C} Footer`, 'Hero Footer');
  assert.ok(r.pass);
  assert.equal(r.src, 'Hero Footer');
  assert.equal(align(`Hero ${O}Note${C} Footer`, `Hero Extra ${O}Note${C} Footer`).pass, false, 'rendered-only required text still fails');
});

await check('a word split across a mark stays required; with no marks it is plain equality', () => {
  const f = flat(`ab${O}cd${C} ef`);
  assert.deepEqual(f.words, ['abcd', 'ef']);
  assert.deepEqual(f.groups, [0, 0]);
  assert.equal(alignOptional('a b'.split(' '), 'a b'.split(' ')).pass, true);
  assert.equal(alignOptional('a b'.split(' '), 'a c'.split(' ')).pass, false);
});

await check('image groups: a revealed image counts where the other side has it, else drops out', () => {
  const src = ['a.png', 'b.png', 'c.png']; const rnd = ['a.png', 'b.png', 'x.png', 'c.png'];
  const opt = groupRanges([0, 3, 4, 0]);
  const r = alignOptional(src, rnd, [], opt);
  assert.ok(r.pass);
  assert.deepEqual(keptItems(rnd, opt, r.skipB), src);
  assert.equal(alignOptional(['a.png', 'b.png'], ['a.png'], [], []).pass, false);
});

await check('embedIdentity: provider + video id for YouTube, Vimeo, Wistia, Brightcove; host + path otherwise; null for an API script', () => {
  assert.equal(embedIdentity('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0').key, 'youtube:dQw4w9WgXcQ');
  assert.equal(embedIdentity('https://youtu.be/dQw4w9WgXcQ').key, 'youtube:dQw4w9WgXcQ');
  assert.equal(embedIdentity('https://www.youtube.com/watch?v=dQw4w9WgXcQ').key, 'youtube:dQw4w9WgXcQ');
  assert.equal(embedIdentity('https://player.vimeo.com/video/76979871').key, 'vimeo:76979871');
  assert.equal(embedIdentity('https://fast.wistia.net/embed/iframe/abc123def4').key, 'wistia:abc123def4');
  assert.equal(embedIdentity('https://fast.wistia.com/embed/medias/abc123def4.jsonp').key, 'wistia:abc123def4');
  assert.equal(embedIdentity('wistia:abc123def4').key, 'wistia:abc123def4');
  assert.equal(embedIdentity('https://players.brightcove.net/1/default_default/index.html?videoId=6301').key, 'brightcove:6301');
  assert.equal(embedIdentity('https://cdn.example.com/v/intro.mp4?t=3').key, 'url:cdn.example.com/v/intro.mp4');
  assert.equal(embedIdentity('https://fast.wistia.com/assets/external/E-v1.js'), null);
  assert.equal(embedIdentity('https://www.youtube.com/iframe_api'), null);
});

await check('altFlags: generic words, file names and one alt on several images; not an empty alt or a hyphenated word', () => {
  const flags = altFlags([
    { slot: 's01', src: '/a.png', alt: 'icon' }, { slot: 's01', src: '/b.png', alt: 'IMG_1234.JPG' },
    { slot: 's02', src: '/c.png', alt: 'Photo 2' }, { slot: 's02', src: '/d.png', alt: 'hero-banner-2x' },
    { slot: 's03', src: '/e.png', alt: '' }, { slot: 's03', src: '/f.png', alt: 'A well-being coach' },
    { slot: 's04', src: '/g.png', alt: 'Card' }, { slot: 's04', src: '/h.png', alt: 'Card' }, { slot: 's04', src: '/i.png', alt: 'card' },
    { slot: 's05', src: '/j.png', alt: 'COVID-19 testing' },
  ]);
  assert.deepEqual(flags.map((f) => `${f.src} ${f.reason}`), ['/a.png generic', '/b.png file-name', '/c.png generic', '/d.png file-name', '/g.png repeated', '/h.png repeated', '/i.png repeated']);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  content behaviours against pages (playwright not importable here; run this test in an environment that has it)'); }

const SCRIPTS = join(HERE, '..');
const run = (script, args) => new Promise((done) => {
  const child = spawn(process.execPath, [join(SCRIPTS, script), ...args], { cwd: scratch, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '' } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => done({ status, stdout, stderr, all: stdout + stderr }));
});
const page = (body, head = '') => `<!doctype html><html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`;
const ISI = '<h2>Important Safety Information</h2><p>Do not take it if you are allergic to it.</p><p>Call your doctor about side effects.</p>';

if (playwrightOk) {
  const pages = {
    // source: answers shown in the DOM but clipped by CSS (readable by innerText); the ISI inline; a leaving-site dialog closed
    '/source': page(`<main><h1>Treatment</h1><div class="faq"><button aria-expanded="false">How is it taken?</button><div style="max-height:0;overflow:hidden"><p>Once a day, with food.</p></div>
      <button aria-expanded="false">Can I stop?</button><div style="max-height:0;overflow:hidden"><p>Ask your doctor first.</p></div></div>
      <p><a href="#leave">Visit the partner site</a></p><dialog id="leave"><p>You are leaving this site.</p></dialog>${ISI}</main>`),
    // rendered: the same FAQ as closed <details>, the dialog as an EDS modal link, the ISI as a sticky tray outside main
    '/rendered': page(`<main><div class="section"><h1>Treatment</h1><div class="accordion"><details><summary>How is it taken?</summary><p>Once a day, with food.</p></details>
      <details><summary>Can I stop?</summary><p>Ask your doctor first.</p></details></div>
      <p><a href="/modals/leave">Visit the partner site</a></p></div></main>
      <aside class="isi-tray" style="position:fixed;bottom:0;height:60px;overflow:hidden"><button>Expand</button><div class="section">${ISI}</div></aside>`, '<meta name="isi" content="/fragments/isi">'),
    // rendered, an answer lost
    '/rendered-missing': page(`<main><h1>Treatment</h1><details><summary>How is it taken?</summary><p>Once a day, with food.</p></details>
      <details><summary>Can I stop?</summary></details><p><a href="/modals/leave">Visit the partner site</a></p></main>
      <aside><div class="section">${ISI}</div></aside>`),
    // rendered, the ISI as an in-place fragment link the page did not load (its heading is the link text)
    '/rendered-link': page(`<main><h1>Treatment</h1><details><summary>How is it taken?</summary><p>Once a day, with food.</p></details>
      <details><summary>Can I stop?</summary><p>Ask your doctor first.</p></details><p><a href="/modals/leave">Visit the partner site</a></p>
      <p><a href="/fragments/isi">Important Safety Information</a></p></main>`),
    '/fragments/isi.plain.html': '<div><p>Do not take it if you are allergic to it.</p><p>Call your doctor about side effects.</p></div>',
    '/modals/leave.plain.html': '<div><p>You are leaving this site.</p></div><div class="metadata"><div><div>Title</div><div>Leave</div></div></div>',
    // slot-coverage: an embed as an EDS link (no player built), and nothing
    '/embed-ok': page('<main><h1>Watch</h1><p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a></p><details><summary>Transcript</summary><p>Hello there.</p></details></main>'),
    '/embed-ok.plain.html': '<div><h1>Watch</h1><div class="embed"><div><div><a href="https://youtu.be/dQw4w9WgXcQ">x</a></div></div></div></div>',
    '/embed-missing': page('<main><h1>Watch</h1><details><summary>Transcript</summary><p>Hello there.</p></details></main>'),
  };
  const requests = [];
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0]; requests.push(path);
    const body = pages[path];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }); res.end(body ?? 'not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const gate = (rendered, name) => run('dom-equality.mjs', ['--source', `${origin}/source`, '--rendered', `${origin}${rendered}`, '--report', join(scratch, `${name}.md`)])
    .then((r) => ({ ...r, report: readFileSync(join(scratch, `${name}.md`), 'utf8') }));

  const [kept, missing, linked] = await Promise.all([gate('/rendered', 'kept'), gate('/rendered-missing', 'missing'), gate('/rendered-link', 'linked')]);

  await check('dom-equality: closed <details> vs the source\'s clipped answers, a modal link vs a closed dialog, the ISI in a sticky tray outside main → PASS, and the report says what ran', () => {
    assert.equal(kept.status, 0, kept.all);
    assert.match(kept.report, /\*\*Overall: PASS\*\*/);
    assert.match(kept.report, /Measurement normalisation \(measured only, page restored\): source — 0 details opened, 1 dialogs opened.*; rendered — 2 details opened, 0 fragments resolved, 1 modals resolved \(\/modals\/leave\), 1 EDS regions outside main read, already shown, not added: \/fragments\/isi/);
    assert.match(kept.all, /\[dom-equality\] Measurement normalisation/);
  });

  await check('dom-equality: an answer the render lost still FAILS, at the missing words', () => {
    assert.equal(missing.status, 1, missing.all);
    assert.match(missing.report, /\*\*Overall: FAIL\*\*/);
    assert.match(missing.all, /text diverges @\d+: src="[^"]*Ask your doctor first/);
  });

  await check('dom-equality: the ISI as a /fragments/ link is resolved from <path>.plain.html in place → PASS', () => {
    assert.equal(linked.status, 0, linked.all);
    assert.match(linked.report, /1 fragments resolved \(\/fragments\/isi\)/);
    assert.ok(requests.includes('/fragments/isi.plain.html') && requests.includes('/modals/leave.plain.html'));
  });

  const model = (embeds) => ({
    _provenance: {}, metadata: { title: 'T', description: '', canonical: null, ogTags: {}, twitterTags: {}, jsonLd: [] },
    sections: [{ slot: 's01', visibleText: 'Transcript Hello there.', ctas: [], images: [] }],
    embeds, altFlags: [{ slot: 's01', src: 'https://src.test/a.png', alt: 'icon', reason: 'generic' }],
  });
  writeFileSync(join(scratch, 'model.json'), JSON.stringify(model([{ kind: 'iframe', slot: 's01', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', provider: 'youtube', id: 'dQw4w9WgXcQ', key: 'youtube:dQw4w9WgXcQ' }])));
  const cover = (rendered, name) => run('slot-coverage.mjs', ['--model', join(scratch, 'model.json'), '--rendered', `${origin}${rendered}`, '--report', join(scratch, `${name}.md`)])
    .then((r) => ({ ...r, report: readFileSync(join(scratch, `${name}.md`), 'utf8') }));
  const [embedOk, embedMissing] = await Promise.all([cover('/embed-ok', 'embed-ok'), cover('/embed-missing', 'embed-missing')]);

  await check('slot-coverage: the embed authored as a link counts, slot text in a closed <details> is present, and an alt flag is advisory (exit 0)', () => {
    assert.equal(embedOk.status, 0, embedOk.all);
    assert.match(embedOk.report, /- \[x\] s01 iframe youtube:dQw4w9WgXcQ/);
    assert.match(embedOk.report, /## alt-text \(advisory\) — 1 flagged/);
    assert.match(embedOk.stdout, /ADVISORY alt: s01 "icon" \(generic\)/);
    assert.match(embedOk.report, /1 details opened/);
  });

  await check('slot-coverage: an inventoried embed with no counterpart is a FAIL row', () => {
    assert.equal(embedMissing.status, 1, embedMissing.all);
    assert.match(embedMissing.report, /- \[ \] s01 iframe youtube:dQw4w9WgXcQ — no counterpart on the rendered page/);
    assert.match(embedMissing.stdout, /FAIL embeds: s01 iframe youtube:dQw4w9WgXcQ/);
  });
  server.close();
}

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
