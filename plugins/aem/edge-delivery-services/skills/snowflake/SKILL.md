---
name: snowflake
description: Static-to-EDS conversion that preserves the original design while making content authorable in Document Authoring. Two modes — page-level (overlay template with slot markers) and block-level (each section becomes an independent EDS block). Use when converting an AI-generated static HTML page (Stardust, Mobirise, Relume, Lovable, v0, Figma-derived hand-coded, etc.) into an Edge Delivery Services page. Triggers on "convert this page to EDS", "static-to-EDS overlay", "convert to EDS blocks", "next experimentation", "next run", "start run", or when a user provides a source URL and asks to make it editable in DA while keeping the original design intact. Do NOT use for canonical EDS block-rewrite migrations — that's the page-import skill.
license: Apache-2.0
metadata:
  version: "1.1.0"
---

# Snowflake — Static-to-EDS Conversion

Convert a static HTML page into an EDS page while preserving the
original design and making content authorable in Document Authoring.
Two conversion levels are supported:

- **Page-level** (overlay) — the original DOM is preserved
  byte-for-byte via a template with `[data-slot]` markers. One
  template, one CSS file, one DA doc with slot-keyed rows.
- **Block-level** — each content section becomes an independent EDS
  block with its own `decorate()` function and CSS. Content is
  authored in DA block tables. Header and footer stay as static
  fragments.

Both levels keep the original visual design intact. Page-level is
the safer default; block-level produces more standard EDS output
but requires section independence in the source page.

## When to use

The user has an AI-generated polished static HTML page and wants to
launch it on Edge Delivery Services without losing the original
design while still making content editable in DA. Typical phrasing:

- "Convert https://example.com/static-page to EDS"
- "Make this page editable in DA but keep the original markup"
- "Convert this page to EDS blocks" (signals `level=block`)
- "Start the next experimentation for URL …"
- "Static-to-EDS overlay for …" (signals `level=page`)

## What this skill does NOT do

**Not for canonical EDS block-rewrite migrations** — that's
`page-import`. Snowflake preserves the source design; `page-import`
rewrites to standard EDS block patterns with no visual fidelity
target. Three asset strategies are supported (see
[knowledge/methodology.md](./knowledge/methodology.md) §3):
`absolute`, `vendor`, `da-media`.

## Parameters

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `level` | `auto`, `check`, `block`, `page` | `auto` | Conversion level — see below |

### `level` values

| Value | Behavior |
|-------|----------|
| `auto` | Run the feasibility analysis in Phase 2, present the recommendation, ask the user to confirm before Phase 3 |
| `check` | Run the feasibility analysis only — produce the report in `decisions.json`, stop before Phase 3. Useful for batch scanning |
| `block` | Block-level conversion. Analysis still runs as validation (written to `decisions.json`) but does not gate the conversion |
| `page` | Page-level conversion (standard overlay). Analysis still runs as validation but does not gate the conversion |

When `level` is not provided and the user's phrasing signals intent,
infer it:
- "convert to EDS blocks", "block-level" → `level=block`
- "overlay", "preserve the DOM", "snowflake overlay" → `level=page`
- Neutral phrasing → `level=auto`

### Usage examples

```
/snowflake                          → auto (interactive)
/snowflake level=check              → feasibility scan only
/snowflake level=block              → block-level, no confirmation
/snowflake level=page               → page-level overlay
```

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
5. **Conversion level** (optional) — if the user hasn't specified,
   defaults to `auto`. See the Parameters section above.

## Quick start — end-to-end example

From the target EDS repository root, here's the full seven-phase
conversion in compressed form. Each phase file under
[phases/](./phases/) holds the complete prompt; this is the
shape of the actual commands the agent emits.

```bash
# Inputs (gathered from the user during Prerequisites)
SOURCE_URL="https://example.com/promo"
PAGE_SLUG="promo"
DA_ROOT="/marketing"
NNN=001                           # next run number
PROJECT=".snowflake/projects/${NNN}-${PAGE_SLUG}"
TEMPLATE_NAME="promo"
LEVEL="auto"                      # auto | check | block | page

# Phase 0 — install (or verify) the overlay substrate (once per repo)
node "<SKILL_DIR>/scripts/install-substrate.mjs"

# Phase 1 — capture: fetch source + assets into the project folder
mkdir -p "$PROJECT/input"
playwright-cli tab-new "$SOURCE_URL"
playwright-cli html > "$PROJECT/input/${PAGE_SLUG}.html"

# Phase 2 — analyze: produce decisions.json (sections, slots, asset
# strategy, head-links, conversionLevel). Includes block-level
# feasibility assessment. If LEVEL=check, stop here.
# Driven by phases/2-analyze.md.

# Phase 3 — generate: produce 5 artifacts + DA-source body
# (templates/<tpl>.html, fragments/<tpl>/{header,footer}.html,
# styles/<tpl>.css, scripts/<tpl>-animations.js, da/<slug>.html).
# Driven by phases/3-generate.md.

# Phase 4 — wire: copy artifacts to EDS-served paths and build the
# drafts file. Driven by phases/4-wire.md.

# Phase 5 — round-trip: local dev server + production preview
npx -y @adobe/aem-cli up --html-folder drafts &
TOKEN="${DA_TOKEN:-$(jq -r .access_token ~/.aem/da-token.json)}"
git checkout -b "snowflake-${NNN}" && git add . && git commit -m "snowflake #${NNN}"
git push -u origin "snowflake-${NNN}"
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@${PROJECT}/output/da/${PAGE_SLUG}.html;type=text/html" \
  "https://admin.da.live/source/${OWNER}/${REPO}${DA_ROOT}/${PAGE_SLUG}.html"
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/${OWNER}/${REPO}/snowflake-${NNN}${DA_ROOT}/${PAGE_SLUG}"
# Verify at https://snowflake-${NNN}--${REPO}--${OWNER}.aem.page/${DA_ROOT}/${PAGE_SLUG}

# Phase 6 — reflect: append findings to $PROJECT/learnings.md;
# promote cross-project rules to knowledge/learnings.md.
```

`<SKILL_DIR>` is the absolute path to the directory containing this
`SKILL.md`. The agent substitutes it before invoking — see
[HOST-NOTES.md](./HOST-NOTES.md) for per-host resolution rules.

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
   **Also runs the block-level feasibility assessment** — see
   [knowledge/block-level-feasibility.md](./knowledge/block-level-feasibility.md).
   Produces `notes.md` + `decisions.json` (including `conversionLevel`).
   See [phases/2-analyze.md](./phases/2-analyze.md).

3. **Generate** — branches by `conversionLevel` from Phase 2:
   - **`page`**: produce the 5 overlay artifacts (template HTML,
     header fragment, footer fragment, page CSS, animations JS)
     plus the DA-source body with slot-keyed rows.
   - **`block`**: produce per-section block JS/CSS, header/footer
     fragments, global styles/tokens, and the DA-source body with
     standard block tables.
   - **`hybrid`**: block-level for passing sections, page-level
     fragments for failing sections.
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
7. [knowledge/block-level-feasibility.md](./knowledge/block-level-feasibility.md) —
   criteria for block-level vs page-level conversion (Analyze phase).
8. [knowledge/block-level-conversion.md](./knowledge/block-level-conversion.md) —
   architecture and patterns for block-level conversion (Generate phase).
9. The phase prompt for the current phase.

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
