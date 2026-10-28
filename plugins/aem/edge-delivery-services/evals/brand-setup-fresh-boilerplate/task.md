# Brand Setup on a Fresh EDS Boilerplate

## Problem/Feature Description

Acme Outdoor is migrating its retail website to AEM Edge Delivery Services. A developer has just
created the EDS project from the aem-boilerplate and nothing has been styled yet. Before pages are
imported, the project should take on Acme's brand basics — colors, fonts, font sizes, header
height, favicon and logo — so previews already look like Acme.

A teammate has already loaded Acme's site in a browser (home page plus two inner pages, at 1440 px
and 375 px, cookie banner dismissed) and saved the readings and downloaded files below. Treat
`browser-readings.md` as the browser data for this task; there is no live site to visit.

## Output Specification

Update the project in place so it carries Acme's brand basics, then write a short report to
`BRAND-REPORT.md` listing each value written and where it came from, what was left unchanged and
why, font licensing notes, and brand traits that were measured but not written.

Only the project files that need to change should change.

## Input Files

The following files are provided as inputs. Extract them before beginning. Binary files appear
only as directory listings: create each listed file as a one-line text placeholder naming it, and
treat placeholders as the real files (copy, move or delete them as you would the binaries). Files
under `downloads/` stand for files the teammate downloaded from Acme's site.

=============== FILE: styles/styles.css (excerpt, top of file; the rest is unchanged boilerplate) ===============
:root {
  /* colors */
  --background-color: white;
  --light-color: #f8f8f8;
  --dark-color: #505050;
  --text-color: #131313;
  --link-color: #3b63fb;
  --link-hover-color: #1d3ecf;

  /* fonts */
  --body-font-family: roboto, roboto-fallback, sans-serif;
  --heading-font-family: roboto-condensed, roboto-condensed-fallback, sans-serif;

  /* body sizes */
  --body-font-size-m: 22px;
  --body-font-size-s: 19px;
  --body-font-size-xs: 17px;

  /* heading sizes */
  --heading-font-size-xxl: 55px;
  --heading-font-size-xl: 44px;
  --heading-font-size-l: 34px;
  --heading-font-size-m: 27px;
  --heading-font-size-s: 24px;
  --heading-font-size-xs: 22px;

  /* nav height */
  --nav-height: 64px;
}

/* fallback fonts */
@font-face {
  font-family: roboto-condensed-fallback;
  size-adjust: 88.82%;
  src: local('Arial');
}

@font-face {
  font-family: roboto-fallback;
  size-adjust: 99.529%;
  src: local('Arial');
}

@media (width >= 900px) {
  :root {
    /* body sizes */
    --body-font-size-m: 18px;
    --body-font-size-s: 16px;
    --body-font-size-xs: 14px;

    /* heading sizes */
    --heading-font-size-xxl: 45px;
    --heading-font-size-xl: 36px;
    --heading-font-size-l: 28px;
    --heading-font-size-m: 22px;
    --heading-font-size-s: 20px;
    --heading-font-size-xs: 18px;
  }

=============== FILE: styles/fonts.css ===============
/* stylelint-disable max-line-length */
@font-face {
  font-family: roboto-condensed;
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('../fonts/roboto-condensed-bold.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: roboto;
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('../fonts/roboto-bold.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: roboto;
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('../fonts/roboto-medium.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: roboto;
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/roboto-regular.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

=============== FILE: head.html ===============
<meta
  http-equiv="Content-Security-Policy"
  content="script-src 'nonce-aem' 'strict-dynamic' 'unsafe-inline' http: https:; base-uri 'self'; object-src 'none'; frame-src 'self' https:; require-trusted-types-for 'script';"
  move-to-http-header="true"
/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<script nonce="aem" src="/scripts/aem.js" type="module"></script>
<script nonce="aem" src="/scripts/scripts.js" type="module"></script>
<link rel="stylesheet" href="/styles/styles.css"/>

=============== FILE: fonts/ (directory listing) ===============
roboto-bold.woff2
roboto-condensed-bold.woff2
roboto-medium.woff2
roboto-regular.woff2

=============== FILE: downloads/ (directory listing) ===============
favicon.ico          (from https://www.acme-outdoor.example/favicon.ico, 16x16 + 32x32, image/x-icon)
acme-logo.png        (from https://cdn.acme-outdoor.example/img/acme-logo.png, 360x72, image/png)
inter-400.woff2      (from https://fonts.gstatic.com/s/inter/v13/inter-latin-400.woff2)
inter-600.woff2      (from https://fonts.gstatic.com/s/inter/v13/inter-latin-600.woff2)

=============== FILE: browser-readings.md ===============
# Readings from https://www.acme-outdoor.example/ (+ /about/, /journal/trail-guide/)

## Head
- No <link rel="icon"> or apple-touch-icon in any page. GET /favicon.ico -> 200 image/x-icon.
- <meta name="theme-color" content="#1f4d3a">

## Header (1440 px)
- Promo bar at top: height 32px, background #e8b04b.
- Main navigation bar below it: height 72px (logo + main links). At 375 px: 60px.
- Logo: <a href="/"><img class="site-logo" alt="Acme Outdoor" src="/img/acme-logo.png"></a>
  rendered 180x36 at top 50px. No inline SVG logo.

## Computed styles (same on all three pages unless noted)
- body background-color: rgb(255, 255, 255); html/main transparent
- main p color: rgb(34, 34, 34); font-family: "Inter", Arial, sans-serif; font-size 18px @1440, 16px @375
- main p strong font-weight: 600 (Inter 600 face)
- main p a color: rgb(31, 77, 58); while hovered: rgb(20, 51, 38)
- figcaption / nav links font-size: 15px @1440, 14px @375
- footer legal text font-size: 13px @1440, 12px @375
- alternating sections + footer background: rgb(244, 241, 234)
- primary button: background rgb(31, 77, 58); hovered rgb(15, 38, 29); color #fff; border-radius 4px; padding 12px 24px
- headings font-family: "Halden Display", Georgia, serif; font-weight 700

| level | 1440 px | 375 px | visible count (3 pages) |
|---|---|---|---|
| h1 | 56px | 36px | 3 |
| h2 | 32px | 26px | 9 |
| h3 | 40px | 28px | 4 |
| h4 | 22px | 20px | 6 |
| h5 | 18px | 16px | 2 |
| h6 | not present | not present | 0 |

(A hidden h1 "Acme Outdoor" with clip: rect(0 0 0 0) and font-size 14px exists on every page.)

## Fonts (document.fonts loaded + network)
- Inter 400, Inter 600 — from fonts.gstatic.com (Google Fonts CSS API)
- Halden Display 700 — from use.typekit.net (Adobe Fonts kit, commercial)
- Sample sentence width at 32px: Inter 512px vs Arial 498px; Halden Display 540px vs Georgia
  576px (Times New Roman 560px)
