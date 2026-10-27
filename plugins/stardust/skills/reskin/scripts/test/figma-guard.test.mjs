#!/usr/bin/env node
// skills/reskin/scripts/test/figma-guard.test.mjs — the --confidential guard (assertIgnored) against
// real temporary git repositories, no network: every fixed capture output is checked, not one
// representative per directory; an ignore negation and an already-tracked file are refused whether
// or not they are the representative; a tracked file under a capture output directory is refused
// even when this run would not write it; paths beyond one batch are all checked; the refusal names the
// offending path and lines that, appended to .gitignore, make the same check pass.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { FOUNDATION_FILES } from '../figma/foundation.mjs';
import { assertIgnored, CAPTURE_NAMESPACES, CAPTURE_OUTPUTS, CURATE_OUTPUTS } from '../figma/guard.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const scratch = mkdtempSync(join(tmpdir(), 'figma-guard-test-'));
// No user or system git config, and no repository above the scratch dir.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CEILING_DIRECTORIES = scratch;

let n = 0;
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};
const write = (root, rel, body = '{}\n') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
// A repo whose stardust/.gitignore is `ignore` (lines) and whose history holds `tracked` (paths), committed
// before the .gitignore exists, the way a project that captured without --confidential would have them.
const repo = ({ ignore = [], tracked = [] } = {}) => {
  n += 1;
  const root = join(scratch, `r${n}`);
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  for (const t of tracked) write(root, t);
  if (tracked.length) { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'x'); }
  write(root, 'stardust/.gitignore', `${ignore.join('\n')}\n`);
  return root;
};
const LINES = [...new Set([...CAPTURE_OUTPUTS, ...CURATE_OUTPUTS].map(([, line]) => line))];
const capture = (root) => assertIgnored(CAPTURE_OUTPUTS, { cwd: root, namespaces: CAPTURE_NAMESPACES });
const refusal = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof UsageError && e.code === 2, `not a usage error: ${e.stack}`); return e.message; } assert.fail('expected the guard to refuse'); };
const printed = (message) => message.split('\n').filter((l) => /^(canon-source|reskin|\.work)\//.test(l));

check('CAPTURE_OUTPUTS lists every foundation file and the namespaces cover the directories', () => {
  const rels = CAPTURE_OUTPUTS.map(([rel]) => rel);
  for (const f of FOUNDATION_FILES) assert.ok(rels.includes(`canon-source/foundation/${f}.json`), f);
  assert.deepEqual(CAPTURE_NAMESPACES.map(([rel]) => rel), ['canon-source/foundation/', 'canon-source/assets/screenshots/', '.work/reskin/figma/']);
});
check('everything ignored, nothing tracked → no refusal', () => {
  capture(repo({ ignore: LINES }));
});
check('nothing ignored → every fixed output named, with the lines that cover them', () => {
  const m = refusal(() => capture(repo()));
  for (const [rel] of CAPTURE_OUTPUTS) assert.ok(m.includes(`stardust/${rel}`), rel);
  for (const l of ['canon-source/foundation/', 'canon-source/role-candidates.json', 'canon-source/assets/screenshots/', '.work/']) assert.ok(printed(m).includes(l), l);
});
check('an ignore negation of a non-representative foundation file is refused, the ignored ones are not named', () => {
  const root = repo({ ignore: ['canon-source/foundation/*', '!canon-source/foundation/typography.json', ...LINES.filter((l) => l !== 'canon-source/foundation/')] });
  const m = refusal(() => capture(root));
  assert.match(m, /1 output\(s\).*stardust\/canon-source\/foundation\/typography\.json/);
  assert.ok(!m.includes('colors.json'));
  assert.deepEqual(printed(m), ['canon-source/foundation/']);
  writeFileSync(join(root, 'stardust', '.gitignore'), `${readFileSync(join(root, 'stardust', '.gitignore'), 'utf8')}${printed(m).join('\n')}\n`);
  capture(root);
});
check('an already-tracked non-representative foundation file is refused with git rm --cached', () => {
  const root = repo({ ignore: LINES, tracked: ['stardust/canon-source/foundation/typography.json'] });
  const m = refusal(() => capture(root));
  assert.match(m, /stardust\/canon-source\/foundation\/typography\.json/);
  assert.match(m, /git rm --cached -- stardust\/canon-source\/foundation\/typography\.json$/);
  assert.ok(!m.includes('colors.json'));
});
check('a tracked file this run would not write, under a capture output directory, is refused', () => {
  const tracked = ['stardust/canon-source/assets/screenshots/old-slug.png', 'stardust/canon-source/foundation/legacy.json', 'stardust/.work/reskin/figma/KEY/v1/nodes.json'];
  const m = refusal(() => capture(repo({ ignore: LINES, tracked })));
  for (const t of tracked) assert.ok(m.includes(t), t);
  const rm = m.split('\n').find((l) => l.startsWith('Already tracked'));
  for (const t of tracked) assert.ok(rm.includes(` ${t}`), `git rm --cached lacks ${t}`);
});
check('a tracked file outside the capture directories is not the guard\'s business', () => {
  capture(repo({ ignore: LINES, tracked: ['stardust/state.json', 'stardust/canon-source/DESIGN.md', 'README.md'] }));
});
check('dynamic destinations: a negated screenshot or cache path is refused by name', () => {
  const dyn = [['canon-source/assets/screenshots/home.png', 'canon-source/assets/screenshots/'], ['canon-source/assets/screenshots/article.png', 'canon-source/assets/screenshots/']];
  const shots = repo({ ignore: ['canon-source/assets/screenshots/*', '!canon-source/assets/screenshots/home.png'] });
  const m = refusal(() => assertIgnored(dyn, { cwd: shots }));
  assert.match(m, /1 output\(s\).*stardust\/canon-source\/assets\/screenshots\/home\.png/);
  assert.ok(!m.includes('article.png'));
  const cache = [['.work/reskin/figma/current.json', '.work/'], ['.work/reskin/figma/KEY/.staging/v1-ab12cd34/images/1-2.png', '.work/']];
  const work = repo({ ignore: ['.work/*', '!.work/reskin/', '.work/reskin/figma/current.json'] });
  const c = refusal(() => assertIgnored(cache, { cwd: work }));
  assert.match(c, /1 output\(s\).*stardust\/\.work\/reskin\/figma\/KEY\/\.staging\/v1-ab12cd34\/images\/1-2\.png/);
  assert.ok(!c.includes('current.json'));
});
check('more paths than one batch are all checked, and the one exposed at the end is found', () => {
  const root = repo({ ignore: ['.work/*', '!.work/late/', '.work/late/*', '!.work/late/450.json'] });
  const paths = Array.from({ length: 450 }, (_, i) => [`.work/late/${i + 1}.json`, '.work/']);
  const m = refusal(() => assertIgnored(paths, { cwd: root }));
  assert.match(m, /1 output\(s\).*stardust\/\.work\/late\/450\.json/);
});
check('a project-relative --dir and an absolute one are both checked', () => {
  const root = repo({ ignore: LINES });
  assertIgnored(CAPTURE_OUTPUTS, { dir: join(root, 'stardust'), cwd: root, namespaces: CAPTURE_NAMESPACES });
  const bare = repo();
  assert.match(refusal(() => assertIgnored(CAPTURE_OUTPUTS, { dir: join(bare, 'stardust'), cwd: bare })), /canon-source\/foundation\/colors\.json/);
});
check('outside a git repository → a usage error saying so', () => {
  const lone = join(scratch, 'lone');
  mkdirSync(lone, { recursive: true });
  assert.match(refusal(() => assertIgnored(CAPTURE_OUTPUTS, { cwd: lone })), /not a git repository/);
});
check('no outputs and no namespaces → nothing to check, no git needed', () => {
  assertIgnored([], { cwd: join(scratch, 'does-not-exist') });
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
