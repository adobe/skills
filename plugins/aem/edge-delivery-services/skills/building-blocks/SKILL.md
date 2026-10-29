---
name: building-blocks
description: "Use this when implementing code changes in AEM Edge Delivery Services (EDS, Franklin, Helix), whether new or modified blocks, core functionality (scripts.js, styles, consent-gated third-party scripts, etc.), or both. Creates and modifies block folders and decorate functions, updates core scripts, and scopes CSS. For the overall development process use content-driven-development."
license: Apache-2.0
metadata:
  version: "2.0.2"
---

# Building Blocks

Implementation step of **content-driven-development** (Step 5). If you are not following CDD yet, start there: test content and the content model should exist before you write code.

## Workflow

1. **Find patterns** (new blocks or major changes): check `blocks/` and use **block-collection-and-party** for reference implementations.
2. **Read the delivered markup** for your test content before writing decoration.
3. **Implement** `blocks/{block-name}/{block-name}.js` and `.css`. If the change needs core changes (scripts.js, styles.css, consented.js), make and verify those first.
4. **Test** with **testing-blocks**. Pass it the block name, test content URL(s), variants, and acceptance criteria from CDD.
5. **Return** to the CDD workflow.

## Rules that are easy to get wrong

- **Scope CSS to the block class** (`.my-block .item`), not bare selectors. The boilerplate scopes with `.my-block`, not `main .my-block`; header and footer blocks live outside `<main>`.
- **No `-wrapper` or `-container` class names inside a block.** EDS adds `{block}-wrapper` to the block's parent and `{block}-container` to its section; reusing those suffixes collides silently.
- **Never edit `scripts/aem.js`.** It is vendored; put project code in `scripts/scripts.js` or block files.
- **The whole first section loads before LCP**, not just its first block. Any block that can appear at the top of a page must render its authored content without waiting on network requests or heavy imports.
- **Third-party scripts (analytics, martech, tag managers) go in `scripts/consented.js`.** `loadDelayed()` imports `consent-check.js`, which loads `consented.js` only after consent. Current boilerplate has no `delayed.js` or 3-second delay; older projects may still have one.

## Related Skills

- **content-driven-development**: parent workflow
- **block-collection-and-party**: reference implementations
- **testing-blocks**: validation after implementation
- **da-auth**: token for pushing test content to DA, if needed
