// Releases each changed skill, with semantic-release run in the skill's directory
// (release.config.cjs). One failed release doesn't stop the others; the step fails at the end.
//   node scripts/release-skills.mjs <file with one directory per line>
// BEFORE is the commit before the push that is being released.
//
// Not released: a skill brought in from another repository, which has its version from
// there, and a skill whose folder name another skill has, because the two would count from
// each other's tags. The web CLI has a release config of its own in its directory.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { error, group, summary, table, warning } from './lib/actions.mjs';
import { skillDirs } from './lib/changed.mjs';
import { readDirs } from './lib/dirs.mjs';
import { duplicateNames, ensureBaseline, fileBefore, isImported, skillVersion } from './lib/release.mjs';

const root = process.cwd();
const config = resolve(root, 'release.config.cjs');
const before = process.env.BEFORE ?? '';
const all = skillDirs(root);
// a skill inside another skill is released with the outer one
const duplicates = duplicateNames(all.filter((dir) => !all.some((outer) => dir.startsWith(`${outer}/`))));
const rows = [];
const count = { released: 0, skipped: 0, failed: 0 };
const skip = (name, why) => {
  warning(`${name} is not released: ${why}`);
  count.skipped += 1;
  rows.push([name, `skipped (${why})`, '⏭️']);
};
for (const dir of readDirs(process.argv[2])) {
  const name = basename(dir);
  const own = ['release.config.cjs', 'release.config.js', 'release.config.mjs'].some((file) => existsSync(join(root, dir, file)));
  if (!own) {
    if (!existsSync(join(root, dir, 'SKILL.md'))) {
      skip(name, 'no SKILL.md');
      continue;
    }
    if (isImported(dir)) {
      skip(name, 'brought in from another repository');
      continue;
    }
    if (duplicates.has(name)) {
      skip(name, `another skill has the folder name ${name}`);
      continue;
    }
    // a skill that was there before this push and has no version yet has been in use:
    // it counts as 1.0.0, so that its first release is this change and not its whole history
    const earlier = fileBefore(root, before, `${dir}/SKILL.md`);
    const was = earlier === null ? undefined : skillVersion(earlier) ?? '1.0.0';
    const baseline = ensureBaseline(root, { prefix: `${name}-v`, version: was, before });
    if (baseline === 'unknown') {
      skip(name, `it is at ${was}, and the commit before this push is not known`);
      continue;
    }
    if (baseline === 'created') console.log(`${name}: counting from ${was}, its version before this push`);
  }
  const args = own ? ['semantic-release'] : ['semantic-release', '--extends', config];
  const result = group(`Releasing ${name}`, () => spawnSync('npx', args, { cwd: join(root, dir), stdio: 'inherit' }));
  if (result.status === 0) {
    count.released += 1;
    rows.push([name, 'released, or nothing to release', '✅']);
  } else {
    error(`Release failed for ${name} (exit code ${result.status ?? result.error?.message})`);
    count.failed += 1;
    rows.push([name, 'failed', '❌']);
  }
}
rows.push(['**Total**', `**${count.released} run, ${count.skipped} skipped, ${count.failed} failed**`, count.failed === 0 ? '✅' : '❌']);
summary(['## Skill Releases', '', ...table(['Skill', 'Result', 'Status'], rows)]);
console.log(`Run: ${count.released}, skipped: ${count.skipped}, failed: ${count.failed}`);
if (count.failed > 0) {
  error(`${count.failed} skill(s) failed to release`);
  process.exit(1);
}
