# Restyle the contained columns variant

I'm changing `blocks/columns/columns.css` so the `contained` variant (`columns contained`) gets a maximum width and side padding.

Before I open a PR, work out which pages I should test it against. The production site is https://main--helix-website--adobe.aem.live and has a lot of real content.

1. Write `TEST-PAGES.md`: one entry per page with its URL, the `columns` variants on it, and what to check.
2. Add `test/e2e/columns.spec.js` (Playwright, using the project's config) that loads each of those pages and checks the block renders.

I'm not available for questions. Decide, and note your assumptions in `TEST-PAGES.md`. Don't change block code.
