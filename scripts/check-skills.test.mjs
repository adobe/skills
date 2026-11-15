import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_TOKENS, MAX_TOKENS_WITHOUT_EVAL, findViolations, readSkills, tokens } from './check-skills.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-skills.mjs');

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'check-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const skill = (name, lines = 3) => `---\nname: ${name}\ndescription: d\n---\n${'line\n'.repeat(lines)}`;
const manifest = '{"name":"p"}';
// the other rules, without `orphaned`, which has its own tests below
const found = (root) => findViolations(root).filter(({ rule }) => rule !== 'orphaned').map(({ rule, file }) => `${rule} ${file}`);
const orphans = (root) => findViolations(root).filter(({ rule }) => rule === 'orphaned').map(({ file }) => file);

test('a tree without violations has none', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('one'),
    'plugins/b/.claude-plugin/plugin.json': manifest,
    'plugins/b/skills/two/SKILL.md': skill('two'),
  });
  assert.deepEqual(findViolations(root), []);
});

test('the same name twice in one plugin is duplicate-in-plugin, for both skills', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('same'),
    'plugins/a/skills/group/two/SKILL.md': skill('same'),
  });
  assert.deepEqual(found(root), [
    'duplicate-in-plugin plugins/a/skills/group/two/SKILL.md',
    'duplicate-in-plugin plugins/a/skills/one/SKILL.md',
  ]);
});

test('the same name in two plugins is duplicate-across-plugins, not duplicate-in-plugin', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/x/SKILL.md': skill('same'),
    'plugins/product/b/.claude-plugin/plugin.json': manifest,
    'plugins/product/b/skills/x/SKILL.md': skill('"same"'),
  });
  const violations = findViolations(root);
  assert.deepEqual(found(root), [
    'duplicate-across-plugins plugins/a/skills/x/SKILL.md',
    'duplicate-across-plugins plugins/product/b/skills/x/SKILL.md',
  ]);
  assert.match(violations[0].detail, /plugins\/product\/b\/skills\/x\/SKILL\.md/);
});

test('501 lines is too long, 500 is not', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/fits/SKILL.md': skill('fits', 496),
    'plugins/a/skills/long/SKILL.md': skill('long', 497),
  });
  assert.deepEqual(found(root), ['too-long plugins/a/skills/long/SKILL.md']);
});

test('node_modules is not searched', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('one'),
    'plugins/a/node_modules/dep/skills/one/SKILL.md': skill('one'),
  });
  assert.deepEqual(findViolations(root), []);
});

test('--list prints the files of one rule, one per line, and nothing for a clean rule', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/long/SKILL.md': skill('long', 600),
    'plugins/a/skills/short/SKILL.md': skill('short'),
  });
  assert.equal(execFileSync('node', [SCRIPT, '--list', 'too-long'], { cwd: root, encoding: 'utf8' }), 'plugins/a/skills/long/SKILL.md\n');
  assert.equal(execFileSync('node', [SCRIPT, '--list', 'duplicate-in-plugin'], { cwd: root, encoding: 'utf8' }), '');
});

test('--list with an unknown rule exits 2 and prints no list', (t) => {
  const root = repo(t, { 'plugins/a/skills/one/SKILL.md': skill('one') });
  const result = spawnSync('node', [SCRIPT, '--list', 'no-such-rule'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('a skill below another skill is orphaned; the folders directly under skills/ are not', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': manifest,
    'plugins/a/skills/top/SKILL.md': skill('top'),
    'plugins/a/skills/top/sub/SKILL.md': skill('sub'),
    'plugins/a/skills/top/deep/er/SKILL.md': skill('er'),
  });
  assert.deepEqual(orphans(root), ['plugins/a/skills/top/deep/er/SKILL.md', 'plugins/a/skills/top/sub/SKILL.md']);
  const [violation] = findViolations(root).filter(({ file }) => file.endsWith('sub/SKILL.md'));
  assert.match(violation.detail, /lies below skills\/top\/, where no client looks: move it to skills\/sub\//);
});

test('a folder the Claude Code manifest lists under "skills" is found, as a skill or as a directory of skills', (t) => {
  const root = repo(t, {
    'plugins/a/.claude-plugin/plugin.json': '{"name":"p","skills":["./skills/","./skills/suite/one","./extra"]}',
    'plugins/a/skills/suite/SKILL.md': skill('suite'),
    'plugins/a/skills/suite/one/SKILL.md': skill('one'),
    'plugins/a/skills/suite/two/SKILL.md': skill('two'),
    'plugins/a/extra/three/SKILL.md': skill('three'),
    'plugins/b/.claude-plugin/plugin.json': '{"name":"q","skills":"./more"}',
    'plugins/b/more/four/SKILL.md': skill('four'),
  });
  assert.deepEqual(orphans(root), ['plugins/a/skills/suite/two/SKILL.md']);
});

test('a plugin.json inside a skill folder is a file of that skill, not a plugin of its own', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': '{"name":"a"}',
    'plugins/a/skills/authoring/SKILL.md': skill('authoring'),
    'plugins/a/skills/authoring/assets/example/plugin.json': '{"name":"example"}',
    'plugins/a/skills/authoring/assets/example/skills/demo/SKILL.md': skill('demo'),
    'plugins/b/plugin.json': '{"name":"b"}',
    'plugins/b/skills/demo/SKILL.md': skill('demo'),
  });
  // the demo skill below the asset belongs to plugin a: no client finds it, and its name
  // collides with the one in plugin b across plugins, not inside a plugin called "example"
  assert.deepEqual(orphans(root), ['plugins/a/skills/authoring/assets/example/skills/demo/SKILL.md']);
  assert.deepEqual(found(root), [
    'duplicate-across-plugins plugins/a/skills/authoring/assets/example/skills/demo/SKILL.md',
    'duplicate-across-plugins plugins/b/skills/demo/SKILL.md',
  ]);
});

test('a skill outside every plugin is orphaned', (t) => {
  const root = repo(t, { 'plugins/loose/skills/one/SKILL.md': skill('one') });
  const violations = findViolations(root);
  assert.deepEqual(violations.map(({ rule, file }) => `${rule} ${file}`), ['orphaned plugins/loose/skills/one/SKILL.md']);
  assert.match(violations[0].detail, /is in no plugin/);
});

test('a plugin that has only its root plugin.json yet is a plugin; what it lists for Claude Code alone does not count', (t) => {
  const root = repo(t, {
    'plugins/new/plugin.json': '{"name":"new","extensions":{"io.github.ai-ecoverse.x927":{"targets":{"claude":{"skills":["./skills/suite/one"]}}}}}',
    'plugins/new/.claude-plugin/plugin.json': '{"name":"new","skills":["./skills/suite/one"]}',
    'plugins/new/skills/suite/SKILL.md': skill('suite'),
    'plugins/new/skills/suite/one/SKILL.md': skill('one'),
  });
  assert.deepEqual(orphans(root), ['plugins/new/skills/suite/one/SKILL.md']);
});

// ---- over-token-limit ----

// A SKILL.md of exactly n tokens: four characters each, the frontmatter included.
const sized = (name, n) => {
  const head = `---\nname: ${name}\ndescription: d\n---\n`;
  return head + 'x'.repeat(n * 4 - head.length);
};
const evals = (entries) => JSON.stringify({ skill_name: 's', evals: entries });
const scenario = (dir) => ({ [`${dir}/task.md`]: 'Do it.', [`${dir}/criteria.json`]: '{"type":"weighted_checklist","checklist":[{"name":"done","max_score":10}]}' });
const overLimit = (root) => findViolations(root).filter(({ rule }) => rule === 'over-token-limit').map(({ file }) => file);
const evalOfSkill = (root, name) => readSkills(root).find((entry) => entry.file.endsWith(`/${name}/SKILL.md`)).eval;

test('tokens are a quarter of the characters, rounded up, as tessl plugin lint counts them', () => {
  assert.equal(tokens(''), 0);
  assert.equal(tokens('abcd'), 1);
  assert.equal(tokens('abcde'), 2);
  assert.equal(tokens(sized('s', 1000)), 1000);
  assert.deepEqual([MAX_TOKENS, MAX_TOKENS_WITHOUT_EVAL], [5000, 1000]);
});

test('a skill without an eval may have 1,000 tokens, a skill with one 5,000', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': manifest,
    'plugins/a/skills/small/SKILL.md': sized('small', 1000),
    'plugins/a/skills/grown/SKILL.md': sized('grown', 1001),
    'plugins/a/skills/tested/SKILL.md': sized('tested', 5000),
    'plugins/a/skills/tested/evals/evals.json': evals([{ id: 1, prompt: 'Do it.', expected_output: 'It is done.' }]),
    'plugins/a/skills/huge/SKILL.md': sized('huge', 5001),
    'plugins/a/skills/huge/evals/evals.json': evals([{ id: 1, prompt: 'Do it.', assertions: ['done'] }]),
  });
  assert.deepEqual(overLimit(root), ['plugins/a/skills/grown/SKILL.md', 'plugins/a/skills/huge/SKILL.md']);
  const details = Object.fromEntries(findViolations(root).filter(({ rule }) => rule === 'over-token-limit').map(({ file, detail }) => [file.split('/')[3], detail]));
  assert.equal(details.grown, '1,001 tokens (limit 1,000 without an eval, 5,000 with one)');
  assert.equal(details.huge, '5,001 tokens (limit 5,000; its eval is plugins/a/skills/huge/evals/evals.json)');
});

test('an evals.json counts when it has a prompt and what is expected of the answer', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': manifest,
    'plugins/a/skills/full/SKILL.md': skill('full'),
    'plugins/a/skills/full/evals/evals.json': evals([{ prompt: '' }, { prompt: 'Do it.', expectations: ['done'] }]),
    'plugins/a/skills/empty/SKILL.md': skill('empty'),
    'plugins/a/skills/empty/evals/evals.json': evals([]),
    'plugins/a/skills/no-prompt/SKILL.md': skill('no-prompt'),
    'plugins/a/skills/no-prompt/evals/evals.json': evals([{ prompt: '  ', expected_output: 'x' }]),
    'plugins/a/skills/nothing-expected/SKILL.md': skill('nothing-expected'),
    'plugins/a/skills/nothing-expected/evals/evals.json': evals([{ prompt: 'Do it.', expected_output: '', assertions: [] }]),
    'plugins/a/skills/broken/SKILL.md': skill('broken'),
    'plugins/a/skills/broken/evals/evals.json': '{ not json',
  });
  assert.equal(evalOfSkill(root, 'full'), 'plugins/a/skills/full/evals/evals.json');
  for (const name of ['empty', 'no-prompt', 'nothing-expected', 'broken']) assert.equal(evalOfSkill(root, name), null, name);
});

test('a scenario of the plugin is the eval of the skill it is named after: the one with the longest name', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': manifest,
    'plugins/a/skills/page/SKILL.md': skill('page'),
    'plugins/a/skills/page-import/SKILL.md': skill('page-import'),
    'plugins/a/skills/exact/SKILL.md': skill('exact'),
    'plugins/a/skills/pages/SKILL.md': skill('pages'),
    'plugins/a/skills/unnamed/SKILL.md': skill('unnamed'),
    ...scenario('plugins/a/evals/page-import-from-capture'),
    ...scenario('plugins/a/evals/exact'),
    ...scenario('plugins/a/evals/something-else'),
  });
  assert.equal(evalOfSkill(root, 'page-import'), 'plugins/a/evals/page-import-from-capture');
  assert.equal(evalOfSkill(root, 'exact'), 'plugins/a/evals/exact');
  // "page-import-from-capture" starts with "page-", but belongs to page-import; "pages" is another word
  for (const name of ['page', 'pages', 'unnamed']) assert.equal(evalOfSkill(root, name), null, name);
});

test('a scenario needs a task and criteria with a checklist', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': manifest,
    'plugins/a/skills/one/SKILL.md': skill('one'),
    'plugins/a/skills/two/SKILL.md': skill('two'),
    'plugins/a/skills/three/SKILL.md': skill('three'),
    'plugins/a/skills/four/SKILL.md': skill('four'),
    'plugins/a/evals/one-no-criteria/task.md': 'Do it.',
    'plugins/a/evals/two-empty-task/task.md': '\n',
    'plugins/a/evals/two-empty-task/criteria.json': '{"checklist":[{"name":"done"}]}',
    'plugins/a/evals/three-no-checklist/task.md': 'Do it.',
    'plugins/a/evals/three-no-checklist/criteria.json': '{"checklist":[]}',
    'plugins/a/evals/four.md': 'a file, not a scenario',
  });
  for (const name of ['one', 'two', 'three', 'four']) assert.equal(evalOfSkill(root, name), null, name);
});

test('in a plugin with one skill, every scenario is that skill\'s; with two skills, a scenario has to say whose it is', (t) => {
  const root = repo(t, {
    'plugins/single/plugin.json': manifest,
    'plugins/single/skills/only/SKILL.md': sized('only', 4000),
    ...scenario('plugins/single/evals/range-slider'),
    'plugins/pair/plugin.json': manifest,
    'plugins/pair/skills/first/SKILL.md': sized('first', 4000),
    'plugins/pair/skills/second/SKILL.md': skill('second'),
    ...scenario('plugins/pair/evals/range-slider'),
  });
  assert.equal(evalOfSkill(root, 'only'), 'plugins/single/evals/range-slider');
  assert.equal(evalOfSkill(root, 'first'), null);
  assert.deepEqual(overLimit(root), ['plugins/pair/skills/first/SKILL.md']);
});

test('a skill that no client finds has only its own evals.json; a scenario of the plugin is not its eval', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': manifest,
    'plugins/a/skills/suite/SKILL.md': skill('suite'),
    'plugins/a/skills/suite/deep/SKILL.md': sized('deep', 1500),
    'plugins/a/skills/suite/tested/SKILL.md': sized('tested', 1500),
    'plugins/a/skills/suite/tested/evals/evals.json': evals([{ prompt: 'Do it.', expected_output: 'Done.' }]),
    ...scenario('plugins/a/evals/deep-case'),
  });
  assert.equal(evalOfSkill(root, 'deep'), null);
  assert.deepEqual(overLimit(root), ['plugins/a/skills/suite/deep/SKILL.md']);
});

test('--tokens lists every skill with its tokens, its limit and its eval, for the whole tree or below a directory', (t) => {
  const root = repo(t, {
    'plugins/a/plugin.json': manifest,
    'plugins/a/skills/grown/SKILL.md': sized('grown', 1200),
    'plugins/a/skills/tested/SKILL.md': sized('tested', 1200),
    'plugins/a/skills/tested/evals/evals.json': evals([{ prompt: 'Do it.', expected_output: 'Done.' }]),
    'plugins/b/plugin.json': manifest,
    'plugins/b/skills/other/SKILL.md': skill('other'),
  });
  const lines = execFileSync('node', [SCRIPT, '--tokens', 'plugins/a/'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(lines, [
    'over    1200 of 1000  plugins/a/skills/grown/SKILL.md  (no eval)',
    'ok      1200 of 5000  plugins/a/skills/tested/SKILL.md  (eval: plugins/a/skills/tested/evals/evals.json)',
  ]);
  assert.deepEqual(execFileSync('node', [SCRIPT, '--tokens', './plugins/a'], { cwd: root, encoding: 'utf8' }).trim().split('\n'), lines);
  assert.equal(execFileSync('node', [SCRIPT, '--tokens'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length, 3);
  assert.equal(execFileSync('node', [SCRIPT, '--list', 'over-token-limit'], { cwd: root, encoding: 'utf8' }), 'plugins/a/skills/grown/SKILL.md\n');
});
