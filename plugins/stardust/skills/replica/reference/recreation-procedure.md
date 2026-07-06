# Recreation procedure (clean re-authoring against a live original)

Replica's Phase 3: author one clean prototype per page type that the
source-fidelity gate can pass. This is **recreation, not redesign** — the
craft skill's redesign gates (critique, anti-template, divergence,
distinctiveness) do not apply and must not be invoked; the gate replaces
them. The failure mode this doc exists to prevent is *taste leaking in*: any
"improvement" without an inconsistency-register entry is a fidelity bug.

## Authoring order

Per archetype, in this order — the order matters because each step removes a
class of guesswork before the next begins:

1. **Content skeleton from the captured page JSON.** Lay out the section
   sequence and every text node verbatim from
   `stardust/current/pages/<slug>.json` (headings, body, CTAs with hrefs,
   alt text, metadata). Content-preservation rules
   (`../../migrate/reference/content-preservation.md`) apply from line one.
2. **Lift exact values from the source site's own CSS** (§ CSS lifting).
3. **Fonts** (§ Fonts policy).
4. **Compose against the captured screenshot** — the ground truth for
   everything CSS doesn't name: image crops, composition, stacking, paint
   effects.
5. **Serve locally and enter the gate loop**
   (`source-fidelity-gate.md`) — do not eyeball-polish first; the first gate
   run is the map of what's wrong.

Keep the markup clean: semantic elements, BEM-ish classes, CSS custom
properties for the lifted tokens, no JS unless a section's initial state
requires computing it (see § Carousels) or the live chrome morphs with
scroll (see § Fixed and sticky chrome — the one instrument-induced
exception). Adopt the live page's content-root
class on the prototype's main wrapper so one `--main` selector scopes both
sides of the diff symmetrically.

## CSS lifting — fidelity values come from the original site's CSS, not the eye

(Prior art: heathrow SKILL-IMPROVEMENTS §3.6; re-confirmed in UC1-E1 where
per-element computed-style capture "did most of the work".)

Before any screenshot-eyeball tuning:

1. **Fetch the live stylesheets** (curl or Playwright response capture —
   CDN-defended sites 403 direct curl; intercept the page's own responses
   instead, see § Asset harvest).
2. **Lift the exact values** into a tokens file (`capture/tokens.json`
   pattern): container max-widths, the full type ramp (family / size /
   line-height / letter-spacing / weight per level), button specs (border,
   radius, padding — the whole spec, not just color), section paddings,
   radii, shadows, hero heights, breakpoint values.
3. **Replicate the container model**, not just the tokens: left-offset vs
   centered hero content, %-of-viewport heights, grid gutters. The container
   model is where "looks close but drifts" comes from.
4. **Capture per-element computed styles** for the elements the gate will
   measure (headings, CTAs, section wrappers). Computed styles resolve the
   cascade the stylesheets only imply.
5. **Repeat 2–4 at EVERY gate breakpoint, not just desktop — the 360
   layout is NOT derivable from the 1440 recreation.** Mobile is its own
   authoring pass, not a shrink of desktop: lift the source's mobile
   `@media` geometry (container model, hidden/restacked blocks, mobile nav,
   grid collapse rules) up front and build 360 against it. Capture
   per-element computed styles at 360 (and any other gate width) BEFORE
   authoring — the 360 gate map is not the moment to discover the mobile
   container model. Recorded twice: hay.dk's 1440-lifted prototype
   converged desktop in one iteration but opened mobile at 26.8% (an
   `overflow:hidden` whose only layout effect is margin-collapse containment
   at mobile, a different mobile footer container model, a block hidden at
   mobile — all sitting in the source CSS, discoverable up front); and
   carhartt-wip, where an essentially unbuilt 360 layout measured
   **−1600px height delta** at 360 vs −169px at 1440 — a desktop-only
   recreation doesn't degrade gracefully at mobile, it collapses. With
   per-breakpoint lifting, mobile converges in 1–2 iterations; without it,
   expect the full iteration cap.

This converts 3–4 guess-and-screenshot loops into one. Eyeballing is for
step 4 of the authoring order only — and even then, the gate's instruments
outrank the eye.

### Two probe classes DOM/style capture misses

Both were caught only by the gate in UC1-E1; check for them proactively:

- **Rendered-face font forks on inner spans.** An element computes family X
  while its inner span renders family Y (and sometimes a different size —
  31px span in a 30px heading). Computed-style capture of the element lies;
  the content-diff **width probe** catches it. When the gate reports a 🟠
  font fork on a heading you "captured correctly", inspect the live node's
  inner spans before touching your font stack.
- **Overlay scrims invisible to computed styles.** A gradient/scrim present
  in rendered pixels with no discoverable element, pseudo-element, filter,
  backdrop-filter, or mask. Recover it **empirically by per-row luminance
  fitting**: compare per-row luminance of the live capture region vs the
  decoded raw image, fit the ratio curve to a gradient (UC1-E1's hero fit:
  `linear-gradient(transparent 68%, rgba(0,0,0,.45) 80%, #000 100%)`), apply,
  and let the pixel probe confirm the fit.

## Fonts policy

- **Same public source when available.** Extract intercepts the page's own
  font loads; woff2 files that are freely licensed or already self-hostable
  are self-hosted in the prototype (UC1-E1: same-source fonts, zero
  substitutes needed, which is why the type matched exactly).
- **Licensed commercial kits: substitute, never rehost** (heathrow §3.7 —
  e.g. a domain-locked Monotype kit). Rules:
  - Never re-host a commercial font on the new public domain.
  - Pick a **metric-matched** substitute (or have the user supply their
    licensed kit).
  - Keep the brand family name FIRST in the font stack so a licensed
    drop-in later wins without a code change.
  - Surface the substitution to the user and log it in the progress ledger —
    a substituted face is a permanent, justified gate residual (the width
    probe will fork; record it as expected).

## Asset harvest and the capture-state policy

CDN-defended sites (Akamai/Cloudflare/Demandware) 403 direct asset requests,
font files, and even in-page `fetch()` from a headless client. What works:

- **Harvest by intercepting the page's own responses** (Playwright response
  events) — the page's own requests are authorized; yours are not.
- **Canvas readback** (same-origin) for the exact displayed bitmap when the
  rendition URL itself is refused.

**Capture-state policy — ground truth is the page as observable by the
instrument.** Two recurring cases:

- **Lazy images stuck on designed placeholders.** Some lazy loaders leave
  images on base64 placeholder data-URIs that report
  `complete && naturalWidth > 0` (fooling load checks). Do NOT force
  data-src→src swaps — the CDN 403s the forced renditions and you get
  broken-image icons, worse than placeholders. Replicate the site's own
  placeholder assets where the live capture shows placeholders, and **log
  each instance** in the progress ledger flagged for the delivery phase
  (real renditions get wired when authors upload media).
- **Hydration states.** Commerce buttons stuck on "Loading …" headless,
  skeleton screens, etc. Replicate as captured, log, flag for delivery.
  "Fixing" the hydration state creates a pixel delta against the live
  capture AND fabricates a state the source never showed this instrument.
- **Pointer/hover state.** Pointer position is part of capture state: a
  `:hover`-styled element under the resting cursor is a false-measurement
  trap (recorded: a consent click left the cursor over a hero whose
  `a.box-hover:hover img{opacity:.4}` shipped the entire live capture with
  the hero dimmed). Instrument hardening includes parking the pointer —
  stitch-shot.mjs does it after consent dismissal; mirror it in any ad-hoc
  capture that clicks anything.
- **Pre-settle height is fake on entrance-animated sites.** Live
  `scrollHeight` differs before vs after the settle pass (recorded: 3183 vs
  3093 at 360 — entrance `translate3d(0,90px,0)` transforms inflate the
  document until elements go inview). stitch-shot's settle handles it; any
  ad-hoc probe that reads document height — the diagnosis probes this skill
  encourages included — must settle first too.

## Granularity parity (the #87 JOIN/SPLIT policy)

Zeroing content-diff against a live page requires **mirroring the live DOM's
node granularity**, which is in tension with clean re-authoring. Policy —
mirror these classes rather than fighting per-page false-reds:

- **Span-in-heading splits**: live headings that wrap text in inner spans
  classify the fragments differently; mirror the split.
- **Hidden DOM that counts as content**: mega-menu markup inside `<main>`,
  carousel clone slides, hidden tab-panel links, sr-only labels ("Old
  price"), even server-truncated strings. Content parity means DOM parity,
  not visible-text parity — reproduce them hidden, exactly as captured.
- Alternatively, where mirroring would be genuinely absurd, treat the
  specific JOIN/SPLIT reds as **confirmed-justified** per diff SKILL.md's
  #87 guidance (verify the fragments concatenate into a matched EXTRA before
  justifying) and record each in the gate log. Mirroring is the default;
  justification is the exception, because every justified red is a manual
  re-verification on every subsequent gate run.

## Role parity (wrapping and heading level, not text)

content-diff classifies every string by **DOM wrapping + computed style +
heading level, never by text alone**: a string inside an `<a>` is a CTA, an
uppercase small-type node is an eyebrow, an `<h3>` is not an `<h2>`. So a
recreation that carries every string verbatim can still open with dozens of
structural 🔴 — recorded (fritzhansen iteration 1): 43 CTAs vs 58 and 12
eyebrows vs 6, **all role swaps, zero dropped copy** — the live page
wrapped labels in anchors where the recreation used spans, and vice versa.

Policy:

- **Mirror the live element wrapping per string.** For each text node the
  gate will inventory, reproduce the live page's wrapping element (`<a>` vs
  `<button>` vs `<span>`), its heading LEVEL, and the eyebrow-style
  signature (uppercase + small size) — not just the visible text. This is
  the same discipline as § Granularity parity, one level up: granularity
  parity mirrors how text is split, role parity mirrors what it is wrapped
  in.
- **Iteration 1's red map IS the parity worklist.** When iteration 1 opens
  with a wall of ROLE SWAP / MISSING-CTA-plus-EXTRA pairs, fix the wrapping
  first and re-run before touching geometry — role reds are cheap,
  mechanical fixes, and every one cleared un-buries the structural reds
  that are real. Geometry second.

## Carousels and animated sections

- **Deterministic initial offsets** (centering math, first-slide-at-rest):
  compute the offset and reproduce it statically — stable across runs
  (UC1-E1: both mid-page carousels were centered tracks, reproduced at
  their computed offsets with zero JS).
- **Autoplaying carousels / marquees**: freeze policy — capture and
  recreate the t=0 state; the gate's animation-freeze injection keeps both
  sides stable. Log the freeze.
- **Style-injection ordering**: inject any freeze CSS only AFTER the
  lazyload settle pass — injecting before it breaks some loaders' swap
  logic (recorded UC1-E1 failure mode). stitch-shot.mjs already orders this
  correctly; mirror the ordering in any ad-hoc probe.

## Fixed and sticky chrome (headers, floating tabs × stitched capture)

`position: fixed`/`sticky` chrome interacts with the stitched capture in
three ways, each observed live on the first fresh-site run (hay.dk):

1. **Seam repeats.** A fixed element renders in EVERY viewport chunk, so
   the stitched PNG shows it repeated at each chunk seam (every `--vh` px).
   Instrument behavior, not a page defect — but only while it is symmetric.
2. **Content occlusion.** Each repeat occludes a band of real content under
   that seam; the occluded band is invisible to the pixel probe on both
   sides (again: harmless only while symmetric).
3. **Scroll-state morph.** Chrome that changes with scroll captures
   differently per chunk: hay.dk swaps to a `body.header-minimized` 55px
   hamburger bar once scrolled, so chunks 2+ carry different chrome than
   chunk 1 — the stitched live capture contains BOTH states.

**Resolution — symmetry, including the scroll-state trigger.** Replicate
the fixed chrome AS fixed (never flattened to static/in-flow — that changes
both the geometry and the seam behavior), and when the live chrome morphs
with scroll, give the prototype the SAME morph so chunks 2+ match.

This is the one sanctioned exception to the "no JS unless a section's
initial state requires computing it" rule, and the tension resolves cleanly:
that rule guards against *behavior for its own sake*, but scroll-state
chrome is **instrument-induced state** — the capture instrument scrolls, so
the instrument itself puts the live page into the morphed state, and a
static prototype can never measure symmetric against it. Minimal prototype
JS for scroll-state chrome is therefore permitted, tightly bounded: a few
lines toggling the same class at the same scroll threshold as the live site
(lift both the class and the threshold from the source JS/CSS — never guess
them), no frameworks, no other behavior. Log the addition in the progress
ledger the way a CSS portation is logged.

**Reading the diff:** any height delta between the captures de-aligns the
seams, turning every seam repeat into a ghost band in the pixel diff
(observed: seam ghosting of a fixed newsletter tab, plus a hot band exactly
at a chunk boundary). Fix the height delta first — seam ghosts below the
first hot band are offset contamination, not chrome bugs.

## CSS-portation fallback (per-section, never page-level)

Re-authoring is the mainline — validated as sufficient for every section
type on a strict design-system site. Porting the source's own CSS rules is
the reserve, admissible for a SECTION only when it hits one of:

1. **Paint-level effects not recoverable from computed styles** — and only
   when the effect IS in the source CSS (when it isn't, luminance fitting
   above is the tool).
2. **JS-hydrated commerce/PDP widgets** whose "current state" is a moving
   target across captures.
3. **Video/animated heroes** where a static recreation can't express the
   captured state.

Rules when it fires: port the minimal rule set for that section, tree-shaken
to used rules, scoped under the section's class; record the portation (and
why) in the progress ledger. **Never page-level** — page-level portation
carries the source's CSS debt into the blocks, defeats "better
implementation of key pages", and is fragile under block-class scoping. A
page that would need page-level portation is a page that should be flagged
to the user as a snowflake-overlay candidate (byte-preservation escape
hatch, outside this skill).
