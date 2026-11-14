import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConventional } from './check-commits.mjs';
import { commit, run, tree, write } from './lib/testing.mjs';

test('a subject is conventional with a known type, an optional scope and a description', () => {
  for (const subject of ['feat: add', 'fix(stardust): repair', 'feat(aem-cloud-service)!: break', 'chore(release): web-cli-v2.4.1 [skip ci]']) {
    assert.equal(isConventional(subject), true, subject);
  }
  for (const subject of ['Add a skill', 'feat:', 'feat:no space', 'feature: add', 'fix(two words): x', 'Merge branch main']) {
    assert.equal(isConventional(subject), false, subject);
  }
});

function branch(t, subjects) {
  const root = tree(t, { 'README.md': 'base' });
  const base = commit(root, 'chore: base');
  let head = base;
  subjects.forEach((subject, index) => {
    write(root, { 'README.md': `change ${index}` });
    head = commit(root, subject);
  });
  return { root, base, head };
}

test('one conventional commit among others is enough', (t) => {
  const { root, base, head } = branch(t, ['wip', 'fix(web): the real change', 'more wip']);
  const result = run(t, 'check-commits.mjs', [base, head], { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /✅ [0-9a-f]+ fix\(web\): the real change/);
  assert.match(result.stdout, /❌ [0-9a-f]+ wip/);
});

test('no conventional commit, no commit at all and an unknown commit each fail', (t) => {
  const none = branch(t, ['wip', 'Update README']);
  assert.equal(run(t, 'check-commits.mjs', [none.base, none.head], { cwd: none.root }).status, 1);
  const empty = branch(t, []);
  const result = run(t, 'check-commits.mjs', [empty.base, empty.head], { cwd: empty.root });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /No commits found/);
  const unknown = run(t, 'check-commits.mjs', ['0'.repeat(40), none.head], { cwd: none.root });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /::error::Failed to retrieve commits/);
});
