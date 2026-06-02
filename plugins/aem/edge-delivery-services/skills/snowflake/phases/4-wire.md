# Phase 4 — Wire

Goal: copy the Generate output into the target EDS repo's deployed
paths and build a local-test file.

## Milo flavor (read FIRST if `substrateFlavor` is `milo`)

The Milo flavor has two wire paths depending on `conversionLevel`. In **both**,
Milo's `head.html`/`scripts.js`/`styles.css` stay untouched and Milo loads the
gnav/footer from the page metadata emitted in Generate. Pick the matching path,
do it, then skip to the lint step — the EDS steps below do not apply to Milo.

### Milo + page-level (overlay)

Copy **only** the body artifacts — there are no header/footer fragments:

```bash
cd "$(git rev-parse --show-toplevel)"
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"
cp "${PROJ}/output/templates/${TEMPLATE_NAME}.html" "templates/${TEMPLATE_NAME}.html"
cp "${PROJ}/output/styles/${TEMPLATE_NAME}.css"     "styles/${TEMPLATE_NAME}.css"
[ -f "${PROJ}/output/scripts/${TEMPLATE_NAME}-animations.js" ] && \
  cp "${PROJ}/output/scripts/${TEMPLATE_NAME}-animations.js" "scripts/${TEMPLATE_NAME}-animations.js"
# vendored libs/assets: same as the EDS path (globs below), minus the fragments/ copies.
```

Do NOT `mkdir fragments/<template>` or copy header/footer fragments. The
`blocks/snowflake` overlay block (installed in Phase 0) loads
`templates/<template>.html` + `styles/<template>.css` at runtime.

### Milo + block-level (editable `forge-*` blocks)

Copy **only** the per-section block code + assets. There are NO templates,
NO `styles/`, NO `head.html`, NO `fragments/`, and NO `blocks/{header,footer}` —
Milo runs the standard decoration pipeline and auto-loads each `forge-*` block
from the repo root, and renders the live gnav/footer from the metadata block:

```bash
cd "$(git rev-parse --show-toplevel)"
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"

# 1) Copy each forge-* block (js + css) to the repo's blocks/ dir
for dir in "${PROJ}/output/blocks/"forge-*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  mkdir -p "blocks/${name}"
  cp "${dir}/${name}.js"  "blocks/${name}/${name}.js"
  cp "${dir}/${name}.css" "blocks/${name}/${name}.css"
done

# 2) Vendored assets (if asset strategy is "vendor") — already under assets/

# 3) Build the local-test drafts file from the DA doc (full HTML document)
node "<SKILL_DIR>/scripts/transform-da-to-eds.mjs" \
  "${PROJ}/output/da/${PAGE_SLUG}.html" \
  "drafts/${PAGE_SLUG}.html"
```

The DA-source body (`output/da/${PAGE_SLUG}.html`) is uploaded to DA in Phase 4's
upload step (or by the host); it carries the `forge-*` block tables + the chrome
`metadata` block and NO `template` key. At runtime Milo decorates each `forge-*`
block (rebuilding its DOM) and draws the live gnav/footer from the metadata.

## Steps

Run from the target repo's root:

```bash
cd "$(git rev-parse --show-toplevel)"
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"

# 1) Copy artifacts to deployed paths
mkdir -p "fragments/${TEMPLATE_NAME}"

cp "${PROJ}/output/templates/${TEMPLATE_NAME}.html"          "templates/${TEMPLATE_NAME}.html"
cp "${PROJ}/output/fragments/${TEMPLATE_NAME}/header.html"   "fragments/${TEMPLATE_NAME}/header.html"
cp "${PROJ}/output/fragments/${TEMPLATE_NAME}/footer.html"   "fragments/${TEMPLATE_NAME}/footer.html"
cp "${PROJ}/output/styles/${TEMPLATE_NAME}.css"              "styles/${TEMPLATE_NAME}.css"

# Animations + vendored libs are optional — copy if present
[ -f "${PROJ}/output/scripts/${TEMPLATE_NAME}-animations.js" ] && \
  cp "${PROJ}/output/scripts/${TEMPLATE_NAME}-animations.js" "scripts/${TEMPLATE_NAME}-animations.js"

# Glob copy any vendored libs (e.g. ${TEMPLATE_NAME}-lenis.min.js etc)
ls "${PROJ}/output/scripts/" 2>/dev/null \
  | grep -v -- "-animations\.js$" \
  | while IFS= read -r f; do cp "${PROJ}/output/scripts/$f" "scripts/$f"; done

ls "${PROJ}/output/styles/" 2>/dev/null \
  | grep -v -- "^${TEMPLATE_NAME}\.css$" \
  | while IFS= read -r f; do cp "${PROJ}/output/styles/$f" "styles/$f"; done

# 2) Build the local-test drafts file from the DA doc
node "<SKILL_DIR>/scripts/transform-da-to-eds.mjs" \
  "${PROJ}/output/da/${PAGE_SLUG}.html" \
  "drafts/${TEMPLATE_NAME}-${PAGE_SLUG}.html"

# 3) Vendored assets (if asset strategy is "vendor"):
#    Assets were copied during Generate phase. Confirm they're in
#    place under assets/.
if [ "$ASSET_STRATEGY" = "vendor" ]; then
  if [ ! -d assets ]; then
    echo "FAIL: assetStrategy=vendor but ./assets/ does not exist"
    exit 1
  fi
fi

# 4) Lint
if [ -f package.json ] && grep -q '"lint"' package.json; then
  npm run lint 2>&1 | tail -20
fi
```

## Lint expectations

The target repo's lint config should already exclude template-specific
CSS and animations JS — they're vendor code, not boilerplate. If lint
fails on a `<template>.css` or `<template>-animations.js` file,
check the repo's `.eslintignore` / `.stylelintignore` patterns. Don't
massage the vendored code to satisfy lint; fix the ignore patterns.

Typical existing ignores in EDS overlay repos:
```
# .eslintignore
*.min.js
scripts/*-animations.js

# .stylelintignore
styles/*.css
!styles/styles.css
!styles/fonts.css
!styles/lazy-styles.css
```

## What doesn't change

- `head.html` — does NOT reference the per-template CSS. The overlay
  engine loads it dynamically.
- `styles/styles.css` — boilerplate global styles, unchanged.
- `scripts/overlay-engine.js` — the overlay engine, unchanged.
- `scripts/scripts.js` — the EDS lifecycle file (carries only the injected
  hook: the `overlay-engine.js` import + loadEager guard), unchanged.
- `scripts/delayed.js` — animation engine HEAD-probe lives here,
  unchanged.
- `blocks/header/*`, `blocks/footer/*` — already template-keyed,
  unchanged.

If you need to change any of those, that's a SUBSTRATE change with
its own PR. Stop and surface it to the user.

## Update state and finish

Set `state.phase = "wire"`, `state.phaseStatus = "complete"`,
`state.wireCompletedAt = "<timestamp>"`. Record:
- `state.deployedPaths` — list of files copied (relative to repo root)

Continue to Phase 5 (Round-trip).
