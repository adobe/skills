#!/usr/bin/env node
// skills/deploy/scripts/test/content-count.test.mjs — the offline content count CLI: the fixture passes with its map
// and project (ledger identity, redirects); without them the declared exclusions and identities are MISSING; a real
// loss exits 1 and an `--exclude` (a stand-in for a map drop) clears it; bad input exits 2; `--help` in an empty dir;
// and a single-element-deletion sweep over the fixture document detects every unique deletion.
// Run: node plugins/stardust/skills/deploy/scripts/test/content-count.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countPage } from '../content-count.mjs';
import { offlineInventory, norm } from '../content-inventory.mjs';
import { parseHTML, qs, qsa, remove, serialize, cleanText, kids, attr } from '../../../migrate/scripts/encode/dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'content-count.mjs');
const FX = join(HERE, 'fixtures', 'content-count');
const CAPTURE = join(FX, 'capture.html'); const DOC = join(FX, 'doc.html'); const MAP = join(FX, 'vocabulary.json'); const PROJECT = join(FX, 'project');
const scratch = mkdtempSync(join(tmpdir(), 'content-count-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const cli = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 15000, ...opts });
const json = (r) => JSON.parse(r.stdout);
const full = ['--capture', CAPTURE, '--doc', DOC, '--map', MAP, '--project', PROJECT];

check('the fixture passes with its map and project: exit 0, every role counted, the declared exclusions reported', () => {
  const r = cli([...full, '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = json(r);
  assert.equal(out.pass, true); assert.deepEqual(out.missing, []);
  assert.deepEqual(Object.fromEntries(Object.entries(out.counts).map(([k, v]) => [k, v.capture])), { heading: 7, link: 10, image: 3, text: 16 });
  assert.deepEqual(Object.keys(out.excluded), ['chrome', 'control', 'drop', 'dynamics', 'rich-text-drop']);
  assert.deepEqual([...new Set(out.tolerated.map((t) => t.rule))].sort(), ['demoted', 'duplicate', 'relabelled', 'unlinked']);
  const text = cli(full);
  assert.equal(text.status, 0); assert.match(text.stdout, /^content-count: PASS — heading 7\/7 · link 10\/10 · image 3\/3 · text 16\/16; MISSING 0/);
});

check('without --project the ledger-only image and the redirected link are MISSING (exit 1)', () => {
  const r = cli(['--capture', CAPTURE, '--doc', DOC, '--map', MAP, '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(json(r).missing.map((m) => `${m.role}:${m.key}`), ['link:older gear list', 'image:img_2041']);
  assert.match(json(r).missing[0].reason, /href differs: the document has \/en\/guides\/gear-list/);
});

check('without --map the chrome, drop:, dynamics: and rich-text-drop content counts as required (exit 1)', () => {
  const r = cli(['--capture', CAPTURE, '--doc', DOC, '--project', PROJECT, '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(json(r).missing.map((m) => `${m.role}:${m.key}`).sort(), ['link:download the checklist (opens in a new tab)', 'link:post',
    'text:download the checklist (opens in a new tab) updated 3 days ago', 'text:live trail conditions: loading', 'text:share this guide', 'text:slide 1', 'text:slide 2']);
});

check('a real loss exits 1 and names the item; --exclude (a declared drop) clears it', () => {
  const lossy = join(scratch, 'lossy.html');
  writeFileSync(lossy, readFileSync(DOC, 'utf8').replace('<div><p>About eight kilometres, with two short climbs.</p></div>', ''));
  const r = cli(['--capture', CAPTURE, '--doc', lossy, '--map', MAP, '--project', PROJECT]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^content-count: FAIL/); assert.match(r.stdout, /MISSING text "About eight kilometres, with two short climbs\." \(absent\)/);
  assert.equal(cli(['--capture', CAPTURE, '--doc', lossy, '--map', MAP, '--project', PROJECT, '--exclude', '.faq-answer']).status, 0);
});

check('markers are the encoder\'s array of {sel, …}; the old object form is rejected (exit 2), as the encoder rejects it', () => {
  const v = JSON.parse(readFileSync(MAP, 'utf8'));
  assert.ok(Array.isArray(v.markers) && v.markers.every((m) => typeof m.sel === 'string'), 'the fixture map is in the encoder\'s form');
  const objectMap = join(scratch, 'vocabulary.json');
  writeFileSync(objectMap, JSON.stringify({ ...v, markers: Object.fromEntries(v.markers.map(({ sel, ...m }) => [sel, m])) }));
  const r = cli(['--capture', CAPTURE, '--doc', DOC, '--map', objectMap, '--project', PROJECT]);
  assert.equal(r.status, 2); assert.match(r.stderr, /markers: an ARRAY of \{ sel, kind, emitter, … \}/);
  writeFileSync(objectMap, JSON.stringify({ ...v, markers: [...v.markers, { selector: '.x', emitter: 'drop:x' }] }));
  assert.equal(cli(['--capture', CAPTURE, '--doc', DOC, '--map', objectMap]).status, 2, 'a marker without `sel`');
});

check('the media ledger as the encoder reads it: a failed upload never resolves; a #fragment is no part of the source', () => {
  const ledger = JSON.parse(readFileSync(join(PROJECT, 'stardust', 'deploy', 'media-ledger.json'), 'utf8'));
  const proj = join(scratch, 'project'); mkdirSync(join(proj, 'stardust', 'deploy'), { recursive: true });
  writeFileSync(join(proj, 'stardust', 'redirects.tsv'), readFileSync(join(PROJECT, 'stardust', 'redirects.tsv')));
  const write = (l) => writeFileSync(join(proj, 'stardust', 'deploy', 'media-ledger.json'), JSON.stringify(l));
  const forest = 'media/guides/forest-loop-0a1b2c3d.jpg';
  write({ ...ledger, [forest]: { ...ledger[forest], status: 'failed' } });
  const r = cli(['--capture', CAPTURE, '--doc', DOC, '--map', MAP, '--project', proj, '--json']);
  assert.equal(r.status, 1); assert.deepEqual(json(r).missing.map((m) => `${m.role}:${m.key}`), ['image:img_2041']);
  write({ ...ledger, [forest]: { ...ledger[forest], sources: ['https://www.example.com/assets/IMG_2041.jpg#zoom'] } });
  assert.equal(cli(['--capture', CAPTURE, '--doc', DOC, '--map', MAP, '--project', proj]).status, 0, 'a source with a #fragment still resolves');
});

check('relative URLs resolve against the page record\'s finalUrl, else its url (R15); --url overrides', () => {
  const cap = join(scratch, 'page.html'); writeFileSync(cap, readFileSync(CAPTURE));
  const final = 'https://www.example.com/en/guides/trail-running.html'; const other = 'https://old.example.net/guide.html';
  const run = (rec, ...extra) => { writeFileSync(join(scratch, 'page.json'), JSON.stringify(rec)); return cli(['--capture', cap, '--doc', DOC, '--map', MAP, '--project', PROJECT, ...extra]).status; };
  assert.equal(run({ url: other, finalUrl: final }), 0, 'finalUrl first');
  assert.equal(run({ url: other }), 1, 'the relative image no longer resolves through the ledger');
  assert.equal(run({ url: other }, '--url', final), 0);
});

check('bad input exits 2: no args, unreadable file, root not found, invalid map, invalid --url', () => {
  const bad = join(scratch, 'bad.json'); writeFileSync(bad, '{ "root": ');
  for (const [args, msg] of [
    [[], /--capture <html> --doc <html>/],
    [['--capture', CAPTURE, '--doc', join(scratch, 'nope.html')], /cannot read/],
    [['--capture', CAPTURE, '--doc', DOC, '--root', '.no-such-root'], /root not found: \.no-such-root/],
    [['--capture', CAPTURE, '--doc', DOC, '--map', bad], /cannot read the map/],
    [['--capture', CAPTURE, '--doc', DOC, '--url', 'not a url'], /--url/],
  ]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.join(' ')} → ${r.status}: ${r.stderr}`); assert.match(r.stderr, msg);
  }
});

check('--help in an empty dir: exit 0, usage on stdout, nothing written', () => {
  const empty = mkdtempSync(join(tmpdir(), 'content-count-help-'));
  const r = cli(['--help'], { cwd: empty });
  assert.equal(r.status, 0); assert.match(r.stdout, /content-count\.mjs/); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /Exit:/);
  assert.deepEqual(readdirSync(empty), []);
  rmSync(empty, { recursive: true });
});

// ------------------------------------------------------------------ recall: one synthetic encoder drop at a time
check('single-element-deletion sweep: every unique deletion from the fixture document is detected', () => {
  const ctx = { captureHtml: readFileSync(CAPTURE, 'utf8'), map: JSON.parse(readFileSync(MAP, 'utf8')), transform: JSON.parse(readFileSync(join(FX, 'transform.json'), 'utf8')),
    base: JSON.parse(readFileSync(join(FX, 'capture.json'), 'utf8')).url, ledger: JSON.parse(readFileSync(join(PROJECT, 'stardust', 'deploy', 'media-ledger.json'), 'utf8')),
    redirects: [['/en/old-gear-list.html', '/en/guides/gear-list']] };
  const docHtml = readFileSync(DOC, 'utf8');
  const missingOf = (html) => countPage({ ...ctx, docHtml: html }).missing.length;
  assert.equal(missingOf(docHtml), 0, 'the unmutated document passes');
  const inMeta = (n) => { for (let p = n; p; p = p.parent) if (/(^|\s)metadata(\s|$)/.test(attr(p, 'class') || '')) return true; return false; };
  const PICK = {
    p: (d) => qsa(d, 'main p').filter((n) => cleanText(n) && !qs(n, 'img')),
    li: (d) => qsa(d, 'main li'),
    heading: (d) => qsa(d, 'main h1, main h2, main h3, main h4, main h5, main h6'),
    img: (d) => qsa(d, 'main img'),
    link: (d) => qsa(d, 'main a[href]'),
    row: (d) => qsa(d, 'main > div > div[class]').flatMap((b) => kids(b)),
    truncate: (d) => qsa(d, 'main p').filter((n) => /[.!?]\s/.test(cleanText(n)) && !qs(n, 'a, img')),
  };
  const tally = {};
  for (const [kind, pick] of Object.entries(PICK)) {
    const n = pick(parseHTML(docHtml)).filter((x) => !inMeta(x)).length;
    for (let i = 0; i < n; i += 1) {
      const d = parseHTML(docHtml); const el = pick(d).filter((x) => !inMeta(x))[i];
      const label = cleanText(el) || attr(el, 'src');
      if (kind === 'link') el.parent.children.splice(el.parent.children.indexOf(el), 1, ...el.children.map((c) => Object.assign(c, { parent: el.parent })));
      else if (kind === 'truncate') { const t = el.children.find((c) => c.type === 'text' && /[.!?]\s/.test(c.text)); t.text = t.text.replace(/([.!?])\s[\s\S]*$/, '$1'); }
      else remove(el);
      const mutated = serialize(d);
      // unique = the removed identity occurs nowhere else in the mutated document (losing one copy is invisible by design)
      const left = offlineInventory(qs(parseHTML(mutated), 'main'), { base: ctx.base });
      const repeated = kind === 'img' ? left.items.some((x) => x.role === 'image' && x.ids.includes(attr(el, 'src')))
        : kind === 'link' ? left.items.some((x) => x.role === 'link' && x.raw === attr(el, 'href') && x.key === norm(cleanText(el)))
          : kind === 'truncate' ? false : (` ${left.joined} `).includes(` ${norm(cleanText(el))} `);
      const t = (tally[kind] ||= { n: 0, unique: 0, detected: 0, misses: [] });
      t.n += 1; if (repeated) continue;
      t.unique += 1;
      if (missingOf(mutated) > 0) t.detected += 1; else t.misses.push(label);
    }
  }
  const sum = Object.values(tally).reduce((a, t) => ({ n: a.n + t.n, unique: a.unique + t.unique, detected: a.detected + t.detected }), { n: 0, unique: 0, detected: 0 });
  console.log(`  ${Object.entries(tally).map(([k, t]) => `${k} ${t.detected}/${t.unique}`).join(' · ')} — ${sum.detected}/${sum.unique} unique deletions detected (${sum.n} in all)`);
  assert.ok(sum.unique >= 40, `sweep too small (${sum.unique})`);
  assert.deepEqual(Object.fromEntries(Object.entries(tally).map(([k, t]) => [k, t.misses])), Object.fromEntries(Object.keys(tally).map((k) => [k, []])));
});

rmSync(scratch, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
