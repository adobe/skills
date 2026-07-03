# Round-1 report — three new use cases: validated approaches + proposed skills

> 2026-07-03. Companion to `DESIGN-OPTIONS.md` (research synthesis + pre-registered hypotheses).
> All three validation experiments ran to completion; verdicts below. Experiment folders:
> `/Users/paolo/stardust/uc1-replica-test/`, `uc2-reskin-test/`, `uc3-genesis-test/`
> (each has a `VALIDATION.md` with full evidence).
> Round-1 constraint held: no existing skill was modified; every proposal ships as a new skill
> that consumes existing skills/scripts in place.

## Verdict summary

| Hypothesis | Verdict | Headline evidence |
|---|---|---|
| H1 clean re-authored replica reaches near-pixel fidelity ≤3 iterations | **CONFIRMED** | aesop.com: pixel-diff 8.31% → 2.93% → **1.31%**, height Δ 0px, content-diff "findings: none" (198/198 nodes, 59/59 CTAs) |
| H2 source-fidelity gate buildable from existing diff scripts + small pixel add-on | **CONFIRMED** | generic profile worked; 4 adaptations needed (see UC1 notes) |
| H3 direction step can be mechanical (current → target) | **CONFIRMED** | zero creative decisions; only measurement-policy calls |
| H4 faithful-content reskin in one archetype pass | **CONFIRMED** | hirslanden × stripe: text byte-identical 2281/2281, 7/7 images, 47/47 slots, 13/13 metadata, 17/17 donor-token probe |
| H5 cross-origin mapping brief decidable (≥80% mapped) | **CONFIRMED** | 91% mapped to named donor modules, 1 explicit new-module, 0 silent improvisation |
| H6 dom-equality adoptable as content gate | **CONFIRMED** | adapted with structure checks informational; shared normalization module capture↔gate |
| H7 variant fan-out + axis pinning → distinct non-slop variants | **CONFIRMED** | pairwise axis distance 5/5/5; pins byte-verified; 1 variant partially collapsed via anchor↔signature incoherence (→ new gate) |
| H8 heterogeneous inputs measurably steer direction | **CONFIRMED** | 9/9 pool picks changed baseline→informed, all cited; photos falsified the text brief's vibe |
| H9 refero grounding without convergence | **PARTIAL** | screens grounded structure cleanly; styles search leaked into personality picks → firewall needed |

Discarded in round 1: **UC1-C** snowflake overlay as UC1 mainline (byte-fidelity without
re-implementation value — kept as escape hatch); **UC1-B** CSS-portation as default (kept as a
scoped reserve, see below); **UC3-B** thin nebula wrapper (fails multi-input + pinning brief).

---

## UC1 — PROMOTED: `stardust:replica` (same-design migration to AEM)

**Flow** (new skill orchestrating existing ones, no core changes):
1. `extract --prep` unchanged → inventory, page types, module candidates, screenshots, fonts, media.
2. **Mechanical direction promotion** (inside replica): `stardust/current/{PRODUCT,DESIGN}.{md,json}`
   promoted verbatim as target spec. Permitted deltas only from an **inconsistency register**
   (audit design findings and/or user-supplied list), `brand_adjacent_refinements[]`-shaped.
3. **Recreation loop per archetype**: clean semantic HTML/CSS authored from captured content +
   values lifted from the source site's own CSS + screenshot ground truth. Gated by the
   **source-fidelity gate** (below), ≤3 iterations per breakpoint pass.
4. `migrate` (sibling tier) → `deploy` (bias toward template-slotted decode) → `rollout`
   (block dedup already implements "same blocks across the whole site").

**Source-fidelity gate** (new scripts owned by replica; consumes diff scripts in place):
- `content-diff.mjs` + `visual-diff.mjs` `--profile generic`, live URL vs served prototype.
- Pixel probe: **scroll-and-stitch** capturer (Chromium `fullPage:true` renders lazy-decoded
  images as placeholders — stitching is mandatory) + pixelmatch; navigate by the **per-500px band
  breakdown**, not the overall %. Pass bar used: ≤~10% pixels, 0 structural 🔴, all visual flags justified.
- Hardening required (H2 evidence): `domcontentloaded` instead of `networkidle` (live sites never
  idle); **real-Chrome UA** (default UA gets a Cloudflare challenge page that the diff then
  silently measures as the source — false-measurement trap); symmetric `--main` scoping.

**Design notes from the experiment:**
- Two things computed-style capture missed and only the gate caught: rendered heading face living
  on an inner span (width-probe font fork caught it), and a hero scrim invisible to DOM/style
  probes (recovered by per-row luminance fitting). Keep both probes in the gate.
- "0 structural 🔴" required mirroring live DOM quirks (span-in-heading granularity, hidden
  carousel clones, sr-only labels) — the known #87 JOIN/SPLIT tension; replica needs a documented
  "granularity parity" policy rather than fighting it per page.
- **Mobile is not free**: 360px reference diff was 24% — the gate runs per breakpoint.
- "Capture-state" policy: CDN-403'd images and "Loading…" hydration states are replicated as
  captured, logged, and flagged for the delivery phase.
- **CSS-portation reserve** (from UC1-B): only for paint-level effects, JS-hydrated commerce
  components, and video/animated heroes — per-section, never page-level.
- Prior art to fold into the skill text: heathrow `SKILL-IMPROVEMENTS.md` (fidelity-by-CSS-
  extraction, neutralize boilerplate block CSS, preserve-and-move, coverage guards) and the
  hirslanden archetype→sibling scale pattern.

## UC2 — PROMOTED: `stardust:reskin` (existing content × defined new design)

**Flow:**
1. **Donor ingestion**: live URL → the existing `--design-source` capture shape; local static
   prototypes → same path served on localhost; Figma → adapter (Figma MCP: variables→palette,
   text styles→type, screenshots→vision refs; new provenance class) — Figma adapter is round-2
   scope, the contract is defined now.
2. **Content-model capture** of the content site (new profile, the round-1 gap): slot-granular
   text, CTAs with absolute hrefs, ordered visible images, metadata, an explicit content-root
   scope declaration, and an **executable normalization ledger** (cookie chrome, carousel
   de-duplication) shared between capture and gate.
3. **Mapping brief** (per content slot): donor module id + rationale + status ∈ {mapped,
   new-module, chrome}; gate: ≥80% mapped, new-modules explicit, zero silent improvisation.
4. **Programmatic render** from `content-model.json` — never retype strings; byte fidelity holds
   by construction. Donor tokens + module patterns supply the surface.
5. **Dual gates**: adapted dom-equality (text bytes + ordered image set; structure informational)
   + slot coverage + metadata carry-over; donor-token computed-style probe. Then migrate/deploy/
   rollout unchanged.

**Guards from the experiment:** content-root discovery (naive scoping silently dropped 30% of
content), carousels break byte determinism (normalize at both ends), donors running multiple
design systems concurrently (pin one donor reference page per module).

## UC3 — PROMOTED: `stardust:genesis` (greenfield creative, Claude-Design-as-skill)

**Flow:**
1. **Input dossier**: any mix of text brief / site URLs / brand images / Figma / inspiration URLs /
   refero — each an origin with citations; conflicts recorded and resolved explicitly (photos can
   outvote the text brief — that happened and was correct).
2. **Direction via nebula machinery as a read-only library** (`stardust-greenfield` pools, anchor
   selection, register, tension, distinctiveness gate). **Refero firewall**: screens = structure
   evidence only; styles search = category/avoid evidence; personality cites non-web anchors + register.
3. **Variant fan-out**: `variants.json` with **6 pinnable slots** (typography, density, substrate,
   accent, motion, edges — colour split into substrate/accent); pairwise axis-distance floor ≥2;
   **anchor-promotion policy** (variant anchors = direction's scored winner + runner-ups — gave
   distance 5 for free); named tension per variant.
4. **Renders + contact sheet** as first-class artifact: ≥2 scroll states per variant
   (hero-blindness finding: re-rolls can be invisible at rest) + axis table + a "what moves" line.
5. **Pin + re-roll loop**: constrained resample (register bias, signature anti-pairs re-run —
   V11×S14 collision was caught this way, tech budget); plus one **qualitative anchor↔signature
   coherence gate** (the instrument gap that let variant C partially collapse).
6. Optional back half: pinned winner → stardust prototype/migrate/deploy for multi-page delivery.

**Open items (round 2):** image generation hook; pool content debt surfaced as findings (edges
pool has no playful posture; registers/gestures stubs forced substitutions); precedence decision
where impeccable's "overused font" hook flags pool-curated picks (genesis must declare which
instrument wins); nebula upstream is one unpushed commit ahead of GitHub — sync before depending on it.

---

## Round-2 synergy candidates (deliberately NOT done in round 1)

- `extract`: content-model capture profile; `--design-source-dir`; Figma provenance class.
- `direct`: native preserve mode (replaces replica's mechanical promotion).
- `diff`: absorb the pixel probe + UA/wait hardening + granularity-parity policy (#87).
- nebula pools upstreamed/shared; refero firewall generalized to uplift/direct Mode B.
- Evals: none of the seven existing evals cover these flows — each new skill needs its own.
