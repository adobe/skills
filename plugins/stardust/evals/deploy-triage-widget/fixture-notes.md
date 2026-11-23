# Fixture provenance & known limitations

`fixture/` realizes this eval's Setup: a redesign project for a fictional
regional public-library network at the moment the `deploy` skill is first run
— one approved prototype (`stardust/prototypes/home-proposed.html`, written in
the prototype skill's self-contained shape with `:root` tokens and semantic
`<section class>` values) whose `<main>` holds a hero, a three-card programme
grid and a catalogue search made of one input, one button and an empty
results list, deliberately with zero authored copy so the Step 2 D1 triage
has exactly one correct answer (widget); a curated `stardust/dynamic-features.md`
in the dynamics triage shape whose search row is `client-only` /
`search-index-backed` but which predates the `target` axis, so the deploy
skill must decide the delivery form itself rather than copy it; a minimal
`stardust/state.json` (`flow: redesign`, one `approved` page) so the deploy
flow guard is satisfied; and a stock-shaped `scripts/scripts.js` (144 lines,
sha256 `e43cddca…`) carrying `buildWidgetAutoBlocks()` so the loader is
visibly stock and any edit is detectable. Images referenced by the prototype
do not exist as files (the eval never renders), there is no `aem.js`,
`styles/` or `blocks/` tree, and the judge grades only the conversion log,
`content/home.html` and the absence of code — never the transcript's claims.
This file and `answers.md` live outside `fixture/` and are not visible to the
agent under test.
