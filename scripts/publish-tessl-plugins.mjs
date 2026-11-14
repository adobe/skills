// Publishes each Tessl plugin whose manifest version differs from the one before this
// push. Without a usable "before" (a first push, a force push), a plugin is published
// only if its manifest is among the changed files.
//   node scripts/publish-tessl-plugins.mjs <before sha> <after sha>
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { error, group, summary, table } from './lib/actions.mjs';
import { changedFiles, tesslPluginDirs } from './lib/changed.mjs';

const [before = '', after = 'HEAD'] = process.argv.slice(2);
const root = process.cwd();
const known = before !== '' && !/^0+$/.test(before);

// "null" for a manifest without a version, as jq printed it; "" for no manifest at all.
const version = (text) => {
  try {
    return String(JSON.parse(text).version ?? 'null');
  } catch {
    return '';
  }
};
function versionBefore(manifest) {
  try {
    return version(execFileSync('git', ['show', `${before}:${manifest}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return '';
  }
}
function changed() {
  try {
    return changedFiles(root, [`${before}..${after}`]);
  } catch {
    return changedFiles(root, ['HEAD']);
  }
}

const files = known ? [] : changed();
const rows = [];
const count = { published: 0, failed: 0 };
for (const dir of tesslPluginDirs(root)) {
  const manifest = `${dir}/.tessl-plugin/plugin.json`;
  const now = version(readFileSync(manifest, 'utf8'));
  const publish = known ? versionBefore(manifest) !== now : files.includes(manifest);
  if (!publish) continue;
  const name = basename(dir);
  const result = group(`Publishing plugin ${name} (${now})`, () => spawnSync('tessl', ['plugin', 'publish', dir], { stdio: 'inherit' }));
  if (result.status === 0) {
    count.published += 1;
    rows.push([name, 'published', '✅']);
  } else {
    error(`Publish failed for ${name} (exit code ${result.status ?? result.error?.message})`);
    count.failed += 1;
    rows.push([name, 'failed', '❌']);
  }
}
if (rows.length === 0) {
  console.log('No plugin versions changed.');
  process.exit(0);
}
rows.push(['**Total**', `**${count.published} published, ${count.failed} failed**`, count.failed === 0 ? '✅' : '❌']);
summary(['## Plugin Publishes', '', ...table(['Plugin', 'Result', 'Status'], rows)]);
console.log(`Published: ${count.published}, failed: ${count.failed}`);
if (count.failed > 0) {
  error(`${count.failed} plugin(s) failed to publish`);
  process.exit(1);
}
