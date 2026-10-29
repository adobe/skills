---
name: content-driven-development
description: Use this when making any AEM Edge Delivery Services (EDS, Franklin, Helix) code change — new blocks, block modifications, CSS styling, bug fixes, core functionality (scripts.js, styles, consented.js), or any JavaScript/CSS work that needs validation. Covers the Content Driven Development process — designing an author-friendly content model, creating test content (block library page in DA) before writing code, and validating against it through to the PR. Do not use for documentation-only changes or configuration changes that do not affect authoring.
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Content Driven Development (CDD)

Never write or modify code before the content that tests it exists. Skip CDD only for documentation-only changes, configuration that does not affect authoring, and research without code changes.

## Workflow

Create a todo list with these 8 steps and complete them in order.

1. **Start the dev server**: `aem up --no-open --forward-browser-logs` (or `npx -y @adobe/aem-cli up ...`), in the background. Read its output and use the port it logs.
2. **Analyze & plan** with **analyze-and-plan**: pass the task and any designs, screenshots or URLs. Write the analysis and acceptance criteria to a file for later steps.
3. **Design the content model** with **content-modeling** (skip for CSS-only changes that don't change content structure). Pass the analysis, block name and purpose.
4. **Identify or create test content.** End with URLs that cover every variant and case.
   - **A. User gave URLs:** check they return 200 locally.
   - **B. New block:** create the block's library page (below).
   - **C. Existing block:** run **find-test-content** with the block name; if coverage is missing, add cases as in B.
5. **Implement** with **building-blocks**: pass the content model, test URLs, analysis and change type. It runs **testing-blocks** for browser validation. Then run **code-review**.
6. **Lint**: `npm run lint` (`npm run lint:fix` for auto-fixable issues) until clean. Run `npm test` only if `package.json` defines it; the boilerplate has none.
7. **Final validation**: re-read the acceptance criteria from step 2; check the test URLs at mobile, tablet and desktop with no console errors; for existing blocks check their other variants, for core changes spot-check a few pages.
8. **Ship it**: commit only the files you changed (conventional commit, agent attribution footer such as `Co-authored-by: cursor <noreply@cursor.com>`), push the feature branch, open the PR with the template below.

### Test content (step 4)

- **Where:** in DA, in the block library: one page per block at `/docs/library/blocks/<block>` (the `library` tab of the DA config points its Blocks entry at the blocks sheet, conventionally `/docs/library/blocks.json`). It holds the examples authors should copy, and the PR links its preview. Stress cases (overflow, very long strings) go under `/drafts`. No block library in the project: use `/drafts`.
- **Clone first:** `aem content clone --path /docs/library` (clone `/drafts` the same way for stress cases; `--all` for the whole site). The CLI signs in to DA in the browser itself.
- **Write** `content/docs/library/blocks/<block>.html` as a full DA document; see [references/html-structure.md](references/html-structure.md) and **da-content**. Library page format:
  - one block table per variant; a visual variant is a header `Block (variant)`, i.e. `<div class="block variant">`; a content variant is a heading right before its table;
  - optional `library-metadata` block after a block, with one `description` row;
  - content that must be inserted together (heading plus block, multi-section blocks such as tabs or accordions) goes between `library-container-start` and `library-container-end` marker blocks.
- **New block:** add a row to the blocks sheet (`content/docs/library/blocks.json` after cloning; keep its existing JSON shape): `name` = block display name, `path` = `https://content.da.live/{org}/{site}/docs/library/blocks/<block>`. Or edit the sheet in da.live.
- **Check locally** before pushing: `aem up` serves `content/` before proxying, so the page is at `http://localhost:<port>/docs/library/blocks/<block>` and `.plain.html`, rendered by the same pipeline as production.
- **Sync:** `aem content add <files>`, `aem content commit -m "..."`, `aem content push` (also for the sheet).
- **Preview** each pushed page: Sidekick Preview, or `POST https://admin.hlx.page/preview/{owner}/{repo}/{ref}/{path}`.
- **Non-DA projects** (Google Drive, SharePoint): ask the user to author the content from the content model and preview it. To hand over a local draft, open it in the browser, right-click the Sidekick icon → **View document source**, copy, paste into Word/Google Docs. Until the content exists, open the PR as a draft (`gh pr create --draft`) with next steps for the user.

### PR template

```markdown
## Description
Brief description of changes

Fix #<gh-issue-id>

Test URLs:
- Before: https://main--{repo}--{owner}.aem.page/{path}
- After: https://{branch}--{repo}--{owner}.aem.page/{path}
```

Link the library page (`/docs/library/blocks/<block>`) and any other test pages. The After URL is required: the PR's PageSpeed checks run against it.

## Rules that are easy to get wrong

- **Use the port `aem up` logs.** In a git worktree it serves on 3000 + hash(branch) % 1000, not 3000, unless `--port` is set. If another `aem up` holds the port, it is stopped (`--stop-other` is the default); there is no fallback port.
- **`aem content push` does not preview.** It only stores the page in DA; the branch link `https://{branch}--{repo}--{owner}.aem.page/{path}` 404s until the page is previewed.
- **No `--html-folder`, no DA token step.** Local test pages live in `content/` and plain `aem up` serves them. `aem content` handles DA auth (browser login, cached in `.hlx/.da-token.json`).
- **Test pages are `.html` full documents**, not `.plain.html` files; `.plain.html` is only a URL (`<path>.plain.html` returns the `<main>` content).
- **Section metadata is applied server-side** by the HTML pipeline: `Style` values become classes on the section, other keys become `data-*` attributes, and the section-metadata div is gone from the delivered markup. Don't parse it in `scripts.js`. If a section lacks its class, check that the section-metadata block is inside that section.
- **Third-party scripts go in `scripts/consented.js`**, loaded by `consent-check.js` after consent. The boilerplate has no `delayed.js`.

## Related Skills

- **analyze-and-plan**: step 2
- **content-modeling**: step 3
- **find-test-content**: step 4, existing blocks
- **da-content**: DA HTML format for test pages
- **aem-cli**: `aem up` and `aem content` details
- **building-blocks**: step 5 implementation; runs **testing-blocks**
- **code-review**: after step 5
- **block-collection-and-party**: reference implementations
- **page-decomposition**: sections and section styles when migrating pages
