#!/usr/bin/env node
/*
 * Runs the custom-component e2e tests with the repository's own @playwright/test and Playwright
 * config: `playwright test <testDir>/custom-components/<name>/ --retries=0`, limited to the
 * `chromium` project when the config declares one. The same tests also run with the repository's
 * normal e2e command (e.g. npm run test:e2e).
 *
 * If the repository has no Playwright config, or its config fails to load (checked with
 * `playwright test --list`), it falls back to a temporary standalone config (Chromium, no retries)
 * written to the OS temp folder, and prints why.
 *
 * Exit codes: Playwright's exit code (0 = all passed, 1 = failures), 2 = usage/environment error.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2eLayout, playwrightProjects } from './e2e-layout.mjs';

const USAGE = `run-e2e-test.mjs — run AEM Forms custom-component e2e tests

Usage:
  node run-e2e-test.mjs [<component-name>] [--root <dir>] [--headed] [-- <extra playwright args>]

Runs <testDir>/custom-components/<name>/ (all components when no name is given) from the
repository root with the repository's @playwright/test and Playwright config, Chromium only,
without retries. Equivalent to:
  npx playwright test <testDir>/custom-components/<name>/ --project=chromium --retries=0

Options:
  --root <dir>  Repository root containing package.json and blocks/form (default: cwd)
  --headed      Show the browser
  -h, --help    Show this help

If @playwright/test is not installed in the project:
  npm i -D @playwright/test && npx playwright install chromium

Exit codes: 0 = all tests passed, 1 = test failures, 2 = usage or environment error.`;

function parseArgs(argv) {
  const opts = { extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      opts.extra = argv.slice(i + 1);
      break;
    }
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--headed') opts.headed = true;
    else if (arg === '--root') {
      if (argv[i + 1] === undefined) throw new Error('--root needs a value');
      opts.root = argv[i += 1];
    } else if (arg.startsWith('--root=')) opts.root = arg.slice(7);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.name) opts.name = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return opts;
}

/** Resolves the Playwright CLI of the project's @playwright/test, or null. */
export function resolvePlaywrightCli(root) {
  try {
    const pkg = createRequire(join(root, 'package.json')).resolve('@playwright/test/package.json');
    const cli = join(dirname(pkg), 'cli.js');
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

export function buildCommand(opts) {
  const root = resolve(opts.root || process.cwd());
  if (!existsSync(join(root, 'blocks/form'))) throw new Error(`No blocks/form under ${root}; run from the repository root or pass --root`);
  const { configFile, dir } = e2eLayout(root);
  const target = opts.name ? `${dir}/${opts.name}/` : `${dir}/`;
  if (!existsSync(join(root, target))) throw new Error(`No tests at ${target}; generate them with create-e2e-test.mjs first`);
  const cli = resolvePlaywrightCli(root);
  if (!cli) throw new Error('@playwright/test is not installed in this project. Run: npm i -D @playwright/test && npx playwright install chromium');
  const args = [cli, 'test', target, '--retries=0'];
  if (configFile && playwrightProjects(root, configFile).includes('chromium')) args.push('--project=chromium');
  if (opts.headed) args.push('--headed');
  args.push(...opts.extra);
  return {
    root, args, configFile, cli, target, opts,
  };
}

/** Writes a temporary standalone Playwright config for the target folder and returns its path. */
export function standaloneConfig(root, target) {
  const file = join(mkdtempSync(join(tmpdir(), 'aem-forms-e2e-')), 'playwright.config.mjs');
  writeFileSync(file, `export default ${JSON.stringify({
    testDir: join(root, target),
    testMatch: '**/*.spec.js',
    retries: 0,
    reporter: [['list']],
    outputDir: join(dirname(file), 'results'),
    use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  }, null, 2)};\n`);
  return file;
}

/** Command to use: the repo config when it loads, else a standalone config. */
export function resolveRun(cmd) {
  if (cmd.configFile) {
    const list = spawnSync(process.execPath, [...cmd.args.slice(0, 3), '--list', ...cmd.args.slice(4).filter((a) => a.startsWith('--project'))], { cwd: cmd.root, encoding: 'utf8' });
    if (list.status === 0) return { args: cmd.args, note: `Using ${cmd.configFile}` };
    const reason = `${list.stderr || ''}${list.stdout || ''}`.split('\n').find((l) => /error/i.test(l)) || `exit ${list.status}`;
    const config = standaloneConfig(cmd.root, cmd.target);
    return {
      args: [cmd.cli, 'test', '--config', config, '--retries=0', ...(cmd.opts.headed ? ['--headed'] : []), ...cmd.opts.extra],
      note: `The repository's ${cmd.configFile} could not be used (${reason.trim()}); running with a temporary standalone config instead. Fix the repo config so the tests also run in its own e2e suite.`,
    };
  }
  const config = standaloneConfig(cmd.root, cmd.target);
  return {
    args: [cmd.cli, 'test', '--config', config, '--retries=0', ...(cmd.opts.headed ? ['--headed'] : []), ...cmd.opts.extra],
    note: 'The repository has no Playwright config; running with a temporary standalone config.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  let cmd;
  try {
    cmd = buildCommand(opts);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  }
  const { args, note } = resolveRun(cmd);
  console.log(`${note}\n> playwright ${args.slice(1).join(' ')}`);
  const run = spawnSync(process.execPath, args, { cwd: cmd.root, stdio: 'inherit' });
  process.exit(run.status ?? 2);
}
