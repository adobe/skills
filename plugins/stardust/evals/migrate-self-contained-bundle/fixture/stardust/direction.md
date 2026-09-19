<!-- stardust:provenance
  writtenBy: stardust:direct
  writtenAt: 2026-07-21T10:32:00Z
  readArtifacts:
    - stardust/state.json
    - stardust/current/_brand-extraction.json
    - stardust/current/PRODUCT.md
    - stardust/current/DESIGN.md
  synthesizedInputs: []
  stardustVersion: 0.10.0
-->
---
title: "make it more expressive for a young audience"
resolvedAt: 2026-07-21T10:32:00Z
toolkitVersion: "v1.0 (stardust v2)"
schemaVersion: 1
---

# Active direction (2026-07-21T10:32:00Z)

## Phrase

> make it more expressive for a young audience

## Restatement

Move the site from a restrained, familiar, serious institutional
register toward a committed and distinctive one with a playful edge,
without touching the audit-grade trust claim that is the product. The
audience shifts to Gen Z college students and early-career people doing
their own books for the first time, so the visual system must read as
a well-designed notebook rather than a filing cabinet. Structure may be
reimagined; content stays verbatim.

## Movements

- **register** — `brand` (inherited from `current/PRODUCT.md`)
- **expressive axis** — `restrained` → `committed` (moved by phrase)
- **tone** — `serious` → `playful` (implied by "young", capped by the
  trust claim)
- **density** — `balanced` (resolved via one-shot question)
- **distinctiveness** — `familiar` → `distinctive` (implied by
  "expressive")
- **audience** — Gen Z college / first-job, 18–24 (resolved via Q1)
- **ia-fidelity** — `reimagined` (resolved via one-shot question)
- **constraints** — content verbatim; wordmark retained; palette and
  type may change (user confirmed)

## Gaps and questions

1. **Q:** Sharpen "young" — pick the closest: (a) Gen Z college /
   first-job, (b) millennial professionals 25–35, (c) digital-native
   parents 30–40, (d) other.
   **A:** (a) — Gen Z college students and early-career people, roughly
   18–24: first-time founders, freelancers, side-hustlers.

2. **Q:** Should the design feel native to a specific cultural
   reference set? (Examples: indie publishing, gaming, streetwear,
   study-tube.) Optional.
   **A:** "skip — you decide."

## Anchor references

- (none)

## Anti-references

- The Generic-2026-SaaS silhouette (toolkit § 1) — guardrailed because
  "expressive for a young audience" is the most common trigger for it.
- Playful neobank marketing (gradient heroes, illustration systems) —
  named in `current/PRODUCT.md` as what the brand avoids; the redesign
  moves toward expression without adopting that kit.

## Divergence inputs

- **seed** — `Ledgerline|2026-07-21` MD5 →
  `1990s × Riso print × Zine × monochrome-tint`
- **picked_by** — `deterministic`
- **font deck** — `bauhaus-functional` (Space Grotesk · Martian Mono ·
  Roboto Slab)
- **palette** — `Midnight Sky` (picked from library v0.7.0, source:
  `https://coolors.co/27187e-758bfd-aeb8fe-f1f2f6-ff8600`);
  recommended_index = 0, picked_index = 0. Roles renamed brand-native:
  Ledger, Carbon Copy, Tracing Paper, Graph Paper, Highlighter.
- **anti-toolbox audit** — 1 hit (Monospace for metadata as a
  load-bearing device), justified: figures are the product.
- **brand-faithful inversions** — none. Rebrand mode: the captured
  palette (navy on pure white) and type (Georgia / Arial) are replaced
  with the user's confirmation; pure white is not retained.

## Command sequence (proposed)

1. `$stardust direct` (this command — write the direction + tokens)
2. `$impeccable shape stardust/current/pages/home.json` — Design Brief
   anchored on the first-time-founder audience
3. `$impeccable craft` — primary expressive pass (notebook-margin
   composition, marker underline, figure chips)
4. `$impeccable colorize` — apply the Midnight Sky-derived palette
5. `$impeccable typeset` — apply the bauhaus-functional deck
6. `$impeccable critique` — verify the move landed without slop
7. `$impeccable polish` — final pre-ship pass

## User confirmation

> "go"

## Pages in scope

- `home`, `features`, `pricing`, `about`, `contact` (the 5 pages
  marked `extracted`; none require auth)
