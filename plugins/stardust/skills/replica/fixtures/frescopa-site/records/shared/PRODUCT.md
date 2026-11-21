<!-- stardust:provenance
  writtenBy:        stardust:extract
  writtenAt:        2026-11-21T19:05:00Z
  readArtifacts:
    - https://markszulc.github.io/frescopa-atelier/
    - stardust/current/pages/*.json (6 pages)
    - stardust/current/_brand-extraction.json
    - stardust/current/_computed-styles.json
  synthesizedInputs: []
  stardustVersion:  0.46.0
  mode:             descriptive (current state, not target)
-->
# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

_provenance: inferred — basis: the copy addresses a home coffee drinker in the second person ("your mornings", "your counter", "your taste") and the shop/café/journal IA._

- Home coffee, tea and juice drinkers considering a premium "learning" coffee machine (the Atelier, "From $2,199, or $184/mo for 12 months").
- Existing customers buying beans, tea, cold-pressed juice and accessories ("Shop all coffee", "Add to cart").
- Visitors looking for a nearby Fréscopa Café / showroom ("Find your nearest café", "Get directions", "Book an Atelier tour").
- Readers of the Journal ("Brewing guides, origin stories, and small thoughts on doing mornings well").

## Product Purpose

Fréscopa Atelier is the marketing and shop site for "the first Fréscopa coffee machine with a feel for your mornings. It learns your taste, matches your mood, and takes care of the rest." (home meta description). Around the machine it presents the wider Fréscopa range — machines, beverages (coffee, tea, cold-pressed juice), cafés and a journal. The footer states it is "A fictional brand, created for demonstration."

## Positioning

The claimed mechanism is a machine that learns: "It senses every cup, learns what you love, reads the shape of your morning, and pours accordingly — no dials, no guesswork." Supporting copy: "It builds your flavour DNA", "It reads the morning", "It acts on its own", "Reorders beans before you run out". Pairs this with physical cafés where every Atelier "begins".

## Capabilities and Constraints

Observed on the source (6 pages, `stardust/current/pages/`):

- Static GitHub Pages site. Home is hand-built HTML + `shared/tokens.css` + `atelier.css` + small scripts (`shared/hero.js`, `shared/flavor-dna.js`, `shared/app.js`). The other five pages (landing, machines, beverages, café, journal) are rendered client-side by a React design-system bundle (`_ds/fr-scopa-design-system-…/_ds_bundle.js`, React 18.3.1 from unpkg) into `#dc-root`, styled by `fr-*` classes and inline styles.
- Interactive surfaces: mood toggles (Weekday / Slow Sunday / After dinner) driving a flavour-DNA graphic, a calendar, filter pills (machines, journal categories, café regions), add-to-cart buttons, a footer newsletter form (`email` / `fr-ftr-email`, no real action on DS pages).
- Several product and post tiles on machines, journal and café pages render `<image-slot>` placeholders on the source itself — there is no photography for them.
- No `og:*` metadata anywhere; the five design-system pages ship an empty `<title>` and no meta description.
- Two planned routes are template literals (`{{ featured.href }}`, `{{ post.href }}`) that 404 on the source.

## Brand Commitments

- **Register:** `brand` (marketing/landing: photo heroes, pricing, add-to-cart and order CTAs, testimonials, no auth).
- **Name and marks:** "Fréscopa" wordmark (`stardust/current/assets/logo.svg` light, `logo-dark.svg` burgundy), favicon `stardust/current/assets/favicon.svg`.
- **Tagline:** "Every morning, perfected." Footer: "Warm mornings, made effortless. Coffee, tea, and cold-pressed juice, and the machines that make them sing."
- **Observed personality:** warm, crafted, unhurried, quietly confident; British spelling (flavour, centre, memorise). Tone guess (heuristic): professional-warm.
- **Observed visual identity:** warm paper grounds, burgundy display type, terracotta pill CTAs, charcoal footer/CTA bands with amber glow, Schibsted Grotesk + Hanken Grotesk.
- **Observed anti-references:** _provenance: inferred — the site avoids cool greys, pure white/black grounds, sharp corners and dense UI chrome; every colour is a warm oklch tint.

## Evidence on Hand

- Page captures: `stardust/current/pages/<slug>.json` + rendered `.html` for `frescopa-atelier`, `frescopa-atelier-landing-html`, `frescopa-atelier-machines-html`, `frescopa-atelier-beverages-html`, `frescopa-atelier-cafe-html`, `frescopa-atelier-blog-html`.
- Screenshots: `stardust/current/assets/screenshots/<slug>.png`.
- Computed-style census: `stardust/current/_computed-styles.json` (1440 and 360).
- Brand surface: `stardust/current/_brand-extraction.json`.
- Photography (6 JPGs) and logos: `stardust/current/assets/media/`, ledger `stardust/current/assets/media-ledger.json`.
- Fonts: `stardust/current/assets/fonts/` (Schibsted Grotesk, Hanken Grotesk woff2, latin + latin-ext, upright + italic; Google Fonts CSS).
- Source stylesheets verbatim: `stardust/current/assets/css/`.
- Testimonials exist on landing ("The verdict, three months in.") and home ("voices") — real copy from the source, attribute only as captured.
- Absent, must not be fabricated: photography for `<image-slot>` tiles (Atelier Mini, Barista, Everyday, Slow Pour, Carafe, several journal posts, café locations), article pages, social share images, page titles for the design-system pages.

## Product Principles

_provenance: inferred — basis: repeated claims in hero and section copy._

1. The machine does the work: "no dials, no guesswork", "No apps to fuss over, no settings to memorise."
2. Mornings, not specs: copy leads with ritual and feeling, prices and features follow.
3. Try before you commit: cafés as the entry point ("Taste before you commit", "no purchase, no pressure").
4. Nothing wasted: sustainability is a standing theme ("Nothing wasted, right down to the grounds.").

## Accessibility & Inclusion

Observed only: "Skip to content" link on home; `:focus-visible` outline 2px terracotta with 3px offset; `prefers-reduced-motion` rules in three stylesheets; meaningful alt text on all real photographs; icon buttons carry `aria-label`s. No stated standard.
