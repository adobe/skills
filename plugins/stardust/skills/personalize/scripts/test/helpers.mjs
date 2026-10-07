/*
 * Shared test helpers: asset imports, fixtures, temp repos and the --help
 * contract every CLI answers.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDGE_DIR, RUNTIME_DIR, SHARED_WITH_EDGE } from '../lib.mjs';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const SITE = join(FIXTURES, 'site');

export const rules = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'rules.js')).href);
export const contract = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'contract.js')).href);
export const context = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'context.js')).href);
export const html = await import(pathToFileURL(join(EDGE_DIR, 'src', 'personalization', 'html.js')).href);

/**
 * @param {string} name file under fixtures/site
 * @returns {string}
 */
export function fixture(name) {
  return readFileSync(join(SITE, name), 'utf8');
}

/**
 * Creates a temp dir and returns it with a cleanup function.
 * @param {string} prefix
 * @returns {{dir: string, cleanup: () => void}}
 */
export function tempDir(prefix = 'pzn-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Assembles the edge worker sources (as install-edge does) in a temp dir so
 * the worker's relative imports resolve.
 * @returns {{dir: string, cleanup: () => void, load: (file: string) => Promise<object>}}
 */
export function edgeBundle() {
  const { dir, cleanup } = tempDir('pzn-edge-test-');
  cpSync(join(EDGE_DIR, 'src'), dir, { recursive: true });
  SHARED_WITH_EDGE.forEach((name) => cpSync(
    join(RUNTIME_DIR, 'scripts', 'personalization', name),
    join(dir, 'personalization', name),
  ));
  return { dir, cleanup, load: (file) => import(pathToFileURL(join(dir, file)).href) };
}

/**
 * Rows in the shape findBlocks/the DOM runtime produce.
 * @param {[string, string, object?][]} pairs key, value, extra fields
 * @returns {object[]}
 */
export function rows(pairs) {
  return pairs.map(([key, value, extra = {}]) => ({
    key, value, inline: false, html: value, ...extra,
  }));
}

// loadEager as shipped in adobe/aem-boilerplate.
export const BOILERPLATE_SCRIPTS = `import { decorateMain as d } from './aem.js';

/**
 * Loads everything needed to get to LCP.
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }
}

async function loadLazy(doc) {
  decorateMain(main);
}
`;

export const FRAGMENT_JS = 'export async function loadFragment(path) { return path; }\n';

/**
 * A boilerplate-shaped EDS repo (scripts.js + fragment block) in a temp dir.
 * @returns {{dir: string, cleanup: () => void}}
 */
export function siteRepo() {
  const temp = tempDir('pzn-repo-');
  mkdirSync(join(temp.dir, 'scripts'), { recursive: true });
  mkdirSync(join(temp.dir, 'blocks', 'fragment'), { recursive: true });
  writeFileSync(join(temp.dir, 'scripts', 'scripts.js'), BOILERPLATE_SCRIPTS);
  writeFileSync(join(temp.dir, 'blocks', 'fragment', 'fragment.js'), FRAGMENT_JS);
  return temp;
}

/**
 * Runs a CLI with --help in an empty temp cwd: exit 0, usage on stdout and
 * nothing written (the stardust script-help contract).
 * @param {string} script file name under scripts/
 * @returns {{status: number|null, stdout: string, wrote: string[]}}
 */
export function runHelp(script) {
  const { dir, cleanup } = tempDir('pzn-help-');
  try {
    const result = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', script), '--help'], { cwd: dir, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, wrote: readdirSync(dir) };
  } finally {
    cleanup();
  }
}
