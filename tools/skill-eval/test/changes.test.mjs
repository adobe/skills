import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeChanges, snapshotWorkdir } from '../lib/changes.mjs';
import { makeSandboxRoot, removeDir } from '../lib/sandbox.mjs';

async function file(p, content) {
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, content);
}

test('lists added, modified and deleted files with a diff that hides absolute paths', async () => {
  const root = await makeSandboxRoot();
  const hidden = await makeSandboxRoot();
  try {
    const work = join(root, 'project');
    await file(join(work, 'keep.txt'), 'same\n');
    await file(join(work, 'blocks', 'a', 'a.css'), '.a { color: red; }\n');
    await file(join(work, 'old.js'), 'export {};\n');
    await file(join(work, 'node_modules', 'x', 'index.js'), 'ignored');
    const snap = join(hidden, 'attempts', 'with-plugin-1', 'start');
    await snapshotWorkdir(work, snap);

    await file(join(work, 'blocks', 'a', 'a.css'), '.a { color: var(--brand); }\n');
    await file(join(work, 'blocks', 'a', 'a.js'), 'export default function decorate() {}\n');
    await rm(join(work, 'old.js'));
    await file(join(work, 'node_modules', 'x', 'index.js'), 'changed but ignored');

    const c = await describeChanges(snap, work);
    assert.deepEqual(c.files, [
      { status: 'M', path: 'blocks/a/a.css' },
      { status: 'A', path: 'blocks/a/a.js' },
      { status: 'D', path: 'old.js' },
    ]);
    assert.match(c.diff, /-\.a \{ color: red; \}/);
    assert.match(c.diff, /\+\.a \{ color: var\(--brand\); \}/);
    assert.match(c.diff, /\+export default function decorate/);
    assert.ok(c.diff.includes('a/blocks/a/a.css') && c.diff.includes('b/blocks/a/a.css'));
    assert.ok(!c.diff.includes(hidden) && !c.diff.includes(root) && !c.diff.includes('with-plugin'));
    assert.equal(c.truncated, false);
  } finally {
    await removeDir(root);
    await removeDir(hidden);
  }
});

test('very large changed files are truncated instead of failing the attempt', async () => {
  const root = await makeSandboxRoot();
  try {
    const work = join(root, 'project');
    await file(join(work, 'a.txt'), 'x\n');
    const snap = join(root, 'start');
    await snapshotWorkdir(work, snap);
    await file(join(work, 'generated.txt'), 'generated line of text\n'.repeat(3_200_000));
    const c = await describeChanges(snap, work, { maxChars: 5_000 });
    assert.deepEqual(c.files, [{ status: 'A', path: 'generated.txt' }]);
    assert.equal(c.truncated, true);
    assert.ok(c.diff.length <= 5_200);
    assert.match(c.diff, /\+generated line of text/);
  } finally {
    await removeDir(root);
  }
});

test('caps very large diffs and reports no changes cleanly', async () => {
  const root = await makeSandboxRoot();
  try {
    const work = join(root, 'project');
    await file(join(work, 'a.txt'), 'x\n');
    const snap = join(root, 'start');
    await snapshotWorkdir(work, snap);
    assert.deepEqual(await describeChanges(snap, work), { files: [], diff: '', truncated: false });
    await file(join(work, 'big.txt'), `${'line\n'.repeat(50_000)}`);
    const c = await describeChanges(snap, work, { maxChars: 2_000 });
    assert.equal(c.truncated, true);
    assert.ok(c.diff.length <= 2_200);
  } finally {
    await removeDir(root);
  }
});
