# Runtime bootstrap — deep dive (vanilla aem-boilerplate → AuthorKit)

Companion to SKILL.md § Runtime bootstrap. The rules live inline in SKILL.md; this file
carries the full port manifest, the mechanics of the two mandatory edits, the lint list,
and the drift history. Read this before hand-porting or debugging a port.

## Source modes for `bootstrap-authorkit.mjs` (#6)

- **`--from-sibling <dir>` (preferred in a multi-site repo):** copy the runtime from another
  EDS project in the workspace that is already bootstrapped (has `scripts/ak.js` with both
  edits). Offline, deterministic, and parity-safe with a known-good *deployed* runtime — no
  re-fetch, no re-patch risk per site. This is the right default when several sites share one
  repo (e.g. 8 subfolder sites).
- **`--ref <gitref>`:** fetch a **pinned** author-kit ref tarball and port from it. Pin a real
  commit/tag (the script's `AUTHORKIT_REF` constant or `--ref`), **not** a tracking branch —
  author-kit's runtime has drifted (static-fragment → block-based header/footer), so an
  unpinned port can silently change what you get. If the fetched runtime no longer matches the
  static-fragment model this skill describes (`loadStaticFragment`, `postlcp.js` injecting
  `fragments/{header,footer}.html` via `innerHTML`), pin an older known-good ref or use
  `--from-sibling`.

The script does the entire port — copies the PORT-IN set, removes the boilerplate set,
applies AND verifies both mandatory edits (failing loud instead of the usual silent
footer-error-box), patches the `body.appear` blank-render gate, and writes `.eslintignore`.

## Manual manifest (what the script does, for hand-porting)

Fetch the author-kit tarball and copy:

**Port in (from author-kit):**
```
scripts/ak.js scripts/scripts.js scripts/postlcp.js scripts/lazy.js scripts/utils/*
tools/**                      # da/da.js (+ sidekick, quick-edit, scheduler — keep so lazy.js/scripts.js imports resolve). sanitise.js is bundled with this skill, not ported.
deps/**                       # rum.js + lit (head.html loads deps/rum.js)
head.html                     # AuthorKit head: loads ak.js + scripts.js + styles.css + deps/rum.js
blocks/fragment blocks/section-metadata
.hlxignore
```

**Remove (boilerplate the AuthorKit runtime replaces):**
```
scripts/aem.js scripts/delayed.js          # replaced by ak.js + lazy.js
blocks/header blocks/footer                 # replaced by static fragments/{header,footer}.html (Step 6)
blocks/cards blocks/columns blocks/widget   # unused demo blocks (delete to avoid stale aem.js imports)
styles/fonts.css styles/lazy-styles.css     # @font-face goes in styles.css; AuthorKit head loads only styles.css
```

## The two mandatory edits — full mechanics (halves of one change)

1. **`scripts/lazy.js` (#4):** the stock AuthorKit `lazy.js` lazy-loads `utils/footer.js`,
   which does `loadBlock(footer)` and collides with the static footer fragment (renders a
   visible "Error" box, since there is no `blocks/footer`). **Delete the
   `import('./utils/footer.js')…` line.**
2. **`scripts/postlcp.js` (#21):** deleting `utils/footer.js` also removed the only code that
   set the `<footer>`'s class. Without it, the fragment's own root selector
   (`footer.footer { background: … }`) never matches and any styling on the fragment ROOT
   (background/padding/color) silently no-ops. In `loadStaticFragment`, set the class before
   injecting:
   ```js
   const html = await resp.text();
   el.className = name;          // so header.header / footer.footer match
   el.innerHTML = html;
   ```
   This bug is invisible when the footer happens to match the body background; it bites the
   moment a fragment has its own background (e.g. a yellow footer).

When starting a NEW conversion in a repo where a sibling site is already bootstrapped, port
from that sibling (`bootstrap-authorkit.mjs --from-sibling <dir>`) — it already carries both
edits and matches a known-good deployed runtime. Otherwise port from a **pinned** author-kit
ref, not a tracking branch (the runtime drifts).

## Lint mismatch (#6)

The AuthorKit runtime is authored for `@adobe/eslint-config-helix`; a boilerplate project
lints with `airbnb-base`, so `npm run lint` will throw thousands of errors on the vendored
runtime + minified `deps/`. Treat the runtime as vendored — add to `.eslintignore`:

```
deps/
scripts/ak.js
scripts/lazy.js
scripts/postlcp.js
scripts/scripts.js
scripts/utils/
tools/
blocks/fragment/
samples            # reference prototypes, not project code
```

Your generated blocks + `styles/styles.css` still lint clean under airbnb (expand any
single-line multi-declaration CSS rules the prototype used). Alternatively, adopt the
author-kit `eslint.config.js` (helix) wholesale.
