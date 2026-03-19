# CommBank (CBA) Site Knowledge

Reference knowledge for migrating commbank.com.au to AEM Cloud Service with EDS and Universal Editor.

> For the full system architecture (three-layer stack, UE integration, personalisation, analytics, rate data, and image pipeline), see `cba-architecture.md` in this same directory.

---

## Platform Context

CommBank's existing site runs on **AEM 6.x** (on-premise/managed). Key signals in the current markup:

- JCR content paths: `/content/commbank-neo/[section]/_jcr_content/...`
- AEM Test & Target mbox names on hero sections (e.g., `CB-HL-HERO`, `CB-INVSUP-HEROBANNER`)
- ContextHub segmentation at `/etc/segmentation/contexthub` for audience personalisation
- `window.adobeDataLayer` (Adobe Analytics) + `window.dataLayer` (GTM) on every page
- Image CDN: `assets.commbank.com.au` using Scene7/Dynamic Media (see Image Handling below)
- Navigation mega-menu data fetched dynamically from the **Switchblade API** at `https://www.commbank.com.au/innovate/switchblade/v0/`

**Migration goal:** Move to AEM Cloud Service + Edge Delivery Services with Universal Editor as the authoring surface.

---

## The Six CBA Page Templates

When analysing a CBA page, determine which template it follows first — this determines which blocks to expect:

### 1. Marketing Hub / Category Landing
**URLs:** Homepage (`/`), Insurance (`/insurance.html`), Investing & Super, Business, Digital Banking

**Block sequence:**
1. `announcement-banner` (optional — dismissible top alert)
2. `hero` (H1 + subheading + 1–2 CTAs; AEM Target mbox wrapped)
3. `anchor-tile-nav` (6–10 icon + label tiles linking to `#hash` sections)
4. Multiple sections alternating: heading (default content) + `product-card` grid
5. `promo-offer-banner` (inline time-limited offer)
6. `partner-block` (co-branded partner integrations)
7. `support-cards` (3-col icon + heading + link list)
8. `article-cards` (news/guide teasers)

### 2. Product Listing / Comparison
**URLs:** `/home-buying/home-loans.html`, `/credit-cards/`, `/savings-accounts/`, `/personal-loans/`

**Block sequence:**
1. `hero` (H1 + subheading + appointment/get-started CTAs)
2. `anchor-tile-nav` (8 tiles for product sub-sections)
3. `feature-grid` (4-col USP/award icons — CANSTAR, fast approval, support)
4. `product-card` (extended variant — `<dl>` with rates: purchase rate, comparison rate, monthly fee)
5. `rate-display` (interest rate + comparison rate pairs with superscript footnote refs)
6. `promo-offer-banner` (e.g., Qantas Points bonus)
7. `accordion` (FAQ — "Understanding [product type]")
8. `footnotes` (mandatory "Things you should know" collapsed section)

### 3. Product Detail
**URLs:** `/home-buying/home-loans/digi-home-loan.html`, `/credit-cards/smart-awards.html`, `/digital-banking/commbank-app.html`

**Block sequence:**
1. `hero` (image-right variant)
2. `in-page-nav` (sticky anchor links: At a glance | Awards | Rates | Support)
3. `feature-grid` (4-col product highlights)
4. `tabs` (product details organised in tabs)
5. `rates-fees-table` (2–3 col structured table)
6. `step-process` (numbered application steps with icons)
7. `accordion` (FAQs)
8. `footnotes` (mandatory legal disclosures)

### 4. Loyalty / Program
**URLs:** `/digital-banking/commbank-yello.html`

**Block sequence:**
1. `hero`
2. `tabs` (Benefits | How it works | Offers | Access | Business)
3. `loyalty-tiers` (4 tier cards: Yello → Diamond)
4. `partner-logos` (Ampol, Coles, Myer, JB Hi-Fi, DoorDash grid)
5. `app-download` (App Store + Google Play badges)

### 5. Support / Contact
**URLs:** `/digital-banking/support.html`, `/contact-us.html`

**Block sequence:**
1. `search` (full-width with popular searches pre-populated)
2. `support-cards` (3-col icon + heading + link list)
3. `contact-form` (dropdown enquiry type → dynamic contact details reveal)

### 6. Content / Newsroom
**URLs:** `/newsroom/`, `/articles/`, guide articles

**Block sequence:**
1. `hero` (editorial — category + H1 + date or teaser)
2. `newsroom-listing` (article cards + category filters + load-more)
3. Article detail body: default content (heading + body text + images inline)

---

## Block Inventory (28 blocks)

Full list of blocks required for the CBA migration, in priority order.

### Critical / High Frequency

| Block | CBA Usage | EDS Content Model Pattern |
|-------|-----------|--------------------------|
| `header` | Global nav with mega-menu, auth state (NetBank/CommBiz/CommSec), search modal | Auto-blocked / fragment |
| `footer` | 3-col links + Acknowledgement of Country + ABN/AFSL | Auto-blocked / fragment |
| `hero` | Every page — multiple variants (see below) | Standalone |
| `product-card` | Home loans, credit cards, savings — standard + extended (rates `<dl>`) | Collection |
| `anchor-tile-nav` | Category landing + product listing pages | Collection |
| `announcement-banner` | Top-of-page alerts (rate changes, weather events, promos) | Standalone |
| `modal-apply` | Two-path existing/new customer apply flow — triggers from product cards | Standalone |
| `rate-display` | Static interest rate + comparison rate pairs with footnote refs | Standalone |
| `article-cards` | 3-up grid on landing pages + newsroom teasers | Collection |
| `support-cards` | 3-col icon + heading + link list | Collection |
| `tabs` | CommBank Yello, product detail, CommBank App pages | Auto-blocked |
| `accordion` | FAQ sections on product listing + detail pages | Collection |
| `footnotes` | "Things you should know" — **legal requirement on every product page** | Standalone |

### Medium Priority

| Block | CBA Usage | EDS Content Model Pattern |
|-------|-----------|--------------------------|
| `rate-calculator` | Home loans, personal loans — form inputs + toggle groups + dynamic results | Configuration |
| `in-page-nav` | Sticky anchor links on product detail pages | Standalone |
| `step-process` | Application guide (numbered steps + icons) on product detail pages | Collection |
| `rates-fees-table` | 2–3 col structured data tables on product detail pages | Collection |
| `featured-content` | Large 780×416 hero card + 4 thumbnails (homepage "More from CommBank") | Standalone |
| `promo-offer-banner` | Inline time-limited offers (Qantas Points, cashback) | Standalone |
| `partner-block` | Co-branded partners (Home-in, NBN, Hollard, AIA, Cover-More) | Standalone |
| `search` | Full-width modal search overlay with popular searches | Auto-blocked |
| `newsroom-listing` | Article card grid + category filter tabs + load-more | Configuration |
| `app-download` | App Store + Google Play badge pair with device mockup | Standalone |

### Lower Priority / Section-Specific

| Block | CBA Usage | EDS Content Model Pattern |
|-------|-----------|--------------------------|
| `loyalty-tiers` | CommBank Yello tier cards (4 tiers, retailer logo grid) | Collection |
| `business-selector` | Multi-step guided product discovery for business banking | Configuration |
| `contact-form` | Dropdown enquiry → dynamic contact details | Configuration |
| `feature-grid` | 4-col USP / trust signal grid (award badges + descriptions) | Collection |
| `article-detail` | Long-form editorial body with category, date, related content | Standalone |

---

## Hero Block Variants

The `hero` block appears on every page but with 4 distinct variants — use block variant classes to differentiate:

| Variant | Authoring Name | Usage |
|---------|---------------|-------|
| `hero` | `Hero` | H1 + subheading + 1–2 CTAs on solid/gradient background |
| `hero (image-right)` | `Hero (Image Right)` | H1 + text + CTAs left, product image right |
| `hero (full-bleed)` | `Hero (Full Bleed)` | Full-width image with overlaid heading — corporate hub pages |
| `hero (editorial)` | `Hero (Editorial)` | Category tag + H1 + date — newsroom articles |

All hero sections on major product pages are **wrapped in AEM Test & Target mboxes** for A/B testing. Strip the mbox wrapper during import; the EDS experimentation plugin handles A/B at the edge.

---

## Key CBA-Specific Patterns

### 1. `?ei=` Event Instrumentation on Links

**Every** CTA and navigation link on commbank.com.au carries a `?ei=` tracking parameter:

```
https://www.commbank.com.au/home-buying/home-loans.html?ei=cta-hlhero-getstarted
https://www.commbank.com.au/home-buying/home-loans.html?ei=anch_home-loans
```

**Migration rule:** Strip `?ei=` parameters from all link `href` values during import. CBA will implement tracking via data attributes and an analytics block in EDS rather than URL parameters.

### 2. Two-Path Modal Apply Flow

All product "Apply now" / "Get started" buttons trigger a two-path decision modal:

```html
<!-- Existing customer path -->
<a href="https://mobile-app-redirect.commbank.com.au/[product-id]">Apply online</a>

<!-- New customer path -->
<a href="/digital-banking/apply-in-app.html">Get started</a>
```

**Migration rule:** The `modal-apply` block wraps both CTAs. The `mobile-app-redirect.commbank.com.au` URLs are external and carried over as-is. The `/digital-banking/apply-in-app.html` path becomes a standard internal link.

### 3. Footnotes / "Things You Should Know"

**Every product page** has a collapsed "Things you should know" section at the bottom. Superscript reference markers (`[1]`, `[*]`, `[+]`, `[##]`, `[~]`) appear throughout the body content and resolve to expanded legal text in this block.

**This is a legal/regulatory requirement — never omit it during import.**

The `footnotes` block uses a Standalone content model:
```
| Footnotes |
|-----------|
| [1] First disclosure text... |
| [*] Second disclosure text... |
```

### 4. Rates Are Dynamic — Not Static HTML

Interest rates on product pages (home loans, savings, credit cards) are **not static HTML** — they are JavaScript-populated from an API or CMS data source. What you see in the scraped HTML may be:
- Template placeholder variables: `#_KEY_LOAN_AMOUNT_#`
- Empty containers that JS fills at runtime
- Stale/cached values in the SSR HTML

**Migration rule:** Use the `rate-display` block (for static rate pairs) or `rate-calculator` block (for interactive calculators). Rate data should be driven from an AEM content fragment or a Sharepoint/Google Sheets data source, not hardcoded.

### 5. Scene7 Image URLs

All images on commbank.com.au are served from Scene7/Dynamic Media:

```
https://assets.commbank.com.au/is/image/commbank/[asset-name]$W780_H416$&fit=crop
```

Standard crop presets:
- `$W375_H200$` — Card thumbnail
- `$W780_H416$` — Hero card / featured content
- `$W728_H432$` — Page hero
- `$W64_H64$` — SVG pictogram (navigation tiles, feature icons)

**Lazy loading:** Images use a base64 GIF placeholder (`data:image/gif;base64,R0lGODlh...`) replaced by Scene7's `s7responsiveImage()` JavaScript function. The scraper must scroll to trigger all lazy loads before extracting HTML.

**Migration rule:** During import, download images from the Scene7 URL (without crop parameters where possible to get the master asset) and save locally. EDS handles responsive sizing natively via its `/media_` URL pipeline. Remove Scene7 crop parameters from final image `src` values.

### 6. Switchblade Navigation API

The mega-menu is **not authored in the page** — it's fetched dynamically at runtime from:
```
https://www.commbank.com.au/innovate/switchblade/v0/
```

The nav is configured via `gloNavGlobalVars` JavaScript object.

**Migration rule:** For the EDS `header` block, the navigation will be authored in a Word/Google Docs navigation document (standard EDS pattern). The Switchblade API data will need to be mapped to EDS nav structure during the initial migration. Do not try to import the header from scraped HTML — skip it (header/footer are excluded from page import scope).

### 7. Business vs Consumer Segmentation

Business pages carry `sara.page.tribe="business"` in the Adobe Data Layer. Consumer pages have `"retail"`.

**Migration rule:** Use path-based segmentation in EDS — business pages live under `/business/` prefix. Configure the EDS `header` block to show appropriate navigation per path prefix.

### 8. AEM Test & Target Mboxes (Personalisation)

Hero sections and key CTAs are wrapped in Target mbox containers:
```html
<div class="mboxDefault" id="CB-HL-HERO">...</div>
```

**Migration rule:** Strip mbox wrapper `<div>` elements during import — extract only the content inside. Personalisation in EDS is handled via the Franklin Experimentation Plugin or RUM-based A/B testing, not Target mboxes.

### 9. ContextHub Personalisation

AEM ContextHub at `/etc/segmentation/contexthub` drives segment-based content variations.

**Migration rule:** ContextHub does not carry over to EDS. Audience-based personalisation should be reimplemented using EDS's native experimentation/personalisation framework (metadata-driven variants).

---

## CBA Navigation Structure

Global header navigation (7 primary items):
1. Banking
2. Home loans
3. Insurance
4. Investing & super
5. Business
6. Institutional
7. CommBank Yello

Authentication nav (top right):
- NetBank
- CommBiz
- CommSec

Utility nav:
- Locate us
- Help & support
- Search

Skip links: `#skipmaincontent`, `#skiplogon`, `#skipsearch`

---

## CBA Footer Structure

```
Column 1 - Quick Links:
  Security & scams | Help & support | Financial assistance | Complaints | Accessibility

Column 2 - About Us:
  About CommBank | Careers | Sustainability | Newsroom | Investor centre

Column 3 - Important Info:
  Important documents | Banking Code of Practice | Cookies policy | Privacy | Modern Slavery

Footer base:
  Acknowledgement of Traditional Owners text
  ©2026 Commonwealth Bank of Australia ABN 48 123 123 124 AFSL 234945
```

---

## CBA-Specific Metadata Properties

Standard EDS metadata applies, plus these CBA-specific properties:

| Property | Source | Notes |
|----------|--------|-------|
| `title` | `<title>` tag — format: `[Page Name] | CommBank` | Strip ` \| CommBank` suffix (add via `title:suffix` in bulk metadata) |
| `description` | `<meta name="description">` | Always present — include verbatim |
| `image` | `<meta property="og:image">` | Scene7 URL — download locally for EDS |
| `robots` | `<meta name="robots">` | Usually `index, follow` — include if non-default |
| `section` | Custom — inferred from URL path | e.g., `home-loans`, `credit-cards`, `newsroom` |
| `tribe` | `sara.page.tribe` in data layer | `retail` or `business` — maps to path prefix in EDS |
| `product-id` | From `mobile-app-redirect` URLs | Needed for `modal-apply` block CTA deep links |
| `article:published_time` | On newsroom articles | ISO 8601 format |
| `article:tag` | On newsroom articles | CBA tag taxonomy: `newsroom:category/[name]` — strip prefix |

---

## CBA Analytics & Tracking

CBA uses dual analytics stacks:
- **Adobe Analytics** via `window.adobeDataLayer` (Adobe Data Layer)
- **Google Tag Manager** via `window.dataLayer`

All CTAs carry `?ei=` event instrumentation:
- Pattern: `?ei=[section]-[subsection]-[action]`
- Example: `?ei=cta-hlhero-appt` (Home Loans hero, appointment CTA)

**Do not attempt to preserve `?ei=` parameters** in imported HTML. CBA will implement a custom EDS analytics block that reads data attributes instead.

---

## Import Scope Reminder

When importing CBA pages with this skill:
- ✅ Import: All main content blocks (hero, product cards, FAQs, rates, footnotes, etc.)
- ❌ Skip: `<header>` (global nav — handled separately as an EDS header block)
- ❌ Skip: `<footer>` (handled separately as an EDS footer block / fragment)
- ❌ Skip: Cookie consent banner, chat widget, Adobe Target mbox wrapper divs
- ❌ Skip: `<script>` tags, inline styles, Analytics tracking pixels
- ⚠️ Always include: `footnotes` block — legal requirement on product pages
