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

## Cumulative archetype prototypes

Every archetype keeps its own standalone reference prototype — never skip
to direct platform authoring for a new archetype "because the blocks
already exist". Field evidence (broadridge, 8 pages): the prototyped
archetype reached 3.5%/5.6% pixel diff and stayed the quality ceiling for
its conversion; pages authored directly on the platform plateaued at
8–16%. Prototypes are **cumulative**: each new one imports the shared
layers earlier prototypes already gated — tokens, chrome, shared module
CSS, the interaction spec — and iterates only on its NEW modules.
Concretely, split the prototype CSS into a shared canon file plus a
per-archetype file; the platform conversion inherits both; and the
prototype remains the per-archetype fidelity reference (full gate: ≤10%,
Δ≤8px, 0 structural red) that the published page is judged against
(`source-fidelity-gate.md` § The published-origin gate).

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
   radii, shadows, hero heights, breakpoint values — **and the
   text-rendering group**: `text-rendering`, `-webkit-font-smoothing`,
   `font-synthesis`, `font-variant-numeric`, `font-kerning`. Sites commonly
   set these globally, and the ramp alone doesn't carry them: a ±1%
   glyph-width difference from a mismatched rendering mode produces
   systematic one-line-fewer/more wraps that present as inexplicable
   per-section height errors at every breakpoint. Diagnostic when wraps
   disagree at identical computed family/size/width: measure a literal
   string's rendered width on both sides (`canvas.measureText` or an
   offscreen span) — it settles whether the fork is metric or layout.
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

## Wrap-junction margins (cards-on-a-canvas sites)

Sites built as "cards on a canvas" — white/tinted wrap sections floating on
a page background — tempt the recreation into margin-based boxes, and
margins collapse: two adjacent wraps each carrying a section-pad margin
lose one pad at every junction (recorded: 96px designed → 48px rendered),
a systematic per-junction height error the anchor probe reads as every
section top drifting further down the page. Two safe constructions:

- **Transparent padded sections with an inner wrap** (padding never
  collapses): the section keeps the page background and the vertical pad;
  the visible card is an inner element carrying the surface color/radius.
  Prefer this — it matches how most such sites are actually built.
- **Explicit junction margins**, documented per junction, when the inner
  wrap can't work. Specificity trap: junction rules must match or exceed
  the `:has()`-based wrap rules they override, or the wrap rule silently
  wins and the junction re-collapses.

The inverse case — the SOURCE's margins do NOT collapse where a clean
recreation's would: AEM-classic (and any clearfix-era) components wrap each
section in a clearfix, whose block formatting context contains child margins.
`display: flow-root` on the recreated section wrapper reproduces that
containment exactly — one rule fixed systematic −48/−20px per-section errors
across a whole page in the field. Corollary for responsive work: a column
that is floated on desktop loses its BFC when a media query un-floats it, and
the last child's margin escapes at mobile only — add `flow-root` to the
un-floating override.

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
- **Nondeterministic live elements** — stock tickers, "last updated" dates,
  view/result counts, personalization slots. The live capture itself varies
  run-to-run on these (recorded: a ticker populated in one gate capture,
  empty in the next). Replicate the STRUCTURE, freeze one captured value in
  the prototype, and log the element as a **permanent residual** in the
  ledger — it can never zero out, and chasing it burns iterations on a
  moving target. This is the one content class where confirm-justify stays
  legitimate under widget mirroring (§ Granularity parity).
- **Live-data embeds** (stock tickers, YouTube/euroland-style iframe
  widgets) — the winning move is loading the SAME live embed (same src) on
  both sides so the moving data cancels out in the pixel diff, NOT freezing
  a snapshot (confirmed in two independent 2026-08 sessions: a same-src
  YouTube iframe canceled to zero; a euroland share ticker mirrored same-src
  stopped contributing). A frozen snapshot guarantees a permanent residual
  the size of the widget; a mirrored live embed usually zeroes out, and any
  residual left (frame-timing skew) is logged as permanent.
- **Randomized decorative elements** (inline positions/paths regenerated per
  page load — generative line art, particle fields): the live side never
  pixel-matches ITSELF across captures, so no prototype can zero it out.
  Class-level permanent residual: log it with its band and %, don't chase it.
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
- **AEM-classic richtext byte patterns are load-bearing** (general to the
  source-CMS class, not one site): an empty spacer paragraph is
  `<p><br>\r\n </p>` and renders TWO line boxes (the `<br>` plus the still-
  collapsible space); headings lead with `<br>` (`<h1><br>\r\nTitle`); a
  trailing `&nbsp;` after an inline close is a REAL extra line. Approximating
  these as clean `<p><br></p>` measures 20–36px short per instance. Mirror
  the byte patterns as captured; when a wrap-count mismatch survives width
  parity, diff `innerHTML` — the byte-level difference is usually the cause.
- Alternatively, where mirroring would be genuinely absurd, treat the
  specific JOIN/SPLIT reds as **confirmed-justified** per diff SKILL.md's
  #87 guidance (verify the fragments concatenate into a matched EXTRA before
  justifying) and record each in the gate log. Mirroring is the default;
  justification is the exception, because every justified red is a manual
  re-verification on every subsequent gate run.

**Widgets are implemented, not justified away.** Mirroring is the default
for widget content, hidden or not — and beyond mirroring the DOM, widgets
must WORK wherever the live site's do: a live carousel becomes a working
carousel, a live select carries its real option list, tabs switch,
accordions open. Justifying a whole widget away as a class-level residual
is not acceptable; confirm-justify stays reserved for genuinely
unreachable or nondeterministic content (ticker values, personalization —
§ Asset harvest, capture-state policy). The interaction-parity pass
(§ Interaction parity) is what makes this affordable: probe the live
behavior cheaply, replicate it, and mirror the full widget DOM so
content-diff stays at zero structural red.

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

## Interaction parity (after the static gate — observed, never inferred)

The gate measures static pixels at t=0 only: every scroll-entrance
animation, header scroll-morph, hover transition, and secondary carousel is
invisible to all four probes — and users notice them immediately on first
manual review. After the static gate passes (never before — interaction
work on unconverged geometry is rework), run the interaction-parity pass.
It is a REQUIRED per-archetype gate output (SKILL.md Phase 4 — the motion
inventory), not an optional post-pass: in the field it was skipped on 5 of
7 archetypes, including under parallel sub-agent briefs, and every skipped
archetype shipped visibly static. **Any parallel archetype fan-out brief
must carry this section's evidence rule and instrument invocation
verbatim** — this is precisely the step agents skip when unprompted.

**The evidence rule: motion is OBSERVED at runtime, never inferred from
static classes or CSS rules.** Run `../scripts/motion-observe.mjs` ONCE per
archetype live URL (full down+up scroll traversal; `--click` each
carousel/widget control; `--hover` each distinct card/teaser/button
family; reuse the JSON — observation costs live hits like any probe).
Implement ONLY behaviors that measurably fired, with the recorded trigger
mechanism, durations, and thresholds. Static source CSS is then the
authority for the exact keyframe/easing VALUES of those fired animations.
A behavior implemented without a runtime trace naming it is a fidelity bug
— same severity as an unregistered design change.

Static lifting INVENTS motion three distinct ways (all field-recorded, all
caught in user review — this is why the evidence rule exists):

1. **Dead animation classes.** Sites — component CMSs especially — stamp
   animation classes on many elements; the runtime JS adds the trigger
   class (`.animate` etc.) to only SOME of them (recorded: of ~8
   caption-class families carrying an entrance class, 2 ever fired; 3 whole
   page types had ZERO firing entrances despite fully classed markup).
   Tagging from static classes animates elements the real site never
   animates. A live-classed-but-dead behavior is recorded as NOT
   implemented — that is the correct replica of a dead class.
2. **Hover rules whose scope never matches.** A plausible, syntactically
   applicable `:hover` rule can be dead at runtime (scoping condition,
   specificity loser, wrong variant) — and the inverse: the fired hover may
   move a different element than the rule suggests (recorded: media-card
   hover scaled the caption, not the card). Only a measured hover diff
   justifies a hover rule in the prototype.
3. **Approximated mechanisms create impossible states.** Reproducing a
   header scroll-morph as a cloned fixed overlay bar looked equivalent but
   allowed bar + original header visible simultaneously — a state that
   cannot exist on live, which morphs its SINGLE header in place. Users see
   a double-rendered header. **Mechanism cloning rule:** scroll-chrome and
   widgets are reproduced as the SAME state machine observed live (same
   element morphing, same class-state transitions, same restore
   thresholds — the observe JSON's headerTimeline and classMutations name
   them) — never as a different mechanism with a similar look.

The two probe patterns the instrument wraps (both cheap, generic, no source
JS needed): **hover diff** (`--hover`) — computed
background/color/shadow/transform on the element + key sub-elements,
before vs after a real pointer hover, plus `transition-*`; overlays
dismissed first (an overlay intercepts the pointer and the probe reads no
change), mouse parked between probes; the changed-property list translates
directly to `:hover` CSS. **Behavior diff** (`--click`) — click the
control, sample the animated property mid-flight and settled
(`transform`/`scrollLeft` + computed `transition-*`): pitch, easing,
duration. Map observed elements to prototype counterparts by the TEXT
SNIPPET in the event log, never by class names (prototype classes are
clean re-authored names).

**Swiper-lock semantics** (the dominant carousel library): Swiper hides its
controls and disables dragging when the content fits the viewport
(`swiper-lock`/watch-overflow), so per-breakpoint the same widget is
sometimes a carousel, sometimes a static row. A scroll-based replica
reproduces the entire behavior with no DOM restructuring: arrows drive
`scrollTo` on the already-`overflow:hidden` track, position count =
`round((scrollWidth − clientWidth) / pitch) + 1`, and controls
hide when `scrollWidth <= clientWidth` — which auto-degrades to the static
case exactly where the live widget locks. Late re-renders (e.g. re-check at
400/1200/3000ms and window `load`) are needed when the platform decorates
DOM after the widget initializes — the overflow measurement taken at
decorate time is stale by first interaction.

**Implementation pattern — ONE shared motion layer per project, never
per-page forks:** `css/motion.css` (lifted keyframes verbatim; trigger
rules reusing the LIVE class names — that keeps the capture instruments
symmetric, since stitch-shot's animation handling already keys on the live
conventions; hover rules hover-diff-verified only; chrome-morph classes;
indicator transitions) + `js/motion.js` (an IntersectionObserver adding
the live trigger class — threshold as measured, typically ~0.15, once —
to a tagging map of runtime-FIRED selectors only; the chrome state machine
on scroll with the measured direction + thresholds; widget drivers
mirroring observed mechanics). Gate-safety is by construction: entrance
animations only run once the trigger class is added — verify the live site
has no pre-animate hidden state (if it does, stitch-shot's entrance-state
forcing covers it); chrome morph is inert at y=0; hovers need a pointer;
stitch-shot clears timers so autoplay stays at t=0. Widget DOM stays fully
mirrored so content-diff holds at zero structural red (§ Granularity
parity — widgets are implemented, not justified away).

**Verification protocol, both directions:** (1) **no pixel regression** —
re-run pixel-compare per touched archetype at the gate breakpoints; the
number must return to (± noise of) the gated value (recorded: 1.01% gated
→ 1.06% with invented motion → 1.01% exact after the evidence-only
rewrite). The drift itself is the smell test: motion code that changes t=0
is wrong. (2) **behavior match** — a headless run against the PROTOTYPE
asserting, per page: tagged-element count == live fired count; chrome
state at {top, scrolled-down, scrolled-up, back-to-top} == the live
headerTimeline states; zero pageerrors. This is the motion analog of the
anchor probe, trivial to script from the observe JSON.

Pitfalls (each field-recorded):

- Observation needs the same live-session hardening + pacing as the gate
  captures (bot walls, 429 bursts): ONE observation run per page, reuse the
  JSON.
- Autoplay widgets may pause off-viewport — poke them explicitly with
  `--click` rather than waiting for autoplay events.
- Indicator "magic dots": the live mechanism may animate `left`/`transform`
  where an equivalent rendered effect in the recreation animates
  width/height — equivalence of the RENDERED effect is the bar, but the
  duration/easing must be the measured ones.
- Wobble/stagger patterns: delays may be child-order dependent (recorded:
  2nd child first, 0.5s steps, 1st child last) — read them from the CSS
  rules of the FIRED animation; they are not guessable.
- `prefers-reduced-motion`: mirror the live site's handling — do not
  "improve" by adding it where live has none; that's an
  inconsistency-register item, not a freebie.

Log each implemented interaction in the progress ledger the way a CSS
portation is logged; the static gate is then re-run per the verification
protocol above (markup rarely changes — hover CSS and trigger JS are
capture-invisible under the freeze, and the pixel re-run proves it).

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
