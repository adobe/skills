import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changeProblems } from './check-changes.mjs';
import { noteProblem, parseNote, readNotes, withNotes } from './lib/changes.mjs';
import { commit, git, run, tree, write } from './lib/testing.mjs';

const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const plugin = (name, version = '1.0.0') => `${JSON.stringify({ $schema: SCHEMA, name, version }, null, 2)}\n`;
const CHANGELOG = '# Changelog\n\nThe intro.\n\n## 1.0.0 — the first\n\nText.\n';

test('a note is a title on the first line and the entry below it', () => {
  assert.deepEqual(parseNote('# The gate reads the schema\n\n- one\n- two\n'), { title: 'The gate reads the schema', body: '- one\n- two' });
  assert.deepEqual(parseNote('\n\nplain title\r\n\r\nbody\r\n'), { title: 'plain title', body: 'body' });
  assert.deepEqual(parseNote('  \n'), { title: '', body: '' });
});

test('a note needs a usable name, a title without a version, and an entry', () => {
  assert.equal(noteProblem('gate-reads-schema.md', '# The gate\n\nText.\n'), null);
  assert.equal(noteProblem('624.md', 'title\n\nText.\n'), null);
  assert.match(noteProblem('Gate Reads.md', '# t\n\nb\n'), /lower-case words with dashes/);
  assert.match(noteProblem('a.md', '\n'), /it is empty/);
  assert.match(noteProblem('a.md', '# only a title\n'), /no entry below it/);
  assert.match(noteProblem('a.md', '# 0.40.0 — the gate\n\nText.\n'), /the release adds the version/);
  assert.match(noteProblem('a.md', '## Unreleased — the gate\n\nText.\n'), /the release adds the version/);
});

test('the notes become entries of the version, above every earlier entry and below the intro', () => {
  const notes = [{ title: 'first note', body: '- a' }, { title: 'second note', body: 'Prose.' }];
  assert.equal(withNotes(CHANGELOG, '1.1.0', notes), '# Changelog\n\nThe intro.\n\n## 1.1.0 — first note\n\n- a\n\n## 1.1.0 — second note\n\nProse.\n\n## 1.0.0 — the first\n\nText.\n');
  assert.equal(withNotes(CHANGELOG, '1.1.0', []), CHANGELOG);
  assert.equal(withNotes('# Changelog\n', '1.0.0', [notes[0]]), '# Changelog\n\n## 1.0.0 — first note\n\n- a\n');
});

test('the notes of a plugin are read in the order of their names, without the README', (t) => {
  const root = tree(t, { 'p/changes/README.md': 'how', 'p/changes/b-second.md': '# B\n\nb', 'p/changes/a-first.md': '# A\n\na', 'p/changes/notes.txt': 'not a note' });
  assert.deepEqual(readNotes(join(root, 'p')), [{ file: 'changes/a-first.md', title: 'A', body: 'a' }, { file: 'changes/b-second.md', title: 'B', body: 'b' }]);
  assert.deepEqual(readNotes(join(root, 'none')), []);
});

test('a release moves the notes into the changelog and removes them, in the release commit', (t) => {
  const root = tree(t, {
    'plugins/p/plugin.json': plugin('p'),
    'plugins/p/CHANGELOG.md': CHANGELOG,
    'plugins/p/changes/README.md': 'how',
    'plugins/p/changes/gate.md': '# the gate reads the schema\n\n- It does.\n',
    'plugins/q/plugin.json': plugin('q'),
  });
  commit(root);
  const result = run(t, 'prepare-plugin-release.mjs', ['1.1.0'], { cwd: join(root, 'plugins/p') });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, 'plugins/p/CHANGELOG.md'), 'utf8'), '# Changelog\n\nThe intro.\n\n## 1.1.0 — the gate reads the schema\n\n- It does.\n\n## 1.0.0 — the first\n\nText.\n');
  assert.equal(existsSync(join(root, 'plugins/p/changes/gate.md')), false);
  assert.equal(existsSync(join(root, 'plugins/p/changes/README.md')), true);
  assert.match(git(root, 'status', '--porcelain'), /^D  plugins\/p\/changes\/gate\.md$/m); // staged
  assert.equal(JSON.parse(readFileSync(join(root, 'plugins/p/plugin.json'), 'utf8')).version, '1.1.0');
});

test('a pull request to a plugin that takes notes may not edit its changelog, and its notes have to be usable', (t) => {
  const root = tree(t, {
    'plugins/p/plugin.json': plugin('p'),
    'plugins/p/CHANGELOG.md': CHANGELOG,
    'plugins/p/changes/README.md': 'how',
    'plugins/old/plugin.json': plugin('old'),
    'plugins/old/CHANGELOG.md': CHANGELOG,
  });
  const base = commit(root);
  write(root, {
    'plugins/p/changes/gate.md': '# the gate reads the schema\n\n- It does.\n',
    'plugins/old/CHANGELOG.md': CHANGELOG.replace('## 1.0.0', '## Unreleased — more\n\nText.\n\n## 1.0.0'), // no changes/ folder: as before
  });
  commit(root);
  assert.deepEqual(changeProblems(root, base), []);

  write(root, {
    'plugins/p/CHANGELOG.md': CHANGELOG.replace('## 1.0.0', '## Unreleased — more\n\nText.\n\n## 1.0.0'),
    'plugins/p/changes/Bad Name.md': '# t\n\nb\n',
    'plugins/p/changes/empty.md': '# only a title\n',
  });
  commit(root);
  assert.deepEqual(changeProblems(root, base).map(({ file }) => file), ['plugins/p/CHANGELOG.md', 'plugins/p/changes/Bad Name.md', 'plugins/p/changes/empty.md']);
  const result = run(t, 'check-changes.mjs', [base], { cwd: root });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=plugins\/p\/CHANGELOG\.md::The release writes plugins\/p\/CHANGELOG\.md\. Take the change to it out, and put the entry into a new file plugins\/p\/changes\/<what-changed>\.md/);
  assert.match(result.summary, /Two new files do not/);
});

test('the pull request that starts the notes for a plugin may still edit the changelog, and the release may remove notes', (t) => {
  const root = tree(t, { 'plugins/p/plugin.json': plugin('p'), 'plugins/p/CHANGELOG.md': CHANGELOG });
  const base = commit(root);
  write(root, { 'plugins/p/changes/README.md': 'how', 'plugins/p/changes/gate.md': '# t\n\nb\n', 'plugins/p/CHANGELOG.md': `${CHANGELOG}\nfixed a heading\n` });
  const started = commit(root);
  assert.deepEqual(changeProblems(root, base), []);
  git(root, 'rm', '-q', 'plugins/p/changes/gate.md');
  commit(root);
  assert.deepEqual(changeProblems(root, started), []);
});
