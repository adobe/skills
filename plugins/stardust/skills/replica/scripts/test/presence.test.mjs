#!/usr/bin/env node
// skills/replica/scripts/test/presence.test.mjs — the presence.mjs contract: `add` appends to "*".hide or <slug>.hide
// in order, de-duplicated with live-session's parseHideList (a stored comma list split only when the list changes),
// records --reason R-<digits> in the entry's `reasons`, leaves other keys and fields alone and is idempotent (a second
// run prints `unchanged` and leaves the bytes as they were); `seed` unions run.json siteOverlays and
// STARDUST_SITE_OVERLAYS into "*".hide with the seeded reasons (never replacing a recorded one), prints `nothing to
// seed` without touching a file; a malformed presence or run file is refused (exit 1, named, nothing written); a failed
// write exits 1 with nothing printed as written and no temp file left; usage
// errors exit 2; --help answers before any import or file access; the project-copy layout (stardust/scripts/diff/
// beside stardust/scripts/replica/) resolves live-session. add without --verify writes and warns (one stderr line);
// playwright is loaded only by suggest and add --verify (where it is not importable, those exit 1 and add / seed work);
// suggestLines and pollSelectors (stub page). Then, where playwright is importable, end-to-end against pages served
// from this process — the delayed bar (an empty wrapper above the header that a lookup fills 4 s after load): add
// --verify with the right selector verifies once the bar arrives and writes; the old wrong selector exits 2 naming
// the wrapper (hideMissLine) with the file untouched; suggest lists the wrapper, the add line, and warns on a stale
// "*".hide selector; a bot challenge exits 3, an HTTP error 1. Prints a skip line otherwise.
// A refused add --verify suggests (missSuggestLines, pure: per missed selector the top three of its kind with the add
// command carrying the call's flags, shell-quoted; an allowance has none); e2e the hide miss prints the block after
// hideMissLine, and a --dismiss miss on a fixed consent-style banner the default dismissal leaves lists its controls
// ranked, the first printed command run verbatim verifies and writes.
// Capture settings: add --dismiss / --pin --state / --allow <kind>=<sel> --reason store dismiss / pin / allow per key
// (idempotent; a new state or reason replaces), a per-visitor-dialog allow needs its container hidden for the page, the
// usage refusals, a malformed field refused; captureSettings ("*" then the slug, lenient) and clipAllowed (whole path
// segments, advisory never counted) are pure; e2e --verify polls those selectors too (refused: nothing written).
// Run: node plugins/stardust/skills/replica/scripts/test/presence.test.mjs   (about 1 s; about 12 s with playwright)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_FILE, InputError, UNVERIFIED, applyHide, captureSettings, clipAllowed, missSuggestLines, pollSelectors, shellArg, suggestLines, writeAtomic } from '../presence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'presence.mjs');
const LIVE_SESSION = join(HERE, '..', '..', '..', 'diff', 'scripts', 'live-session.mjs');
const { parseHideList, ...liveSession } = await import(pathToFileURL(LIVE_SESSION).href);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'presence-test-')));

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const checkAsync = async (name, fn) => { checks += 1; try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
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
    for (const s of ['add --hide', 'seed [--run stardust/.labs/run.json]', 'suggest <url> [--width 1440]', '--verify <url>', '--wait-ms', '--headed', '--slug', '--reason <R-nn>', '--file', DEFAULT_FILE, 'STARDUST_SITE_OVERLAYS', 'unchanged', 'nothing to seed', UNVERIFIED, 'hide matched nothing on live — candidates:', 'top candidates for --<kind> <sel>:', 'no <kind> candidate found', 'none found above the header', 'Exit codes', '3 bot challenge']) assert.ok(r.out.includes(s), `--help names ${s}`);
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

check('add: creates the default file with "*".hide (indent 2 + newline); a second run is unchanged and byte-identical; unverified → one stderr warning', () => {
  const root = project();
  let r = run(root, ['add', '--hide', '.geo-bar']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.hide: .geo-bar', `wrote ${DEFAULT_FILE}: +1 selector, 0 reasons`]);
  assert.equal(r.err, `presence: ${UNVERIFIED}\n`, 'without --verify: written, and exactly one warning line');
  const first = read(root);
  assert.equal(first, pretty({ '*': { hide: ['.geo-bar'] } }));
  r = run(root, ['add', '--hide', '.geo-bar']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.hide: .geo-bar', `unchanged: ${DEFAULT_FILE}`]);
  assert.equal(r.err, `presence: ${UNVERIFIED}\n`);
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
  assert.equal(r.err, '', 'seed never warns about a live page');
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

check('a failed write: exit 1 naming the file, nothing printed as written, no temp file left behind', () => {
  // the --file's directory is a regular file: the write fails after the list was computed
  const root = project();
  write(root, 'blocker', 'not a directory');
  const r = run(root, ['add', '--hide', '.geo-bar', '--file', 'blocker/presence.json']);
  assert.equal(r.code, 1, `${r.out}${r.err}`);
  assert.match(r.err, /^presence: cannot write blocker\/presence\.json \((ENOTDIR|EEXIST)\)$/m);
  assert.equal(r.out, '', 'neither the resulting list nor "wrote" is printed');
  assert.deepEqual(listing(root), ['blocker']);
  // the rename fails after the temp file was written (the target is a directory): the temp file is removed
  const dir = project();
  mkdirSync(join(dir, 'presence.json'));
  assert.throws(() => writeAtomic(join(dir, 'presence.json'), { '*': { hide: ['.a'] } }), (e) => e instanceof InputError && /cannot write .*presence\.json \(E[A-Z]+\)/.test(e.message));
  assert.deepEqual(listing(dir), ['presence.json']);
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
    [['suggest'], /suggest needs a page URL/],
    [['suggest', 'www.example.com'], /suggest needs an http\(s\) page URL \(got "www\.example\.com"\)/],
    [['suggest', 'https://a.example/', 'https://b.example/'], /suggest takes one page URL/],
    [['suggest', 'https://a.example/', '--hide', '.a'], /unknown argument --hide for suggest/],
    [['suggest', 'https://a.example/', '--width', 'wide'], /--width must be a whole number ≥ 1 \(got "wide"\)/],
    [['add', '--hide', '.a', '--verify'], /--verify needs a value/],
    [['add', '--hide', '.a', '--verify', 'file:///site/index.html'], /--verify needs an http\(s\) page URL/],
    [['add', '--hide', '.a', '--verify', 'https://a.example/', '--wait-ms', '-1'], /--wait-ms must be a whole number ≥ 0 \(got "-1"\)/],
    [['add', '--hide', '.a', '--verify', 'https://a.example/', '--width', '0'], /--width must be a whole number ≥ 1/],
    [['add', '--hide', '.a', '--wait-ms', '100'], /--wait-ms, --width and --headed need --verify <url>/],
    [['add', '--hide', '.a', '--headed'], /need --verify <url>/],
    [['seed', '--headed'], /unknown argument --headed for seed/],
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

check('playwright is loaded only by suggest and add --verify: where it is not importable, add / seed still work and those two exit 1, nothing written', () => {
  // a scratch project without node_modules: add and seed above ran here without playwright; the live commands need it
  const root = project();
  mkdirSync(join(root, 'stardust/scripts/replica'), { recursive: true });
  mkdirSync(join(root, 'stardust/scripts/diff'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'stardust/scripts/replica/presence.mjs'));
  copyFileSync(LIVE_SESSION, join(root, 'stardust/scripts/diff/live-session.mjs'));
  const copy = join(root, 'stardust/scripts/replica/presence.mjs');
  assert.equal(run(root, ['seed'], { script: copy, env: { STARDUST_SITE_OVERLAYS: '.chat' } }).code, 0);
  const text = read(root);
  for (const args of [['add', '--hide', '.geo-bar', '--verify', 'https://www.example.com/'], ['suggest', 'https://www.example.com/']]) {
    const r = run(root, args, { script: copy });
    assert.equal(r.code, 1, `${args[0]}: ${r.out}${r.err}`);
    assert.match(r.err, /^presence: playwright is not importable from .+ \(ERR_MODULE_NOT_FOUND\) — replica SKILL\.md § Setup/);
    assert.equal(r.out, '');
    assert.equal(read(root), text);
  }
  // add --verify and suggest refuse a malformed presence file before they open any page
  write(root, DEFAULT_FILE, '{"*": 5}');
  for (const args of [['add', '--hide', '.geo-bar', '--verify', 'https://www.example.com/'], ['suggest', 'https://www.example.com/']]) {
    const r = run(root, args, { script: copy });
    assert.equal(r.code, 1, args[0]);
    assert.match(r.err, /is malformed \("\*" must be an object\) — nothing written/);
    assert.doesNotMatch(r.err, /playwright/);
  }
});

check('suggestLines: one "<selector>  <tag>  <h>px" line per candidate in order, then the add line for the first with a selector (shell-quoted where needed)', () => {
  const url = 'https://www.example.com/';
  const wrapper = { tag: 'section', id: null, classes: ['bar__wrapper'], top: 0, height: 0, selector: 'section.bar__wrapper' };
  const geo = { tag: 'div', id: 'geo', classes: [], top: 0, height: 88, selector: '#geo' };
  assert.deepEqual(suggestLines([wrapper, geo], { url }), ['section.bar__wrapper  section  0px', '#geo  div  88px', `presence.mjs add --hide section.bar__wrapper --verify ${url}`]);
  assert.deepEqual(suggestLines([{ ...wrapper, selector: null }, geo], { url: `${url}?region=eu&x=1`, width: 390 }), [
    '(no unique selector)  section  0px', '#geo  div  88px', `presence.mjs add --hide '#geo' --verify '${url}?region=eu&x=1' --width 390`,
  ]);
  assert.deepEqual(suggestLines([{ ...wrapper, selector: null }], { url }), ['(no unique selector)  section  0px'], 'no selector → no add line');
  assert.deepEqual(suggestLines([], { url }), []);
  assert.equal(shellArg("div[data-x='a b']"), "'div[data-x='\\''a b'\\'']'");
});

check('missSuggestLines: per missed selector in call order, the top three of its kind, each with the exact add command carrying the call\'s flags', () => {
  const url = 'https://www.example.com/';
  const at = `presence: suggest on ${url} @`;
  const ctl = (selector, text, role = 'button') => ({ selector, text, role });
  const dismiss = [ctl('button[aria-label="Close notice"]', '×'), ctl('#notice button.primary', 'Say "hi"'), ctl("a[title=\"it's\"]", 'Privacy', 'link'), ctl('#fourth', 'never printed')];
  // dismiss: --slug / --reason / --width carried, --file only off the default, at most three, selectors with spaces and
  // quotes shell-quoted, text JSON-quoted
  assert.deepEqual(missSuggestLines([{ kind: 'dismiss', selector: 'button.not-there' }], { dismiss }, { url, width: 390, slug: 'home', reason: 'R-07', file: DEFAULT_FILE }), [
    `${at} 390px — top candidates for --dismiss button.not-there:`,
    'presence:   button[aria-label="Close notice"]  "×"  button',
    `presence:     presence.mjs add --dismiss 'button[aria-label="Close notice"]' --slug home --reason R-07 --verify ${url} --width 390`,
    'presence:   #notice button.primary  "Say \\"hi\\""  button',
    `presence:     presence.mjs add --dismiss '#notice button.primary' --slug home --reason R-07 --verify ${url} --width 390`,
    'presence:   a[title="it\'s"]  "Privacy"  link',
    `presence:     presence.mjs add --dismiss 'a[title="it'\\''s"]' --slug home --reason R-07 --verify ${url} --width 390`,
  ]);
  // pin carries --state; --file off the default, --wait-ms when given, --headed
  assert.deepEqual(missSuggestLines([{ kind: 'pin', selector: '.dot-9' }], { pin: [ctl('#hero button.next', 'Next slide')] }, { url, state: 'slide 1', file: 'out/p.json', waitMs: 2000, headed: true }), [
    `${at} 1440px — top candidates for --pin .dot-9:`,
    'presence:   #hero button.next  "Next slide"  button',
    `presence:     presence.mjs add --pin '#hero button.next' --state 'slide 1' --file out/p.json --verify ${url} --wait-ms 2000 --headed`,
  ]);
  // hide, then allow and a kind with no candidate — blocks in call order, each naming its missed selector
  const misses = [{ kind: 'hide', selector: '.location-bar' }, { kind: 'dismiss', selector: '.x' }, { kind: 'allow', selector: 'div.card', allowKind: 'clip' }];
  assert.deepEqual(missSuggestLines(misses, { hide: [ctl('section.bar__wrapper', 'Use the site for your region?', 'region')], dismiss: [] }, { url, waitMs: 0 }), [
    `${at} 1440px — top candidates for --hide .location-bar:`,
    'presence:   section.bar__wrapper  "Use the site for your region?"  region',
    `presence:     presence.mjs add --hide section.bar__wrapper --verify ${url} --wait-ms 0`,
    `${at} 1440px — no dismiss candidate found for --dismiss .x`,
    `${at} 1440px — no allow candidate for --allow clip=div.card: an allowance names a recorded finding's selector, so there is nothing to suggest`,
  ]);
  assert.deepEqual(missSuggestLines([{ kind: 'pin', selector: '.dot' }], {}, { url, state: 'x' }), [`${at} 1440px — no pin candidate found for --pin .dot`], 'no list read → no candidate');
  assert.deepEqual(missSuggestLines([], { dismiss }, { url }), []);
});

await checkAsync('pollSelectors: polls until every selector matched once (a block rendered late is found), the highest count kept; never-matched ones are the misses', async () => {
  const stub = (frames) => { let i = 0; return { looks: () => i, evaluate: async (fn, sels) => { const f = frames[Math.min(i, frames.length - 1)]; i += 1; return sels.map((_, k) => f[k]); }, waitForTimeout: (ms) => new Promise((r) => { setTimeout(r, ms); }) }; };
  // .geo-bar arrives on the third look; .strip matched once and went away — still verified
  let page = stub([[0, 1], [0, 0], [1, 0]]);
  assert.deepEqual(await pollSelectors(page, ['.geo-bar', '.strip'], { waitMs: 5000, everyMs: 1 }), { counts: [1, 1], misses: [] });
  assert.equal(page.looks(), 3, 'stops as soon as every selector matched');
  // a selector that never matches is a miss once the window closed
  page = stub([[2, 0]]);
  const t0 = Date.now();
  assert.deepEqual(await pollSelectors(page, ['.geo-bar', '.location-bar'], { waitMs: 60, everyMs: 10 }), { counts: [2, 0], misses: ['.location-bar'] });
  assert.ok(Date.now() - t0 >= 55 && page.looks() > 2, 'kept looking for the window');
  // --wait-ms 0: one look
  page = stub([[0], [1]]);
  assert.deepEqual(await pollSelectors(page, ['.geo-bar'], { waitMs: 0 }), { counts: [0], misses: ['.geo-bar'] });
  assert.equal(page.looks(), 1);
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

// ---- capture settings: dismiss / pin / allow (recorded where every gate reads them) ----------------------------------
check('add --dismiss / --pin --state / --allow <kind>=<sel>: stored per key ("*" or --slug) beside hide, reasons recorded, idempotent', () => {
  const root = project();
  write(root, DEFAULT_FILE, pretty({ '*': { hide: ['.geo-bar'] }, home: { main: 'main' } }));
  let r = run(root, ['add', '--dismiss', '.promo-close, .nl-x', '--pin', '.hero .dot:first-child', '--state', 'slide 1', '--reason', 'R-03']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['*.dismiss: .promo-close, .nl-x', '*.pin: .hero .dot:first-child → slide 1', `wrote ${DEFAULT_FILE}: +3 settings, 3 reasons`]);
  assert.deepEqual(json(root)['*'], { hide: ['.geo-bar'], dismiss: ['.promo-close', '.nl-x'], pin: [{ sel: '.hero .dot:first-child', state: 'slide 1' }], reasons: { '.promo-close': 'R-03', '.nl-x': 'R-03', '.hero .dot:first-child': 'R-03' } });
  r = run(root, ['add', '--slug', 'home', '--allow', 'clip=div.card__body', '--reason', 'R-04']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lines(r.out), ['home.allow: clip div.card__body (R-04)', `wrote ${DEFAULT_FILE}: +1 setting, 0 reasons`]);
  assert.deepEqual(json(root).home, { main: 'main', allow: [{ kind: 'clip', selector: 'div.card__body', reason: 'R-04' }] }, 'the entry\'s other fields kept, the reason on the allow itself');
  const before = read(root);
  r = run(root, ['add', '--slug', 'home', '--allow', 'clip=div.card__body', '--reason', 'R-04']);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^unchanged: /m); assert.equal(read(root), before);
  r = run(root, ['add', '--slug', 'home', '--allow', 'clip=div.card__body', '--reason', 'R-05']);
  assert.deepEqual(json(root).home.allow, [{ kind: 'clip', selector: 'div.card__body', reason: 'R-05' }], 'a new reason replaces the old one');
  r = run(root, ['add', '--pin', '.hero .dot:first-child', '--state', 'first slide']);
  assert.deepEqual(json(root)['*'].pin, [{ sel: '.hero .dot:first-child', state: 'first slide' }], 'a new state for the same selector replaces it');
});

check('add --allow per-visitor-dialog: the container must be hidden for the page (the key\'s or "*"\'s hide, this call included) — else exit 2, nothing written', () => {
  const root = project();
  let r = run(root, ['add', '--allow', 'per-visitor-dialog=#consent-root', '--reason', 'R-06']);
  assert.equal(r.code, 2, r.out); assert.match(r.err, /per-visitor-dialog #consent-root is not in the hide list .*--hide '#consent-root'/); assert.deepEqual(listing(root), []);
  r = run(root, ['add', '--hide', '#consent-root', '--allow', 'per-visitor-dialog=#consent-root', '--slug', 'de', '--reason', 'R-06']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(json(root), { de: { hide: ['#consent-root'], allow: [{ kind: 'per-visitor-dialog', selector: '#consent-root', reason: 'R-06' }], reasons: { '#consent-root': 'R-06' } } });
  write(root, DEFAULT_FILE, pretty({ '*': { hide: ['#consent-root'] } }));
  r = run(root, ['add', '--slug', 'fr', '--allow', 'per-visitor-dialog=#consent-root', '--reason', 'R-06']);
  assert.equal(r.code, 0, `${r.err} — "*".hide covers every page`);
});

check('add capture settings: usage errors exit 2 with one stderr line, nothing written', () => {
  const root = project();
  for (const [args, re] of [
    [['add', '--allow', 'clip=.x'], /--allow needs --reason R-<nn>/],
    [['add', '--allow', 'overlay=.x', '--reason', 'R-1'], /--allow kind must be one of clip, per-visitor-dialog \(got "overlay"\)/],
    [['add', '--allow', '.x', '--reason', 'R-1'], /--allow takes <kind>=<selector>/],
    [['add', '--allow', 'clip=', '--reason', 'R-1'], /--allow takes <kind>=<selector>/],
    [['add', '--pin', '.dot'], /--pin needs --state <label>/],
    [['add', '--state', 'slide 1', '--hide', '.a'], /--state needs --pin <sel>/],
    [['add', '--pin', '.a', '--pin', '.b', '--state', 'x'], /one --pin per call/],
    [['add', '--dismiss', ' , '], /--dismiss names no selector/],
    [['add', '--reason', 'R-1'], /add needs --hide, --dismiss, --pin or --allow/],
  ]) {
    const r = run(root, args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}${r.err}`); assert.match(r.err, re); assert.equal(r.err.trim().split('\n').length, 1); assert.equal(r.out, '');
  }
  assert.deepEqual(listing(root), []);
});

check('a malformed dismiss / pin / allow in the touched entry is refused: exit 1 naming it, nothing written', () => {
  for (const [entry, why] of [
    [{ dismiss: 5 }, /"\*"\.dismiss must be a selector string or a list of selector strings/],
    [{ pin: [{ sel: '.a' }] }, /"\*"\.pin must be a list of \{ sel, state \}/],
    [{ allow: [{ kind: 'nope', selector: '.a', reason: 'R-1' }] }, /"\*"\.allow must be a list of \{ kind: clip \| per-visitor-dialog, selector, reason \}/],
  ]) {
    const root = project(); write(root, DEFAULT_FILE, JSON.stringify({ '*': entry }));
    const r = run(root, ['add', '--dismiss', '.x']);
    assert.equal(r.code, 1, r.out); assert.match(r.err, why); assert.equal(read(root), JSON.stringify({ '*': entry }));
  }
});

check('captureSettings (pure): "*" then the slug\'s — hide / dismiss de-duplicated in order, pin and allow by selector (the slug\'s wins), malformed entries skipped', () => {
  const json = {
    '*': { hide: ['.geo', '#cmp'], dismiss: '.a, .b', pin: [{ sel: '.dot', state: 'slide 1' }, { sel: 5 }], allow: [{ kind: 'clip', selector: '.card', reason: 'R-1' }, { kind: 'x', selector: '.y', reason: 'R-1' }] },
    home: { hide: ['.promo'], dismiss: ['.b', '.c'], pin: [{ sel: '.dot', state: 'slide 2' }], allow: [{ kind: 'per-visitor-dialog', selector: '#cmp', reason: 'R-6' }, { kind: 'per-visitor-dialog', selector: '.not-hidden', reason: 'R-7' }] },
  };
  assert.deepEqual(captureSettings(json, 'home'), {
    hide: ['.geo', '#cmp', '.promo'], dismiss: ['.a', '.b', '.c'], pin: [{ sel: '.dot', state: 'slide 2' }],
    allow: [{ kind: 'clip', selector: '.card', reason: 'R-1' }, { kind: 'per-visitor-dialog', selector: '#cmp', reason: 'R-6' }, { kind: 'per-visitor-dialog', selector: '.not-hidden', reason: 'R-7' }],
    allowDialog: ['#cmp'],
  });
  assert.deepEqual(captureSettings(json, 'about'), { hide: ['.geo', '#cmp'], dismiss: ['.a', '.b'], pin: [{ sel: '.dot', state: 'slide 1' }], allow: [{ kind: 'clip', selector: '.card', reason: 'R-1' }], allowDialog: [] });
  assert.deepEqual(captureSettings(null, 'x'), { hide: [], dismiss: [], pin: [], allow: [], allowDialog: [] });
});

check('clipAllowed (pure): a counted finding whose clipper is the selector, or whose path holds it as whole segments, is allowed; advisory ones never count', () => {
  const findings = [
    { kind: 'TEXT CLIPPED', clipper: 'div.card__body', path: 'main > div.cards > div.card__body > p' },
    { kind: 'CONTROL HIDDEN', clipper: 'div.rail', path: 'main > div.rail > div.card > a' },
    { kind: 'TEXT CLIPPED', clipper: 'div.rail', path: 'main > div.rail > p' },
    { kind: 'TEXT CLAMPED', advisory: true, clipper: 'div.card__body', path: 'main > div.card__body > p' },
  ];
  const allow = [{ kind: 'clip', selector: 'div.card__body', reason: 'R-2' }, { kind: 'clip', selector: 'div.rail > div.card', reason: 'R-3' }, { kind: 'per-visitor-dialog', selector: 'div.rail', reason: 'R-9' }];
  assert.deepEqual(clipAllowed(findings, allow), { n: 2, by: [{ selector: 'div.card__body', reason: 'R-2', n: 1 }, { selector: 'div.rail > div.card', reason: 'R-3', n: 1 }] });
  assert.deepEqual(clipAllowed(findings, []), { n: 0, by: [] });
  assert.deepEqual(clipAllowed([{ kind: 'TEXT CLIPPED', clipper: 'div.card__bodyx', path: 'main > div.card__bodyx > p' }], allow), { n: 0, by: [] }, 'a whole segment, never a prefix');
  assert.deepEqual(clipAllowed([{ kind: 'TEXT CLIPPED', n: 3, clipper: 'div.card__body', path: 'main > p' }], allow), { n: 3, by: [{ selector: 'div.card__body', reason: 'R-2', n: 3 }] }, 'a group counts its n');
  // groups (no findings): a group's path is its first finding's only — matched by clipper alone, never by a path segment
  const group = { kind: 'TEXT CLIPPED', n: 3, clipper: 'div.inner', path: 'main > div.rail > div.card > p' };
  assert.deepEqual(clipAllowed([group], allow, { byClipper: true }), { n: 0, by: [] }, 'the path segment is not trusted for a group');
  assert.deepEqual(clipAllowed([{ ...group, clipper: 'div.card__body' }], allow, { byClipper: true }).n, 3);
});

check('the default file is the site-wide presence path live-session reads (when it exports SITE_PRESENCE)', () => {
  assert.equal(DEFAULT_FILE, 'stardust/replica/presence.json');
  if ('SITE_PRESENCE' in liveSession) assert.equal(liveSession.SITE_PRESENCE, DEFAULT_FILE);
});

// ---- end-to-end: suggest and add --verify on pages served from this process (only where playwright is importable) ----
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { chromium = null; }
if (!chromium) console.log('skip  end-to-end suggest / add --verify (playwright not importable here; run this test in an environment that has it)');
else {
  // the delayed bar: an empty location-bar wrapper, the first body-level in-flow block above the header, that a geo
  // lookup fills 4 s after load — later than the settle, so only the poll finds the bar
  const DELAYED = '<!doctype html><html><head><style>body{margin:0;font:16px/20px sans-serif} .geo-bar{height:88px;background:#eee} header{height:60px;background:#333;color:#fff}</style></head><body>'
    + '<script>addEventListener(\'load\', () => setTimeout(() => { document.querySelector(\'.bar__wrapper\').innerHTML = \'<div class="geo-bar">Use the site for your region?</div>\'; }, 4000));</script>'
    + '<section class="bar__wrapper"></section><header>Header</header><main><p>Content</p></main></body></html>';
  // a fixed consent-style banner the default dismissal leaves alone: no label of the consent tables, no dialog role, no
  // modal / popup marker — its controls are the dismiss candidates; the header link and the in-content button are not
  // in an overlay, and the off-page link sorts after the controls that stay on the page
  const CONSENT = '<!doctype html><html><head><style>body{margin:0;font:16px/20px sans-serif} header{height:60px} .cookie-banner{position:fixed;left:0;right:0;bottom:0;padding:16px;background:#fff;border-top:1px solid #ccc}</style></head><body>'
    + '<header><a href="/home">Home</a></header><main><p>Content</p><button class="cta">Read more</button></main>'
    + '<div id="site-notice" class="cookie-banner"><p>We use cookies.</p><a href="/privacy">Privacy policy</a>'
    + '<button class="banner-btn primary">Continue to site</button><button class="banner-btn">Preferences</button>'
    + '<button class="banner-x" aria-label="Close notice">×</button></div></body></html>';
  const server = createServer((req, res) => {
    if (req.url === '/challenge') { res.writeHead(403, { 'content-type': 'text/html', 'cf-ray': '0-TEST' }); res.end('<html><body>Just a moment…</body></html>'); return; }
    if (req.url === '/missing') { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html><body>Not found</body></html>'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/consent' ? CONSENT : DELAYED);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/delayed-bar`;
  const consentUrl = `${base}/consent`;
  const collect = (child) => new Promise((done) => {
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => done({ code, out, err }));
  });
  const runAsync = (cwd, args) => collect(spawn(process.execPath, [SCRIPT, ...args], { cwd, env: baseEnv() }));
  // a printed `presence.mjs add …` line run as a shell would run it — the quoting is part of what is tested
  const runPrinted = (cwd, line) => collect(spawn('/bin/sh', ['-c', `${shellArg(process.execPath)} ${shellArg(SCRIPT)} ${line.replace(/^presence\.mjs /, '')}`], { cwd, env: baseEnv() }));
  const seeded = () => { const root = project(); write(root, DEFAULT_FILE, pretty({ '*': { hide: ['.promo'] } })); return root; };
  try {
    const right = seeded(); const wrong = seeded(); const blocked = seeded(); const missing = seeded(); const plain2 = project();
    const stale = project();
    write(stale, DEFAULT_FILE, pretty({ '*': { hide: ['.geo-bar', '.location-bar'] } }));
    const settled = project(); const unsettled = project(); const consentMiss = seeded();
    const [okSettings, refusedSettings, dismissMiss] = await Promise.all([
      runAsync(settled, ['add', '--dismiss', '.geo-bar', '--pin', 'header', '--state', 'at rest', '--verify', url, '--reason', 'R-02']),
      runAsync(unsettled, ['add', '--dismiss', '.geo-bar,.nl-close', '--verify', url, '--wait-ms', '0']),
      runAsync(consentMiss, ['add', '--dismiss', 'button.not-there', '--verify', consentUrl, '--wait-ms', '0']),
    ]);
    await checkAsync('e2e add --verify with capture settings: every selector of the call polled like a hide (the delayed bar found), written; one that never matches refuses the call — exit 2, named, nothing written', async () => {
      assert.equal(okSettings.code, 0, okSettings.err);
      assert.deepEqual(lines(okSettings.out), [`verified on ${url} @ 1440px: .geo-bar ×1, header ×1`, '*.dismiss: .geo-bar', '*.pin: header → at rest', `wrote ${DEFAULT_FILE}: +2 settings, 2 reasons`]);
      assert.equal(refusedSettings.code, 2, refusedSettings.out);
      assert.deepEqual(lines(refusedSettings.err), [
        `presence: dismiss / pin / allow matched nothing on ${url} @ 1440px (.geo-bar, .nl-close)`,
        `presence: suggest on ${url} @ 1440px — no dismiss candidate found for --dismiss .geo-bar`,
        `presence: suggest on ${url} @ 1440px — no dismiss candidate found for --dismiss .nl-close`,
        `presence: refused — nothing written to ${DEFAULT_FILE}`,
      ], '--wait-ms 0: one look, before the bar arrives; the page has no control to suggest');
      assert.deepEqual(listing(unsettled), []);
    });
    // the consent banner's controls as a miss lists them: close-like first, then the other controls in the fixed banner in
    // document order — the off-page link after them; the header link and the in-content button are in no overlay
    const DISMISS_TOP = [
      'presence:   button[aria-label="Close notice"]  "×"  button',
      `presence:     presence.mjs add --dismiss 'button[aria-label="Close notice"]' --verify ${consentUrl} --wait-ms 0`,
      'presence:   #site-notice button.primary  "Continue to site"  button',
      `presence:     presence.mjs add --dismiss '#site-notice button.primary' --verify ${consentUrl} --wait-ms 0`,
      'presence:   body > div:nth-of-type(1) > button:nth-of-type(2)  "Preferences"  button',
      `presence:     presence.mjs add --dismiss 'body > div:nth-of-type(1) > button:nth-of-type(2)' --verify ${consentUrl} --wait-ms 0`,
    ];
    await checkAsync('e2e add --dismiss that matches nothing: exit 2, nothing written, the top three overlay controls the default dismissal left on the same page, each with its add command — the first one, run as printed, verifies and writes', async () => {
      assert.equal(dismissMiss.code, 2, `${dismissMiss.out}${dismissMiss.err}`);
      assert.deepEqual(lines(dismissMiss.err), [
        `presence: dismiss / pin / allow matched nothing on ${consentUrl} @ 1440px (button.not-there)`,
        `presence: suggest on ${consentUrl} @ 1440px — top candidates for --dismiss button.not-there:`,
        ...DISMISS_TOP,
        `presence: refused — nothing written to ${DEFAULT_FILE}`,
      ]);
      assert.equal(dismissMiss.out, '');
      assert.equal(read(consentMiss), pretty({ '*': { hide: ['.promo'] } }));
      const first = lines(dismissMiss.err).find((l) => /^presence: +presence\.mjs add /.test(l)).replace(/^presence: +/, '');
      const r = await runPrinted(consentMiss, first);
      assert.equal(r.code, 0, `${first}\n${r.err}`);
      assert.deepEqual(lines(r.out), [`verified on ${consentUrl} @ 1440px: button[aria-label="Close notice"] ×1`, '*.dismiss: button[aria-label="Close notice"]', `wrote ${DEFAULT_FILE}: +1 setting, 0 reasons`]);
      assert.deepEqual(json(consentMiss)['*'], { hide: ['.promo'], dismiss: ['button[aria-label="Close notice"]'] });
    });
    const [ok, refused, listed, challengedAdd, challengedSuggest, notFound] = await Promise.all([
      runAsync(right, ['add', '--hide', '.geo-bar', '--verify', url]),
      runAsync(wrong, ['add', '--hide', '.location-bar', '--verify', url, '--reason', 'R-04']),
      runAsync(stale, ['suggest', url]),
      runAsync(blocked, ['add', '--hide', '.geo-bar', '--verify', `${base}/challenge`]),
      runAsync(plain2, ['suggest', `${base}/challenge`]),
      runAsync(missing, ['add', '--hide', '.geo-bar', '--verify', `${base}/missing`]),
    ]);
    await checkAsync('e2e add --verify: the right selector verifies once the delayed bar arrives — written, no warning', async () => {
      assert.equal(ok.code, 0, ok.err);
      assert.deepEqual(lines(ok.out), [`verified on ${url} @ 1440px: .geo-bar ×1`, '*.hide: .promo, .geo-bar', `wrote ${DEFAULT_FILE}: +1 selector, 0 reasons`]);
      assert.equal(ok.err, '');
      assert.deepEqual(json(right)['*'].hide, ['.promo', '.geo-bar']);
    });
    await checkAsync('e2e add --verify: the old wrong selector exits 2 with the wrapper as a candidate (hideMissLine), then the suggest block (text, role, the add command with the call\'s --reason) — the file untouched', async () => {
      assert.equal(refused.code, 2, `${refused.out}${refused.err}`);
      assert.deepEqual(lines(refused.err), [
        'presence: hide matched nothing on live — candidates: section.bar__wrapper (section, 88px) (.location-bar)',
        `presence: suggest on ${url} @ 1440px — top candidates for --hide .location-bar:`,
        'presence:   section.bar__wrapper  "Use the site for your region?"  region',
        `presence:     presence.mjs add --hide section.bar__wrapper --reason R-04 --verify ${url}`,
        `presence: refused — nothing written to ${DEFAULT_FILE}`,
      ]);
      assert.equal(refused.out, '');
      assert.equal(read(wrong), pretty({ '*': { hide: ['.promo'] } }));
      assert.deepEqual(listing(join(wrong, 'stardust/replica')), ['presence.json']);
    });
    await checkAsync('e2e suggest: the wrapper listed first, then the add line for it; a "*".hide selector that matches nothing is warned on (exit 0), nothing written', async () => {
      assert.equal(listed.code, 0, listed.err);
      assert.deepEqual(lines(listed.out), [
        'section.bar__wrapper  section  88px',
        `presence.mjs add --hide section.bar__wrapper --verify ${url}`,
      ], 'the header\'s only preceding in-flow block (the script is skipped), read after the poll — filled by then');
      assert.equal(listed.err, 'presence: WARNING hide matched nothing on live — candidates: section.bar__wrapper (section, 88px) (.location-bar)\n', '.geo-bar arrived during the poll and is not named');
      assert.equal(read(stale), pretty({ '*': { hide: ['.geo-bar', '.location-bar'] } }));
      assert.deepEqual(listing(stale), ['stardust', 'stardust/replica', 'stardust/replica/presence.json']);
    });
    await checkAsync('e2e: a bot challenge exits 3 (suggest and add --verify), an HTTP error exits 1 — never read as the page, nothing written', async () => {
      for (const r of [challengedAdd, challengedSuggest]) {
        assert.equal(r.code, 3, `${r.out}${r.err}`);
        assert.match(r.err, /^presence: bot challenge at http:\/\/127\.0\.0\.1:\d+\/challenge: HTTP 403 \+ /);
        assert.equal(r.out, '');
      }
      assert.equal(notFound.code, 1, `${notFound.out}${notFound.err}`);
      assert.match(notFound.err, /^presence: cannot load http:\/\/127\.0\.0\.1:\d+\/missing \(HTTP 404 at /);
      for (const root of [blocked, missing]) assert.equal(read(root), pretty({ '*': { hide: ['.promo'] } }));
      assert.deepEqual(listing(plain2), []);
    });
  } finally {
    server.close();
  }
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${checks} checks failing` : `\npresence: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
