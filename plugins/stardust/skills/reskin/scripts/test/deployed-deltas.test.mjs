#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-deltas.test.mjs — D4: the one declared-deltas mode (deployed/deltas.mjs)
// shared by dom-equality and slot-coverage (--deltas <json>). The pure parts (loadDeltas, applyText, compareImages,
// normalizeHref, metadataPlan) run anywhere; the --deltas flag's validation needs playwright to resolve, and the
// browser parts read the fake preview and source servers of fixtures/deployed/ with its deltas.json. Without
// playwright they print a skip line. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyText, applyTexts, compareImages, isBlocking, loadDeltas, metadataPlan, normalizeHref } from '../deployed/deltas.mjs';
import { fixturePath, loadSourceModel, startPreviewServer, startSourceServer } from './fixtures/deployed/servers.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATES = ['dom-equality', 'slot-coverage'];
const TOKEN = 'canary-123';
const scratch = mkdtempSync(join(tmpdir(), 'deployed-deltas-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const fixture = (name) => JSON.parse(readFileSync(fixturePath(name), 'utf8'));
const write = (name, body) => { const p = join(scratch, name); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); return p; };
const usageError = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected a UsageError'); };

// A gate run: { status, stdout, stderr, all }. DEPLOY_VERIFY_ORIGIN is pinned empty so an inherited one cannot turn a
// fake origin into an EDS host.
const run = (gate, args, { cwd = scratch, script = join(SCRIPTS, `${gate}.mjs`), env = {} } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

await check('applyText: literal, every occurrence, in file order; reports what applied (with counts) and what matched nothing', () => {
  const deltas = { text: { allow: [{ id: 'T1', from: '&amp;', to: '&', why: 'entity' }, { id: 'T2', from: 'zzz', to: '', why: 'x' }] } };
  assert.deepEqual(applyText('A &amp; B', deltas), { text: 'A & B', applied: [{ id: 'T1', count: 1 }], unused: ['T2'] });
  assert.deepEqual(applyText('&amp; and &amp; and &amp;', deltas), { text: '& and & and &', applied: [{ id: 'T1', count: 3 }], unused: ['T2'] });
  // a later entry reads the text the earlier ones left, and a `to` that holds its own `from` is not rescanned
  const chained = { text: { allow: [{ id: 'A', from: 'a', to: 'aa', why: 'w' }, { id: 'B', from: 'aa', to: 'b', why: 'w' }] } };
  assert.deepEqual(applyText('a', chained), { text: 'b', applied: [{ id: 'A', count: 1 }, { id: 'B', count: 1 }], unused: [] });
  // `from` is text, not a pattern
  assert.deepEqual(applyText('a.c abc', { text: { allow: [{ id: 'T', from: 'a.c', to: 'x', why: 'w' }] } }), { text: 'x abc', applied: [{ id: 'T', count: 1 }], unused: [] });
  assert.deepEqual(applyText('kept', {}), { text: 'kept', applied: [], unused: [] });
  assert.deepEqual(applyText('kept', { text: {} }), { text: 'kept', applied: [], unused: [] });
});

await check('applyTexts applies the same entries to several texts and counts each entry once across all of them', () => {
  const deltas = { text: { allow: [{ id: 'T1', from: '&amp;', to: '&', why: 'w' }, { id: 'T2', from: 'zzz', to: '', why: 'w' }] } };
  assert.deepEqual(applyTexts(['a &amp; b', 'none', '&amp;&amp;'], deltas), { texts: ['a & b', 'none', '&&'], applied: [{ id: 'T1', count: 3 }], unused: ['T2'] });
  assert.deepEqual(applyTexts([], deltas), { texts: [], applied: [], unused: ['T1', 'T2'] });
});

await check('loadDeltas lists every problem at once as a UsageError (exit 2): unknown keys, incomplete or duplicate entries, a wrong images or jsonLd value', () => {
  const bad = write('bad.json', {
    version: 1,
    text: { allow: [{ id: 'T1' }] },
    extra: 1,
  });
  const e = usageError(() => loadDeltas(bad));
  assert.equal(e.name, 'UsageError');
  assert.equal(e.code, 2);
  assert.match(e.message, /extra/);
  assert.match(e.message, /T1/);
  assert.match(e.message, /from/);
  assert.match(e.message, /why/);
  const many = write('many.json', {
    version: 1,
    blocking: 'no',
    text: { allow: [{ id: 'T1', from: 'a', to: 'b', why: 'w' }, { id: 'T1', from: 'c', to: 'd', why: 'w' }, { from: 'e', to: 'f', why: 'w' }, { id: 'T3', from: '', to: 'f', why: 'w', note: 1 }], more: 1 },
    images: 'count+alt',
    links: { localize: { sourceHost: 'https://src.test/' }, other: 1 },
    metadata: { ignore: ['canonical', 3], jsonLd: 'verbatim', absent: 'og:type', other: 1 },
    unknown: true,
  });
  const m = usageError(() => loadDeltas(many)).message;
  for (const needle of ['blocking', 'duplicate', 'T1', 'text.allow[2]', 'id', 'T3', 'from', 'note', 'text: unknown key "more"', 'images', 'count+alt+width', 'sourceHost', 'links: unknown key "other"', 'metadata.ignore', 'jsonLd', 'count-only', 'metadata.absent', 'metadata: unknown key "other"', 'unknown key "unknown"']) {
    assert.ok(m.includes(needle), `names ${needle}: ${m}`);
  }
  assert.ok(m.split('\n').length >= 12, `one line per problem: ${m}`);
  assert.match(usageError(() => loadDeltas(write('nover.json', { text: {} }))).message, /version/);
  assert.match(usageError(() => loadDeltas(write('notjson.json', '{ nope'))).message, /JSON/);
  assert.match(usageError(() => loadDeltas(join(scratch, 'no-such.json'))).message, /no-such\.json/);
  assert.match(usageError(() => loadDeltas(write('array.json', '[]'))).message, /object/);
});

await check('loadDeltas reads the fixture delta file, and a minimal one; blocking is true unless the file says false', () => {
  const d = loadDeltas(fixturePath('deltas.json'));
  assert.equal(d.version, 1);
  assert.equal(isBlocking(d), false);
  assert.equal(d.images, 'count+alt+width');
  assert.deepEqual(d.links.localize, { sourceHost: 'src.test' });
  assert.deepEqual(d.text.allow.map((a) => a.id), ['T1']);
  const minimal = loadDeltas(write('minimal.json', { version: 1 }));
  assert.equal(isBlocking(minimal), true, 'an absent key blocks');
  assert.equal(isBlocking({}), true);
  assert.equal(isBlocking({ blocking: false }), false);
  assert.deepEqual(applyText('x', minimal), { text: 'x', applied: [], unused: [] });
  assert.equal(minimal.images, null);
  assert.equal(minimal.links.localize, null);
  assert.equal(loadDeltas(write('to-less.json', { version: 1, text: { allow: [{ id: 'T1', from: 'x', why: 'w' }] } })).text.allow[0].to, '', 'a missing `to` deletes');
});

await check('compareImages count+alt+width: same count, same alt in order, every rendered width above 0', () => {
  const M = 'count+alt+width';
  assert.equal(compareImages([{ alt: 'a' }], [{ alt: 'a', width: 0 }], M).pass, false);
  assert.match(compareImages([{ alt: 'a' }], [{ alt: 'a', width: 0 }], M).detail, /width/);
  assert.equal(compareImages([{ alt: 'a' }], [{ alt: 'a', width: 320 }], M).pass, true);
  assert.equal(compareImages([], [], M).pass, true);
  const count = compareImages([{ alt: 'a' }], [{ alt: 'a', width: 1 }, { alt: 'b', width: 1 }], M);
  assert.equal(count.pass, false);
  assert.match(count.detail, /count: source 1, rendered 2/);
  const alt = compareImages([{ alt: 'a' }, { alt: 'b' }], [{ alt: 'b', width: 5 }, { alt: 'a', width: 5 }], M);
  assert.equal(alt.pass, false);
  assert.match(alt.detail, /\[0\] alt: source "a", rendered "b"/);
  assert.equal(compareImages([{ alt: 'a  b ' }], [{ alt: 'a b', width: 5 }], M).pass, true, 'whitespace is not an alt difference');
  assert.equal(compareImages([{ alt: '' }], [{ width: 5 }], M).pass, true, 'a missing alt is an empty one');
  assert.equal(compareImages([{ alt: 'a' }], [{ alt: 'a' }], M).pass, false, 'an unmeasured width is not above 0');
  assert.throws(() => compareImages([], [], 'src+path'), /count\+alt\+width/);
});

await check('normalizeHref: a source-host href becomes the rendered origin plus its delivered URL; anything else is returned as it came', () => {
  const o = { sourceHost: 'src.test', renderedOrigin: 'https://b--r--o.aem.page' };
  assert.equal(normalizeHref('https://src.test/about/', o), 'https://b--r--o.aem.page/about/');
  assert.equal(normalizeHref('https://src.test/start', o), 'https://b--r--o.aem.page/start');
  assert.equal(normalizeHref('https://src.test/', o), 'https://b--r--o.aem.page/');
  assert.equal(normalizeHref('https://src.test/About Us/index.html', o), 'https://b--r--o.aem.page/about-us/', 'deploy\'s delivered path');
  assert.equal(normalizeHref('http://www.src.test/a/b?x=1#top', o), 'https://b--r--o.aem.page/a/b?x=1#top', 'www, the scheme and the query and fragment as localize-links does');
  assert.equal(normalizeHref('//src.test/a', o), 'https://b--r--o.aem.page/a', 'protocol-relative');
  assert.equal(normalizeHref('https://SRC.test/a', o), 'https://b--r--o.aem.page/a', 'host case');
  assert.equal(normalizeHref('https://b--r--o.aem.page/', { ...o, renderedOrigin: 'https://b--r--o.aem.page/' }), 'https://b--r--o.aem.page/', 'a trailing slash on the origin does not double');
  for (const href of ['https://example.test/try', 'https://src.test.example.test/x', '/about/', 'about', 'mailto:a@src.test', '#top', '']) assert.equal(normalizeHref(href, o), href, href);
  assert.equal(normalizeHref('http://127.0.0.1:4000/a', { sourceHost: '127.0.0.1:4000', renderedOrigin: 'http://127.0.0.1:5000' }), 'http://127.0.0.1:5000/a', 'the port is part of the host');
  assert.equal(normalizeHref('http://127.0.0.1:4001/a', { sourceHost: '127.0.0.1:4000', renderedOrigin: 'http://127.0.0.1:5000' }), 'http://127.0.0.1:4001/a');
});

await check('metadataPlan: the keys to skip, the jsonLd mode (count-only unless set) and the keys the page must not carry', () => {
  const plan = metadataPlan(loadDeltas(fixturePath('deltas.json')));
  assert.deepEqual(plan, { ignore: new Set(['canonical', 'og:url', 'og:image', 'twitter:image']), jsonLd: 'count-only', absent: new Set() });
  assert.deepEqual(metadataPlan({ metadata: { jsonLd: 'ignore', absent: ['og:type'] } }), { ignore: new Set(), jsonLd: 'ignore', absent: new Set(['og:type']) });
  assert.deepEqual(metadataPlan({}), { ignore: new Set(), jsonLd: 'count-only', absent: new Set() });
});

await check('deltas.mjs resolves eds-path.mjs in both layouts and names where it looked when it is missing', async () => {
  const deploy = join(SCRIPTS, '..', '..', 'deploy', 'scripts', 'eds-path.mjs');
  const plugin = await import('../deployed/deltas.mjs');
  assert.equal(plugin.normalizeHref('https://src.test/a/', { sourceHost: 'src.test', renderedOrigin: 'http://x' }), 'http://x/a/');
  const dir = join(scratch, 'copy');
  const reskin = join(dir, 'stardust', 'scripts', 'reskin');
  mkdirSync(join(reskin, 'deployed'), { recursive: true });
  mkdirSync(join(reskin, 'figma'), { recursive: true });
  cpSync(join(SCRIPTS, 'deployed', 'deltas.mjs'), join(reskin, 'deployed', 'deltas.mjs'));
  cpSync(join(SCRIPTS, 'figma', 'errors.mjs'), join(reskin, 'figma', 'errors.mjs'));
  const bare = await import(`${join(reskin, 'deployed', 'deltas.mjs')}?bare`);
  assert.deepEqual(bare.applyText('a', {}), { text: 'a', applied: [], unused: [] }, 'everything that does not need eds-path.mjs still works');
  const e = usageError(() => bare.normalizeHref('https://src.test/a', { sourceHost: 'src.test', renderedOrigin: 'http://x' }));
  assert.equal(e.name, 'UsageError');
  assert.match(e.message, /eds-path\.mjs not found/);
  assert.match(e.message, /\.\.\/\.\.\/\.\.\/deploy\/scripts\//);
  assert.match(e.message, /\.\.\/\.\.\/deploy\//);
  assert.equal(bare.normalizeHref('https://example.test/a', { sourceHost: 'src.test', renderedOrigin: 'http://x' }), 'https://example.test/a', 'a link that is not localized never needs it');
  mkdirSync(join(dir, 'stardust', 'scripts', 'deploy'), { recursive: true });
  copyFileSync(deploy, join(dir, 'stardust', 'scripts', 'deploy', 'eds-path.mjs'));
  const copy = await import(`${join(reskin, 'deployed', 'deltas.mjs')}?copy`);
  assert.equal(copy.normalizeHref('https://src.test/a/', { sourceHost: 'src.test', renderedOrigin: 'http://x' }), 'http://x/a/');
});

let pw = null;
try { pw = await import('playwright'); } catch { /* no browser here */ }
if (!pw) console.log('- gate checks skipped: playwright does not resolve from here');
else {
  await check('--help names --deltas from a directory holding only the gate; --deltas takes a value, never a following --flag, and a bad delta file exits 2 listing every problem before anything is measured', async () => {
    for (const gate of GATES) {
      const dir = mkdtempSync(join(scratch, `help-${gate}-`));
      copyFileSync(join(SCRIPTS, `${gate}.mjs`), join(dir, `${gate}.mjs`));
      const help = await run(gate, ['--help'], { cwd: dir, script: join(dir, `${gate}.mjs`) });
      assert.equal(help.status, 0, `${gate}: ${help.stderr}`);
      assert.match(help.stdout, /--deltas <json>/, gate);
      assert.deepEqual(readdirSync(dir), [`${gate}.mjs`], `${gate} wrote nothing`);
    }
    const base = { 'dom-equality': ['--source', 'a.html', '--rendered', 'b.html', '--report', 'r.md'], 'slot-coverage': ['--model', 'm.json', '--rendered', 'b.html'] };
    const bad = write('invalid-deltas.json', { version: 1, text: { allow: [{ id: 'T1' }] }, extra: 1 });
    for (const gate of GATES) {
      for (const extra of [['--deltas'], ['--deltas', '--headed'], ['--deltas', '']]) {
        const r = await run(gate, [...base[gate], ...extra]);
        assert.equal(r.status, 2, `${gate} ${extra.join(' ')}: ${r.all}`);
        assert.match(r.stderr, /--deltas needs a value/, `${gate} ${JSON.stringify(extra)}`);
      }
      const r = await run(gate, [...base[gate], '--deltas', bad]);
      assert.equal(r.status, 2, `${gate}: ${r.all}`);
      for (const needle of ['extra', 'T1', 'from', 'why']) assert.ok(r.stderr.includes(needle), `${gate} names ${needle}: ${r.stderr}`);
      const gone = await run(gate, [...base[gate], '--deltas', join(scratch, 'no-such.json')]);
      assert.equal(gone.status, 2, `${gate}: ${gone.all}`);
      assert.match(gone.stderr, /no-such\.json/, gate);
    }
  });

  // The preview serves home.html at /ns/home; the source server serves source.html at "/". Fixture facts are in
  // fixtures/deployed/servers.mjs: eight of slot-coverage's 18 checks differ, and T1 is the one text delta.
  const EIGHT = [
    's01 CTA "Get started" -> https://src.test/start',
    's01 CTA "Learn more" -> https://src.test/about/',
    's01 image …src.test/images/hero.png',
    's02 text present',
    'canonical', 'og og:url', 'og og:image', 'tw twitter:image',
  ];
  const failures = (stdout) => stdout.split('\n').filter((l) => l.startsWith('  FAIL ')).map((l) => l.replace(/^ {2}FAIL [^:]+: /, '').split(' — ')[0]);
  const EDS = ['--wait-eds', '--eds-timeout', '10000'];
  const fixtureDeltas = fixture('deltas.json');
  const variant = (name, change) => write(name, change(structuredClone(fixtureDeltas)));
  // Two variants of the preview page for the image checks: a stray image after everything the model owns, and a
  // display:none image plus a 1×1 tracking pixel ahead of the real one.
  const homeHtml = readFileSync(fixturePath('home.html'), 'utf8');
  const HERO_P = '<p><picture><img alt="A calm board of three planned tasks" src="./media_5f2c0a9d4b7e1a63.png?width=750&amp;format=png&amp;optimize=medium" width="320" height="180"></picture></p>';
  assert.ok(homeHtml.includes(HERO_P) && homeHtml.includes('</main>'), 'home.html still has the hero paragraph and </main>');
  const trailingPage = write('trailing.html', homeHtml.replace('</main>', '<div class="section" data-section-status="initialized"><p><picture><img alt="A stray extra picture" src="./media_aaaa1111.png" width="100" height="60"></picture></p></div>\n</main>'));
  const hiddenPage = write('hidden.html', homeHtml.replace(HERO_P, `<p><img alt="Never shown" src="./media_bbbb2222.png" width="100" height="60" style="display:none"></p><p><img alt="" src="./media_cccc3333.png" width="1" height="1"></p>${HERO_P}`));
  const preview = await startPreviewServer({ pages: { '/ns/home': 'home.html', '/ns/trailing': trailingPage, '/ns/hidden': hiddenPage } });
  const source = await startSourceServer();
  const url = `${preview.origin}/ns/home`;
  const model = write('model.json', loadSourceModel(source.origin));
  const slot = (extra = [], name = 'sc') => run('slot-coverage', ['--model', model, '--rendered', url, '--report', join(scratch, `${name}.md`), ...EDS, ...extra]);
  const dom = (extra = [], name = 'de', src = `${source.origin}/`) => run('dom-equality', ['--source', src, '--rendered', url, '--report', join(scratch, `${name}.md`), ...EDS, ...extra]);
  const report = (name) => readFileSync(join(scratch, `${name}.md`), 'utf8');

  try {
    await check('slot-coverage without --deltas fails exactly on the eight documented differences, in the unchanged format', async () => {
      const r = await slot([], 'sc-bare');
      assert.equal(r.status, 1, r.all);
      assert.deepEqual(failures(r.stdout), EIGHT);
      assert.match(r.stdout, /^\[slot-coverage\] FAIL — 10\/18 checks — report: .*sc-bare\.md\n {2}FAIL slot-coverage: s01 CTA "Get started" -> https:\/\/src\.test\/start\n/);
      assert.ok(!/ADVISORY|WARNING|deltas applied|ignored by delta/.test(r.all), 'no deltas, no word about them');
      assert.ok(!/Declared deltas/.test(report('sc-bare')));
    });

    await check('slot-coverage --deltas fixtures/deployed/deltas.json passes on /ns/home with no unused delta, and the report declares what applied and what it ignored', async () => {
      const r = await slot(['--deltas', fixturePath('deltas.json')], 'sc-fixture');
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /^\[slot-coverage\] PASS — (\d+)\/\1 checks/);
      assert.ok(!/ADVISORY|WARNING|FAIL/.test(r.stdout), r.stdout);
      const md = report('sc-fixture');
      assert.match(md, /\*\*Overall: PASS\*\*/);
      assert.match(md, /## Declared deltas/);
      assert.match(md, /T1 ×1/);
      assert.match(md, /Ignored by delta[^\n]*canonical, og:url, og:image, twitter:image/);
      assert.ok(!/Unused/.test(md));
      assert.ok(!md.includes('og:url —') && !/\[[ x]\] (canonical|og og:url|og og:image|tw twitter:image)/.test(md), 'the ignored checks are not run');
      assert.match(md, /\[x\] s01 images \(count\+alt\+width\)/);
      assert.match(md, /\[x\] images total \(count\+alt\+width\) — 1 image\(s\)/);
      assert.match(md, /\[x\] s01 image "A calm board of three planned tasks" painted/);
    });

    await check('with blocking true a failed check exits 1 and prints no ADVISORY; with blocking false the same failure exits 0 and stdout carries ADVISORY (deltas.blocking false)', async () => {
      const noIgnore = (d) => { d.metadata.ignore = ['canonical']; return d; };
      const [hard, soft] = await Promise.all([
        slot(['--deltas', variant('hard.json', (d) => ({ ...noIgnore(d), blocking: true }))], 'sc-hard'),
        slot(['--deltas', variant('soft.json', noIgnore)], 'sc-soft'),
      ]);
      assert.equal(hard.status, 1, hard.all);
      assert.deepEqual(failures(hard.stdout), ['og og:url', 'og og:image', 'tw twitter:image']);
      assert.ok(!/ADVISORY/.test(hard.stdout));
      assert.equal(soft.status, 0, soft.all);
      assert.deepEqual(failures(soft.stdout), ['og og:url', 'og og:image', 'tw twitter:image'], 'the failures are still reported');
      assert.match(soft.stdout, /ADVISORY \(deltas\.blocking false\)/);
      assert.match(report('sc-soft'), /\*\*Overall: FAIL\*\*/);
      assert.match(report('sc-soft'), /ADVISORY \(deltas\.blocking false\)/);
    });

    await check('an allow entry that matches nothing is "unused": a stdout warning line and a report section, never silently dropped', async () => {
      const deltas = variant('unused.json', (d) => { d.blocking = true; d.text.allow.push({ id: 'T2', from: 'zzz', to: '', why: 'a delta nobody needs' }); return d; });
      const [sc, de] = await Promise.all([slot(['--deltas', deltas], 'sc-unused'), dom(['--deltas', deltas], 'de-unused')]);
      for (const [gate, r, name] of [['slot-coverage', sc, 'sc-unused'], ['dom-equality', de, 'de-unused']]) {
        assert.equal(r.status, 0, `${gate}: ${r.all}`);
        assert.match(r.stdout, /WARNING unused delta T2: "zzz" matched nothing/, gate);
        const md = report(name);
        assert.match(md, /Unused[^\n]*\n\s+- T2: "zzz"/, gate);
        assert.match(md, /T1 ×1/, `${gate} still reports T1 applied once`);
      }
    });

    await check('a text.allow entry also applies to a CTA text: the one use of an entry inside a CTA passes the CTA and is not "unused"; without the entry the CTA fails', async () => {
      // the source's CTA carries a visually-hidden suffix the preview drops; the slot text does not hold it
      const hidden = loadSourceModel(source.origin);
      hidden.sections[0].ctas[0].text = 'Get started Opens in new tab';
      const hiddenModel = write('hidden-cta-model.json', hidden);
      const deltas = variant('hidden-cta.json', (d) => { d.blocking = true; d.text.allow.push({ id: 'T3', from: ' Opens in new tab', to: '', why: 'a visually-hidden label the preview does not carry' }); return d; });
      const withEntry = await run('slot-coverage', ['--model', hiddenModel, '--rendered', url, '--report', join(scratch, 'sc-cta-text.md'), ...EDS, '--deltas', deltas]);
      assert.equal(withEntry.status, 0, withEntry.all);
      assert.ok(!/WARNING|FAIL/.test(withEntry.stdout), withEntry.stdout);
      assert.match(withEntry.stdout, /deltas applied: T1 ×1, T3 ×1/);
      assert.ok(!/Unused/.test(report('sc-cta-text')), 'T3 is used, by the CTA alone');
      assert.match(report('sc-cta-text'), /T3 ×1: " Opens in new tab" → ""/);
      assert.match(report('sc-cta-text'), /\[x\] s01 CTA "Get started Opens in new tab" -> https:\/\/src\.test\/start/, 'the check keeps the model\'s own CTA text in its name');
      const without = await run('slot-coverage', ['--model', hiddenModel, '--rendered', url, '--report', join(scratch, 'sc-cta-bare.md'), ...EDS, '--deltas', variant('hidden-cta-none.json', (d) => { d.blocking = true; return d; })]);
      assert.equal(without.status, 1, without.all);
      assert.deepEqual(failures(without.stdout), ['s01 CTA "Get started Opens in new tab" -> https://src.test/start']);
    });

    await check('without links.localize the localized CTAs fail; a CTA also matches its model href as it stands', async () => {
      const r = await slot(['--deltas', variant('nolinks.json', (d) => { delete d.links; d.blocking = true; return d; })], 'sc-nolinks');
      assert.equal(r.status, 1, r.all);
      assert.deepEqual(failures(r.stdout), ['s01 CTA "Get started" -> https://src.test/start', 's01 CTA "Learn more" -> https://src.test/about/']);
    });

    await check('metadata.absent asserts a key is NOT carried (and stands in for its verbatim check); jsonLd "ignore" skips the count', async () => {
      const [pass, fail, noLd] = await Promise.all([
        slot(['--deltas', variant('abs-ok.json', (d) => { d.blocking = true; d.metadata.absent = ['robots', 'og:image:alt']; return d; })], 'sc-abs-ok'),
        slot(['--deltas', variant('abs-bad.json', (d) => { d.blocking = true; d.metadata.absent = ['og:type', 'twitter:card']; return d; })], 'sc-abs-bad'),
        slot(['--deltas', variant('nold.json', (d) => { d.blocking = true; d.metadata.jsonLd = 'ignore'; return d; })], 'sc-nold'),
      ]);
      assert.equal(pass.status, 0, pass.all);
      assert.match(report('sc-abs-ok'), /\[x\] absent robots/);
      assert.equal(fail.status, 1, fail.all);
      assert.deepEqual(failures(fail.stdout), ['absent og:type', 'absent twitter:card']);
      assert.equal(noLd.status, 0, noLd.all);
      assert.ok(!/jsonLd block count/.test(report('sc-nold')), 'the count is not checked');
      assert.match(report('sc-nold'), /Ignored by delta[^\n]*jsonLd/);
      assert.match(report('sc-fixture'), /\[x\] jsonLd block count/, 'count-only keeps the count check');
    });

    await check('an ignore key that names no metadata check is unused too', async () => {
      const r = await slot(['--deltas', variant('ignore-typo.json', (d) => { d.blocking = true; d.metadata.ignore.push('og:imge'); return d; })], 'sc-typo');
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /WARNING unused delta metadata\.ignore "og:imge"/);
      assert.match(report('sc-typo'), /Unused[^\n]*\n\s+- metadata\.ignore "og:imge"/);
    });

    await check('slot images compare per slot by count and alt: a changed alt and a missing image fail the slot, naming it', async () => {
      const altered = loadSourceModel(source.origin);
      altered.sections[0].images[0].alt = 'A different board';
      const extra = loadSourceModel(source.origin);
      extra.sections[1].images = [{ currentSrc: 'https://src.test/images/two.png', alt: 'Another picture', w: 100, h: 100 }];
      const [alt, miss] = await Promise.all([
        run('slot-coverage', ['--model', write('alt-model.json', altered), '--rendered', url, '--report', join(scratch, 'sc-alt.md'), ...EDS, '--deltas', variant('hard2.json', (d) => { d.blocking = true; return d; })]),
        run('slot-coverage', ['--model', write('miss-model.json', extra), '--rendered', url, '--report', join(scratch, 'sc-miss.md'), ...EDS, '--deltas', variant('hard3.json', (d) => { d.blocking = true; return d; })]),
      ]);
      assert.equal(alt.status, 1, alt.all);
      assert.deepEqual(failures(alt.stdout), ['s01 images (count+alt+width)', 'images total (count+alt+width)'], 'the slot, then the total');
      assert.match(alt.stdout, /\[0\] alt: source "A different board", rendered "A calm board of three planned tasks"/);
      assert.equal(miss.status, 1, miss.all);
      assert.deepEqual(failures(miss.stdout), ['s02 images (count+alt+width)', 'images total (count+alt+width)']);
    });

    await check('an extra rendered image after the last owned one fails the total check, and only it: the per-slot checks cannot see past the model\'s images', async () => {
      const r = await run('slot-coverage', ['--model', model, '--rendered', `${preview.origin}/ns/trailing`, '--report', join(scratch, 'sc-trailing.md'), ...EDS, '--deltas', variant('hard-trailing.json', (d) => { d.blocking = true; return d; })]);
      assert.equal(r.status, 1, r.all);
      assert.deepEqual(failures(r.stdout), ['images total (count+alt+width)']);
      assert.match(r.stdout, /count: source 1, rendered 2/);
      assert.match(report('sc-trailing'), /\[ \] images total \(count\+alt\+width\)/);
      assert.match(report('sc-trailing'), /\[x\] s01 images \(count\+alt\+width\)/);
    });

    await check('the images the checks count are the visible ones (IMG_VISIBLE, as the model capture and dom-equality see them): a display:none image and a 1px pixel in main shift nothing', async () => {
      const r = await run('slot-coverage', ['--model', model, '--rendered', `${preview.origin}/ns/hidden`, '--report', join(scratch, 'sc-hidden.md'), ...EDS, '--deltas', variant('hard-hidden.json', (d) => { d.blocking = true; return d; })]);
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(failures(r.stdout), []);
      const md = report('sc-hidden');
      assert.match(md, /\[x\] s01 images \(count\+alt\+width\) — 1 image\(s\)/);
      assert.match(md, /\[x\] images total \(count\+alt\+width\) — 1 image\(s\)/);
      assert.ok(!md.includes('Never shown'), 'a hidden image is not measured, nor painted');
      const bare = await run('slot-coverage', ['--model', model, '--rendered', `${preview.origin}/ns/hidden`, '--report', join(scratch, 'sc-hidden-bare.md'), ...EDS]);
      assert.ok(!/images total/.test(bare.stdout + report('sc-hidden-bare')), 'without --deltas nothing about the total');
    });

    await check('attribution to a slot is positional by cumulative count, so an image the model puts in s02 but the page shows in s01 is NOT detected (a stated limit; the total still sees every image)', async () => {
      const moved = loadSourceModel(source.origin);
      moved.sections[1].images = moved.sections[0].images;
      moved.sections[0].images = [];
      const r = await run('slot-coverage', ['--model', write('moved-model.json', moved), '--rendered', url, '--report', join(scratch, 'sc-moved.md'), ...EDS, '--deltas', variant('hard-moved.json', (d) => { d.blocking = true; return d; })]);
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(failures(r.stdout), []);
      const md = report('sc-moved');
      assert.match(md, /\[x\] images total \(count\+alt\+width\)/);
      assert.match(md, /positional by cumulative count[^\n]*not detected/, 'the report says what the check cannot see');
    });

    await check('dom-equality without --deltas fails on the text and on the images; with deltas.json it passes (T1 applied once, count+alt+width)', async () => {
      const [bare, withDeltas] = await Promise.all([dom([], 'de-bare'), dom(['--deltas', fixturePath('deltas.json')], 'de-fixture')]);
      assert.equal(bare.status, 1, bare.all);
      assert.match(report('de-bare'), /Visible text[^\n]*FAIL/);
      assert.match(report('de-bare'), /Visible image srcs \(ordered\)[^\n]*FAIL/);
      assert.ok(!bare.stdout.trim(), 'no deltas, nothing on stdout');
      assert.equal(withDeltas.status, 0, withDeltas.all);
      assert.match(withDeltas.stderr, /PASS — report/);
      assert.ok(!/ADVISORY|WARNING/.test(withDeltas.stdout), withDeltas.stdout);
      const md = report('de-fixture');
      assert.match(md, /Visible text[^\n]*PASS/);
      assert.match(md, /Visible images \(count\+alt\+width\)[^\n]*PASS/);
      assert.match(md, /## Declared deltas/);
      assert.match(md, /T1 ×1: "&amp;" → "&"/);
      assert.ok(!/Unused/.test(md));
    });

    await check('dom-equality: blocking false with a text difference exits 0 and prints ADVISORY; blocking true exits 1', async () => {
      const dropT1 = (d) => { d.text.allow = []; return d; };
      const [soft, hard] = await Promise.all([
        dom(['--deltas', variant('de-soft.json', dropT1)], 'de-soft'),
        dom(['--deltas', variant('de-hard.json', (d) => ({ ...dropT1(d), blocking: true }))], 'de-hard'),
      ]);
      assert.equal(soft.status, 0, soft.all);
      assert.match(soft.stdout, /ADVISORY \(deltas\.blocking false\)/);
      assert.match(soft.stderr, /FAIL — report/);
      assert.match(report('de-soft'), /\*\*Overall: FAIL\*\*/);
      assert.match(report('de-soft'), /Text divergence/);
      assert.equal(hard.status, 1, hard.all);
      assert.ok(!/ADVISORY/.test(hard.stdout));
    });

    await check('dom-equality compares images by count, alt and rendered width under deltas: a different alt fails, naming the index', async () => {
      const altered = write('alt-source.html', readFileSync(fixturePath('source.html'), 'utf8').replace('A calm board of three planned tasks', 'A different board').replace('/images/hero.png', 'about:blank'));
      const r = await dom(['--deltas', variant('de-alt.json', (d) => ({ ...d, blocking: true }))], 'de-alt', altered);
      assert.equal(r.status, 1, r.all);
      const md = report('de-alt');
      assert.match(md, /Visible images \(count\+alt\+width\)[^\n]*FAIL/);
      assert.match(md, /\[0\] alt: source "A different board", rendered "A calm board of three planned tasks"/);
      assert.match(md, /Visible text[^\n]*PASS/, 'the text still matches after T1');
    });

    await check('a delta file never puts the site token on stdout, stderr or in a report, whatever its entries say', async () => {
      const protectedPreview = await startPreviewServer({ token: TOKEN });
      try {
        const protectedUrl = `${protectedPreview.origin}/ns/home?t=${TOKEN}`;
        const deltas = variant('leak.json', (d) => { d.text.allow.push({ id: 'T9', from: `${TOKEN}-never`, to: '', why: `nobody typed ${TOKEN}` }); return d; });
        const auth = ['--auth-header', `token ${TOKEN}`, ...EDS, '--deltas', deltas];
        const [sc, de] = await Promise.all([
          run('slot-coverage', ['--model', model, '--rendered', protectedUrl, '--report', join(scratch, 'leak-sc.md'), ...auth]),
          run('dom-equality', ['--source', `${source.origin}/`, '--rendered', protectedUrl, '--report', join(scratch, 'leak-de.md'), ...auth]),
        ]);
        for (const [gate, r] of [['slot-coverage', sc], ['dom-equality', de]]) {
          assert.equal(r.status, 0, `${gate}: ${r.all}`);
          assert.match(r.stdout, /WARNING unused delta T9: "\[redacted\]-never" matched nothing \(nobody typed \[redacted\]\)/, gate);
        }
        for (const text of [sc.all, de.all, report('leak-sc'), report('leak-de')]) {
          assert.ok(!text.includes(TOKEN), `the token leaked: ${text.slice(Math.max(0, text.indexOf(TOKEN) - 40), text.indexOf(TOKEN) + 40)}`);
        }
        assert.ok(report('leak-sc').includes('[redacted]-never'), 'the report shows the unused entry, redacted');
      } finally { await protectedPreview.close(); }
    });
  } finally { await preview.close(); await source.close(); }
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
