---
name: prototype
description: Render a proposed redesign of a page on the current website as a self-contained static HTML file, then iterate via the impeccable craft loop. Per-page, idempotent, stale-aware. Use when the user asks for a redesign prototype, a before/after comparison, a design preview, a page mockup, a visual diff of the redesign, or invokes /stardust:prototype.
license: Apache-2.0
---

# stardust:prototype

For each `directed` page, render a **proposed redesign** as a
self-contained static HTML file at
`stardust/prototypes/<slug>-proposed.html`. Open the file in the
browser; iterate via chat-driven impeccable commands ("make the
hero bolder", "tighten the cup-note grid"). Mark `approved` once
the user signs off in the conversation.

`prototype` is not a renderer of its own design — it composes the
target spec written by `direct` (`PRODUCT.md`, `DESIGN.md`,
`DESIGN.json`, `stardust/direction.md`) onto the page content captured
by `extract` (`stardust/current/pages/<slug>.json`). Visual creativity
is delegated to `$impeccable craft` and the iteration commands
(`bolder`, `quieter`, `distill`, `polish`, `colorize`, `typeset`,
`layout`, `adapt`, `animate`, `delight`, `overdrive`, `impeccable`).

## Inputs

- `<slug>` — optional positional. Prototype just this page. Without
  it, prototype every `directed` page that is not `stale`.
- `--all` — prototype every `directed` page including stale ones.
- `--prep` — optional. Run in **migrate-prep mode**: fill page-type
  gaps (prototype one representative archetype per type) and, on
  approval, write canon back to `stardust/canon/` and
  `DESIGN.json.extensions.canon`. See § Prep mode below and
  `reference/canon-extraction.md`. Typically invoked via the
  `prepare-migration` orchestrator.
- `--canon-from <slug>` — optional. Override the default canon-
  author (which is the first approved prototype, typically `home`).
  Used when a different page should establish the design canon.
- `--publish-sample <slug>` — submit the named slug to the
  stardust showcase. Triggers the publish-sample sub-flow
  documented in `reference/publish-sample.md`: eligibility checks,
  file staging, PR creation against the upstream stardust repo.
  Requires `gh` installed and authenticated. The showcase is a
  visual demonstration, not a deployable site — placeholder
  content is allowed and recorded in the PR body's § Unsourced
  content section. Design-quality gates stay strict: refuses on
  unjustified anti-toolbox hits, `:root` token contract failure,
  data-attributes contract failure, or impeccable hard-rule
  violations. P0/P1 critique findings warn but don't refuse.
  The showcase publishes via GitHub Pages on merge.

### No opt-outs

`prototype` does not carry `--no-*` or `--skip-*` flags. The
quality gates (critique, audit, mobile-adapt audit, anti-toolbox
audit, content-sourcing scan) are the product — they're not
optional. If a gate refuses a file, the remediation is to fix
the file or override the gate by editing the file directly, not
to pass a flag that silently lowers the bar. Manual chat
overrides ("ship as-is", "accept the P1 findings") are still
available; the agent records the override verbatim in
`_provenance` so downstream consumers see the explicit
acknowledgement.

## Setup

1. Run the master skill's setup
   (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/state.json` exists and contains at least one
   `directed` page. If not, recommend `$stardust direct` and stop.
3. Verify the project-root `DESIGN.md` and `DESIGN.json` exist. If
   not, the direction was not fully authored — recommend
   `$stardust direct` and stop.
4. Verify `stardust/direction.md` has an active (not pending)
   direction. Pending directions block prototype.
5. **Validate provenance on every page in scope.** Call
   `validateProvenance(page)` per
   `skills/stardust/reference/state-machine.md` § Provenance
   validation for every page that this run will render (the
   single `<slug>` argument when present, otherwise every
   non-stale `directed`/`prototyped`/`approved` page). Abort with
   the helper's error when any page lacks live-render evidence
   — re-running `prototype` against a synthesized page record
   silently propagates the synthesis into the rendered prototype.
   Surface `Provenance OK on N pages` once the check passes.
6. Read `stardust/current/DESIGN.md` (the descriptive snapshot of the
   existing site, used as a fallback reference during render when the
   proposed file needs to mirror an aspect of the captured surface).

## Delegation mechanic

`prototype` does **not** author `<slug>-proposed.html` directly. The
heavy creative lift is delegated to `$impeccable craft`, and (when
needed) the structural plan to `$impeccable shape`. Spelling out the
mechanic matters because the carve-out documented in
`skills/stardust/reference/artifact-map.md` (where stardust authors
`PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, `current/PRODUCT.md`,
`current/DESIGN.md` directly, treating impeccable's references as
*format specs*, not runtime commands) is **load-bearing for those
five files only**. It does NOT extend to:

- `stardust/prototypes/<slug>-proposed.html` — must be authored by
  `$impeccable craft`, not by stardust direct authoring.
- Iteration on the proposed file — must be driven through a
  chat-driven invocation of an explicit impeccable command (per
  the iteration paths section).
- Structural planning when a page is complex enough to need it —
  `$impeccable shape`.

The proximate cause of past content fabrication was the agent
over-generalizing the direct-authoring carve-out to the proposed
HTML. Don't.

### Invoking impeccable

When stardust runs in a Claude Code skill context (impeccable
exposed as the `impeccable:impeccable` Skill, not as a CLI), invoke
impeccable via the Skill tool with the sub-command and its args
mirroring the slash-command form:

```
Skill {
  skill: "impeccable:impeccable",
  args: "craft <feature-description>"
}
```

Sub-commands referenced from this skill are all routed through the
same Skill: `craft`, `shape`, plus the iteration commands
(`bolder`, `quieter`, `distill`, `polish`, `colorize`, `typeset`,
`layout`, `adapt`, `animate`, `delight`, `overdrive`, `impeccable`).

When impeccable is **not** available (CLI-only environments,
plugin uninstalled, sandbox without skill access), stop and tell
the user impeccable is required for prototype rendering. Recommend
installing the impeccable plugin. Do not fall back to direct
authoring of `<slug>-proposed.html` — the validation contract
craft enforces (anti-toolbox audit, divergence rules, type ratios,
content sourcing hierarchy) is not reproducible by direct
authoring, and falling back silently ships unverified output.

Stardust's job inside Phase 2 is therefore:

- Compose the inputs craft needs (page content from
  `current/pages/<slug>.json`, target spec from `DESIGN.md` /
  `DESIGN.json`, hard constraints from `direction.md`, content
  sourcing rules from `reference/proposed-file-shell.md` § Content
  sourcing hierarchy).
- Invoke craft via the Skill tool.
- Validate the result against the contract (`:root` block, data
  attributes, divergence audit, impeccable hard rules, content
  sourcing). If validation fails, refuse to write — never paper over
  craft output the agent thinks is "close enough."

The proposed file is whatever craft writes plus the validation
report; it is not stardust's authored artifact.

## Procedure

### Phase 1 — Plan the prototype (page-shape brief)

For each page in scope:

1. Read `stardust/current/pages/<slug>.json` for the page's structure
   and content.
2. Read `stardust/current/_brand-extraction.json` for system
   components and cross-promo data (the page's site-wide repeated
   surfaces).
3. Read `stardust/direction.md` Active section for the resolved
   direction, divergence inputs, and command sequence.
4. Read project-root `DESIGN.md` + `DESIGN.json` for the target
   site system — tokens, abstract component vocabulary, named
   system-component roles. The site system tells the agent *what
   the design language is*; this Phase decides *how it deploys to
   this specific page*.
5. **Author `stardust/prototypes/<slug>-shape.md`** — the per-page
   compositional brief. Format spec:
   `reference/page-shape-brief.md`. The brief carries the section
   list, layout strategy, key states, interaction model, structural
   data attributes, and the unsourced-content list (bridge to the
placeholder contract). Author directly — no interview, no
   impeccable invocation; this is stardust's reasoning about how
   the system deploys to this page given this content.
6. Show the brief to the user and wait for confirmation before
   moving to Phase 2. The user can edit the brief in place
   (rearrange sections, kill open questions, change composition
   decisions); re-rendering Phase 2 will rebuild the proposed file
   from the edited brief.

`$impeccable shape` is **not** invoked in v0.2 (see
`reference/page-shape-brief.md` § Authoring procedure for the
rationale; revisit if per-page hand-authoring proves insufficient
across sites).

The brief decouples site-level concerns (in DESIGN.md) from
page-level deployment (per-page brief). A direction change
invalidates the system; existing briefs are content-aware-stale
only when the system change makes their composition impossible.
This recalibration of stale-flagging is documented in
`skills/stardust/reference/state-machine.md` § Stale flagging.

### Phase 2 — Render the proposed page

Render `stardust/prototypes/<slug>-proposed.html` per
`reference/proposed-file-shell.md` § Required structure. Hard
requirements there:

- `:root` token block as the first content of the first `<style>`
  (per `skills/stardust/reference/token-contract.md`).
- Structural data attributes on every section (per
  `skills/stardust/reference/data-attributes.md`).
- Provenance block as the first child of `<head>`.
- Self-contained: no external CSS, no external JS.
- Content preserved from the current page (hero copy, CTAs, nav,
  body) unless `direction.md` authorises content changes.
- **Content sourcing hierarchy** (`reference/proposed-file-shell.md`
  § Content sourcing hierarchy): every literal value rendered must
  come from `current/pages/<slug>.json`, then voice samples, then
  direction-authorised changes — or be rendered with the mandatory
  PLACEHOLDER visual signature. Stats, addresses, quotes, tax IDs,
  hours, prices, named-person words must never be invented. The
  proposed file's `_provenance.unsourcedContent[]` lists every
  placeholder so migrate can refuse to ship unverified content.

Delegate the heavy creative lift to `$impeccable craft`:

- Pass the page content and the resolved direction as the feature
  description.
- Reference DESIGN.md / DESIGN.json as the design system.
- Pass `direction.md` § Anti-references and § Divergence inputs as
  hard constraints (so craft does not silently veer off the resolved
  direction).
- Skip craft's "north star mock" generation step (direction.md is the
  brief). Skip craft's "shape" call (already done if Phase 1 needed
  it).

After craft returns, validate the output:

- `:root` block present and complete (token-contract.md).
- Data attributes on every section (data-attributes.md).
- Anti-toolbox audit clean (each hit justified per divergence-toolkit.md
  § 1; record audit results in `DESIGN.json.extensions.divergence.anti_toolbox_hits`
  with the audit's amendments noted).
- Impeccable hard rules respected (OKLCH, type ratio ≥ 1.25, no
  reflex slop).
- **Content sourcing scan** — every literal value in the rendered
  output traces to one of the allowed sources
  (`reference/proposed-file-shell.md` § Content sourcing hierarchy).
  Any value that doesn't is either wrapped in a `[data-placeholder]`
  element with the mandatory visual signature, or the validation
  fails. Build the `_provenance.unsourcedContent[]` list during
  this scan.

If validation fails, do not write the file. Surface the failure to
the user with the specific rule violated and a suggested fix.

### Phase 2.5 — Validate via critique + audit

Before opening the proposed file in the browser, run **two parallel
validators** against the rendered proposed file: `critique` and `audit`. They
are explicitly designed as a complementary pair — critique
covers *design* (AI-slop reflexes, hierarchy, brand fit,
cognitive load); audit covers *technical correctness*
(accessibility / performance / theming / responsive /
anti-patterns). Running only critique misses every quantifiable
WCAG / perf / responsive failure; running only audit misses
brand-misalignment and design slop. The pass is a **contract**,
not a courtesy.

The 2026-05-04 nvidia.com home prototype critique returned
1 P0 + 2 P1 + 3 P2; the audit on the same artifact returned
**six additional findings** (no skip-link, theme carousels
without keyboard arrow nav, hero ~3.5MB without responsive
`<picture>`, layout-property animation, JS-gated reveal with
no `<noscript>` fallback, `scroll-behavior: smooth` not
respecting `prefers-reduced-motion`). None were design issues,
none would have been caught by critique alone. Without an
audit gate the page would have been marked `prototyped` with
quantifiable WCAG failures.

Procedure:

1. **Run both validators in parallel.** Invoke `impeccable:impeccable`
   twice in the same Skill-tool batch:

   ```
   Skill { skill: "impeccable:impeccable",
           args: "critique stardust/prototypes/<slug>-proposed.html --json" }

   Skill { skill: "impeccable:impeccable",
           args: "audit stardust/prototypes/<slug>-proposed.html --json" }
   ```

   Each returns a JSON findings list — each finding has
   `priority` (P0 / P1 / P2 / P3), `category` (hierarchy /
   contrast / motion / a11y / perf / responsive / etc.), and a
   one-line description. Capture critique findings into
   `_provenance.critique[]` and audit findings into
   `_provenance.audit[]` on the proposed file (append; never
   overwrite previous runs' entries).

2. **Brand-faithful inversion auto-dismiss.** Both validators
   ship known false positives on Mode A renders — Arial fallback
   reads as "overused-font," eyebrow uppercase reads as
   "all-caps body," pure white / pure black flagged when the
   brand's captured palette includes them. Before surfacing
   findings to the user, diff each finding against
   `DESIGN.json#extensions.divergence.brand_faithful_inversions[]`
   and `DESIGN.md#narrative.rules` (e.g. permitted uppercase
   contexts). Drop findings whose category and target match an
   approved inversion; keep the original list in
   `_provenance.<critique|audit>[]` with a
   `dismissedAsBrandFaithful: true` flag for audit-trail
   purposes. The user-facing report shows only the real hits.

3. **Surface findings in the user-facing report**, grouped by
   priority across both validators with the source attributed
   (`critique:` / `audit:`). List the first 5 P0/P1 verbatim;
   collapse P2/P3 to per-source counts with an "expand to see
   all" pointer. Format:

   ```
   Critique + audit on home-proposed.html

   P0 (1)
     audit:    skip-link missing — header has no <a href="#main"> as first focusable
   P1 (4)
     critique: hierarchy regression — H2 visually heavier than H1 in section #features
     audit:    hero <img> 3.5MB; no responsive <picture> set despite captured srcset
     audit:    transition: width animates layout properties (jank)
     audit:    .hero scroll-behavior: smooth not gated by prefers-reduced-motion
   P2 (3 critique, 1 audit) — expand to see
   P3 (0)
   ```

4. **Gate `prototyped` status on P0/P1 findings from EITHER
   validator.** If the merged-and-deduped findings list (after
   the brand-faithful auto-dismiss) contains any P0 or P1, do
   **not** mark the page `prototyped` in `state.json` yet. The
   proposed file is on disk and openable in the browser, but the
   page stays in `directed` until either:
   - The agent fixes the issue (run a chat-driven impeccable
     command per Phase 4 iteration paths, then re-run Phase 2.5).
   - The user explicitly acknowledges (e.g. "ship as-is" /
     "accept the P1 findings"). Acknowledgement is recorded in
     `_provenance.critique[]` AND `_provenance.audit[]` with the
     verbatim user phrase, so re-runs see the existing
     acknowledgement and don't re-prompt.

   P2/P3 findings do not block `prototyped`. They surface as
   advisory.

5. **Optionally spawn an LLM design-review subagent** for an
   independent take when the user wants more than the
   deterministic detector. Trigger only when the user explicitly
   asks ("give me a deeper critique", "second opinion") or when
   the deterministic pass returns ≥3 P0/P1 findings (signal that
   the render has multiple issues worth a closer look). Default
   off to keep the loop fast.

Both validators are mandatory. There is no opt-out flag — if a
finding bites and the user wants to ship anyway, they say so in
chat ("ship as-is" / "accept the P1 findings") and the
acknowledgement is recorded in `_provenance.critique[]` AND
`_provenance.audit[]` verbatim. The contract is that the gate
runs; the user can override the gate but the override is
explicit and recorded.

Failure handling: when impeccable is unavailable per the
Delegation mechanic, prototype refuses to run (impeccable is a
hard requirement). There is no degraded mode that ships
unverified output.

### Phase 4 — Open and iterate

(Phase numbering skips 3; the former Phase 3 — *Compose the viewer*
— was removed when the per-page before/after viewer was dropped.
Cross-references throughout the docs still name Phases 4, 5, 5.5.)

1. Open the just-written or just-updated `<slug>-proposed.html` (or
   the user-chosen variant suffix when N > 1) in the default
   browser (`open` macOS, `xdg-open` Linux, `start ""` Windows). If
   multiple files were written in one run, open the primary variant
   only. Skip in pipeline-automation mode.
2. Mark the page `prototyped` in `state.json` — **gated on the
   Phase 2.5 critique + audit result**. If either validator
   returned ≥1 P0 or P1 finding (after the brand-faithful
   inversion auto-dismiss) and the user has not acknowledged,
   the page stays `directed` (not `prototyped`); surface the
   findings in the report grouped by source (`critique:` /
   `audit:`) and recommend either fixing the issue or
   acknowledging explicitly. The transition itself does not
   require *approval* (a separate later step) — but it does
   require the gate to clear, since shipping a `prototyped` flag
   on work that fails P0/P1 critique or audit misleads
   downstream consumers (migrate, the dashboard) about the
   prototype's quality.
3. Report the prototype path and stop. Iteration happens via
   chat-driven impeccable commands or direct invocation (see
   § Iteration paths below).

#### Iteration paths

Refinement after the initial render takes one of two forms. They
are not mutually exclusive — a single page can move through both
across its lifetime.

1. **Chat-driven (default).** The user gives a refinement phrase
   in chat — *"make the hero bolder for home"*, *"tighten the
   cup-note grid"*, *"less corporate"*. The agent:
   - Reads the phrase against
     `skills/stardust/reference/intent-dimensions.md` to identify
     which axes it moves.
   - Consults
     `skills/stardust/reference/impeccable-command-map.md` to pick
     the matching impeccable command (often `bolder`, `quieter`,
     `distill`, `typeset`, `colorize`, or `layout`).
   - Shows the resolved plan to the user before executing.
   - Runs the chosen command against `<slug>-proposed.html` (or a
     specific section within it, when the phrase scopes one).
   - Re-validates per Phase 2 (`:root` block, data attributes,
     anti-toolbox audit clean, impeccable hard rules) and updates
     the proposed file's provenance.

2. **Direct impeccable invocation.** The user runs an impeccable
   command directly — `$impeccable bolder
   stardust/prototypes/home-proposed.html`. Stardust isn't in the
   loop; the browser tab reloads whatever's on disk. This is fine
   and documented as a supported escape hatch. (Includes
   `$impeccable live` against the proposed file when the user
   wants in-browser picker iteration — that's an external tool
   they invoke directly; stardust does not drive its poll loop.)

The "open and reasoned" principle from the master skill applies to
path 1: the agent reasons publicly about the phrase before running
any command, and never silently maps a refinement to a fixed
command.

### Phase 5 — Approval

Approval is **explicit**. Stardust does not auto-approve.

The user signals approval by saying **"approve <slug>"** or simply
**"approve"** in the conversation. The agent confirms the slug
before writing state, then proceeds.

On approval:

1. Verify the proposed file's provenance block lists the *current
   active* `direction.md` (defensive check — if the direction changed
   during iteration, the user must re-prototype against the new
   direction first).
2. Mark the page `approved` in `state.json`. Append a
   `{ status: "approved", at: <ts> }` history entry.
3. Clear any `stale` flag on the page.
4. **Run Phase 5.5 — Adapt for mobile** (below) on the variant
   the user is signing off on. Approval does not complete until
   the adapt pass lands; surface it as one extra step in the
   approval report rather than a separate user gesture.
5. Print:
   ```
   home: approved
     proposed: stardust/prototypes/home-proposed.html
     mobile:   adapted (4 @media rules at 640/768/1024/1280)

   Next: $stardust migrate home  (write final redesigned static HTML)
   ```

If multiple pages are in flight, approval is per-page; the user can
approve some and continue iterating on others.

### Phase 5.5 — Adapt for mobile

Every variant the user approves goes through `$impeccable adapt`
before it leaves the prototype phase. The cascade ships
desktop-only HTML otherwise — viewports are tuned to ~1440×900
through render and iteration, and nothing earlier in the
pipeline produces responsive coverage. The 2026-05-03 lovesac.com
showcase publish surfaced this: stakeholders eyeballing variants
on a phone got the unadjusted desktop layout (bracket motif
crowding, overflowing trust band, hamburger absent, hero
unstacked) — and the question *"did you run impeccable adapt?"*
was the only thing that caught the gap, after publish.

Trigger: any variant the user approves OR any variant explicitly
flagged `isPrimary: true` in `meta.json#variants[]` for a
multi-variant render. When the user wants adapt run against a
non-primary variant (B / C / etc.), they re-prototype that variant
or ask in chat for the specific variant to be adapted.

Procedure:

1. Invoke impeccable adapt against the approved file:

   ```
   Skill {
     skill: "impeccable:impeccable",
     args: "adapt stardust/prototypes/<slug>-proposed.html"
   }
   ```

   Pass the captured viewport breakpoints from
   `DESIGN.json#extensions.breakpoints` if present; otherwise
   adapt picks defaults (640 / 768 / 1024 / 1280 are the
   stardust spec defaults — anything above 640 used as a "mobile
   breakpoint" is a smell per § Mobile-adapt audit below).

2. Validate the adapted file against the same contracts Phase 2
   ran (`:root` token block, data attributes, anti-toolbox audit
   clean, impeccable hard rules, content sourcing). The adapt
   pass is an iteration over the existing render; it must not
   reintroduce contract violations.

3. Append an entry to the proposed file's `_provenance.adapt[]`
   recording: ISO timestamp, the breakpoint list applied, the
   number of `@media` rules added, and any layout decisions the
   adapt pass surfaced (carousel → stack, sidebar → drawer,
   hamburger → menu, etc.).

4. Update the report (Phase 5 step 5) with the `mobile:` line.

#### Mobile-adapt audit

Phase 5.5 also runs a hard audit, separate from the adapt pass
itself, that the resulting file would survive a publish or
migrate. The same audit re-runs at `migrate` and `--publish-sample`
so an adapted-but-broken render can't slip through (per
`skills/migrate/SKILL.md` § Setup, `skills/prototype/reference/
publish-sample.md` § Phase 1).

Refuse the file when **any** of:

- `<meta name="viewport" content="width=device-width, ...">` is
  missing or width is set to a fixed pixel value.
- The file declares zero `@media (max-width: ...)` rules at all
  (desktop-only).
- The file declares mobile-targeted breakpoints **above 640px**
  — `@media (max-width: 1024px)` as the *narrowest* breakpoint
  is the recognisable shape of "didn't actually adapt for
  phones." Adapt should produce at least one rule at ≤ 640px.
- **At a 360px-wide rendered viewport:** a landmark causes
  `scrollWidth > clientWidth` on `document.documentElement` or
  `document.body`. Refusal code:
  `audit/responsive: horizontal-overflow-at-360px`. The captured
  shrink-the-nav adapt move recurringly fails this — the prototype
  derived from birrificiolambrate.com totalled ~447px of header
  content inside a 430px viewport even after font + gap
  reductions.
- **At a 360px-wide rendered viewport:** the computed `font-size`
  of any descendant of a `<nav>` inside a `<header>` is below
  11px. Refusal code:
  `audit/responsive: nav-readability-floor`. The 11px floor is
  the minimum legible body size on phones; anything below reads
  as "unreadable but technically fits."
- **At a 360px-wide rendered viewport:** the computed `gap` (or
  `column-gap`) of any flex/grid `<nav>` inside a `<header>` is
  below 10px. Same refusal code
  (`audit/responsive: nav-readability-floor`). The 10px floor is
  what keeps adjacent links visually distinct as separate touch
  targets.

The last three conditions require actually rendering the file —
they can't be inferred from CSS text. The canonical check is a
small Playwright snippet (`fixtures/mobile-nav-audit.mjs`) the
agent runs against the file at 360×800. Audit messages must
include a pointer to the stock-template doc:

> Suggested fix: apply the stock hamburger pattern
>   skills/prototype/reference/mobile-nav-collapse.md

When the audit refuses, the page does **not** demote from
`approved` (the approval already landed); but the report carries
the failure prominently and migrate / publish-sample will refuse
to consume the file until it passes. There is no flag to skip
this audit — if a project legitimately needs a desktop-only
render, the user edits the file's `_provenance.adapt[]` to
record `adapt: deliberately desktop-only (<user-reason>)` and
the downstream gates honor the explicit acknowledgement.

#### Mobile nav collapse

When the audit refuses on either of the nav-related codes above
(`horizontal-overflow-at-360px` or `nav-readability-floor`), the
agent applies the stock CSS-only hamburger pattern documented in
`reference/mobile-nav-collapse.md`. Procedure:

1. Inject the stock pattern into the file (HTML + CSS + ≤10-line
   inline `<script>` for a11y). The header gains
   `data-nav-collapse="hamburger"` so downstream consumers can
   detect the pattern is applied (see
   `skills/stardust/reference/data-attributes.md`).

   **Source order is load-bearing.** The base
   `.ds-nav-burger { display: none; ... }` rule must be placed at
   the **top** of the `<style>` block (right after the `:root`
   token block, before any `@media` rules), not appended at the
   bottom. Same selector + same specificity means the later
   declaration wins; if the base is appended *after* the
   `@media (max-width: 640px)` override, the burger stays hidden
   at every viewport and the file silently regresses to the
   bare-nav failure mode.

2. **Run the post-injection ordering check** before re-running
   the audit. The check is a small `awk` one-liner documented in
   `reference/mobile-nav-collapse.md` § Source order — it asserts
   the base `.ds-nav-burger` rule appears at a lower line number
   than the first `@media (max-width: 640px)` rule. Exit 0 =
   correct ordering; exit 1 = regression. On regression, fix the
   ordering and re-run the check; do not proceed to step 3 with
   a known-bad file.

3. Re-run the audit. If the audit passes, continue with the
   `_provenance.adapt[]` entry recording the pre/post findings
   and `navCollapse: hamburger (stock)`.

4. If the audit still refuses (rare — the most likely cause is a
   wordmark itself wider than 360px), surface the residual
   finding and wait for direction. Do not iterate further without
   user input.

The stock pattern is the default; `reference/mobile-nav-collapse.md`
§ Alternative patterns documents priority+overflow, bottom nav,
and side-drawer as valid alternatives the user can request, but
the agent does not pick between them autonomously. If the user
genuinely doesn't want a hamburger, they ask in chat and the
agent applies one of the alternatives (or edits the file to
suppress the collapse and records the choice in
`_provenance.adapt[]`).

### Stale handling

When `direction.md` changes, the prototype's `againstDirection`
provenance becomes outdated and `state.json` flags the page
`stale: true`. Default behaviour:

- `$stardust prototype` (no slug) skips stale pages and reports the
  count: `2 stale pages (home, about) — re-run with --all.`
- `$stardust prototype home` operates on `home` even if stale.
- `$stardust prototype --all` re-prototypes every directed page
  including stale ones.

When a stale page is successfully re-prototyped, clear its `stale`
flag and update `againstDirection` to the new active direction.

## Outputs

| Path                                          | Purpose                                       |
|-----------------------------------------------|-----------------------------------------------|
| `stardust/prototypes/<slug>-shape.md`         | Per-page compositional brief (Phase 1 output, craft input). |
| `stardust/prototypes/<slug>-proposed.html`    | Proposed redesign (chat-driven iteration target, migration source, user-facing review surface). |
| `stardust/state.json`                         | Updated with page status and approval history. |
| `DESIGN.json`                                 | Updated with `extensions.divergence.anti_toolbox_hits` and any audit amendments from this prototype's render. |

## Failure modes

- **No directed pages.** Recommend `$stardust direct` and stop.
- **Pending direction.** Refuse to run; the user must resolve the
  direction first.
- **Validation failure (:root block missing, data attributes missing,
  unjustified anti-toolbox hit, impeccable rule violation).** Do not
  write the file. Surface the specific failure and a suggested fix.
- **Impeccable not available.** Refuse to run — impeccable is a
  hard requirement (Delegation mechanic). Recommend the user
  install the impeccable plugin and re-invoke.

## Concurrency

Per `state-machine.md`: stardust does not lock. Two concurrent
`prototype` runs on different slugs are safe. Two on the same slug
are last-write-wins; warn the user if they explicitly try.

## Prep mode (--prep)

When invoked with `--prep`, prototype runs an extended pass that
fills page-type gaps and writes canon. Discovery-mode runs are
unchanged: per-slug shape brief, render via `$impeccable craft`,
open in browser, iterate, approve.

`--prep` adds three things on top of the standard procedure:

### 1. Fill page-type gaps

Identify every page type in `state.json.pages[].type` that
doesn't yet have an approved archetype. For each gap, prototype
one representative page (the user picks which slug, or the first
page of that type by default):

- `article`-typed pages with no approved article: prototype one
- `listing`-typed pages with no approved listing: prototype one
- `program`, `form`, `static` — same pattern
- `landing` — the home; prototyped first if not already done
- `unique`-typed pages — these don't get archetypes; they're
  rendered as one-offs at migrate time

The user picks one variant per type. Subsequent pages of the
same type are migrated by forking that approval (Path A′ in
`skills/migrate/SKILL.md`).

### 2. Canon write-back on first approval

The first prototype approved (default the home; override with
`--canon-from <slug>`) becomes the **canon-author**. On
approval, extract canon and write back per
`reference/canon-extraction.md`:

1. Chrome HTML → `stardust/canon/header.html`,
   `stardust/canon/footer.html`, optional regions.
2. Compound CSS → `stardust/canon/canon.css`.
3. Pinned tokens → `DESIGN.json.extensions.canon.pinned`.
4. Module canonical renderings →
   `stardust/canon/modules/<id>.html`.
5. Compositional moves (LLM-authored, 3–7 lines) →
   `DESIGN.json.extensions.canon.compositionalMoves`.

Reference all extracted files via `{ path, sha }` in
`DESIGN.json.extensions.canon.files`. Each canon file carries a
`stardust:canon` provenance comment naming source slug, source
prototype, and region.

### 3. Canon write-back on subsequent approvals

For non-canon-author template approvals (article, listing, etc.),
canon-extraction runs in **diff mode** per
`reference/canon-extraction.md` § Conflict resolution:

- **Net-new items** (a module not yet in canon, a new compound
  CSS class, a new compositional move) → append to canon
  additively. Add a history entry naming what was added.
- **Match canon byte-for-byte** → no-op.
- **Conflict with canon** → default is **log as deviation**:
  the migrated/prototyped page carries the deviation inline
  marked with `data-deviation="<reason>"`, and the page's
  `migrationDecisions[]` records a `canon-deviation` entry.
  Canon stays unchanged.

Override the default per-conflict via the prep summary if the
user wants to promote the new variant to canon (which stale-flags
downstream pages that consumed the changed item) or reject and
re-iterate the prototype. Without an explicit override, the
conflict logs as deviation and approval proceeds.

### Prep summary

```
prototype --prep complete
=========================

Approved archetypes:
  landing   home (V01 Polish)            canon-author
  article   news/post-housing-summit
  listing   news (the index)
  program   programs/shelter
  form      donate
  static    about

Canon: stardust/canon/ + DESIGN.json.extensions.canon
  Sources:  home → article (1 deviation logged), listing (clean),
            program (1 deviation logged), form (clean), static (clean)
  Modules:  8 confirmed; canonical renderings written
  Pinned:   sectionPadding, densityTier, typeScale set

Next: $stardust migrate  (apply canon to every page in inventory)
```

Default mode is unchanged.

## References

- `reference/page-shape-brief.md` — per-page compositional brief
  format (Phase 1 output, craft input). Page-level deployment
  decisions live here; site-level system decisions live in
  DESIGN.md.
- `reference/canon-extraction.md` — the five-step canon-extraction
  procedure performed on prototype approval in `--prep` mode.
- `reference/proposed-file-shell.md` — proposed-file schema and
  required structure (`:root` token block, data attributes,
  provenance, content sourcing hierarchy, mobile-adapt audit).
- `reference/publish-sample.md` — `--publish-sample` sub-flow:
  eligibility checks, file staging, PR creation against the
  upstream stardust showcase. Lands the prototype as a public
  sample at `https://{owner}.github.io/stardust-2/`.
- `reference/mobile-nav-collapse.md` — stock CSS-only hamburger
  pattern Phase 5.5 auto-applies when the Mobile-adapt audit
  refuses on `horizontal-overflow-at-360px` or
  `nav-readability-floor`. Carries the copy-pasteable
  HTML+CSS+JS, the audit smoke-test command, and the
  alternative-pattern vocabulary.
- `skills/stardust/reference/token-contract.md` — `:root` token
  block (cross-cutting, used by prototype + migrate).
- `skills/stardust/reference/data-attributes.md` — structural data
  attribute vocabulary (cross-cutting, used by prototype + migrate).
- `skills/stardust/reference/divergence-toolkit.md` —
  anti-mediocrity rules consumed during render and iteration.
- `skills/stardust/reference/intent-dimensions.md` — the 7-axis
  vocabulary used to read a chat-driven refinement phrase
  (iteration path 2).
- `skills/stardust/reference/impeccable-command-map.md` — when to
  reach for each impeccable command. Consulted during chat-driven
  iteration (path 2) to pick the command for a refinement phrase.
- `skills/stardust/reference/state-machine.md` — page lifecycle
  and stale rules.
- `skills/stardust/reference/artifact-map.md` — provenance shape.
- impeccable's `reference/craft.md` and `reference/live.md` — the
  underlying impeccable commands stardust delegates to.
