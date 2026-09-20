# Eval: replica — a second chrome variant is gated before its pages fan out

Pins the chrome-archetype precondition of the `replica` skill (operator card
row 5; `skills/replica/reference/chrome-states.md` § Chrome variants): every
chrome variant the capture reveals needs its own chrome archetype row in
`stardust/replica/progress.json.chrome.variants[]` before any page of that
variant is fanned out at sibling tier. A bucket without its row is BLOCKED —
never rendered with the archetype's chrome and never "compensated" with
page-local CSS.

## Setup

A keep-design migration project, frozen right after two more landing pages
were captured for fan-out. `fixture/` is a copy of the shared post-migrate
fixture (`evals/_shared/fixture-post-migrate/`, see its README) plus the
files listed in `fixture-notes.md`. The site is a fictional regional
financial-services site on a `.example` origin — nothing here is reachable,
nothing was crawled.

What the agent finds on disk:

- `stardust/state.json` — `flow: "replica"`; six pages `migrated` (two per
  type) plus two new `landing` pages `extracted` on 2026-09-15: `members`
  and `claims`. No page carries `chromeVariant` yet.
- `stardust/current/pages/*.json` — eight page records, each with the
  `chrome` field extract records (header/footer landmark classes, nav rows,
  body classes, stylesheet paths). Six share one fingerprint; `members` and
  `claims` share a second one (a campaign header with a persistent sub-nav
  band, a compact footer, an extra `campaign.*.css`, body class
  `tpl-campaign`).
- `stardust/replica/progress.json` — the gate ledger: the `landing`
  archetype `home` passes at 1440 and 360; a top-level `chrome` block with
  ONE variant row, `default` (states `rest`, `scrolled`, `menu:*`, `search:
  dead`, `drawer`, `drawer-drilled: unprobed:…`, `footer-accordion:*`); every
  `archetypes[]` entry says `chromeVariant: "default"`.
- `stardust/journal.md` — the last entry records the capture and ends with
  `**Next:** $stardust replica — fan out members and claims at sibling tier
  from the gated home archetype.`

`stardust/prototypes/`, `stardust/replica/gates/` and the promoted root spec
are absent, as in the shared fixture. The runner presents the session as
interactive (`answers.md`).

## User prompt

"$stardust replica — fan out members and claims from the home archetype"

## Expected behavior

1. **Inventory before fan-out, at zero live hits.** The agent runs
   `chrome-variants.mjs` over `stardust/current/pages` with `--state` and
   `--progress stardust/replica/progress.json` (from the project copy of the
   scripts, or the plugin's when no copy exists) and reads its verdict: two
   chrome variants — `default` (six pages, rowed) and a second bucket holding
   exactly `members` and `claims` (no row) — exit 2. It does not probe any
   live URL to learn this, and it does not probe per page.
2. **The unrowed bucket does not fan out.** `members` and `claims` are not
   rendered, migrated or deployed in this session. The agent says why in the
   gate's own terms: the variant has no chrome archetype row, so its chrome
   was never inventoried or gated (`chrome-states.md` § Chrome variants).
3. **No page-local compensation.** The agent does not propose or author
   per-page header/footer CSS, `body:has(...)` / page-scoped selectors, or a
   patched copy of the `home` chrome for the two pages. The documented
   default is named instead: the variant as a template body class or a
   `nav:` / `footer:` document — a site-level decision (`chrome-variant`),
   presented to the user with that default, not decided silently.
4. **Names are persisted, never renumbered.** `chrome-variants.mjs --write`
   stores `pages[].chromeVariant` in `state.json` (`default` on the six,
   the generated `variant-<key>` name on the two); no existing name is
   changed and nothing is merged into `default`.
5. **The next command is exact.** The hand-off names, verbatim: one
   `chrome-states.mjs` probe on ONE URL of the new variant (`--live-cache`,
   one navigation per breakpoint — the command the inventory printed), the
   chrome archetype row to add to `progress.json.chrome.variants[]` for that
   name with every state of the matrix recorded as `gated` | `dead` |
   `unprobed:<reason>`, and the re-run of `chrome-variants.mjs --progress`
   to exit 0 before `members` / `claims` fan out.
6. **Nothing is fabricated.** No row is written to `progress.json.chrome`
   for the new variant in this session (the probe cannot run — the origin
   is unreachable), no state word is invented, no gate number appears that
   is not on disk. The `default` bucket's pages are not touched either.

## Failure modes this eval pins against

- Fanning out `members` / `claims` from the `home` archetype because the
  `landing` type is gated — the page-type gate is not the chrome gate.
- Writing a `chrome.variants[]` row (or `states: {…gated…}`) for the second
  variant without a probe, so the gate "passes".
- Fixing the sub-nav band / compact footer on the two pages with page-local
  CSS or a `body:has()` rule, or forking the header block per page.
- Renaming the buckets (`default` → something else, or merging the campaign
  bucket into `default`).
- Probing the live origin per page, or at all, to decide the inventory.
- Skipping the `chrome-variant` decision (silently picking a mechanism), or
  asking the user to choose with no default.
