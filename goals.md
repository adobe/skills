## Goals

Skills in scope: building-blocks, content-driven-development, testing-blocks, content-modeling, code-review, aem-cli, da-auth, da-content.

- **Test content, DA projects:** clone/edit/sync with `aem content clone --path` / `add` / `commit` / `push`; no separately obtained DA token; push does not preview.
- **Test content, other sources:** hand-written HTML in `./content/` for local testing only (no clone/push).
- **`./content/` replaces `--html-folder` for test content;** `aem up` serves `./content/` before proxying. Import skills (preview-import, generate-import-html, page-import, snowflake): follow-up, out of scope.
- **Test content location:** block library page `/docs/library/blocks/<block>` by default (projects may use their own path); `/drafts` for stress cases or projects without a library.
- **Worktrees:** use the port `aem up` logs, not 3000.
- **Trim:** keep facts models get wrong, the workflow, and anything costly/critical if wrong. Cut the rest.
- **Fix wrong guidance:** whole first section loads before LCP; wait for `data-block-status="loaded"`.
- **Third-party scripts:** pick the loading technique by context — `loadDelayed()` (prefer `consent-check.js` / `consented.js`; allow `delayed.js` in older projects), IntersectionObserver, on interaction, timed loader. Not everything goes in delayed.
- **CSS scoping:** `.block` or `main .block` both valid, depends on where the block is used; don't prescribe one.
- **testing-blocks:**
  - Don't prescribe a framework (no Vitest mandate).
  - Write a test only when a wrong answer is plausible and costly; no coverage targets.
  - Unit: pure logic and malformed/missing input. E2E: what a click-through won't catch — a11y (focus, keyboard, ARIA state) and analytics. Plain interaction tests are a grey area: only when a regression is plausible and costly.
  - Playwright locates via the a11y tree (roles, accessible names). Not decorate-injected classes or authored text; position/landmark structure only as a sparing fallback. Block root class + `data-block-status="loaded"` OK for waiting.
  - Assert behavior, not visuals (computed CSS, geometry) — that's manual screenshots.
  - Analytics: assert the event fired, not just that the attribute exists.
  - E2E runs on library content (happy path); edge cases in `/drafts` or unit tests, never on the library page.
- **content-modeling:** sharp judgement rules (no nesting, semantic cells, decorate code doesn't rely on cell positions, no key/value content rows, …); author-facing position variants only as a last resort for collection blocks; widgets over Form block.
- **code-review:** inline comments use `line`/`side`, not `position`; validate payload before posting.
- **da-auth / da-content:** align with the test-content goals. Source Bus (`api.aem.live` content) is out of scope; future follow-up.
- **aem-cli:** align with the above.
