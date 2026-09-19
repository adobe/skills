# Shared fixture — post-migrate replica project

A hand-authored keep-design migration project, frozen at the moment after
`replica` + `migrate` have run on three page types and a rollout attempt has
just been blocked. Evals that start "from a migrated project" (deploy,
rollout, the gated-archetype precondition, resume / state report, journal
`Next:` recovery) copy this tree instead of inventing their own.

The site is fictional: **Larkspur Mutual**, a regional financial-services
site (member-owned home and auto insurer) at `https://www.larkspurmutual.example`.
The `.example` TLD guarantees no live site is behind it — nothing here was
crawled.

## How to reuse

1. Copy the `stardust/` directory into your eval's fixture:
   `cp -R evals/_shared/fixture-post-migrate/stardust evals/<your-eval>/fixture/stardust`.
   Copy, do not symlink — the runner copies `fixture/` into the workspace
   with `cp -R` semantics and a relative symlink would dangle there.
2. Add or edit only what your scenario needs on top (e.g. a `deployUrl`, a
   stale flag, a fourth journal entry). Leave this shared tree unchanged;
   if a shape here is wrong for every consumer, fix it here once.
3. Do not copy this README into a fixture — everything under `fixture/`
   is visible to the agent under test.

## What is in the tree

| Path | Shape follows | What it encodes |
|---|---|---|
| `stardust/state.json` | `skills/stardust/reference/state-machine.md` (§ Flow keys, § Page lifecycle) + `skills/stardust/reference/migrate-output-format.md` § State.json contract | `flow: "replica"`, `flowChosenAt`, `flowSource: "question"`; six pages `migrated` (two per type); `migrate` block with `pageMap`, `selfContained: true` |
| `stardust/direction.md` | `skills/replica/reference/preserve-direction.md` § 2 | preserve-mode record, verbatim promotion, register pointer |
| `stardust/replica/inconsistency-register.md` | same file, § 3 | one `applied` entry (R-01, footer link contrast) |
| `stardust/replica/progress.json` | `skills/replica/reference/source-fidelity-gate.md` § Residual logging format | per-archetype gate ledger — see the three cases below |
| `stardust/migrated/**` | `skills/migrate/reference/migration-procedure.md` (§ Output path mapping, § `_meta.json` sidecar, § Provenance) | six pages at URL-literal paths + sidecars + three bundled assets |
| `stardust/journal.md` | `skills/stardust/reference/journal-format.md` | four entries; the last carries the `Next:` line the resume path should quote |
| `stardust/status.jsonl` | `skills/stardust/reference/run-status.md` | extract → replica → migrate → routing → rollout `blocked` |

### The three gate cases (`progress.json`)

| Page type | Archetype | 1440 | 360 | Reads as |
|---|---|---|---|---|
| `landing` | `home` | pass | pass | may ship |
| `article` | `news__storm-season-checklist` | over the bar, every residual carries a `cause` | same | pass with an asterisk — may ship, residuals surface in the report |
| `program` | `insurance__home` | never gated (`gated: false`, `breakpoints: {}`) | — | blocked; the command to gate it is in the journal `Next:` line |

Siblings: `business` (landing), `news__annual-report-2025` (article),
`insurance__auto` (program) — rendered at Path A′ with one `variants[]`
entry each.

### Why a migrated sibling exists for an ungated archetype

The project was migrated on 0.22.2, before the fan-out precondition
existed, then resumed on 0.23.0: the flow guard fired (state.json had no
`flow`), the user answered the keep-vs-redesign question, and rollout Setup
blocked the `program` type. That is the field failure the precondition
guards against, reproduced on disk. `_provenance.stardustVersion` in
`state.json` is therefore 0.23.0 while the migrated HTML says 0.22.2 —
intentional.

## Known limitations

- **Not present**: `stardust/current/` (page JSON, screenshots, fonts,
  `_brand-extraction.json`), the promoted root `PRODUCT.md` / `DESIGN.md` /
  `DESIGN.json`, `stardust/prototypes/`, `stardust/replica/gates/`,
  `stardust/replica/motion/`, `stardust/dynamic-features.md`. Paths in
  `state.json`, `progress.json` and the journal point at them as a real
  project would. An eval whose skill reads one of them adds it in its own
  fixture copy.
- Every sha (`designMdSha`, `canonShas`, `sourceCurrentSha`, ...) is a
  syntactically valid sha256 but nothing in the tree hashes to it; an
  idempotent-skip scenario must regenerate them from the files it adds.
- The migrated HTML is minimal (one `<style>` block per page, three tiny
  assets); it satisfies the output contract's shape, not a pixel gate.
- `status.jsonl` phase names follow each skill's SKILL.md headings at
  0.23.0; adjust if a skill renames a phase.
