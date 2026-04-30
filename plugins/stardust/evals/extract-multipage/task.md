# Eval: multi-page extract with cap

## Setup

Empty project; no `stardust/` folder. Impeccable installed in
`.agents/skills/impeccable/` (hard dep verified by stardust setup).

## User prompt

"Use stardust to extract https://stripe.com"

## Expected behavior

The `stardust:extract` skill is invoked. It:

1. Runs the master skill setup (impeccable dep check, context loader).
2. **Discovers** the page inventory before crawling: tries
   `sitemap.xml`, then `sitemap_index.xml`, then `robots.txt`
   `Sitemap:` directives, then BFS crawl.
3. Applies the **default page cap of 25** and shows the user the
   discovered list, the cut list, and asks for confirmation.
4. **Uses Playwright** (not WebFetch / curl) for per-page rendering
   at 1440 × 900 @ 2× DPR with `networkidle` + 1.5 s grace and a
   scroll-to-bottom pass.
5. Writes one `stardust/current/pages/<slug>.json` per crawled page
   with the full schema (headings, landmarks, ctas, links, media,
   forms, widgets, per-section style).
6. Runs the brand-surface extraction once on the home page and
   writes `stardust/current/_brand-extraction.json` with logo,
   palette (frequency-clustered), type, spacing, motifs,
   componentStyle, voice samples.
7. Locates the logo via the priority chain (inline SVG → `<img>` with
   logo-ish identifier → `apple-touch-icon` → `og:image` → favicon →
   synthesized placeholder) and saves it under
   `stardust/current/assets/logo.<ext>` (not `icons/`).
8. **Authors `stardust/current/PRODUCT.md` directly** using
   impeccable's `teach.md` as the format spec — does NOT invoke
   `$impeccable teach` (the current-state file is descriptive, no
   interview).
9. **Authors `stardust/current/DESIGN.md` and `DESIGN.json`
   directly** using impeccable's `document.md` as the format spec —
   does NOT invoke `$impeccable document`.
10. Updates `stardust/state.json` with `site.originUrl`,
    `site.pageCap`, `site.crawled`, and one `pages[]` entry per
    crawled page with `status: "extracted"`.
11. Prints a summary report and recommends `$stardust direct` next.
12. Does NOT reference EDS, AEM, `localhost:3000`, or dev servers.
