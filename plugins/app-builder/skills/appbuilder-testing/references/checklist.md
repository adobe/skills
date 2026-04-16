# Pre-Deployment Test Verification Checklist

Run through each item before marking testing complete. Each entry includes what to check, how to check it, pass criteria, and the most common failure mode.

- **Test directory structure mirrors action layout** — Verify test files exist at `test/actions/<name>/index.test.js` matching each action in `src/*/actions/<name>/index.js`; How: run `find test -name '*.test.js' | sort` and compare against `find src -path '*/actions/*/index.js' | sort`; Pass: every declared action has a corresponding test file; Common failure: tests exist only for the first action while others are skipped.

- **Jest configuration is present** — Verify `jest.config.js` or a `jest` key in `package.json` exists; How: run `ls jest.config.js 2>/dev/null || node -e "const p=require('./package.json'); console.log(p.jest ? 'found' : 'missing')"`; Pass: Jest config exists and specifies `testMatch` covering the test directory; Common failure: no config means Jest uses defaults that may miss the test directory.

- **Test script exists in package.json** — Verify `scripts.test` in `package.json` runs Jest; How: run `node -e "const p=require('./package.json'); console.log(p.scripts?.test || 'missing')"`; Pass: test script runs `jest` or `aio app test`; Common failure: test script is `echo \"Error: no test specified\" && exit 1` (npm default).

- **All SDK dependencies are mocked** — Verify no real SDK calls happen in unit tests; How: check that every `require('@adobe/aio-lib-*')` and `require('@adobe/aio-sdk')` in the action has a corresponding `jest.mock()` in the test; Pass: tests run successfully with `--no-cache` offline (disconnect network to verify); Common failure: a new SDK dependency was added to the action but not mocked in tests.

- **Three response paths are tested per action** — Verify each action test covers success (200), bad input (400), and internal error (500); How: search test files for `statusCode.*200`, `statusCode.*400`, `statusCode.*500`; Pass: all three patterns appear for every action; Common failure: only the happy path (200) is tested.

- **Mocks are reset between tests** — Verify `beforeEach(() => jest.clearAllMocks())` or equivalent exists in each describe block; How: search test files for `clearAllMocks` or `resetAllMocks`; Pass: every `describe()` block has mock cleanup; Common failure: test order dependency — tests pass individually but fail when run together.

- **Response shape assertions are correct** — Verify tests assert `{ statusCode, body }` structure; How: search for `result.statusCode` and `result.body` in test assertions; Pass: both fields are asserted in success and error cases; Common failure: asserting against wrong property names like `result.status` or `result.data`.

- **Coverage thresholds are met** — Verify test coverage meets project standards; How: run `npx jest --coverage` and check the summary; Pass: line coverage ≥ 80%, branch coverage ≥ 70% (or project-specific threshold); Common failure: high line coverage but low branch coverage because error paths are not exercised.

- **Integration tests are separated from unit tests** — Verify integration tests (requiring deployed actions or real SDK access) are in a separate directory or tagged; How: check for `test/integration/` directory or `--testPathPattern` usage; Pass: `npm test` runs only unit tests by default, integration tests require explicit flag; Common failure: integration tests run in CI without credentials and fail the whole suite.

- **No hardcoded credentials in test files** — Verify test files use mock tokens, not real credentials; How: run `grep -rn 'Bearer ey\|sk-\|AKIA' test/`; Pass: no real tokens found; Common failure: developer copies a real token during debugging and commits it.

- **`aio app test` succeeds** — Verify the standard App Builder test command works; How: run `aio app test`; Pass: exits with code 0 and reports results; Common failure: Jest config mismatch causes `aio app test` to find no tests.

- **Error messages are user-actionable** — Verify test failure messages help identify the issue; How: review test descriptions and assertion messages; Pass: a failing test tells you what broke and where; Common failure: generic test names like `test('works', ...)` give no diagnostic value.

## Component Testing

- **All components wrapped in Provider** — Verify every component test uses `<Provider theme={defaultTheme}>` or the `renderWithSpectrum()` helper; How: search test files for `Provider` and `defaultTheme`; Pass: every `render()` call uses the wrapper; Common failure: Spectrum components render nothing without Provider — tests pass vacuously with no assertions against actual DOM.

- **Shell context mocked for shell-dependent components** — Verify components using `@adobe/exc-app` have the shell SDK mocked; How: check if component imports `exc-app` and confirm corresponding `jest.mock('@adobe/exc-app')` in test; Pass: mock provides `register()`, `runtime`, `imsToken`, `imsOrg`; Common failure: component tries to call real shell `register()` and hangs or throws.

- **Action calls mocked with success, error, and loading responses** — Verify component tests mock backend action calls for all three states; How: search for `mockResolvedValue`, `mockRejectedValue`, and pending promise patterns; Pass: tests cover loading indicator, success render, and error banner; Common failure: only happy path tested — error state never verified.

- **Async states tested with waitFor or findBy** — Verify async data loading uses proper Testing Library async utilities; How: search for `waitFor`, `findBy`, or `findAllBy` in component tests; Pass: no `setTimeout` hacks — all async waits use Testing Library utilities; Common failure: using `getBy*` immediately after render for async data — query runs before data loads and fails.

- **AEM extension context mocked for UIX guest components** — Verify extension components using `@adobe/uix-guest` have the guest SDK mocked; How: check if component imports `uix-guest` and confirm `jest.mock('@adobe/uix-guest')` in test; Pass: mock provides `register()` / `attach()` with `sharedContext` (aemHost, imsOrg, imsToken, apiKey); Common failure: component calls real `attach()` and fails with connection error.
