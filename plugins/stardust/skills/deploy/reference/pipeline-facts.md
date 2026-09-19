# Pipeline facts — what the DA → EDS pipeline rewrites on delivery

Read this chapter when a page renders one way in the local harness and another on the preview host: every row is a delivery-time rewrite no local gate can see. This table is the fact catalogue only — the authoring rule for each row lives where the third column points, and the lint id names the detector that runs before the `PUT`.

## Fact table

| Fact (delivery rewrite) | Remedy | Rule home · lint |
|---|---|---|
| section-metadata `style`: comma → N classes; a space-separated value → ONE hyphen-joined class that matches no rule (`rt band-navy` → `.rt-band-navy`) | comma-separate the tokens | `foundation.md` § 3 (#120) · `D15 STYLE-SPACE` 🟡 |
| a sole link wrapped by emphasis in either order (`<a><strong>`, `<b>`/`<i>`, alone in a `<li>`) is hoisted to `<strong><a>` and buttonized | emit the link plain; restore a systematic weight in block CSS; log `bold_links_flattened` | `encode-contract.md` § Pipeline-sensitive shapes · `D6 SOLE-EMPH` 🟡 |
| U+00A0 is copied byte-for-byte; a trailing NBSP is trimmed at delivery | converters strip `[ \t\r\n]` only; `sanitise.js` writes `&nbsp;`; a trimmed trailing NBSP is a ledgered residual (D8) | `encode-contract.md` § Pipeline-sensitive shapes · none |
| a `metadata` block in `/nav`, `/footer` or `/fragments/*` leaves an empty section that shifts the slot contract | no metadata block in chrome/fragment documents; noindex via the metadata sheet or robots | `encode-contract.md` § Pipeline-sensitive shapes · `META CHROME` 🟡 |
| a section whose only child is the `metadata` block delivers as an empty padded band | put the block in the section that holds the first content | `content-page-scaffold.md` § 9 · `META ALONE` 🟡 |
| a raw `<table>` under `<main>` becomes a block named after its first cell (its CSS 404s) | author the `table` block (`no-header` variant when the source has no header row) | `encode-contract.md` § Pipeline-sensitive shapes · `TABLE` 🔴 |
| `<em>`/`<strong>` around a picture is unwrapped | alignment or float is a small `figure` block with `left` / `right` variants | `encode-contract.md` § Pipeline-sensitive shapes · none |
