# ExC Shell Integration

Adobe Experience Cloud Shell integration for App Builder SPAs using `@adobe/exc-app`.

## Overview

App Builder SPAs with extension type `dx/excshell/1` run inside an iframe within the Experience Cloud Shell at `experience.adobe.com`. The shell provides:
- **IMS authentication** — user's IMS token, org ID, profile
- **Theming** — Spectrum theme matching the shell
- **Navigation** — breadcrumbs, org switcher, help menu
- **Loading state** — spinner shown until app signals readiness

## Shell Initialization (CRITICAL)

### The `ready` Callback

The shell provides context via the `ready` callback. **You MUST call `runtime.done()`** to dismiss the loading spinner — this is the most commonly forgotten step.

```jsx
import React, { useState, useEffect } from 'react';
import { defaultTheme, Provider } from '@adobe/react-spectrum';
import { register } from '@adobe/exc-app';

function App() {
  const [shellReady, setShellReady] = useState(false);
  const [shellContext, setShellContext] = useState({});

  useEffect(() => {
    register({ id: 'my-app' }, (runtime) => {
      // runtime.ready provides shell context
      runtime.ready({
        // Called when shell context is available
        onReady: ({ imsOrg, imsToken, imsProfile, locale }) => {
          setShellContext({ imsOrg, imsToken, imsProfile, locale });
          setShellReady(true);
        }
      });

      // CRITICAL: Dismiss the shell loading spinner
      // Without this, the shell shows an infinite loading state
      runtime.done();
    });
  }, []);

  if (!shellReady) {
    return null; // Or a local loading indicator
  }

  return (
    <Provider theme={defaultTheme} locale={shellContext.locale}>
      {/* App content */}
    </Provider>
  );
}
```

### What `ready` Provides

| Property | Type | Description |
| --- | --- | --- |
| `imsOrg` | `string` | IMS organization ID (e.g., `ABC123@AdobeOrg`) |
| `imsToken` | `string` | User's IMS access token for API calls |
| `imsProfile` | `object` | User profile: `{ name, email, avatar }` |
| `locale` | `string` | User's locale (e.g., `en_US`) |

### `runtime.done()` — NEVER FORGET

**What it does:** Tells the shell the app has finished initial loading, dismissing the full-page spinner.

**When to call it:** Immediately after `register()`, NOT after data loading. The shell spinner is for app bootstrap, not data fetching. Show your own `<ProgressCircle>` for data loading.

**Common mistake:** Calling `runtime.done()` inside `onReady` or after an API call — this causes the shell to show a spinner for too long. Call it at the `register` level.

```jsx
// ✅ CORRECT — call done() at register level
register({ id: 'my-app' }, (runtime) => {
  runtime.ready({ onReady: (ctx) => { /* ... */ } });
  runtime.done(); // Dismiss spinner immediately
});

// ❌ WRONG — don't wait for data
register({ id: 'my-app' }, async (runtime) => {
  const data = await fetchData(); // Shell spinner stuck during this
  runtime.done(); // Too late!
});
```

## Provider Wrapper

Always wrap the app in Spectrum's `<Provider>` with the `defaultTheme` for correct styling:

```jsx
import { defaultTheme, Provider } from '@adobe/react-spectrum';

<Provider theme={defaultTheme} locale={shellContext.locale} colorScheme="light">
  <App />
</Provider>
```

**Props:**
- `theme={defaultTheme}` — Matches Experience Cloud shell theme
- `locale` — Pass the shell's locale for internationalization
- `colorScheme` — Optional: `"light"` (default) or `"dark"`

## IMS Token Passthrough

When calling backend App Builder actions from the SPA, pass the shell's IMS token:

```jsx
const callAction = async (actionUrl, params = {}) => {
  const response = await fetch(actionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${shellContext.imsToken}`,
      'x-gw-ims-org-id': shellContext.imsOrg
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    throw new Error(`Action failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};
```

**Key points:**
- Always send `Authorization: Bearer <token>` for actions with `require-adobe-auth: true`
- Include `x-gw-ims-org-id` for org-scoped operations
- The IMS token is automatically refreshed by the shell — access it from the latest context

## Extension Configuration

In `app.config.yaml`, the SPA extension is declared as:

```yaml
extensions:
  dx/excshell/1:
    operations:
      view:
        - type: web
          impl: index.html
```

The `web-src/` directory contains the SPA source. The build output goes to `dist/web-src/`.

## Common Pitfalls

1. **Forgetting `runtime.done()`** — App loads but shell shows infinite spinner
2. **Calling `runtime.done()` too late** — Waiting for API calls before dismissing spinner
3. **Not wrapping in Provider** — Components render without Spectrum styling
4. **Stale IMS token** — Store the token in state and update it; the shell may refresh it
5. **Missing CORS** — Backend actions must return appropriate CORS headers for SPA calls
6. **Not passing locale** — Components render in English regardless of user's shell language

## Package Dependencies

```json
{
  "@adobe/exc-app": "^1.4.17",
  "@adobe/react-spectrum": "^3.33.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```
