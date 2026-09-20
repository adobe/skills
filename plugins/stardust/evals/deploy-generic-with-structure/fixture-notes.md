# Fixture provenance & known limitations

`fixture/stardust/` is a copy of `evals/_shared/fixture-post-migrate/stardust/`
(see its README for every part's origin — the fictional regional
financial-services site on a `.example` origin) advanced to the moment the
`program` archetype reaches `deploy` under hands-off, plus the one section this
eval exists for. Every path that differs from the shared tree:

- **`stardust/state.json`** — `handsOff: true` added; `site.eds` added (org / site /
  hosts of a fictional delivery org, `bootstrappedBy: existing`). Nothing else.
- **`stardust/migrated/insurance/home/index.html`** — a fourth section
  `compare-plans` (`data-module="plan-compare"`) between `features` and `quote`:
  `h2`, a two-button `[role=tablist]`, two `[role=tabpanel]` plans (`h3`, `p`,
  CTA) in a `1fr 1fr` grid; the page's inline CSS gains the `.plan-tabs` /
  `.plan-columns` / `.plan` rules (one column ≤ 600 px).
- **`stardust/migrated/insurance/home/_meta.json`** — `modules` gains
  `plan-compare`, `slotsFilled` gains `plan-name`, `plan-copy`, `plan-cta`.
- **`stardust/eds-schema/insurance__home.json`** (only in fixture/) — written by
  `skills/deploy/scripts/section-schema.mjs <page> --out …` over the page above
  (`structure` facts measured: `compare-plans` = `interactive: [button,
  [role=tab], [role=tablist], [role=tabpanel], [aria-controls]]`, `columns: 2`;
  `features` = `columns: 4`; `product-hero` carries `hasH1`), then hand-triaged
  ONCE: `compare-plans` got `"decodeTier": "default"`, `"defaultContent": true`
  — the wrong triage of an earlier pass. `source` rewritten to the
  workspace-relative page path.
- **`stardust/.gitignore`** (only in fixture/) — the master Setup step 6 file,
  copied from `../ai-readability/fixture/stardust/.gitignore`.

The code scaffold at the workspace root is the vanilla `adobe/aem-boilerplate`
checkout of `../ai-readability/fixture/` (`blocks/header`, `footer`, `fragment`;
`scripts/`, `styles/`, `vendor/`, `head.html`, `.eslintrc.js`,
`.stylelintrc.json`, `.gitignore`) with `package.json`, `README.md` and
`fstab.yaml` renamed to the fictional delivery org; `helix-query.yaml` and
`query-index.json` are not copied (no listings on this page). Read
`../ai-readability/fixture-notes.md` for the boilerplate's provenance. This
file lives OUTSIDE the fixture tree on purpose: nothing here is visible to the
agent under test.

## What the structured section exists to catch

| fact | value | why |
|---|---|---|
| `structure.interactive` | tab roles + `button` + `[aria-controls]` | prose cannot carry a tab strip: `section-schema.mjs` prints `⚠ generic-with-structure compare-plans: …` on the re-run and `qa-gate.mjs --schema` FAILs while the page section renders as default content |
| `structure.columns` | 2 | two side-by-side panels of DIFFERENT tags (`div` + `aside`) — no repeat unit, so the columns fact alone carries the structure |
| `defaultContent: true` | on the file | the escape is a recorded reason with a dynamics row, never a flag; hands-off never writes it |
| `features.columns` | 4 | a second structured section with NO triage yet: the run has to decide it (a block, or a recorded decision) — a control that the fix is per-section, not a blanket |

## Expected instrument lines (for the judge)

```
node skills/deploy/scripts/section-schema.mjs <page URL> --out stardust/eds-schema/insurance__home.json
⚠ generic-with-structure compare-plans: interactive=[button [role=tab] [role=tablist] [role=tabpanel] [aria-controls]] columns=2 — needs a block or a dynamics row before conversion (audit-and-naming.md § 2b)
node skills/deploy/scripts/qa-gate.mjs <harness URL> --schema stardust/eds-schema/insurance__home.json
```

## Known limitations — don't mistake these for skill bugs

- Playwright is not pre-installed; the runtime preflight installs it into
  `stardust/node_modules` (needs network). Without it the run can still re-triage
  the schema and write the block, and the judge scores the printed qa-gate /
  block-roundtrip commands plus the `blocked`/`lint unavailable` lines.
- No `DA_TOKEN`, no origin: the push and the DA PUT are `blocked` lines with the
  exact command; a preview URL cannot exist.
- `features` is not pre-triaged: either a block or a recorded default-content
  decision is acceptable for it; only `compare-plans` is the scored gate.
