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
| `level` | `page`, `auto`, `check`, `block` | `page` | Conversion level — see below |

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
- Neutral phrasing → `level=page`

### Usage examples

```
/snowflake https://example.com/promo              → page-level; infer repo, daRoot, slug
/snowflake https://example.com/promo level=block  → block-level, infer the rest
/snowflake https://example.com/promo level=auto   → feasibility analysis decides
/snowflake level=check                            → feasibility scan only (asks for URL)
/snowflake                                        → page-level, fully interactive
```

The **Source URL** is the leading positional input and the only required
argument. Everything else is resolved automatically and presented in a single
confirmation summary before any work begins.

## Skill dependencies

Snowflake cites DA HTML rules and the DA admin API contract from the
**da-content** skill. **Load `da-content` alongside Snowflake.**
Phases 3 (Generate) and 5 (Round-trip) reference it directly.

## Prerequisites

**Required** — the only input the skill cannot resolve on its own:

1. **Source URL** — the static page to convert. Must be reachable
   (publicly hosted or local dev server).

**Resolved automatically** — shown in the init summary for one-shot
confirmation before any work begins:

2. **Target EDS repo** — detected via `gh repo view --json nameWithOwner`,
   falling back to parsing `git remote get-url origin`. Must already have
   the overlay engine wired (see [knowledge/architecture.md](./knowledge/architecture.md)
   §"Solution shape"). Phase 0 installs it if absent.
3. **DA root path** — read from `.snowflake/config.json` `daRoot` key
   if set, otherwise defaults to the current git branch name (the same
   branch the skill uses for code). Shown in summary; override inline.
4. **Conversion level** — inferred from phrasing (see Parameters), else
   `page`. Shown in summary; override inline.
5. **Slug / template name** — derived from the source URL (kebab-case,
   ≤30 chars). Shown in summary; override inline.

**Auth check (non-blocking)** — DA token resolved from `$DA_TOKEN` →
`~/.aem/da-token.json`. Its status appears in the init summary. Phases
1–4 do not need it; if absent at invocation time, invoke the **da-auth**
skill before Phase 5 (Round-trip) runs.

## Initialization

On every invocation the agent performs these steps **before** entering Phase 0:

1. **Resolve inputs** — apply the fast-path rules from the Prerequisites
   section above.

2. **Probe substrate** —
   ```bash
   node <SKILL_DIR>/scripts/install-substrate.mjs --dry-run
   ```
   Captures the outcome (no-op / clean-install / drift / custom-code-detected).

3. **Check DA token** —
   ```bash
   DA_TOKEN=$(node -e "
     const fs = require('fs');
     const p = process.env.HOME + '/.aem/da-token.json';
     try {
       const t = JSON.parse(fs.readFileSync(p, 'utf8'));
       if (t.expires_at > Date.now() + 60000) process.stdout.write(t.access_token);
     } catch {}
   ")
   ```
   Non-blocking — records status for the summary only.

4. **Always display the run parameters** before any phase begins. Show
   this summary unconditionally — even when all values were provided
   upfront or inferred without ambiguity — then proceed immediately
   without waiting for confirmation:

   ```
   Source URL : https://example.com/promo   ← required (provided)
   Target repo: acme/my-site                ← detected from git
   DA root    : /main                        ← from current branch
   Level      : page                        ← default
   Slug       : promo                       ← derived from URL
   Substrate  : clean install — 9 files     ← (or: already current ✓)
   DA token   : cached ✓                    ← (or: not found — needed at Phase 5)
   ```

   Proceed without pausing for the common case (fresh install — no
   snowflake substrate yet; replaced files are backed up). Only pause
   for **drift** (a prior snowflake substrate that diverged), where
   overwriting could lose intentional customization — Phase 0 handles
   that case.

5. **Proceed** — Phase 0 → 1 → … → 6 in order.

## Quick start — end-to-end example

From the target EDS repository root, here's the full seven-phase
conversion in compressed form. Each phase file under
[phases/](./phases/) holds the complete prompt; this is the
shape of the actual commands the agent emits.

```bash
# Inputs (resolved during init, confirmed in the summary)
SOURCE_URL="https://example.com/promo"
PAGE_SLUG="promo"
DA_ROOT="/main"                       # defaults to current branch name
NNN=001                           # next run number
PROJECT=".snowflake/projects/${NNN}-${PAGE_SLUG}"
TEMPLATE_NAME="promo"
LEVEL="page"                      # page | auto | check | block

# Phase 0 — install (or verify) the overlay substrate (once per repo)
node "<SKILL_DIR>/scripts/install-substrate.mjs"

# Phase 1 — capture: fetch source + assets into the project folder
mkdir -p "$PROJECT/input"
curl -fsS "$SOURCE_URL" -o "$PROJECT/input/index.html"
# For JS-rendered pages, use a browser to get the fully rendered HTML instead

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
   Includes a **page complexity gate**: pages with >8 sections or >100
   slottable elements auto-switch from page-level to block-level to
   avoid incomplete content extraction (see phases/2-analyze.md).
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

5. **Round-trip** — local (dev server) then production (branch + push +
   DA PUT + preview API). Enforces a **browser health gate** on both: the
   page must render (not blank), apply the overlay, match the source
   structure, be free of console/network errors, and pass the 1:1
   DOM-equality check before the run may continue.
   See [phases/5-roundtrip.md](./phases/5-roundtrip.md).

6. **Reflect** — append run findings; promote cross-project learnings
   to [knowledge/learnings.md](./knowledge/learnings.md). **Does not
   close the iteration** — that's a user decision.
   See [phases/6-reflect.md](./phases/6-reflect.md).

**Knowledge resolution per phase:** each phase tries
`.snowflake/knowledge/<file>.md` (project-specific override) first,
then `<SKILL_DIR>/knowledge/<file>.md` (bundled, canonical). Project
overrides win on conflict.

## Reading order

Load knowledge just-in-time — only when the phase that needs it begins.

**On invocation (before Phase 0):**
1. This file.
2. [knowledge/methodology.md](./knowledge/methodology.md) — canonical
   phase rules.
3. Confirm the `da-content` skill is loadable (needed by phases 3 and 5).

**At Phase 2 (Analyze):**
4. [knowledge/block-level-feasibility.md](./knowledge/block-level-feasibility.md) —
   criteria for block-level vs page-level conversion.

**At Phase 3 (Generate):**
5. [knowledge/architecture.md](./knowledge/architecture.md) — overlay
   engine and slot writer semantics.
6. [knowledge/block-level-conversion.md](./knowledge/block-level-conversion.md) —
   architecture and patterns for block-level conversion.
7. [knowledge/learnings.md](./knowledge/learnings.md) — cross-project
   findings relevant to generation.

**At Phase 5 (Round-trip):**
8. [knowledge/eds-da-mechanics.md](./knowledge/eds-da-mechanics.md) —
   EDS pipeline overlay-runtime lore.
9. [knowledge/learnings.md](./knowledge/learnings.md) — entries on media
   handling, CORS, scroll-animation quirks (if not already loaded).

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
