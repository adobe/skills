---
name: testing-blocks
description: "Use this when you have made AEM Edge Delivery Services (EDS) code changes to blocks, core scripts, or styles and need to validate them before opening a pull request. Covers linting, mandatory browser validation with Playwright or browser tools (screenshots, viewports, console errors), and optional Vitest unit tests for logic-heavy code."
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Testing Blocks

Test step of **building-blocks** (Step 4). Run it after changing blocks, core scripts (`scripts.js`, `aem.js`, `consent-check.js`, `consented.js`), styles, or configuration that affects behavior, and before opening any pull request with code changes. Inputs: block name, test page path(s) and variants from **content-driven-development**, acceptance criteria, and design or existing screenshots if any.

## Workflow

1. **Lint.** `npm run lint`; on failure `npm run lint:fix`, then fix the rest by hand. Done when `npm run lint` passes.
2. **Validate in a real browser (mandatory).** The skill is not complete without screenshots as proof.
   - Open the test page from CDD locally at `http://localhost:<port>/<path>`: the block's library page (`/docs/library/blocks/<block>`) or a `/drafts` page for stress cases. `aem up` serves the local `content/` folder first, so this works before anything is pushed.
   - Use browser or Playwright MCP tools if available, otherwise a temporary Playwright `.mjs` script run with `node`. Check every variant at mobile, tablet and desktop widths (around the project's breakpoints): screenshot each, capture the block's accessibility tree with `locator.ariaSnapshot()`, fail on console errors, exercise interactions.
   - Check each acceptance criterion and compare with any design or mockup screenshots; note intentional deviations.
   - Browser scripts and their artifacts are temporary: keep them outside the repo or delete them after the run. Never commit them or add them as project tests or npm scripts.
3. **Unit tests (optional).** Only for logic-heavy, reused code (utilities, data processing). Decoration and layout are covered by step 2.
4. **Run existing tests** with `npm test` if `package.json` has a `test` script. After any fix, re-run lint and tests.
5. **Report back** to building-blocks: screenshots, no console errors, acceptance criteria met, lint and tests passing, issues found and fixed. The reviewer's test link `https://{branch}--{repo}--{owner}.aem.page/<path>` works only after the test page is pushed to DA (`aem content add`, `commit`, `push`) and previewed; push does not preview.

## Rules that are easy to get wrong

- **Use the port `aem up` logs.** In a git worktree it serves on a branch-derived port (3000 + hash(branch) % 1000), not 3000, unless you pass `--port`. Pass the base URL to browser scripts instead of hardcoding `localhost:3000`.
- **Wait for `data-block-status="loaded"`** (e.g. `.my-block[data-block-status="loaded"]`). There is no `loaded` class. Playwright's default timeout is 30 s; `{ timeout: 10000 }` shortens it.
- **Third-party scripts are consent-gated.** `loadDelayed()` imports `consent-check.js`, which imports `consented.js` only after consent. There is no `delayed.js` or 3-second timer. Test both states; the boilerplate's placeholder consent check accepts `?consent=accept` and declines by default.
- **Never import `scripts/scripts.js` in unit tests.** It runs `loadPage()` on import and does not export `buildAutoBlocks`. Move the code under test into a side-effect-free module under `scripts/` that exports it, and import it from `scripts.js` so behavior is unchanged.
- **Boilerplate auto-blocking only handles `/fragments/` and `/widgets/` links** (`buildWidgetAutoBlocks`). There is no hero auto-block; hero is an authored block. Read the project's `buildAutoBlocks` before writing or accepting tests that assume an auto-block.
- **The boilerplate has no `test` script.** When adding Vitest before any test files exist, use `vitest run --passWithNoTests` (or `passWithNoTests: true`); plain `vitest run` exits 1 with no test files. DOM code needs a DOM environment (`jsdom` or `happy-dom`).

## Related Skills

- **building-blocks**: invokes this skill and receives the results
- **content-driven-development**: test content and acceptance criteria
- **block-collection-and-party**: reference implementations to compare against
- **aem-cli**: `aem up` and `aem content` details
