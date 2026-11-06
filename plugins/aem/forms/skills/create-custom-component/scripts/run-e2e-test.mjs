#!/usr/bin/env node
/*
 * Runs the custom-component e2e tests in test/e2e/custom-components/ with the project's own
 * @playwright/test and the config shipped in this skill (assets/e2e/playwright.config.mjs), so the
 * project needs no Playwright config and its own config (deployed URLs, login, global setup) is
 * never used.
 *
 * Exit codes: Playwright's exit code (0 = all passed, 1 = failures), 2 = usage/environment error.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `run-e2e-test.mjs — run AEM Forms custom-component e2e tests

Usage:
  node run-e2e-test.mjs [<component-name>] [--root <dir>] [--headed] [-- <extra playwright args>]

Runs test/e2e/custom-components/<name>/ (all components when no name is given) from the
repository root, using the project's @playwright/test and this skill's Playwright config.

Options:
  --root <dir>  Repository root containing package.json and blocks/form (default: cwd)
  --headed      Show the browser
  -h, --help    Show this help

If @playwright/test is not installed in the project:
  npm i -D @playwright/test && npx playwright install chromium

Exit codes: 0 = all tests passed, 1 = test failures, 2 = usage or environment error.`;

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '../assets/e2e/playwright.config.mjs');

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
  const testsDir = join(root, 'test/e2e/custom-components');
  if (!existsSync(join(root, 'blocks/form'))) throw new Error(`No blocks/form under ${root}; run from the repository root or pass --root`);
  const target = opts.name ? join(testsDir, opts.name) : testsDir;
  if (!existsSync(target)) throw new Error(`No tests at ${target}; generate them with create-e2e-test.mjs first`);
  const cli = resolvePlaywrightCli(root);
  if (!cli) throw new Error('@playwright/test is not installed in this project. Run: npm i -D @playwright/test && npx playwright install chromium');
  const args = [cli, 'test', '--config', CONFIG];
  if (opts.name) args.push(`custom-components/${opts.name}/`);
  if (opts.headed) args.push('--headed');
  args.push(...opts.extra);
  return { root, args };
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
  const run = spawnSync(process.execPath, cmd.args, { cwd: cmd.root, stdio: 'inherit' });
  process.exit(run.status ?? 2);
}
