# Playwright Patterns for AEM Extension Testing

Playwright E2E patterns for testing AEM UI extensions built with App Builder. Covers Extension Tester, nested iframe navigation, and extension point testing.

> **⚠️ Authentication Required:** The AEM Extension Tester requires Adobe IMS login.
> For automated E2E tests, pre-configure `storageState` with an authenticated browser
> session, or test against local dev (`aio app dev`) which skips shell auth.
> See Gotchas section for details.

## Extension Tester

AEM extensions can be loaded in the Extension Tester for local development and testing.

### URL pattern

```
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080
```

- `devMode=true` — enables extension development mode
- `ext=https://localhost:9080` — URL of your local extension dev server

### Starting local dev

```bash
# Start the extension locally
aio app dev

# Extension Tester URL (open in browser)
# https://experience.adobe.com/?devMode=true&ext=https://localhost:9080
```

### Playwright setup for Extension Tester

```typescript
import { test, expect } from '@playwright/test';

test('extension loads in Extension Tester', async ({ page }) => {
  // Navigate to Extension Tester with local extension
  await page.goto(
    'https://experience.adobe.com/?devMode=true&ext=https://localhost:9080'
  );

  // Wait for Extension Tester to initialize (requires IMS login)
  // Note: You'll need pre-authenticated state — see auth section
  await page.waitForLoadState('networkidle');

  // Find the extension UI in the nested iframes
  // ...
});
```

## Nested Iframe Navigation

AEM extensions run in 2-3 layers of iframes. Understanding the nesting is critical for writing selectors.

### Iframe hierarchy

```
Page (experience.adobe.com)
  └── AEM Surface iframe (Content Fragment Console, Editor, etc.)
       └── Extension iframe (your extension's UI)
            └── Modal iframe (if extension opens a modal)
```

### Navigating nested iframes

```typescript
// Level 1: AEM surface iframe
const aemFrame = page.frameLocator('iframe[src*="aem"]');

// Level 2: Extension iframe within AEM surface
const extFrame = aemFrame.frameLocator('iframe[src*="localhost:9080"]');

// Level 3: Modal iframe (if your extension opens a modal)
const modalFrame = extFrame.frameLocator('iframe[src*="localhost:9080"]');
```

### Discovery approach

Because iframe selectors vary across AEM surfaces and versions, use DevTools to discover them:

```typescript
// List all frames to find the right nesting
const frames = page.frames();
for (const frame of frames) {
  console.log(`Frame: ${frame.name()} URL: ${frame.url()}`);
}
```

**Tip:** Use `frame.url()` to identify which frame is yours — look for your extension's URL (e.g., `localhost:9080` or your deployed URL).

## Extension Point Testing Patterns

### Action bar button (Content Fragment Console)

```typescript
test('action bar button exports selected fragments', async ({ page }) => {
  // Navigate to CF Console
  const aemFrame = page.frameLocator('iframe[src*="aem"]');

  // Select one or more content fragments
  await aemFrame.getByRole('row', { name: /My Fragment/ }).click();

  // Click the extension's action bar button
  await aemFrame.getByRole('button', { name: 'Export' }).click();

  // Extension modal opens — find it in nested iframe
  const extFrame = aemFrame.frameLocator('iframe[src*="localhost"]');
  const dialog = extFrame.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Interact with modal form
  await dialog.getByRole('button', { name: 'Export CSV' }).click();

  // Verify success feedback
  await expect(extFrame.getByText('Export complete')).toBeVisible();
});
```

### Header menu button (Content Fragment Console)

```typescript
test('header menu button triggers bulk operation', async ({ page }) => {
  const aemFrame = page.frameLocator('iframe[src*="aem"]');

  // Open header menu
  await aemFrame.getByRole('button', { name: 'More actions' }).click();

  // Click extension menu item
  await aemFrame.getByRole('menuitem', { name: 'Bulk Update' }).click();

  // Extension modal opens
  const extFrame = aemFrame.frameLocator('iframe[src*="localhost"]');
  await expect(extFrame.getByRole('dialog')).toBeVisible();
});
```

### RTE toolbar button (Content Fragment Editor)

```typescript
test('RTE toolbar button inserts content', async ({ page }) => {
  const editorFrame = page.frameLocator('iframe[src*="editor"]');

  // Focus the Rich Text Editor field
  await editorFrame.getByRole('textbox', { name: 'Description' }).click();

  // Click extension toolbar button
  await editorFrame.getByRole('button', { name: 'Insert Token' }).click();

  // Extension modal — select token and insert
  const extFrame = editorFrame.frameLocator('iframe[src*="localhost"]');
  await extFrame.getByRole('option', { name: 'Product Name' }).click();
  await extFrame.getByRole('button', { name: 'Insert' }).click();

  // Verify token was inserted into RTE
  await expect(
    editorFrame.getByRole('textbox', { name: 'Description' })
  ).toContainText('{{product_name}}');
});
```

### Right panel (Universal Editor)

```typescript
test('right panel renders in properties rail', async ({ page }) => {
  const ueFrame = page.frameLocator('iframe[src*="universal-editor"]');

  // Select an element on the page
  await ueFrame.getByTestId('editable-component').click();

  // Verify extension panel appears in properties rail
  const panelFrame = ueFrame.frameLocator('iframe[src*="localhost"]');
  await expect(panelFrame.getByRole('heading', { name: 'Custom Properties' })).toBeVisible();

  // Interact with panel form
  await panelFrame.getByRole('textbox', { name: 'Alt Text' }).fill('Hero image');
  await panelFrame.getByRole('button', { name: 'Apply' }).click();
});
```

## Modal Lifecycle Testing

AEM extension modals follow a specific lifecycle: button click → modal opens → interact → submit → modal closes → host updates.

```typescript
test('modal lifecycle: open, interact, close', async ({ page }) => {
  const aemFrame = page.frameLocator('iframe[src*="aem"]');

  // Trigger modal open via action bar
  await aemFrame.getByRole('row', { name: /Fragment/ }).click();
  await aemFrame.getByRole('button', { name: 'My Extension' }).click();

  // Modal opens in extension iframe
  const extFrame = aemFrame.frameLocator('iframe[src*="localhost"]');
  const dialog = extFrame.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Interact with modal form
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Updated Title');
  await dialog.getByRole('button', { name: 'Save' }).click();

  // Modal closes
  await expect(dialog).not.toBeVisible();

  // Verify host AEM surface reflects the change
  await expect(aemFrame.getByRole('row', { name: /Updated Title/ })).toBeVisible();
});
```

### Testing sharedContext

Extensions receive `sharedContext` with `aemHost`, `imsToken`, and other values. Verify they're available:

```typescript
test('extension receives shared context', async ({ page }) => {
  const extFrame = page.frameLocator('iframe[src*="localhost"]');

  // Verify extension rendered content that depends on sharedContext
  // (e.g., loaded data from aemHost using imsToken)
  await expect(extFrame.getByRole('grid')).toBeVisible();
  await expect(extFrame.getByRole('row')).toHaveCount(3); // loaded data
});
```

## Common Gotchas

1. **Extension Tester requires Adobe IMS login.** Cannot be fully automated. Use `storageState` with a pre-authenticated session or test against local dev.

2. **Extension loading takes 5-10 seconds.** Use generous timeouts:
   ```typescript
   await expect(extFrame.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
   ```

3. **`guestConnection` is async.** The extension's `register()` call is asynchronous. Wait for UI to render, not for `register()` to complete.

4. **Iframe selectors change between AEM versions.** Always discover selectors with DevTools. Don't hardcode `#some-aem-internal-id`.

5. **Modal iframe uses same origin as extension.** Both the extension iframe and its modal iframe serve from the same URL (e.g., `localhost:9080`). Distinguish them by checking content or using `nth()`.

6. **Picker/dropdown portals.** React Spectrum Pickers render options outside the iframe. Use `page.getByRole('option')` instead of `extFrame.getByRole('option')`.
