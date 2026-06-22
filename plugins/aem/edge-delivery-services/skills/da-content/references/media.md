# DA media — binaries reference

How DA handles images, SVGs, video, PDF, fonts, and other binary assets:
storage patterns, upload paths, supported formats, size limits, the
delivery model, and how authored HTML references uploaded media.

For the Source API contract, IMS auth, retry policy, and URL reference
card, see [platform.md](./platform.md). For how HTML documents reference
the media described here, see [html-content.md](./html-content.md).

Every factual claim is tagged `[verified]` (read from code or observed
empirically) or `[assumed]` (inferred from documentation without direct
verification).

---

## 1. Storage model (recap)

DA stores both content (HTML) and binaries under
`{org}/{repo}/<path>`. The four hostnames and the Source API are documented
in [platform.md §1](./platform.md). What's relevant here: every binary is
addressed by a path under that namespace, served at `content.da.live`, and
optionally rendered through the EDS pipeline at `aem.page` / `aem.live`.
[verified] from `da-admin` source and `aem.live` docs.

---

## 2. Asset lifecycle — how images flow from DA HTML to delivered page

Internalize this section before reading the rest. Image handling looks
simple from the author side (write `<img src="...">`, get a responsive
`<picture>` at delivery) but it spans three stages with sharply different
behaviors. Most "silent failure" debugging starts by figuring out which
stage broke. [verified] empirically on `aem.page` against a live DA repo.

### 2.1 The three stages

```
        ┌──────────────────────┐    ┌────────────────────────┐    ┌──────────────────────┐
        │ Stage 1: DA storage  │    │ Stage 2: Preview       │    │ Stage 3: Delivery    │
        │   (Content Bus)      │ →  │   ingestion            │ →  │   (helix pipeline)   │
        │                      │    │   (admin.hlx.page)     │    │                      │
        │ Bytes you uploaded.  │    │ Walks <img src> and    │    │ Reads MD from        │
        │ Author URLs kept     │    │ <source srcset>.       │    │ helix-content-bus.   │
        │ verbatim. No         │    │ Fetches each. Hashes.  │    │ Rewrites             │
        │ rewriting.           │    │ Stores in Media Bus.   │    │ hlx.blob URLs →      │
        │                      │    │ Writes MD with         │    │ ./media_<hash>.      │
        │                      │    │ rewritten URLs to      │    │ Wraps in responsive  │
        │                      │    │ helix-content-bus.     │    │ <picture>.           │
        └──────────────────────┘    └────────────────────────┘    └──────────────────────┘
            content.da.live              admin.hlx.page/preview         *.aem.page / *.aem.live
```

What this means in practice:

- **DA storage never sees the rewritten URLs.** A `GET` to
  `admin.da.live/source/...` returns the author URLs you uploaded —
  unchanged after any number of previews. `[verified]`
- **Preview is where the magic (and the failures) happen.** Sideloading,
  dedup, fetch errors, format detection — all decided here. The same DA
  document can render correctly on one branch and broken on another if
  the second branch's preview never ran. `[verified]`
- **Delivery is just URL rewriting and `<picture>` wrapping.** The
  delivery pipeline never fetches external bytes — it only sees URLs
  that were ingested at preview. `[verified]` from
  `helix-html-pipeline/src/steps/create-pictures.js` and `rewrite-urls.js`.

### 2.2 What gets sideloaded at preview

The preview ingestion walks the HTML and processes URLs **only in
specific slots**:

| Slot | Sideloaded? |
|---|---|
| `<img src="<URL>">` | **Yes** — URL fetched, bytes hashed, stored in Media Bus |
| `<source srcset="<URL>">` (inside an author `<picture>`) | **Yes** — same as `<img>` |
| `<img>` inside a Page Metadata `image` row | **Yes** — hash propagated to `og:image`, `twitter:image` |
| `<a href="<URL>">` | **No** — anchor links preserved as-is |
| Section Metadata `Background` cell URL | **No** — preserved as `data-background="<URL>"` |
| URLs inside text content, code blocks, attribute values other than `src` / `srcset` | **No** — preserved as-is |

If you need to reference an image URL **without** triggering a Media Bus
copy (e.g., signed CDN URL with short-lived access, asset that must
update in place), put the URL anywhere other than `<img src>` / `<source srcset>` and
the pipeline will leave it alone. The trade-off: you also lose the
responsive `<picture>` treatment. `[verified]`

### 2.3 URL forms and their preview-time behavior

For each URL the preview encounters in an `<img>` / `<source>` slot, the
behavior depends on the URL form:

| URL form | What preview does | Delivered output |
|---|---|---|
| External, reachable (`https://picsum.photos/...`, `https://example.com/foo.png`, etc.) | Fetch, hash, store in Media Bus | `./media_<hash>.<ext>` in responsive `<picture>` |
| `https://content.da.live/{same-org}/{same-repo}/<path>` to a file that exists in DA | Fetch from DA Content Bus, hash, store in Media Bus | `./media_<hash>.<ext>` in responsive `<picture>` |
| `https://{branch}--{repo}--{owner}.aem.page/<path>/media_<hash>.<ext>` (already-Media-Bus path) | Recognize the hash, **do not re-fetch** | `./media_<hash>.<ext>` in responsive `<picture>` |
| `https://{branch}--{repo}--{owner}.aem.page/<path>.png` (non-`media_*` path; not in Code Bus or Content Bus) | Attempt fetch → 404 | **`<img src="about:error">`** |
| `https://{branch}--{repo}--{owner}.aem.page/<code-bus-path>.png` (file committed to GitHub branch under e.g. `/assets/`) | Fetch succeeds (Code Bus serves the file), hash, store in Media Bus | `./media_<hash>.png` in responsive `<picture>` (branch-locked — the deploy host is in the source URL) `[assumed]` |
| `https://content.da.live/{other-org}/{other-repo}/<path>` (cross-tenant) | Attempt fetch → 404 (path doesn't exist; cross-tenant references generally don't resolve) | **`<img src="about:error">`** |
| External URL pointing at HTML or non-image content-type | Fetch succeeds but bytes aren't an image | **`<img src="about:error">`** |
| External URL with DNS failure / connection refused / 4xx / 5xx | Fetch fails | **`<img src="about:error">`** |
| Repo-relative (`/path/foo.png`) | No host → cannot resolve | **`<img src="about:error">`** |
| Document-relative (`./foo.png`, `../foo.png`) | No host → cannot resolve | **`<img src="about:error">`** |
| Repeated URL (same string, same page) | Fetch once, return same hash | **Deduplicated** — same `./media_<hash>` reused |

The fetch budget per preview is bounded: each image gets ~5s, the whole
HTML+image preview gets ~25s, and a page can sideload at most ~200
unique images. `[verified]` from `aem.live/docs/limits` (BYOM section,
which governs the same ingestion path).

### 2.4 What survives across previews and branches

Media Bus is content-addressed (`media_<sha-256>.<ext>`) and shared
across the EDS tenant, so:

- **Dedup within a page.** Two `<img>` elements on the same page
  pointing at the same URL get one Media Bus entry. `[verified]`
- **Dedup across pages.** Two documents referencing the same URL
  expected to share one Media Bus entry (content-addressing implies
  this). `[assumed]`
- **Dedup across branches.** Documents on different branches
  referencing the same URL expected to share one Media Bus entry —
  the `aem.live/docs/media` docs describe Media Bus as tenant-scoped.
  `[assumed]`
- **Re-preview re-fetches.** If the source URL's bytes change between
  previews, the second preview sees the new bytes and generates a new
  hash — the document's delivered HTML picks up the new URL on next
  request. The old hash remains in Media Bus for documents that still
  reference it. `[verified]` (observed via `picsum.photos` URLs
  returning different bytes on different previews → different hashes).
- **Stale documents keep stale hashes.** A document that referenced
  external URL X gets a hash recorded at preview time. If X is later
  served different bytes and the document is NOT re-previewed, the
  document keeps serving the old bytes from Media Bus. `[verified]`

### 2.5 Strategic implications for authoring

The corrected mental model changes how you should think about asset
uploads:

- **You usually don't need to pre-upload binaries to DA.** Reference any
  reachable image URL in `<img>` or `<source>` and it gets sideloaded
  automatically on first preview. This is true even for arbitrary
  external URLs.
- **Pre-upload still matters for control.** For assets you want to own
  (logos, illustrations, hero photos), upload to `/media/<scope>/<file>`
  via the Source API so the URL is stable, the binary doesn't depend on
  a third party's host, and the asset survives even if the original
  source goes away. Then reference the `content.da.live` URL.
- **`content.da.live` URLs are NOT shortcuts to the responsive
  pipeline.** Even when you reference a DA-hosted image via its
  `content.da.live` URL, the preview re-fetches and re-hashes it into
  Media Bus. The delivered page references the Media Bus URL, not your
  `content.da.live` URL.
- **`<img>` inside Page Metadata works.** Putting an `<img>` in the
  Page Metadata `image` row sideloads the image and uses the Media Bus
  hash for the social-card `<meta>` tags. The hash is the content-hash;
  you can dedup an OG image with a body image by referencing the same
  URL.
- **For "do not touch" URLs, use a non-`<img>` slot.** If you have a CDN
  URL that must update in place or a tracking pixel that shouldn't be
  duplicated, place it in `<a href>` or a `data-*` attribute (e.g., via
  Section Metadata `Background`). It will be preserved as-authored in
  the delivered HTML.

---

## 3. Three media-storage patterns

DA officially documents three patterns for where media binaries can live.
[verified] from `aem.live/docs/media`. Each fits a different use case. The
choice has practical consequences for deduplication, branch-coupling, and
authoring UX.

| Pattern | Where binaries live | Reference URL | Use case |
|---|---|---|---|
| **AEM Assets DAM** | External Adobe Experience Manager DAM (AEMaaCS) | AEM-managed URLs | Curated/governed assets, requires AEMaaCS |
| **Drag-and-drop dot-folders** | `/{parent}/.{docname}/<file>` | `https://content.da.live/{org}/{repo}/{parent}/.{docname}/<file>` | Per-document author uploads via the DA editor |
| **`/media` shared folder** | `/media/<anything>/<file>` (any depth) | `https://content.da.live/{org}/{repo}/media/<anything>/<file>` | Shared across documents, branches, or iterations |

### 3.1 AEM Assets DAM

When the consuming org runs AEM as a Cloud Service (AEMaaCS) with a DAM, assets can live in the DAM rather than DA itself. The DA Source API does **not** write here — AEMaaCS has its own ingestion path (Assets HTTP API, Asset Sync, etc.). Documents reference DAM assets via their AEM-managed URLs.

Use when:

- The org already curates assets in a DAM.
- Asset governance (rights, versioning, metadata) matters.
- Assets need to be reusable across multiple Adobe products beyond DA.

Out of scope for orgs without AEMaaCS.

### 3.2 Drag-and-drop dot-folders (per-document)

DA's web editor at `da.live/edit#/{org}/{repo}/<path>` lets authors drag images directly into a document. The editor uploads to a dot-prefixed folder named after the document. The naming is mechanical:

```
URL pattern used by DA's editor:
  https://admin.da.live/source/{org}/{repo}/{parent}/.{docname}/<filename>
```

So for a document at `/marketing/launch.html`, an author drag-drop of `hero.png`
lands at `/marketing/.launch/hero.png`. The dot-prefix prevents the folder from
being treated as a sibling document. [verified] from `da-admin` source.

The document references the upload via an absolute `content.da.live` URL:

```html
<img src="https://content.da.live/{org}/{repo}/marketing/.launch/hero.png" alt="…">
```

**Important constraint:** relative paths (`./assets/hero.png`) resolve against
the editor URL (`da.live/edit#/…`) — which does not host content. Authors who
try to type a relative path will see broken images in the editor preview AND in
deployed pages. [verified]

Use when:

- An author uploads an image for a single document.
- The image is not expected to be reused elsewhere.
- Per-document isolation is desirable (renaming the document doesn't accidentally break shared references — but it does break the doc's own references).

Avoid when:

- The same image will be referenced from multiple documents (each document would get its own copy).
- Uploads are scripted / migration-driven (the editor workflow isn't applicable; the result has worse dedup behavior than `/media`).

### 3.3 `/media` shared folder

DA supports a top-level `/media` folder for assets that need to be reused across documents, branches, or migration iterations. Per the official DA docs:

> "Simply create a top-level folder called 'media' and upload your content into it."

Empirically: a direct PUT to `https://admin.da.live/source/{org}/{repo}/media/<file>`
auto-creates the `/media` folder if missing. Subfolders work too —
`/media/<arbitrary>/<more>/<file>` is fine, any depth. [verified]

The asset is served at `https://content.da.live/{org}/{repo}/media/<file>` with
no auth (for image content types) and is **branch-independent** — the same DA
path is reachable from any branch's `aem.page` host once that branch has been
previewed. [verified]

Use when:

- The asset is shared across multiple documents.
- The asset should survive document renames / moves.
- Migration scripts upload assets in bulk.
- Cross-branch / cross-iteration referencing matters.

This is the recommended pattern for any non-trivial volume of media.

---

## 4. The four upload paths

DA accepts media via four different mechanisms. Each has different ergonomics and different limits.

### 4.1 The DA Source API (HTTP PUT)

The canonical write endpoint for binaries. PUT to
`https://admin.da.live/source/{org}/{repo}/<path>` with a Bearer IMS token
and a `multipart/form-data` body containing a single field named **`data`**.
Other field names (`file`, `image`, `upload`) silently return 200 OK with no
file written. `[verified]` 2026-05-18.

See [platform.md §2](./platform.md) for the full request/response shape,
headers, response envelope, and the minimal Node example.

For binaries specifically: the path determines the storage pattern (§3),
the file extension determines the MIME type sniffed at delivery (§5.2),
and the file size must fit the per-type cap (§6.1).

### 4.2 The DA web editor

DA's editor UI at `https://da.live/edit#/{org}/{repo}/<path>` accepts drag-and-drop file uploads. Behind the scenes, the editor calls the Source API (§4.1) with a path constructed per §3.2.

The editor surface adds some UX behaviors:

- Drag-drop targets the document's dot-folder.
- The editor may refuse some file types (e.g., the UI commonly refuses `.webp` even though the Source API accepts it — see §5.4).
- Pasted media from the clipboard is uploaded the same way.
- The editor's "browse media" workflow lets an author find and copy an existing `/media`-folder URL into a document.

For programmatic uploads, prefer the Source API. The editor is for authors.

### 4.3 The `aem content` CLI (`@adobe/aem-cli`)

The CLI provides a git-style workflow for managing DA content as a local workspace:

```bash
npx -y @adobe/aem-cli content clone --path /<subpath>  # pull DA → ./content/
aem content add <files>                                # stage
aem content commit -m "..."                            # local commit
aem content push [--force]                             # upload to DA
aem content status / diff / merge                      # inspect / sync
```

Auth is browser-based on first run; the resulting token is cached at `.hlx/.da-token.json` (which should be gitignored).

**Critical limitation: `aem content push` does NOT reliably upload binary
files.** [verified] The command was designed for HTML content. It reports
success (`0 files pushed` or similar) but the binary often does not actually
land. Verify with `curl -sI <expected-url>`; if the upload didn't happen, fall
back to the Source API (§4.1) directly.

This is a known bug and may be fixed in future CLI versions. Until then, treat
the CLI as HTML-only and use the Source API for binaries.

### 4.4 The Admin API (preview + publish)

The Admin API is not an upload path for binaries — it's the lifecycle controller for content documents. After binaries are uploaded via the Source API, they're immediately available at `content.da.live`. But content **documents** (HTML files) require explicit preview/publish to appear on `aem.page` / `aem.live`:

```
POST https://admin.hlx.page/preview/{org}/{repo}/{branch}/{path}
POST https://admin.hlx.page/live/{org}/{repo}/{branch}/{path}
```

`{path}` matches the DA-stored content path without the `.html` extension; index documents can use a trailing `/`. `{branch}` matches the GitHub branch the EDS deploy is tied to.

Binaries do not need preview/publish — they're delivered directly from
`content.da.live` once uploaded. Only the documents that reference them need
the lifecycle calls. [verified] from EDS docs.

### 4.5 Auth token handling

All upload paths use the same IMS bearer token. Acquisition, expiry
handling, and the pre-flight check are documented in
[platform.md §3](./platform.md).

### 4.6 Retry policy

See [platform.md §4](./platform.md). DA Source endpoints are generally
robust; media-specific failures (413 payload too large, 415 unsupported
media) follow the same non-retry rule as other semantic 4xx.

---

## 5. Supported formats

DA accepts any file as a binary upload — the Source API does not police content type at upload. However, EDS only **delivers** a specific set of types through its server-side pipeline. Files outside this set need Code Bus delivery (which is git-tracked, not DA-tracked) or third-party hosting. [verified]

### 5.1 Supported content types (delivered by EDS)

| Type | Extensions | Delivery backend (§9) |
|---|---|---|
| Images: PNG | `.png` | Media Bus |
| Images: JPEG | `.jpg`, `.jpeg` | Media Bus |
| Images: AVIF | `.avif` | Media Bus |
| Images: WEBP | `.webp` | Media Bus |
| Images: GIF | `.gif` | Media Bus (no responsive variants) |
| Images: SVG | `.svg` | Content Bus |
| Video: MP4 | `.mp4` | Media Bus |
| Document: PDF | `.pdf` | Content Bus |
| Document: HTML (extensionless) | (no extension) | Content Bus |
| Document: JSON | `.json` | Content Bus |
| Favicon: ICO | `.ico` | Content Bus |
| Font: WOFF2 | `.woff2` | Content Bus |

Anything outside this list (text files, ZIP archives, MP3 audio, OTF/TTF fonts, AVI/MOV video, etc.) may upload successfully to DA Source but won't be delivered through `aem.page` / `aem.live`. Use Code Bus (git-tracked) or external hosting.

### 5.2 MIME type detection

EDS sniffs the content type at delivery time. The detected type must match the file extension — a WEBP renamed to `.png`, or a JPEG renamed to `.png`, will not deliver. [verified]

Set the correct `Content-Type` on the multipart upload:

```js
const MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.pdf':  'application/pdf',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};
function mimeOf(path) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}
```

If the source file is corrupted, has a wrong-extension copy, or is a transcoded variant with an incorrect header, validate before uploading: `file <path>` on macOS/Linux confirms the actual content type.

### 5.3 Image format choice

When you have a choice of upload format:

- **AVIF / WEBP** — smallest. EDS auto-generates both for PNG/JPG sources (see §9.2), so you usually don't need to upload these directly.
- **PNG** — best for graphics with sharp edges, transparency, limited color palettes. Lossless.
- **JPEG** — best for photographs and gradients. Lossy; trade-off file size vs. compression artifacts.
- **SVG** — best for vector illustrations, logos, icons. Hard 40 KB cap (§6).
- **GIF** — uploads, no responsive variants generated. Use only for legacy animated GIFs; prefer MP4 video.

For Media Bus formats (PNG, JPG, AVIF, WEBP), the pipeline generates responsive WebP + original-format variants at 750 px and 2000 px widths from any source. Upload the highest-quality source you have. Content Bus formats (SVG, PDF, ICO, WOFF2, JSON) and GIF are served at their original bytes — no variant generation. `[verified]`

### 5.4 WEBP upload — empirical note

The official DA docs ([aem.live/docs/media](https://www.aem.live/docs/media)) state that WEBP "is not supported for upload." This refers to the **DA editor UI**, which refuses WEBP drag-drop. [verified]

The **DA Source API accepts WEBP**. Direct PUT works; the asset is delivered correctly and gets responsive variants. Migration scripts using the Source API can upload WEBP without re-encoding. [verified]

Don't waste cycles re-encoding existing WEBP assets to PNG just because the docs say so. Test once and confirm the rendered `<picture>` is correct; if it is, ship as WEBP.

### 5.5 Font files

WOFF2 is the canonical format. [verified] Upload via the Source API to a path like `/fonts/<family>-<weight>.woff2`. Reference from CSS via the absolute `content.da.live` URL or via Code Bus (`/fonts/`).

Self-hosted fonts that aren't WOFF2 (OTF, TTF, WOFF) won't deliver through DA. [verified] Convert to WOFF2 first, or host externally.

---

## 6. Size limits

EDS enforces per-file and aggregate limits at the delivery layer. These are operational constraints — exceeding them produces 4xx responses or silent delivery failures.

### 6.1 Per-file caps

| Type | Max size | Notes |
|---|---|---|
| PNG, JPG, AVIF, WEBP | 20 MB | Per file |
| **SVG** | **40 KB** | Tight — complex illustrations often exceed |
| MP4 | 36 MB | Short clips only; long-form needs a streaming CDN or AEMaaCS |
| PDF | 20 MB | |
| Favicon (`.ico`) | 16 KB | |
| WOFF2 | (Per file practical limit) | Default font subsets are typically well under 1 MB |

Source: [aem.live/docs/limits](https://www.aem.live/docs/limits). [verified]

**SVG 40 KB is the constraint that bites most.** Hand-authored multi-shape illustrations, especially those with embedded `<filter>` definitions, multi-stop gradients, or dozens of `<path>` shapes, frequently exceed 40 KB.

**Failure mode is loud, not silent.** When a DA document references an
over-cap SVG via `<img>`, the preview POST to
`admin.hlx.page/preview/...` returns `409 AEM_BACKEND_FETCH_FAILED`
with a body like `Images N have failed validation`. The document is
not previewed at all — not "partially rendered with broken images".
`[verified]` empirically (Snowflake migration, 2026-05-19, on SVGs
of 45 KB, 76 KB, 251 KB, etc.).

Mitigations:

1. **Pre-flight check.** During HTML generation, HEAD each SVG URL
   referenced from `<img>` and verify `content-length < 40000`.
2. Optimize with [SVGO](https://github.com/svg/svgo) — aggressive `removeViewBox=false`, `mergePaths`, `removeUnknownsAndDefaults`.
3. Simplify path coordinates (reduce precision to 1–2 decimal places).
4. Replace embedded raster `<image>` elements (which inflate SVG size dramatically) with a separate raster file referenced by URL.
5. Rasterize the SVG to PNG/AVIF if the SVG is fundamentally illustrative rather than icon-shaped.

**Asymmetry to be aware of.** The 40 KB cap applies to SVGs the
preview ingester fetches (i.e., images in DA `<img>` slots). SVGs
served directly from Code Bus (`/icons/`, `/blocks/.../*.svg`) or
referenced from authored HTML that doesn't go through preview
ingestion have no such cap — the browser fetches them directly.

### 6.2 Image dimensions

EDS will not upscale beyond source dimensions. A 500 px source stays at most 500 px in any delivered variant — the responsive `srcset` will request larger widths, but the pipeline returns the source-resolution image. [verified]

- **Recommended max source dimension:** 2000 × 2000 px.
- **Practical minimum:** the largest display size you need. For a hero that renders at 1200 px wide on desktop with 2× retina, upload at least 2400 px wide.
- **Image format choice doesn't affect dimensions** — PNG/JPG/AVIF/WEBP all support 2000 × 2000 sources.

### 6.3 Aggregate / system limits

| Limit | Value |
|---|---|
| Pages per site | 1,000,000 |
| Files per Code Bus reference | 500 |
| Response payload (compressed) | 6 MB |
| Rate limit | 200 requests/sec per IP per hostname |

Source: aem.live/docs/limits. [verified]

For DA Source uploads specifically, the rate limit applies — high-concurrency upload scripts (>200 concurrent PUTs from a single IP) will see 429s and need backoff (§4.6).

---

## 7. Folder structure conventions

DA paths are arbitrary, but a few conventions make life easier.

### 7.1 The `/media` top-level folder

The single most useful convention. Use `/media/...` for binaries that aren't tied to one specific document. Examples:

```
/media/logo.svg                            # site-wide logo
/media/hero-banner.png                     # shared hero image
/media/<scope>/<file>                      # scoped subfolder per site, product line, etc.
/media/<scope>/<page>/<file>               # per-page scope when needed
/media/shared/<file>                       # cross-scope shared assets
```

Any depth is allowed. The folders auto-create on first PUT. [verified]

The convention `/media/<scope>/<file>` (one level of scoping) hits a sweet spot for medium-sized projects:

- Avoids root pollution (`/media/everything.png` × 10,000 isn't browseable).
- Avoids over-namespacing (`/media/<scope>/<page>/<module>/<file>` is verbose and makes truly shared assets awkward).
- Preserves provenance — you can tell from a URL where an asset came from.

### 7.2 Dot-folders (`/{parent}/.{docname}/`)

Reserved for the DA editor's drag-drop workflow (§3.2). Don't put scripted uploads here unless you specifically want per-document isolation.

A dot-folder for a document at `/blog/2024/launch.html` is `/blog/2024/.launch/`. The dot-prefix prevents collision with a sibling document of the same base name. [verified]

### 7.3 Document paths

Document paths are the same `/path/to/<name>` model, but the document file has no extension at the delivery layer:

- DA-stored: `/<path>/<name>.html` (extension is part of the storage path)
- Delivered: `https://{branch}--{repo}--{owner}.aem.page/<path>/<name>` (no extension)

[verified]

For index pages, the convention is a file at `/path/index.html` delivered at `/path/`.

### 7.4 Code Bus paths (not DA, but adjacent)

The deploying GitHub branch carries Code Bus assets — typically `/fonts/`, `/icons/`, `/blocks/`, `/scripts/`, `/styles/`, and `/head.html`. These are referenced via the same `aem.page` host as documents, but the bytes come from git, not from DA Source.

Code Bus and Content Bus serve different things:

- **Code Bus** — git-tracked files. Block JS, CSS, fonts, icons, configuration. Updated by code deploy.
- **Content Bus** — DA-tracked path-addressed content. SVGs uploaded to `/media`, PDFs, JSON, HTML documents. Updated by preview/publish.

[verified]

The two coexist on the same delivery host. A request to `/foo.svg` is served by whichever bus has it; conflict-resolution generally favors Content Bus for paths under `/media/`.

---

## 8. Path constraints

See [platform.md §5](./platform.md). The constraints apply equally to
content and binary paths.

---

## 9. Delivery model

Once a binary lives in DA Source, the EDS rendering pipeline serves it through one of two backends with very different behaviors. Understanding which backend serves which file types is critical for cache invalidation.

### 9.1 Media Bus vs Content Bus

| | Media Bus | Content Bus |
|---|---|---|
| **Used for** | PNG, JPG, AVIF, WEBP, MP4 | SVG, PDF, HTML, JSON, ICO, WOFF2 |
| **Naming** | Content-addressed (`media_<sha-256>.<ext>`) | Path-addressed (`/media/foo.svg`) |
| **Dedup** | Yes — one binary per content hash, regardless of how many docs reference it | No — every path is its own resource |
| **Cache** | Permanent (until content hash changes) | Follows preview/publish lifecycle |
| **Delivery** | Request `/path/foo.png` returns a 301 redirect to `/path/media_<sha>.png` | Direct path serves the file |

Practical consequences:

- **Replacing a PNG/JPG/AVIF/WEBP/MP4** generates a new content hash → every referencing document needs re-preview to pick up the new URL. The OLD path still resolves to the OLD hash via cached redirects. [verified]
- **Replacing an SVG/PDF/HTML/JSON** keeps the same path; the next preview/publish picks up the change.
- **Cross-branch sharing** — the same source `/media/<file>` deduplicates to ONE Media Bus entry across `main`, feature branches, and iterations. Same `media_<sha>.png` URL appears on every branch. [verified]

### 9.2 The `<picture>` transformation

When an HTML document references an image via a single `<img src="…">`,
the delivered HTML has a responsive `<picture>` element instead. This is
the **visible artifact of preview-time sideloading** — the URL inside
the `<picture>` is the Media Bus content-hash URL produced when the
preview ingested the original `<img>` src. See §2 (Asset lifecycle) for
the full flow.

```html
<!-- Authored in DA (any reachable image URL works) -->
<img src="https://content.da.live/{org}/{repo}/media/hero.png" alt="Hero">

<!-- Delivered by aem.page (URL is the Media Bus hash, regardless of input URL form) -->
<picture>
  <source type="image/webp" srcset="./media_<hash>.png?width=2000&format=webply&optimize=medium"
          media="(min-width: 600px)">
  <source type="image/webp" srcset="./media_<hash>.png?width=750&format=webply&optimize=medium">
  <source type="image/png"  srcset="./media_<hash>.png?width=2000&format=png&optimize=medium"
          media="(min-width: 600px)">
  <img loading="lazy" alt="Hero"
       src="./media_<hash>.png?width=750&format=png&optimize=medium"
       width="1512" height="852">
</picture>
```

What the transformation does:

- Generates 750 px (mobile) + 2000 px (desktop) variants.
- Generates WEBP variants alongside the source format.
- Adds `loading="lazy"` and computed `width`/`height` attributes to the
  fallback `<img>`.
- Preserves the authored `alt` attribute. Other authored attributes
  (`width`, `height`, `decoding`) are computed by the pipeline.

[verified] from `helix-html-pipeline/src/steps/create-pictures.js` and
direct observation of `aem.page` output.

The transformation only fires for images that ended up with a
`./media_<hash>` URL after preview — which is **almost every URL form**
the preview can successfully fetch (see §2.3 for the full table). The
delivery pipeline does NOT fetch images itself; if a URL didn't get a
Media Bus hash at preview, it stays as the original URL with only
`loading="lazy"` added — and you get no responsive variants.

### 9.3 URL forms that work — and the ones that produce `about:error`

The full URL-form behavior table is in §2.3 (Asset lifecycle). The short
version for HTML authors:

**Will be sideloaded into Media Bus → responsive `<picture>`:**

- `https://content.da.live/{org}/{repo}/<path>` — DA Content Bus URL.
  The preview re-fetches and content-hashes; the delivered URL is
  Media Bus, not `content.da.live`. `[verified]`
- `https://{branch}--{repo}--{owner}.aem.page/<path>/media_<hash>.<ext>` —
  recognized as already in Media Bus; preview just records the hash.
  `[verified]`
- `https://{branch}--{repo}--{owner}.aem.page/<code-bus-path>` — a file
  committed to the GitHub branch under a Code Bus path (e.g.,
  `/assets/`, `/icons/`). Preview can fetch it, content-hash, and
  store. Branch-locked because the source URL embeds the branch.
  `[assumed]`
- External URLs (`https://picsum.photos/...`, `https://example.com/foo.png`,
  any reachable image URL) — fetched, hashed, stored. **No DA pre-upload
  required.** `[verified]`

**Will produce `<img src="about:error">`:**

- Repo-relative paths (`/path/foo.png` without a host).
- Document-relative paths (`./foo.png`, `../foo.png`).
- `https://{branch}--{repo}--{owner}.aem.page/<path>.png` when the path
  is not in Code Bus (git) and not in Media Bus — aem.page returns 404,
  preview treats it as a failed fetch. `[verified]`
- `https://content.da.live/{other-org}/{other-repo}/<path>` (cross-tenant
  references generally don't resolve). `[verified]`
- External URLs that DNS-fail, return 4xx/5xx, or return non-image
  content-types. `[verified]`

This is the single most common silent failure when generating HTML
programmatically. See [html-content.md §9 (Images in HTML)](./html-content.md)
for the HTML-side rule that prevents it.

### 9.4 Cache invalidation

The DA delivery surface caches aggressively. After uploading or replacing a file:

- **Binary in Media Bus** (PNG/JPG/AVIF/WEBP/MP4): the new file gets a new hash. To make documents pick up the new hash, re-preview each referencing document. [verified]
- **Binary in Content Bus** (SVG/PDF/JSON/ICO/WOFF2): the path is stable. Trigger a preview if the file is referenced by a document that was previously rendered; otherwise the next request fetches the new version after Content Bus cache lifecycle. [verified]
- **HTML document**: preview → `aem.page`; publish → `aem.live`. Documents are not implicitly re-rendered when their referenced binaries change.

A common gotcha: replacing a PNG and re-uploading does NOT update referencing docs. You uploaded `hero.png` → it gets `media_<sha-A>.png`. Six months later, you upload a new `hero.png` → it gets `media_<sha-B>.png`. Documents that reference `https://content.da.live/.../media/hero.png` still resolve via redirect to `media_<sha-A>.png` until they're re-previewed.

### 9.5 Direct `content.da.live` URLs vs `aem.page` URLs

In authored HTML, either host works in `<img src>`. The preview re-fetches
either form into Media Bus, so the delivered URL is the Media Bus hash —
not the URL you authored. The choice is about authoring ergonomics and
update behavior:

- **`content.da.live/{org}/{repo}/<path>`** — preferred for shared assets.
  Branch-independent. The preview re-fetches whatever bytes are at that
  path at preview time, so re-uploading the binary at the same path and
  re-previewing referencing documents picks up the new bytes.
- **`{branch}--{repo}--{owner}.aem.page/<path>/media_<hash>.<ext>`** — only
  use for explicit cross-branch references to an already-hashed asset.
  Branch-locked; the URL embeds the hash so it's immutable. Skipped by
  preview (recognized as already in Media Bus).
- **External URLs** — fine for source images that genuinely live
  elsewhere. The preview copies them on first fetch. If you want stability
  against the external host changing or going away, upload the bytes to
  DA under `/media/` and reference the `content.da.live` URL instead.

For author-authored documents, prefer `content.da.live` URLs. They're
branch-independent and the preview will always re-fetch them.

---

## 10. Authoring — how HTML documents reference media

A DA document references uploaded media via standard HTML `<img>`,
`<source>`, `<video>`, `<a>`, and `<link>` tags. The `src=` / `href=`
attributes hold full URLs (per §9.3 — never repo-relative or
document-relative).

The HTML-side rules — exactly which tags to use, where they go in the doc
skeleton, and how they interact with sections and blocks — are documented
in [html-content.md §9 (Images in HTML)](./html-content.md). This section
covers the media-side: which URL host to point at, and what the pipeline
does with the reference at delivery.

### 10.1 Static `<img>` references

```html
<p>Welcome to our product launch.</p>
<img src="https://content.da.live/myorg/myrepo/media/launch/hero.png"
     alt="Product launch hero" width="2000" height="1000">
<p>Read on for the details…</p>
```

When rendered by EDS, the `<img>` becomes a responsive `<picture>` (§9.2). The author authors a single `<img>`; the deployed page has the full responsive variants.

### 10.2 `<picture>` with explicit `<source>` overrides

You can author a `<picture>` directly if you want to override the pipeline's auto-generated variants:

```html
<picture>
  <source media="(min-width: 1000px)"
          srcset="https://content.da.live/myorg/myrepo/media/hero-desktop.png">
  <img src="https://content.da.live/myorg/myrepo/media/hero-mobile.png"
       alt="Hero">
</picture>
```

The pipeline preserves the authored `<source>` elements and adds its own as fallbacks. Use sparingly — the pipeline's defaults are usually fine.

### 10.3 Video references

```html
<video controls>
  <source src="https://content.da.live/myorg/myrepo/media/demo.mp4"
          type="video/mp4">
</video>
```

MP4 follows the same Media Bus delivery as images — content-addressed, with cache implications for replacement.

### 10.4 PDF, JSON, font links

```html
<a href="https://content.da.live/myorg/myrepo/media/spec.pdf">Download spec</a>
```

```html
<link rel="stylesheet" href="https://content.da.live/myorg/myrepo/fonts/font-face.css">
```

PDFs and other Content Bus assets just need a link. The author types or pastes the URL; the deployed page references it directly.

---

## 11. Common operational gotchas

### 11.1 `aem content push` silently no-ops on binaries

`aem content push` will report success but not actually upload binary files. See §4.3. Use the Source API directly for any binary (image, video, PDF, font).

### 11.2 Token expires silently with 401-empty-body

The IMS token expires at the `expires_at` timestamp; subsequent PUTs return 401 with an empty body. See §4.5. Always pre-flight expiry before a long upload run.

### 11.3 Field name MUST be `data`

Multipart form uploads to the Source API must use field name `data`. Other names (`file`, `image`, `upload`) silently fail — the API returns 200 OK with no file written. See §4.1.

### 11.4 Extension renaming breaks delivery

EDS sniffs content type. A WEBP renamed to `.png` will not deliver. Use the correct extension at upload time, derived from actual content.

### 11.5 SVG 40 KB ceiling is real

Complex illustrations exceed 40 KB easily. See §6.1 for mitigations. Don't ship over-cap SVGs and hope they work; they will fail at delivery.

### 11.6 PNG/JPG replacement requires re-preview

Replacing a Media Bus asset doesn't update referencing documents — they still resolve to the old content hash via cached redirects. Re-preview every referencing document after replacing a PNG/JPG/AVIF/WEBP/MP4. See §9.4.

### 11.7 Repo-relative and document-relative paths render as `about:error`

The preview ingester needs a full URL it can fetch. Repo-relative
(`/path/foo.png`), document-relative (`./foo.png`), and any other
host-less form produce `<img src="about:error">` in the delivered HTML.
External URLs work fine — the preview will sideload them. See §9.3.

### 11.8 The DA editor refuses some formats the API accepts

The editor UI may refuse WEBP drag-drop; the Source API accepts WEBP fine (§5.4). Don't conclude a format is "unsupported" from editor behavior alone — test with a direct PUT.

### 11.9 Per-document dot-folders duplicate shared assets

The DA editor's drag-drop creates a per-document copy. The same image used on five documents becomes five binaries with five URLs. For shared assets, use `/media` (§3.3).

### 11.10 Path constraints aren't enforced at upload time

DA Source will accept a PUT to `/Media/Hero Image.PNG`, but the resulting path may not be canonically reachable. Validate paths against §8 rules before uploading.

### 11.11 External `<img>` URLs are silently copied into Media Bus

This is intended behavior (see §2), but it surprises authors who expect
a third-party URL to remain a third-party URL. Every reachable
`<img src>` URL gets fetched at preview, content-hashed, and stored in
Media Bus. The delivered page references the Media Bus URL, not the
original. Implication: if the source host's terms forbid copying (rare
for images on the open web, common for licensed stock), use a non-`<img>`
slot (`<a href>`, `data-*`, plain text) instead — those are preserved
as-authored.

### 11.12 Preview fetch failures are silent

If a `<img src>` URL fails to fetch (DNS, timeout > 5s, 4xx/5xx, non-image
content-type), the delivered HTML has `<img src="about:error">` with no
error indication in the preview API response. Always inspect the
rendered `aem.page` HTML for `about:error` after a preview, especially
when migrating content from another CMS where external URLs might be
gated or short-lived. See §2.3.

### 11.13 Hash is over response bytes, not URL string

Media Bus is content-addressed: the hash comes from the response body.
Same URL referenced twice → fetched once, same hash. `[verified]` Two
different URLs returning identical bytes → also expected to dedup to
one Media Bus entry. `[assumed]` Same URL serving different bytes on
different previews (CDN cache flap, dynamic image generator like
`picsum.photos`) → different hashes; the document keeps whichever hash
it captured at its last preview. `[verified]` empirically. Re-preview
to refresh.

---

## 12. URL reference card

See [platform.md §9](./platform.md) for the canonical URL reference. The
patterns relevant to media are the `content.da.live` delivery URLs (§3),
`admin.da.live/source` for upload (§4.1), and `aem.page`/`aem.live` for
rendered output.

---

## 13. Decision tree: how should I reference this asset?

Two decisions, in order: **what URL form to write in the HTML**, then
(if needed) **where to upload the binary first**.

### 13.1 What URL to write in `<img src>` / `<source srcset>`

```
Is the image already hosted somewhere reachable from EDS?
│
├── YES → Reference it directly. Preview sideloads on first run.
│         │
│         ├── Hosted in DA at /media/?
│         │   → https://content.da.live/{org}/{repo}/media/<file>     (preferred — stable, branch-independent)
│         │
│         ├── Hosted in DA at /<parent>/.<docname>/?
│         │   → https://content.da.live/{org}/{repo}/<parent>/.<docname>/<file>     (per-document, editor-style)
│         │
│         ├── On a third-party CDN you trust?
│         │   → https://cdn.example.com/<path>     (sideloaded on first preview — bytes copied to Media Bus)
│         │
│         └── Already in Media Bus on this tenant?
│             → https://{branch}--{repo}--{owner}.aem.page/<path>/media_<hash>.<ext>     (no re-fetch)
│
└── NO  → Upload it to DA first (see §13.2), then reference via content.da.live.
```

**Avoid:**

- Repo-relative paths (`/path/foo.png`) → produce `about:error`.
- Document-relative paths (`./foo.png`) → produce `about:error`.
- Cross-tenant `content.da.live/{other-org}/...` paths → fetch 404 → `about:error`.
- `*.aem.page/<path>.png` when `<path>` isn't a `media_*` path AND isn't
  in Code Bus → fetch 404 → `about:error`.

### 13.2 Where to upload the binary first (only when you need to upload)

```
Is this binary referenced from authored content (HTML documents in DA)?
│
├── YES → It belongs in DA.
│         │
│         ├── Is it shared across multiple documents / branches?
│         │   → /media/<scope>/<file>     (recommended for migration scripts, shared assets)
│         │
│         ├── Is it specific to one document, uploaded by an author via the editor?
│         │   → /{parent}/.{docname}/<file>     (DA editor handles this automatically)
│         │
│         └── Is it governed by an external DAM (AEMaaCS)?
│             → AEM Assets DAM       (use AEMaaCS Assets API; out of DA scope)
│
└── NO  → It belongs in Code Bus (git-tracked).
          │
          ├── A font file?       → /fonts/<file>.woff2
          ├── An icon set?       → /icons/<file>.svg
          ├── A block asset?     → /blocks/<block>/<file>
          └── Site config?       → /head.html, /styles/, /scripts/
```

### 13.3 When you genuinely don't want sideloading

Two cases where you want the URL to stay external and the responsive
`<picture>` transformation NOT to fire:

- **Signed CDN URLs with short-lived access** — sideloading copies the
  bytes to Media Bus, where they're served indefinitely. If your CDN
  required the signed URL for access-control reasons, that bypass may be
  unacceptable.
- **Pixels / tracking URLs / images that must always re-fetch from
  source** — sideloading caches once.

Workaround: place the URL in `<a href>`, a `data-*` attribute, or
plain text — anywhere other than `<img src>` / `<source srcset>`. Those
slots are preserved as-authored. Trade-off: you lose the `<picture>`
transformation entirely. (See §2.2.)
