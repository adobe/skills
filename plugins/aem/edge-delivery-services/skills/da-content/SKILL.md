---
name: da-content
description: Reference for producing Adobe Document Authoring (DA, da.live) and Edge Delivery Services (EDS, aka aem.live/Helix) compatible content. Use whenever generating HTML for DA upload, uploading media binaries to DA, publishing to aem.live, or driving the DA admin API (auth, source PUT, preview/publish). Covers block HTML format (canonical div-class form and accepted table alternate), section structure, page/section metadata, icons, links, images, default content, document skeleton constraints, block cell content normalization, the DA Source API contract, IMS auth, media storage, supported formats, Media Bus vs Content Bus delivery, and silent-failure rules that corrupt content.
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# DA + EDS content reference

A reference skill — not a workflow. Use it whenever you need to know **what
the rules are** for generating, uploading, or delivering content through
Adobe Document Authoring (DA) and Edge Delivery Services (EDS).

This skill consolidates rules from three primary surfaces. Load the
reference for the task at hand:

| Doing | Read |
|---|---|
| Generating HTML for DA upload | [references/html-content.md](./references/html-content.md) |
| Uploading images, video, PDFs, fonts | [references/media.md](./references/media.md) |
| Hitting the DA admin API, auth, preview/publish | [references/platform.md](./references/platform.md) |
| Re-verifying asset boundary behavior empirically | [references/fixtures/README.md](./references/fixtures/README.md) |

Every factual claim in the references is tagged `[verified]` (read from
code or observed empirically) or `[assumed]` (inferred from documentation
without direct verification).

## When to use this skill

Invoke this skill whenever you are:

- Generating HTML that will be uploaded to DA (`admin.da.live/source/...`).
- Uploading any binary (PNG, JPG, SVG, MP4, PDF, WOFF2) to DA.
- Calling `admin.da.live` (Source API) or `admin.hlx.page` (preview /
  publish API) directly.
- Reading a DA-stored HTML document and modifying it before re-upload.
- Diagnosing why a generated page renders incorrectly on `aem.page` /
  `aem.live` (silent failures: `about:error` images, missing meta tags,
  blocks rendering as plain HTML without their JS or CSS).

### When NOT to use this skill

- Writing block JS or CSS for a project — use **building-blocks**.
  This skill covers the *content* side, not the *code* side.
- Universal Editor, structured-content authoring, or AEM Cloud Service
  (Java / OSGi / JCR). Out of scope.

## Related Skills

- **da-auth** — Obtain the IMS token needed for every `admin.da.live`
  and `admin.hlx.page` call. Invoke before any operation in this skill
  that needs `DA_TOKEN`.
- **generate-import-html** — Generates DA-compliant HTML for imported
  pages; this skill is the rule reference for what that HTML must
  look like.
- **page-import** — Orchestrates full page imports into canonical
  EDS block format. Reads this skill for the DA-side rules.
- **snowflake** — Static-to-EDS overlay conversion. Loads this skill
  alongside its own methodology for DA HTML and admin API rules.

## Minimal upload example

The most common operation — upload an HTML document to DA. Shows the
non-obvious rules in one place: multipart/form-data body, field name
`data`, blob with `text/html` type, Bearer IMS token, then a separate
preview call to make the page reachable at `aem.page`. See
[references/platform.md](./references/platform.md) for the full contract
and [references/html-content.md](./references/html-content.md) for what
the HTML payload must look like.

```bash
# Use $DA_TOKEN from the da-auth skill, or read a cached token file directly.
# See platform.md §3 for the cache locations the various Adobe DA tools use.
TOKEN="${DA_TOKEN:?invoke the da-auth skill to obtain a DA admin token}"

# 1. Upload HTML — note multipart with field name "data" (other names silently fail)
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -F "data=@./page.html;type=text/html" \
  "https://admin.da.live/source/{org}/{repo}/path/to/page.html"

# 2. Trigger preview — required separate step, path WITHOUT .html extension
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/{org}/{repo}/main/path/to/page"

# 3. Optional: publish to aem.live
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/live/{org}/{repo}/main/path/to/page"
```

Image binaries upload the same way (PUT to `admin.da.live/source/...`)
but do NOT need their own preview/publish call — they're served
directly from `content.da.live` once uploaded. They DO get pulled into
Media Bus (content-addressed, with responsive variants) when a
*document* that references them is previewed — see
[references/media.md §2](./references/media.md) for the asset lifecycle.

## The 11 silent-failure rules

These rules, if violated, produce broken content without any error from DA,
the pipeline, or the renderer. Memorize them; verify them in generated
output before upload.

1. **DA HTML is a body fragment.** No `<!DOCTYPE>`, no `<html>`, no `<head>`,
   no `<script>`, no `<style>`, no inline `style=` attributes. The pipeline
   injects head/scripts/styles from Code Bus at delivery.
   → [html-content.md §1](./references/html-content.md)

2. **Block class encodes block identity (canonical div form).** The
   outermost `<div>` carries `class="<block-name> [<variant>…]"`. The
   first class token is the block name and resolves to
   `/blocks/<name>/<name>.{js,css}`. For the accepted table-form
   alternate, the header is `<tr><td colspan="N">Name</td></tr>` where
   `N` matches the cell count of the widest content row; single-column
   blocks may omit `colspan`. Misshapen blocks (missing div class,
   multi-column table missing `colspan`, empty header cell) render as
   plain HTML without block JS or CSS.
   → [html-content.md §3](./references/html-content.md)

3. **Block names use alphanumeric + single hyphens only.** No underscores,
   no double dashes, no digit-first names. Variants in div form: extra
   class tokens after the name (`class="hero cta center"`). Variants in
   table form: parentheses after the name (`Hero (cta, center)`). Both
   normalize identically via `toBlockCSSClassNames`.
   → [html-content.md §3](./references/html-content.md)

4. **Page Metadata block name is exactly `metadata`.** Div form:
   `class="metadata"` (single lowercase token). Table form: header text
   `Metadata` (case-insensitive). Misspellings on either side are
   silently ignored — no `<meta>` tags emitted.
   → [html-content.md §5](./references/html-content.md)

5. **`<img src>` URLs must be reachable from EDS preview infrastructure.**
   The preview step fetches every `<img src>` and `<source srcset>` URL,
   content-hashes the bytes, and stores them in Media Bus — that's how
   the delivered page gets responsive `<picture>` variants. Any URL that
   doesn't return image bytes (DNS failure, 4xx/5xx, HTML response,
   timeout > 5s) produces `<img src="about:error">`. Host-less paths
   (repo-relative `/path/foo.png`, document-relative `./foo.png`) also
   fail because the ingester has nothing to fetch. External URLs work
   fine and are sideloaded on first preview.
   → [media.md §2](./references/media.md), [html-content.md §9](./references/html-content.md)

6. **Pre-upload binaries only when you need URL stability.** Sideloading
   means you do NOT need to upload an image to DA before referencing it
   from your HTML — any reachable URL works. Pre-upload (to
   `/media/<scope>/<file>`) when you want the binary under DA's control:
   immune to third-party host changes, addressable by a stable
   `content.da.live` URL, and re-fetched into Media Bus on each preview.
   → [media.md §2.5](./references/media.md), [media.md §13.2](./references/media.md)

7. **DA Source API requires `multipart/form-data` with field name `data`.**
   Other field names (`file`, `image`) return 200 OK with no file written.
   → [platform.md §2](./references/platform.md)

8. **SVG hard cap is 40 KB.** PNG/JPG/AVIF/WEBP cap is 20 MB. MP4 cap is
   36 MB. Over-cap SVGs cause the preview POST to fail with
   `409 AEM_BACKEND_FETCH_FAILED` ("Images N have failed validation");
   pre-check sizes before upload.
   → [media.md §6.1](./references/media.md)

9. **Preview / publish is a required separate step.** Uploading to DA does
   NOT make the document visible at `aem.page` / `aem.live`. POST to
   `admin.hlx.page/preview/...` then `/live/...` after upload.
   → [platform.md §6](./references/platform.md)

10. **IMS tokens expire silently with 401 + empty body.** Dev tokens last
    24 hours. Always pre-flight expiry against `expires_at` in the cached
    token file (`~/.aem/da-token.json` for da-auth, `.hlx/.da-token.json`
    for `@adobe/aem-cli`) before a long upload run.
    → [platform.md §3](./references/platform.md)

11. **Block cell content uses stricter inline-tag normalization than
    default content.** Inside block cells, the pipeline rewrites
    `<b>`/`<i>`/`<s>`/`<mark>`/`<kbd>` to their semantic equivalents
    (`<strong>`/`<em>`/`<del>`/`<em>`/`<code>`), strips `<span>` and
    `<ins>`, and applies positional rules to `<br>`. Visual styling
    survives the rewrites but CSS selectors targeting the original tags
    or stripped classes stop matching. Generate cell content using only
    the §3.9 preserve list to avoid silent reshaping.
    → [html-content.md §3.9](./references/html-content.md)

## Glossary

Terms used across all three references.

- **Admin API** — `https://admin.hlx.page/<action>/...` endpoint family.
  Controls document lifecycle (preview, publish, status). Distinct from
  the DA Source API.
- **Code Bus** — files delivered from the git-tracked GitHub branch
  (typically `/fonts/`, `/icons/`, `/blocks/`, `/scripts/`, `/styles/`,
  `/head.html`). Updated by code deploy.
- **Content Bus** — files delivered from DA at their original path
  (SVG, PDF, HTML, JSON, ICO, WOFF2). Updated by preview/publish.
- **DA editor** — the web UI at `https://da.live/edit#/...` for human
  authoring of documents.
- **DA Source API** — `https://admin.da.live/source/...` endpoint for
  read/write of DA-tracked files (HTML and binaries).
- **Default content** — anything in an EDS page outside a block:
  headings, paragraphs, lists, links, images. Renders as standard HTML.
- **Dot-folder** — `/<parent>/.<docname>/` folder created automatically
  by the DA editor for per-document author uploads of images.
- **EDS** — Edge Delivery Services. The rendering pipeline that serves
  `aem.page` (preview) and `aem.live` (production), consuming DA content
  + Code Bus + Media Bus.
- **IMS token** — Adobe Identity Management access token. Cached at
  `~/.aem/da-token.json` (via the **da-auth** skill) or `.hlx/.da-token.json`
  (via the `@adobe/aem-cli` tool). Used for auth against the DA Source API
  and the Admin API.
- **Media Bus** — content-addressed backend for image and video binaries
  (PNG, JPG, AVIF, WEBP, MP4). Dedup by SHA hash; permanent cache.
- **`/media` folder** — top-level DA folder convention for shared
  binaries referenced across documents/branches/iterations. Auto-creates
  on first PUT.
- **Preview / Publish** — Admin API operations that promote a document
  from "stored in DA" to "available at `aem.page`" (preview) or
  "available at `aem.live`" (publish).
- **Section** — a `<div>` directly inside `<main>` in a DA HTML document.
  Becomes `<div class="section">` after decoration.
- **Section Metadata** — block whose `Style` key adds CSS classes to the
  enclosing section. NOT for SEO metadata (that's Page Metadata).
- **Page Metadata** — block whose key/value rows become `<head>` `<meta>`
  tags at delivery. One per page; conventionally last in document.
