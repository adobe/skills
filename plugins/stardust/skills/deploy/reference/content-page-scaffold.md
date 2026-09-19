# Step 9 — Content page scaffold (full text)

Full text of deploy Step 9. Read:
- § 9. Content page scaffold — before emitting any content page: the `metadata` block (#34), the DA body-fragment shape (#7), per-page chrome rows;
- § Multi-view SPA → multiple pages — when a prototype has several views with different chrome (#29);
- § Image src hosts — before authoring any real image (`content.da.live` vs fixed `/img/` assets, #67).

## 9. Content page scaffold

**Every content page MUST begin with a `metadata` block (#34).** At minimum it carries a **Title** (~50–60 chars: brand + primary keyword/location, derived from the page's real `<h1>` — NEVER a block or section name) and a **Description** (~150–160 chars summarising the page). Skip it and EDS derives `<title>` from the first content cell — junk like `<title>Hero</title>` / `<title>Quiz</title>` — and emits no description; and because EDS **mirrors Title/Description into `og:`/`twitter:`**, that junk poisons social/AI share cards too. Authoring this one block resolves title, description, og:title, og:description, twitter:title and twitter:description at once. `nav` / `footer` path overrides / `Robots` rows go in the same block when needed (the pipeline extracts the block wherever it sits in `<main>` — first or last). The `header`/`footer` blocks load `/nav` and `/footer` automatically; no other per-page configuration is required.

**The content page is a DA *body fragment* (#7).** The DA Source API (the headless deploy path) requires the document to start at `<body>` — **no `<!DOCTYPE>`, no `<html>`, no `<head>`** (the pipeline injects head/scripts/styles from Code Bus). Emit exactly:

```html
<body>
  <header></header>
  <main>
    <div>
      <div class="metadata">
        <div><div>Title</div><div>Brand — primary keyword / location (≤60 chars, from the &lt;h1&gt;)</div></div>
        <div><div>Description</div><div>A 150–160 character summary of the page.</div></div>
      </div>
    </div>
    <div>
      <div class="hero">
        <div><div><h1>The page's lead headline</h1></div></div>
        <div><div>body copy</div></div>
        <div><div><strong><a href="/path">Primary CTA</a></strong> <em><a href="/path">Secondary CTA</a></em></div></div>
      </div>
    </div>
    <div>
      <!-- next section: its title decorates to <h2> -->
    </div>
  </main>
  <footer></footer>
</body>
```

(Only the **mount-based** deploy tolerates a full `<!DOCTYPE html><html>…</html>` document — it strips `<head>` on ingestion. For the Source-API/`curl` path, emit the body fragment above. Before any DA write, run `node skills/deploy/scripts/sanitise.js <file>` to encode non-ASCII — `® · – —`, accents, emoji — to HTML entities, or DA corrupts them to U+FFFD.)

To give a specific page different chrome, add `nav` and/or `footer` path rows to that same `metadata` block (the `header`/`footer` blocks read them — Step 6):

```html
    <div>
      <div class="metadata">
        <div><div>nav</div><div>/nav-minimal</div></div>
      </div>
    </div>
```

## Multi-view SPA → multiple pages (#29)

**Multi-view SPA → multiple pages (#29).** If the prototype is a single-page app with several views that have **different chrome** (e.g. a marketing home with a full nav vs. a signed-in dashboard with a minimal bar), convert **each view to its own EDS page** (pre-render each per #27) and link them with real hrefs. Under vanilla EDS this is trivial: author a second nav document (`content/nav-app.html`) and point the dashboard pages at it with `nav: /nav-app` metadata — one header block, two authored navs. Share `/footer` if the footer is the same. (Harness caveat: the `metadata` block is consumed by the delivery pipeline into a `<head>` `<meta>`, but the local harness has no pipeline — so the `nav` override won't apply locally; verify per-page chrome on the deployed preview.)

**Do NOT emit a `<head>` element.** EDS content pages are markdown-equivalent fragments: the document metadata (title, meta, stylesheets, scripts) lives in the project's `head.html`, which EDS injects at delivery time. A `<head>` block in a content page is dead weight at best and a duplication conflict at worst.

## Image src hosts

When the prototype has **real** images, AUTHORED content `<img src>` URLs must point at a host the preview ingester can fetch — **prefer `https://content.da.live/{org}/{repo}/media/<scope>/<file>`** (branch-independent; upload the binary via the Source API first — see **The ENCODE contract → Images**). A fully-qualified `https://main--<repo>--<owner>.aem.page/…` also ingests but is branch-locked. **NEVER** a repo-relative `/img/…` in authored content — it delivers as `<img src="about:error">`. **This applies ONLY to authored content `<img>` — NOT to fixed assets referenced as CSS backgrounds from block JS/CSS (#67): those stay root-relative `/img/<brand>/…` (anti-pattern 9b), browser-fetched and never ingested.** When the prototype uses **`<image-slot>` placeholders** (no real assets — common for claude-design prototypes), leave the image cells EMPTY (`<div></div>`); the block CSS background fallback (Step 7) renders the section correctly without an image. The author drops real images in later.
