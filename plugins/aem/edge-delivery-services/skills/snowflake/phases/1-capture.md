# Phase 1 — Capture

Goal: get the source page and its referenced external assets into a
project folder so the rest of the run is self-contained.

## Inputs (from user or from state)

- **Source URL** (string, e.g. `https://example.com/path/to/page`).
- **Target EDS repo** (owner/repo). Used by later phases.
- **DA root** (e.g. `/marketing` or `/snowflake/<NNN>`). Used by later phases.

If any are missing, ask the user and write them into state.json
(see below) before doing any fetches.

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
spaces). For `https://example.com/products/promo` use `example-com-promo`
or similar — ask the user if ambiguous.

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

`templateName` defaults to `<slug>` but the user may want to override
(e.g. `bizpro-hub` for `bizpro-hub-prototype` source). Ask if the
slug isn't already a good template name.

## Fetch the source

```bash
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"
curl -fsS "$SOURCE_URL" -o "${PROJ}/input/index.html"
```

Validate: file size > 0, response was HTML (look for `<!doctype html`
or `<html` in the first 200 bytes).

## Identify and fetch external assets

Look for these patterns in the saved HTML:

- `<link rel="stylesheet" href="...">` — external CSS
- `<script src="...">` — external JS
- For each match, if the href is relative or points to the same host
  as the source, fetch it into `input/` (preserve filename).

Skip CDN resources (Google Fonts, jsdelivr, etc.) that are publicly
available; they'll be referenced directly in the converted artifacts.
Local/same-host external assets are saved so the project is self-
contained.

```bash
INPUT="${PROJ}/input"
# Extract candidate external assets
grep -oE '<(link|script)[^>]*(href|src)="[^"]+"' "$INPUT/index.html" \
  | grep -oE '(href|src)="[^"]+"' \
  | sed -E 's/^(href|src)="//;s/"$//' \
  | sort -u \
  | while IFS= read -r ref; do
      case "$ref" in
        http://*|https://*)
          host=$(echo "$ref" | sed -E 's|^https?://([^/]+)/.*|\1|')
          src_host=$(echo "$SOURCE_URL" | sed -E 's|^https?://([^/]+)/.*|\1|')
          if [ "$host" != "$src_host" ]; then continue; fi
          ;;
      esac
      url=$(node -e "
        const base = process.argv[1];
        const ref = process.argv[2];
        process.stdout.write(new URL(ref, base).toString());
      " "$SOURCE_URL" "$ref")
      filename=$(basename "$url" | sed 's/?.*$//')
      [ -n "$filename" ] && curl -fsS "$url" -o "$INPUT/$filename" || true
    done
```

## Milo flavor: capture the chrome metadata (not the chrome DOM)

If `.snowflake/config.json` `substrateFlavor` is `milo`, the deployed page
does **not** ship a captured header/footer — Milo renders the live
`global-navigation` + footer from page metadata. Capture that metadata from
the source's `<head>` into `state.json.chromeMeta` so Generate can re-emit it
onto the DA page. These are the keys that drive Milo's chrome:

```bash
# From the saved source HTML <head>
for name in foundation gnav-source footer-source unav universal-nav \
            gnav-promo-source skin mobile-gnav-v2; do
  val=$(grep -oE "<meta[[:space:]]+name=\"$name\"[[:space:]]+content=\"[^\"]*\"" \
        "$INPUT/index.html" | sed -E 's/.*content="([^"]*)".*/\1/' | head -1)
  [ -n "$val" ] && echo "$name = $val"
done
```

Write whichever are present into `state.json.chromeMeta` (object of
name→content). Do **not** save the rendered `feds-*` gnav DOM — a static
snapshot of a JS-driven nav renders as a broken, fully-expanded blob (this is
the exact bug the Milo flavor exists to fix). For the EDS flavor, ignore this
step and capture chrome as before.

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
append `state.captureCompletedAt = "<timestamp>"`. Save state.json.

Continue to Phase 2 (Analyze).
