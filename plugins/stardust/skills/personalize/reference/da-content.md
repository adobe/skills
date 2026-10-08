# Placeholder and Fragment Content (local and DA)

## Local files (always first)

The same `content/` tree `deploy` writes: one body-fragment document per DA path.

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

## Uploading to DA (on by default, like `deploy`)

Delivery runs once every Step 7 gate passes, after the code branch is pushed (`deploy` does the
same); the user can ask for `preview only` or `no upload`. The upload is the deploy chain, not a
hand-rolled PUT loop: `deploy`'s batch driver with the DA coordinates and
token handling of `deploy` (`skills/deploy/SKILL.md` § DA_TOKEN lifecycle,
`skills/deploy/da-deploy-protocol.md`), restricted to the personalized pages and their fragments:

```bash
printf '%s\n' /fragments/personalization/<id>/default /fragments/personalization/<id>/<variant> /<page> > stardust/.work/pzn-paths.txt
DA_TOKEN=… node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> \
  --content content --paths stardust/.work/pzn-paths.txt --force
```

- `--force`: the page is usually already live from `deploy`, and the ledger skips live pages; the
  path list keeps the forced run to the personalized set.
- Publishing is on, as in `deploy`; `--no-publish` stops at preview when the user asks for that.
  Every fragment is previewed and published together with its page, or variants 404 and fall back
  to the default.
- The runtime and block (`scripts/personalization/`, `blocks/personalization/`) must be on the
  pushed code branch before preview renders the placeholder: the skill commits and pushes them
  first (SKILL.md Step 7). No push, no upload.
- Never hardcode, print or ask for a token in chat; a persistent `401` halts the driver (exit 3)
  with the re-run command.

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
