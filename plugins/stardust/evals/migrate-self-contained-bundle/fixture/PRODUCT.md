<!-- stardust:provenance
  writtenBy: stardust:direct
  writtenAt: 2026-07-21T10:31:20Z
  readArtifacts:
    - stardust/current/PRODUCT.md
    - stardust/current/_brand-extraction.json
    - stardust/current/pages/home.json
    - stardust/current/pages/pricing.json
  synthesizedInputs: []
  stardustVersion: 0.10.0
  note: TARGET product record for the redesign. Confirmed product facts are
        carried from stardust/current/PRODUCT.md; the audience and brand
        commitments reflect the direction resolved in stardust/direction.md.
-->

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary (new, per direction): Gen Z college students and early-career
people, roughly 18–24 — first-time founders, freelancers and
side-hustlers doing their own books for the first time. They have never
used accounting software, distrust anything that looks like their
parents' finance tools, and evaluate on the phone first.

Secondary (retained): small-business owners, in-house controllers and
CPAs at accounting firms — the audience the captured site addresses and
the "Firm" tier still serves.

## Product Purpose

Ledgerline is double-entry bookkeeping software for growing businesses:
automatic bank reconciliation, audit-ready reporting and accountant
collaboration in one place. Success is a faster, more trustworthy
month-end close — and, for the new self-serve tier, a first-time founder
who closes their own books without being intimidated.

## Positioning

The books a real accountant will sign off on, without the software
looking like it was built for the accountant. Consumer-fintech apps are
friendly but not audit-grade; legacy accounting vendors are audit-grade
but not friendly. Ledgerline claims both.

## Operating Context

Marketing site (register: brand). Visitors arrive from search, campus
programmes and referrals; the conversion path is "Request a demo" for
the sales-led tiers and "Start 30-day trial" for self-serve. The product
itself is a web app; the site never shows the authenticated experience.

## Capabilities and Constraints

- Confirmed functionality (captured copy): automatic reconciliation of
  bank feeds, GAAP-aligned reports exported to PDF and XLSX with a
  per-line change log, accountant read/write access with attribution,
  per-entity pricing (Starter, Growth, Firm).
- Content stays verbatim: headlines, body copy, CTA labels, prices and
  FAQ answers come from `stardust/current/pages/*.json`. The direction
  authorises no copy rewrites.
- Undecided: whether the self-serve tier gets its own page. Out of scope
  for this direction; the five captured pages are the scope.

## Brand Commitments

- Name and wordmark ("Ledgerline") are retained; the logo mark in
  `stardust/current/assets/logo.svg` is reused at its captured
  proportions.
- The palette and type system are **replaced** (user confirmed: the
  navy-and-Georgia look is what reads as dated). The blue lineage
  survives as a deep indigo primary so the brand stays recognisable.
- Voice stays factual and evidence-led; it becomes direct and second
  person where the captured copy already is, but no new copy is
  written in this pass.

## Evidence on Hand

- Captured pages, screenshots and media under `stardust/current/`.
- One customer quote (Northwind Supply) and two customer logos on the
  home page; three pricing tiers with public prices; three FAQ pairs.
- No statistics beyond "4,200 finance teams" (captured); no awards,
  addresses or phone numbers — future work must not invent any.

## Product Principles

- **Trust is the product; expression is the wrapper.** Every expressive
  move must leave the audit-grade claim intact and legible.
- **Numbers are the hero.** Figures, prices and reconciliation states
  get typographic emphasis instead of decoration.
- **Say it once, plainly.** Keep the single conversion verb per
  audience; do not multiply CTAs to feel energetic.
- **Phone first.** Every composition must survive a 390px viewport
  before it earns its desktop flourish.

## Accessibility & Inclusion

WCAG 2.2 AA is the floor (contrast, focus visibility, heading order,
visible form labels — the captured site already passes on contrast and
labels). Add a skip link; keep motion opt-in and reduced-motion aware.
