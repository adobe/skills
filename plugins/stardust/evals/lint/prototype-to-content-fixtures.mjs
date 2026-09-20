#!/usr/bin/env node
// Guard: skills/deploy/scripts/prototype-to-content.mjs — the Step 9 transcriber keeps its
// emitter contract (reference/content-page-scaffold.md § Generator contract).
//
// Why: four field projects each wrote a throwaway prototype → content generator; the defects
// were a bespoke section silently flattened to prose, a regenerate that overwrote hand edits,
// and a per-page `breadcrumbs` block. Each is pinned here against small fixtures
// (fixtures/prototype-to-content/): the BLOCKING branches (unmapped → exit 2, hand edit → exit 2,
// 0 sections / no <h1> → exit 2) write nothing; the passing branch lints clean.
//
// Pure cases (no browser):
//   landing + schema → exit 0; davids-model-lint exit 0; every schema item text appears exactly
//     once; one `plans` row per repeat unit in schema order; CTAs <p><strong><a>/<em><a>;
//     metadata block first in the first section, next to the <h1>; ./x.html → /x (D9);
//     re-run byte-identical; ledger row {sections, blocks, sha, script};
//   bespoke split hero → exit 2, nothing written, `unmapped:` names the section and the fix;
//     `--map hero=block:hero` → exit 0, one row, two cells, lint exit 0;
//   0 sections / no <h1> → exit 2, nothing written;  --dry-run → nothing written, no ledger;
//   patches/<slug>.json replace op applied last;
//   hand edit after generation → exit 2 naming the path (NEGATIVE: the energy-utility overwrite), --force → 0;
//   --thin on a migrated render (sr-only <h1> twin, --drop twin, table, empty shell, leading link
//     list, second <h1>, form) → exit 0, `table` block, no `breadcrumbs` block, each drop logged
//     with its reason, lint exit 0;
//   CLI: --help lists every documented flag; `--out --thin` refused; unknown arg exit 1;
//   NEGATIVE ledger key: `content/x.html`, `./content/x.html` and `../content/x.html` from a
//     sub-directory are ONE row — no false `hand-edited` block on a respelt --out;
//   NEGATIVE positional pairing: a schema whose section names all differ → exit 2, every section
//     `unmapped` naming the same-position schema name, nothing written (never paired by index);
//   NEGATIVE exit class: Playwright unresolvable (bare cwd, fake `npm`) → exit 2, nothing written;
//     the header's exit-1 line does not claim it.
// Browser case (Playwright via STARDUST_PW_ROOT or cwd; SKIP line otherwise): `--render --thin`
//   on the ew-editability prototype → exit 0 with the page's <h1>.
// Usage: node plugins/stardust/evals/lint/prototype-to-content-fixtures.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pwRoot } from './lib/_browser.mjs';

const HERE = import.meta.dirname;
const SCRIPTS = join(HERE, '..', '..', 'skills', 'deploy', 'scripts');
const BIN = join(SCRIPTS, 'prototype-to-content.mjs');
const LINT = join(SCRIPTS, 'davids-model-lint.mjs');
const FIX = join(HERE, 'fixtures', 'prototype-to-content');
const tmp = mkdtempSync(join(tmpdir(), 'p2c-'));
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });
const lint = (file) => spawnSync(process.execPath, [LINT, file], { encoding: 'utf8' });
const count = (hay, needle) => hay.split(needle).length - 1;
let cases = 0;
const t = (name, fn) => { try { fn(); cases += 1; } catch (e) { console.error(`FAIL ${name}\n${e.message}`); process.exitCode = 1; } };

try {
  const out = join(tmp, 'content', 'landing.html');
  const ledger = join(tmp, 'transcribe.json');
  const nopatch = join(tmp, 'no-patches');
  const base = ['--out', out, '--ledger', ledger, '--patches', nopatch];
  const schema = JSON.parse(readFileSync(join(FIX, 'landing.schema.json'), 'utf8'));

  t('landing + schema: exit 0, lint 0, every schema item once, rows in schema order, CTAs, metadata, D9, idempotent, ledger', () => {
    const r = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), ...base]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /plans\s+block:plans rows=3/);
    const html = readFileSync(out, 'utf8');
    const body = html.replace(/<div class="metadata">[\s\S]*?\n    <\/div>\n    <\/div>\n/, ''); // Title/Description mirror the <h1> and lead by design
    assert.ok(body.length < html.length, 'metadata block stripped');
    for (const sec of schema.sections) for (const it of sec.items) assert.equal(count(body, `>${it.text.replace(/—/g, '&mdash;')}<`), 1, `"${it.text}" appears once as element text`);
    const rows = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    assert.deepEqual(rows, ['Essential', 'Standard', 'Complete'], 'one row per unit, schema order');
    assert.equal(count(html, '<div class="plans">'), 1);
    assert.match(html, /<p><strong><a href="\/quote">Get a quote<\/a><\/strong><\/p>/);
    assert.match(html, /<p><em><a href="\/plans">Compare the plans<\/a><\/em><\/p>/, 'secondary CTA as <em>, ./plans/index.html → /plans');
    assert.match(html, /href="\/about"/, './about.html → /about (D9)');
    const first = html.slice(html.indexOf('<main>'), html.indexOf('<h1>'));
    assert.ok(first.includes('<div class="metadata">') && first.split('\n').filter((l) => l === '  <div>').length === 1, 'metadata block opens the first section, same section as the <h1>');
    assert.match(html, /<div>Title<\/div>\s*<div>Cover that reads like a promise, not a policy<\/div>/);
    assert.ok(!html.includes('<head>') && !html.includes('<script') && !html.includes('<style'), 'body fragment only');
    const l = lint(out); assert.equal(l.status, 0, l.stdout);
    const row = JSON.parse(readFileSync(ledger, 'utf8')).pages[out];
    assert.deepEqual(row.blocks, ['plans']); assert.equal(row.script, 'skills/deploy/scripts/prototype-to-content.mjs'); assert.equal(row.sections.length, 3); assert.match(row.sha, /^[0-9a-f]{64}$/);
    const again = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), ...base]);
    assert.equal(again.status, 0, again.stdout);
    assert.equal(readFileSync(out, 'utf8'), html, 'byte-identical on re-run');
  });

  t('bespoke split hero: exit 2, nothing written, unmapped line; --map hero=block:hero → exit 0, one row of two cells, lint 0', () => {
    const o = join(tmp, 'content', 'bespoke.html');
    const r = run([join(FIX, 'bespoke.html'), '--schema', join(FIX, 'bespoke.schema.json'), '--out', o, '--ledger', ledger, '--patches', nopatch]);
    assert.equal(r.status, 2, r.stdout);
    assert.ok(!existsSync(o), 'nothing written');
    assert.match(r.stdout, /unmapped: hero on .*bespoke\.html \(layout wrappers .*\) — --map hero=block:<name>\|default\|drop:<reason>/);
    assert.match(r.stdout, /^blocked: unmapped: hero/m);
    const m = run([join(FIX, 'bespoke.html'), '--schema', join(FIX, 'bespoke.schema.json'), '--out', o, '--ledger', ledger, '--patches', nopatch, '--map', 'hero=block:hero']);
    assert.equal(m.status, 0, m.stdout + m.stderr);
    const html = readFileSync(o, 'utf8');
    assert.equal(count(html, '<div class="hero">'), 1);
    const block = html.slice(html.indexOf('<div class="hero">'), html.indexOf('</div>\n    </div>\n  </div>'));
    assert.equal(count(block, '\n    <div>\n'), 1, 'one row'); assert.equal(count(block, '      <div>'), 2, 'two cells');
    assert.equal(lint(o).status, 0);
    assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).pages[o].sections[0].emitter, 'block:hero');
  });

  t('0 sections and no <h1>: exit 2, nothing written', () => {
    for (const [f, re] of [['empty.html', /0 sections/], ['noh1.html', /no <h1>/]]) {
      const o = join(tmp, 'content', f);
      const r = run([join(FIX, f), '--thin', '--out', o, '--ledger', ledger]);
      assert.equal(r.status, 2, r.stdout); assert.match(r.stdout, re); assert.ok(!existsSync(o));
    }
  });

  t('--dry-run writes nothing (no output, no ledger row)', () => {
    const o = join(tmp, 'content', 'dry.html'); const lg = join(tmp, 'dry-ledger.json');
    const r = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), '--out', o, '--ledger', lg, '--dry-run']);
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /dry-run: .* not written/);
    assert.ok(!existsSync(o) && !existsSync(lg));
  });

  t('stardust/patches/<slug>.json replace op is applied last', () => {
    const o = join(tmp, 'content', 'patched', 'landing.html');
    const r = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), '--out', o, '--ledger', ledger, '--patches', join(FIX, 'patches')]);
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /patches: .*landing\.json \(1 op\)/);
    const html = readFileSync(o, 'utf8');
    assert.match(html, /<h2>Why members stay \(patched\)<\/h2>/); assert.ok(!html.includes('<h2>Why members stay</h2>'));
    assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).pages[o].patchesApplied[0].matched, 2);
  });

  t('NEGATIVE hand edit: an edited output is exit 2 naming the path, nothing overwritten; --force regenerates', () => {
    const edited = readFileSync(out, 'utf8').replace('Get a quote', 'Get a quote today');
    writeFileSync(out, edited);
    const r = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), ...base]);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stdout, /blocked: hand-edited output .*landing\.html \(sha differs from the last generated one\) — move the edit into .*landing\.json or pass --force/);
    assert.equal(readFileSync(out, 'utf8'), edited, 'the hand edit survives');
    const f = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), ...base, '--force']);
    assert.equal(f.status, 0, f.stdout); assert.ok(!readFileSync(out, 'utf8').includes('today'));
    const foreign = join(tmp, 'content', 'hand-authored.html'); writeFileSync(foreign, '<body><main><div><h1>Mine</h1></div></main></body>\n');
    const g = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), '--out', foreign, '--ledger', ledger]);
    assert.equal(g.status, 2); assert.match(g.stdout, /no ledger row — not generated by this script/); assert.match(readFileSync(foreign, 'utf8'), /Mine/);
  });

  t('--thin on a migrated render: default content, table block, no breadcrumbs block, drops logged, lint 0', () => {
    const o = join(tmp, 'content', 'thin.html');
    const r = run([join(FIX, 'thin.html'), '--thin', '--drop', '.hide-on-desktop', '--out', o, '--ledger', ledger, '--patches', nopatch]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const html = readFileSync(o, 'utf8');
    assert.equal(count(html, '<div class="table">'), 1); assert.ok(!html.includes('<table'));
    assert.ok(!/class="breadcrumbs?"/.test(html) && !html.includes('>Home<'), 'no breadcrumbs block, trail dropped');
    assert.equal(count(html, '<h1>'), 1); assert.match(html, /<h2>How the yield is calculated<\/h2>/);
    assert.equal(count(html, 'Rates shown are annual'), 2, 'lead once in the metadata description, once in the body');
    assert.equal(count(html, 'Open an account'), 1, 'twin dropped');
    assert.ok(!html.includes('<form') && !html.includes('widget'));
    for (const re of [/dropped: nav\.breadcrumb → breadcrumb-trail → runtime/, /dropped: h1 "Deposit rates" → hidden duplicate <h1>/, /dropped: h1 "How the yield is calculated" → demoted to <h2>/, /dropped: div\.lead\.hide-on-desktop → --drop \.hide-on-desktop/, /dropped: div\.widget → empty shell/, /dropped: div\.cta-row → twin/, /dropped: form → non-authorable/]) assert.match(r.stdout, re);
    assert.equal(count(r.stdout, 'breadcrumb-trail'), 1, 'one log line per drop');
    const l = lint(o); assert.equal(l.status, 0, l.stdout); assert.match(l.stdout, /0 🔴/);
    const row = JSON.parse(readFileSync(ledger, 'utf8')).pages[o];
    assert.deepEqual(row.blocks, ['table']); assert.equal(row.dropped.length, 7);
  });

  t('CLI: --help lists the documented flags; a value flag followed by a flag is refused; unknown arg exit 1; no schema and no --thin is blocked', () => {
    const h = run(['--help']); assert.equal(h.status, 0);
    for (const f of ['--out', '--schema', '--thin', '--map', '--drop', '--slug', '--ledger', '--patches', '--render', '--width', '--dry-run', '--force', '--json', '--help']) assert.ok(h.stdout.includes(f), `help names ${f}`);
    const g = run(['--out', '--thin', 'x']); assert.equal(g.status, 1); assert.match(g.stderr, /--out needs a value/);
    const u = run([join(FIX, 'landing.html'), '--out', join(tmp, 'x.html'), '--bogus']); assert.equal(u.status, 1); assert.match(u.stderr, /unknown arg/);
    const w = run([join(FIX, 'landing.html'), '--out', join(tmp, 'x.html'), '--width', '12']); assert.equal(w.status, 1);
    const n = run([join(FIX, 'landing.html'), '--out', join(tmp, 'x.html'), '--ledger', ledger]); assert.equal(n.status, 2); assert.match(n.stdout, /no schema/);
    const j = run([join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), '--out', join(tmp, 'j.html'), '--ledger', ledger, '--dry-run', '--json']);
    const line = j.stdout.trim().split('\n').pop(); assert.equal(JSON.parse(line).dryRun, true);
  });

  t('NEGATIVE ledger key: a respelt --out (./x, ../x from a sub-dir) finds the row — one row, no false hand-edit block', () => {
    const proj = join(realpathSync(tmp), 'proj'); mkdirSync(join(proj, 'sub'), { recursive: true }); // realpath: the child's cwd is the resolved /private/var path
    const lg = join(proj, 'transcribe.json');
    const args = [join(FIX, 'landing.html'), '--schema', join(FIX, 'landing.schema.json'), '--ledger', lg, '--patches', nopatch];
    let r = run([...args, '--out', 'content/c.html'], { cwd: proj }); assert.equal(r.status, 0, r.stdout + r.stderr);
    const first = JSON.parse(readFileSync(lg, 'utf8')).pages;
    assert.deepEqual(Object.keys(first), ['content/c.html'], 'keyed relative to the project root'); assert.equal(first['content/c.html'].path, join(proj, 'content', 'c.html'));
    r = run([...args, '--out', './content/c.html'], { cwd: proj }); assert.equal(r.status, 0, `./ spelling must not read as a hand edit\n${r.stdout}`); assert.match(r.stdout, /^written/m);
    r = run([...args, '--out', join('..', 'content', 'c.html')], { cwd: join(proj, 'sub') }); assert.equal(r.status, 0, `another cwd must not read as a hand edit\n${r.stdout}`);
    r = run([...args, '--out', join(proj, 'content', 'c.html')], { cwd: proj }); assert.equal(r.status, 0, `absolute spelling must not read as a hand edit\n${r.stdout}`);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(lg, 'utf8')).pages), ['content/c.html'], 'still one row after four spellings');
    writeFileSync(join(proj, 'content', 'c.html'), '<body><main><div><h1>Mine</h1></div></main></body>');
    r = run([...args, '--out', './content/c.html'], { cwd: proj }); assert.equal(r.status, 2); assert.match(r.stdout, /sha differs from the last generated one/, 'a real hand edit is still caught under the respelt path');
  });

  t('NEGATIVE positional pairing: renamed schema sections → exit 2, each section unmapped by NAME, nothing written', () => {
    const renamed = { ...schema, sections: schema.sections.map((x) => ({ ...x, section: `${x.section}-band` })) };
    const sf = join(tmp, 'renamed.schema.json'); writeFileSync(sf, JSON.stringify(renamed));
    const o = join(tmp, 'content', 'renamed.html');
    const r = run([join(FIX, 'landing.html'), '--schema', sf, '--out', o, '--ledger', ledger, '--patches', nopatch]);
    assert.equal(r.status, 2, `a schema that matches by position only must block, not pair silently\n${r.stdout}`);
    assert.ok(!existsSync(o), 'nothing written');
    for (const n of ['hero', 'story', 'plans']) assert.match(r.stdout, new RegExp(`unmapped: ${n} on .*renamed\\.html \\(not in the schema \\(its position holds "${n}-band"`), `${n} is unmapped, naming the same-position schema name`);
    assert.ok(!/plans\s+block:plans/.test(r.stdout), 'no block emitted by position');
  });

  t('NEGATIVE exit class: Playwright unresolvable → exit 2 (resolution chain), nothing written; the header agrees', () => {
    const h = run(['--help']).stdout;
    const one = h.split('\n').find((l) => /^\s*1\s{2}/.test(l)); assert.ok(one && !/Playwright/.test(one), `exit-1 line must not claim Playwright: ${one}`);
    assert.match(h, /^\s*2\s{2}blocked[^\n]*\n\s*Playwright unresolvable/m, 'exit-2 line names Playwright unresolvable');
    const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho ""\n'); chmodSync(join(bin, 'npm'), 0o755);
    const bare = join(tmp, 'bare'); mkdirSync(bare, { recursive: true });
    const env = { ...process.env, PATH: bin }; delete env.STARDUST_PW_ROOT;
    const r = run([join(FIX, 'landing.html'), '--render', '--thin', '--out', join(bare, 'x.html'), '--ledger', join(bare, 'l.json')], { cwd: bare, env });
    assert.equal(r.status, 2, `unresolvable playwright is the chain's exit 2\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /prototype-to-content\.mjs: cannot resolve 'playwright' from /);
    assert.ok(!existsSync(join(bare, 'x.html')) && !existsSync(join(bare, 'l.json')), 'nothing written');
  });

  const root = pwRoot();
  if (root) {
    t('browser: --render --thin on the ew-editability prototype → exit 0 with its <h1>', () => {
      const proto = resolve(HERE, '..', 'ew-editability', 'fixture', 'stardust', 'prototypes', 'accounts-proposed.html');
      const o = join(tmp, 'content', 'accounts.html');
      const r = run([proto, '--render', '--thin', '--out', o, '--ledger', ledger, '--patches', nopatch], { cwd: root });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(readFileSync(o, 'utf8'), /<h1>One checking account\. One savings account\. Nothing to decode\.<\/h1>/);
    });
  } else console.log('SKIP prototype-to-content browser case: playwright is not resolvable (set STARDUST_PW_ROOT=<dir with node_modules>) — pure cases ran');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (process.exitCode) process.exit(1);
console.log(`prototype-to-content fixtures: ${cases} cases pass`);
