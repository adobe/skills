# Extend pass — more pages of a delivered replica site

A delivered run (`replica handoff end`, every `done-check.mjs` gap closed) takes more pages of the same site, on
the same project and the same delivery site, as one **pass** — `x1`, `x2`, … — that delivers only its new pages:

```
$stardust replica <URL> --extend <url,url,...>    # the pages the owner names
$stardust replica <URL> --extend-next <n>         # the next n pages, in the first pass's selection order
```

A pass runs Phases 1 and 3–5 over its new pages only — never the whole procedure again, never Phase 2. Fewer than
`n` pages left delivers those that are left; none left ends the pass at once (`extend end --detail "0 new pages"`).

## Entry — when a pass opens

`node stardust/scripts/stardust/ledger.mjs last replica` decides:

| Latest replica line | Without `--extend*` | With `--extend*` |
|---|---|---|
| `handoff end` (no track) or `extend end` (track `x<N>`) | delivered: the state report, then stop — the run is complete, nothing re-runs | open pass `x<N+1>` |
| any other line of track `x<N>` | resume pass `x<N>` — its units not `done` | resume pass `x<N>` first; a new pass opens only after its `extend end` |
| a first-pass line (no track) before `handoff end` | the first pass resumes (`../SKILL.md` § Procedure) | refuse: the first pass is not delivered |

Also refuse when `state.json.flow` is not `replica`, or when `<URL>` resolves to another origin than
`state.json.site.originUrl` (extract's origin collision).

**Pass number** `N` = the count of `stardust/replica/extend/x*/` directories + 1. Every ledger line of the pass —
replica, extract, migrate, rollout — carries `--track x<N>`, so its pairs never close or reopen another pass's
(`done-check.mjs` reads the last `I-dashboard` line whatever its track). The pass opens, in order:

```bash
L="node stardust/scripts/stardust/ledger.mjs"; F="node stardust/scripts/replica/foundation-freeze.mjs"
$L replica extend start --track x1 --detail "--extend-next 300" --strict
mkdir -p stardust/replica/extend/x1
# the spec guard — the listed files that exist (a bounded-entry project has no current/PRODUCT.md)
$F freeze --paths PRODUCT.md,DESIGN.md,DESIGN.json,stardust/current/PRODUCT.md,stardust/current/DESIGN.md,stardust/current/DESIGN.json --out stardust/replica/extend/x1/spec-freeze.json
$F freeze    # re-freeze the delivered foundation: the manifest C0 wrote predates the requests C-final applied
```

## 1. The spec is frozen

A pass never writes `stardust/current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` or the promoted root copies, and
Phase 2's promotion and `direction.md` do not re-run: extract's synthesis over the new pages alone would replace the
gated spec. `$F check --manifest stardust/replica/extend/x<N>/spec-freeze.json` runs after the extract and before
`extend end`; exit 1 → `git checkout -- <path>`. The foundation is frozen from the pass's opening; a change a new
page needs is one line in `stardust/rollout/foundation-requests.md` (`handoff-contract.md` § 3, Fan-out
discipline). The register gains entries only for a new page type, appended.

## 2. Extract — the new pages only

`replica extract start --track x<N>`, then `$stardust extract <URL> --prep --dynamics` with `--pages <urls>`
(`--extend`) or `--cap <n>` (`--extend-next`, plus `--link-first` when the first pass's cap was user-named —
`_crawl-log.json` `discovery.capSource`), its crawl run with
`crawl.mjs … --skip-captured stardust/state.json`: every page already in `state.json` is dropped before the cap, the
entry included, and a new page never takes a slug an earlier pass holds. A re-captured delivered page would change
its JSON, and `inventory.mjs` would flag it `stale`. The pass runs extract's Phases 1, 2, 2.5 and 6 and prep's
page typing and typed slots (`../../extract/reference/prep-mode.md` § 2, § 4) — never Phases 3–5. Module detection
matches the new pages against the frozen `DESIGN.json.extensions.modules[]`; a repeat outside it is a row in the
pass's journal section, never a `DESIGN.json` edit. Capture gaps settle here as in a first pass. Write the new slugs,
one per line, to `stardust/replica/extend/x<N>/slugs.txt` — every `--only` list of the pass comes from it.

## 3. New page types only — Phases 3–4

A new page's type with an archetype in `stardust/replica/progress.json` goes straight to Phase 5 at sibling tier. A
type without one gets Phases 3–4 for that type only (`recreate` / `source-fidelity-gate` lines `--track x<N>`): its
archetype prototype imports the gated shared layers and iterates on its new modules only (`../SKILL.md` § Phase 3,
cumulative prototypes), then its C-archetype unit before its cluster.

## 4. Phase 5 — units of the pass

`replica handoff start --track x<N>`; rollout and migrate run their phases again with the pass's track, and each
script already skips what is delivered.

- **Migrate:** `migrate.mjs render <new slugs> --archetype <slug>=<arch>` per cluster — never `--all` and never
  `--force`, which re-render delivered pages. Units in `stardust/migrate/progress.json` carry the pass suffix.
- **Units:** every new unit in both `progress.json` files is named `<unit>-x<N>` (`archetype-<template>-x1`,
  `<cluster>-x1`, `gate-all-x1`); a `done` unit of an earlier pass is never reopened, and a new page of a known
  template joins a new cluster unit. No `foundation` unit: the foundation is delivered and frozen.
- **A, B:** `inventory.mjs` keeps delivered rows and adds the new ones `pending`, so optimize, verify and
  `done-check.mjs` cover them; `blocks.mjs`, then `plan.mjs --pending-only`. **B2:** the new pages' dynamic surface —
  `dynamic-features.md` gains rows, never loses one.
- **C-deliver** (`--track x<N>`; one start/end pair per pass): C-archetype units for the new types, cluster units
  with `gate-all.mjs --only <their slugs>`, then C-final: the pass's queued foundation requests applied once and the
  published gate re-run on every affected archetype, any pass's; unit `gate-all-x<N>` is `gate-all.mjs
  --skip-existing` over the roster — the delivered pages' recorded verdicts are reused, only the new pages are
  gated, and `summary.json` stays complete for `update-coverage.mjs --gate`.
- **D, D2:** the served sitemap count grows by the pass's pages (`D-site end` names it); every parity row replays.
- **E2:** `localize-links.mjs` over the whole content tree — a page this pass delivers can be a target an earlier pass
  repointed to the source. It prints a count only: the delivered pages it rewrote are `git diff --name-only --
  content/` before the checkpoint, re-driven as a paths file with `deploy-batch.mjs --paths <file> --force`.
- **F–I** as in a first pass. Then `done-check.mjs` exit 0, `replica handoff end --track x<N>`, `$F check` on the
  spec manifest, `replica extend end --track x<N> --detail "<n> pages delivered (x<N>), <total> live"`.
