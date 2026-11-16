// Installs the agent CLIs that CI test-drives plugins in, and puts them into one directory:
// claude, codex, grok and agy (Google Antigravity).
//
//   node scripts/setup-agent-clis.mjs [<bin dir>]     default: .agent-clis/bin
//   node scripts/setup-agent-clis.mjs --update-agy    writes the latest Antigravity to agy.json
//   node scripts/setup-agent-clis.mjs --check-agy     warns when agy.json is behind the latest
//
// - claude comes from the root package (npm ci), codex and grok from scripts/agent-clis
//   (their own package and lockfile, so Renovate updates them and no other job pays for them).
// - agy has no npm package. scripts/agent-clis/agy.json pins a version with the URL and the
//   SHA-512 of its archive for each platform; the download is refused if the hash differs.
//   Nothing is piped into a shell.
// In GitHub Actions the directory is added to the PATH of the steps that follow, unless
// AGENT_CLIS_NO_PATH is set (the AI review sets it: its reviewers bring their own CLIs).
// Prints one line per CLI with its version. A CLI that can't be installed is a warning, and
// the others are still set up: the test drive reports a missing CLI as not installed.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { warning } from './lib/actions.mjs';
import { isMain } from './lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIS = join(ROOT, 'scripts', 'agent-clis');
const AGY = join(CLIS, 'agy.json');
const MANIFESTS = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests';

// The key of this machine in agy.json, as Antigravity names its platforms.
export function agyPlatform(platform = process.platform, arch = process.arch) {
  const os = { linux: 'linux', darwin: 'darwin' }[platform];
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch];
  return os && cpu ? `${os}_${cpu}` : null;
}

export const sha512 = (buffer) => createHash('sha512').update(buffer).digest('hex');

// Downloads the pinned archive, checks its hash and unpacks the binary to <dir>/agy.
export async function installAgy(dir, { pins = JSON.parse(readFileSync(AGY, 'utf8')), platform = agyPlatform(), fetchImpl = fetch } = {}) {
  const pin = pins.platforms?.[platform];
  if (!pin) throw new Error(`agy.json has no build of Antigravity ${pins.version} for ${platform ?? `${process.platform} ${process.arch}`}`);
  const response = await fetchImpl(pin.url);
  if (!response.ok) throw new Error(`${pin.url} answered ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const hash = sha512(archive);
  if (hash !== pin.sha512) throw new Error(`the archive of Antigravity ${pins.version} for ${platform} has the SHA-512 ${hash.slice(0, 16)}…, and agy.json pins ${pin.sha512.slice(0, 16)}…. Not installed.`);
  const work = mkdtempSync(join(tmpdir(), 'agy-'));
  try {
    writeFileSync(join(work, 'agy.tar.gz'), archive);
    execFileSync('tar', ['-xzf', join(work, 'agy.tar.gz'), '-C', work, 'antigravity']);
    writeFileSync(join(dir, 'agy'), readFileSync(join(work, 'antigravity')));
    chmodSync(join(dir, 'agy'), 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return join(dir, 'agy');
}

// The latest Antigravity for every platform, in the shape of agy.json.
export async function latestAgy(fetchImpl = fetch) {
  const platforms = {};
  let version;
  for (const platform of ['linux_amd64', 'linux_arm64', 'darwin_amd64', 'darwin_arm64']) {
    const response = await fetchImpl(`${MANIFESTS}/${platform}.json`);
    if (!response.ok) throw new Error(`${MANIFESTS}/${platform}.json answered ${response.status}`);
    const manifest = await response.json();
    if (version && manifest.version !== version) throw new Error(`the platforms are at different versions (${version} and ${manifest.version}); try again later`);
    version = manifest.version;
    platforms[platform] = { url: manifest.url, sha512: manifest.sha512 };
  }
  return { version, platforms };
}

// What to say when a newer Antigravity than the pinned one is out; null when there is none,
// or when the manifest service can't be asked. Renovate has no datasource for it.
export async function agyBehind(pins = JSON.parse(readFileSync(AGY, 'utf8')), fetchImpl = fetch) {
  try {
    const latest = await latestAgy(fetchImpl);
    return latest.version === pins.version ? null : `Antigravity ${latest.version} is out and scripts/agent-clis/agy.json pins ${pins.version}. To update: node scripts/setup-agent-clis.mjs --update-agy`;
  } catch {
    return null;
  }
}

function link(dir, name, target) {
  if (!existsSync(target)) return false;
  rmSync(join(dir, name), { force: true });
  symlinkSync(target, join(dir, name));
  return true;
}

async function main() {
  if (process.argv[2] === '--update-agy') {
    const pins = await latestAgy();
    writeFileSync(AGY, `${JSON.stringify(pins, null, 2)}\n`);
    console.log(`agy.json pins Antigravity ${pins.version}`);
    return;
  }
  if (process.argv[2] === '--check-agy') {
    const behind = await agyBehind();
    if (behind) warning(behind);
    else console.log('agy.json is at the latest Antigravity, or the manifest service did not answer.');
    return;
  }
  const dir = resolve(process.argv[2] || join(ROOT, '.agent-clis', 'bin'));
  mkdirSync(dir, { recursive: true });
  const problems = [];

  if (!link(dir, 'claude', join(ROOT, 'node_modules', '.bin', 'claude'))) problems.push('claude: not in node_modules; run npm ci in the repository root first');

  // --ignore-scripts: both packages carry their binary in a platform package, and neither needs its install script
  const install = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: CLIS, encoding: 'utf8' });
  if (install.status !== 0) problems.push(`codex, grok: npm ci in scripts/agent-clis failed: ${(install.stderr || install.stdout || '').trim().split('\n').pop()}`);
  for (const name of ['codex', 'grok']) {
    if (!link(dir, name, join(CLIS, 'node_modules', '.bin', name)) && install.status === 0) problems.push(`${name}: npm ci left no ${name} in scripts/agent-clis/node_modules/.bin`);
  }

  try {
    await installAgy(dir);
  } catch (error) {
    problems.push(`agy: ${error.message}`);
  }

  if (process.env.GITHUB_PATH && !process.env.AGENT_CLIS_NO_PATH) appendFileSync(process.env.GITHUB_PATH, `${dir}\n`);
  const home = mkdtempSync(join(tmpdir(), 'cli-home-'));
  try {
    for (const name of ['claude', 'codex', 'grok', 'agy']) {
      const bin = join(dir, name);
      const version = existsSync(bin) ? spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: home } }) : null;
      console.log(`${name}: ${version?.status === 0 ? version.stdout.trim().split('\n')[0] : 'not installed'}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  for (const problem of problems) warning(problem);
  console.log(`The agent CLIs are in ${dir}`);
}

if (isMain(import.meta.url)) await main();
