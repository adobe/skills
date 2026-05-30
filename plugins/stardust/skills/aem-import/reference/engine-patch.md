# Engine patch — one-time scripts.js + header.js + footer.js modifications

The patch extends the EDS project's overlay engine to support **blocks-mode
pages** alongside any existing overlay-mode pages. Backward-compatible:
existing overlay-mode pages (e.g., a wheelercat-home using full HTML
overlay + slot writing) continue to work because the HTML fetch still
succeeds and the existing dataset.overlay still gets set.

The patch is idempotent — running `aem-import` again with
`--skip-engine-patch=auto` (default) detects that the patch is already
applied and skips.

## What the patch does

Two coordinated changes:

1. **`scripts/scripts.js`** — `applyTemplateOverlay()` always sets
   `main.dataset.theme = templateName` and loads `/styles/<theme>.css`
   before attempting to fetch the template HTML. When the HTML fetch
   404s (no `templates/<theme>.html` file exists), it logs an info
   message and returns `false` — so the standard `loadSections()`
   call still runs on the authored content. When the HTML fetch
   succeeds (existing overlay-mode pages), behavior is unchanged.

2. **`blocks/header/header.js` + `blocks/footer/footer.js`** — read
   `main.dataset.theme` first (set by both modes), with
   `dataset.overlay` as fallback for backward compat. This lets the
   chrome fragments resolve from theme regardless of whether the page
   ran in overlay mode or blocks mode.

## scripts.js patch — diff

Before:
```js
async function applyTemplateOverlay(main) {
  const templateName = resolveTemplateName();
  if (!templateName) return false;

  const slots = readBlockSlots(main);

  const cssLoaded = loadCSS(`${window.hlx.codeBasePath}/styles/${templateName}.css`);

  const resp = await fetch(`${window.hlx.codeBasePath}/templates/${templateName}.html`);
  if (!resp.ok) {
    console.warn(`[overlay] template not found: ${templateName}`);
    return false;
  }
  // ... rest of HTML overlay code
}
```

After:
```js
/**
 * Apply the static-page overlay to main.
 * Returns true if the overlay ran, false otherwise.
 *
 * Two modes, driven by whether /templates/<template>.html exists:
 *
 *   - overlay mode (HTML present): the template's <main> replaces the
 *     authored content; [data-slot] markers are filled from the DA
 *     block tables; main.dataset.overlay is set so loadSections is
 *     skipped (template is the visual spec).
 *
 *   - blocks mode (HTML 404): the authored DA content stays in main
 *     and gets standard EDS decoration; only the template CSS and
 *     chrome theme are activated. Lets a page author with generic
 *     EDS blocks (hero, text, cards, columns) while still inheriting
 *     a project's design tokens and chrome.
 *
 * In both modes main.dataset.theme is set (chrome fragment selector).
 */
async function applyTemplateOverlay(main) {
  const templateName = resolveTemplateName();
  if (!templateName) return false;

  // Always activate the theme — chrome fragments resolve from dataset.theme,
  // and the per-theme stylesheet loads regardless of overlay mode.
  main.dataset.theme = templateName;
  const cssLoaded = loadCSS(`${window.hlx.codeBasePath}/styles/${templateName}.css`);

  const slots = readBlockSlots(main);

  const resp = await fetch(`${window.hlx.codeBasePath}/templates/${templateName}.html`);
  if (!resp.ok) {
    // eslint-disable-next-line no-console
    console.info(`[overlay] no template HTML for "${templateName}" — blocks mode (CSS + chrome only)`);
    await cssLoaded;
    return false;
  }
  // ... rest of HTML overlay code unchanged (sets main.dataset.overlay = templateName, etc.)
}
```

Key changes:
- `main.dataset.theme = templateName` and `loadCSS(...)` moved BEFORE
  the HTML fetch (so they fire in both modes)
- 404 handler now `console.info` (not `warn`) — it's an expected
  outcome for blocks-mode pages
- `await cssLoaded` before returning so CSS arrives in time for the
  paint
- Return `false` so `loadSections()` runs on the authored content

## blocks/header/header.js patch — diff

Before:
```js
export default async function decorate(block) {
  const template = document.querySelector('main')?.dataset?.overlay;
  if (!template) return;
  const path = `/fragments/${template}/header.html`;
  const resp = await fetch(`${window.hlx.codeBasePath}${path}`);
  if (!resp.ok) {
    console.warn(`[header] fragment not found at ${path}`);
    return;
  }
  block.innerHTML = await resp.text();
}
```

After:
```js
/**
 * Loads the theme-specific header fragment from the code bus.
 * scripts.js sets main.dataset.theme = <template> in both overlay mode
 * and blocks mode (see applyTemplateOverlay). Read theme first;
 * dataset.overlay is kept as a fallback for backward compat.
 * Fragments live at /fragments/<theme>/header.html.
 */
export default async function decorate(block) {
  const main = document.querySelector('main');
  const theme = main?.dataset?.theme || main?.dataset?.overlay;
  if (!theme) return;
  const path = `/fragments/${theme}/header.html`;
  const resp = await fetch(`${window.hlx.codeBasePath}${path}`);
  if (!resp.ok) {
    console.warn(`[header] fragment not found at ${path}`);
    return;
  }
  block.innerHTML = await resp.text();
}
```

Same change to `blocks/footer/footer.js` (path changes to `footer.html`).

## Detecting whether the patch is already applied

```js
const scriptsPath = `${edsProject}/scripts/scripts.js`;
const src = fs.readFileSync(scriptsPath, 'utf8');
const isPatched = src.includes('main.dataset.theme = templateName')
               && src.includes('blocks mode (CSS + chrome only)');
```

If `isPatched`, skip the patch. Otherwise apply.

Similar check for `blocks/header/header.js`:
```js
const isHeaderPatched = src.includes('dataset?.theme || main?.dataset?.overlay');
```

## Why this is a one-time patch (not per-page)

The patch modifies project-wide behavior. Once applied, every page in
the project can run in either overlay mode or blocks mode without
further code changes. Subsequent `aem-import` runs for new pages just
add per-page files (theme CSS, chrome fragments, DA content) — no
engine modification needed.

This is the only place where `aem-import` changes existing files in
the EDS project. All other outputs are net-new files in
non-conflicting locations (`styles/<theme>.css`, `fragments/<theme>/`,
`assets/<theme>/`, etc.).

## Edge cases

- **Project already has its own blocks-mode pattern.** Detect by
  looking for `dataset.theme` references in the project's
  scripts.js / header.js / footer.js. If present, skip the patch and
  log "engine already supports blocks-mode (custom or aem-import
  applied)".

- **Project's scripts.js doesn't have `applyTemplateOverlay`.** This
  is a project that hasn't yet seen the overlay engine extension
  (the wheelercat-home pattern). The patch needs to ADD the function
  first, then add the blocks-mode branch. More invasive — surface
  to the user and recommend reviewing the change before applying.

- **Project uses a non-aem.js scripts.js entirely.** Don't apply the
  patch. Surface to the user — the skill assumes the AEM boilerplate's
  scripts.js structure.
