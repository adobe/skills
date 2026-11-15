// The prepare step of a plugin's release (plugin.release.config.cjs), run by semantic-release
// in the plugin's directory:
//   node scripts/prepare-plugin-release.mjs <version>
//
// 1. Writes the version to the root plugin.json. A version that a target overrides follows,
//    and so does a Tessl target's list of skills, which has to name the skills that ship.
// 2. Builds the generated manifests and the marketplace entries (x927 build --all) and
//    stages what changed, so that the release is one commit.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/is-main.mjs';
import { isVersion } from './lib/release.mjs';

const X927 = 'io.github.ai-ecoverse.x927';

// plugin.json with the new version. skills is the sorted list of skills/<name> folders.
export function withVersion(manifest, version, skills) {
  const next = structuredClone(manifest);
  next.version = version;
  for (const target of Object.values(next.extensions?.[X927]?.targets ?? {})) {
    if (target && 'version' in target) target.version = version;
  }
  const tessl = next.extensions?.[X927]?.targets?.tessl;
  if (tessl && 'skills' in tessl) tessl.skills = skills;
  return next;
}

function main() {
  const version = process.argv[2];
  if (!isVersion(version)) {
    console.error(`prepare-plugin-release: not a version: ${version}`);
    process.exit(2);
  }
  const dir = process.cwd();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifestPath = join(dir, 'plugin.json');
  const skills = existsSync(join(dir, 'skills'))
    ? readdirSync(join(dir, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, 'skills', entry.name, 'SKILL.md')))
      .map((entry) => `skills/${entry.name}`)
      .sort()
    : [];
  writeFileSync(manifestPath, `${JSON.stringify(withVersion(JSON.parse(readFileSync(manifestPath, 'utf8')), version, skills), null, 2)}\n`);

  const x927 = join(root, 'node_modules', '.bin', 'x927');
  const build = spawnSync(existsSync(x927) ? x927 : 'x927', ['build', '--all'], { cwd: root, encoding: 'utf8' });
  console.log(`${build.stdout ?? ''}${build.stderr ?? ''}`);
  if (build.status !== 0) {
    console.error(`prepare-plugin-release: x927 build --all failed (exit code ${build.status ?? build.error?.message})`);
    process.exit(1);
  }
  const written = [...(build.stdout ?? '').matchAll(/^wrote (\S.*)$/gm)].map((match) => match[1].trim());
  if (written.length > 0) execFileSync('git', ['add', '--', ...written], { cwd: root, stdio: 'inherit' });
  console.log(`${dir}: version ${version}; built ${written.length} generated file(s)`);
}

if (isMain(import.meta.url)) main();
