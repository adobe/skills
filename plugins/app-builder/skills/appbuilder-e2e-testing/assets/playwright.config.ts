import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Adobe App Builder E2E tests.
 * Customize baseURL and webServer command for your project.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: process.env.CI ? 'never' : 'on-failure' }],
  ],
  timeout: 30_000,

  use: {
    baseURL: process.env.APP_URL || 'https://localhost:9080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // NOTE: Remove or comment out this webServer block for CI environments
  // if using page.route() to stub action responses (recommended for v1).
  // The aio CLI is not available on CI runners unless explicitly installed.
  webServer: {
    command: 'aio app dev',
    url: 'https://localhost:9080',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    ignoreHTTPSErrors: true,
  },
});
