# Running Playwright E2E Tests in CI

Patterns for running Playwright E2E tests in GitHub Actions, optimized for App Builder projects.

## GitHub Actions Workflow

Use `assets/e2e-ci-workflow.yml` as the base template. Key steps:

### Step-by-step breakdown

```yaml
# 1. Install Playwright browsers (Chromium only — smaller, faster)
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

# 2. Start App Builder local server in background
- name: Start dev server
  run: |
    npx aio app dev &
    # Wait for server to be ready
    npx wait-on https://localhost:9080 --timeout 60000

# 3. Run E2E tests
- name: Run E2E tests
  run: npx playwright test --reporter=html
  env:
    CI: true

# 4. Upload failure artifacts (always, even if tests pass — for the HTML report)
- name: Upload report
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 30

# 5. Upload traces and screenshots on failure
- name: Upload test results
  uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: test-results
    path: test-results/
    retention-days: 30
```

### Simplified workflow (without dev server)

If tests stub all action responses with `page.route()`, you may not need a dev server:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '18'
      cache: 'npm'
  - run: npm ci
  - run: npx playwright install --with-deps chromium
  - run: npx playwright test
    env:
      CI: true
  - uses: actions/upload-artifact@v4
    if: always()
    with:
      name: playwright-report
      path: playwright-report/
```

## Headless Configuration

### Chromium on Ubuntu runners

Playwright runs headless by default on CI. The `playwright.config.ts` already handles this via:

```typescript
// No special flags needed — Playwright auto-detects CI and runs headless
forbidOnly: !!process.env.CI,  // fail if test.only is left in
retries: process.env.CI ? 1 : 0,  // retry once on CI
workers: process.env.CI ? 1 : undefined,  // single worker on CI for stability
```

### Required flags for iframe support

No special flags are needed — Playwright handles iframes natively. If you encounter issues:

```typescript
// playwright.config.ts — already in the template
use: {
  ignoreHTTPSErrors: true,  // required for self-signed certs (aio app dev)
}
```

## Artifact Management

### Playwright traces

Traces are zip files containing a full recording of the test execution (DOM snapshots, network, console). Configured via:

```typescript
use: {
  trace: 'on-first-retry',  // capture trace on retry (keeps artifacts small)
}
```

To view a trace locally: `npx playwright show-trace test-results/test-name/trace.zip`

### Failure screenshots and videos

```typescript
use: {
  screenshot: 'only-on-failure',  // auto-capture on test failure
  video: 'retain-on-failure',     // record but only keep on failure
}
```

### Retention policy

Set `retention-days` in the upload artifact step. Default recommendation: 30 days. For high-traffic repos, reduce to 7 days to save storage.

## Integration with Existing CI/CD

### Add as a separate workflow

The recommended approach — create `.github/workflows/e2e.yml` alongside existing workflows:

```
.github/workflows/
├── pr_test.yml           # existing: unit tests (appbuilder-cicd-pipeline)
├── deploy_stage.yml      # existing: deploy to stage
├── deploy_prod.yml       # existing: deploy to prod
└── e2e.yml               # new: Playwright E2E tests
```

### Add as a job in existing PR workflow

Alternatively, add an `e2e` job to the existing `pr_test.yml`:

```yaml
jobs:
  unit-tests:
    # ... existing unit test job ...

  e2e-tests:
    needs: unit-tests  # run after unit tests pass
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env: { CI: true }
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report/ }
```

### Gate pattern

Require E2E tests to pass before production deploy:

```yaml
# deploy_prod.yml
jobs:
  e2e-gate:
    uses: ./.github/workflows/e2e.yml  # reusable workflow call

  deploy:
    needs: e2e-gate
    # ... deploy steps ...
```

Reference `appbuilder-cicd-pipeline` for secrets and deploy workflow patterns.

## Local Dev Testing Mode (Recommended for v1)

For v1, the simplest CI approach is running E2E against `aio app dev`:

- **No IMS tokens needed** — local dev server skips shell auth
- **Simpler CI setup** — just start server, run tests, upload artifacts
- **Trade-off** — doesn't test shell integration, but validates all component behavior and action flows

```yaml
# Simplified CI with local dev server
- run: |
    npx aio app dev &
    npx wait-on https://localhost:9080 --timeout 60000
- run: npx playwright test
  env: { CI: true }
```

For full shell integration testing (v2), you'll need IMS token injection or `storageState` — see `references/e2e-testing-patterns.md` § Authentication.
