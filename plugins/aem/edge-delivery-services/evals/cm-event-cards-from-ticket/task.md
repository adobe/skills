# Event Cards Block for the Events Landing Page

## Problem/Feature Description

Brightline Learning runs its marketing site on AEM Edge Delivery Services. Content is authored in Google Docs by a team of marketing coordinators. You picked up this ticket:

> **WEB-1423 — Events landing: "event cards" grid**
>
> The events landing page needs a grid of event cards (3 per row on desktop, 1 per row on mobile). Each card has:
>
> - **Image** — 16:9 photo. Optional; when missing, the card shows a brand pattern background instead.
> - **Eyebrow** — event type, e.g. "Webinar", "Workshop", "Conference".
> - **Title**
> - **Description** — 1–3 sentences; sometimes contains bold text or an inline link.
> - **Date** — e.g. "March 14, 2025", plus an optional time ("10:00 AM PT").
> - **Location** — a city, or "Online".
> - **CTA button** — "Register", links to the registration page. Optional: past events have no CTA.
> - **"Sold out" badge** — shown on some cards.
>
> Marketing adds and removes events every week and re-sorts the grid when dates change. Coordinators often copy event details from the event platform's confirmation emails into the doc. A page typically has 6–12 events.

The designer attached the target markup for one rendered card (see input file).

## Output Specification

- Write `MODEL.md` describing the content model: an example of how an author writes the block in the document (as a text table or markdown grid) containing at least three events — one without an image, one past event without a CTA, and one sold-out event — followed by a 2–5 sentence rationale.
- Write the block's JavaScript at `blocks/event-cards/event-cards.js` (default-exported `decorate(block)`). CSS is not needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: design/event-card-target.html ===============
<!-- Target rendered markup for ONE card, from the design team -->
<li class="event-card">
  <div class="event-card-image">
    <picture><img src="..." alt="Speaker on stage"></picture>
  </div>
  <div class="event-card-body">
    <span class="event-card-eyebrow">Workshop</span>
    <h3 class="event-card-title">Hands-on Data Storytelling</h3>
    <p class="event-card-description">Learn to turn dashboards into <strong>decisions</strong> in this 2-hour session.</p>
    <ul class="event-card-meta">
      <li class="event-card-date">March 14, 2025 · 10:00 AM PT</li>
      <li class="event-card-location">Online</li>
    </ul>
    <span class="event-card-badge">Sold out</span>
    <a class="button primary" href="https://events.brightline.example/register/4411">Register</a>
  </div>
</li>
