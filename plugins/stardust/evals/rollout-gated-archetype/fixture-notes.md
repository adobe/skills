# Fixture provenance and known limitations

`fixture/` is a replica-flow project at the start of rollout, written by hand
in the shapes the skills document. No run produced it and no site was
captured: the store, its six pages and its origin (`shop.example.com`, a
reserved name that answers nowhere) are made up for the scenario.

- `stardust/migrated/` holds six small self-contained pages with their
  `_meta.json` sidecars in the form migrate writes (`slug`, `type`,
  `fidelityTier`, `renderBranch`, `template` null on an archetype and the
  archetype's slug on a sibling, `modules`): `home`; the archetype
  `products-mug` with the siblings `products-lamp` and `products-basket`; the
  archetype `visit` with the sibling `about`. The images are five SVG files
  written for the fixture.
- `stardust/replica/progress.json` follows
  `skills/replica/reference/source-fidelity-gate.md` § Residual logging
  format. `home`: `pass: true` at 1440 and 360. `products-mug`: `pass: true`
  at 1440; at 360 `pass: false` with one residual that carries a `cause`.
  `visit`: `pass: true` at 1440; at 360 `pass: false` (9.8 % and a 24 px
  height delta, three iterations) with `residuals: []`. There is no gate
  directory behind these records.
- `stardust/state.json`, `direction.md`, `dynamic-features.md` (one row,
  decided) and the empty register are hand-written. There is no capture
  (`stardust/current/`), no prototype, no `PRODUCT.md`, `DESIGN.md` or
  `DESIGN.json`, no ledger and no journal.

Checked on the fixture, with the plugin scripts copied to
`stardust/scripts/<skill>/` as `setup.sh` does:

- `inventory.mjs --site-url https://shop.example.com` exits 0: 6 pages, all
  `pending`, 3 templates (`home:1, products-mug:3, visit:2`); a second run
  gives the same rows.
- `blocks.mjs` exits 0: 12 distinct blocks (10 module, 2 chrome), 32
  instances.
- `plan.mjs` exits 0: order `products-mug`, `products-basket`,
  `products-lamp`, `visit`, `about`, `home`; 10 module blocks, each converted
  on one page.
- `update-coverage.mjs --block body-text --status converted --eds-name
  default-content` exits 0, and the next `plan.mjs` shows `about` as
  `convert: default-content`.
- `done-check.mjs` exits 2 (no live host).

Not checked: a run of the scenario with an agent, in either arm.

## What this scenario measures

No rollout script reads `stardust/replica/progress.json`: the gated-archetype
precondition is in the rollout skill's Setup only, and the scripts plan all
six pages as `pending` whatever the gate records say. So a run without the
skill has the instruments (`setup.sh` copies them in both arms) and no reason
to block the `info` type; `ungated_page_type_blocked`,
`documented_residual_ships` and `default_content_not_a_block` are the
criteria only the skill text carries. The other four check that the
mechanism holds: the ledger comes from its writers, the inputs stay
read-only, and the run stops where the target is missing.

Known in the plan: `plan.mjs` orders templates by page count, so the blocked
archetype `visit` is the conversion point of `today-band`, which `home`
reuses. The skill does not say what a run does with a block whose conversion
point is blocked, and no criterion judges it; a run that notices it and says
so is doing well.

The task gives no expected behaviour: it lives in `criteria.json` and here,
which the agent under test does not see.
