---
name: testing-blocks
description: "Use before writing unit or Playwright E2E tests for an AEM Edge Delivery Services block or script, when deciding what tests a block change needs, or when validating block, script or style changes in a browser before a pull request. EDS block testing has non-obvious conventions (how to locate elements without breaking on author edits, library page vs drafts, analytics assertions, no-framework-addition rule, and waiting on decoration), so check here first. Not for implementing block code (building-blocks) or PR review comments (code-review)."
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Testing Blocks

Validate code changes and write maintainable tests in AEM Edge Delivery Services projects.

## Related Skills

- **content-driven-development**: test content created during CDD is what you validate against
- **building-blocks**: invokes this skill in Step 5
- **aem-cli**: running `aem up` (ports in git worktrees, serving `./content/`, cleaning up stale `./content/` files that shadow remote `.aem.page` updates)

## Testing Workflow

- [ ] Step 1: Run linting and fix issues
- [ ] Step 2: Validate in a browser (MANDATORY when validating a code change)
- [ ] Step 3: Decide which tests to commit, and write them
- [ ] Step 4: Run the project's tests

## Step 1: Run Linting

```bash
npm run lint
```

If it fails, run `npm run lint:fix`, then fix what remains by hand.

---

## Step 2: Browser Validation

Exercise the block in a real browser on the test content URL(s): every variant, mobile, tablet and desktop widths (e.g. 375px, 768px, 1200px), and every interaction. Use whatever tooling you have: browser/Playwright MCP tools, a throwaway Playwright script (delete it afterwards), or a manual browser.

Check:
- block finishes decorating (`.{block}[data-block-status="loaded"]`) with no console errors
- interactions and responsive behavior work across viewports
- functional acceptance criteria are met

Capture screenshots across viewports and inspect them to catch obvious layout, overflow or responsive issues. When visual fidelity against a design or mockup needs judgment, share the screenshots or URLs with the user as well rather than relying on automated checks alone.

---

## Step 3: Committed Tests

Committed tests guard functional behavior so it doesn't silently regress. Write a test only when a wrong answer is plausible and costly to miss. 100% coverage is not the goal, and neither is a test per variant or per branch; a block with static decoration and no behavior may need no tests at all.

**Use the project's test tools.** Find them in `package.json` scripts, test config and existing tests, and follow their file locations and naming. Don't add a second framework. `aem-boilerplate` ships without one; if the project has no test setup, ask the user before adding one.

**Unit tests** (run against `decorate()` or exported helpers with a DOM shim such as jsdom):
- pure logic: parsing, index math, ID generation, URL handling
- malformed or missing authored input: an absent cell, an empty row, a failed fetch. Mock the input; authors omit and add cells.

**Browser (E2E) tests** assert the block's functional behavior:
- interactions: clicking, toggling, switching state
- accessibility behavior: focus, keyboard, ARIA state
- analytics: assert that the event fired (read the data layer or wrap the tracking call), not only that a tracking attribute exists

Rules for E2E specs:
- Run them against the block's library page (the canonical example content). It is author-facing reference content and the happy path: don't add rows to it to drive a test. Cover edge cases in unit tests or on a separate drafts page (e.g. `./content/drafts/`).
- Locate elements by role and accessible name. Don't use classes or ids the block's own `decorate()` adds, or hardcoded authored copy; when you need a label, read it from the page at runtime. The block root class (`.{block}`) comes from `aem.js` and is stable.
- Assert behavior, not visuals: no computed CSS (`toHaveCSS`, `getComputedStyle`), geometry (`boundingBox`), or screenshot comparisons (`toHaveScreenshot`).

---

## Step 4: Run the Project's Tests

If `package.json` defines test scripts (the boilerplate has none), run them, including any new tests. E2E suites usually need the dev server (`aem up`) running.

If a test fails, decide whether the code or the expectation is wrong, fix that, and re-run.

## Troubleshooting

### Browser tests fail
- Verify `aem up` is running and check the port it logged (in a git worktree `aem up` uses a branch-hashed port, not 3000; see **aem-cli**).
- Local test pages belong under `./content/` (e.g. `content/drafts/my-block.html` served at `/drafts/my-block` with no `--html-folder` flag). If testing a remote `.aem.page` update, make sure a stale file in `./content/` isn't shadowing that path.
- Wait for the block before interacting: `.{block}[data-block-status="loaded"]`.
