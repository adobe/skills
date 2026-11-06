// Playwright config for custom-component e2e tests, shipped with the skill so the project needs
// no Playwright config of its own. It imports nothing, so it can live outside the project; the
// project's own @playwright/test runs it (see scripts/run-e2e-test.mjs). Paths resolve from the
// working directory, which must be the repository root.
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();

export default {
  testDir: join(root, 'test/e2e/custom-components'),
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: join(tmpdir(), 'aem-forms-custom-component-e2e'),
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
};
