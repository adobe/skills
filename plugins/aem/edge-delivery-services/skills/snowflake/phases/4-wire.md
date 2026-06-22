# Phase 4 — Wire

Goal: copy the Generate output into the target EDS repo's deployed
paths and build a local-test file.

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
