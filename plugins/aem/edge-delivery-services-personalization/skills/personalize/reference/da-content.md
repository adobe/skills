# Personalized Section and Fragment Content (local and DA)

## Local files (always first)

One body-fragment document per DA path under `content/` (what `aem up` serves locally).

| Content | Local file | DA path |
|---|---|---|
| Page with the personalized section | `content/<page>.html` | `/<page>` |
| Variant fragment | `content/fragments/personalization/<id>/<variant>.html` | `/fragments/personalization/<id>/<variant>` |

- Body-fragment documents (`<body><header></header><main>…</main><footer></footer></body>`):
  sections are `<div>`s in `<main>`, blocks are `<div class="name">` div-grids, no `<table>`.
- Edit the page surgically: add the `Personalization …` rows to the section's existing
  `section-metadata` block (or add one at the end of the section), as in `authoring-model.md`
  (template: `assets/content/section-metadata.html`).
  The section's content stays where it is: it is the default. Never delete or move authored
  content; to personalize only part of a section, split the section and copy its `Style` row.
- Scaffold each variant from the section's authored content (same blocks, images, CTAs), copy
  swapped for `TODO:` unless the user provided the text; `assets/content/fragment.html` only when
  there is nothing to copy. List the TODOs in the summary.
- Fragments carry no metadata block; `noindex` comes from bulk metadata (below).
- Run `validate-placeholders.mjs` before any upload.

## Uploading to DA (on by default)

Delivery runs once every validation gate passes (SKILL.md Steps 6–7), after the code branch is pushed; the user can ask for
`preview only` or `no upload`. **DA content is shared by every branch, and `aem.live` always runs
`main`'s code**, so the order is: upload and preview, verify on the branch preview, and publish only
once `main` serves the runtime. Upload only the personalized pages and their fragments.

**Path 1, `DA_TOKEN`** (the `da-auth` skill obtains one; the Source API contract is in the
`da-content` skill, aem-edge-delivery-services plugin):

```bash
PATHS="/fragments/personalization/<id>/<variant> /<page>"
for p in $PATHS; do
  curl -fsS -X PUT -H "Authorization: Bearer $DA_TOKEN" -F "data=@content$p.html;type=text/html" \
    "https://admin.da.live/source/<org>/<repo>$p.html" >/dev/null
  curl -fsS -X POST -H "Authorization: Bearer $DA_TOKEN" \
    "https://admin.hlx.page/preview/<org>/<repo>/<branch>$p" >/dev/null
done
# publish only once main serves the runtime (200):
curl -s -o /dev/null -w '%{http_code}' https://main--<repo>--<owner>.aem.live/scripts/personalization/sections.js
for p in $PATHS; do
  curl -fsS -X POST -H "Authorization: Bearer $DA_TOKEN" "https://admin.hlx.page/live/<org>/<repo>/main$p" >/dev/null
done
```

**Path 2, a DA MCP server** (no `DA_TOKEN`, an MCP connected): its source-write tool for each path in
the same list (the same body-fragment documents), then its preview tool, then publish under the
same `main` rule.

- The multipart field must be `data` with type `text/html`; other names fail silently.
- Every fragment is previewed and published together with its page, or variants 404 and the
  section shows its authored content (`fragment failed`).
- Verify on `<branch>--<repo>--<owner>.aem.page`, which runs the pushed branch's code. `main--…`
  preview and every `aem.live` page run `main`: before the merge a personalized section shows only
  its authored content (no runtime reads the rows), so do not publish, and say so in the summary (the publish loop is the hand-off).
- No push, no upload.
- Never hardcode, print or ask for a token in chat; on a `401`, stop and hand off the commands
  with a note to refresh the token.

## Bulk metadata: keep fragments out of search

Fragments are fetched as `.plain.html` but also exist as pages. Mark them `noindex` once per site
in the DA bulk metadata sheet (`/metadata`, published as `/metadata.json`):

| URL | robots |
|---|---|
| `/fragments/**` | `noindex` |

If the sheet exists, add the row (do not overwrite other rows); if it does not, ask the user to
create it in DA (a sheet named `metadata` at the site root) and preview/publish it. Check after
publish: `curl -s https://main--<repo>--<owner>.aem.page/fragments/personalization/<id>/<variant> | grep -i 'name="robots"'`.

## Authoring tips for the user

- Everything lives in the section's Section Metadata table; the section's content is what everyone
  sees unless a variant is chosen.
- Add a variant: a fragment link in `Personalization Variants` (DA's link tool; one link per
  line) and a `Personalization Rule <Variant>` row. Rule order matters (first match wins). A second
  rule for the same variant is `Personalization Rule <Variant> 2`: two rows with the same name
  keep only the last one.
- One condition per rule cell, on one line (`&` for AND, `,` for OR within a criterion).
- A/B test: `Personalization Source | split` (and optionally `Personalization Split | 50`).
  Target: `Personalization Source | target`; the `Personalization` id is the location (mbox),
  unless a `Personalization Location` row names another one.
- `Personalization Hint` and `Personalization Description <Variant>` rows (decision engines) are
  public, because they are in the page HTML: write them like marketing copy.
- Preview a variant with `?pzn=<id>:<variant>` on `*.aem.page`, and add `pzn-consent=1` to see
  what a consenting visitor gets. `?pzn-debug` shows each decision's outcome and reason.
