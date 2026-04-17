# UI Debugging Reference

Common debugging scenarios for App Builder SPAs running in the Experience Cloud Shell.

## 1. ExC Shell Loading Spinner Never Dismisses

**Symptom:** The Experience Cloud Shell shows an infinite loading spinner. Your SPA content never appears.

**Cause:** `runtime.done()` is not called, or is called before React has mounted (e.g., in a constructor or at module scope instead of inside `useEffect`).

**Fix:**
1. Ensure `runtime.done()` is called inside the `register` callback, **after** React mounts:
```jsx
useEffect(() => {
  register({ id: 'my-app' }, (runtime) => {
    runtime.ready({ onReady: (context) => setShellContext(context) });
    runtime.done(); // Dismisses loading spinner
  });
}, []);
```
2. Never call `runtime.done()` in a class constructor or at module scope — the shell iframe may not be ready.
3. Check the browser console for errors that prevent the `register` callback from executing.

**Prevention:** Always initialize shell integration inside `useEffect` (function components) or `componentDidMount` (class components). See `references/shell-integration.md` § Shell Initialization.

---

## 2. Blank Iframe / White Screen

**Symptom:** The ExC Shell loads, the spinner dismisses, but the iframe content is completely white with no visible UI.

**Cause:**
- Missing `<Provider theme={defaultTheme}>` wrapper — React Spectrum components render nothing without it
- Using `BrowserRouter` instead of `HashRouter` — ExC Shell requires hash-based routing because the iframe URL cannot change paths
- A JavaScript error is thrown during render but silently swallowed in the iframe context

**Fix:**
1. Verify the root component is wrapped in `<Provider theme={defaultTheme}>`:
```jsx
import { defaultTheme, Provider } from '@adobe/react-spectrum';
// ...
return (
  <Provider theme={defaultTheme} locale={shellContext.locale}>
    <HashRouter>
      <App />
    </HashRouter>
  </Provider>
);
```
2. Replace any `BrowserRouter` with `HashRouter` from `react-router-dom`.
3. Open Chrome DevTools → select the iframe context from the JavaScript context selector (top-left of Console tab) → check for errors.

**Prevention:** Start from the shell integration pattern in `references/shell-integration.md`. Always use `HashRouter` for ExC Shell SPAs. Add an Error Boundary at the root (see scenario 7).

---

## 3. CORS Errors Calling Backend Actions

**Symptom:** Browser console shows `Access-Control-Allow-Origin` errors when the SPA calls a backend action.

**Cause:** The action's `web` property in `app.config.yaml` is not set to `'yes'`, or the action returns a response without CORS headers. Only `web: 'yes'` auto-adds CORS headers; `web: 'raw'` requires manual headers.

**Fix:**
1. In `app.config.yaml`, set the action to `web: 'yes'`:
```yaml
actions:
  my-action:
    function: actions/my-action/index.js
    web: 'yes'   # NOT 'raw' — 'yes' auto-adds CORS headers
    runtime: nodejs:18
```
2. If you must use `web: 'raw'` (e.g., for custom response formats), return explicit CORS headers:
```js
return {
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-gw-ims-org-id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  },
  body: JSON.stringify(result)
};
```
3. For preflight requests (OPTIONS), return a 204 with the same CORS headers.

**Prevention:** Default to `web: 'yes'` unless you need raw response control. See `references/action-integration.md` for the full action call pattern.

---

## 4. IMS Token Expired / Auth Failures from SPA

**Symptom:** Backend action calls return 401 or 403 after the SPA has been open for a while (typically >1 hour). Works initially but fails later.

**Cause:** The IMS token provided by the shell's `ready` callback has a limited lifetime (~24 hours, but can be shorter). The initially stored token expires and is not refreshed.

**Fix:**
1. Listen for token updates via the `configuration` callback instead of using the initial token only:
```jsx
useEffect(() => {
  register({ id: 'my-app' }, (runtime) => {
    runtime.ready({
      onReady: ({ imsToken, imsOrg, imsProfile, locale }) => {
        setShellContext({ imsToken, imsOrg, imsProfile, locale });
      }
    });

    // Subscribe to configuration changes (includes token refresh)
    runtime.on('configuration', ({ imsToken, imsOrg }) => {
      setShellContext(prev => ({ ...prev, imsToken, imsOrg }));
    });

    runtime.done();
  });
}, []);
```
2. Always read the token from state at call time — never cache it in a module-level variable.

**Prevention:** Always implement the `configuration` callback for token updates. See `references/shell-integration.md` § Token Management.

---

## 5. React Spectrum Components Not Rendering / Wrong Theme

**Symptom:** React Spectrum components render as unstyled HTML, appear with wrong colors/fonts, or don't render at all.

**Cause:**
- Missing `<Provider theme={defaultTheme}>` wrapper at the application root
- Locale mismatch between shell and Provider
- Multiple Provider instances conflicting

**Fix:**
1. Ensure a single `<Provider>` wraps the entire application:
```jsx
import { defaultTheme, Provider } from '@adobe/react-spectrum';

<Provider theme={defaultTheme} locale={shellContext.locale}>
  {/* All app content goes here */}
</Provider>
```
2. Pass the shell's `locale` to the Provider so Spectrum components render the correct text direction and formatting.
3. Remove any nested `<Provider>` components unless you intentionally need a theme override for a subtree.
4. Verify `@adobe/react-spectrum` is installed: `npm ls @adobe/react-spectrum`.

**Prevention:** Use the Provider setup from `references/shell-integration.md`. Include Provider verification in `references/checklist.md` pre-handoff checks.

---

## 6. Action URL Returns 404 in Production but Works Locally

**Symptom:** The SPA calls a backend action successfully during `aio app run`, but the same call returns 404 after `aio app deploy`.

**Cause:**
- `config.json` (auto-generated during build) was not regenerated after deploy, so it still contains local action URLs
- The action name in `app.config.yaml` doesn't match the name used in the UI import (case-sensitive)
- The action was not included in the deploy (check `app.config.yaml` includes)

**Fix:**
1. Redeploy with `aio app deploy` — this regenerates `config.json` with production URLs.
2. Verify the action name matches exactly:
```bash
# Check deployed actions
aio runtime action list
# Compare with the name used in config.json
cat web-src/src/config.json
```
3. Ensure the action is listed in `app.config.yaml` under the correct package.
4. Clear browser cache — stale `config.json` may be cached.

**Prevention:** Always call `aio app deploy` (not just `aio app deploy web-assets`) to ensure both actions and UI are in sync. See `references/action-integration.md` § Action URL Configuration.

---

## 7. Console Errors in ExC Shell Iframe

**Symptom:** The SPA behaves unexpectedly but no errors appear in the browser console. Or errors appear but are difficult to trace because they originate from the iframe context.

**Cause:** The ExC Shell loads the SPA in an iframe. By default, Chrome DevTools shows the top-level window's console, not the iframe's. Errors thrown inside the iframe are not visible unless you switch context. Additionally, errors during React render may be caught by default error handling without surfacing.

**Fix:**
1. Open Chrome DevTools → Console tab → click the JavaScript context selector (top-left dropdown, usually says "top") → select the iframe context (it will show your SPA's URL).
2. Add a React Error Boundary at the root to catch and display render errors:
```jsx
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('UI Error:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: 'red' }}>
          <h2>Something went wrong</h2>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrap at root:
<Provider theme={defaultTheme}>
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
</Provider>
```
3. Add a global error handler for uncaught errors:
```js
window.addEventListener('error', (e) => console.error('Uncaught:', e.error));
window.addEventListener('unhandledrejection', (e) => console.error('Unhandled promise:', e.reason));
```

**Prevention:** Always include an Error Boundary at the application root. Set up global error handlers in your entry point. Check the iframe console context when debugging.

---

## 8. Slow Initial Load

**Symptom:** The SPA takes several seconds to appear after the shell spinner dismisses. Users see a blank or partially rendered page while JavaScript loads.

**Cause:** Large bundle size — all code is loaded in a single chunk. Common contributors: importing entire libraries instead of specific components, including large dependencies (charting libraries, PDF renderers), or no code splitting.

**Fix:**
1. Analyze the bundle to find the largest contributors:
```bash
npm run build -- --stats
npx webpack-bundle-analyzer build/bundle-stats.json
```
2. Use `React.lazy` and `Suspense` for route-level code splitting:
```jsx
import React, { Suspense, lazy } from 'react';
import { ProgressCircle } from '@adobe/react-spectrum';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

function App() {
  return (
    <Suspense fallback={<ProgressCircle aria-label="Loading…" isIndeterminate />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>
    </Suspense>
  );
}
```
3. Use specific Spectrum component imports (tree-shakeable by default with `@adobe/react-spectrum` v3, but verify your bundler config).
4. Defer loading of heavy dependencies (charts, editors) until the user navigates to the relevant page.

**Prevention:** Set a bundle size budget early. Use route-level code splitting from the start for SPAs with more than 2-3 pages. Profile build output regularly with `--stats`.
