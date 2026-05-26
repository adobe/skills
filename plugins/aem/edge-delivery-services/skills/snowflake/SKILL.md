---
name: snowflake
description: Static-to-EDS overlay conversion that preserves the original DOM byte-for-byte while making text and image content authorable in Document Authoring. Use when converting an AI-generated static HTML page (Stardust, Mobirise, Relume, Lovable, v0, Figma-derived hand-coded, etc.) into an Edge Delivery Services page WITHOUT rewriting it into canonical block markup. Triggers on "convert this page to EDS overlay", "static-to-EDS overlay", "next experimentation", "next run", "start run #N", or when a user provides a source URL and asks to make it editable in DA while keeping the original design intact. Do NOT use for canonical EDS block-rewrite migrations — that's the page-import skill.
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# Snowflake — Static-to-EDS Overlay Conversion

Convert a static HTML page into an EDS page using the **overlay
pattern**: the original DOM is preserved exactly, and only the text
and image content becomes authorable in Document Authoring. Header
and footer remain static repository fragments. The page CSS and any
animation JavaScript ship per-template under the EDS code bus.

## When to use

The user has an AI-generated polished static HTML page and wants to
launch it on Edge Delivery Services without losing the original
design while still making content editable in DA. Typical phrasing:

- "Convert https://example.com/static-page to EDS"
- "Make this page editable in DA but keep the original markup"
- "Start the next experimentation for URL …"
- "Static-to-EDS overlay for …"

## What this skill does NOT do

- Does **not** rewrite the page into EDS-shape markup (`div`-with-class
  blocks). That's `page-import`. The overlay pattern keeps the
  original generator's DOM intact.
- Does **not** modify the EDS substrate code in the target repo
  unless the conversion surfaces a substrate gap. Substrate evolution
  is a separate change with its own PR review.

The skill **does** support three asset strategies (see
[knowledge/methodology.md](./knowledge/methodology.md) §3): `absolute`
(rewrite to source-host URLs), `vendor` (copy into `./assets/`), and
`da-media` (upload to `/media/<scope>/` via the bundled
`da-media-upload.mjs` script).

## Skill dependencies

Snowflake cites DA HTML rules and the DA admin API contract from the
**da-content** skill. **Load `da-content` alongside Snowflake.**
Phases 3 (Generate) and 5 (Round-trip) reference it directly.

## Prerequisites

Confirm with the user before invoking:

1. **Source URL** — the static page to convert. Must be reachable
   (publicly hosted or local dev server).
2. **Target EDS repo** — owner/repo on GitHub. Must already have the
   overlay engine wired (see [knowledge/architecture.md](./knowledge/architecture.md)
   §"Solution shape"). Phase 0 installs it if absent.
3. **DA root path** — where in the DA tree the converted doc lands
   (e.g., `/<some-root>/<page-slug>`).
4. **DA admin token** — Snowflake reads `$DA_TOKEN` from the environment,
   or `~/.aem/da-token.json` (the cache **da-auth** writes). If neither
   is set, invoke the **da-auth** skill first.

## Quick start

From the target EDS repository root, kick off Phase 0 (substrate
install / verify) and then proceed phase-by-phase:

```bash
# 1. Install (or verify) the overlay substrate — runs once per repo.
#    --dry-run previews the change; drop it to apply.
node "<SKILL_DIR>/scripts/install-substrate.mjs" --dry-run
node "<SKILL_DIR>/scripts/install-substrate.mjs"

# 2. Load the canonical phase rules, then walk the seven phases in
#    order. Each phase file is self-contained executable bash + Node.
cat "<SKILL_DIR>/knowledge/methodology.md"     # canonical rules
cat "<SKILL_DIR>/phases/1-capture.md"          # then phase 1
# ... through phases/6-reflect.md
```

`<SKILL_DIR>` is the absolute path to the directory containing this
`SKILL.md`. The agent computes it from the file location and substitutes
it into each invocation — see [HOST-NOTES.md](./HOST-NOTES.md)
for per-host resolution rules.

## The seven phases (sequential)

Each phase is a self-contained markdown file with executable bash + Node.
The agent reads the phase prompt, runs its steps, updates `state.json`
at the project root (`<projectsDir>/<NNN>-<slug>/state.json`), and
proceeds. Reruns are safe — phases skip work already done.

0. **Prerequisites** — install/verify the overlay substrate; stamp
   `.snowflake/config.json`. Runs once per repo.
   See [phases/0-prereq.md](./phases/0-prereq.md).

1. **Capture** — fetch source HTML and referenced external assets;
   create the project folder.
   See [phases/1-capture.md](./phases/1-capture.md).

2. **Analyze** — structural map: header/footer boundaries, section
   list, slot opportunities, head-level links to lift, asset strategy.
   Produces `notes.md` + `decisions.json`.
   See [phases/2-analyze.md](./phases/2-analyze.md).

3. **Generate** — produce the 5 deployable artifacts (template HTML,
   header fragment, footer fragment, page CSS, page animations JS)
   plus the DA-source body fragment.
   See [phases/3-generate.md](./phases/3-generate.md).

4. **Wire** — copy artifacts to EDS-served paths, build the local-test
   drafts file, run lint.
   See [phases/4-wire.md](./phases/4-wire.md).

5. **Round-trip** — local (dev server + headless browser) then
   production (branch + push + DA PUT + preview API + verify on
   `<branch>--<repo>--<owner>.aem.page`).
   See [phases/5-roundtrip.md](./phases/5-roundtrip.md).

6. **Reflect** — append run findings; promote cross-project learnings
   to [knowledge/learnings.md](./knowledge/learnings.md). **Does not
   close the iteration** — that's a user decision.
   See [phases/6-reflect.md](./phases/6-reflect.md).

**Knowledge resolution per phase:** each phase tries
`.snowflake/knowledge/<file>.md` (project-specific override) first,
then `<SKILL_DIR>/knowledge/<file>.md` (bundled, canonical). Project
overrides win on conflict.

## Reading order for first invocation

1. This file.
2. Confirm the `da-content` skill is loadable (cited by phases 3 and 5).
3. [knowledge/methodology.md](./knowledge/methodology.md) — canonical
   phase rules.
4. [knowledge/architecture.md](./knowledge/architecture.md) — overlay
   engine and slot writer semantics (Generate needs this most).
5. [knowledge/learnings.md](./knowledge/learnings.md) — cross-project
   findings (Generate and Round-trip should at least skim it).
6. [knowledge/eds-da-mechanics.md](./knowledge/eds-da-mechanics.md) —
   EDS pipeline overlay-runtime lore.
7. The phase prompt for the current phase.

Then start at Phase 0.

## Further reading (not loaded by the agent)

- [README.md](./README.md) — human-readable overview, install commands,
  contribution guidelines.
- [HOST-NOTES.md](./HOST-NOTES.md) — per-host adapter notes (Slicc,
  Claude Code, generic shell), `<SKILL_DIR>` path resolution rules,
  `.snowflake/` directory convention, and forbidden cross-host
  primitives (for maintainers).
- [examples/README.md](./examples/README.md) — pointers to worked
  examples from closed iterations.
