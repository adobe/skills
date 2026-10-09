# Placeholder and Fragment Content (local and DA)

## Local files (always first)

One body-fragment document per DA path under `content/` (what `aem up` serves locally).

| Content | Local file | DA path |
|---|---|---|
| Page with the placeholder | `content/<page>.html` | `/<page>` |
| Default fragment | `content/fragments/personalization/<id>/default.html` | `/fragments/personalization/<id>/default` |
| Variant fragment | `content/fragments/personalization/<id>/<variant>.html` | `/fragments/personalization/<id>/<variant>` |

- Body-fragment documents (`<body><header></header><main>…</main><footer></footer></body>`):
  sections are `<div>`s in `<main>`, blocks are `<div class="name">` div-grids, no `<table>`.
- Edit the page surgically: replace only the personalized region with the block from
  `assets/content/placeholder-block.html`. Never delete the authored content: it moves into the
  default fragment (or the default row).
- Fragment scaffolds come from `assets/content/fragment.html`. Keep `TODO:` copy unless the user
  provided the text, and list the TODOs in the summary.
- Fragments carry no metadata block; `noindex` comes from bulk metadata (below).
- Run `validate-placeholders.mjs` before any upload.

## Uploading to DA (on by default)

Delivery runs once every Step 7 gate passes, after the code branch is pushed; the user can ask for
`preview only` or `no upload`. **DA content is shared by every branch, and `aem.live` always runs
`main`'s code**, so the order is: upload and preview, verify on the branch preview, and publish only
once `main` serves the block. Upload only the personalized pages and their fragments.

**Path 1, `DA_TOKEN`** (the `da-auth` skill obtains one; the Source API contract is in the
`da-content` skill, aem-edge-delivery-services plugin):

```bash
PATHS="/fragments/personalization/<id>/default /fragments/personalization/<id>/<variant> /<page>"
for p in $PATHS; do
  curl -fsS -X PUT -H "Authorization: Bearer $DA_TOKEN" -F "data=@content$p.html;type=text/html" \
    "https://admin.da.live/source/<org>/<repo>$p.html" >/dev/null
  curl -fsS -X POST -H "Authorization: Bearer $DA_TOKEN" \
    "https://admin.hlx.page/preview/<org>/<repo>/<branch>$p" >/dev/null
done
# publish only once main serves the block (200):
curl -s -o /dev/null -w '%{http_code}' https://main--<repo>--<owner>.aem.live/blocks/personalization/personalization.js
for p in $PATHS; do
  curl -fsS -X POST -H "Authorization: Bearer $DA_TOKEN" "https://admin.hlx.page/live/<org>/<repo>/main$p" >/dev/null
done
```

**Path 2, a DA MCP server** (no `DA_TOKEN`, an MCP connected): its source-write tool for each path in
the same list (the same body-fragment documents), then its preview tool, then publish under the
same `main` rule.

- The multipart field must be `data` with type `text/html`; other names fail silently.
- Every fragment is previewed and published together with its page, or variants 404 and fall back
  to the default.
- Verify on `<branch>--<repo>--<owner>.aem.page`, which runs the pushed branch's code. `main--…`
  preview and every `aem.live` page run `main`: before the merge they show the raw rule rows, so
  do not publish, and say so in the summary (the publish loop is the hand-off).
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

- Rules are rows: add a row above `default` to add a variant; order matters (first match wins).
- Link the fragment with DA's link tool (the link text can be anything; a cell with only a link is
  a fragment reference).
- `default | none` hides the placeholder unless a rule matches.
- Preview a variant with `?pzn=<id>:<variant>` on `*.aem.page`; `?pzn-debug` shows why a variant won.
