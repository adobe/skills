# Journal — Ledgerline redesign

Chronological log of every prompt execution. Most recent at the bottom.
See `skills/stardust/reference/journal-format.md` for entry format.

---

## 2026-07-21T09:47:30Z — Extracted ledgerline.com (5 pages)

**Prompt:** User asked to extract https://www.ledgerline.com as the starting point for a redesign.

**Decisions:**
- Default 5-page cap kept; selected home, features, pricing, about, contact from 23 discovered pages.
- Register read as `brand` (marketing hero, social proof, pricing, demo CTA, no auth wall).

**Artifacts touched:**
- stardust/current/pages/*.json — created (5 pages, all live Playwright renders)
- stardust/current/_brand-extraction.json — created
- stardust/current/PRODUCT.md, DESIGN.md, DESIGN.json — created (descriptive snapshot)
- stardust/state.json — created (5 pages `extracted`)

**Findings worth flagging:**
- Site ships zero CSS custom properties and loads no webfonts (Georgia/Arial system stacks only) — the current system is coherent but dated.
- "Request a demo" is the single conversion verb site-wide (11 instances, 5 pages).

**Open questions:**
- none

**Next:** $stardust direct — resolve a redesign direction.

---
