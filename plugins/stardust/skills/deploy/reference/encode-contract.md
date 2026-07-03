# ENCODE contract — deep dive (section heads, images, buttons)

Companion to SKILL.md § The ENCODE contract and § Step 5. The contract rules are inline in
SKILL.md; this file carries the mechanics: section-head reabsorption, the image
upload/verification/repair procedures, and the worked button-system CSS.

## Section heads: default content the block reabsorbs (zero pixel change)

A head-bearing block (one with a section eyebrow/heading/lede above repeating units) should
NOT carry that head as block rows. Author the head as **default content** in the section,
before the block; the block table holds only the repeating units. Then the block
**reabsorbs** the head so the decorated DOM — and every pixel — is identical to the old
in-table form:

- On `decorate(block)`, read the section's leading default-content wrapper, build the SAME
  `.section-head` the block used to build from its first rows, and **remove the wrapper**.
  Result: identical decorated DOM; CSS untouched.
- **The head wrapper is a sibling of the block's SECTION-LEVEL wrapper, not of the block, and
  its class varies by runtime.** Use
  `block.closest('.block-content')?.previousElementSibling` and match BOTH `.default-content`
  (AuthorKit runtime) **and** `.default-content-wrapper` (vanilla EDS).
  `block.previousElementSibling` alone is `null` (the block is nested in `.block-content`).
- Keep the old in-table head (leading non-unit rows) as a **back-compat fallback**.
- **Verify zero change:** diff the *decorated* block `outerHTML` (ids/`media_<hash>`
  normalised) old-vs-new — it must be byte-identical, with 0 default-content wrappers left
  after decorate.

A FOUC is possible (head paints as default content, then reabsorbs); the final layout is
identical — watch CLS only if default-content margins differ markedly from the head's.

This is NOT for a genuine widget whose rows ARE its structure (e.g. countdown) — those keep
their rows.

## #86 — Key facts must be server-rendered (rationale)

The static header/footer fragments are client-injected (`postlcp.js` `innerHTML` after first
paint), so anything that exists only there — a trust fact line ("Open source · Apache 2.0 ·
built by X"), pricing, contact facts — is INVISIBLE to non-rendering crawlers and AI bots on
every page. If a fact matters for SEO/LLM answerability, author it in page content (a fact
panel, an install-section sentence, the metadata description); the fragment copy is
presentation, not the crawlable source of truth. Verify by grepping the RAW served HTML (no
JS) for the key-facts list — the rendered DOM check passes either way and hides the failure.

## Images: editorial → authored content, decorative → CSS only

**Any raster/brand image that carries meaning is EDITORIAL and must be authorable content** —
including hero / feature / CTA-band backgrounds that sit *behind* text and a scrim (the
author swaps them per campaign; they're the page's most important visual). For editorial
images:

1. Upload the binary to DA: `PUT https://admin.da.live/source/{org}/{repo}/media/<scope>/<file>`
   (multipart, field name **`data`**, correct `Content-Type`; upload the JPG/PNG/webp source
   only — the pipeline generates responsive variants).
2. Author a single `<img src="https://content.da.live/{org}/{repo}/media/<scope>/<file>"
   alt="…">` in the cell (branch-independent; the pipeline emits the responsive `<picture>`).
   **Never** a repo-relative `/img/…` in content (→ `<img src="about:error">`). **Never** bake
   imagery into block JS by index (`CARD_IMAGES`/`LOGOS`) — that isn't authorable.
3. The block renders the authored `<img>` into a background LAYER (`.hero-bg` / `.card-media`
   / `.text-media`); the scrim/gradient is a CSS `::before` OVER it. Keep a fixed CSS asset as
   the no-image fallback.

**Decorative = CSS only** applies to image-LESS treatments (gradients, scrims, textures,
solid washes) and to genuinely fixed brand assets referenced as **CSS backgrounds**
root-relative (`/img/<brand>/…` — browser-fetched, never ingested, so no `about:error` and no
upload).

**The check that catches the #1 mistake:** after preview, grep the delivered `.plain.html`
for the expected `<img>`+alt count. "It renders" hides CSS-background images — they're absent
from `.plain.html`, carry no alt, and are neither authorable nor AI/SEO-visible.

### Source/external image URLs (migration): verify BEFORE authoring

Re-using an image straight off the source page is the most common way to ship
`<img src="about:error">`: the preview ingester fetches the authored URL, and if that fetch
fails the delivered image is `about:error` — silent, since the page still renders. So verify
every authored `<img>` whose src points at the source/CDN — **but the verification fetch must
match how extract reached the origin, and a failure is not automatically "omit".**

**Verify with the recorded fetch technique, not a bare curl (#2 — bot-managed origins).** A
large fraction of real migration targets sit behind Akamai / Cloudflare / Imperva / F5, which
403 a plain `curl` (and headless requests) while serving the same asset fine to a real
browser. A blanket "curl it; if not 200, omit" therefore **strips every real brand image**
off an entire bot-walled site — the exact failure the quality bar forbids. Instead: read
`_crawl-log.json#discovery.fetchTechnique`. When it is `headed-chrome`, verify image URLs
with an **in-page fetch from the open browser context**
(`page.evaluate(async u => (await fetch(u)).status, url)`) — that inherits the JA3/H2
fingerprint and cookies (per `extract/reference/playwright-recipe.md` § Bot-management →
Sub-resource fetches); a bare `curl`/`request` will falsely report the asset broken. Only
when `fetchTechnique` is plain may a bare
`curl -s -o /dev/null -w '%{http_code}' <url>` stand in.

**Distinguish 403-bot-wall from 404-missing, and prefer rehost over omit.** A `403`/`401`
from a CDN means *blocked-when-hotlinked*, NOT *missing* — and even if the URL would 200 to
the ingester now, hotlinking the source CDN from the delivery host is fragile (it can 403
cross-origin at preview time, yielding `about:error`). So the default remediation for a
`403`/blocked captured image is **download-and-rehost**, not omit: extract already saved a
local copy under `stardust/current/assets/media/` via the in-page fetch — upload it to DA
(`PUT …/source/{org}/{repo}/media/<scope>/<file>`) and author the `content.da.live` URL.
**Omit only on a true `404` (asset genuinely gone) after attempting the rendition/delimiter
repairs below** — and never substitute a generic logo/placeholder (`…-logo…`) as if it were
editorial. Two real failure signatures where the asset exists — fix the URL, don't drop it:
1. **wrong rendition variant** — the page exposes only a derivative that 404s while a sibling
   resolves (e.g. a portrait's `…/4x3/768/…` 404 vs `…/original/768/…` 200) → rewrite to the
   resolver;
2. **missing query delimiter** — `…/<id>&wid=600&hei=…` with no `?` makes `<id>&wid=…` a
   bogus id → 403 → repair the first `&` after the id to `?`.

**`content.da.live` media URLs are auth-gated — don't anon-curl them.** Once you've rehosted
to DA, the recommended `https://content.da.live/{org}/{repo}/media/…` src returns **`401` to
an anonymous `curl`** even though it is correct and the preview pipeline ingests it fine. Do
not treat that `401` as "broken" and omit. The correct verification for an already-rehosted/
DA-hosted image is **post-preview**: grep the delivered `.plain.html` for `about:error` (must
be 0) and assert the expected `<img>`/alt count — see `da-deploy-protocol.md` step 3b. Exempt
`content.da.live` (and `admin.da.live`) URLs from the pre-author 200-check entirely.

## Buttons — worked global button system (Step 5)

Add to `styles/styles.css` (adapt tokens to the project's brand):

```css
a.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 26px;
  font-size: 12px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid transparent;
  transition: background 0.25s var(--ease-out), color 0.25s var(--ease-out), border-color 0.25s var(--ease-out);
}

a.btn-primary { background: var(--color-wavelength); color: var(--color-ink-rich); border-color: var(--color-wavelength); }
a.btn-primary:hover { background: var(--color-canvas); border-color: var(--color-canvas); }

a.btn-secondary { background: transparent; color: currentcolor; border-color: rgb(255 255 255 / 40%); }
a.btn-secondary:hover { border-color: currentcolor; background: rgb(255 255 255 / 5%); }

/* On light surfaces, secondary uses dark-tinted outline. List the dark sections explicitly. */
main .section:not(.dark, .closing, .hero, .team) a.btn-secondary { border-color: var(--color-rule-strong); color: var(--color-ink-rich); }
main .section:not(.dark, .closing, .hero, .team) a.btn-secondary:hover { border-color: var(--color-ink-rich); }

/* Trailing arrow on primary/accent. */
a.btn-primary::after, a.btn-accent::after { content: "→"; font-weight: 600; transition: transform 0.3s var(--ease-out); }
a.btn-primary:hover::after, a.btn-accent:hover::after { transform: translateX(4px); }

.btn-group { display: inline-flex; flex-wrap: wrap; gap: 16px; align-items: center; }
```

### #41 — Surface-aware variants: scope to the BLOCK class, not just the section

When a button/link/text treatment differs on dark vs light surfaces, the prototype's
dark-surface cue (e.g. `.hero`, `.cta-dark`) becomes a **block class** after conversion — a
`<div class="hero">` nested inside the `<div class="section">`. So an override written as
`main .section.hero a.btn-secondary` never matches (the `.hero` is one level below
`.section`), and the on-dark CTA silently renders dark-on-dark. Scope on-dark overrides to
BOTH: `main .section.dark a.btn-secondary, main .hero a.btn-secondary { … }`. QA any block on
a dark background for secondary/ghost-CTA contrast (light outline + light text) — the button
"exists" in metrics, so only contrast/eyeball catches this.

### Per-block overrides: only what's actually different

The `closing` block's CTA is slightly larger than the global default — a legitimate override:

```css
.closing .actions a.btn-primary { padding: 22px 32px; font-size: 13px; }
```

Three lines. Targets the global class, not a custom one. This is the entire "blocks slightly
augment defaults" pattern.

### When NOT to use the convention — examples

Some links are NOT buttons:
- A wavelength-underlined text link in a section footer ("How we work →"). It's a styled text
  link, not a chip.
- Whole-card anchors on tile grids (`<a class="tile">…</a>`). The whole tile is the click
  target.
- Channel values in a closing CTA (`<a href="tel:…">801-363-0101</a>`). It's a value, not a
  CTA.
- `mailto:` / `tel:` links inside prose.

For these: the author leaves the `<a>` as a plain anchor in content (no `<strong>` / `<em>`
wrap), and the owning block styles it with per-block CSS. The convention is for buttons; if
it's not a button, don't apply it.

### #25 — Multi-variant button systems

The strong/em convention only names three slots (primary / secondary / accent). When a
prototype has **more** context-specific variants than that — e.g. JFK's `.btn--accent`
(yellow), `.btn--primary` (blue), `.btn--ghost` (outline), `.btn--onblue` (white-on-blue) —
author emphasis can't express them. Don't force it: **lift the prototype's full `.btn` +
variant system into `styles/styles.css`**, author the CTAs as plain `<a>` in content, and
have each block apply the right `btn btn--<variant>` class to the cloned anchor (the block
knows its section's variant). This is the same "if it doesn't fit, style it" escape hatch,
applied at the button-system level rather than per-link.
