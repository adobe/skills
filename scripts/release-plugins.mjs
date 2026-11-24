// Releases each changed plugin that has a root plugin.json, with semantic-release run in
// the plugin's directory (plugin.release.config.cjs). One failed release doesn't stop the
// others; the step fails at the end.
//   node scripts/release-plugins.mjs <file with one directory per line>
// BEFORE is the commit before the push that is being released.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { error, group, summary, table, warning } from './lib/actions.mjs';
import { readDirs } from './lib/dirs.mjs';
import { ensureBaseline, fileBefore, isImported, manifestVersion } from './lib/release.mjs';

const root = process.cwd();
const config = resolve(root, 'plugin.release.config.cjs');
const before = process.env.BEFORE ?? '';
const rows = [];
const count = { released: 0, skipped: 0, failed: 0 };
const skip = (name, why) => {
  warning(`${name} is not released: ${why}`);
  count.skipped += 1;
  rows.push([name, `skipped (${why})`, '⏭️']);
};
for (const dir of readDirs(process.argv[2])) {
  let name;
  try {
    name = JSON.parse(readFileSync(join(root, dir, 'plugin.json'), 'utf8')).name;
  } catch {
    skip(dir, 'no plugin.json that can be read');
    continue;
  }
  if (isImported(dir)) {
    skip(name, 'brought in from another repository');
    continue;
  }
  // the version before this push: the root plugin.json, or the Claude Code manifest of a
  // plugin that got its plugin.json in this push
  // a plugin that was there and has no version counts as 1.0.0; a new one starts there
  const earlier = fileBefore(root, before, `${dir}/plugin.json`) ?? fileBefore(root, before, `${dir}/.claude-plugin/plugin.json`);
  const was = earlier === null ? undefined : manifestVersion(earlier) ?? '1.0.0';
  const baseline = ensureBaseline(root, { prefix: `plugin/${name}/v`, version: was, before });
  if (baseline === 'unknown') {
    skip(name, `it is at ${was}, and the commit before this push is not known`);
    continue;
  }
  if (baseline === 'created') console.log(`${name}: counting from ${was}, its version before this push`);
  const result = group(`Releasing the plugin ${name}`, () => spawnSync('npx', ['semantic-release', '--extends', config], { cwd: join(root, dir), stdio: 'inherit' }));
  if (result.status === 0) {
    count.released += 1;
    rows.push([name, 'released, or nothing to release', '✅']);
  } else {
    error(`Release failed for the plugin ${name} (exit code ${result.status ?? result.error?.message})`);
    count.failed += 1;
    rows.push([name, 'failed', '❌']);
  }
}
rows.push(['**Total**', `**${count.released} run, ${count.skipped} skipped, ${count.failed} failed**`, count.failed === 0 ? '✅' : '❌']);
summary(['## Plugin Releases', '', ...table(['Plugin', 'Result', 'Status'], rows)]);
console.log(`Run: ${count.released}, skipped: ${count.skipped}, failed: ${count.failed}`);
if (count.failed > 0) {
  error(`${count.failed} plugin(s) failed to release`);
  process.exit(1);
}
