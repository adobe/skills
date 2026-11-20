import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinsIn, problems } from './check-pins.mjs';
import { commit, git, run, tree, write } from './lib/testing.mjs';

const SKILL = 'plugins/p/skills/s/SKILL.md';
const install = (ref, folder = ref.slice(0, 7)) => [
  '```bash',
  `DIR="$HOME/.cache/s/web-cli-${folder}"`,
  `[ -x "$DIR/node_modules/.bin/web" ] || npx -y pnpm@12.20.0 add --dir "$DIR" "github:adobe/skills#${ref}&path:/plugins/web/cli"`,
  '```',
  '',
].join('\n');

// A repository with a tagged release on main, an untagged commit after it, and a commit
// on a branch that a squash merge would leave behind, tagged web-cli-v9.0.0.
function repository(t) {
  const root = tree(t, { 'plugins/web/cli/package.json': '{}' });
  commit(root, 'chore: base');
  write(root, { 'plugins/web/cli/dist.mjs': '1' });
  const release = commit(root, 'chore(release): web-cli-v1.0.0 [skip ci]');
  git(root, 'tag', 'web-cli-v1.0.0');
  write(root, { 'plugins/web/cli/dist.mjs': '2' });
  const untagged = commit(root, 'fix(web): later');
  git(root, 'checkout', '-q', '-b', 'feature');
  write(root, { 'plugins/web/cli/dist.mjs': '3' });
  const branch = commit(root, 'feat(web): on a branch');
  git(root, 'tag', 'web-cli-v9.0.0');
  git(root, 'checkout', '-q', 'main');
  return { root, release, untagged, branch };
}

const check = (root, text) => {
  write(root, { [SKILL]: text });
  return problems(root, 'main', [SKILL]);
};

test('a pin is an install specifier: placeholders and issue references are not pins', () => {
  assert.deepEqual(pinsIn('a\n"github:adobe/skills#abc&path:/x"'), [{ line: 2, ref: 'abc' }]);
  assert.deepEqual(pinsIn('git+https://github.com/adobe/skills.git#v1 and git+ssh://git@github.com:adobe/skills#v2'), [{ line: 1, ref: 'v1' }, { line: 1, ref: 'v2' }]);
  assert.deepEqual(pinsIn('"github:adobe/skills#<sha>&path:/plugins/web/cli" (adobe/skills#533) https://github.com/adobe/skills/issues/533'), []);
});

test('the full commit of a release on main passes', (t) => {
  const { root, release } = repository(t);
  assert.deepEqual(check(root, install(release)), []);
});

test('a commit that is not on main fails, so does one that no release tag points at', (t) => {
  const { root, branch, untagged } = repository(t);
  assert.match(check(root, install(branch))[0].message, /not on main: a squash merge leaves it behind/);
  assert.match(check(root, install('f'.repeat(40)))[0].message, /not in this repository's history/);
  assert.match(check(root, install(untagged))[0].message, /no release tag points at/);
});

test('a short commit and a branch fail, an existing tag passes', (t) => {
  const { root, release } = repository(t);
  assert.match(check(root, install(release.slice(0, 7)))[0].message, /a short commit/);
  assert.match(check(root, install('main', 'x'))[0].message, /not a tag of this repository/);
  assert.deepEqual(check(root, install('web-cli-v1.0.0', 'v1.0.0')), []);
});

test('a tag whose commit is not on main fails, as that commit would', (t) => {
  const { root, branch } = repository(t);
  const found = check(root, install('web-cli-v9.0.0', 'v9.0.0'));
  assert.equal(found.length, 1);
  assert.match(found[0].message, new RegExp(`the tag web-cli-v9.0.0, whose commit ${branch.slice(0, 7)} is not on main`));
});

test('a cache folder named after another commit fails: it would keep the old install', (t) => {
  const { root, release, untagged } = repository(t);
  const found = check(root, install(release, untagged.slice(0, 7)));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.match(found[0].message, new RegExp(`names the commit ${untagged.slice(0, 7)} in web-cli-${untagged.slice(0, 7)}`));
});

test('the script fails with the file and line of each bad pin, and passes once they are fixed', (t) => {
  const { root, release, branch } = repository(t);
  write(root, { [SKILL]: install(branch), 'plugins/p/README.md': 'see adobe/skills#533' });
  commit(root, 'fix: pin');
  const failed = run(t, 'check-pins.mjs', ['main'], { cwd: root });
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(failed.stdout, new RegExp(`::error::${SKILL}:3: pins ${branch.slice(0, 7)}`));
  assert.doesNotMatch(failed.stdout, /README/);
  assert.match(failed.summary, /Pins of adobe\/skills/);
  write(root, { [SKILL]: install(release) });
  commit(root, 'fix: pin a release');
  const passed = run(t, 'check-pins.mjs', ['main'], { cwd: root });
  assert.equal(passed.status, 0, passed.stdout);
  const missing = run(t, 'check-pins.mjs', ['origin/nothing'], { cwd: root });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /origin\/nothing is not in this checkout/);
});
