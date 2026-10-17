#!/usr/bin/env node
// skills/replica/scripts/test/presence.test.mjs — the presence.mjs contract: `add` appends to "*".hide or <slug>.hide
// in order, de-duplicated with live-session's parseHideList (a stored comma list split only when the list changes),
// records --reason R-<digits> in the entry's `reasons`, leaves other keys and fields alone and is idempotent (a second
// run prints `unchanged` and leaves the bytes as they were); `seed` unions run.json siteOverlays and
// STARDUST_SITE_OVERLAYS into "*".hide with the seeded reasons (never replacing a recorded one), prints `nothing to
// seed` without touching a file; a malformed presence or run file is refused (exit 1, named, nothing written); usage
// errors exit 2; --help answers before any import or file access; the project-copy layout (stardust/scripts/diff/
// beside stardust/scripts/replica/) resolves live-session.
// Run: node plugins/stardust/skills/replica/scripts/test/presence.test.mjs   (about 1 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_FILE, applyHide } from '../presence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'presence.mjs');
const LIVE_SESSION = join(HERE, '..', '..', '..', 'diff', 'scripts', 'live-session.mjs');
const { parseHideList, ...liveSession } = await import(pathToFileURL(LIVE_SESSION).href);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'presence-test-')));

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
// Each case gets its own project root; STARDUST_SITE_OVERLAYS from the caller's shell never leaks in.
let n = 0;
const project = () => { n += 1; const d = join(scratch, `p${n}`); mkdirSync(d); return d; };
const baseEnv = () => { const e = { ...process.env }; delete e.STARDUST_SITE_OVERLAYS; return e; };
const run = (cwd, args, { env = {}, script = SCRIPT } = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const write = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const read = (root, rel = DEFAULT_FILE) => readFileSync(join(root, rel), 'utf8');
const json = (root, rel) => JSON.parse(read(root, rel));
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const lines = (out) => out.trim().split('\n');
const listing = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();

check('--help: usage, inputs, outputs and exit codes on stdout; no import, no file read or written', () => {
  // the script alone — no live-session.mjs in either layout — so an import before --help would fail
  const lone = project(); copyFileSync(SCRIPT, join(lone, 'presence.mjs'));
  const cwd = project();
  for (const flag of ['--help', '-h']) {
    const r = run(cwd, ['add', flag], { script: join(lone, 'presence.mjs') });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Usage:/);
    for (const s of ['add --hide', 'seed [--run stardust/.labs/run.json]', '--slug', '--reason <R-nn>', '--file', DEFAULT_FILE, 'STARDUST_SITE_OVERLAYS', 'unchanged', 'nothing to seed', 'Exit codes']) assert.ok(r.out.includes(s), `--help names ${s}`);
    assert.equal(r.err, '');
  }
  assert.deepEqual(listing(cwd), []);
  assert.deepEqual(listing(lone), ['presence.mjs']);
  // the same lone copy without --help fails on the missing library, exit 1, nothing written
  const r = run(cwd, ['add', '--hide', '.geo-bar'], { script: join(lone, 'presence.mjs') });
  assert.equal(r.code, 1);
  assert.match(r.err, /live-session\.mjs not found \(looked in \.\.\/\.\.\/diff\/scripts\/ and \.\.\/diff\/\)/);
  assert.deepEqual(listing(cwd), []);
});

check('add: creates the default file with "*".hide (indent 2 + newline); a second run is unchanged and byte-identical', () => {
  const root = project();
  let r = run(root, ['add', '--hide', '.geo-bar']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.hide: .geo-bar', `wrote ${DEFAULT_FILE}: +1 selector, 0 reasons`]);
  const first = read(root);
  assert.equal(first, pretty({ '*': { hide: ['.geo-bar'] } }));
  r = run(root, ['add', '--hide', '.geo-bar']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.hide: .geo-bar', `unchanged: ${DEFAULT_FILE}`]);
  assert.equal(read(root), first);
  assert.deepEqual(listing(join(root, 'stardust/replica')), ['presence.json'], 'no temp file left behind');
});

check('add: appends in order, de-duplicated with parseHideList semantics (comma lists, repeated --hide, trimming)', () => {
  const root = project();
  write(root, DEFAULT_FILE, pretty({ '*': { hide: ['.geo-bar'] } }));
  const r = run(root, ['add', '--hide', ' .member-strip , .geo-bar,,.promo ', '--hide', '.member-strip']);
  assert.equal(r.code, 0, r.err);
  assert.equal(lines(r.out)[0], '*.hide: .geo-bar, .member-strip, .promo');
  assert.deepEqual(json(root)['*'].hide, ['.geo-bar', '.member-strip', '.promo']);
  assert.match(r.out, /\+2 selectors, 0 reasons/);
});

check('add --slug: writes <slug>.hide, leaves "*" and the slug entry\'s other fields as they were (key order kept)', () => {
  const root = project();
  const before = { '*': { hide: ['.geo-bar'], main: 'main' }, about: { variable: ['.ticker=.ticker-build'], main: '#content' }, contact: { hide: '.chat' } };
  write(root, DEFAULT_FILE, pretty(before));
  let r = run(root, ['add', '--slug', 'about', '--hide', '.promo']);
  assert.equal(r.code, 0, r.err);
  assert.equal(lines(r.out)[0], 'about.hide: .promo');
  const after = json(root);
  assert.deepEqual(Object.keys(after), ['*', 'about', 'contact']);
  assert.deepEqual(after['*'], before['*']);
  assert.deepEqual(after.contact, before.contact);
  assert.deepEqual(after.about, { variable: ['.ticker=.ticker-build'], main: '#content', hide: ['.promo'] });
  // a new slug key is appended at the end
  r = run(root, ['add', '--slug', 'news', '--hide', '.cookie-strip']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(Object.keys(json(root)), ['*', 'about', 'contact', 'news']);
  assert.equal(lines(r.out)[0], 'news.hide: .cookie-strip');
});

check('add: a stored comma-list string is read as parseHideList does — unchanged stays untouched, a change stores one selector per item', () => {
  const root = project();
  const text = '{"*":{"hide":".a, .b","main":"main"}}';
  write(root, DEFAULT_FILE, text);
  let r = run(root, ['add', '--hide', '.b,.a']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.hide: .a, .b', `unchanged: ${DEFAULT_FILE}`]);
  assert.equal(read(root), text, 'not rewritten — not even re-indented');
  r = run(root, ['add', '--hide', '.c']);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(root), pretty({ '*': { hide: ['.a', '.b', '.c'], main: 'main' } }));
});

check('add --reason: recorded in the entry\'s reasons for every selector of the call; same reason → unchanged; a new one replaces it', () => {
  const root = project();
  let r = run(root, ['add', '--hide', '.geo-bar,.member-strip', '--reason', 'R-07']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\+2 selectors, 2 reasons/);
  assert.equal(read(root), pretty({ '*': { hide: ['.geo-bar', '.member-strip'], reasons: { '.geo-bar': 'R-07', '.member-strip': 'R-07' } } }));
  const first = read(root);
  r = run(root, ['add', '--hide', '.geo-bar', '--reason', 'R-07']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /unchanged/);
  assert.equal(read(root), first);
  // an already-listed selector with a new residual id: the list stays, the reason is replaced
  r = run(root, ['add', '--hide', '.geo-bar', '--reason', 'R-12']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\+0 selectors, 1 reason$/m);
  assert.deepEqual(json(root)['*'], { hide: ['.geo-bar', '.member-strip'], reasons: { '.geo-bar': 'R-12', '.member-strip': 'R-07' } });
  // without --reason the reasons are left alone
  r = run(root, ['add', '--hide', '.promo']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(json(root)['*'].reasons, { '.geo-bar': 'R-12', '.member-strip': 'R-07' });
  // a slug entry carries its own reasons
  r = run(root, ['add', '--slug', 'about', '--hide', '.store-picker', '--reason', 'R-3']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(json(root).about, { hide: ['.store-picker'], reasons: { '.store-picker': 'R-3' } });
});

check('seed: run.json siteOverlays into "*".hide after the existing list, reason "seeded: run.json siteOverlays"; second run byte-identical', () => {
  const root = project();
  write(root, DEFAULT_FILE, pretty({ '*': { hide: ['.geo-bar'], reasons: { '.geo-bar': 'R-02' } }, about: { hide: ['.promo'] } }));
  write(root, 'stardust/.labs/run.json', pretty({ site: 'https://www.example.com', siteOverlays: ['#newsletter-modal', '.geo-bar', '.promo-strip'] }));
  let r = run(root, ['seed']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.hide: .geo-bar, #newsletter-modal, .promo-strip', `wrote ${DEFAULT_FILE}: +2 selectors, 2 reasons`]);
  const after = json(root);
  assert.deepEqual(after['*'], { hide: ['.geo-bar', '#newsletter-modal', '.promo-strip'], reasons: { '.geo-bar': 'R-02', '#newsletter-modal': 'seeded: run.json siteOverlays', '.promo-strip': 'seeded: run.json siteOverlays' } });
  assert.deepEqual(after.about, { hide: ['.promo'] });
  const first = read(root);
  r = run(root, ['seed']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^unchanged: /m);
  assert.equal(read(root), first);
});

check('seed: STARDUST_SITE_OVERLAYS alone (comma list), reason "seeded: STARDUST_SITE_OVERLAYS"; --run and --file honoured', () => {
  const root = project();
  let r = run(root, ['seed'], { env: { STARDUST_SITE_OVERLAYS: ' .chat-launcher , #promo-modal,' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(read(root), pretty({ '*': { hide: ['.chat-launcher', '#promo-modal'], reasons: { '.chat-launcher': 'seeded: STARDUST_SITE_OVERLAYS', '#promo-modal': 'seeded: STARDUST_SITE_OVERLAYS' } } }));
  write(root, 'runs/r1.json', pretty({ siteOverlays: ['.survey'] }));
  r = run(root, ['seed', '--run', 'runs/r1.json', '--file', 'out/site/presence.json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(json(root, 'out/site/presence.json'), { '*': { hide: ['.survey'], reasons: { '.survey': 'seeded: run.json siteOverlays' } } });
  assert.match(r.out, /wrote out\/site\/presence\.json: \+1 selector, 1 reason/);
});

check('seed: both sources — union in order (run.json first), a selector named by both carries the run.json reason', () => {
  const root = project();
  write(root, 'stardust/.labs/run.json', pretty({ siteOverlays: ['.a', '.b, .c'] }));
  const r = run(root, ['seed'], { env: { STARDUST_SITE_OVERLAYS: '.c,.d' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(lines(r.out)[0], '*.hide: .a, .b, .c, .d');
  assert.deepEqual(json(root)['*'].reasons, { '.a': 'seeded: run.json siteOverlays', '.b': 'seeded: run.json siteOverlays', '.c': 'seeded: run.json siteOverlays', '.d': 'seeded: STARDUST_SITE_OVERLAYS' });
});

check('seed: nothing to seed — exit 0, the sources named, no file created or rewritten', () => {
  const root = project();
  let r = run(root, ['seed']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'nothing to seed (stardust/.labs/run.json: not found; STARDUST_SITE_OVERLAYS: unset)');
  assert.deepEqual(listing(root), []);
  write(root, 'stardust/.labs/run.json', pretty({ siteOverlays: [] }));
  const text = '{"about":{"hide":[".promo"]}}';
  write(root, DEFAULT_FILE, text);
  r = run(root, ['seed'], { env: { STARDUST_SITE_OVERLAYS: ' , ' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'nothing to seed (stardust/.labs/run.json: no siteOverlays; STARDUST_SITE_OVERLAYS: empty)');
  assert.equal(read(root), text);
});

check('a malformed presence file is refused: exit 1 naming it, the bytes untouched, no temp file', () => {
  const cases = [
    ['{ "*": { "hide": [".a"', /not valid JSON|JSON|Unexpected|Expected/],
    ['[".geo-bar"]', /top level must be a JSON object/],
    ['{"*": ".geo-bar"}', /"\*" must be an object/],
    ['{"*": {"hide": 5}}', /"\*"\.hide must be a selector string or a list/],
    ['{"*": {"hide": [".a", 3]}}', /"\*"\.hide must be/],
    ['{"*": {"hide": [".a"], "reasons": [".a"]}}', /"\*"\.reasons must be an object of strings/],
  ];
  for (const [text, why] of cases) {
    for (const args of [['add', '--hide', '.geo-bar'], ['seed']]) {
      const root = project();
      write(root, DEFAULT_FILE, text);
      const r = run(root, args, { env: { STARDUST_SITE_OVERLAYS: '.x' } });
      assert.equal(r.code, 1, `${args[0]} on ${text}: ${r.out}${r.err}`);
      assert.match(r.err, new RegExp(`presence: ${DEFAULT_FILE.replace(/[./]/g, '\\$&')} is malformed \\(`));
      assert.match(r.err, why);
      assert.match(r.err, /nothing written/);
      assert.equal(r.out, '');
      assert.equal(read(root), text);
      assert.deepEqual(listing(join(root, 'stardust/replica')), ['presence.json']);
    }
  }
  // seed with nothing to seed still refuses a malformed presence file
  const root = project();
  write(root, DEFAULT_FILE, '{');
  const r = run(root, ['seed']);
  assert.equal(r.code, 1);
  assert.match(r.err, /is malformed/);
  // only the touched entry is checked: a malformed slug entry does not block an add to "*"
  const ok = project();
  write(ok, DEFAULT_FILE, '{"about": "x"}');
  assert.equal(run(ok, ['add', '--hide', '.a']).code, 0);
  assert.equal(run(ok, ['add', '--slug', 'about', '--hide', '.a']).code, 1);
});

check('a malformed run file is refused: exit 1 naming it, the presence file not written', () => {
  for (const text of ['{"siteOverlays": [".a",', '{"siteOverlays": ".a, .b"}', '{"siteOverlays": [".a", {"sel": ".b"}]}', '[]']) {
    const root = project();
    write(root, 'stardust/.labs/run.json', text);
    const r = run(root, ['seed'], { env: { STARDUST_SITE_OVERLAYS: '.x' } });
    assert.equal(r.code, 1, `${text}: ${r.out}${r.err}`);
    assert.match(r.err, /presence: stardust\/\.labs\/run\.json is malformed \(.+\) — nothing written/);
    assert.equal(existsSync(join(root, DEFAULT_FILE)), false);
  }
});

check('usage errors exit 2 with one stderr line and write nothing', () => {
  const root = project();
  const cases = [
    [[], /a command is required/],
    [['remove', '--hide', '.a'], /unknown command "remove"/],
    [['constructor'], /unknown command "constructor"/],
    [['add'], /add needs --hide/],
    [['add', '--hide'], /--hide needs a value/],
    [['add', '--hide', '--slug', 'x'], /--hide needs a value/],
    [['add', '--hide', ' , '], /--hide names no selector/],
    [['add', '--hide', '.a', '--reason', 'R7'], /--reason must be a residual id R-<digits> \(got "R7"\)/],
    [['add', '--hide', '.a', '--reason', 'location bar'], /--reason must be/],
    [['add', '--hide', '.a', '--slug', ' '], /--slug needs a page slug/],
    [['add', '--hide', '.a', '--run', 'x.json'], /unknown argument --run for add/],
    [['seed', '--hide', '.a'], /unknown argument --hide for seed/],
    [['seed', '--file'], /--file needs a value/],
  ];
  for (const [args, re] of cases) {
    const r = run(root, args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, re);
    assert.equal(r.err.trim().split('\n').length, 1);
    assert.equal(r.out, '');
  }
  assert.deepEqual(listing(root), []);
});

check('project-copy layout: stardust/scripts/replica/presence.mjs finds stardust/scripts/diff/live-session.mjs', () => {
  const root = project();
  mkdirSync(join(root, 'stardust/scripts/replica'), { recursive: true });
  mkdirSync(join(root, 'stardust/scripts/diff'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'stardust/scripts/replica/presence.mjs'));
  copyFileSync(LIVE_SESSION, join(root, 'stardust/scripts/diff/live-session.mjs'));
  const r = spawnSync(process.execPath, ['stardust/scripts/replica/presence.mjs', 'add', '--hide', '.geo-bar', '--reason', 'R-01'], { cwd: root, encoding: 'utf8', env: baseEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(root), { '*': { hide: ['.geo-bar'], reasons: { '.geo-bar': 'R-01' } } });
});

check('applyHide is pure: the input is not mutated; no change returns the same object', () => {
  const input = { '*': { hide: ['.a'], reasons: { '.a': 'R-1' } } };
  const snapshot = JSON.stringify(input);
  const r = applyHide(input, '*', ['.b'], { parse: parseHideList, reasonOf: () => 'R-2' });
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(r.json, { '*': { hide: ['.a', '.b'], reasons: { '.a': 'R-1', '.b': 'R-2' } } }, 'only the call\'s selectors get the reason');
  const same = applyHide(input, '*', ['.a'], { parse: parseHideList });
  assert.equal(same.json, input);
  assert.equal(same.changed, false);
});

check('the default file is the site-wide presence path live-session reads (when it exports SITE_PRESENCE)', () => {
  assert.equal(DEFAULT_FILE, 'stardust/replica/presence.json');
  if ('SITE_PRESENCE' in liveSession) assert.equal(liveSession.SITE_PRESENCE, DEFAULT_FILE);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${checks} checks failing` : `\npresence: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
