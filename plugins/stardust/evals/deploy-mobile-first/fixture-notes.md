# Fixture provenance & known limitations

`fixture/` realizes this eval's Setup: a redesign project for a fictional
neighbourhood bakery cooperative at the moment the `deploy` skill is first
run — one approved prototype (`stardust/prototypes/home-proposed.html`, in the
prototype skill's self-contained shape with `:root` tokens and semantic
`<section class>` values) whose `<style>` is deliberately desktop-first: two
queries, `@media (max-width: 599px)` and `@media (width < 600px)`, override the
desktop base for phones, so `breakpoint-lint.mjs --root stardust/prototypes
--dirs .` reports 2 desktop-first switches at 600px and the only correct
delivery converts both. `stardust/state.json` is the one of
`deploy-triage-widget` with the page renamed (`flow: redesign`, one `approved`
page) so the deploy flow guard is satisfied. `styles/styles.css` is the stock
aem-boilerplate file, verbatim (adobe/aem-boilerplate@3acb6d95, sha256
`6d9478f7…`): mobile-first already, with two `(width >= 900px)` queries, so
`breakpoint-lint.mjs` run at the fixture root is clean before deploy starts.
`package.json` carries the stock boilerplate scripts only; its
`devDependencies` are left out so that nothing installs and Renovate does not
update a fixture.

Known limitations: there is no `node_modules`, so ESLint and Stylelint cannot
run and `npm run lint` as a whole cannot pass here; the judge runs
`npm run lint:breakpoints`, the part that needs no package, and checks that
`lint` chains it. There is no `aem.js` or `scripts/` and the images referenced
by the prototype do not exist, so the page is not rendered by default:
`phone_is_the_base` is judged from the CSS at 360px and 1280px.
This file and `answers.md` live outside `fixture/` and are not visible to the
agent under test.
