# Full donor vocabulary — build every recorded module, used or not

Reskin flow only (`state.json.flow: "reskin"`), during `deploy` Steps 2–8
(`../../deploy/reference/step-2-names-and-schema.md` points here).

With a donor design (`stardust/reskin/donor-modules.md`), the project ships the donor's **whole** vocabulary, not only
what the migrated pages use, so a later page's author can pick any module from the block library. Each included row
has one Disposition (contract: `donor-sources.md` § donor-modules.md); lock it before code, first fit wins, one-line
reason in the conversion log:

1. **Existing block** reused unchanged.
2. **Variant** (preferred) — an authored block option (`Cards (focus-upper)` → `class="cards focus-upper"`) when the
   module keeps an existing block's rows and differs in layout or a `decorate()` branch (tabs on accordion rows, a
   carousel on teaser panels). A different content model is not a variant (deploy anti-pattern 1).
3. **New block** — only when no block's content model fits (a calculator's input and formula rows); say why.
4. **Section style** — default content + a section-metadata Style (`.section.<name>`).
5. **Style** — global CSS in `styles/styles.css` (shared form fields, a tooltip).
6. **Convention** — what `aem.js` decorates: `strong` / `em` / `strong` + `em` links → `.primary` / `.secondary` /
   `.accent` buttons (deploy Step 5).
7. **Feature** — `scripts/` behaviour no author places (back-to-top; `/modals/` links opening a fragment in a dialog).
8. **Default content** (D1).

Kinds 4–8 say why. The kit's seed is a proposal: an invented block an existing block hosts is its variant (chips,
pagination on a links block); a card whose anatomy is a full-bleed image with copy over it is a hero.

Build all of them in deploy Steps 3–8 under the page blocks' EW contract, round-trip and lint; each block and variant
gets a block-library sample (a variant is an extra section of its block's sample) and its `metadata.json` `variants`
entry. Close with `node stardust/scripts/reskin/vocabulary-check.mjs --project . --library <library dir>` (exit 0),
then re-run the content gate and render check on the migrated pages: unchanged.

Recorded traps:

- splice new tokens into the committed `:root` — re-running the foundation generator erases hand edits;
- load `scripts/` features by dynamic import from `window.hlx.codeBasePath` (a static import of `fragment.js` closes
  an `import/no-cycle` loop through `scripts.js`);
- a `[hidden]` element whose class sets `display` needs `[hidden] { display: none }`;
- parse an authored formula with a small evaluator, never `eval` / `Function`;
- keep an unrecognised authored row as content (EW1).
