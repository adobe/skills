---
name: content-driven-development
description: "Use this when building a new AEM Edge Delivery Services (EDS, Franklin, Helix) block, or when changing what authors put into an existing block (new rows or cells, author-selectable variants, a different table structure). Runs the content-first workflow: find or create test content before code, design an author-friendly content model, and validate against that content. For code-only changes that keep the authored structure (CSS fixes, JavaScript bugs, scripts.js, performance, lint) use building-blocks directly."
license: Apache-2.0
metadata:
  version: "2.0.5"
---

# Content Driven Development (CDD)

**Never write or change code before you have identified or created the test content you will use.**

## 1. Dev server

Run `aem up --no-open --forward-browser-logs` unless a server runs already. **aem-cli** covers ports (git worktrees), `./content/` and failures.

## 2. Content model

Skip for changes that keep the authored structure. Otherwise invoke **content-modeling**.

## 3. Test content

- **A. The user gave URLs.** Check that they return 200.
- **B. New block.** Nothing exists to find, so create it:
  1. Write the block's library page with **aem-block-library**: happy path only, each variant once. It is the primary test content.
  2. Put edge cases (missing cells, long text, no image) on separate pages such as `content/drafts/{block}-edge.html`, never in the library. **da-content** has the markup rules.
  3. Pages under `./content/` are served without a flag (`content/drafts/x.html` is at `/drafts/x`). If authors need the content in their CMS, record that as a handoff in the PR.
- **C. Existing block.**
  1. Start with the block library page, `/docs/library/blocks/{block-name}`: it is the primary test content. Note which variants it shows.
  2. For variants or cases it lacks, find real pages that use the block as the **find-test-content** skill describes. It has no script: you list the pages (query index, or `aem content clone --path <folder>` and a search of `./content/`) and check their HTML yourself.
  3. If coverage is still missing, add pages as in B.

## 4. Implement

If the project's content lives in Experience Workspace (DA), read **aem-layout-view** before you write `decorate()`: layout view reruns block code and rebuilds text elements, and a block written without that breaks there.

Then use **building-blocks**, and **testing-blocks** to check the result in a browser and to decide on committed tests.

## 5. Done means

- It is self-contained and works on the authoring surfaces this project uses (layout view in Experience Workspace, `data-aue-*` and the model file in Universal Editor).
- The content model is semantic and easy for authors, and does not depend on one editor.
- Logic that is hard to get right (calculations, number or date formatting, state, non-trivial data transforms) has a unit test. Parsing authored cells and querying or changing the DOM usually do not. Say which applies.
- You checked it in a browser at mobile, tablet and desktop widths, with no console errors, and existing variants still work.
- The library entry shows the happy path only, and edge cases live on other pages.

## 6. Ship

Open a PR whose description has:

- **Test URLs**, before and after: `https://main--{repo}--{owner}.aem.page/{path}` and `https://{branch}--{repo}--{owner}.aem.page/{path}` (`.aem.live` also works). A bot runs PageSpeed Insights on them, so they are required. Keep `{branch}--{repo}--{owner}` to 63 characters or fewer.

Open it as a **draft** while the content it needs exists only locally.
