// Every skill's .releaserc.json must extend a config that exists, or semantic-release fails
// with "Cannot find module" when that skill is released. Run from the repository root.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const files = execFileSync('git', ['ls-files', '*.releaserc.json'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const broken = files.filter((file) => {
  const { extends: ext = [] } = JSON.parse(readFileSync(file, 'utf8'));
  const paths = [ext].flat().filter((entry) => entry.startsWith('.'));
  return paths.some((entry) => !existsSync(join(dirname(file), entry)));
});
for (const file of broken) console.log(`::error file=${file}::extends a file that does not exist`);
console.log(`${files.length} release configs checked, ${broken.length} broken`);
process.exit(broken.length ? 1 : 0);
