#!/usr/bin/env node
// skills/stardust/scripts/test/unit-commit.test.mjs — the unit-commit.mjs contract, with real git in
// temp dirs (a bare remote + clones; children get HOME=<tmp>, GIT_CONFIG_NOSYSTEM=1 and a ceiling so
// no user or system config leaks in): the pure helpers (paths parsing, sidecar naming, the candidate
// set, lock judgement, the 180 s network deadline); --help writes nothing, and answers in a copy without
// deploy's eds-path.mjs beside it (a run there exits 2); usage errors; a missing .paths stages nothing; a unit
// commits exactly its set while an unrelated pre-staged file stays staged and out of the commit;
// --code blocks/<name> adds exactly that block directory's non-ignored files (header, footer and
// anything outside blocks/<kebab-name> refused, a missing directory refused); nothing to commit; nothing new but ahead → push only; a live lock times out naming its owner; a
// dead-pid or untouched lock is reaped; a failing commit unstages the set; two concurrent --push
// callers queued on one lock (the upstream moved, so one really rebases) both land, each printing the
// sha that is on the remote, each commit within its unit's set, no lock left; with the upstream
// unmoved a staged modification of a tracked file stays staged (no stash round trip); SIGTERM during
// a git step stops the run after that step (commit kept, push never started); a push the remote keeps
// refusing stops after 3 retries; an autostash that does not re-apply stops before the
// push and the next run refuses the unmerged file; a rebase conflict is aborted with the local commit
// kept; no upstream → committed, not pushed. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeDir, judgeLock, NET_DEADLINE_MS, parseOwner, parsePaths, pastNetDeadline, safeRel, sidecarFor, stageCandidates, STALE_MS } from '../unit-commit.mjs';
import { pathKey } from '../../../deploy/scripts/eds-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'unit-commit.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'unit-commit-test-')));
const home = join(root, 'home'); mkdirSync(home);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: root });

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runAsync = (cwd, ...args) => {
  const c = spawn(process.execPath, [SCRIPT, ...args], { cwd, env });
  const live = { out: '', err: '' };
  c.stdout.on('data', (d) => { live.out += d; }); c.stderr.on('data', (d) => { live.err += d; });
  const done = new Promise((resolveDone) => { c.on('close', (code) => resolveDone({ code, out: live.out, err: live.err })); });
  return { child: c, live, done };
};
const until = async (what, ok, ms = 60000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => { setTimeout(r, 50); }); }
};
const oneLine = (r) => assert.equal(r.out.split('\n').filter(Boolean).length, 1, `exactly one stdout line, got:\n${r.out}\nstderr:\n${r.err}`);

const remote = join(root, 'remote.git');
const clone = join(root, 'clone');
const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const configure = (dir) => { git(dir, 'config', 'user.name', 'Unit Commit Test'); git(dir, 'config', 'user.email', 'unit-commit@example.com'); git(dir, 'config', 'commit.gpgsign', 'false'); };
const filesOf = (dir, rev) => git(dir, 'show', '--name-only', '--format=', rev).split('\n').filter(Boolean).sort();
const staged = () => git(clone, 'diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();
const head = (dir = clone) => git(dir, 'rev-parse', 'HEAD');
const subject = (rev = 'HEAD') => git(clone, 'log', '-1', '--format=%s', rev);
const lockFile = join(clone, 'stardust', '.work', 'git.lock');
const noLockLeft = () => {
  const work = join(clone, 'stardust', '.work');
  const left = existsSync(work) ? readdirSync(work).filter((f) => f.startsWith('git.lock')) : [];
  assert.deepEqual(left, [], 'no lock (nor a reaped lock set aside) left behind');
};

const C1_SET = [
  'content/a.html', 'content/a/index.html', 'content/b.html',
  'stardust/deploy/media-ledger.json', 'stardust/eds-schema/a.json',
  'stardust/migrated/a._meta.json', 'stardust/migrated/b-meta.json',
  'stardust/rollout/coverage/blocks.json', 'stardust/rollout/coverage/pages.json',
  'stardust/rollout/progress.json', 'stardust/rollout/units/c1.paths',
];
const C2_SET = [
  'content/c.html', 'stardust/deploy/media-ledger.json', 'stardust/migrated/c/_meta.json',
  'stardust/rollout/coverage/blocks.json', 'stardust/rollout/coverage/pages.json',
  'stardust/rollout/progress.json', 'stardust/rollout/units/c2.paths',
];
const subset = (files, set, label) => { const extra = files.filter((f) => !set.includes(f)); assert.deepEqual(extra, [], `${label}: files outside the unit's set`); };

// ---- pure helpers -------------------------------------------------------------------------------
check('parsePaths: trimmed lines, blank and # lines skipped', () => {
  assert.deepEqual(parsePaths('# cluster c1\n/a\n\n  /b/  \r\n#/c\n'), ['/a', '/b/']);
  assert.deepEqual(parsePaths(''), []);
});
check('sidecarFor: index.html → _meta.json, <name>.html → <name>._meta.json, origin markers → null', () => {
  assert.equal(sidecarFor('stardust/migrated/docs/index.html'), 'stardust/migrated/docs/_meta.json');
  assert.equal(sidecarFor('stardust/migrated/about.html'), 'stardust/migrated/about._meta.json');
  assert.equal(sidecarFor('search:results'), null);
  assert.equal(sidecarFor(null), null);
});
check('stageCandidates: content docs per pathKey, the matching row\'s schema + sidecar (metaJson first), shared bookkeeping', () => {
  const rows = [
    { slug: 'home', path: '/', source: { migratedHtml: 'stardust/migrated/index.html', metaJson: null } },
    { slug: 'a', path: '/a/', source: { migratedHtml: 'stardust/migrated/a.html', metaJson: null } },
    { slug: 'b', path: '/b', source: { migratedHtml: 'stardust/migrated/b.html', metaJson: 'stardust/migrated/b-meta.json' } },
    { slug: 'n', path: '/n', source: { migratedHtml: 'search:n', metaJson: null } },
    { slug: 'x', path: '/x', source: { migratedHtml: 'stardust/migrated/x.html' } },
  ];
  const { files, notes } = stageCandidates({ unit: 'u1', lines: ['/', '/A.html', '/b/index', '/n', '/../etc'], rows, coverageFiles: ['stardust/rollout/coverage/pages.json'], pathKey });
  assert.deepEqual(files, [
    'content/index.html', 'stardust/eds-schema/home.json', 'stardust/migrated/_meta.json',
    'content/a.html', 'content/a/index.html', 'stardust/eds-schema/a.json', 'stardust/migrated/a._meta.json',
    'content/b.html', 'content/b/index.html', 'stardust/eds-schema/b.json', 'stardust/migrated/b-meta.json',
    'content/n.html', 'content/n/index.html', 'stardust/eds-schema/n.json',
    'stardust/rollout/coverage/pages.json', 'stardust/rollout/progress.json', 'stardust/deploy/media-ledger.json', 'stardust/rollout/units/u1.paths',
  ]);
  assert.equal(notes.length, 1); assert.match(notes[0], /\.\. segment/);
});
check('pastNetDeadline: a network step may start until 180 s after the script started, not at or after it', () => {
  assert.equal(NET_DEADLINE_MS, 180_000);
  const t0 = 1_000_000;
  assert.equal(pastNetDeadline(t0, t0), false);
  assert.equal(pastNetDeadline(t0, t0 + 179_999), false);
  assert.equal(pastNetDeadline(t0, t0 + 180_000), true);
  assert.equal(pastNetDeadline(t0, t0 + 120_000 + 4 * 60_000), true, 'a 120 s lock wait plus rounds never starts a step past the deadline');
  assert.equal(pastNetDeadline(t0, t0 + 5_000, 5_000), true);
});
check('safeRel: clean relative paths inside the tree; escapes and blanks → null', () => {
  assert.equal(safeRel('stardust/./migrated/a._meta.json', root), 'stardust/migrated/a._meta.json');
  assert.equal(safeRel(join(root, 'content', 'a.html'), root), 'content/a.html');
  assert.equal(safeRel('../outside.json', root), null);
  assert.equal(safeRel('/etc/hosts', root), null);
  assert.equal(safeRel('  ', root), null);
});
check('codeDir: blocks/<kebab-name> (trailing slash dropped); header, footer and anything else refused', () => {
  assert.equal(codeDir('blocks/cards'), 'blocks/cards');
  assert.equal(codeDir('blocks/cards-2/'), 'blocks/cards-2');
  for (const bad of ['blocks/header', 'blocks/footer/']) assert.throws(() => codeDir(bad), /frozen foundation/);
  for (const bad of ['styles', 'blocks', 'blocks/', 'blocks/Cards', 'blocks/a/b', 'blocks/../x', './blocks/cards', 'blocks/-x', '']) assert.throws(() => codeDir(bad), /must be blocks\/<kebab-name>/, bad);
});
check('parseOwner + judgeLock: dead pid on this host or untouched past the limit is stale; live, foreign or young unknown is not', () => {
  const o = parseOwner('{"pid":123,"host":"h1","at":"2026-01-01T00:00:00.000Z","unit":"c2"}');
  assert.deepEqual(o, { pid: 123, host: 'h1', at: '2026-01-01T00:00:00.000Z', unit: 'c2' });
  assert.deepEqual(parseOwner('77 h2 2026-01-01T00:00:00Z'), { pid: 77, host: 'h2', at: '2026-01-01T00:00:00Z', unit: null });
  assert.equal(parseOwner(''), null); assert.equal(parseOwner('garbage'), null);
  assert.equal(parseOwner('{"pid":0,"host":"h1"}').pid, null);
  const dead = () => false; const alive = () => true;
  assert.match(judgeLock({ owner: o, ageMs: 1000, host: 'h1', alive: dead }), /pid 123 is not running on h1/);
  assert.equal(judgeLock({ owner: o, ageMs: 1000, host: 'h1', alive }), null);
  assert.equal(judgeLock({ owner: o, ageMs: 1000, host: 'other', alive: dead }), null, 'a pid on another host is never judged by kill -0');
  assert.match(judgeLock({ owner: o, ageMs: STALE_MS + 1, host: 'h1', alive }), /untouched for over 300 s/);
  assert.equal(judgeLock({ owner: null, ageMs: 50, host: 'h1', alive: dead }), null, 'a lock still being written is respected');
});

// ---- the repos ----------------------------------------------------------------------------------
try {
  git(root, '-c', 'init.defaultBranch=main', 'init', '-q', '--bare', remote);
  git(root, '-c', 'init.defaultBranch=main', 'init', '-q', clone);
  configure(clone);
  put(clone, 'README.md', 'project\n');
  put(clone, 'tracked.txt', 'tracked v1\n');
  put(clone, '.gitignore', 'stardust/eds-schema/b.json\n*.map\n');
  put(clone, 'stardust/.gitignore', '.work/\n');
  git(clone, 'add', '--', 'README.md', 'tracked.txt', '.gitignore', 'stardust/.gitignore');
  git(clone, 'commit', '-q', '-m', 'init');
  git(clone, 'remote', 'add', 'origin', remote);
  git(clone, 'push', '-q', '-u', 'origin', 'main');
  for (const p of ['a', 'b', 'c', 'z']) put(clone, `content/${p}.html`, `<main><h1>${p}</h1></main>\n`);
  put(clone, 'content/a/index.html', '<main><h1>a index</h1></main>\n');
  put(clone, 'stardust/rollout/coverage/pages.json', `${JSON.stringify({ pages: [
    { slug: 'a', path: '/a/', source: { migratedHtml: 'stardust/migrated/a.html', metaJson: null } },
    { slug: 'b', path: '/b.html', source: { migratedHtml: 'stardust/migrated/b.html', metaJson: 'stardust/migrated/b-meta.json' } },
    { slug: 'c', path: '/c', source: { migratedHtml: 'stardust/migrated/c/index.html', metaJson: null } },
  ] }, null, 2)}\n`);
  put(clone, 'stardust/rollout/coverage/blocks.json', '{"blocks":[]}\n');
  put(clone, 'stardust/rollout/progress.json', '{"units":{"c1":{"status":"running"},"c2":{"status":"running"}}}\n');
  put(clone, 'stardust/deploy/media-ledger.json', '{}\n');
  put(clone, 'stardust/eds-schema/a.json', '{}\n');
  put(clone, 'stardust/eds-schema/b.json', '{}\n'); // git-ignored: never staged
  for (const f of ['a.html', 'a._meta.json', 'b.html', 'b._meta.json', 'b-meta.json', 'c/index.html', 'c/_meta.json']) put(clone, `stardust/migrated/${f}`, '{}\n');
  put(clone, 'stardust/rollout/units/c1.paths', '# cluster c1\n/a\n\n/b\n');
  put(clone, 'stardust/rollout/units/c2.paths', '/c\n');
  put(clone, 'notes.txt', 'unrelated\n');
  put(clone, 'other.txt', 'someone else staged this\n');
  git(clone, 'add', '--', 'other.txt');
  const empty = join(root, 'empty'); mkdirSync(empty);

  // ---- CLI ----------------------------------------------------------------------------------------
  check('--help: exit 0, usage, lock and exit codes, writes nothing', () => {
    const r = run(empty, '--help');
    assert.equal(r.code, 0);
    assert.match(r.out, /Usage:/); assert.match(r.out, /stardust\/\.work\/git\.lock/); assert.match(r.out, /Writes:/); assert.match(r.out, /Exit codes:/);
    assert.deepEqual(readdirSync(empty), []);
    assert.equal(run(empty, 'c1', '-h').code, 0);
    assert.deepEqual(readdirSync(empty), []);
  });
  check('a copy without deploy\'s eds-path.mjs beside it (a project copy before the deploy scripts): --help exit 0; a run → exit 2, one line', () => {
    const lone = join(root, 'lone', 'stardust', 'scripts', 'stardust'); mkdirSync(lone, { recursive: true });
    copyFileSync(SCRIPT, join(lone, 'unit-commit.mjs'));
    const runLone = (...args) => { const r = spawnSync(process.execPath, [join(lone, 'unit-commit.mjs'), ...args], { cwd: empty, env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
    const h = runLone('--help');
    assert.equal(h.code, 0, h.err); assert.match(h.out, /Usage:/);
    const r = runLone('c1');
    assert.equal(r.code, 2, r.err); oneLine(r); assert.match(r.out, /eds-path\.mjs not found beside this script .*nothing staged/);
    assert.deepEqual(readdirSync(empty), []);
  });
  check('usage: no unit, a bad unit name, unknown flag, bad number, a value flag without value, outside a work tree → exit 2, one line', () => {
    for (const args of [[], ['../x'], ['c1', 'c2'], ['c1', '--bogus'], ['c1', '--wait-s', 'abc'], ['c1', '--wait-s', '-1'], ['c1', '--message'], ['c1', '--message', '--push'], ['c1', '--code'], ['c1', '--code', 'styles'], ['c1', '--code', 'blocks/header']]) {
      const r = run(clone, ...args);
      assert.equal(r.code, 2, `args ${JSON.stringify(args)}: ${r.out}`); oneLine(r);
    }
    const r = run(empty, 'c1');
    assert.equal(r.code, 2); oneLine(r); assert.match(r.out, /not inside a git work tree/);
    assert.deepEqual(readdirSync(empty), []);
  });
  check('missing units/<unit>.paths → exit 2, nothing staged, no commit', () => {
    const before = head();
    const r = run(clone, 'c9');
    assert.equal(r.code, 2); oneLine(r);
    assert.equal(r.out, "unit-commit c9: no stardust/rollout/units/c9.paths — write the unit's page list first; nothing staged\n");
    assert.equal(head(), before); assert.deepEqual(staged(), ['other.txt']);
  });
  check('c1: commits exactly its set; another unit\'s pages, unrelated and ignored files stay out; the pre-staged file stays staged', () => {
    const r = run(clone, 'c1');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c1: committed [0-9a-f]{7} \(11 files\)\n$/);
    assert.deepEqual(filesOf(clone, 'HEAD'), C1_SET);
    assert.equal(subject(), 'C-deliver unit c1: 2 pages, 11 files');
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  check('c1 again, unchanged → exit 2 nothing to commit', () => {
    const before = head();
    const r = run(clone, 'c1');
    assert.equal(r.code, 2); assert.equal(r.out, 'unit-commit c1: nothing to commit\n');
    assert.equal(head(), before);
  });
  check('--code blocks/cards: exactly that block directory\'s non-ignored files join the commit; header, footer, other dirs and a missing block → exit 2, nothing staged', () => {
    for (const f of ['cards.js', 'cards.css', 'lib/util.js']) put(clone, `blocks/cards/${f}`, `/* ${f} */\n`);
    put(clone, 'blocks/cards/cards.js.map', '{}\n'); // git-ignored (*.map)
    put(clone, 'blocks/hero/hero.js', '/* another cluster */\n');
    put(clone, 'blocks/header/header.js', '/* frozen */\n');
    const before = head();
    for (const [args, re] of [[['--code', 'blocks/header'], /frozen foundation/], [['--code', 'blocks/footer/'], /frozen foundation/], [['--code', 'styles'], /must be blocks\/<kebab-name>/], [['--code', 'blocks/nope'], /--code blocks\/nope: no such directory/]]) {
      const r = run(clone, 'c1', ...args);
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`); oneLine(r); assert.match(r.out, re);
    }
    assert.equal(head(), before); assert.deepEqual(staged(), ['other.txt']);
    const r = run(clone, 'c1', '--code', 'blocks/cards/');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c1: committed [0-9a-f]{7} \(3 files\)\n$/);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['blocks/cards/cards.css', 'blocks/cards/cards.js', 'blocks/cards/lib/util.js']);
    assert.equal(git(clone, 'status', '--porcelain', '--', 'blocks/hero', 'blocks/header'), '?? blocks/header/\n?? blocks/hero/', 'the other block dirs stay untracked');
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  check('c1 --push, nothing new but ahead of upstream → push only, exit 0; then not ahead → exit 2', () => {
    const r = run(clone, 'c1', '--push');
    assert.equal(r.code, 0, r.out + r.err); assert.equal(r.out, 'unit-commit c1: nothing new; pushed\n');
    assert.equal(git(remote, 'rev-parse', 'main'), head());
    const again = run(clone, 'c1', '--push');
    assert.equal(again.code, 2); oneLine(again); assert.match(again.out, /nothing to commit/);
    noLockLeft();
  });
  check('a fresh lock held by a live pid, --wait-s 1 → exit 2 naming the lock and owner; nothing staged or committed; the lock kept', () => {
    put(clone, 'content/b.html', '<main><h1>b v2</h1></main>\n');
    const owner = `${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), unit: 'c7' })}\n`;
    put(clone, 'stardust/.work/git.lock', owner);
    const before = head();
    const r = run(clone, 'c1', '--wait-s', '1');
    assert.equal(r.code, 2); oneLine(r);
    assert.match(r.out, /stardust\/\.work\/git\.lock/); assert.match(r.out, new RegExp(`pid ${process.pid}`)); assert.match(r.out, /unit c7/);
    assert.equal(head(), before); assert.deepEqual(staged(), ['other.txt']);
    assert.equal(readFileSync(lockFile, 'utf8'), owner);
    rmSync(lockFile);
  });
  check('a lock owned by a dead pid on this host → reaped, exit 0', () => {
    const deadPid = spawnSync(process.execPath, ['-e', '0']).pid;
    put(clone, 'stardust/.work/git.lock', `${JSON.stringify({ pid: deadPid, host: hostname(), at: new Date().toISOString(), unit: 'c7' })}\n`);
    const r = run(clone, 'c1', '--wait-s', '5');
    assert.equal(r.code, 0, r.out + r.err); assert.match(r.out, /^unit-commit c1: committed [0-9a-f]{7} \(1 files\)\n$/);
    assert.match(r.err, /reaped a stale/);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['content/b.html']);
    noLockLeft();
  });
  check('a lock untouched for over 300 s → reaped even with a live pid, exit 0', () => {
    put(clone, 'content/b.html', '<main><h1>b v3</h1></main>\n');
    put(clone, 'stardust/.work/git.lock', `${JSON.stringify({ pid: process.pid, host: hostname(), at: '2026-01-01T00:00:00.000Z', unit: 'c7' })}\n`);
    const old = new Date(Date.now() - (STALE_MS + 60000));
    utimesSync(lockFile, old, old);
    const r = run(clone, 'c1', '--wait-s', '5');
    assert.equal(r.code, 0, r.out + r.err); assert.match(r.err, /untouched for over 300 s/);
    noLockLeft();
  });
  check('a failing commit (pre-commit hook) → exit 2, the set unstaged, the pre-staged file still staged, nothing committed', () => {
    const hook = join(clone, '.git', 'hooks', 'pre-commit');
    put(clone, '.git/hooks/pre-commit', '#!/bin/sh\necho refused-by-test >&2\nexit 1\n'); chmodSync(hook, 0o755);
    put(clone, 'content/b.html', '<main><h1>b v4</h1></main>\n');
    const before = head();
    const r = run(clone, 'c1');
    rmSync(hook);
    assert.equal(r.code, 2, r.out + r.err); oneLine(r);
    assert.equal(r.out, 'unit-commit c1: commit failed; the set was unstaged, nothing committed\n');
    assert.match(r.err, /refused-by-test/);
    assert.equal(head(), before); assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  const clone2 = join(root, 'clone2');
  await checkAsync('two concurrent --push callers (c1 after an edit, c2) queued on one lock, upstream moved → both exit 0, each names its commit as on the remote, each commit within its set, no lock left', async () => {
    // another clone moves the upstream first, so whichever caller pushes first must really rebase
    git(root, 'clone', '-q', remote, clone2); configure(clone2);
    put(clone2, 'their.txt', 'their unrelated file\n');
    git(clone2, 'add', '--', 'their.txt'); git(clone2, 'commit', '-q', '-m', 'their file'); git(clone2, 'push', '-q');
    put(clone, 'content/a.html', '<main><h1>a v2</h1></main>\n');
    const pushedBefore = git(remote, 'rev-parse', 'main');
    // hold the lock until both callers report they are waiting for it, then free it: they race for it
    put(clone, 'stardust/.work/git.lock', `${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), unit: 'test' })}\n`);
    const a = runAsync(clone, 'c1', '--push'); const b = runAsync(clone, 'c2', '--push', '--message', 'deliver c2 pages');
    await until('both callers waiting for the lock', () => /waiting up to 120s/.test(a.live.err) && /waiting up to 120s/.test(b.live.err));
    rmSync(lockFile);
    const [r1, r2] = await Promise.all([a.done, b.done]);
    for (const r of [r1, r2]) { assert.equal(r.code, 0, r.out + r.err); oneLine(r); assert.match(r.out, /committed [0-9a-f]{7} \(\d+ files\), pushed\n$/); }
    assert.equal(git(remote, 'rev-parse', 'main'), head());
    const commits = git(remote, 'log', '--format=%H%x09%s', `${pushedBefore}..main`).split('\n').filter(Boolean).map((l) => l.split('\t'));
    const c1 = commits.filter(([, s]) => s.startsWith('C-deliver unit c1:'));
    const c2 = commits.filter(([, s]) => s === 'deliver c2 pages');
    assert.ok(c1.length >= 1 && c2.length === 1, `both units' commits are on the remote: ${commits.map(([, s]) => s).join(' | ')}`);
    // the printed sha is the commit as pushed (a rebase rewrites it), never the orphaned pre-rebase one
    for (const [r, subj] of [[r1, /^C-deliver unit c1: 2 pages, \d+ files$/], [r2, /^deliver c2 pages$/]]) {
      const printed = r.out.match(/committed ([0-9a-f]{7})/)[1];
      const onRemote = commits.find(([sha]) => sha.startsWith(printed));
      assert.ok(onRemote, `printed ${printed} is a commit on the remote (${commits.map(([sha, s]) => `${sha.slice(0, 7)} ${s}`).join(' | ')})`);
      assert.match(onRemote[1], subj);
    }
    for (const [sha] of c1) subset(filesOf(remote, sha), C1_SET, `c1 ${sha}`);
    subset(filesOf(remote, c2[0][0]), C2_SET, 'c2');
    assert.ok(filesOf(remote, c2[0][0]).includes('content/c.html'));
    assert.ok(filesOf(remote, c1[0][0]).includes('content/a.html'));
    assert.ok(!commits.some(([sha]) => filesOf(remote, sha).some((f) => ['content/z.html', 'notes.txt', 'other.txt'].includes(f))), 'unrelated files never pushed');
    assert.equal(readFileSync(join(clone, 'notes.txt'), 'utf8'), 'unrelated\n');
    assert.deepEqual(staged(), ['other.txt'], 'the pre-staged file is still staged after the autostash round trip');
    noLockLeft();
  });
  check('--push with the upstream unmoved: no stash round trip — a staged modification of a tracked file stays staged', () => {
    put(clone, 'tracked.txt', 'tracked v2, staged by someone else\n');
    git(clone, 'add', '--', 'tracked.txt');
    put(clone, 'content/b.html', '<main><h1>b v4b</h1></main>\n');
    const r = run(clone, 'c1', '--push');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    const m = r.out.match(/^unit-commit c1: committed ([0-9a-f]{7}) \(1 files\), pushed\n$/);
    assert.ok(m, r.out);
    assert.equal(git(remote, 'rev-parse', '--short=7', 'main'), m[1]);
    assert.deepEqual(staged(), ['other.txt', 'tracked.txt'], 'the staged tracked modification is still staged');
    assert.equal(git(clone, 'diff', '--name-only'), '', 'and nothing came back as an unstaged change');
    assert.deepEqual(filesOf(clone, 'HEAD'), ['content/b.html']);
    git(clone, 'reset', '-q', '--', 'tracked.txt'); git(clone, 'checkout', '--', 'tracked.txt');
  });
  await checkAsync('SIGTERM during a git step is handled after that step: the commit finishes, the push never starts, exit 2, the lock released', async () => {
    const mark = join(root, 'hook-started');
    const hook = join(clone, '.git', 'hooks', 'pre-commit');
    put(clone, '.git/hooks/pre-commit', `#!/bin/sh\ntouch '${mark}'\nsleep 2\n`); chmodSync(hook, 0o755);
    put(clone, 'content/b.html', '<main><h1>b v4c</h1></main>\n');
    const remoteBefore = git(remote, 'rev-parse', 'main');
    const p = runAsync(clone, 'c1', '--push');
    await until('the pre-commit hook to start', () => existsSync(mark));
    p.child.kill('SIGTERM');
    const r = await p.done;
    rmSync(hook); rmSync(mark);
    assert.equal(r.code, 2, r.out + r.err); oneLine(r);
    const m = r.out.match(/^unit-commit c1: interrupted by SIGTERM; local commit ([0-9a-f]{7}) kept, not pushed\n$/);
    assert.ok(m, r.out);
    assert.equal(git(clone, 'rev-parse', '--short=7', 'HEAD'), m[1]);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['content/b.html']);
    assert.equal(git(remote, 'rev-parse', 'main'), remoteBefore, 'nothing pushed');
    noLockLeft();
  });
  check('a push the remote keeps refusing → exit 2 after 3 retries, the local commit kept and named', () => {
    const hook = join(remote, 'hooks', 'pre-receive');
    put(remote, 'hooks/pre-receive', '#!/bin/sh\necho rejected-by-test >&2\nexit 1\n'); chmodSync(hook, 0o755);
    put(clone, 'content/b.html', '<main><h1>b v5</h1></main>\n');
    const remoteBefore = git(remote, 'rev-parse', 'main');
    const r = run(clone, 'c1', '--push');
    rmSync(hook);
    assert.equal(r.code, 2, r.out + r.err); oneLine(r);
    const m = r.out.match(/^unit-commit c1: push failed after 3 retries; local commit ([0-9a-f]{7}) kept\n$/);
    assert.ok(m, r.out);
    assert.equal(git(clone, 'rev-parse', '--short=7', 'HEAD'), m[1]);
    assert.equal(git(remote, 'rev-parse', 'main'), remoteBefore);
    noLockLeft();
  });
  check('an autostash that does not re-apply → exit 2 before the push; the next run refuses the unmerged file', () => {
    git(clone2, 'pull', '-q');
    put(clone2, 'README.md', 'project, their line\n');
    git(clone2, 'commit', '-q', '-am', 'their readme');
    git(clone2, 'push', '-q');
    put(clone, 'README.md', 'project, an in-progress local edit\n'); // someone else's dirty work in the shared tree
    put(clone, 'content/b.html', '<main><h1>b v6</h1></main>\n');
    const r = run(clone, 'c1', '--push');
    assert.equal(r.code, 2, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c1: rebased, but the autostash did not re-apply cleanly \(kept in git stash list\); local commit [0-9a-f]{7} kept, not pushed\n$/);
    assert.equal(git(remote, 'rev-parse', 'main'), head(clone2), 'nothing of ours pushed');
    assert.match(git(clone, 'stash', 'list'), /autostash/);
    noLockLeft();
    const again = run(clone, 'c1');
    assert.equal(again.code, 2); oneLine(again); assert.match(again.out, /unmerged files in the index \(README\.md\) — resolve them first; nothing staged/);
    // the human's resolution: keep their README, drop the conflicted stash
    git(clone, 'reset', '-q', '--', 'README.md'); git(clone, 'checkout', '--', 'README.md'); git(clone, 'stash', 'drop', '-q');
  });
  check('a rebase conflict on --push → exit 2, aborted (no rebase in progress), lock released, the local commit kept', () => {
    git(clone2, 'pull', '-q');
    put(clone2, 'content/a.html', '<main><h1>a theirs</h1></main>\n');
    git(clone2, 'commit', '-q', '-am', 'their edit');
    git(clone2, 'push', '-q');
    put(clone, 'content/a.html', '<main><h1>a ours</h1></main>\n');
    const r = run(clone, 'c1', '--push');
    assert.equal(r.code, 2, r.out + r.err); oneLine(r);
    const m = r.out.match(/^unit-commit c1: rebase conflict: aborted; local commit ([0-9a-f]{7}) kept, not pushed\n$/);
    assert.ok(m, r.out);
    assert.ok(!existsSync(join(clone, '.git', 'rebase-merge')) && !existsSync(join(clone, '.git', 'rebase-apply')), 'no rebase left in progress');
    noLockLeft();
    assert.equal(git(clone, 'rev-parse', '--short=7', 'HEAD'), m[1]);
    assert.match(subject(), /^C-deliver unit c1: 2 pages, 1 files$/);
    assert.equal(readFileSync(join(clone, 'content/a.html'), 'utf8'), '<main><h1>a ours</h1></main>\n');
    assert.equal(git(remote, 'rev-parse', 'main'), head(clone2), 'nothing of ours pushed');
    assert.ok(existsSync(join(clone, 'other.txt')) && readFileSync(join(clone, 'notes.txt'), 'utf8') === 'unrelated\n', 'the others\' work survives the abort');
  });
  check('--push on a branch without upstream → exit 2, committed, not pushed', () => {
    git(clone, 'switch', '-q', '-c', 'lonely');
    put(clone, 'content/b.html', '<main><h1>b v7</h1></main>\n');
    const r = run(clone, 'c1', '--push');
    assert.equal(r.code, 2, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c1: no upstream for lonely: committed [0-9a-f]{7}, not pushed\n$/);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['content/b.html']);
    noLockLeft();
  });

} finally {
  rmSync(root, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall unit-commit checks passed');
