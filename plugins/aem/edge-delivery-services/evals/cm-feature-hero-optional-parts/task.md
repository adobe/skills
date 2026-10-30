# Feature Hero With Many Optional Parts

## Problem/Feature Description

Ostara Mobility (e-bikes) is building a new design system on AEM Edge Delivery Services. Authors use Word (SharePoint). The design team handed over the spec for a `feature-hero` component used at the top of campaign and product pages:

> **Component: Feature Hero**
>
> | Field | Required | Notes |
> |---|---|---|
> | Background media | No | Full-bleed photo **or** a muted looping MP4 (hosted on our video CDN). If none, solid brand color. |
> | Eyebrow | No | Short label above the headline, e.g. "New for 2025" |
> | Headline | Yes | Page's main heading |
> | Subheadline | No | One line |
> | Body | No | 1–2 short paragraphs |
> | Primary CTA | No | Filled button |
> | Secondary CTA | No | Outline button; only used together with a primary CTA |
> | Legal disclaimer | No | Small print under the CTAs, e.g. "*Financing subject to approval." |
> | Product image | No | Transparent PNG cut-out of the bike, shown beside the text (desktop) / below it (mobile). Can be combined with a background photo. |
> | Theme | Yes | Light or Dark (text color) |
> | Alignment | Yes | Text left or centered |
> | Height | Yes | Standard or Tall |
>
> Usage reality: about half of the campaign pages only have a headline, a sentence and one CTA. Product pages usually use the product image and no background.

## Output Specification

- Write `MODEL.md` with the authored structure (text tables / markdown grids): one example using most of the parts (background photo, eyebrow, headline, body, both CTAs, disclaimer, product image) and one minimal example (headline + one sentence + one CTA). Follow with a 2–5 sentence rationale.
- Write `blocks/feature-hero/feature-hero.js` (default-exported `decorate(block)`). CSS is not needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: design/feature-hero-target.html ===============
<!-- Target rendered markup (all parts present) -->
<div class="feature-hero dark tall align-left">
  <div class="feature-hero-background">
    <picture><img src="trail.jpg" alt=""></picture>
    <!-- or: <video autoplay muted loop playsinline src="https://video.ostara.example/campaign.mp4"></video> -->
  </div>
  <div class="feature-hero-content">
    <p class="feature-hero-eyebrow">New for 2025</p>
    <h1>The Ostara Ridge</h1>
    <p class="feature-hero-subheadline">Our lightest full-suspension e-MTB</p>
    <p>Ride further on a single charge with the new 720 Wh battery.</p>
    <p class="button-container">
      <a class="button primary" href="https://www.ostara.example/ridge">Configure yours</a>
      <a class="button secondary" href="https://www.ostara.example/test-ride">Book a test ride</a>
    </p>
    <p class="feature-hero-legal">*Financing subject to approval.</p>
  </div>
  <div class="feature-hero-product">
    <picture><img src="ridge-cutout.png" alt="Ostara Ridge e-bike"></picture>
  </div>
</div>
