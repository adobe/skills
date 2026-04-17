# Playwright E2E Patterns for ExC Shell SPAs

Playwright patterns for browser E2E testing of App Builder SPAs running inside the Experience Cloud Shell.

## Playwright Project Setup

### Config structure

Use `assets/playwright.config.ts` as the base. Key settings:

- `testDir: './e2e'` — keep E2E tests separate from Jest unit tests in `test/`
- `baseURL` — defaults to `https://localhost:9080` (local dev) or set `APP_URL` env var for deployed
- `timeout: 30_000` — shell initialization can be slow
- `webServer.command: 'aio app dev'` — auto-starts local dev server
- `ignoreHTTPSErrors: true` — local dev uses self-signed certs

### Project definitions

```typescript
// Local dev testing (recommended for v1)
{ name: 'local', use: { baseURL: 'https://localhost:9080' } }

// Deployed Stage testing
{ name: 'stage', use: { baseURL: process.env.STAGE_URL } }
```

## ExC Shell Iframe Navigation

App Builder SPAs run inside an iframe in Experience Cloud Shell. All test interactions must target the iframe content, not the shell chrome.

### Finding the iframe

```typescript
// Primary pattern — use frameLocator for automatic waiting
const appFrame = page.frameLocator('iframe[src*="localhost:9080"]');

// Discovery approach — list all frames to find yours
const frames = page.frames();
for (const frame of frames) {
  console.log(frame.url());
}

// Alternative — match by URL pattern for deployed apps
const appFrame = page.frameLocator('iframe[src*="your-app-id.adobeio-static.net"]');
```

### Waiting for shell initialization

The ExC Shell shows a spinner until `runtime.done()` is called by the SPA. Wait for your content, not the shell:

```typescript
// Wait for content inside the iframe — not the shell spinner
await appFrame.getByRole('heading', { name: 'My App' }).waitFor();

// Or wait for any substantive content to appear
await appFrame.locator('[data-testid="app-loaded"]').waitFor();
```

**Important:** The exact iframe selector depends on the shell version and deployment. Always verify with DevTools (`Elements` panel → inspect the iframe containing your SPA). Local dev with `aio app dev` may not use the shell at all — the SPA loads directly.

## React Spectrum ARIA Selectors

React Spectrum components render standard ARIA roles. Always use role-based selectors for stability.

### Component selector mapping

```typescript
// TableView
const table = appFrame.getByRole('grid');
const rows = appFrame.getByRole('row');
const firstRow = appFrame.getByRole('row').nth(1); // skip header

// Button
const saveBtn = appFrame.getByRole('button', { name: 'Save' });

// TextField
const nameField = appFrame.getByRole('textbox', { name: 'Name' });

// NumberField
const ageField = appFrame.getByRole('spinbutton', { name: 'Age' });

// Picker (Select/Dropdown)
await appFrame.getByRole('button', { name: 'Status' }).click();
await page.getByRole('option', { name: 'Active' }).click();
// Note: Picker options render in a portal outside the iframe

// Checkbox
const agree = appFrame.getByRole('checkbox', { name: 'I agree' });

// Dialog / Modal
const dialog = appFrame.getByRole('dialog');
await dialog.getByRole('button', { name: 'Confirm' }).click();

// ProgressCircle (loading indicator)
const loading = appFrame.getByRole('progressbar');
await loading.waitFor({ state: 'hidden' }); // wait for loading to finish
```

### Tips

- **Labels matter:** Spectrum components use `label` prop as ARIA accessible name. If `getByRole` can't find it, check the component's `label` or `aria-label` prop.
- **Portals:** Picker options, tooltips, and toasts render outside the iframe in portals. Use `page.getByRole()` (not `appFrame`) for these.
- **Test IDs:** For complex cases, add `data-testid` props — Spectrum components pass through unknown props.

## Full-Stack Flow Testing

Test the complete UI → action → response → UI update cycle:

```typescript
import { test, expect } from '@playwright/test';

test('create item flow', async ({ page }) => {
  await page.goto('/');
  const app = page.frameLocator('iframe[src*="localhost"]');

  // Navigate to create form
  await app.getByRole('button', { name: 'Create New' }).click();

  // Fill form fields
  await app.getByRole('textbox', { name: 'Title' }).fill('Test Item');
  await app.getByRole('textbox', { name: 'Description' }).fill('E2E test item');

  // Submit form
  await app.getByRole('button', { name: 'Save' }).click();

  // Wait for success toast (renders in portal, outside iframe)
  await expect(page.getByText('Item created successfully')).toBeVisible();

  // Verify item appears in table
  await expect(app.getByRole('row', { name: /Test Item/ })).toBeVisible();
});
```

## Action Response Stubbing

Use `page.route()` to intercept Runtime action HTTP calls for deterministic testing:

```typescript
// Stub a successful action response
await page.route('**/api/v1/web/**', async (route) => {
  if (route.request().url().includes('get-items')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: '1', title: 'Item 1', status: 'active' },
          { id: '2', title: 'Item 2', status: 'draft' },
        ],
      }),
    });
  } else {
    await route.continue();
  }
});

// Stub an error response
await page.route('**/api/v1/web/**/create-item', async (route) => {
  await route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Internal server error' }),
  });
});

// Stub a timeout (no response)
await page.route('**/api/v1/web/**/slow-action', async (route) => {
  // Don't fulfill — simulates network timeout
  await new Promise(() => {}); // never resolves
});
```

**Pattern for action URL matching:** App Builder web actions are served at `/api/v1/web/<package>/<action>`. Use glob patterns like `**/api/v1/web/**` to match.

## Authentication Handling

ExC Shell authentication in Playwright is the hardest challenge for E2E testing. Recommended approaches in order:

### Option 1: Local dev server (RECOMMENDED for v1)

Test against `aio app dev` which runs the SPA locally without shell auth:

```typescript
// playwright.config.ts
webServer: {
  command: 'aio app dev',
  url: 'https://localhost:9080',
  reuseExistingServer: !process.env.CI,
}
// Tests navigate directly — no shell auth needed
```

**Trade-off:** Doesn't test shell integration, but validates all component behavior and action calls.

### Option 2: Storage state (pre-authenticated session)

Save browser state after manual login, reuse in tests:

```bash
# 1. Run setup script to capture auth state
npx playwright test --project=setup  # logs in, saves storageState
# 2. Tests reuse the saved state
```

```typescript
// auth.setup.ts — run once to capture login session
import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('https://experience.adobe.com/');
  // Manual login or wait for redirect after SSO
  await page.waitForURL('**/experience.adobe.com/**');
  await page.context().storageState({ path: '.auth/state.json' });
});

// playwright.config.ts — reuse auth state in all tests
use: { storageState: '.auth/state.json' }
```

### Option 3: Stub IMS auth responses

For isolated testing without any Adobe auth:

```typescript
await page.route('**/ims/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }),
  });
});
```

**Note:** Full shell auth automation is deferred to v2. For v1, strongly recommend Option 1 (local dev testing).

## Wait Strategies

### Shell initialization

```typescript
// Wait for the shell spinner to disappear and content to load
await appFrame.locator('[data-testid="app-content"]').waitFor({ timeout: 15_000 });
```

### Action responses

```typescript
// Wait for a specific action call to complete
const responsePromise = page.waitForResponse('**/api/v1/web/**/get-items');
await appFrame.getByRole('button', { name: 'Refresh' }).click();
const response = await responsePromise;
expect(response.status()).toBe(200);
```

### Spectrum transitions

```typescript
// Wait for dialog to open (animation completes)
await expect(appFrame.getByRole('dialog')).toBeVisible();

// Wait for dialog to close
await appFrame.getByRole('button', { name: 'Cancel' }).click();
await expect(appFrame.getByRole('dialog')).not.toBeVisible();

// Wait for loading to finish
await expect(appFrame.getByRole('progressbar')).toBeHidden();
```

### Anti-pattern: avoid hardcoded waits

```typescript
// BAD — fragile, slow
await page.waitForTimeout(3000);

// GOOD — wait for specific condition
await expect(appFrame.getByRole('grid')).toBeVisible();
```
