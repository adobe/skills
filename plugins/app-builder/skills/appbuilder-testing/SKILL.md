---
name: appbuilder-testing
description: >-
  Generate and run tests for Adobe App Builder actions and UI components. Scaffolds Jest unit tests,
  integration tests against deployed actions, contract tests for Adobe API interactions, and React
  component tests using Testing Library. Provides mock helpers for State, Files, Events SDKs,
  @adobe/aio-lib-* clients, ExC Shell context (@adobe/exc-app), and UIX Guest SDK (@adobe/uix-guest).
  Use this skill whenever the user mentions testing App Builder actions, writing unit tests for
  Runtime actions, creating integration tests, mocking Adobe SDKs, setting up test fixtures, running
  aio app test, or wants to verify action behavior before deployment. Also trigger when users mention
  Jest configuration for App Builder, test coverage, CI test setup, React component test, Testing
  Library, UI test, Provider wrapper, test my page, test my form, test my table, test my component,
  mock shell context, mock extension context, debug test failures, or fix Jest errors.
metadata:
  category: testing
license: Apache-2.0
compatibility: Requires aio CLI, Node.js 18+, and Jest
allowed-tools: Bash(aio:*) Bash(npm:*) Bash(node:*) Bash(npx:*) Read Write Edit
---
# App Builder Testing

Generate and run Jest tests for Adobe App Builder actions and React Spectrum UI components. Scaffolds unit tests, integration tests, component tests, and mock helpers for Adobe SDKs.

## Pattern Quick-Reference

Pick the template or reference that matches the user's intent. Default to `assets/unit-test-template.js` for generic test requests.

| User wants | Reference | Template / Asset |
| --- | --- | --- |
| Unit test for an existing action | references/testing-patterns.md | assets/unit-test-template.js |
| Integration test against deployed action | references/testing-patterns.md | assets/integration-test-template.js |
| Component test for React Spectrum UI | references/component-testing-patterns.md | assets/component-test-template.js |
| Mock ExC Shell context in tests | references/component-testing-patterns.md | assets/shell-mock-helper.js |
| Mock AEM extension context in tests | references/component-testing-patterns.md | assets/uix-guest-mock-helper.js |
| Mock State SDK in tests | references/mock-catalog.md | assets/mock-state-sdk.js |
| Mock Files SDK in tests | references/mock-catalog.md | assets/mock-files-sdk.js |
| Mock Events SDK in tests | references/mock-catalog.md | assets/mock-events-sdk.js |
| Mock Database SDK in tests | references/mock-catalog.md | assets/mock-database-sdk.js |
| Full mock catalog (all SDKs) | references/mock-catalog.md | — |
| Contract test for API interactions | references/testing-patterns.md | — |
| Pre-deployment verification | references/checklist.md | — |
| Debug test failures | references/debugging.md | — |

## Fast Path (for clear requests)

When the user's request maps unambiguously to a single pattern above — they name a specific test type, reference a template, or describe a use case that clearly matches one entry — skip straight to generation. Use the matched template and proceed directly.

Examples of fast-path triggers:

- "Write tests for my action" → Read the action source, use `assets/unit-test-template.js`, generate immediately
- "Help me mock State SDK" → Use `assets/mock-state-sdk.js`, inject into test file
- "Add integration tests" → Use `assets/integration-test-template.js`, configure for deployed action
- "Run tests with coverage" → Execute `npx jest --coverage` or `aio app test`
- "Test my component/page/form/table" → Read the component source, use `assets/component-test-template.js`, wrap in Provider
- "Mock shell context" → Use `assets/shell-mock-helper.js`, inject into test file
- "Test my AEM extension component" → Use `assets/uix-guest-mock-helper.js` + `assets/component-test-template.js`

If there is any ambiguity — multiple test types needed, project structure unclear, or the user hasn't specified enough — fall through to the full workflow below.

## Quick Reference

- **Test directory:** Place test files in `test/` mirroring the action path, e.g., `test/actions/<action-name>/index.test.js`.
- **Jest configuration:** App Builder projects use Jest by default. Config lives in `package.json` or `jest.config.js`.
- **Test command:** `aio app test` (wrapper) or `npx jest --coverage` (direct).
- **Mock pattern:** Use `jest.mock()` at the top of test files to mock Adobe SDK dependencies before importing the action.
- **Response shape:** All actions return `{ statusCode, body }` — assert both in every test.
- **Error paths:** Always test 200 (success), 400 (bad input), and 500 (SDK failure) scenarios.
- **CommonJS:** Action test files use `require()` and `module.exports` (not ES imports).
- **Component test directory:** `test/web-src/components/<ComponentName>.test.js` (or `test/components/`).
- **Provider wrapper:** Always wrap in `<Provider theme={defaultTheme}>` — Spectrum renders nothing without it.
- **ARIA selectors:** Use `getByRole()`, not CSS classes — see `references/component-testing-patterns.md` selector table.
- **Async testing:** Use `findBy*` for data that appears async, `queryBy*` for absence, `waitFor` for state changes.

## Full Workflow (for ambiguous or complex requests)

1. **Scan project structure** — Check for existing `test/` directory, `jest.config.js`, and test scripts in `package.json`. Scan both `src/` for actions AND `web-src/` for UI components.
2. **Identify targets to test** — Parse `ext.config.yaml` (or `app.config.yaml`) for declared actions and their source paths. Check `web-src/src/components/` for React components.
3. **Determine test types needed** — Unit tests for logic, integration tests for deployed actions, contract tests for API interactions.
4. **For each action:**a. Read the action source to identify SDK dependencies (State, Files, Events, Logger, etc.).b. Generate unit test using `assets/unit-test-template.js` as the base.c. Inject appropriate mocks from `references/mock-catalog.md` based on detected dependencies.d. Add error scenario tests (missing params, auth failures, SDK errors).
5. **For each UI component:**a. Read the component source to identify dependencies (shell context, UIX guest, action calls).b. Generate component test using `assets/component-test-template.js` as the base.c. Wrap all renders in `<Provider theme={defaultTheme}>` — Spectrum renders nothing without it.d. Inject shell mock (`assets/shell-mock-helper.js`) or UIX guest mock (`assets/uix-guest-mock-helper.js`) as needed.e. Add loading, success, and error state tests for async data using `findBy*` and `waitFor`.
6. **Run tests** — Execute `aio app test` or `npx jest --coverage` and report results.
7. **Validate** — Check against `references/checklist.md` before marking done.

## Example User Prompts

- "Write unit tests for my generic action"
- "Add integration tests for my deployed action"
- "My action uses State SDK — help me mock it in tests"
- "Run tests and show me coverage"
- "Set up Jest for my App Builder project"
- "Test my action handles errors properly"
- "Write component tests for my data table page"
- "Test my AEM extension panel component"
- "Help me mock shell context in my tests"
- "Add tests for my React Spectrum form"

## Inputs To Request

- Current repository path and action file locations
- Which actions need tests (or test all declared actions)
- Target test types: unit, integration, contract, or all
- Whether action is deployed (needed for integration tests)

## Deliverables

- Test files in `test/` matching the action directory structure
- Component test files in `test/web-src/components/` for UI components
- Mock helpers for detected Adobe SDK dependencies
- Shell or UIX Guest mock helpers when components depend on context SDKs
- Jest configuration if not already present (including jsdom environment for component tests)
- Coverage report from test execution

## Quality Bar

- Every action test covers at minimum: success (200), bad input (400), and SDK failure (500) paths
- Mocks are isolated per test via `beforeEach(() => jest.clearAllMocks())`
- No real SDK calls in unit tests — all external dependencies are mocked
- Tests are deterministic and can run offline (no network dependencies in unit tests)
- Coverage reporting is enabled (`--coverage` flag)
- All component tests wrap in `<Provider theme={defaultTheme}>` — Spectrum renders nothing without it

## References

- Use `references/testing-patterns.md` for unit, integration, and contract test patterns with annotated examples.
- Use `references/component-testing-patterns.md` for React Spectrum component testing with Provider wrapping, ARIA selectors, and async patterns.
- Use `references/mock-catalog.md` for mock helpers covering all Adobe SDKs (State, Files, Events, Logger, Database, Shell, UIX Guest).
- Use `references/checklist.md` for pre-deployment test verification.
- Use `assets/unit-test-template.js` for Jest unit test boilerplate (CommonJS).
- Use `assets/integration-test-template.js` for integration test against deployed actions.
- Use `assets/component-test-template.js` for React Spectrum component test boilerplate with `renderWithSpectrum()` helper.
- Use `assets/shell-mock-helper.js` for ExC Shell context mock (`@adobe/exc-app`).
- Use `assets/uix-guest-mock-helper.js` for AEM UIX Guest mock (`@adobe/uix-guest`).
- Use `assets/mock-state-sdk.js`, `assets/mock-files-sdk.js`, `assets/mock-events-sdk.js`, and `assets/mock-database-sdk.js` for ready-to-use SDK mock setups.

## Common Issues

- **Tests fail with "Cannot find module":** Ensure the action path in `require()` matches the actual file location. App Builder actions are typically at `src/dx-excshell-1/actions/<name>/index.js`.
- **Mocks not working:** `jest.mock()` calls must appear before `require()` of the module under test. Jest hoists mock declarations but order still matters for manual mocks.
- **State/Files SDK tests fail:** These SDKs require Runtime environment for real calls. Always mock them in unit tests. Use `aio app run` (not `aio app dev`) for integration tests that need real SDK access.
- **Coverage too low:** Add tests for error branches — missing params, invalid auth headers, SDK `init()` failures, and timeout scenarios.
- `aio app test`** vs `npx jest`:** `aio app test` is a thin wrapper around Jest. Use `npx jest --coverage` directly for more control over flags and reporters.
- **Spectrum components render blank in tests:** Missing `<Provider theme={defaultTheme}>` wrapper. Use `renderWithSpectrum()` helper from `assets/component-test-template.js`.
- **ARIA role queries return null:** Spectrum components use ARIA roles, not CSS classes. See `references/component-testing-patterns.md` section g for the role reference table.

## Chaining

- Chains FROM `appbuilder-action-scaffolder` (test actions after implementation)
- Chains FROM `appbuilder-ui-scaffolder` (test UI components after scaffolding)
- Chains TO `appbuilder-cicd-pipeline` (automated test execution in CI)