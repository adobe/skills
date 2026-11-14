import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exists } from '../lib/scenarios.mjs';
import { assembleWorkdir, normalizeFixtures, selectFiles } from '../lib/workdir.mjs';

async function file(p, content = 'x') {
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, content);
}

async function scenario(config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'skill-eval-scn-'));
  return { name: 's', dir, config };
}

test('copies resources/ by convention and runs setup.sh', async () => {
  const s = await scenario();
  await file(join(s.dir, 'resources', 'a.json'), '{}');
  await file(join(s.dir, 'setup.sh'), 'true');
  const work = join(s.dir, '..', `${s.dir.split('/').pop()}-work`);
  const setup = await assembleWorkdir(s, work, { cacheDir: tmpdir() });
  assert.equal(await readFile(join(work, 'resources', 'a.json'), 'utf8'), '{}');
  assert.deepEqual(setup, [join(s.dir, 'setup.sh')]);
});

test('scenario.json include, directory fixture filters and setup order (setup.sh last)', async () => {
  const s = await scenario({
    include: ['./data'],
    setup: ['./first.sh'],
    fixtures: {
      seed: { type: 'directory', path: './fx', installPath: 'seed', include: ['**/*.ts'], exclude: ['**/*.test.ts'] },
    },
  });
  await file(join(s.dir, 'data', 'nested', 'd.txt'));
  await file(join(s.dir, 'resources', 'ignored.txt'));
  await file(join(s.dir, 'fx', 'src', 'a.ts'));
  await file(join(s.dir, 'fx', 'src', 'a.test.ts'));
  await file(join(s.dir, 'fx', 'README.md'));
  await file(join(s.dir, 'first.sh'));
  await file(join(s.dir, 'setup.sh'));
  const work = `${s.dir}-work`;
  const setup = await assembleWorkdir(s, work, { cacheDir: tmpdir() });
  assert.ok(await exists(join(work, 'data', 'nested', 'd.txt')));
  assert.equal(await exists(join(work, 'resources')), false);
  assert.ok(await exists(join(work, 'seed', 'src', 'a.ts')));
  assert.equal(await exists(join(work, 'seed', 'src', 'a.test.ts')), false);
  assert.equal(await exists(join(work, 'seed', 'README.md')), false);
  assert.deepEqual(setup, [join(s.dir, 'first.sh'), join(s.dir, 'setup.sh')]);
});

test('rejects installPath outside the workdir and unknown fixture types', async () => {
  const s = await scenario({ fixtures: { x: { type: 'directory', path: './fx', installPath: '../escape' } } });
  await file(join(s.dir, 'fx', 'a'));
  await assert.rejects(assembleWorkdir(s, `${s.dir}-work`, { cacheDir: tmpdir() }), /escapes workdir/);
  const s2 = await scenario({ fixtures: { x: { type: 'tarball' } } });
  await assert.rejects(assembleWorkdir(s2, `${s2.dir}-work`, { cacheDir: tmpdir() }), /unsupported fixture type/);
});

test('legacy singular fixture becomes a codebase commit fixture', () => {
  assert.deepEqual(normalizeFixtures({ fixture: { repoUrl: 'u', ref: 'r' } }), {
    codebase: { type: 'commit', repoUrl: 'u', ref: 'r' },
  });
});

test('selectFiles applies include before exclude', () => {
  const files = ['src/a.ts', 'src/a.test.ts', 'docs/x.md'];
  assert.deepEqual(selectFiles(files, ['src/**'], ['**/*.test.ts']), ['src/a.ts']);
  assert.deepEqual(selectFiles(files, [], ['docs/**']), ['src/a.ts', 'src/a.test.ts']);
});

async function localRepo() {
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'skill-eval-src-'));
  await file(join(dir, 'a.txt'), 'a');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x');
  return { dir, sha: git('rev-parse', 'HEAD'), git: (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim() };
}

test('commit fixture sets origin when remote is given, and none otherwise', async () => {
  const src = await localRepo();
  const cacheDir = await mkdtemp(join(tmpdir(), 'skill-eval-cache-'));
  const withRemote = await scenario({ fixture: { repoUrl: src.dir, ref: src.sha, remote: 'https://github.com/adobe/aem-boilerplate.git' } });
  const w1 = `${withRemote.dir}-work`;
  await assembleWorkdir(withRemote, w1, { cacheDir });
  assert.equal(src.git(w1, 'remote', 'get-url', 'origin'), 'https://github.com/adobe/aem-boilerplate.git');
  assert.equal(await readFile(join(w1, 'a.txt'), 'utf8'), 'a');
  const plain = await scenario({ fixture: { repoUrl: src.dir, ref: src.sha } });
  const w2 = `${plain.dir}-work`;
  await assembleWorkdir(plain, w2, { cacheDir });
  assert.equal(src.git(w2, 'remote'), '');
});
