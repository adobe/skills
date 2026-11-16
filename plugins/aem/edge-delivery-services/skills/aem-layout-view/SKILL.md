---
name: aem-layout-view
description: "Use when block or site code of an AEM Edge Delivery Services project authored in Experience Workspace (EW, formerly DA, Document Authoring) must stay editable in layout view, the WYSIWYG page editor that renders the page with the site's own code: authors can't edit a block's text or images, blocks duplicate or misbehave after edits, a request fails only in layout view, or a branch needs testing there. Not for the Universal Editor (ue-component-model) or projects authored in Word or Google Docs."
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# Layout View

Layout view runs the site's own `loadPage()` and block code on the page, then makes elements editable. Read the current rules and examples at https://www.aem.live/docs/ew/developing/layout-view. The points agents miss:

- **Entry script:** `head.html` loads `/scripts/scripts.js`, and `scripts.js` defines a top-level `loadPage`, as in the boilerplate.
- **CORS:** off-origin requests (APIs, fragments from other sites, fonts) must allow `https://{BRANCH}--{SITE}--{ORG}.preview.da.live`. This is not fixable in the repo: tell the user whose host to change.
- **Block and text elements:** keep the block element (its first class is the block name) and the authored text and picture elements. Move them, don't copy or unwrap them. If an element must be replaced, copy `data-prose-index` (text) or `data-image-index` and `data-image-version` (`img`) onto the replacement.
- **No decoration on text:** no spans, icons or classes inside or onto authored h1-h6, p, ul, ol, li, pre or blockquote. The editor rebuilds them. Use a wrapper outside the text, or CSS on an ancestor.
- **No position-based CSS on text:** no `>`, `+`, `~`, `:first-child` or `:nth-child` on those elements. While an author types they sit in extra `div`s. Use descendant selectors or a class on the cell.
- **Code runs again after structural edits:** in blocks, keep no module-level one-time state; tie timers and global listeners to the block and stop them when `block.isConnected` is false. In `scripts.js` (`loadEager`, `loadLazy`), guard what is added to `document`, `window` or `head` so it is added only once. Auto-blocking checks for an existing block before it adds one.
- **Testing:** layout view loads code from `main`. Try a branch with the developer plugin (https://www.aem.live/docs/ew/developing/developer-plugin), then type into each text field, replace each image and move the block.
