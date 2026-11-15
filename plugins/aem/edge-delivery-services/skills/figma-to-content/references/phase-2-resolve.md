# figma-to-content: phase 2, resolve each section

The text of this part of `SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Phase 2 — Resolve each section

Every section resolves to exactly one of: **existing block** (→ 3A),
**default content** (→ 3C), or **new block** (→ 3B). How that decision is
reached depends on whether the section is annotated.

### 2.0 — Know the project's block palette (always)

Before resolving anything, enumerate what the project **already has**:
`ls -d blocks/*/` plus **block-collection-and-party** for
each block's **authoring model** (row/cell structure, variants) **and a
rendered example** — the block's `liveExampleUrl` when it comes from the Block
Collection, or the project's own block rendered at `localhost:3000`. That
rendered example is the "block side" of the 2.1 / Phase 3A visual check. This
is the reuse-candidate set — essential when the customer is already on EDS with
their own blocks.

### 2.1 — Resolve each section (annotation-first, else infer)

**If the section is annotated** (see
[references/annotation-contract.md](./annotation-contract.md)), the
annotation is **authoritative**: named block that exists → existing block (3A);
marked `new` (or absent-and-user-confirmed) → new block (3B); plain prose/media
→ default content (3C).

**If it is not annotated** (e.g. "just migrate this page"), **infer** the
mapping — do not dump it as unresolved:

1. Plain prose/media (headings, paragraphs, images, a standalone link) with no
   repeating structure → **default content** (3C).
2. Otherwise match it against the 2.0 palette using the **reuse gate (structure
   AND visual, Phase 3A)**: does its content model fit an existing block *and*
   does that block's rendered example — under the project theme — look like the
   section, allowing only token differences and variants the block defines?
   - **Both fit → existing block** (3A).
   - **Structure fits but the look diverges** (bespoke card/layout/decoration
     the block's CSS can't produce without editing it), **or nothing fits →
     new block** (3B).
   - **A section carrying an interactive control** — tabs / segmented switch,
     accordion, carousel or slider, toggle — is structural divergence no static
     block reproduces: route it to a **new block** (3B), or, if the control is
     non-essential chrome, **confirm with the user** whether to keep it or
     flatten it to static content. Don't silently drop the interaction or fake
     it with a look-alike static block.
3. Attach a **confidence** to every inference: `high` (clear reuse match, or
   clearly novel) or `low` (structure fits but styling is borderline; two
   blocks plausibly fit; new-variant-vs-new-block; content model ambiguous).

### 2.2 — Confirm the plan before deploying (never deploy a guess)

Present a **resolution plan** — one line per section: decision (reuse `X` /
default content / new block `Y`), confidence, a one-clause rationale, and a
**content flag** on any section whose copy or media is placeholder (Phase 1)
and needs real content before publish.

- **High-confidence sections auto-proceed through building** (Phases 3–4) —
  don't block on them.
- **Stop and ask before building** any `low`-confidence section or genuine
  ambiguity, offering the concrete choice (reuse this block vs. new block;
  which block; new variant vs. new block). Wait for the answer.
- **Pause once before deploying (Phase 5)** whenever the plan contains any
  **inferred** (unannotated) mapping: show the final plan and get a single
  confirmation before the da.live write/preview — deploy is outward-facing and
  hard to reverse. Skip this pause only if the user pre-authorized an
  unattended run. A **fully annotated** plan needs no pause — the annotations
  are the authorization.
- **Flag an existing target page.** Before confirming, check whether the target
  `content/<PATH>.html` already exists in DA (a cheap Source-API `GET`, Phase 5);
  if it does, deploying **overwrites** it — say so in the plan and get explicit
  overwrite confirmation. Never silently clobber a page you didn't create, even
  on an otherwise pre-authorized unattended run. **Record two facts per path** for
  Phase 5 to enforce: `PLANNED_STATE` (`new` if the check returned 404, `exists`
  if 200) and `OVERWRITE_OK` (`yes` only when the user confirmed overwriting an
  existing page). Phase 5 re-checks existence right before writing and **refuses**
  if the state changed since planning (a page appeared in the gap) or overwrite
  was never confirmed — the plan-time check alone is not a license to clobber.
- The user can override any line.

Never silently drop a section, and never deploy an **inferred** mapping the
user has not seen.

**Worked example** — an unannotated 4-section frame; this is the plan you
present in 2.2 (one line per section):

| # | Section | Decision | Conf. | Why | Content |
|---|---|---|---|---|---|
| 1 | Hero band — heading + 2 CTAs over a photo | reuse `hero` | high | model fits; heading **and** CTAs stay legible on the media under the theme | ok |
| 2 | 3 feature blurbs — icon + title + text | reuse `cards` | high | content model and rendered look both fit | ok |
| 3 | Metric strip — 3 big numbers + labels | **new block** `stat-cards` | high | bespoke panel look no existing block produces (3B) | ok |
| 4 | Newsletter row — heading + email field + button | **new block** / confirm | low | carries an interactive control (input) — ask keep vs. flatten (G5) | ⚠ placeholder copy |

Then act on it: sections 1–2 build without blocking; #3 builds (high-confidence
new block); **#4 stops for a decision** (low-confidence + interactive control);
and because the plan contains inferred mappings, the whole thing gets **one
pre-deploy confirmation** before the da.live write. Section #4's ⚠ flag means
its real copy must be supplied before publish, not shipped as placeholder.

### 2.3 — Lock the orchestration manifest (which sub-skills this plan requires)

Turn the confirmed plan into an explicit **manifest** of the sub-skills it
requires and **invoke each one** — this is where the intro's *orchestrate, don't
inline* rule becomes a concrete, ticked list. This file's summaries never
substitute for loading the named skill.

Derive the manifest from the plan:

| The plan contains… | You MUST invoke |
|---|---|
| **Any** section (always) | **da-auth** (token) and **da-content** — load its real `SKILL.md` and `references/`, *not* the condensed rules in this file — before authoring (Phase 4) and deploying (Phase 5). |
| An **existing-block reuse** (3A) | **block-collection-and-party** (authoring model + a rendered example) **and testing-blocks** for the visual reuse gate (rendered block vs. the Figma section screenshot). |
| A **new block** (3B) | **content-modeling** (design the authoring model), then **content-driven-development** (which runs **building-blocks** and **testing-blocks**). Do **not** hand-write block JS/CSS from this file. |
| **Default content** (3C) | **da-content** only (no block skills). |

Record the manifest as an evidence-bearing checklist and tick each item **only
after you actually invoked the skill** — "I know what it does" is not invocation,
and an un-invoked required skill means this phase is **not complete**:

- [ ] **da-content** reference docs loaded (`SKILL.md` and `references/`)
- [ ] **block-collection-and-party** invoked for every reused block *(if any 3A)*
- [ ] **content-modeling** + **content-driven-development** invoked for every new block *(if any 3B)*
- [ ] **Default-content** sections authored via **da-content** alone — **no** block-building skills invoked for them *(if any 3C)*
- [ ] **testing-blocks** invoked — its browser render + visual comparison **is** the
      Stage B pre-publish check (Phase 5); a run with **no** browser available
      reports the page **preview-only, UNVERIFIED**, never "done".

If the environment genuinely cannot run a required skill (e.g. no browser for
testing-blocks), **say so explicitly in the report and mark the affected checks
unverified** — never silently substitute this file's summary and call it passed.
