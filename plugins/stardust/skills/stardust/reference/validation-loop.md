# stardust:stardust: validation loop

The text of this part of `skills/stardust/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

## Validation rule

For HTML the user will see (prototypes, migrated pages, the brand-review
HTML):

1. Render in Playwright (file:// for static, or local dev server), through
   `browser.mjs` (§ Setup, step 7).
2. Capture at three viewports — desktop **1440×900**, tablet **768×1024**,
   mobile **390×844**:
   - Full-page screenshot.
   - Browser console messages (errors + warnings).
   - Network failures (4xx / 5xx / aborted requests, missing assets).
   - Uncaught JS exceptions + unhandled promise rejections.
   - Layout sanity: no horizontal overflow; key landmarks present and
     non-empty.
   - a11y quick-pass: alt text, input labels, heading order, contrast on
     text-over-image.
   - Interaction smoke: hover an interactive card, scroll-trigger fires,
     nav opens/closes, primary CTA reachable by keyboard.
3. **If any issue is found, fix it and re-run the loop.** Iterate
   recursively until either (a) no issues remain or (b) the fix needs user
   input — in which case surface the question and stop. Do not report a
   task complete with known issues outstanding.
4. Save the final clean-pass screenshots to `stardust/validation/<artifact>/<viewport>.png`
   so reviewers can compare without re-running.
