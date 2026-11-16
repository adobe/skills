// Publishes plugins to the Tessl registry. Every plugin has a Tessl manifest, built from its
// root plugin.json (check-plugins.mjs source holds a pull request to that), and each is
// published when the version in that manifest differs from the one before this push: with
// every release of the plugin, and the first time it has a manifest at all. Without a usable
// "before" (a first push, a force push), a plugin is published only if its manifest is among
// the changed files.
//   node scripts/publish-tessl-plugins.mjs <before sha> <after sha>
//
// A publish that times out is tried again, up to ATTEMPTS times (default 3), RETRY_DELAY
// seconds apart (default 10): the CLI stops waiting after 20 seconds, and the upload often
// went through. A version that is already on the registry is not a failure, so the job can
// be run again. At the end it prints what the registry says about each uploaded version,
// because an accepted upload becomes available only after Tessl's publication checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { error, group, summary, table, warning } from './lib/actions.mjs';
import { changedFiles, tesslPluginDirs } from './lib/changed.mjs';
import { publishOutcome } from './lib/tessl.mjs';

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

// Runs the publish, with its output in the log, and says what came of it.
function publish(dir) {
  const result = spawnSync('tessl', ['plugin', 'publish', dir], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { outcome: publishOutcome(result.status, output), status: result.status ?? result.error?.message };
}

const attempts = Number(process.env.ATTEMPTS || 3);
const delay = Number(process.env.RETRY_DELAY || 10);
const files = known ? [] : changed();
const rows = [];
const uploaded = [];
const count = { published: 0, failed: 0 };
for (const dir of tesslPluginDirs(root)) {
  const manifest = `${dir}/.tessl-plugin/plugin.json`;
  const text = readFileSync(manifest, 'utf8');
  const now = version(text);
  const wanted = known ? versionBefore(manifest) !== now : files.includes(manifest);
  if (!wanted) continue;
  const name = basename(dir);
  let result;
  let tries = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    tries = attempt;
    result = group(`Publishing plugin ${name} (${now})${attempt > 1 ? `, attempt ${attempt}` : ''}`, () => publish(dir));
    if (result.outcome !== 'timeout' || attempt === attempts) break;
    warning(`The publish of ${name} timed out. Trying again in ${delay} seconds.`);
    await sleep(delay * 1000);
  }
  if (result.outcome === 'published') {
    count.published += 1;
    rows.push([name, tries > 1 ? `published, at attempt ${tries}` : 'published', '✅']);
  } else if (result.outcome === 'exists') {
    // after a timeout: that attempt's upload went through. On a first attempt: an earlier run published it.
    count.published += 1;
    rows.push([name, tries > 1 ? 'published: the attempt that timed out went through' : `${now} was on the registry already`, '✅']);
  } else {
    const why = { blocked: 'the upload was accepted, but the version is not available', timeout: `timed out ${attempts} times` }[result.outcome] ?? `exit code ${result.status}`;
    error(`Publish failed for ${name} (${why})`);
    count.failed += 1;
    rows.push([name, `failed: ${why}`, '❌']);
  }
  // also after a timeout: the upload may have gone through
  if (result.outcome !== 'failed') {
    try {
      uploaded.push(`${JSON.parse(text).name}@${now}`);
    } catch {
      // a manifest without a name was not uploaded
    }
  }
}
if (rows.length === 0) {
  console.log('No plugin versions changed.');
  process.exit(0);
}
// An accepted upload is available only after Tessl's publication checks. This is what the
// registry says now; it is for the log, and decides nothing.
for (const plugin of uploaded) {
  group(`On the registry: ${plugin}`, () => spawnSync('tessl', ['plugin', 'info', plugin], { stdio: 'inherit' }));
}
rows.push(['**Total**', `**${count.published} published, ${count.failed} failed**`, count.failed === 0 ? '✅' : '❌']);
summary(['## Plugin Publishes', '', ...table(['Plugin', 'Result', 'Status'], rows)]);
console.log(`Published: ${count.published}, failed: ${count.failed}`);
if (count.failed > 0) {
  error(`${count.failed} plugin(s) failed to publish`);
  process.exit(1);
}
