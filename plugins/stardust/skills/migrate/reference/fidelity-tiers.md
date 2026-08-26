# Fidelity tiers (declared coverage/quality contract)

The migrate render branches (Path A approved-prototype, Path A′ canon-forked
sibling, unique render) describe *how* a page is built. **Fidelity tiers**
describe *how much quality assurance it carries* — and make that an explicit,
declared, per-page decision instead of a silent consequence of which branch ran.

The tension this resolves: craft-gating every page through `prototype` (critique
+ audit + anti-template + content-sourcing gates) is unaffordable at 50–100
pages, but generic per-page authoring bypasses **every** quality gate. A real
migration hit exactly this — one page (home) got full craft, ~90 siblings got
faithful generic authoring with no declared gate between them. Tiers name the
trade so a reviewer can see, per page, what was and wasn't checked.

## The three tiers

| Tier | Render branch | Gates it MUST pass | When |
|---|---|---|---|
| **archetype** | Path A (approved prototype) | Full `prototype` gate stack: critique, audit, mobile-adapt, anti-template, content-sourcing, `:root` + data-attribute contracts | One representative page **per template**. The design canon. |
| **sibling** | Path A′ (canon-fork) | Structural clone of the archetype + **content-fidelity** (verbatim source copy, no fabrication, **measured** — § Content-count acceptance) + **delivery-lint** + **media-reconcile**. NOT full craft. | Every other page of a template the archetype already covers. **The cheap default for breadth.** |
| **thin** | unique (graceful) | delivery-lint + media-reconcile + a declared `contentGap`. Renders metadata + hero + whatever real content exists (e.g. a PDF link). No fabricated filler. | Pages with little/no body content (PDF-only, redirect stubs, bodyless landing). |

The point of the table: **archetype is craft-gated once per template; siblings
inherit that validated structure and only re-check the things that vary per page
(content + media + the delivery contract).** That keeps breadth affordable
without dropping to zero gates. Make sibling-clone the path of least resistance —
the reflex for "page N of an established template" should be *fork the archetype*,
never *re-author from scratch*.

## Content-count acceptance (content-fidelity is measured, not asserted)

"Verbatim source copy, no fabrication" needs an instrument, per page, **at
import time**: a real first-pass importer silently dropped slide titles,
tab descriptions, and stats copy on every page of a template, and nothing
caught it until a downstream fidelity gate a day later — after the cheap
moment to fix the importer had passed. The `content-diff` classifier
(`skills/diff/scripts/content-diff.mjs`, summary line) classifies exactly
this failure class, so make it part of the per-page acceptance:

- **Compare role-classified node counts** — headings, body/list nodes,
  CTAs (+hrefs), images — between the captured source
  (`stardust/current/pages/<slug>.json`; migrate is offline after extract,
  so the captured page is the reference, never a fresh live hit) and the
  rendered result. When both sides are renderable URLs (e.g. an imported
  page on a preview origin vs the extract capture served locally), a scoped
  `content-diff` run gives the same summary with per-node detail.
- **A count drop in any role class fails the page's acceptance** unless a
  logged `contentDeviations[]` entry covers it. The page does not advance
  to `migrated`; the remediation is fixing the importer/template while it
  is still cheap, then re-running the page.
- Record the pass as `"content-count"` in the page's `gatesPassed[]`.

This is a counts-level gate by design — cheap enough to run on every
sibling. Per-node structural diffing stays where it lives today (the
archetype's gates, deploy's `block-roundtrip`, replica's source-fidelity
gate); the counts catch the dropped-content class those would only see
later.

## Declaration (per page)

Every page row in `state.json` and `coverage/pages.json` carries:

```json
"fidelityTier": "archetype" | "sibling" | "thin",
"archetypeSource": "<slug>",        // for sibling/thin: which archetype it forked
"gatesPassed": ["delivery-lint", "media-reconcile", "content-fidelity", "content-count"],
"contentGap": "source is a PDF download; no HTML body"   // thin only
```

`inventory.mjs` seeds the tier from the render branch; `migrate` confirms it;
`verify.mjs` reads `delivery.type` (page/fragment/index) independently. Tier and
type are orthogonal — a fragment is always tier `thin` or `sibling`, never an
archetype.

## Coverage reporting

The rollout dashboard surfaces the **tier distribution**, not just delivery
status, so "92/92 deployed" can't hide "1 craft-gated, 91 ungated". A healthy
distribution is one archetype per template with the rest as siblings; a run with
many `unique`/`thin` pages for what should be one template signals a missing
archetype (the template was never craft-gated — fix by prototyping it, then
re-forking its siblings).

> Silent-cap rule: if breadth forces dropping a tier (e.g. delivering siblings
> without an approved archetype because the template was never prototyped),
> `log()` it as a coverage gap. An ungated page that reads as "deployed" is the
> failure this tier model exists to make visible.

## Why declared, not inferred

A tier the reviewer can read is a tier the reviewer can challenge. The migration
prompt's "invoke prototype, never hand-author" rule is really "every page is at
least sibling-tier — forked from a craft-gated archetype". Declaring the tier per
page turns that from a hope into an auditable record, and turns the
quality/coverage trade from an accident into a decision.
