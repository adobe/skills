# feat(plans): add plans block with a monthly/annual toggle

Branch: `plans-block`

Adds the `plans` block: one card per plan (name, monthly price, price per month when billed annually, features, link) with a Monthly / Annual toggle. In annual mode each card shows the saving as a whole percentage.

## Test URLs

- Before: https://main--acme-site--acme.aem.page/docs/library/blocks/plans
- After: https://plans-block--acme-site--acme.aem.page/docs/library/blocks/plans
- Edge cases: https://plans-block--acme-site--acme.aem.page/drafts/plans-edge

## Content model

One row per plan, four columns: name (h3), prices (monthly paragraph, then annual-per-month paragraph), features (list), link.

## Assumptions

- No one was available to answer, so prices are read from the first number in each paragraph; a non-numeric price ("Free") shows no saving.
- The saving is rounded to a whole percentage.
- The project has no test framework. The saving calculation is a pure function with unit tests with the project test runner.

## Checked

Loaded the library page and the edge-case page with `aem up` at 375, 768 and 1200 px: one column, two columns, three columns; no horizontal overflow; toggling switches prices and the saving line. Screenshots: `pr-screenshots/plans-375.png`, `plans-768.png`, `plans-1200.png`.

## Still to do outside the repo

- Push the library page, the sheet row and the content to Experience Workspace.
- The `library` tab of the site config (da.live/config) must point at the blocks sheet; it already lists Cards and Columns, so check that Plans shows up.
- Run PageSpeed Insights on the after URL once the branch is previewed.
