/*
 * skills/personalize/scripts/lib.mjs — shared helpers for the personalize
 * scripts. No dependencies. Assets resolve in both layouts: the plugin tree
 * (skills/personalize/scripts ↔ ../assets) and the project copy
 * (stardust/scripts/personalize/ with assets/ copied alongside).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = [resolve(HERE, '..', 'assets'), join(HERE, 'assets')]
  .find((dir) => existsSync(join(dir, 'runtime'))) || resolve(HERE, '..', 'assets');
export const RUNTIME_DIR = join(ASSETS_DIR, 'runtime');
export const EDGE_DIR = join(ASSETS_DIR, 'edge', 'cloudflare');
export const RUNTIME_MODULES = ['index.js', 'rules.js', 'contract.js', 'context.js', 'provider-api.js'];
export const SHARED_WITH_EDGE = ['rules.js', 'contract.js', 'context.js', 'provider-api.js'];

/**
 * Minimal argv parser: --flag, --key value, --key=value, positionals.
 * @param {string[]} argv
 * @returns {{_: string[], [key: string]: string|boolean|string[]}}
 */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
        value = argv[i + 1];
        i += 1;
      } else value = true;
      args[key] = key in args ? [].concat(args[key], value) : value;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

/**
 * Prints the usage and exits 0 when --help / -h is on the command line. Call it
 * first in a script's main block, before any argument parsing or I/O.
 * @param {string} usage
 */
export function exitOnHelp(usage) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage.trim());
    process.exit(0);
  }
}

/**
 * @param {string} url import.meta.url of the caller
 * @returns {boolean} true when the module is the process entry point
 */
export function isMain(url) {
  return !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url;
}

/**
 * @param {string} file
 * @returns {object|null}
 */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} file
 * @returns {string|null}
 */
export function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/**
 * Imports a module from the skill assets.
 * @param {...string} parts path below assets/
 * @returns {Promise<object>}
 */
export function importAsset(...parts) {
  return import(pathToFileURL(join(ASSETS_DIR, ...parts)).href);
}

/**
 * Site fragment prefixes from scripts/personalization/config.js, if installed.
 * Read textually so the browser module is never executed in Node.
 * @param {string} repo
 * @returns {string[]}
 */
export function sitePrefixes(repo) {
  const config = readText(join(repo, 'scripts', 'personalization', 'config.js'));
  const match = config && /fragmentPrefixes\s*:\s*\[([^\]]*)\]/.exec(config);
  if (!match) return ['/fragments/'];
  const prefixes = [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  return prefixes.length ? prefixes : ['/fragments/'];
}

/**
 * Locates the loadEager function of a scripts.js source.
 * @param {string} scripts
 * @returns {{start: number, body: string}|null} offset and source of loadEager
 */
export function findLoadEager(scripts) {
  const start = scripts.search(/async function loadEager\s*\(/);
  if (start === -1) return null;
  const next = scripts.slice(start + 1).search(/\n(async )?function /);
  return { start, body: next === -1 ? scripts.slice(start) : scripts.slice(start, start + 1 + next) };
}

/**
 * Prints a PASS/FAIL line.
 * @param {boolean} ok
 * @param {string} message
 */
export function status(ok, message) {
  console.log(`${ok ? '✓ PASS' : '❌ FAIL'} ${message}`);
}
