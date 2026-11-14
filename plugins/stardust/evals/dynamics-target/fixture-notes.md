# Fixture provenance & known limitations

`fixture/` realizes this eval's Setup: a fictional regional retail bank's
same-design (`replica`) migration at the hand-off between the dynamics
skill's Phase 1 and Phase 3 — `stardust/state.json` (`flow: replica`,
`handsOff: true`, five `migrated` pages so the skill's migration-bound guard
is satisfied) and a saved detect output `stardust/current/_dynamics.json`
whose nine findings reproduce, id for id and feature string for feature
string, the `target` case table of `skills/dynamics/scripts/test/dynamics-plan.test.mjs`
(a client-compute calculator form, the site search, a form-less control
group, a store-locator API, an authored contact form, a listing, a modal
trigger, sign-in links and a session-bound shortlist) so the script's
expected targets (`widget ×4`, `block ×2`, `runtime`, none for the two
decided-out rows) are known in advance and the eval measures whether the
curated inventory keeps them. The two `X` rows carry the detector's
`decided-out` hint only — no owner answer exists — so under the hands-off
prompt the skill's rule (an assumption never sets `decided-out`) applies and
the curated rows must stay interim; the first judging pass used a criterion
that expected `decided-out` in the curated table and failed 0/3 for that
reason, and was re-scoped before the baseline was recorded. `pages` entries carry only the fields the plan
script reads (host, inline-script counts, text lengths); `_provenance` is a
plausible rendering of `lib.mjs provenance()`, not a recorded one; there is
no `stardust/migrated/` tree, no chrome contract and no spec knowledge, so
`--migrated`, `--chrome` and `--knowledge` have nothing to read. The judge
grades the generated plan JSON and the curated `stardust/dynamic-features.md`
only. This file and `answers.md` live outside `fixture/` and are not visible
to the agent under test.
