# Debugging Test Failures

Common test failures in App Builder projects and how to fix them.

## Cannot find module for Adobe SDK

**Symptom:** `Cannot find module '@adobe/aio-sdk'` (or any `@adobe/aio-lib-*` package).

**Causes & fixes:**

1. **Mock not set up** — Add `jest.mock('@adobe/aio-sdk')` before the `require()` that imports your action. Jest hoists `jest.mock()` calls, but you still need one.
2. **Module not installed** — Run `npm install --save-dev @adobe/aio-sdk`. Dev-dependencies are enough for unit tests.
3. **`moduleNameMapper` not configured** — If using path aliases or the SDK has sub-path exports, add a mapping in `jest.config.js`:
   ```js
   moduleNameMapper: { '^@adobe/aio-sdk$': '<rootDir>/test/__mocks__/@adobe/aio-sdk.js' }
   ```

## Tests pass locally but fail in CI

**Symptom:** `npm test` passes on your machine but fails in GitHub Actions / Jenkins.

**Causes & fixes:**

1. **Node version mismatch** — CI may use a different Node version. Pin it in your workflow: `node-version: '18'`. Run `node -v` locally to compare.
2. **Missing devDependencies** — CI runs `npm ci`, which is stricter than `npm install`. Ensure all test deps are in `devDependencies`, not installed globally.
3. **Environment variables missing** — Tests that read `process.env` values from a local `.env` file won't find them in CI. Pass them as secrets or mock `process.env` in tests:
   ```js
   beforeEach(() => { process.env.API_KEY = 'test-key'; });
   afterEach(() => { delete process.env.API_KEY; });
   ```

## Component tests render blank — no Spectrum components visible

**Symptom:** `render(<MyComponent />)` produces an empty container. Queries return `null`.

> **This is the #1 React Spectrum testing gotcha.**

**Causes & fixes:**

1. **Missing `<Provider>` wrapper** — React Spectrum components render nothing without `<Provider theme={defaultTheme}>`. Use the `renderWithSpectrum()` helper from `assets/component-test-template.js`:
   ```js
   const { renderWithSpectrum } = require('./helpers');
   const { screen } = renderWithSpectrum(<MyComponent />);
   ```
2. **Missing CSS transform** — Jest cannot process `.css` imports. Add to `jest.config.js`:
   ```js
   transform: { '\\.css$': 'jest-transform-stub' }
   ```
   Or use `moduleNameMapper: { '\\.css$': '<rootDir>/test/__mocks__/styleMock.js' }` with a file that exports `{}`.

## Mock does not intercept SDK calls

**Symptom:** Tests hit real SDKs, throw auth errors, or return unexpected data instead of mock values.

**Causes & fixes:**

1. **`jest.mock()` after import** — The mock declaration must appear before the `require()` of the module under test. Move it to the top of the file:
   ```js
   jest.mock('@adobe/aio-sdk');           // ← first
   const action = require('../index.js'); // ← second
   ```
2. **Mock path mismatch** — The string in `jest.mock('...')` must exactly match the string in the action's `require('...')`. Check for `@adobe/aio-sdk` vs destructured sub-packages.
3. **Mock not reset between tests** — Stale mock state bleeds across tests. Add:
   ```js
   beforeEach(() => jest.clearAllMocks());
   ```

## `waitFor` times out in component tests

**Symptom:** `TestingLibraryElementError: Timed out in waitFor` after 1 000 ms.

**Causes & fixes:**

1. **Async operation never resolves** — The mock for your API call is not returning a resolved promise. Fix:
   ```js
   fetchData.mockResolvedValue({ items: [{ id: 1, name: 'Test' }] });
   ```
2. **State update not triggering re-render** — Ensure your component calls `setState` (or a state hook) after the async operation completes. If using `useEffect`, verify the dependency array.
3. **Timeout too short** — For heavy components, increase the timeout:
   ```js
   await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument(), { timeout: 5000 });
   ```

## Test coverage is low despite many tests

**Symptom:** Jest coverage report shows < 80 % on lines or branches even though tests pass.

**Causes & fixes:**

1. **Error and edge paths not tested** — Coverage counts executed lines. Add tests for 400 (bad input) and 500 (SDK failure) branches, not just the happy path.
2. **`collectCoverageFrom` excludes files** — Check `jest.config.js`:
   ```js
   collectCoverageFrom: ['src/**/*.js', '!src/**/index.js']
   ```
   Make sure the glob includes the files you expect.
3. **Mocked modules show 0 % coverage** — This is expected. `jest.mock()` replaces the real module, so its lines are never executed. Focus coverage on *your* code, not third-party SDKs.

## Integration test fails with 401 against deployed action

**Symptom:** `fetch('https://<namespace>.adobeio-static.net/...')` returns `{ statusCode: 401 }`.

**Causes & fixes:**

1. **IMS token expired** — Regenerate with `aio login`. Tokens are short-lived; refresh before each test session.
2. **Missing `Authorization` header** — Actions with `require-adobe-auth: true` in `ext.config.yaml` need a Bearer token:
   ```js
   const resp = await fetch(actionUrl, {
     headers: { Authorization: `Bearer ${token}` }
   });
   ```
3. **Wrong action URL** — Verify namespace and package name match `aio runtime namespace get`. The URL pattern is `https://<namespace>.adobeio-static.net/api/v1/web/<package>/<action>`.

## `aio app test` runs but finds no tests

**Symptom:** `Test Suites: 0 total` — Jest exits without running anything.

**Causes & fixes:**

1. **Test file naming** — Jest looks for `*.test.js` or `*.spec.js` by default. Rename files to match.
2. **Test directory not in `roots`** — If your tests live outside the default path, add to `jest.config.js`:
   ```js
   roots: ['<rootDir>/test']
   ```
3. **`testMatch` pattern excludes your files** — Check for overly restrictive patterns:
   ```js
   testMatch: ['**/test/**/*.test.js']  // make sure this matches your structure
   ```
