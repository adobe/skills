# CBA Migration Architecture

Holistic architecture reference for the CommBank (commbank.com.au) migration from AEM 6.x on-premise to AEM Cloud Service with Edge Delivery Services (EDS) and Universal Editor.

---

## Migration Overview

| | Before (Legacy) | After (Target) |
|--|----------------|---------------|
| **CMS** | AEM 6.x (on-premise / managed) | AEM Cloud Service |
| **Delivery** | AEM Dispatcher + CDN | Edge Delivery Services (Fastly/CDN) |
| **Authoring** | AEM Classic/Touch UI | Universal Editor (UE) |
| **Content Storage** | JCR (Oak) | SharePoint / Google Drive (document-based) OR AEM as Content Source |
| **Frontend** | AEM HTL components + ClientLibs | Vanilla JS/CSS EDS blocks |
| **Personalisation** | AEM Target + ContextHub | EDS Experimentation Plugin |
| **Analytics** | AEM Data Layer + DTM/Launch | Adobe Data Layer + EDS analytics block |
| **Images** | Scene7/Dynamic Media | EDS image pipeline + AEM DAM (via UE) |
| **Navigation** | Switchblade API (dynamic) | EDS nav document (SharePoint/GDrive) |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AUTHORING LAYER                          │
│                                                              │
│  ┌──────────────────┐    ┌───────────────────────────────┐  │
│  │  Universal Editor │    │  SharePoint / Google Drive    │  │
│  │  (UE)            │◄──►│  (Content Source)             │  │
│  │                  │    │  - Page documents              │  │
│  │  Registers blocks │    │  - Navigation document        │  │
│  │  via component-  │    │  - Metadata spreadsheet       │  │
│  │  definition.json  │    │  - Redirects spreadsheet      │  │
│  └────────┬─────────┘    └───────────────┬───────────────┘  │
│           │                              │                   │
└───────────┼──────────────────────────────┼───────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      CODE LAYER                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  GitHub Repository (aem-xwalk-demo / cba-eds)         │   │
│  │                                                        │   │
│  │  blocks/        ← EDS block JS + CSS                 │   │
│  │  scripts/       ← aem.js, scripts.js, delayed.js     │   │
│  │  styles/        ← global CSS                         │   │
│  │  models/        ← UE component model JSON            │   │
│  │  component-definition.json  ← UE block registry      │   │
│  │  component-models.json      ← UE field schemas       │   │
│  │  component-filters.json     ← UE placement rules     │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │ AEM Code Sync                        │
└───────────────────────┼─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    DELIVERY LAYER                            │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Edge Delivery Services (Fastly CDN)               │     │
│  │                                                    │     │
│  │  Preview: {branch}--{repo}--{owner}.aem.page       │     │
│  │  Live:    main--{repo}--{owner}.aem.live           │     │
│  │  Prod:    www.commbank.com.au  (custom domain)     │     │
│  │                                                    │     │
│  │  Serves HTML from content source + code from       │     │
│  │  GitHub. Block JS/CSS loaded on demand.            │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Universal Editor Integration

The Universal Editor is the visual authoring interface. It communicates with EDS pages via the **UE Service** and reads component definitions from the repository.

### How UE Registers CBA Blocks

Three files control how blocks appear in the Universal Editor's component palette:

**`component-definition.json`** — Registers each block as a UE component. Authors see this in the "Add Component" panel. For CBA:
```json
{
  "groups": [
    {
      "title": "CBA Blocks",
      "id": "cba",
      "components": [
        {
          "title": "Hero",
          "id": "hero",
          "plugins": {
            "xwalk": {
              "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "Hero", "model": "hero" } }
            }
          }
        },
        {
          "title": "Product Card",
          "id": "product-card",
          "plugins": {
            "xwalk": {
              "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "Product Card", "model": "product-card" } }
            }
          }
        }
        // ... all CBA blocks registered here
      ]
    }
  ]
}
```

**`component-models.json`** — Defines the field schema for each block's UE editing panel. Authors see these fields when they click a block in UE:
```json
[
  {
    "id": "hero",
    "fields": [
      { "component": "richtext", "name": "text", "label": "Content" },
      { "component": "aem-content", "name": "image", "label": "Hero Image" },
      { "component": "select", "name": "variant", "label": "Variant",
        "options": [
          { "name": "Standard", "value": "" },
          { "name": "Image Right", "value": "image-right" },
          { "name": "Full Bleed", "value": "full-bleed" },
          { "name": "Editorial", "value": "editorial" }
        ]
      }
    ]
  }
]
```

**`component-filters.json`** — Controls where blocks can be placed (e.g., only one hero per page, footnotes only at the bottom):
```json
[
  { "id": "section", "components": ["hero", "product-card", "anchor-tile-nav", "tabs", "accordion", "footnotes"] },
  { "id": "hero-only", "components": ["hero"] }
]
```

**`models/`** directory — Contains per-field JSON schemas (`_button.json`, `_image.json`, `_section.json`, etc.) that are reused across component models. Analogous to Sling Models in AEM 6.x.

### UE ↔ EDS Block Correspondence

Every block built in EDS must be registered in `component-definition.json` to be authorable in UE. The mapping is:

```
UE component id  ←→  EDS block directory name
"hero"           ←→  blocks/hero/
"product-card"   ←→  blocks/product-card/
"anchor-tile-nav" ←→ blocks/anchor-tile-nav/
```

The UE field IDs in `component-models.json` map to the block's DOM structure. When UE saves, it writes the block as a table in the content source (SharePoint/GDrive), which EDS renders into clean HTML.

---

## Three-Phase Page Loading Architecture

EDS loads every page in three phases. Block code must respect this:

```
Phase 1: EAGER (< 100ms to LCP)
├── Decorate sections and blocks metadata
├── Load first section (hero block)
├── Load global styles (styles.css)
└── LCP image loaded — Core Web Vital measured here

Phase 2: LAZY (after LCP)
├── Load header and footer blocks
├── Load remaining sections
├── Load lazy-styles.css
└── All blocks below the fold decorated

Phase 3: DELAYED (3s after load or on user interaction)
├── Load analytics (Adobe Data Layer, GTM)
├── Load personalisation (Experimentation Plugin)
├── Load chat widget
└── Load non-critical third-party scripts
```

**CBA-specific loading decisions:**
- `announcement-banner` — EAGER (above hero, impacts LCP)
- `hero` — EAGER (is the LCP element)
- `anchor-tile-nav` — LAZY (below hero)
- `product-card`, `rate-display` — LAZY
- `rate-calculator` — LAZY (JS-heavy, defer until visible)
- `modal-apply` — DELAYED (only needed on user interaction)
- Analytics, GTM, Qualtrics — DELAYED
- AEM Target (personalisation) via Experimentation Plugin — DELAYED

---

## CBA Block Architecture

### Block Categories

**Category 1: Layout & Navigation Blocks**
- `header` — Global nav fragment (Switchblade nav data migrated to SharePoint nav doc)
- `footer` — 3-col links + Acknowledgement fragment
- `anchor-tile-nav` — Horizontal icon tile in-page navigation
- `in-page-nav` — Sticky anchor links on product detail pages

**Category 2: Hero & Promotional Blocks**
- `hero` (4 variants) — All page-top sections
- `announcement-banner` — Dismissible top-of-page alerts
- `promo-offer-banner` — Inline time-limited offers (Qantas Points, cashback)
- `featured-content` — Large editorial card (780×416)

**Category 3: Product & Financial Blocks** ← CBA's most unique category
- `product-card` (standard + extended) — Product listing grids
- `rate-display` — Interest rate + comparison rate pairs
- `rate-calculator` — Interactive rate calculator
- `modal-apply` — Two-path existing/new customer apply flow
- `rates-fees-table` — Product detail fee tables
- `partner-block` — Co-branded partner integrations

**Category 4: Content & Education Blocks**
- `tabs` — CommBank Yello, product detail navigation
- `accordion` — FAQ sections ("Understanding [product]")
- `step-process` — Application process numbered steps
- `feature-grid` — 4-col USP/award trust signals
- `article-cards` — News/guide teasers
- `app-download` — App Store + Google Play badges

**Category 5: Legal & Support Blocks**
- `footnotes` — "Things you should know" (⚠️ legal requirement on all product pages)
- `support-cards` — Help links grid
- `contact-form` — Enquiry routing
- `search` — Full-width search overlay
- `newsroom-listing` — Article grid + category filter
- `loyalty-tiers` — CommBank Yello tier cards

### Block Build Priority

```
Sprint 1 — Core page structure (required for any page to render):
  ✅ header (exists — enhance for CBA nav)
  ✅ hero (exists — add 4 CBA variants)
  ✅ footer (exists — add CBA footer structure)
  🔲 announcement-banner (NEW)
  🔲 anchor-tile-nav (NEW)

Sprint 2 — Product pages (drives most traffic):
  🔲 product-card + product-card (extended) (NEW)
  🔲 rate-display (NEW)
  🔲 feature-grid (NEW — variant of existing cards block?)
  🔲 modal-apply (NEW)
  🔲 footnotes (NEW — legal requirement)

Sprint 3 — Product detail pages:
  🔲 in-page-nav (NEW)
  ✅ tabs (exists — verify CBA variants)
  ✅ accordion (exists — verify CBA FAQ variant)
  🔲 step-process (NEW)
  🔲 rates-fees-table (NEW)

Sprint 4 — Content & discovery:
  🔲 article-cards (NEW)
  🔲 promo-offer-banner (NEW)
  🔲 partner-block (NEW)
  🔲 app-download (NEW)
  🔲 support-cards (NEW)

Sprint 5 — Section-specific:
  🔲 rate-calculator (NEW — complex JS)
  🔲 newsroom-listing (NEW)
  🔲 featured-content (NEW)
  🔲 loyalty-tiers (NEW)
  🔲 contact-form (NEW)
  🔲 search (exists — extend for CBA popular searches)
```

---

## Navigation Architecture

### Legacy (AEM 6.x)
The CommBank mega-menu is fetched dynamically at runtime from the Switchblade API:
```
https://www.commbank.com.au/innovate/switchblade/v0/
```
Configured via `gloNavGlobalVars` JavaScript object. Auth state (NetBank/CommBiz/CommSec) is managed client-side.

### Target (EDS)
The navigation becomes a **content document** authored in SharePoint/Google Drive at `/nav` (or `/navigation`). The EDS `header` block fetches and renders it.

**Migration mapping:**

| Legacy Switchblade | EDS Nav Document |
|--------------------|-----------------|
| Primary nav (7 items) | Top-level headings in nav doc |
| Mega-menu sub-items | List items under each heading |
| Auth nav (NetBank, CommBiz, CommSec) | Separate section in nav doc with `auth` class |
| Utility nav (Locate us, Help & support) | Utility section in nav doc |
| Search | Handled by `search` block in header |

**Authentication awareness:** The `header` block uses a lightweight client-side check (cookie or session ping) to show/hide authenticated navigation. The `killAuthNav` flag from legacy AEM is replaced with a CSS class toggle based on auth state.

---

## Personalisation Architecture

### Legacy (AEM 6.x)
- **AEM Test & Target**: Mbox wrappers on hero sections (`<div class="mboxDefault" id="CB-HL-HERO">`)
- **ContextHub**: `/etc/segmentation/contexthub` — audience segmentation for content variations
- **Adobe Target activities**: Managed in Target UI, delivered via AT.js

### Target (EDS)
- **EDS Experimentation Plugin**: A/B testing at the CDN edge via RUM data
- **Metadata-driven experiments**: Page variants defined in page metadata (`experiment`, `variant`)
- **Audience-based personalisation**: Path-based segment URLs or metadata-driven content swaps

**Migration approach:**
1. Strip all `mboxDefault` wrappers during page import
2. Recreate high-value A/B tests as EDS experiments using the Franklin Experimentation Plugin
3. Implement audience segments via path-based configuration (e.g., `/home-loans/` serves `retail` tribe, `/business/` serves `business` tribe)

---

## Analytics Architecture

### Legacy (AEM 6.x)
- `window.adobeDataLayer` (Adobe Data Layer spec) — page/product events
- `window.dataLayer` (GTM) — Google Tag Manager container
- `?ei=[section]-[subsection]-[action]` — Event instrumentation on every CTA link
- DoubleClick Floodlight tags per product section
- Qualtrics for NPS surveys

### Target (EDS)
- **`window.adobeDataLayer`** — Retained (Adobe Data Layer is framework-agnostic)
- **GTM via `delayed.js`** — GTM container loads in Phase 3 (delayed) to avoid LCP impact
- **Data attributes replace `?ei=`** — CTAs use `data-cta-id="[section]-[action]"` attributes; analytics plugin reads these
- **EDS RUM** — Real User Monitoring built into EDS, used for experimentation decisions

**CBA `?ei=` migration plan:**
```
Legacy:  <a href="/home-loans.html?ei=cta-hlhero-getstarted">Get started</a>
EDS:     <a href="/home-loans.html" data-analytics-event="cta-hlhero-getstarted">Get started</a>
```
The analytics block (loaded in Phase 3) reads `data-analytics-event` and fires the corresponding Adobe Data Layer event.

---

## Rate Data Architecture

### Legacy (AEM 6.x)
Interest rates on product pages are rendered one of two ways:
- **API-populated**: JavaScript fetches rates at runtime and injects into DOM
- **CMS-managed**: Rate values in AEM content nodes, published via Dispatcher

Template variables (`#_KEY_INTEREST_RATE_#`) are visible in raw HTML before JS runs.

### Target (EDS)
Rate data is driven by a **SharePoint spreadsheet** (or AEM Content Fragment sheet) published as a JSON feed:

```
/content/cba/rates/home-loans.json
{
  "data": [
    { "product": "digi-home-loan", "interest-rate": "5.89%", "comparison-rate": "6.02%" },
    { "product": "standard-variable", "interest-rate": "6.24%", "comparison-rate": "6.41%" }
  ]
}
```

The `rate-display` block fetches this JSON and renders rates dynamically. This means:
- Rate updates require only a spreadsheet edit + publish — no code deployment
- Rates are always current (no Dispatcher cache staleness)
- Rate calculator block fetches from the same source

---

## Image Architecture

### Legacy (AEM 6.x)
- Images served from `assets.commbank.com.au` via Scene7/Dynamic Media
- URL pattern: `https://assets.commbank.com.au/is/image/commbank/[asset]$W780_H416$&fit=crop`
- Lazy loading via `s7responsiveImage()` JS function with base64 GIF placeholders
- SVG pictograms (64×64px) for nav tiles and feature icons

### Target (EDS)
- Images stored in **AEM DAM** (AEM Cloud Service) or in the SharePoint/GDrive content source
- Served via EDS `/media_` URL pipeline (automatically optimised: WebP, AVIF, responsive sizing)
- No crop parameters needed — EDS handles responsive image sizing via `<picture>` elements
- SVG pictograms committed to `icons/` directory in the GitHub repository

**Migration steps:**
1. During page import, download Scene7 images to local `./images/` folder
2. Upload to AEM DAM or SharePoint document library
3. Reference via EDS content path (not Scene7 URL)
4. EDS generates `<picture>` with `srcset` automatically

---

## Content Model Architecture (Universal Editor)

### How CBA Content is Structured for UE

In UE, a CBA page is a hierarchy of **sections** and **blocks**. Each block maps to an entry in `component-definition.json` and has fields defined in `component-models.json`.

**Page structure in UE:**
```
Page
└── Section (section metadata: style=light|dark|grey)
    ├── Hero block [hero model]
    ├── Anchor Tile Nav block [anchor-tile-nav model]
    └── Product Card block [product-card model]
        ├── Row 1: [image, content: name + bullets + CTA]
        ├── Row 2: [image, content: name + bullets + CTA]
        └── Row 3: [image, content: name + bullets + CTA]
└── Section (section metadata: style=dark-blue)
    └── Promo Offer Banner block [promo-offer-banner model]
└── Section
    └── Footnotes block [footnotes model]
```

### Adding a New CBA Block to UE (Checklist)

When building a new CBA block, always update all three registration files:

1. **`component-definition.json`** — Add the block to the "CBA Blocks" group with correct `resourceType` and `template`
2. **`component-models.json`** — Add the field schema: what fields does an author fill in? (text, image, link, select for variants)
3. **`component-filters.json`** — Add to the `section` filter so it can be placed on pages
4. **`models/`** — If introducing a new reusable field type, add a `_fieldname.json` schema file
5. **`blocks/{blockname}/`** — Add the `{blockname}.js` and `{blockname}.css` EDS block files

---

## Publishing Flow

```
Author edits in UE
        │
        ▼
AEM Content Source (SharePoint / AEM as Content Source)
        │  Author clicks "Publish"
        ▼
EDS Preview environment
  https://{branch}--{repo}--{owner}.aem.page/{path}
        │  QA approved, PR merged to main
        ▼
EDS Live environment
  https://main--{repo}--{owner}.aem.live/{path}
        │  DNS / CDN routing
        ▼
www.commbank.com.au (production, custom domain)
```

**For code changes (new blocks, bug fixes):**
```
Developer pushes to feature branch
        │  AEM Code Sync (automatic)
        ▼
Feature preview: https://{branch}--{repo}--{owner}.aem.page/
        │  PR created with preview URL in description
        ▼
Code review + PageSpeed Insights check (target: 100)
        │  PR merged to main
        ▼
Production: https://main--{repo}--{owner}.aem.live/
```

---

## Security Architecture

| Concern | Legacy AEM | EDS |
|---------|-----------|-----|
| Authentication | AEM Dispatcher auth | Not applicable (public pages) |
| NetBank auth | External — `netbankIdentityApi` cookie check | Same — client-side cookie check |
| Content security | AEM ACLs on JCR nodes | SharePoint permissions |
| HTTPS | Dispatcher SSL termination | EDS Fastly (HTTPS by default) |
| API keys | Stored in AEM config | Stored in SharePoint secrets or `.env` (never in git) |
| .hlxignore | N/A | Prevents internal files from being served publicly |

---

## CBA-Specific Project Conventions

### File Naming
- Block directories: `kebab-case` matching CBA block names (`product-card`, `anchor-tile-nav`, `rate-display`)
- Block JS/CSS: same name as directory (`product-card.js`, `product-card.css`)
- CBA pictogram icons: `icons/cba-[name].svg` (e.g., `icons/cba-home-loan.svg`)

### CSS Custom Properties
Define CBA brand tokens in `styles/styles.css`:
```css
:root {
  /* CBA Brand Colours */
  --cba-yellow: #ffcc00;
  --cba-black: #000000;
  --cba-dark-blue: #1a1a2e;
  --cba-grey: #f5f5f5;
  --cba-text: #333333;
  --cba-link: #006600;  /* CBA green */

  /* CBA Typography */
  --cba-font-sans: 'CommBank Sans', -apple-system, BlinkMacSystemFont, sans-serif;

  /* CBA Spacing */
  --cba-section-padding: 48px 24px;
}
```

### Analytics Data Attributes
All CBA CTAs must carry a `data-analytics-event` attribute (replaces legacy `?ei=`):
```html
<a href="/home-loans/apply" data-analytics-event="cta-hlhero-getstarted">Get started</a>
```

### Footnote Superscripts
Use standard HTML superscript for footnote markers in block content. The footnotes block at page bottom provides the definitions:
```html
Interest rate 5.89% p.a. <sup><a href="#fn-comparison-rate">*</a></sup>
```

### Rate Values
Never hardcode rate values in block JS or CSS. Always fetch from the rates JSON feed:
```javascript
const ratesData = await fetch('/content/cba/rates/home-loans.json').then(r => r.json());
```
