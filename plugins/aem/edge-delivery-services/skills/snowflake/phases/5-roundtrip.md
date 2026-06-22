# Phase 5 — Round-trip

Goal: verify the converted page renders correctly end-to-end —
both locally (dev server) and on production preview
(branch host).

**Production round-trip is the default**, not an option to skip.
If a condition appears that suggests skipping (e.g. local-only
source assets, perceived blockers), surface it to the user as a
question — don't decide unilaterally.

## The browser health gate (mandatory)

Phase 5 is a **gate**, not a report. The converted page must pass every
check below — first locally (5.1), then on production preview (5.2.5) —
before the run may continue to Phase 6. If any check fails, **stop**:
diagnose (5.2.6), fix at the source (re-Generate → re-Wire →
re-Round-trip), and re-run the gate. Never mark this phase complete on a
failing or unverified page.

| # | Check | Pass criteria |
|---|-------|---------------|
| 1 | **Renders (not blank)** | `<body>` has real content: visible text ≥ 200 chars, rendered height ≥ 1.5× viewport, ≥ 1 `main section[class]`. A blank or near-blank page is an automatic FAIL. |
| 2 | **Overlay applied** | `main[data-overlay]` === `<TEMPLATE_NAME>` and `<body>` carries the `appear` class. |
| 3 | **Structure matches** | `sectionCount` and `sectionClasses` match `decisions.json` / `state.sectionCount` from Generate. |
| 4 | **No console errors** | Zero console errors (uncaught exceptions, unhandled rejections, `console.error`). Tolerated only: font-CORS errors when the source is cross-origin and fonts are not vendored — and only if recorded in `state.json`. |
| 5 | **No network failures** | No request failed or returned status ≥ 400; no `<img>` resolved to `about:error` or `naturalWidth === 0`. |
| 6 | **1:1 with the source** | `dom-equality.mjs` exits PASS, or FAILs only on the known wrapper-element deltas enumerated in 5.1.1 (judgment recorded). Any other delta is a FAIL. |

How console and network errors are captured depends on the host's
browser tool. Prefer the tool's own console + network capture (recorded
from the moment the page opens). If the tool cannot surface them, inject
this listener **before navigating** and read the globals after load:

```js
window.__err = [];
addEventListener("error", (e) => window.__err.push(String(e.message || e.error)));
addEventListener("unhandledrejection", (e) => window.__err.push(String(e.reason)));
const _ce = console.error;
console.error = (...a) => { window.__err.push(a.join(" ")); _ce(...a); };
```

Record the outcome of all six checks (per environment) in `state.json`
under `healthGate` so the pass is auditable, not assumed.

## Knowledge to load

Round-trip failures often map to known gotchas. Before driving the
browser, skim (using the override-then-bundled resolution from
`SKILL.md`):
- `learnings.md` — the entries on Media Bus URL handling, CORS for
  fonts, scroll-animation screenshot quirks, asset hosting modes
- `eds-da-mechanics.md` — for the EDS pipeline shape (loadEager,
  body.appear, `.plain.html`, lifecycle classes) — the overlay-runtime
  lore
- `da-content` (`platform.md`) — DA admin / Source API contract,
  IMS auth, preview/publish if you need to debug an upload or
  lifecycle failure

## 5.1 — Local round-trip

```bash
# Start the dev server. Hosts that support backgrounding can run
# this in the background; otherwise run in a separate terminal and
# proceed manually.
npx -y @adobe/aem-cli up --html-folder drafts --no-open --forward-browser-logs &
DEV_PID=$!

# Wait for the server (max ~15s)
for i in $(seq 1 15); do
  curl -sf http://localhost:3000/ -o /dev/null && break
  sleep 1
done
```

Open the following URL in a browser and wait for animations to settle (~2 s):

```
PAGE="http://localhost:3000/drafts/${TEMPLATE_NAME}-${PAGE_SLUG}.html"
```

Evaluate this JavaScript in the browser and report the result:

```js
(() => {
  const main = document.querySelector("main");
  const sections = [...document.querySelectorAll("main section[class]")];
  const imgs = [...document.querySelectorAll("img")];
  return {
    overlayApplied: main?.dataset?.overlay,
    bodyAppearClass: document.body.classList.contains("appear"),
    sectionCount: sections.length,
    sectionClasses: sections.map((s) => s.className.split(" ")[0]),
    visibleTextLength: (document.body.innerText || "").trim().length,
    renderedHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight,
    brokenImages: imgs
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.currentSrc || i.src),
    capturedErrors: window.__err || null,
  };
})()
```

Also collect, from the browser tool's console + network capture (or the
injected `window.__err` listener), every console error and every request
that failed or returned status ≥ 400.

Apply the **health gate** (checks 1–5 from the table above):
- Check 1 (not blank): `visibleTextLength` ≥ 200, `renderedHeight` ≥
  1.5 × `viewportHeight`, `sectionCount` ≥ 1.
- Check 2: `overlayApplied` === `<TEMPLATE_NAME>`, `bodyAppearClass` === true.
- Check 3: `sectionCount` / `sectionClasses` match `decisions.json`.
- Check 4: zero console errors (font-CORS exception only, recorded).
- Check 5: `brokenImages` empty and no failed/≥400 network requests.

Any failure stops the gate — diagnose (5.2.6) and fix before continuing.

### Section-by-section screenshots

For scroll-animated pages (sticky hero, parallax, IntersectionObserver
fade-ins), a `fullPage:true` screenshot is misleading — captured in
initial-scroll state, sticky elements leave gaps, `.anim-enter`
elements are `opacity:0`. Capture per-section:

```bash
PROJ="${PROJECTS_DIR}/${NNN}-${SLUG}"
mkdir -p "$PROJ/diff"
```

For each class in `$SECTION_CLASSES`:
1. Scroll that section into view: `document.querySelector('.$class')?.scrollIntoView({block:'start'})`
2. Wait for animations to settle (~1 s)
3. Take a screenshot and save it to `$PROJ/diff/local-$class.jpg`

### Stop the dev server

```bash
kill $DEV_PID 2>/dev/null || true
```

## 5.1.1 — DOM-equality check (local)

After the structural checks and screenshots pass, run a deterministic
DOM comparison between the original source and the rendered overlay.
This is what makes the "1:1 with the source" claim auditable rather
than something we take on faith.

```bash
node "<SKILL_DIR>/scripts/dom-equality.mjs" \
  --source        "$SOURCE_URL" \
  --rendered      "http://localhost:3000/drafts/${TEMPLATE_NAME}-${PAGE_SLUG}.html" \
  --report        "$PROJ/diff/dom-equality-local.md" \
  --source-scope  body \
  --rendered-scope body
```

(Use `--scope body` shorthand if the source and rendered share the
same scope. Use separate flags when they don't — the source may
lack a `<main>` while the rendered template synthesizes one.)

The script captures four dimensions on each page (after waiting for
the overlay engine to apply on the rendered side):
- Element count
- Tag+class sequence (positional)
- Visible text (whitespace-normalised)
- Image src list (Media Bus rewrites are normalised — `./media_<sha>.<ext>`
  is expected, not a regression)

Output is a markdown report. Exit 0 on PASS, 1 on FAIL.

**Interpreting the report (this is gate check 6 — enforced):**
- **PASS** — overlay is 1:1 with the source. Check 6 passes.
- **FAIL on known wrapper deltas only** — the *sole* tolerated FAIL.
  These are: EDS injecting `<header class="header-wrapper">` around the
  fetched header fragment; the substrate synthesizing `<main>` when the
  source lacks one; stripped dev-tool markup. Confirm the report's
  divergences are limited to these, record the judgment in
  `state.json` `healthGate`, and only then treat check 6 as passed.
- **FAIL on anything else** — large deltas, or a first-divergence inside
  a slot block — is a **gate failure**. Do not proceed. The first
  divergence in tagSequence and the first-divergent character in
  visibleText are the smoking gun; fix at the source and re-run.

## 5.2 — Production round-trip

This produces a feature-branch preview URL that loads the deployed
artifacts from code-bus and the DA-stored content from content-bus.

### 5.2.1 — Create the run branch

The branch name is `${BRANCH_PREFIX}${NNN}` where `BRANCH_PREFIX`
comes from `.snowflake/config.json` (default: `snowflake-`):

```bash
BRANCH_PREFIX=$(jq -r '.branchPrefix // "snowflake-"' \
  .snowflake/config.json 2>/dev/null || echo "snowflake-")
BRANCH="${BRANCH_PREFIX}${NNN}"

git checkout -b "$BRANCH"
git add \
  templates/${TEMPLATE_NAME}.html \
  fragments/${TEMPLATE_NAME}/ \
  styles/${TEMPLATE_NAME}.css \
  styles/${TEMPLATE_NAME}-*.css \
  scripts/${TEMPLATE_NAME}-animations.js \
  scripts/${TEMPLATE_NAME}-*.js \
  drafts/${TEMPLATE_NAME}-${PAGE_SLUG}.html \
  ${PROJECTS_DIR}/${NNN}-${SLUG}/

# If asset strategy was vendor:
[ "$ASSET_STRATEGY" = "vendor" ] && git add assets/

git commit -m "snowflake #${NNN} — ${SLUG} overlay"
git push -u origin "$BRANCH"
```

The default `snowflake-` (hyphen) keeps the branch name identical
to the aem.page hostname segment and the admin.hlx.page URL
segment — no encoding gymnastics. If your repo uses a slash-style
convention (`snowflake/001`), set `branchPrefix` accordingly in
`.snowflake/config.json`; you'll then need to translate slashes
to dashes when constructing the aem.page hostname (AEM Code Sync
flattens slashes). See the note at 5.2.3.

### 5.2.2 — Push DA doc

```bash
TOKEN="${DA_TOKEN:-$(jq -r .access_token ~/.aem/da-token.json 2>/dev/null)}"

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "FAIL: DA token not found (\$DA_TOKEN unset and ~/.aem/da-token.json missing). Invoke the da-auth skill to obtain one."
  exit 1
fi

OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${OWNER_REPO%/*}
REPO=${OWNER_REPO#*/}

# 5.2.2a — Create a labeled DA version BEFORE the PUT (if the file already exists)
#
# DA's PUT replaces the document wholesale — see the 2026-05-19 learning
# "DA admin PUT replaces the entire doc — clobbers author edits". To make
# every PUT recoverable, create a labeled version of the current DA content
# first. POST /versionsource returns 201 if a snapshot was created, 404 if
# the file doesn't exist yet (first PUT — nothing to snapshot, safe to skip).
LABEL="Before snowflake run ${NNN} (${TEMPLATE_NAME})"
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"${LABEL}\"}" \
  "https://admin.da.live/versionsource/${OWNER}/${REPO}/${DA_ROOT#/}/${PAGE_SLUG}.html" \
  -w "%{http_code}\n" -o /dev/null
# Acceptable responses: 201 (snapshot created), 404 (no prior file).
# 401 = token issue; investigate before continuing.

# 5.2.2b — Push the new DA content
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@${PROJECTS_DIR}/${NNN}-${SLUG}/output/da/${PAGE_SLUG}.html;type=text/html" \
  "https://admin.da.live/source/${OWNER}/${REPO}/${DA_ROOT#/}/${PAGE_SLUG}.html" \
  | tee /tmp/da-put.json
```

**Why the version-before-PUT.** DA also creates auto-versions on every PUT
(labeled `Published` or `Collab Parse`), so the prior state is technically
still reachable. The explicit labeled snapshot makes it discoverable in the
DA editor's History tab and explicit about provenance — "this is the state
just before snowflake refreshed me, restore-point if needed."

**To list existing versions** for a path:
```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://admin.da.live/versionlist/${OWNER}/${REPO}/${DA_ROOT#/}/${PAGE_SLUG}.html"
```

Expected response: JSON with `previewUrl` field.

### 5.2.3 — Trigger preview

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/${OWNER}/${REPO}/${BRANCH}/${DA_ROOT#/}/${PAGE_SLUG}"
```

Expected: HTTP 200 with JSON containing `preview.status: 200` and a
`preview.url` matching
`https://${BRANCH}--${REPO}--${OWNER}.aem.page/${DA_ROOT}/${PAGE_SLUG}`.

**Branch names with slashes.** AEM Code Sync flattens `/` to `-` in
the aem.page hostname (so a branch `feature/001` is served at
`feature-001--<repo>--<owner>.aem.page`) but expects the literal
branch in the admin.hlx.page URL. If you've configured a slash-style
`branchPrefix`, compute both forms:

```bash
BRANCH_HOST=$(echo "$BRANCH" | tr '/' '-')   # for aem.page hostname
# $BRANCH (literal) for admin.hlx.page URL
```

…and substitute accordingly below. The default `branchPrefix` uses
a hyphen so no translation is needed.

### 5.2.4 — Wait for code-bus to deploy

Code Sync usually takes a few seconds:

```bash
PROD_BASE="https://${BRANCH}--${REPO}--${OWNER}.aem.page"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_BASE/templates/${TEMPLATE_NAME}.html")
  [ "$code" = "200" ] && break
  sleep 1
done

# Sanity-probe all deployed paths
for p in \
  "/templates/${TEMPLATE_NAME}.html" \
  "/styles/${TEMPLATE_NAME}.css" \
  "/fragments/${TEMPLATE_NAME}/header.html" \
  "/scripts/${TEMPLATE_NAME}-animations.js"; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' "$PROD_BASE$p")"
done
```

Each should return 200. If any are 404, Code Sync may still be in
flight — wait a few more seconds and retry, or use the
`admin.hlx.page/code/...` force-refresh endpoint.

### 5.2.5 — Load production preview

Open the following URL in a browser and wait for the overlay engine to apply (~3 s):

```
PAGE="$PROD_BASE/${DA_ROOT}/${PAGE_SLUG}"
```

Evaluate this JavaScript in the browser and report the result:

```js
(() => {
  const main = document.querySelector("main");
  const sections = [...document.querySelectorAll("main section[class]")];
  const imgs = [...document.querySelectorAll("img")];
  return {
    overlayApplied: main?.dataset?.overlay,
    bodyAppearClass: document.body.classList.contains("appear"),
    sectionCount: sections.length,
    sectionClasses: sections.map((s) => s.className.split(" ")[0]),
    visibleTextLength: (document.body.innerText || "").trim().length,
    renderedHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight,
    storyBg: document.querySelector(".story-card__photo, [style*=\"background-image\"]")?.style?.backgroundImage,
    brokenImages: imgs
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.currentSrc || i.src),
    capturedErrors: window.__err || null,
  };
})()
```

Apply the **same health gate** (checks 1–5) as the local run. Production
notes specific to check 5:
- Any background-image slot src must have been rewritten by Media Bus to
  `./media_<sha>.png?width=...` form — confirms DA cells used absolute
  URLs. If they didn't, `brokenImages` will list `about:error` entries;
  the fix is in the Generate self-check 3.9.

The page must clear all five checks on production, not just locally — a
page that passes locally but fails here is still a gate failure.

Capture screenshots into `${PROJECTS_DIR}/${NNN}-${SLUG}/diff/`
with a `production-` prefix.

### 5.2.5.1 — DOM-equality check (production)

Same comparison as 5.1.1, but against the production preview URL.
On production, Media Bus rewrites `<img>` URLs in DA-cell content;
the script normalises those (`./media_<sha>.<ext>` matches any
source path).

```bash
node "<SKILL_DIR>/scripts/dom-equality.mjs" \
  --source        "$SOURCE_URL" \
  --rendered      "$PAGE" \
  --report        "$PROJ/diff/dom-equality-production.md" \
  --source-scope  body \
  --rendered-scope body
```

Compare against the local report from 5.1.1 — the two should produce
the same shape of differences. Production-only differences usually
mean Code Sync timing (template/CSS not yet served), a Media Bus
URL that escaped normalisation, or font CORS on a cross-origin
source.

### 5.2.6 — If something is broken

Diagnose, not workaround. Common patterns:

- **`about:error` in background-image** → DA cells used root-relative
  URLs; Media Bus requires absolute. Fix the DA doc and re-PUT.
- **Half-empty cards** → wrapping `<a>` was slotted while its
  children were ALSO slotted; the slot writer wiped children. Drop
  the wrap slot in template + DA, keep child slots.
- **Wrong font** → template's head `<link>`s didn't land in
  `<head>`, or vendored fonts have spaces in path. Inspect the
  rendered `<head>` and the network requests.
- **`overlayApplied` is null** → metadata block isn't being picked
  up; check it's a `<div class="metadata">` INSIDE `<main>`, not a
  `<table>` in `<footer>`.

If the same issue exists locally, fix in Generate output + re-Wire +
re-Round-trip. If it's prod-only, suspect Code Sync caching, Media
Bus rules, or a template/DA URL mismatch.

## Update state and finish

**Do not reach this section unless the browser health gate passed on both
local and production.** A failing or unverified page means the phase is
not complete — go back, fix, and re-run.

Set `state.phase = "roundtrip"`, `state.phaseStatus = "complete"`,
`state.roundtripCompletedAt = "<timestamp>"`. Record:
- `state.localUrl`
- `state.productionUrl`
- `state.daEditorUrl` = `https://da.live/edit#/<owner>/<repo>/<da-root>/<page-slug>`
- `state.healthGate` — the per-environment result of all six checks,
  e.g.:
  ```json
  "healthGate": {
    "local":      { "notBlank": true, "overlay": true, "structure": true, "console": "pass", "network": true, "domEquality": "pass" },
    "production": { "notBlank": true, "overlay": true, "structure": true, "console": "pass (font-CORS tolerated)", "network": true, "domEquality": "pass (wrapper deltas only)" }
  }
  ```

Continue to Phase 6 (Reflect).
