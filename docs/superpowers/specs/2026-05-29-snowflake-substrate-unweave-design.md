# Snowflake substrate: un-weave the overlay engine from `scripts.js`

**Date:** 2026-05-29
**Status:** Design approved, pending implementation plan

## Context

The snowflake skill installs an "overlay substrate" onto an Adobe EDS
boilerplate repo. The installer (`scripts/install-substrate.mjs`, driven by
`assets/substrate/MANIFEST.json`) does **wholesale file replacement** for 9
files, backing up the originals.

One of those 9 — `scripts/scripts.js` — is Adobe's own boilerplate engine with
snowflake's ~180-line overlay engine **woven inline** into the same file, plus
a few lines spliced into the boilerplate's `loadEager`/`loadLazy` bodies. To
ship the engine, the substrate therefore ships a *frozen copy of Adobe's
`scripts.js`*. When Adobe evolves the boilerplate (`buildAutoBlocks`,
`decorateButtons`, `loadLazy`, RUM, …), a fresh install silently overwrites
those upstream improvements.

This is the only file where that happens. The other 8 are either intentionally
divorced from the boilerplate (snowflake owns their content: `styles.css`
deliberately strips boilerplate styles, `fonts.css`/`header.css`/`footer.css`
are emptied, `header.js`/`footer.js`/`delayed.js` are purpose-built
replacements) or trivial near-copies (`head.html`). Wholesale replacement is
correct for those 8.

## Goal

Stop shipping a frozen copy of Adobe's `scripts.js`. Apply only snowflake's
*additions* on top of whatever upstream `scripts.js` the repo already has, so
boilerplate evolution survives an install.

### Non-goals

- No change to the other 8 substrate files.
- No migration path for repos already on the woven v1.0.x substrate. The skill
  is not yet distributed — there are no installs to migrate. Detection handles
  only **not-installed** and **already-installed**.
- No three-way merge or patch-file machinery. The footprint is small enough for
  anchored injection.

## Design

### 1. Module boundary

The engine block (today `scripts.js` lines 37–209: `readBlockSlots`,
`parseFirst`, `writeSlot`, `applySlotsToTemplate`, `resolveTemplateName`,
`applyTemplateOverlay`) depends only on `getMetadata` and `loadCSS` from
`aem.js` plus the `window.hlx` global. It never calls back into `scripts.js`
locals, so it extracts cleanly.

**New `assets/substrate/scripts/overlay-engine.js`** (snowflake-owned,
wholesale-replaceable):

```js
import { getMetadata, loadCSS } from './aem.js';

// readBlockSlots, parseFirst, writeSlot, applySlotsToTemplate,
// resolveTemplateName, applyTemplateOverlay  (verbatim from today's scripts.js)

export { applyTemplateOverlay };
```

The bundled `assets/substrate/scripts/scripts.js` is **deleted** — the substrate
no longer ships a full `scripts.js`.

### 2. The `scripts.js` hook

The installer applies snowflake's additions to the repo's current `scripts.js`.
The hook is almost purely additive — it never rewrites a boilerplate-owned line.

**Edit 1 — import** (after the `from './aem.js';` block):
```js
import { applyTemplateOverlay } from './overlay-engine.js';
```

**Edit 2 — `loadEager` guard** (inserted after
`decorateTemplateAndTheme();` + `const main = doc.querySelector('main');`,
above the stock decoration block):
```js
  // snowflake overlay: if a template matches, swap it in and skip EDS decoration
  if (main && await applyTemplateOverlay(main)) {
    document.body.classList.add('appear');
    return;
  }
```
The stock `if (main) { decorateMain(main); … }` below is untouched. The early
`return` skips the boilerplate `loadFonts()` call, which is a no-op for overlay
pages (snowflake empties `fonts.css`).

**Edit 3 — `loadLazy` guard (conditional).** Today snowflake wraps
`await loadSections(main)` in `if (!main.dataset.overlay)`. Testing must confirm
whether `loadSections` is already a no-op on overlay DOM (no
`.section[data-section-status]` elements). If it is, this edit is dropped. If
not, it is a one-line guard around the existing call.

Net: the boilerplate-owned footprint drops from a 361-line whole-file
replacement to one import + one inserted `if` block (possibly + one guard).

### 3. Applying the hook — hybrid

A third MANIFEST operation joins `replace` and `ignorePatches`: **`inject`** —
an anchored, idempotent edit. Each edit carries:

- **anchor** — a unique, stable locator string. The `loadEager` anchor is the
  `decorateTemplateAndTheme();` + `const main = …` sequence (unique to
  `loadEager`; `const main = …` alone also appears in `loadLazy`).
- **skipIf** — a needle (`applyTemplateOverlay` / `overlay-engine.js`). If
  present, the edit is already applied → skip. This is what makes re-runs
  idempotent.
- **insert** — the text.

**Who applies it (hybrid):** the installer attempts the deterministic anchored
injection. If an anchor is **not found or ambiguous** (a future boilerplate
restructured `loadEager`), the installer does **not** guess — it exits with the
exact snippet and instruction ("insert this at the start of `loadEager`, before
decoration") and hands off to the agent, which applies it intent-level. Fast and
idempotent in the common case; graceful when upstream drifts.

### 4. Detection — two states

With no full `scripts.js` to byte-compare, detection keys off the marker needle
and the inject `skipIf` needles:

- **Not installed** — `scripts.js` has no `overlay-engine.js` import → fresh
  install: copy `overlay-engine.js` + the 8 replace files, inject the hook.
- **Already installed** — import present + replace files byte-match bundle +
  hook needles present → no-op.

The existing "drift on a snowflake-owned replace file → refuse without
`--force`" path is unchanged and now also covers `overlay-engine.js`. No new
drift logic.

### 5. MANIFEST / marker / version

- `replace`: remove `scripts/scripts.js`, add `scripts/overlay-engine.js`.
- Add an `inject` block for `scripts/scripts.js` (Edits 1–2, and Edit 3 if
  testing shows it is needed).
- `marker`: change needle from `function applyTemplateOverlay` to
  `overlay-engine.js` (the import line in `scripts.js`). It proves both "engine
  present" and "hook wired"; renaming the module is a breaking change anyway —
  same durability rationale as the current marker.
- Bump `substrateVersion` → `1.1.0` (and `assets/substrate/VERSION`).

## Files changed

- `assets/substrate/scripts/overlay-engine.js` — **new** (extracted engine).
- `assets/substrate/scripts/scripts.js` — **deleted** (no longer shipped).
- `assets/substrate/MANIFEST.json` — `replace`/`inject`/`marker`/version edits.
- `assets/substrate/VERSION` — `1.1.0`.
- `scripts/install-substrate.mjs` — process the new `inject` operation
  (anchored, idempotent, fail-loud); detection keyed off the new marker +
  inject needles.
- `phases/0-prereq.md` — note that `scripts.js` is hooked (injected), not
  replaced; describe the fail-loud hand-off.
- `HOST-NOTES.md` — "what gets installed" reflects the engine module + the
  injected hook.

## Testing

- **Behavior-preserving extraction:** install on vanilla boilerplate, run a
  conversion, confirm the page passes the Phase 5 health gate (overlay applies,
  1:1 DOM-equality). Moving code to a module changed nothing.
- **Idempotency:** run the installer twice; second run is a no-op; `scripts.js`
  has exactly one import and one guard.
- **Anchor fail-loud:** run against a `scripts.js` with a mangled `loadEager`;
  installer exits with the snippet + instruction, does not mis-patch.
- **Upstream survival (the point):** add a custom edit to `buildAutoBlocks` in
  `scripts.js`, install, confirm the edit survives — only the import + guard
  were added.
- **`loadLazy` guard decision:** verify whether `loadSections` is a no-op on
  overlay DOM; drop Edit 3 if so, keep the one-line guard if not.

## Open question

Whether Edit 3 (the `loadLazy` guard) is needed — resolved by the test above
during implementation.
