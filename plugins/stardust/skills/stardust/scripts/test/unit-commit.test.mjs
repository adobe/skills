#!/usr/bin/env node
// skills/stardust/scripts/test/unit-commit.test.mjs — the unit-commit.mjs contract, with real git in
// temp dirs (a bare remote + clones; children get HOME=<tmp>, GIT_CONFIG_NOSYSTEM=1 and a ceiling so
// no user or system config leaks in): the pure helpers (paths parsing, sidecar naming, the candidate
// set — the unit's report, ledger, encoder maps, encoded documents, gate JSON and the shared
// bookkeeping —, the --also rules, lock judgement, the 170 s network deadline — every network step and
// backoff capped to the time left, none started with none left, the worst-case --push schedule under
// 240 s); --help writes nothing, lists the whole stage set and states that bound, and answers in a copy without
// deploy's eds-path.mjs beside it (a run there exits 2); usage errors; a missing .paths stages nothing; a unit
// commits exactly its set — everything it wrote — while an unrelated pre-staged file stays staged and out
// of the commit; a second unit commits only what changed since (a file staged by hand included);
// --also adds a file and a directory's files, and each refusal (absolute, .., content/, blocks/, the
// frozen foundation, .git, the root, missing, a link out of the tree or into content/) stages nothing;
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
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alsoPath, codeDir, ENCODED_DIR, EDS_SCHEMA_DIR, judgeLock, KILL_GRACE_MS, missingSidecars, NET_DEADLINE_MS, NET_TIMEOUT_MS, netBudget, parseOwner, parsePaths, perUnitArea, safeRel, SHARED, sidecarCommand, sidecarFor, sourceUnder, stageCandidates, STALE_MS, worstPushSchedule } from '../unit-commit.mjs';
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

const G = 'stardust/replica/gates';
const RUN_A = `${G}/all-1440/runs/2026-10-18T21-05-09-222Z-a.json`;
const RUN_C = `${G}/all-1440/runs/2026-10-18T21-05-09-222Z-c.json`;
// the shared bookkeeping files the fixture writes (SHARED + one *.json per shared dir)
const SHARED_SET = [
  'stardust/deploy/media-ledger.json', 'stardust/eds-conversion-log.md', 'stardust/migrate/encode/a.json',
  'stardust/migrate/progress.json', 'stardust/redirects.tsv', 'stardust/rollout/coverage/blocks.json',
  'stardust/rollout/coverage/pages.json', 'stardust/rollout/foundation-requests.md', 'stardust/rollout/progress.json',
  'stardust/rollout/rollout.json', 'stardust/rollout/variance/a.json', 'stardust/state.json',
];
const C1_SET = [
  'content/a.html', 'content/a/index.html', 'content/b.html',
  'stardust/deploy/ledger-c1.json', 'stardust/eds-schema/a.json', 'stardust/encoded/a.html', 'stardust/import/a/map.json',
  'stardust/migrated/a._meta.json', 'stardust/migrated/a.html', 'stardust/migrated/b-meta.json', 'stardust/migrated/b.html',
  'stardust/patches/a.json', `${G}/all-1440/a/pixel.json`, `${G}/all-1440/a/rounds.json`, RUN_A,
  'stardust/rollout/units/c1.md', 'stardust/rollout/units/c1.paths', ...SHARED_SET,
].sort();
const C2_SET = [
  'content/c.html', 'stardust/deploy/ledger-c2.json', 'stardust/eds-schema/c.json', 'stardust/encoded/c.html', 'stardust/import/c/map.json',
  'stardust/migrated/c/_meta.json', 'stardust/migrated/c/index.html', `${G}/all-360/c/pixel.json`, RUN_C,
  `${G}/all-1440/triage.json`, `${G}/all-1440/triage.md`, `${G}/all-360/triage.json`,
  'stardust/rollout/units/c2.md', 'stardust/rollout/units/c2.paths', ...SHARED_SET,
].sort();
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
check('missingSidecars: the matched rows (by pathKey, one-name slug) whose eds-schema/<slug>.json is absent, sorted; sidecarCommand names the exact section-schema.mjs run', () => {
  const rows = [
    { slug: 'home', path: '/' }, { slug: 'about', path: '/about' }, { slug: 'news', path: '/news.html' },
    { slug: 'other', path: '/not-in-unit' }, // a row the unit does not deliver → never required
    { slug: '', path: '/blank' }, { path: '/no-slug' }, // no usable slug → not required
  ];
  const lines = ['/', '/about', '/news', '/blank', '/no-slug'];
  const have = new Set(['stardust/eds-schema/home.json']); // only home's sidecar exists
  assert.deepEqual(missingSidecars({ lines, rows, pathKey, exists: (r) => have.has(r) }), ['about', 'news']);
  assert.deepEqual(missingSidecars({ lines, rows, pathKey, exists: () => true }), []);
  assert.equal(sidecarCommand('about'), 'node stardust/scripts/deploy/section-schema.mjs <protoURL> --out stardust/eds-schema/about.json');
  assert.equal(EDS_SCHEMA_DIR, 'stardust/eds-schema');
});
check('stageCandidates: content and encoded docs per pathKey, the matching row\'s schema, sidecar (metaJson first), source HTML and patches, the unit\'s report and ledger, shared bookkeeping — complete, deduped, sorted', () => {
  const rows = [
    { slug: 'home', path: '/', source: { migratedHtml: 'stardust/migrated/index.html', metaJson: null } },
    { slug: 'a', path: '/a/', source: { migratedHtml: 'stardust/migrated/a.html', metaJson: null } },
    { slug: 'a', path: '/a', source: { migratedHtml: './stardust/migrated/a.html', metaJson: null } }, // a duplicate row
    { slug: 'b', path: '/b', source: { migratedHtml: 'stardust/migrated/b.html', metaJson: 'stardust/migrated/b-meta.json' } },
    { slug: 'n', path: '/n', source: { migratedHtml: 'search:n', metaJson: null } },
    { slug: 'x', path: '/x', source: { migratedHtml: 'stardust/migrated/x.html' } },
  ];
  const { files, notes } = stageCandidates({ unit: 'u1', lines: ['/', '/A.html', '/a/', '/b/index', '/n', '/../etc'], rows, sharedJson: ['stardust/rollout/coverage/pages.json'], pathKey });
  assert.deepEqual(files, [
    'content/a.html', 'content/a/index.html', 'content/b.html', 'content/b/index.html', 'content/index.html', 'content/n.html', 'content/n/index.html',
    'stardust/deploy/ledger-u1.json', 'stardust/deploy/media-ledger.json', 'stardust/eds-conversion-log.md',
    'stardust/eds-schema/a.json', 'stardust/eds-schema/b.json', 'stardust/eds-schema/home.json', 'stardust/eds-schema/n.json',
    'stardust/encoded/a.html', 'stardust/encoded/a/index.html', 'stardust/encoded/b.html', 'stardust/encoded/b/index.html', 'stardust/encoded/index.html',
    'stardust/encoded/n.html', 'stardust/encoded/n/index.html', 'stardust/migrate/progress.json',
    'stardust/migrated/_meta.json', 'stardust/migrated/a._meta.json', 'stardust/migrated/a.html', 'stardust/migrated/b-meta.json', 'stardust/migrated/b.html', 'stardust/migrated/index.html',
    'stardust/patches/a.json', 'stardust/patches/b.json', 'stardust/patches/home.json', 'stardust/patches/n.json',
    'stardust/redirects.tsv', 'stardust/rollout/coverage/pages.json', 'stardust/rollout/foundation-requests.md', 'stardust/rollout/progress.json',
    'stardust/rollout/rollout.json', 'stardust/rollout/units/u1.md', 'stardust/rollout/units/u1.paths', 'stardust/state.json',
  ]);
  assert.deepEqual(SHARED, [...SHARED].sort(), 'the shared list is kept sorted');
  assert.equal(notes.length, 1); assert.match(notes[0], /\.\. segment/);
});
check('stageCandidates: the unit\'s templates (progress.json, plus <t> of archetype-<t>) add their encoder maps; the page\'s gate JSON, its own --only runs and the triage pair of each gate dir it was gated in — complete, deduped, sorted', () => {
  const tree = {
    'stardust/import/extra': ['stardust/import/extra/map.json'],
    'stardust/import/post': ['stardust/import/post/encoder.mjs', 'stardust/import/post/map.json'],
    'stardust/import/other': ['stardust/import/other/map.json'],
    [`${G}/all-1440/p1`]: [`${G}/all-1440/p1/origin.png`, `${G}/all-1440/p1/pixel.json`, `${G}/all-1440/p1/rounds.json`, `${G}/all-1440/p1/rounds.lock`],
    [`${G}/all-360/p1`]: [`${G}/all-360/p1/sub/units.json`],
    [`${G}/all-1440/runs`]: [
      `${G}/all-1440/runs/2026-10-18T21-05-09-222Z-other.json`, `${G}/all-1440/runs/2026-10-18T21-05-09-222Z-p1.json`,
      `${G}/all-1440/runs/2026-10-18T21-05-09-222Z-xp1.json`, `${G}/all-1440/runs/nested/2026-10-18T21-05-09-222Z-p1.json`, `${G}/all-1440/runs/notes-p1.json`,
    ],
    [`${G}/all-768/runs`]: [`${G}/all-768/runs/2026-10-18T21-05-09-222Z-other.json`], // gated others only: no triage of it
  };
  const rows = [{ slug: 'p1', path: '/p1', source: { migratedHtml: null, encodedHtml: 'stardust/encoded/p1.html', metaJson: 'stardust/migrated/p1._meta.json' } }];
  const { files, notes } = stageCandidates({
    unit: 'archetype-post', lines: ['/p1'], rows, templates: ['extra', 'post', '../x', '', 7], gateDirs: [`${G}/all-1440`, `${G}/all-360`, `${G}/all-768`], walk: (d) => tree[d] || [], pathKey,
  });
  assert.deepEqual(files, [
    'content/p1.html', 'content/p1/index.html', 'stardust/deploy/ledger-archetype-post.json', 'stardust/deploy/media-ledger.json',
    'stardust/eds-conversion-log.md', 'stardust/eds-schema/p1.json', 'stardust/encoded/p1.html', 'stardust/encoded/p1/index.html',
    'stardust/import/extra/map.json', 'stardust/import/post/encoder.mjs', 'stardust/import/post/map.json', 'stardust/migrate/progress.json',
    'stardust/migrated/p1._meta.json', 'stardust/patches/p1.json', 'stardust/redirects.tsv',
    `${G}/all-1440/p1/pixel.json`, `${G}/all-1440/p1/rounds.json`, `${G}/all-1440/runs/2026-10-18T21-05-09-222Z-p1.json`,
    `${G}/all-1440/triage.json`, `${G}/all-1440/triage.md`, `${G}/all-360/p1/sub/units.json`, `${G}/all-360/triage.json`, `${G}/all-360/triage.md`,
    'stardust/rollout/foundation-requests.md', 'stardust/rollout/progress.json', 'stardust/rollout/rollout.json',
    'stardust/rollout/units/archetype-post.md', 'stardust/rollout/units/archetype-post.paths', 'stardust/state.json',
  ]);
  assert.deepEqual(notes, []);
});
check('stageCandidates: a row\'s source paths stay inside their roots — content/, styles/, blocks/header/, a .. escape, a foreign absolute path and an unusable slug are left out, one note per row; an absolute path under the project is taken relative to it', () => {
  const rows = [
    { slug: 'e', path: '/e', source: { migratedHtml: 'content/other.html', encodedHtml: 'styles/x.html', metaJson: 'blocks/header/x.html' } },
    { slug: 'f', path: '/f', source: { migratedHtml: 'stardust/migrated/../../content/f.html', encodedHtml: '/elsewhere/stardust/encoded/f.html', metaJson: null } },
    { slug: 'g', path: '/g', source: { migratedHtml: null, encodedHtml: join(root, 'stardust', 'encoded', 'g.html'), metaJson: 'stardust/migrated/g._meta.json' } },
    { slug: '../../styles/h', path: '/h', source: { migratedHtml: null, encodedHtml: null, metaJson: null } },
  ];
  const { files, notes } = stageCandidates({ unit: 'u2', lines: ['/e', '/f', '/g', '/h'], rows, root, pathKey });
  assert.ok(!files.some((f) => /^(styles|blocks|fonts|scripts)\//.test(f) || f.includes('..') || f.startsWith('/')), files.join(' '));
  assert.deepEqual(files.filter((f) => f.startsWith('content/')), ['content/e.html', 'content/e/index.html', 'content/f.html', 'content/f/index.html', 'content/g.html', 'content/g/index.html', 'content/h.html', 'content/h/index.html'], 'content: the unit\'s page docs only');
  for (const f of ['stardust/encoded/g.html', 'stardust/migrated/g._meta.json', 'stardust/eds-schema/e.json', 'stardust/patches/f.json']) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /styles\/h|other\.html|header\/x|elsewhere|f\._meta/.test(f)), files.join(' '));
  assert.deepEqual(files, [...new Set(files)].sort(), 'deduped, sorted');
  assert.equal(notes.length, 3, notes.join('\n'));
  assert.match(notes[0], /^coverage row e \(\/e\): left out source\.metaJson blocks\/header\/x\.html \(not under stardust\/migrated\/\), source\.migratedHtml content\/other\.html \(not under stardust\/migrated\/\), source\.encodedHtml styles\/x\.html \(not under stardust\/encoded\/\)$/);
  assert.match(notes[1], /^coverage row f \(\/f\): left out the sidecar stardust\/migrated\/\.\.\/\.\.\/content\/f\._meta\.json .*source\.migratedHtml stardust\/migrated\/\.\.\/\.\.\/content\/f\.html .*source\.encodedHtml \/elsewhere\/stardust\/encoded\/f\.html \(not under stardust\/encoded\/\)$/);
  assert.match(notes[2], /^coverage row \.\.\/\.\.\/styles\/h \(\/h\): left out slug \.\.\/\.\.\/styles\/h \(not one name\)$/);
  assert.equal(sourceUnder('stardust/encoded/a.html', ENCODED_DIR), 'stardust/encoded/a.html');
  assert.equal(sourceUnder(join(root, 'stardust/encoded/a.html'), ENCODED_DIR), null, 'an absolute path without a root is left out');
});
check('perUnitArea: the namespaces the set manages per unit or per page; shared and other paths → null', () => {
  for (const [p, area] of [
    ['stardust/rollout/units/c2.md', 'stardust/rollout/units/'], ['Stardust/Rollout/Units/c2.md', 'stardust/rollout/units/'],
    ['stardust/deploy/ledger-c2.json', 'stardust/deploy/ledger-<unit>.json'], ['stardust/import/c/map.json', 'stardust/import/'],
    ['stardust/encoded/c.html', 'stardust/encoded/'], ['stardust/migrated/c/_meta.json', 'stardust/migrated/'],
    ['stardust/patches/c.json', 'stardust/patches/'], ['stardust/eds-schema/c.json', 'stardust/eds-schema/'],
    [`${G}/all-1440/c/pixel.json`, `${G}/all-1440/<page>/ and runs/`], [RUN_C, `${G}/all-1440/<page>/ and runs/`],
  ]) assert.equal(perUnitArea(p), area, p);
  for (const p of ['stardust/deploy/media-ledger.json', 'stardust/rollout/foundation-requests.md', `${G}/all-1440/triage.json`, `${G}/all-1440/overrides.json`, 'stardust/notes/x.md', 'docs/a.pdf']) assert.equal(perUnitArea(p), null, p);
});
check('alsoPath: a clean project-relative path; absolute, .., the root, .git, content/, blocks/ and the frozen foundation refused, naming the rule', () => {
  assert.equal(alsoPath('stardust/rollout/notes.md'), 'stardust/rollout/notes.md');
  assert.equal(alsoPath('./stardust/import/x/'), 'stardust/import/x');
  assert.equal(alsoPath('stardust\\notes.md'), 'stardust/notes.md');
  for (const ok of ['docs/guide.pdf', 'contentious/a.html', 'blocksy', 'stardust/content/a.html', 'stardust/styles.json']) assert.equal(alsoPath(ok), ok);
  for (const [bad, re] of [
    ['/etc/hosts', /an absolute path is refused/], ['../x', /a \.\. segment is refused/], ['stardust/../content/a.html', /a \.\. segment is refused/],
    ['.', /the project root is refused/], ['./', /the project root is refused/], ['', /needs a path/],
    ['.git/config', /\.git is refused/], ['stardust/x/.GIT/HEAD', /\.git is refused/],
    ['content', /content\/ is refused — a unit's pages go through stardust\/rollout\/units\/<unit>\.paths/], ['Content/A.html', /content\/ is refused/],
    ['blocks/cards', /blocks\/ is refused — block code goes through --code blocks\/<name>/], ['blocks/header/header.js', /blocks\/ is refused/],
    ['styles/styles.css', /styles\/ is the frozen foundation/], ['fonts/a.woff2', /fonts\/ is the frozen foundation/],
    ['scripts/aem.js', /scripts\/ is the frozen foundation/], ['head.html', /head\.html is the frozen foundation/],
  ]) assert.throws(() => alsoPath(bad), re, JSON.stringify(bad));
});
check('netBudget: a network step or backoff gets min(its own limit, the time left until 170 s after the start); none is started with 0 left', () => {
  assert.equal(NET_DEADLINE_MS, 170_000);
  const t0 = 1_000_000;
  assert.equal(netBudget(t0, t0, NET_TIMEOUT_MS), 60_000, 'early: the step\'s own limit');
  assert.equal(netBudget(t0, t0 + 110_000, NET_TIMEOUT_MS), 60_000, 'exactly enough left');
  assert.equal(netBudget(t0, t0 + 150_000, NET_TIMEOUT_MS), 20_000, 'late: capped to the time left');
  assert.equal(netBudget(t0, t0 + 169_999, NET_TIMEOUT_MS), 1);
  assert.equal(netBudget(t0, t0 + 169_500, 1_000), 500, 'a backoff sleep is capped too');
  assert.equal(netBudget(t0, t0 + 170_000, NET_TIMEOUT_MS), 0, 'no time left → not started');
  assert.equal(netBudget(t0, t0 + 120_000 + 4 * 60_000, NET_TIMEOUT_MS), 0, 'a 120 s lock wait plus rounds never starts a step past the deadline');
  assert.equal(netBudget(t0, t0 + 5_000, NET_TIMEOUT_MS, 5_000), 0, 'the deadline is a parameter');
});
check('worstPushSchedule: every --push network step runs its whole capped budget plus the kill grace — it ends by 175 s, under 240 s, wherever it starts', () => {
  const w = worstPushSchedule(0);
  assert.deepEqual(w.steps.map(({ step, attempt, startMs, ms }) => [step, attempt, startMs, ms]), [
    ['fetch', 0, 0, 60_000], ['pull', 0, 65_000, 60_000], ['push', 0, 130_000, 40_000],
  ], 'the push gets the 40 s left, not its 60 s');
  assert.equal(w.endMs, NET_DEADLINE_MS + KILL_GRACE_MS);
  assert.ok(w.endMs < 240_000, `${w.endMs / 1000} s`);
  // the first network step starts after the lock wait and the local steps; nothing starts at or past 170 s
  for (let at = 0; at <= 240_000; at += 250) {
    const s = worstPushSchedule(at);
    for (const x of s.steps) assert.ok(x.ms > 0 && x.startMs + x.ms <= NET_DEADLINE_MS, `from ${at} ms: ${x.step} ${x.startMs}+${x.ms} runs past the deadline`);
    if (at < NET_DEADLINE_MS) assert.ok(s.steps.length > 0 && s.endMs <= NET_DEADLINE_MS + KILL_GRACE_MS && s.endMs < 240_000, `from ${at} ms: ends at ${s.endMs} ms`);
    else assert.deepEqual(s, { steps: [], endMs: at }, `from ${at} ms: no network step started`);
  }
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
  put(clone, 'stardust/rollout/progress.json', '{"units":{"c1":{"status":"running","templates":["a"]},"c2":{"status":"running","templates":["c"]}}}\n');
  put(clone, 'stardust/deploy/media-ledger.json', '{}\n');
  // what a unit writes beside its pages (handoff contract § 3 row C, rollout § Phase C, migrate § Encoder first)
  for (const f of ['rollout/rollout.json', 'rollout/variance/a.json', 'state.json', 'migrate/progress.json', 'migrate/encode/a.json']) put(clone, `stardust/${f}`, '{}\n');
  put(clone, 'stardust/rollout/foundation-requests.md', '- c1 | body line-height | pixel 12 % | a\n');
  put(clone, 'stardust/eds-conversion-log.md', '# conversion log\n');
  put(clone, 'stardust/redirects.tsv', '/A.html\t/a\n');
  for (const u of ['c1', 'c2']) { put(clone, `stardust/rollout/units/${u}.md`, `# ${u} report\n`); put(clone, `stardust/deploy/ledger-${u}.json`, '{}\n'); }
  for (const t of ['a', 'c']) { put(clone, `stardust/import/${t}/map.json`, '{}\n'); put(clone, `stardust/encoded/${t}.html`, `<main><h1>${t} encoded</h1></main>\n`); }
  put(clone, 'stardust/patches/a.json', '[]\n');
  for (const f of ['a/pixel.json', 'a/rounds.json', 'a/origin.png', 'a/rounds.lock']) put(clone, `${G}/all-1440/${f}`, '{}\n');
  for (const f of [RUN_A, RUN_C, `${G}/all-360/c/pixel.json`, `${G}/all-360/triage.json`, `${G}/prototypes-1440/a/pixel.json`]) put(clone, f, '{}\n');
  put(clone, 'stardust/eds-schema/a.json', '{}\n');
  put(clone, 'stardust/eds-schema/b.json', '{}\n'); // git-ignored: never staged
  put(clone, 'stardust/eds-schema/c.json', '{}\n'); // c2's delivered page sidecar (the sidecar-before-commit pre-check)
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
    assert.match(r.out, /170 s \+ 5 s = 175 s\b.*returns under 240 s/s, 'the --push bound and its arithmetic');
    assert.doesNotMatch(r.out, /245 s/);
    for (const entry of ['per unit:', 'units/<unit>.md', 'ledger-<unit>.json', 'stardust/import/<t>/', 'stardust/encoded/<key>.html', 'per path', 'per coverage row',
      'all-<w>/<slug>/**/*.json', 'all-<w>/triage.json', 'shared:', 'stardust/rollout/variance/*.json', 'stardust/migrate/encode/*.json', ...SHARED, '--code blocks/<name>', '--also <path>']) assert.ok(r.out.includes(entry), `--help names ${entry}`);
    assert.match(r.out, /commits\s+it by pathspec: a hand git add of these paths is never needed/);
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
    for (const args of [[], ['../x'], ['c1', 'c2'], ['c1', '--bogus'], ['c1', '--wait-s', 'abc'], ['c1', '--wait-s', '-1'], ['c1', '--message'], ['c1', '--message', '--push'], ['c1', '--code'], ['c1', '--code', 'styles'], ['c1', '--code', 'blocks/header'], ['c1', '--also'], ['c1', '--also', '--push'], ['c1', '--also', 'content/a.html']]) {
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
  check('c1: commits exactly its set — its pages, report, ledger, map, encoded docs, gate JSON and all shared bookkeeping; another unit\'s files, unrelated, ignored and non-JSON gate files stay out; the pre-staged file stays staged', () => {
    const r = run(clone, 'c1');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.match(r.out, new RegExp(`^unit-commit c1: committed [0-9a-f]{7} \\(${C1_SET.length} files\\)\\n$`));
    assert.deepEqual(filesOf(clone, 'HEAD'), C1_SET);
    assert.equal(subject(), `C-deliver unit c1: 2 pages, ${C1_SET.length} files`);
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  check('c1 again, unchanged → exit 2 nothing to commit', () => {
    const before = head();
    const r = run(clone, 'c1');
    assert.equal(r.code, 2); assert.equal(r.out, 'unit-commit c1: nothing to commit\n');
    assert.equal(head(), before);
  });
  check('a second unit (c3) commits only what changed since: its page, .paths and report, the shared files it changed and a shared file staged by hand — no unchanged shared file, nothing of another unit', () => {
    put(clone, 'content/d.html', '<main><h1>d</h1></main>\n');
    put(clone, 'stardust/rollout/units/c3.paths', '/d\n');
    put(clone, 'stardust/rollout/units/c3.md', '# c3 report\n');
    put(clone, 'stardust/rollout/foundation-requests.md', '- c1 | body line-height | pixel 12 % | a\n- c3 | footer gap | crop 3 % | d\n');
    put(clone, 'stardust/rollout/variance/d.json', '{}\n');
    put(clone, 'stardust/state.json', '{"pages":{}}\n');
    git(clone, 'add', '--', 'stardust/state.json'); // a hand git add (never needed): committed all the same
    const r = run(clone, 'c3');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c3: committed [0-9a-f]{7} \(6 files\)\n$/);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['content/d.html', 'stardust/rollout/foundation-requests.md', 'stardust/rollout/units/c3.md', 'stardust/rollout/units/c3.paths', 'stardust/rollout/variance/d.json', 'stardust/state.json']);
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  check('a fix round: c1 commits its new --only run, its rounds.json and its gate dir\'s triage.json + triage.md — never an image, a lock, triage-parity/ or the triage of a gate dir it was not gated in', () => {
    const run2 = `${G}/all-1440/runs/2026-10-18T22-00-00-000Z-a.json`;
    put(clone, run2, '{"round":1}\n');
    put(clone, `${G}/all-1440/a/rounds.json`, '{"rounds":1}\n');
    put(clone, `${G}/all-1440/triage.json`, '{"causes":[]}\n');
    put(clone, `${G}/all-1440/triage.md`, '# triage\n');
    put(clone, `${G}/all-1440/a/diff.png`, 'png\n');
    put(clone, `${G}/all-1440/a/rounds.lock`, '{"pid":1}\n');
    put(clone, `${G}/all-1440/triage-parity/band.json`, '{}\n');
    put(clone, `${G}/all-360/triage.json`, '{"causes":["c2"]}\n'); // c2's gate dir: c1's pages were not gated there
    const r = run(clone, 'c1');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c1: committed [0-9a-f]{7} \(4 files\)\n$/);
    assert.deepEqual(filesOf(clone, 'HEAD'), [`${G}/all-1440/a/rounds.json`, run2, `${G}/all-1440/triage.json`, `${G}/all-1440/triage.md`].sort());
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  check('--also: an extra file under stardust/, the unit\'s own report and, outside stardust/, a directory\'s files (recursively) join the commit; a git-ignored one is named on stderr, not staged', () => {
    put(clone, 'stardust/notes/extra.md', 'extra\n');
    put(clone, 'docs/guides/a.json', '{}\n');
    put(clone, 'docs/guides/sub/b.txt', 'b\n');
    put(clone, 'docs/guides/c.map', '{}\n'); // git-ignored (*.map)
    const r = run(clone, 'c3', '--also', 'stardust/notes/extra.md', '--also', './docs/guides/', '--also', 'stardust/rollout/units/c3.md');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.match(r.out, /^unit-commit c3: committed [0-9a-f]{7} \(3 files\)\n$/);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['docs/guides/a.json', 'docs/guides/sub/b.txt', 'stardust/notes/extra.md']);
    assert.match(r.err, /note: --also: 1 git-ignored file\(s\) not staged: docs\/guides\/c\.map/);
    assert.equal(git(clone, 'status', '--porcelain', '--', 'notes.txt', 'content/z.html'), '?? content/z.html\n?? notes.txt');
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
  });
  check('sidecar before commit: a delivered page without stardust/eds-schema/<slug>.json → exit 2, one stdout line, the exact section-schema.mjs command per page on stderr, nothing staged; --no-sidecar-check commits and records the override in the message', () => {
    // an isolated repo: one delivered page `sx` whose eds-schema sidecar is NOT written
    const sc = join(root, 'sidecar'); mkdirSync(sc);
    git(root, '-c', 'init.defaultBranch=main', 'init', '-q', sc);
    configure(sc);
    put(sc, 'README.md', 'x\n'); git(sc, 'add', '--', 'README.md'); git(sc, 'commit', '-q', '-m', 'init');
    put(sc, 'content/sx.html', '<main><h1>sx</h1></main>\n');
    put(sc, 'stardust/rollout/coverage/pages.json', `${JSON.stringify({ pages: [{ slug: 'sx', path: '/sx' }] })}\n`);
    put(sc, 'stardust/rollout/units/sx.paths', '/sx\n');
    put(sc, 'stardust/rollout/units/sx.md', '# sx\n');
    const refused = run(sc, 'sx');
    assert.equal(refused.code, 2, refused.out + refused.err);
    oneLine(refused);
    assert.match(refused.out, /^unit-commit sx: 1 page\(s\) without their stardust\/eds-schema\/<slug>\.json sidecar \(sx\) — write it with the section-schema\.mjs command on stderr, or pass --no-sidecar-check to commit anyway \(recorded in the commit message\); nothing staged\n$/);
    assert.match(refused.err, /^ {2}node stardust\/scripts\/deploy\/section-schema\.mjs <protoURL> --out stardust\/eds-schema\/sx\.json$/m);
    assert.equal(git(sc, 'rev-list', '--count', 'HEAD'), '1', 'nothing committed');
    assert.deepEqual(git(sc, 'diff', '--cached', '--name-only').split('\n').filter(Boolean), [], 'nothing staged');
    // --no-sidecar-check: commits, the default message records the override
    const forced = run(sc, 'sx', '--no-sidecar-check');
    assert.equal(forced.code, 0, forced.out + forced.err);
    assert.match(forced.out, /^unit-commit sx: committed [0-9a-f]{7} \(\d+ files\)\n$/);
    assert.match(git(sc, 'log', '-1', '--format=%s'), /^C-deliver unit sx: 1 pages, \d+ files \[--no-sidecar-check: 1 page\(s\) without an eds-schema sidecar: sx\]$/);
    // once the sidecar exists the pre-check passes with no override note
    put(sc, 'stardust/eds-schema/sx.json', '{}\n');
    put(sc, 'content/sx.html', '<main><h1>sx v2</h1></main>\n');
    const ok = run(sc, 'sx');
    assert.equal(ok.code, 0, ok.out + ok.err);
    assert.match(git(sc, 'log', '-1', '--format=%s'), /^C-deliver unit sx: 1 pages, \d+ files$/);
  });
  check('--also refused — absolute, a .. segment, content/, blocks/, styles/, head.html, .git, the root, a missing path, a link resolving outside the work tree or into content/, a directory under stardust/, another unit\'s report, ledger, map, encoded doc or gate run → exit 2, one line naming the rule, nothing staged or committed', () => {
    put(clone, 'stardust/rollout/units/c3.md', '# c3 report v2\n'); // what c3 would commit
    put(clone, 'stardust/rollout/units/c2.md', '# c2 report, in progress\n'); // a second unit's dirty report
    const sweep = /a directory under stardust\/ would sweep other units' files — name the file; nothing staged$/m;
    const foreign = (area) => new RegExp(`not this unit's own file — ${area.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} is managed per unit .*; nothing staged$`, 'm');
    symlinkSync(join(root, 'empty'), join(clone, 'outside-link'));
    symlinkSync('content', join(clone, 'pages-link'));
    const before = head();
    try {
      for (const [p, re] of [
        [join(clone, 'stardust', 'state.json'), /an absolute path is refused/],
        ['stardust/../content/a.html', /a \.\. segment is refused/],
        ['content/a.html', /content\/ is refused — a unit's pages go through stardust\/rollout\/units\/<unit>\.paths/],
        ['blocks/cards', /blocks\/ is refused — block code goes through --code blocks\/<name>/],
        ['styles/styles.css', /styles\/ is the frozen foundation/],
        ['head.html', /head\.html is the frozen foundation/],
        ['.git/config', /\.git is refused/],
        ['.', /the project root is refused/],
        ['stardust/nope.json', /^unit-commit c3: --also stardust\/nope\.json: no such file or directory — nothing staged$/m],
        ['outside-link', /^unit-commit c3: --also outside-link: resolves outside the work tree — nothing staged$/m],
        ['pages-link', /--also pages-link: resolves to content — content\/ is refused/],
        ['stardust/rollout/units', sweep], ['stardust/rollout/units/', sweep], ['stardust', sweep], ['stardust/notes', sweep],
        ['stardust/rollout/units/c2.md', foreign('stardust/rollout/units/')],
        ['stardust/deploy/ledger-c2.json', foreign('stardust/deploy/ledger-<unit>.json')],
        ['stardust/import/c/map.json', foreign('stardust/import/')],
        ['stardust/encoded/c.html', foreign('stardust/encoded/')],
        [RUN_C, foreign(`${G}/all-1440/<page>/ and runs/`)],
      ]) {
        const r = run(clone, 'c3', '--also', p);
        assert.equal(r.code, 2, `${p}: ${r.out}${r.err}`); oneLine(r); assert.match(r.out, re, p);
      }
    } finally { unlinkSync(join(clone, 'outside-link')); unlinkSync(join(clone, 'pages-link')); }
    assert.equal(head(), before); assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
    git(clone, 'checkout', '--', 'stardust/rollout/units/c3.md');
  });
  check('coverage source paths outside their roots (content/other.html, styles/x.html, blocks/header/x.html) are left out with one stderr note naming the row; the unit still commits its own', () => {
    for (const f of ['content/other.html', 'styles/x.html', 'blocks/header/x.html']) put(clone, f, '<main>not this unit\'s</main>\n');
    put(clone, 'content/e.html', '<main><h1>e</h1></main>\n');
    put(clone, 'stardust/eds-schema/e.json', '{}\n'); // the delivered page's sidecar (sidecar before commit)
    put(clone, 'stardust/rollout/units/c4.paths', '/e\n');
    const pagesFile = join(clone, 'stardust', 'rollout', 'coverage', 'pages.json');
    const doc = JSON.parse(readFileSync(pagesFile, 'utf8'));
    doc.pages.push({ slug: 'e', path: '/e', source: { migratedHtml: 'content/other.html', encodedHtml: 'styles/x.html', metaJson: 'blocks/header/x.html' } });
    writeFileSync(pagesFile, `${JSON.stringify(doc, null, 2)}\n`);
    const r = run(clone, 'c4');
    assert.equal(r.code, 0, r.out + r.err); oneLine(r);
    assert.deepEqual(filesOf(clone, 'HEAD'), ['content/e.html', 'stardust/eds-schema/e.json', 'stardust/rollout/coverage/pages.json', 'stardust/rollout/units/c4.paths']);
    const rowNotes = r.err.split('\n').filter((l) => l.includes('coverage row'));
    assert.equal(rowNotes.length, 1, r.err);
    assert.match(rowNotes[0], /^unit-commit c4: note: coverage row e \(\/e\): left out source\.metaJson blocks\/header\/x\.html .*source\.migratedHtml content\/other\.html .*source\.encodedHtml styles\/x\.html \(not under stardust\/encoded\/\)$/);
    assert.equal(git(clone, 'status', '--porcelain', '--', 'content/other.html', 'styles', 'blocks/header'), '?? blocks/header/\n?? content/other.html\n?? styles/');
    assert.deepEqual(staged(), ['other.txt']);
    noLockLeft();
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
    for (const f of ['stardust/rollout/units/c2.md', 'stardust/deploy/ledger-c2.json', 'stardust/import/c/map.json', RUN_C, `${G}/all-360/triage.json`]) assert.ok(filesOf(remote, c2[0][0]).includes(f), `c2 commits its own ${f}`);
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
