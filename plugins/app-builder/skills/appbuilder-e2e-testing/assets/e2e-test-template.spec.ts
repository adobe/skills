import { test, expect } from '@playwright/test';

/**
 * E2E test template for an Adobe App Builder ExC Shell SPA.
 *
 * This scaffold demonstrates:
 * - Navigating into the ExC Shell iframe
 * - Using ARIA selectors (getByRole, getByText) — no CSS classes
 * - Stubbing action responses with page.route()
 *
 * Copy this file into your project's e2e/ directory and customise.
 */

// TODO: adjust the action URL pattern to match your App Builder namespace/package
const ACTION_URL_PATTERN = '**/api/v1/web/**';

test.describe('App Builder SPA', () => {
  let appFrame: ReturnType<typeof test.info>; // typed below in beforeEach

  test.beforeEach(async ({ page }) => {
    // Stub action responses for deterministic tests.
    // TODO: adjust the URL pattern and response body for your action(s).
    await page.route(ACTION_URL_PATTERN, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // TODO: replace with your expected action response shape
          items: [
            { id: '1', name: 'Sample Item' },
          ],
        }),
      }),
    );

    // Navigate to the app (baseURL comes from playwright.config.ts)
    await page.goto('/');

    // Wait for the ExC Shell to load the SPA inside its iframe.
    // TODO: adjust the iframe selector if your shell uses a different src pattern.
    const frame = page.frameLocator('iframe[src*="localhost"]');

    // Wait for app content to be ready inside the iframe
    await expect(
      frame.getByRole('heading', { name: /My App/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Store the frame locator for use in tests
    // (Playwright frameLocator is re-evaluated each call, so this is safe)
    (page as any).__appFrame = frame;
  });

  test('fills form and submits successfully', async ({ page }) => {
    const frame = (page as any).__appFrame as ReturnType<
      typeof page.frameLocator
    >;

    // TODO: adjust role and name to match your form's heading / fields
    await expect(frame.getByRole('heading', { name: /My App/i })).toBeVisible();

    // Fill in a text field using its accessible label
    // TODO: adjust the label name to match your form field
    await frame.getByRole('textbox', { name: 'Name' }).fill('Test Entry');

    // Submit the form
    // TODO: adjust the button label to match your submit button
    await frame.getByRole('button', { name: 'Submit' }).click();

    // Verify a success message appears
    // TODO: adjust the expected success text
    await expect(frame.getByText('Success')).toBeVisible();
  });
});
