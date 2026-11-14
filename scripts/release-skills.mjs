// Releases each changed skill that has a package.json, with semantic-release run in the
// skill's directory. One failed release doesn't stop the others; the step fails at the end.
//   node scripts/release-skills.mjs <file with one directory per line>
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { error, group, summary, table, warning } from './lib/actions.mjs';
import { readDirs } from './lib/dirs.mjs';

const rows = [];
const count = { released: 0, skipped: 0, failed: 0 };
for (const dir of readDirs(process.argv[2])) {
  const name = basename(dir);
  if (!existsSync(join(dir, 'package.json'))) {
    warning(`${dir} has no package.json — skipping release`);
    count.skipped += 1;
    rows.push([name, 'skipped (no package.json)', '⏭️']);
    continue;
  }
  const result = group(`Releasing ${name}`, () => spawnSync('npx', ['semantic-release'], { cwd: dir, stdio: 'inherit' }));
  if (result.status === 0) {
    count.released += 1;
    rows.push([name, 'released', '✅']);
  } else {
    error(`Release failed for ${name} (exit code ${result.status ?? result.error?.message})`);
    count.failed += 1;
    rows.push([name, 'failed', '❌']);
  }
}
rows.push(['**Total**', `**${count.released} released, ${count.skipped} skipped, ${count.failed} failed**`, count.failed === 0 ? '✅' : '❌']);
summary(['## Skill Releases', '', ...table(['Skill', 'Result', 'Status'], rows)]);
console.log(`Released: ${count.released}, skipped: ${count.skipped}, failed: ${count.failed}`);
if (count.failed > 0) {
  error(`${count.failed} skill(s) failed to release`);
  process.exit(1);
}
