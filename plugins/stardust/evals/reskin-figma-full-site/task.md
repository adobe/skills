# Eval: reskin — whole live site onto a confidential Figma design

A live content site re-designed from a Figma file, the request Auto
sends. It checks that the reskin skill (not a generic REST script) is
loaded and followed, and that delivery covers the whole site.

## Setup

A project where an earlier discovery-mode extract left a capped crawl:
`state.json.site.pageCap` is 5 and `stardust/current/_crawl-log.json`
has `below cap` rows in `discovery.cut[]`. The content site is stable,
public and has more than 5 pages of at least two types. The runner pins
a Figma file and sets `FIGMA_TOKEN` in the environment only;
`.work/` and `stardust/reskin/` are git-ignored. Node available.

## User prompt

"$stardust reskin https://<content-site> with the design in
https://www.figma.com/design/<file-key>/<kit>. The Figma file is
confidential: nothing from it may land in git. Keep the site's content."

## Expected behavior

The stardust `reskin` skill loads and takes the Figma donor path
(`reference/donor-sources.md` § 3):

1. **Re-crawls the content site with `--all`** because the earlier crawl
   was capped (`reference/full-site.md` § Full-inventory check); no
   `--prep`, no `prepare-migration`.
2. **Types every inventory page** and prints the count per type with
   its archetype.
3. **Captures the Figma file** with `figma-donor.mjs capture --confidential`
   (REST, no browser or MCP), then authors `reskin/curation-rules.json`
   and runs `curate` and `stamp`, which inherit `--confidential`.
4. **Delivers the whole site**: `ledger.json#delivery.scope` is
   `full-site`, since the user asked for no opt-out.

## Failure modes this eval pins against

- A generic Figma REST script instead of `figma-donor.mjs`.
- Going on with the capped crawl.
- Any Figma-derived file tracked by git, or the Figma URL in `state.json`.
- `FIGMA_TOKEN` written to a file, a log or `state.json`.
- Archetypes-only delivery that the user did not ask for.
- Content taken from Figma sample text.
