# Eval: reskin — byte-faithful content onto a donor design system

## Setup

A clean project. Network access to two stable public sites: a content-rich
CONTENT site and a visually distinct DONOR site (the eval runner pins the
pair; structure drift is expected maintenance). Impeccable installed. Node +
Playwright available.

## User prompt

"$stardust reskin — rebuild https://<content-site-page> with the design of
https://<donor-site>"

## Expected behavior

The `stardust:reskin` skill is invoked. It:

1. **Ingests the donor** via `stardust:extract` with `--design-source`
   (unchanged skill), landing the donor capture in `stardust/canon-source/`;
   when the donor runs multiple design systems, one donor reference page is
   pinned per module family and the pin is recorded.
2. Captures the **content model** of the content page with
   `capture-content.mjs` → `stardust/reskin/content-model/<slug>.json`:
   slot-granular text, CTAs with absolute hrefs, ordered visible images,
   full SEO metadata, an explicit content-root scope declaration, and an
   executable normalization ledger shared verbatim with the gate. The scope
   coverage diagnostic is consulted (a silent 30% content drop is the pinned
   failure mode).
3. Writes the **mapping brief** at `stardust/reskin/mapping.md`: every
   content slot gets a donor module id + rationale + status
   (mapped / new-module / chrome); ≥80% of slots are mapped; new modules are
   explicitly composed from donor tokens; nothing is silently improvised.
4. **Renders programmatically**: the reskin page is generated from
   content-model.json by a renderer (model strings interpolated, never
   retyped); the surface comes from donor tokens + donor module patterns.
5. Runs the **dual gates** and records results: content gate —
   `dom-equality.mjs` (text bytes + ordered images gating, structure
   informational, shared normalization) + `slot-coverage.mjs` (every model
   slot present, metadata carried verbatim); design-adoption gate —
   `donor-probe.mjs` token assertions (selector-missing = FAIL) + overflow
   sanity at 1440/360. One fix iteration, then residuals are logged.
6. Hands off to migrate (donor-pinned target, sibling tier) / deploy /
   rollout unchanged; reskin state stays under `stardust/reskin/`.

## Failure modes this eval pins against

- Retyping or paraphrasing content (any text delta not covered by the
  normalization ledger or a documented chrome swap).
- Dropped slots or images; metadata not carried.
- Silent invention of layout patterns absent from the donor vocabulary.
- Donor token drift (colors/type/buttons not matching donor-tokens.json).
- Capturing content with a naive scope and losing whole sections.
- Modifying extract, migrate, deploy, or the core state machine.
