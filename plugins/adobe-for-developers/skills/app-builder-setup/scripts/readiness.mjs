// Read-only App Builder readiness check. Prints one JSON object; never prints tokens.
import { aio, run } from './lib/run.mjs';
import { readCliConfig } from './lib/cli-config.mjs';

const MIN_NODE = 20;
// 11.1.0 bundles aio-cli-plugin-app 14.8.0, the first that creates a missing project with `aio app init -y --project`.
const MIN_AIO = '11.1.0';

const semver = (text) => text?.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) ?? null;
const atLeast = (v, min) => {
  const [a, b] = [semver(v), semver(min)];
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};
const npm = run('npm', ['--version']);
const aioVersion = aio(['--version']);
const version = semver(aioVersion.stdout.match(/aio-cli\/\S+/)?.[0])?.join('.') ?? null;
const report = {
  node: { version: process.versions.node, ok: Number(process.versions.node.split('.')[0]) >= MIN_NODE, minimum: `${MIN_NODE}.0.0` },
  nvm: Boolean(process.env.NVM_DIR),
  npm: { version: npm.ok ? npm.stdout : null, ok: npm.ok },
  aio: { installed: Boolean(version), version, minimum: MIN_AIO, ok: atLeast(version, MIN_AIO), latest: null, updateAvailable: false },
  // null = can't be checked until the CLI is installed.
  cliEnv: null,
  signedIn: null,
  selection: null,
};

if (version) {
  const latest = run('npm', ['view', '@adobe/aio-cli', 'version'], { timeoutMs: 15_000 });
  report.aio.latest = latest.ok ? semver(latest.stdout)?.join('.') ?? null : null;
  report.aio.updateAvailable = Boolean(report.aio.latest) && !atLeast(version, report.aio.latest);
  Object.assign(report, readCliConfig());
}

console.log(JSON.stringify(report, null, 2));
