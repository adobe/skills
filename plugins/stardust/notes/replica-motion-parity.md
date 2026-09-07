# stardust:replica improvement — motion parity (observe, don't infer)

Self-contained spec for a general plugin improvement, written from the
rwe.com migration (2026-08). Everything here is site-agnostic; rwe examples
are marked as evidence. Reference implementation artifacts in this project:

- Instrument: `scripts/replica/motion-observe.mjs` (this repo — copy into
  the plugin next to `skills/replica/scripts/stitch-shot.mjs`)
- Implementation layer produced by the method:
  `stardust/prototypes/css/motion.css` + `stardust/prototypes/js/motion.js`
- Runtime evidence files: `stardust/replica/motion-observe-*.json`
- Ledger entries: `stardust/learnings.md` items 13 (first attempt) and 14
  (correction — the actual method)

## 1. Problem

The replica source-fidelity gate is static-pixels-at-t=0 only. A prototype
passes all four probes (pixel, anchor, content-diff, visual-diff) with every
scroll-entrance animation, header scroll-morph, hover transition, and
secondary carousel missing — and users notice immediately on first manual
review. `recreation-procedure.md` § Interaction parity exists but is easy to
skip (it skipped in 5 of 7 archetypes here, including under parallel
sub-agent briefs), and it under-specifies HOW to discover motion.

## 2. The failure mode that makes the naive fix wrong (field-proven)

First attempt lifted motion from **static sources** — `@keyframes` + trigger
classes from the site's CSS, element inventory from DOM class names
(`querySelectorAll('[class*="-animation"]')`), hover rules by parsing
`:hover` selectors. This **invents motion** three distinct ways, all caught
in user review:

1. **Dead animation classes.** Sites (esp. component CMSs — rwe is
   Sitecore) stamp animation classes on many elements; the runtime JS only
   ever adds the trigger class (`.animate` here) to SOME of them. Evidence:
   on rwe, of ~8 caption-class families carrying `right-to-left-animation`,
   only 2 ever fire; 3 whole page types have ZERO firing entrance
   animations despite fully classed markup. Tagging from static classes
   animated elements the real site never animates.
2. **Hover rules whose scope never matches.** A plausible, syntactically
   applicable `:hover` rule can be dead at runtime (scoping condition,
   specificity loser, wrong grid variant). Evidence: full-width teaser
   captions had a lifted scale rule that never applies on live; media-card
   hover scales the caption, not the card, contrary to the rule that
   appeared to match.
3. **Approximated mechanisms create impossible states.** Reproducing the
   header scroll-morph as a cloned fixed overlay bar looked equivalent but
   allowed bar + original header visible simultaneously — a state that
   cannot exist on live, which morphs its SINGLE header in place. Users see
   a "double rendered" header. Mechanisms must be cloned from the observed
   state machine, not re-invented to a similar visual effect.

**Division of labor that works:** static CSS supplies exact VALUES
(keyframes, durations, easings, colors); only a runtime trace decides WHAT
runs, WHERE, and HOW the mechanism behaves.

## 3. The instrument: `motion-observe.mjs`

Ship as `skills/replica/scripts/motion-observe.mjs`, sibling of
stitch-shot, reusing `live-session.mjs` hardening (UA/headers, headed
fallback, consent dismissal, pacing). Reference implementation:
`scripts/replica/motion-observe.mjs` in this repo (~170 lines, playwright).

What it does, per live URL:

1. **Instrument before any scrolling:**
   - `animationstart`/`animationend` capture-phase listeners → log
     `{animationName, elementPath (5 ancestors, incl. data-tpl/component
     marker), textSnippet (to map elements to prototype counterparts),
     scrollY}`.
   - `transitionstart` listeners → `{propertyName, elementPath, computed
     transitionDuration, scrollY}` (capped, e.g. 400 entries).
   - `MutationObserver` on `documentElement` (attributes:class,
     oldValue) → log classes ADDED per element (capped). This exposes the
     trigger mechanism (e.g. `.animate`, `slick-current`,
     `has-scrolled-up/down`) and its thresholds.
2. **Scroll traversal:** auto-scroll to bottom in ~400px steps (~180ms
   apart), then back UP with dense sampling near the top (e.g. 300, 200,
   150, 120, 90, 60, 30, 0) — scroll-chrome behavior differs by direction
   and near-top state.
3. **Chrome state timeline:** at each up-step (and sparsely on the way
   down) record the header's `{className, position, height, transform,
   transition}` plus `main`/`body` paddingTop (detects layout-compensation
   vs accepted content jump).
4. **Widget pokes (`--click <selector>`, repeatable):** scroll the widget
   into view, click, then sample 4 frames at 200ms: track transform +
   transition, dot/indicator li classes + computed size/color/transition.
   Captures slide mechanics (fade vs translate, duration) and indicator
   animation (e.g. slick magic-dots: `li { transition: left .2s,
   transform .2s }`).
5. Output one JSON: `{headerTimeline, widgetSamples, events: {animations,
   transitions, classMutations}}`.

Complementary probe (a dozen lines, can live in the same script behind
`--hover <selector>` flags): **per-module hover-diff** — scrollIntoView,
read computed transform/colors, hover, wait ~300ms, read again, park the
pointer. Only a measured change justifies a hover rule in the prototype.

## 4. Skill-text changes

### `skills/replica/reference/recreation-procedure.md` § Interaction parity
Rewrite around the evidence rule:

> Motion is OBSERVED at runtime, never inferred from static classes or CSS
> rules. Run `motion-observe.mjs` per archetype live URL (full down+up
> scroll; `--click` each carousel/widget control; `--hover` each distinct
> card/teaser/button family). Implement ONLY behaviors that measurably
> fired, with the recorded trigger mechanism, durations and thresholds.
> Static source CSS is then the authority for exact keyframe/easing VALUES
> of those fired animations. A behavior implemented without a runtime trace
> naming it is a fidelity bug (same severity as an unregistered design
> change).

Also add the mechanism-cloning rule: scroll-chrome and widgets are
reproduced as the SAME state machine observed live (same element morphing,
same class-state transitions, same restore thresholds) — never as a
different mechanism with a similar look (the cloned-header-bar lesson).

### `skills/replica/SKILL.md` Phase 4
Make interaction parity a REQUIRED gate output per archetype (like
content-diff), not a post-pass suggestion: the archetype's ledger entry must
include a **motion inventory** — for each fired animation/transition/chrome
state: source evidence (observe-JSON pointer), implementation location, and
a note for behaviors present in live markup but observed dead (these are
recorded as NOT implemented, which is the correct replica of a dead class).

### Sub-agent briefs (parallel archetype fan-out)
The brief template must carry the evidence rule + instrument invocation
verbatim; this is the step agents skipped when unprompted.

## 5. Implementation pattern (what the method's output looks like)

One shared motion layer per project, not per-page forks:

- `css/motion.css`: lifted keyframes verbatim; trigger rules reusing the
  LIVE class names (keeps capture instruments symmetric — stitch-shot's
  animation-freezing already keys on `*-animation`); hover rules
  (hover-diff-verified only); chrome-morph classes; indicator transitions.
- `js/motion.js`: an IntersectionObserver that adds the live trigger class
  (threshold ~0.15, once) to a per-module tagging map (runtime-fired
  selectors only); the chrome state machine on scroll (direction +
  thresholds as measured); widget drivers (autoplay interval, arrows, dots)
  mirroring observed mechanics.

Gate-safety is by construction: entrance animations only run when the
trigger class is added (live has no pre-animate hidden state — verify this
per site; if a site DOES hide pre-animate, stitch-shot's forcing covers it);
chrome morph is inert at y=0; hovers need a pointer; stitch-shot clears
timers so autoplay stays at t=0.

## 6. Verification protocol (both directions)

1. **No pixel regression:** re-run pixel-compare per touched archetype at
   the gate breakpoints; the number must return to (±noise of) the gated
   value. rwe evidence: press-hub 1.01% gated → 1.06% with invented motion
   (drift!) → 1.01% exact after evidence-only rewrite. The drift itself is
   a smell test: motion code that changes t=0 is wrong.
2. **Behavior match:** headless run against the PROTOTYPE asserting, per
   page: tagged-element count == live fired count; chrome state at
   {top, scrolled-down, scrolled-up, back-to-top} == the live headerTimeline
   states; zero pageerrors. (This is the motion analog of the anchor probe;
   trivial to script from the observe-JSON.)

## 7. Pitfalls log (encode as bullets in the reference doc)

- Sites 429 bursts / bot-walls: observation needs the same live-session
  hardening + pacing as the gate captures; one observation run per page,
  reuse the JSON.
- Autoplay widgets may pause off-viewport — poke them explicitly with
  `--click` rather than waiting for autoplay events.
- Element→prototype mapping: match by text snippet captured in the event
  log, not by class names (prototype classes are clean re-authored names).
- Indicator "magic dots": the live mechanism may animate `left`/`transform`
  while an equivalent rendered effect in the recreation animates
  width/height — equivalence of the RENDERED effect is the bar, but the
  duration/easing must be the measured ones.
- Wobble/stagger patterns: delays may be child-order dependent (rwe: 2nd
  child first, 0.5s steps, 1st child last) — read them from the CSS rules
  of the FIRED animation, they're not guessable.
- `prefers-reduced-motion`: mirror the live site's handling (rwe: none) —
  do not "improve" by adding it; that's an inconsistency-register item.

## 8. Suggested plugin deliverables checklist

- [ ] `skills/replica/scripts/motion-observe.mjs` (port of this repo's
      `scripts/replica/motion-observe.mjs`, + `--hover` flag,
      live-session.mjs integration)
- [ ] `recreation-procedure.md` § Interaction parity rewritten (evidence
      rule + mechanism-cloning rule + pitfalls)
- [ ] `SKILL.md` Phase 4: motion inventory as required gate output;
      progress.json schema gains `motion: {observed, implemented, dead[]}`
- [ ] Sub-agent brief template carries the section verbatim
- [ ] Optional: behavior-match assertion script (§ 6.2)
