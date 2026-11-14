import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildContext, parseTake, removeContext } from '../lib/ctxbuild.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

async function file(root, p, content) {
  await mkdir(join(root, p, '..'), { recursive: true });
  await writeFile(join(root, p), content);
}

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'skill-eval-ctxrepo-'));
  git(repo, 'init', '-q', '-b', 'main');
  await file(repo, 'p/skills/a/SKILL.md', 'a main');
  await file(repo, 'p/skills/a/references/old.md', 'old');
  await file(repo, 'p/skills/b/SKILL.md', 'b main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'main');
  git(repo, 'checkout', '-q', '-b', 'feature');
  await file(repo, 'p/skills/a/SKILL.md', 'a feature');
  git(repo, 'rm', '-q', 'p/skills/a/references/old.md');
  await file(repo, 'p/skills/a/references/new.md', 'new');
  await file(repo, 'p/skills/b/SKILL.md', 'b feature');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'feature');
  git(repo, 'checkout', '-q', 'main');
  return repo;
}

test('parseTake splits ref and path and rejects escapes', () => {
  assert.deepEqual(parseTake('feature:p/skills/a/'), { ref: 'feature', path: 'p/skills/a' });
  for (const bad of ['feature', ':x', 'feature:', 'feature:../x']) assert.throws(() => parseTake(bad), /--take/);
});

test('taking a path replaces it entirely, so files deleted at the ref do not linger', async () => {
  const repo = await makeRepo();
  const out = join(await mkdtemp(join(tmpdir(), 'skill-eval-ctxout-')), 'ctx');
  const m = await buildContext({ repo, base: 'main', takes: ['feature:p/skills/a'], out, name: 'ctx-a' });
  assert.equal(readFileSync(join(out, 'p/skills/a/SKILL.md'), 'utf8'), 'a feature');
  assert.equal(readFileSync(join(out, 'p/skills/a/references/new.md'), 'utf8'), 'new');
  assert.equal(existsSync(join(out, 'p/skills/a/references/old.md')), false);
  assert.equal(readFileSync(join(out, 'p/skills/b/SKILL.md'), 'utf8'), 'b main');
  assert.equal(m.takes[0].present, true);
  assert.equal(git(repo, 'rev-parse', 'refs/skill-eval/ctx/ctx-a'), m.commit);
  assert.ok(existsSync(m.manifest));
  await removeContext({ repo, target: out });
  assert.equal(existsSync(out), false);
  assert.equal(git(repo, 'rev-parse', 'refs/skill-eval/ctx/ctx-a'), m.commit);
  await rm(repo, { recursive: true, force: true });
});

test('a path absent at the ref is removed from the context', async () => {
  const repo = await makeRepo();
  const out = join(await mkdtemp(join(tmpdir(), 'skill-eval-ctxout-')), 'ctx');
  const m = await buildContext({ repo, base: 'feature', takes: ['main:p/skills/a/references/new.md'], out, name: 'ctx-gone' });
  assert.equal(existsSync(join(out, 'p/skills/a/references/new.md')), false);
  assert.equal(m.takes[0].present, false);
  await rm(repo, { recursive: true, force: true });
});

test('unknown refs and names are rejected before a worktree is created', async () => {
  const repo = await makeRepo();
  const out = join(await mkdtemp(join(tmpdir(), 'skill-eval-ctxout-')), 'ctx');
  await assert.rejects(() => buildContext({ repo, base: 'nope', out }), /git rev-parse/);
  await assert.rejects(() => buildContext({ repo, base: 'main', takes: ['nope:p'], out }), /git rev-parse/);
  await assert.rejects(() => buildContext({ repo, base: 'main', out, name: 'bad name' }), /name/);
  assert.equal(existsSync(out), false);
  await rm(repo, { recursive: true, force: true });
});
