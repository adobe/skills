/*
 * Where custom-component e2e tests live and how they run, based on the repository's own Playwright
 * setup: tests go in `<testDir>/custom-components/` of the repo's Playwright config (default
 * `test/e2e`) and run with that config. Only a repo without any Playwright config gets a minimal
 * root `playwright.config.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

export const PLAYWRIGHT_CONFIGS = [
  'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs',
  'playwright.config.ts', 'playwright.config.mts', 'playwright.config.cts',
];
export const DEFAULT_TEST_DIR = 'test/e2e';
export const FALLBACK_CONFIG_FILE = 'playwright.config.mjs';
export const FALLBACK_CONFIG = `import { defineConfig, devices } from '@playwright/test';

// Added by the create-custom-component skill because the repository had no Playwright config.
export default defineConfig({
  testDir: './${DEFAULT_TEST_DIR}',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
`;

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** The repository's Playwright config file name, or null. */
export function findPlaywrightConfig(root) {
  return PLAYWRIGHT_CONFIGS.find((f) => existsSync(join(root, f))) || null;
}

/**
 * Resolves the test layout: `{ configFile, testDir, dir }` where `dir` (relative to the root) is
 * the folder holding the harness and one sub-folder per component.
 */
export function e2eLayout(root) {
  const configFile = findPlaywrightConfig(root);
  let testDir = DEFAULT_TEST_DIR;
  const declared = configFile && read(join(root, configFile))?.match(/\btestDir\s*:\s*['"`]([^'"`]+)['"`]/);
  if (declared) testDir = normalize(declared[1]).replace(/^\.\//, '').replace(/\/$/, '') || '.';
  return { configFile, testDir, dir: join(testDir, 'custom-components') };
}

/** Names of the projects declared in the Playwright config (best effort). */
export function playwrightProjects(root, configFile) {
  const text = configFile ? read(join(root, configFile)) : null;
  const block = text?.match(/\bprojects\s*:\s*\[([\s\S]*)\]/)?.[1] || '';
  return [...block.matchAll(/\bname\s*:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

function covers(lines, top) {
  return lines.some((l) => {
    const p = l.trim().replace(/^\//, '').replace(/\/?\*{0,2}$/, '').replace(/\/$/, '');
    return p && !l.trim().startsWith('#') && (p === top || p === `${top}/*`);
  });
}

/**
 * Warnings when the test folder would be published to Edge Delivery Services (.hlxignore) or
 * linted (.eslintignore / ESLint ignorePatterns), with the line to add.
 */
export function ignoreWarnings(root, dir) {
  const top = dir.split('/')[0];
  const warnings = [];
  const hlx = read(join(root, '.hlxignore'));
  if (hlx !== null && !covers(hlx.split('\n'), top)) {
    warnings.push(`.hlxignore does not exclude ${top}/ — test files would be published to Edge Delivery Services. Add the line: ${top}/*`);
  }
  const eslintIgnore = read(join(root, '.eslintignore'));
  const eslintConfig = ['.eslintrc.cjs', '.eslintrc.js', '.eslintrc.json', '.eslintrc', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']
    .map((f) => read(join(root, f))).find((t) => t !== null) || '';
  const inConfig = new RegExp(`['"\`]/?${top}(/\\*{0,2})?/?['"\`]`).test(eslintConfig);
  if (!(eslintIgnore !== null && covers(eslintIgnore.split('\n'), top)) && !inConfig) {
    warnings.push(`ESLint does not ignore ${top}/ — the generated specs will be linted. Add /${top} to .eslintignore (or the ESLint ignores), or make them pass lint`);
  }
  return warnings;
}
