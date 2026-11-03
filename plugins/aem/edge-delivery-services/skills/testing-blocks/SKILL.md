---
name: testing-blocks
description: "Use this when you have made AEM Edge Delivery Services code changes to blocks, scripts, or styles and need to validate them before opening a pull request. Covers linting, browser validation, and which unit and browser (E2E) tests to commit using the project's own test tools."
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Testing Blocks

Validate code changes in AEM Edge Delivery Services projects before opening a pull request.

**CRITICAL: Browser validation is MANDATORY. You cannot complete this skill without proof of testing in a real browser.**

## Related Skills

- **content-driven-development**: test content created during CDD is what you validate against
- **building-blocks**: invokes this skill in Step 5

## Testing Workflow

Track your progress:

- [ ] Step 1: Run linting and fix issues
- [ ] Step 2: Validate in a browser (MANDATORY)
- [ ] Step 3: Decide which tests to commit, and write them
- [ ] Step 4: Run the project's tests

## Step 1: Run Linting

```bash
npm run lint
```

If it fails, run `npm run lint:fix`, then fix what remains by hand.

**Mark complete when:** `npm run lint` passes.

---

## Step 2: Browser Validation (MANDATORY)

Load the test content URL(s) and check:
- the block renders correctly, including every variant
- mobile, tablet and desktop widths (e.g. 375px, 768px, 1200px)
- no console errors
- interactions work
- acceptance criteria and designs, if provided, are met

Use whatever browser tooling you have: browser/Playwright MCP tools, a throwaway Playwright script (delete it afterwards), or a manual browser. Look at screenshots: this is where visual and layout problems get caught.

**Proof required:**
- screenshots of the test content (at least one viewport)
- confirmation of no console errors
- confirmation that acceptance criteria are met (if provided)

**Mark complete when:** browser validation is done, with screenshots.

---

## Step 3: Committed Tests

Committed tests guard behavior that the manual check in Step 2 won't keep catching. Write a test only when a wrong answer is plausible and costly to miss. 100% coverage is not the goal, and neither is a test per variant or per branch; a block with static decoration and no behavior may need no tests at all.

**Use the project's test tools.** Find them in `package.json` scripts, test config and existing tests, and follow their file locations and naming. Don't add a second framework. aem-boilerplate ships without one; if the project has no test setup, ask the user before adding one.

**Unit tests** (run against decorate() or exported helpers with a DOM shim such as jsdom):
- pure logic: parsing, index math, ID generation, URL handling
- malformed or missing authored input: an absent cell, an empty row, a failed fetch. Mock the input; authors omit and add cells.

**Browser (E2E) tests** cover what a manual click-through won't catch:
- accessibility behavior: focus, keyboard, ARIA state
- analytics: assert that the event fired (read the data layer or wrap the tracking call), not only that a tracking attribute exists

Rules for E2E specs:
- Run them against the block's library page (the canonical example content). It is author-facing reference content and the happy path: don't add rows to it to drive a test. Cover edge cases in unit tests or on a separate drafts page.
- Locate elements by role and accessible name. Don't use classes or ids the block's own decorate() adds, or authored copy; when you need a label, read it from the page at runtime. The block root class (`.{block}`) comes from aem.js and is stable.
- Assert behavior, not visuals: no computed CSS, geometry or screenshot comparisons.

**Mark complete when:** the tests are written, or you have decided none are worth committing.

---

## Step 4: Run the Project's Tests

If `package.json` defines test scripts (the boilerplate has none), run them, including any new tests. E2E suites usually need the dev server (`aem up`) running.

If a test fails, decide whether the code or the expectation is wrong, fix that, and re-run.

**Mark complete when:** all tests pass, or the project has no tests.

## Troubleshooting

### Browser tests fail
- Verify the dev server is running: `aem up --html-folder drafts`
- Check test content exists in `drafts/tmp/`
- For local drafts, verify the URL includes the html folder: `http://localhost:3000/drafts/tmp/my-block`
- Wait for the block before interacting: `.{block}[data-block-status="loaded"]`

## Integration with Building Blocks Skill

**Inputs received from building-blocks:**
- block name
- test content URL(s) (from CDD Step 4)
- variants to test
- screenshots of the existing implementation, design or mockup (if provided)
- acceptance criteria (from CDD Step 2)

**Outputs to return to building-blocks:**
- confirmation that linting passes
- screenshots from browser validation
- the tests committed (or why none were) and confirmation they pass
- issues found and resolved
