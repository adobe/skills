---
name: stardust
description: Redesign an existing website to make it better. Multi-page, incremental, reasoned in the open. Built on top of impeccable.
license: Apache-2.0
---

# stardust

You are operating the `stardust` skill: a guided redesign of an existing
website. The user's job is to say what they want; your job is to reason about
what that means, propose a plan, and execute it through a small set of
sub-commands that delegate the actual design work to **impeccable**.

## Setup (run before anything else)

1. **Verify impeccable is installed.** Stardust has a hard dependency on
   impeccable and ships no fallbacks. Look for the `impeccable` skill in any of
   the standard harness directories the project uses (`.claude/skills/`,
   `.agents/skills/`, `.cursor/skills/`, etc.). If it is not installed, stop
   and tell the user:
   > Stardust requires impeccable. Install it from
   > <https://github.com/pbakaus/impeccable> and re-run the command.
2. **Run impeccable's context loader once per session.** Execute the loader at
   `<harness>/skills/impeccable/scripts/load-context.mjs`. Its JSON output
   tells you whether `PRODUCT.md` and `DESIGN.md` exist at the project root
   (these are the *target* state for stardust). Skip the loader if it already
   ran in this session's history.
3. **Read stardust's state.** Read `stardust/state.json` if present
   (`reference/state-machine.md` defines the schema). Note which pages are
   `extracted`, `directed`, `prototyped`, `approved`, or `migrated`.
4. **Read impeccable's command registry.** Parse
   `<harness>/skills/impeccable/scripts/command-metadata.json`. This is the
   single source of truth for the 23 impeccable commands; never hardcode
   them in your reasoning.

## Routing

Once setup is done, route on the user's input:

- **No argument.** Render the **state report** described in
  `reference/state-machine.md`: project state, per-page status table,
  recommended next command, with reasoning. Do not write anything.
- **First word is `distill`, `extract`, `direct`, `prototype`,
  `migrate`, `uplift`, or `aem-import`.** Delegate to the matching
  sub-command (`stardust:<name>` skill). Pass remaining args through.
  - `prototype` accepts `--cinematic` (or `--cinematic=<register>`)
    to layer a brand-faithful motion register on top of the static
    prototype (per `skills/prototype/reference/motion-registers.md`).
  - `uplift` is the one-shot presales orchestrator: takes a URL and
    produces three differentiated variants (one fully cinematic)
    without further user coordination. Use when the user wants to
    skip the extract/direct/prototype chain (per
    `skills/uplift/SKILL.md`).
  - `aem-import` converts an approved prototype into an authorable
    AEM Edge Delivery Services page — generates per-theme CSS that
    targets generic EDS blocks (hero / text / cards / columns), authors
    DA-block-table content, copies assets, applies a one-time engine
    patch. Two modes: `blocks` (default, ~95% pixel parity, full
    authorability) and `overlay` (template-based, ~100% parity,
    slot-shaped authoring). Use when the prototype needs to land on
    aem.page via admin.da.live, not as a static migrate output. See
    `skills/aem-import/SKILL.md`.
- **First word is anything else (a freeform phrase).** Treat it as a
  redesign intent. Load `reference/intent-reasoning.md` and follow the
  procedure step by step. **Do not execute any impeccable or stardust
  command before showing the resolved plan to the user.**

## The "open and reasoned" principle

Stardust does not ship a closed `intent → commands` lookup. Every freeform
phrase is reasoned about in public. You must:

1. Restate the phrase in stardust's dimensional vocabulary
   (`reference/intent-dimensions.md`).
2. Identify which axes the phrase moves and in which direction.
3. Identify what is underspecified and ask the user **at most two**
   clarifying questions.
4. Map the resolved direction to a sequence of impeccable commands, citing
   each command's reference in `reference/impeccable-command-map.md`.
5. Show the proposed plan to the user before executing.
6. After execution, record the resolved direction, axes, commands, and
   reasoning in `stardust/direction.md` with a stardust provenance block.

Worked examples of this procedure live in `reference/intent-examples.md`.

## Per-page state and "stale on direction change"

Pages have lifecycle states (`extracted | directed | prototyped | approved |
migrated`). When the user's direction changes after some pages have already
been prototyped or migrated, **mark those pages stale; do not auto-re-run.**
The user opts in to re-prototyping or re-migrating explicitly. Details in
`reference/state-machine.md`.

## Artifacts you read and write

Stardust state lives under `stardust/`. Impeccable's `PRODUCT.md` /
`DESIGN.md` / `DESIGN.json` live at the project root and represent the
*target* state. The current (extracted) state lives under
`stardust/current/`. Full layout in `reference/artifact-map.md`.

## Provenance

Every artifact stardust writes carries a provenance block as the first line
or first key, declaring: which sub-command wrote it, against which user
input, what was synthesized vs. authored, and what other artifacts were
read. Format conventions in `reference/artifact-map.md`.

## Journal rule

A multi-session stardust project benefits from a **chronological journal**
that records the prompt history, decisions, and open questions across
turns — separate from the state machine and from per-artifact provenance.
State.json records *what is*, provenance records *why an artifact says what
it says*, but neither captures the narrative arc of *how the project got
here*. The journal does.

**Maintain `stardust/journal.md` per the format in
`reference/journal-format.md`.** On every prompt execution that resulted in
a non-trivial write (any `direct`, `prototype`, `migrate`, or substantial
iteration), append an entry before ending the turn.

The journal is **append-only**. If a prior entry turns out wrong, write a
new entry that corrects it; do not edit history. This preserves the
reasoning trace and lets reviewers see how decisions evolved.

The journal is project-scoped and human-facing — it lives at the same
level as the impeccable PRODUCT.md, not under `stardust/current/` or
`stardust/canon/`. Treat it as the shared narrative layer over stardust's
state machine.

When the user invokes stardust at the start of a new session, the journal
is read first (along with state.json) — its last 3-5 entries carry the
"where did we leave off" context that the state machine doesn't.

## Validation rule

Every artifact stardust writes that a human will eyeball — proposed HTML,
brand-review.html, the migrated site — runs through a **recursive validate-
and-fix loop** before being marked done. The principle: type checks and
test suites verify code correctness; only browser rendering verifies
*feature* correctness.

For HTML the user will see (prototypes, migrated pages, sample distillation
artifacts, the brand-review HTML):

1. Render in Playwright (file:// for static, or local dev server).
2. Capture at three viewports — desktop **1440×900**, tablet **768×1024**,
   mobile **390×844**:
   - Full-page screenshot.
   - Browser console messages (errors + warnings).
   - Network failures (4xx / 5xx / aborted requests, missing assets).
   - Uncaught JS exceptions + unhandled promise rejections.
   - Layout sanity: no horizontal overflow; key landmarks present and
     non-empty.
   - a11y quick-pass: alt text, input labels, heading order, contrast on
     text-over-image.
   - Interaction smoke: hover an interactive card, scroll-trigger fires,
     nav opens/closes, primary CTA reachable by keyboard.
3. **If any issue is found, fix it and re-run the loop.** Iterate
   recursively until either (a) no issues remain or (b) the fix needs user
   input — in which case surface the question and stop. Do not report a
   task complete with known issues outstanding.
4. Save the final clean-pass screenshots to `stardust/validation/<artifact>/<viewport>.png`
   so reviewers can compare without re-running.

Per-sub-skill validation specifics live in each skill's reference docs —
notably `extract/reference/playwright-recipe.md` (the canonical recipe),
`prototype/reference/motion-validation.md` (motion-specific gates), and
`prototype/SKILL.md` Phases 2.5–2.8 (the critique / audit / adapt /
motion gate cascade).

## What stardust never does

- Invent design opinions that contradict impeccable's hard rules. Defer to
  impeccable.
- Execute a redesign plan without showing it first.
- Force a re-run on stale pages without explicit user opt-in.
- Crawl an existing site beyond the user's confirmed page cap.
- Emit AEM EDS, a CMS, or a framework. The migration target is static HTML
  only; downstream conversion is out of scope.

## References

- `reference/intent-dimensions.md` — the axes redesigns move along.
- `reference/intent-reasoning.md` — the procedure for handling a freeform phrase.
- `reference/intent-examples.md` — worked examples (8-12) of the reasoning style.
- `reference/impeccable-command-map.md` — when to reach for each of the 23 impeccable commands.
- `reference/state-machine.md` — page lifecycle, stale rules, state report format.
- `reference/artifact-map.md` — every file stardust reads or writes, with ownership and provenance shape.
- `reference/divergence-toolkit.md` — anti-mediocrity device. Default-moves list, deterministic seed, font decks, role-naming rule. Consumed by `direct` (when authoring target tokens) and `prototype` (when generating variants).
- `reference/token-contract.md` — `:root` CSS custom-property contract every prototype and migrated page must expose. The token interface between stardust and any downstream consumer.
- `reference/data-attributes.md` — structural `data-*` vocabulary applied to sections in every prototype and migrated page. The structural lingua franca between stardust sub-commands and downstream tools.
- `reference/journal-format.md` — `stardust/journal.md` entry format. Append-only chronological log; the shared narrative layer over the state machine.

### Cinematic-feature references (cross-cutting)

Owned by `prototype/` because the cinematic feature is scoped to
prototype rendering, but cited by `direct` (when selecting a
register), `uplift` (when picking C's register), and `migrate`
(when copying motion assets through):

- `../prototype/reference/motion-registers.md` — five brand-faithful motion personalities (`arrival`, `kinetic-display`, `live-systems`, `editorial`, `kinetic-grid`) and the selection heuristic that maps PRODUCT.md Brand Personality traits to a register.
- `../prototype/reference/motion-stack.md` — technology choice: Lenis + CSS keyframes + rAF + IntersectionObserver. Why not GSAP. Bundle policy.
- `../prototype/reference/motion-attributes.md` — `data-*` vocabulary the runtime consumes (`[data-anim]`, `[data-tile-anim]`, `[data-countup]`, `[data-flip]`, `[data-fill]`, `[data-split]`, `[data-parallax]`).
- `../prototype/reference/motion-runtime.md` — the canonical inline runtime script that powers every cinematic prototype.
- `../prototype/reference/motion-validation.md` § Pass 6 — cinematic-mode validation gates (Lenis boot, reduced-motion fallback, scroll-jack, three-position screenshots, register-match, motion C-cliff detector).

### Uplift-feature references

Owned by `uplift/`. Cited by master routing when delegating
`/stardust:uplift <URL>`:

- `../uplift/SKILL.md` — one-shot presales orchestrator: extract → tension/trait identification → 3-variant direction → prototype × 3 → open + summarize.
- `../uplift/reference/what-if-candidates.md` — closed catalog of 8 captured-trait amplification candidates that B and C select from in Phase 2b.
