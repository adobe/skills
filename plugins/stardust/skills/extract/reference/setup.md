# stardust:extract: setup, Playwright installs, script copies and the bundled crawler

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

## Setup

1. **Playwright availability.** (continued)

   **`--no-save` installs are ephemeral.** Any later real `npm i` (e.g. a setup step
   adding a devDependency) prunes non-manifest packages, silently
   removing playwright mid-pipeline. Every downstream skill that
   renders (prototype, migrate, deploy, diff) must re-run the
   import-resolvability probe — and re-install on failure — at the
   start of its own run, not assume extract's install survived.

   **Script location matters.** ESM resolves `import 'playwright'`
   from the *script's* directory and the plugin tree ships no
   `node_modules`: copy every script byte-identical into the project
   (`stardust/scripts/…`), the master skill's too (`../stardust/SKILL.md`
   § Setup, step 7), and run the copy.

   **Bundled crawler.** `skills/extract/scripts/crawl.mjs` is a
   runnable reference implementation of this whole sub-command —
   browser config + bot-management fallback, consent dismissal, wait
   + scroll, the capture list, per-page full-page screenshots
   (`assets/screenshots/<slug>.png`, consumed by the Phase 2.5
   vision gate), response validation, and the §
   Capture-hygiene hardening (visibility filter, interstitial drop,
   SPA-shell flag, modal `textContent` capture, tracking-pixel
   discounting, cross-page duplicate detection). Prefer invoking it over
   hand-rolling a Playwright script per run; extend its in-page
   `capture()` to cover any recipe field it doesn't yet emit.
