import { defineConfig, devices } from '@playwright/test';

// Standalone config for custom-component e2e tests: no deployed site, login or global setup.
// Run from the repository root:
//   npx playwright test --config test/e2e/custom-components/playwright.config.js
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../../test-results/custom-components',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
