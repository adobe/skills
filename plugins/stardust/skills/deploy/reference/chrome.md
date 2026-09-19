# Step 6 — Chrome: authored `/nav` + `/footer`, template-slotted header/footer blocks (full text)

Full text of deploy Step 6. Read:
- § 6 — before Step 6: chrome as the canonical fragment use case (D12);
- § The nav/footer documents — when authoring `content/nav.html` / `content/footer.html` (the three-section contract, #98);
- § The header/footer blocks — when replacing `blocks/header` / `blocks/footer` CSS/JS (#31, #26, #106);
- § What still cannot run — before wiring any chrome form, scroll state or media dependency (CSP, #20, #102);
- § Per-page chrome variants — when a page needs an alternate nav/footer;
- § Chrome states and variants — before Step 10 signs chrome off (nav grammar, open states, `aria-current`, variant roster, guard set).

## 6. Chrome — authored `/nav` + `/footer` documents, template-slotted header/footer blocks

Chrome is the canonical fragment use case (D12): **content** lives in two authored DA documents — `content/nav.html` and `content/footer.html` — and **presentation** lives in the per-site `blocks/header` and `blocks/footer` CSS/JS. The stock blocks fetch the documents (`loadFragment('/nav')` / `loadFragment('/footer')`, path overridable per page via `nav`/`footer` metadata); you replace their demo CSS/JS with the prototype's chrome. Nav links become authorable; block JS runs, so interactive chrome is REAL JS, not CSS hacks.

## The nav/footer documents (ENCODE side)

**The nav/footer documents (ENCODE side).** Same body-fragment format as any content page (Step 9), deployed and published through the same chain — they must be on the publish roster or the chrome 404s. Content is default-content only, structured by sections:
- `content/nav.html`: section 1 = brand (logo link), section 2 = the nav link list (`<ul>`), section 3 = tools/CTAs (the stock header block reads exactly these three sections into `.nav-brand` / `.nav-sections` / `.nav-tools` — keep that contract so the hamburger logic keeps working).
- **Nav DECODE: the pipeline wraps each list item's trigger link in a `<p>` on live (#98).** The authored/harness shape is `<li><a>…<ul>`, the delivered shape is `<li><p><a></p><ul>` — a `:scope > a` trigger lookup and any `.nav-links > li > a` CSS silently miss on live while the harness passes (the #79 class, hitting chrome). Normalize in `decorate()`: match `:scope > a, :scope > p > a` and unwrap the `<p>`. Verify the desktop nav's STYLED render on the deployed preview, not just the harness.
- `content/footer.html`: one section per footer band (link columns as lists, legal line, social links). The footer block renders them in order.
- Images (logo) follow the standard editorial-image rule: upload to DA `/media`, author a `content.da.live` `<img>` — the pipeline emits `<picture>`. Internal links root-relative; external fully-qualified (D4).

## The header/footer blocks (DECODE side)

**The header/footer blocks (DECODE side) — template-slotted (#95), pixel parity by construction.** Replace the demo CSS of `blocks/header/header.css` with the prototype's chrome CSS (scoped under `header .nav-*` / `footer .footer`), and adapt `header.js`'s `decorate()` to build the prototype's chrome DOM verbatim, slotting the authored content by role — logo into the brand slot, each authored `<li>` link into the nav-link template, tools/CTAs into their slot. KEEP the stock block's interaction machinery (hamburger `toggleMenu`, `aria-expanded`, escape/focus-out close, the `isDesktop` media-query switch) and restyle it — it is accessible, tested JS; the prototype's own menu script is only a visual reference.
- **Lift the chrome element's OWN box styles (#31)** — `margin`, `padding`, `border` set on the prototype's `<header>`/`<footer>` element itself — onto `header`/`footer` (the host elements sit OUTSIDE `<main>`), not just the inner content styles. The gap between the last section and the footer comes entirely from the footer's own top margin (e.g. `footer { margin-top: 72px }`). Easy to miss: the inner content looks right while the footer sits flush against the last block.
- **Root-class hook (#26):** the block renders inside `header .header` / `footer .footer`. If the prototype's chrome styling is keyed to a different root class (e.g. `.utilnav` / `.site-footer`), have `decorate()` emit a `<div class="<that-class>">` wrapper so the lifted CSS matches unchanged.
- **Multi-row chrome (utility bar + nav):** author the utility bar as an extra section in `/nav`; the header block slots it above the nav row. Update `--nav-height` (#81) to the combined height.
- **Never pair a fixed `height` with vertical `padding` on a chrome row.** Under the global `border-box` reset (#106) `height: 40px; padding-top: 12px` shrinks the content box to 28px and mis-centers every utility-row item by 6px — one declaration, a whole-chrome offset (recorded). Chrome rows size from content (`min-height` when a floor is needed); before deploy, grep the chrome CSS for `height:` co-occurring with `padding` on flex rows.

## What still cannot run (CSP — #20, #102)

**What still can't run (#20, #102):** authored content never carries `<script>` (D15), and EDS's delivered CSP (`script-src 'nonce-…' 'strict-dynamic'`) means inline `on*` handlers in ANY markup never fire. Forms in chrome (a newsletter signup in the footer) are wired in BLOCK JS: render the `<form>` from the block, attach a real `submit` listener in `decorate()`. Scroll-state chrome (sticky shadow, shrink-on-scroll) is now fine too — wire it in the header block's JS, honoring `prefers-reduced-motion`. **Block dependencies must not compile WebAssembly (#102):** the CSP has no `wasm-unsafe-eval`, so WASM-based players (dotlottie, wasm codecs/parsers) silently fall back on every REAL environment while working locally — for Lottie use `lottie-web`'s pure-JS `svg` renderer via a pinned-CDN module `import()` (strict-dynamic trusts module imports). Step 10: check the deployed page's browser console for CSP violations — a graceful fallback hides this class from every layout gate.

## Per-page chrome variants

**Per-page chrome variants:** set `nav: /nav-minimal` (or `footer: /footer-legal`) in the page's metadata block to point that page at an alternate authored document — this replaces the old `header: off` switch (there is no stock off switch; a chrome-less page points at a minimal nav doc you author). Multilingual sites route the same way: `/fr/nav`, `/fr/footer`.

## Chrome states and variants

**N-level nav grammar.** Section 2 of `/nav` stays one `<ul>`; each further level is a nested `<ul>` inside its parent `<li>`; a panel column is one nested list whose first item may carry a description `<p>` and whose last item may be an action link; promo cells are trailing `<li>` holding a picture. The header block slots levels by structure and never parses text (anti-pattern 5) — the shape the hover probe records (`../../dynamics/reference/patterns.md` § chrome-interaction).

**Done means gated open.** Before Step 10 signs chrome off, each top-level nav trigger is opened on the preview page (D1 — by hand in the Playwright re-probe: `chrome-parity` captures rest state only) and the header, footer and open-state crops pass the crop gate against the cached live capture (`--live-cache`; rest-state gate #115 unchanged). The header block sets `aria-current="page"` and replicates the live current-page styling; desktop nav rules are written at `[aria-expanded='true']` specificity or under `:where()` — the stock header sets that attribute on desktop and the attribute selector out-ranks a media-query `display` rule; a `/nav` section absent in the document renders nothing — no toggle, no band (the stock block builds the toggle unconditionally; guard it). Two flow rules ride on this: after a push touching `styles/`, `blocks/header`, `blocks/footer` or a block several pages use, re-run the chrome crops on two pages of different templates before the next wave (rollout Phase C, chrome guard set); a driver reading a gate record consumes `pass`, never the pixel percentage alone.

**Variant roster.** `nav:` / `footer:` documents are deduped by content hash and their names persisted in the conversion log (`nav`, `nav-minimal`, `footer-legal`, …) — never renumbered between runs; more than three per kind is a D9/D12 smell (`delivery-lint --chrome-docs` P2 `chrome-variant-count`); on a multi-variant site every page carries explicit `nav:`/`footer:` rows (P1 `chrome-variant` — rollout Phase C step 2 passes `--chrome-docs content/nav*.html,content/footer*.html`).
