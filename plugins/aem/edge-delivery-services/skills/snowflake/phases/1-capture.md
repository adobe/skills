# Phase 1 — Capture

Goal: get the source page and its referenced external assets into a
project folder so the rest of the run is self-contained.

## Inputs (from init summary or from state)

By the time Phase 1 runs, inputs are already confirmed via the init summary
(see SKILL.md "Initialization"). Read them from state.json if already present;
otherwise resolve now and confirm with the user before fetching.

- **Source URL** — from the init summary (the only required input).
- **Target EDS repo** — from state.json, or detect:
  ```bash
  OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null \
    || git remote get-url origin \
       | sed -E 's|.*github\.com[:/]||;s|\.git$||')
  ```
- **DA root** — from state.json, or read the config, falling back to
  the current branch name:
  ```bash
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  DA_ROOT=$(jq -r '.daRoot // ""' \
    .snowflake/config.json 2>/dev/null)
  DA_ROOT="${DA_ROOT:-/$BRANCH}"
  ```
  Defaults to the current git branch name (the same branch the skill
  uses for code). Show this value in the init summary so the user can
  correct it for runs that land under a different DA path.
- **Slug / template name** — derived (see "State file" below). Values shown
  in the init summary; user may override there, not here.

Write all confirmed values into state.json before doing any fetches.

## Project folder location

Resolve where projects live. Default is `.snowflake/projects/`, but
the repo may override via `.snowflake/config.json` `projectsDir`:

```bash
cd "$(git rev-parse --show-toplevel)"
PROJECTS_DIR=$(jq -r '.projectsDir // ".snowflake/projects"' \
  .snowflake/config.json 2>/dev/null || echo ".snowflake/projects")
mkdir -p "$PROJECTS_DIR"
```

## State file

Compute the project number `NNN`:
```bash
NNN=$(ls "$PROJECTS_DIR" 2>/dev/null \
  | grep -E '^[0-9]+-' \
  | sed -E 's/^([0-9]+)-.*/\1/' \
  | sort -n | tail -1)
NNN=$(printf "%03d" $((10#${NNN:-0} + 1)))
```

Derive a `slug` from the source URL (kebab-case, ≤30 chars, no
spaces). For `https://example.com/products/promo` use `promo`, or
when the path is ambiguous use `example-com-promo`. Show the derived
value in the init summary — the user may override it there without a
separate question.

Project folder: `${PROJECTS_DIR}/<NNN>-<slug>/`. Create:
```
input/        ← source HTML + external assets
output/       ← (created in Generate)
diff/         ← (created in Round-trip)
state.json    ← run state, updated at each phase boundary
notes.md      ← (created in Analyze; first content)
README.md     ← (created here; updated through the run)
```

Write `state.json` with this shape:
```json
{
  "run": "<NNN>",
  "slug": "<slug>",
  "templateName": "<chosen-template-name>",
  "sourceUrl": "<URL>",
  "targetRepo": "<owner>/<repo>",
  "daRoot": "<da-root-path>",
  "phase": "capture",
  "phaseStatus": "in-progress",
  "startedAt": "<ISO-8601 timestamp>"
}
```

`templateName` defaults to `<slug>`. The user may override it (e.g.
`bizpro-hub` for a `bizpro-hub-prototype` source URL) via the init
summary — no separate question needed here. Use the value from state.json
if already set.

## Fetch the source

```bash
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"
curl -fsS "$SOURCE_URL" -o "${PROJ}/input/index.html"
```

Validate: file size > 0, response was HTML (look for `<!doctype html`
or `<html` in the first 200 bytes).

## Collect and normalize assets

Run the asset-collect script to discover in-scope asset references
(raster images, videos, fonts), download local/unreachable ones,
normalize filenames, rewrite references in `index.html`, and emit
`asset-manifest.json`. Always runs — no-op when already collected.

```bash
node "<SKILL_DIR>/scripts/asset-collect.mjs" \
  --input "${PROJ}/input" \
  --base-url "$SOURCE_URL"
```

The script handles:
- HTML tags (`<img src>`, `<img srcset>`, `<picture>`, `<video>`, inline `style` url())
- CSS `url()` inside inline `<style>` blocks (including `@font-face src`)
- Per-asset strategy: local fonts → `vendor` (saved to `input/fonts/`),
  local images/videos → `da-media` (saved to `input/images/` or `input/videos/`),
  public stable URLs → `absolute` (left as-is)
- Hash-named font files: renamed to human-readable names from `@font-face` context
- References in `index.html` rewritten to normalized relative paths

Validate the manifest: check `asset-manifest.json` was written, review
any `warnings` entries (especially cross-origin font CORS risks).

Read `asset-manifest.json` to note asset stats for the init summary.

## Write a stub README.md for the project

```markdown
# <NNN> — <slug>

Source: <URL>
Captured: <date>
Status: capturing

(this README is updated through the run)
```

## Update state and finish

Set `state.phase = "capture"` and `state.phaseStatus = "complete"`,
append `state.captureCompletedAt = "<timestamp>"` and
`state.assetStats` from `input/asset-manifest.json`'s `stats` block.
Save state.json.

Continue to Phase 2 (Analyze).
