# Fixture provenance and known limitations

`fixture/` is a replica project recorded against the fixture site
(`../fixture-site/`, served on `http://localhost:8780/`), then cut down to
text files:

- `stardust/current/` is the output of `extract/scripts/crawl.mjs --url
  http://localhost:8780/visit/ --max 1`, without the screenshot and the
  favicon it names.
- `stardust/replica/spec/` is the output of `source-spec.mjs capture
  http://localhost:8780/visit/ --slug visit --widths 1440,360`, without the
  header and footer inventories.
- `stardust/prototypes/visit-proposed.html` is a clean re-authoring of the
  page with one defect: the cells of the opening-hours table have 8 px of
  vertical padding where the source has 12 px. `source-spec.mjs compare`
  names it (three rows, 8 px each, total offset 24 px, exit 2).
- `stardust/replica/gates/visit-1440/` holds the text evidence of three
  `gate.sh visit <live> <prototype> 1440 iter<n>` rounds run with the padding
  at 6, 7 and 8 px: exit 2 each, offsets 36, 30 and 24 px against the 8 px
  bound, counted in `rounds.json` as first, fix, fix. The frozen reference
  and the images of those rounds are not kept, so a round after a decision
  freezes the reference again.
- `stardust/state.json`, `direction.md` and the empty register are written by
  hand in the shapes the skills document. There is no `PRODUCT.md`,
  `DESIGN.md` or `DESIGN.json`, no ledger and no journal: the task says
  Phases 1 and 2 are done.

Checked on the recorded fixture: a fourth `gate.sh` round exits 6 before any
capture and without `node_modules`; `rounds.mjs decide … --decision
accept-residual` exits 0 and a later round still exits 6.

`setup.sh` starts the fixture site and copies the plugin's scripts to
`stardust/scripts/<skill>/` in both runs of a comparison, so the run without
the plugin has the instruments and their `--help`, and lacks only what the
skill says. The task gives no expected behaviour: it lives in `criteria.json`
and here, which the agent under test does not see.

The decision is not prescribed. With the defect this small, `re-prototype`
followed by a passing round is as good an outcome as `accept-residual` with
the residual logged; a run that takes it needs the gate's dependencies and
Chromium, which it installs itself (the skill's Setup, step 2).

## What this scenario measures

The cap lives in the scripts on purpose: `gate.sh` refuses the round and names
the `rounds.mjs decide` command. `setup.sh` copies those scripts into the work
directory for both arms, so the scenario checks that the mechanism holds end
to end (no round past the cap, a recorded decision, an honest report), not
that the skill text adds to it. Its first run with `scripts/skill-eval.mjs`
passed all six criteria with the plugin and without it. Evidence that the
skill text helps needs a criterion only that text carries.
