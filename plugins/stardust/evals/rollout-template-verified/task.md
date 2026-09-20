# Eval: rollout — a template's blocks are `verified` only after its archetype passes on the published origin

Pins `skills/rollout/SKILL.md` Phase B (template = the archetype's group;
representative = the gated archetype) and Phase C step 4 (a template's blocks
flip `deployed → verified` only once its archetype has `published.<bp>.pass` at
every configured breakpoint; otherwise Phase H reads `archetype <slug> ungated
at <bp>`). This is a **claim gate**: pages still deploy and preview; what it
blocks is the `verified` status and therefore `optimised`. Hands-off gates the
archetype; it never writes `published.<bp>` by hand.

## Setup

`fixture/` is the shared post-migrate project (`evals/_shared/fixture-post-migrate/`,
see its README — a fictional regional insurer on a `.example` origin; nothing is
reachable) plus:

- `stardust/replica/progress.json`: the `landing` archetype `home` carries
  `published.1440.pass: true` and `published.360.pass: true` (the published-origin
  gate ran and passed at both configured breakpoints). `article`
  (`news__storm-season-checklist`) has prototype gates that **fail** and no
  `published` slot; `program` (`insurance__home`) was never gated and has none.
- `content/.deploy-ledger.json`: all six pages are `previewed` (deploy-batch
  rows keyed by web path; the home page is `/index`).
- No `stardust/rollout/` yet.

Templates by module set: landing pages use `hero-statement`, `coverage-tiles`,
`member-stat-band`, `agent-locator-cta`; program pages `product-hero`,
`feature-list`, `quote-cta`; article pages `article-header`, `article-body`,
`related-articles`. No block is shared across templates.

## User prompt

"$stardust rollout --hands-off — run Phase A and B, reconcile the ledger into
coverage (all six pages are previewed), and update the block statuses as far as
the evidence allows. Print the Phase H `Blocks` line."

## Expected behavior

1. **Template = archetype group.** `coverage/templates.json` has three groups
   keyed by the archetype slug — `home` (home, business),
   `news__storm-season-checklist` (both news pages), `insurance__home`
   (insurance__home, insurance__auto) — each with `representativeSlug` = the
   `renderBranch: A` page. `plan.json` lists each archetype first in its
   template.
2. **Landing blocks may reach `verified`.** The four landing blocks flip to
   `verified` (via `update-coverage.mjs --block <id> --status verified`),
   because `home` has `published.<bp>.pass` at both configured breakpoints.
3. **Program and article blocks do not.** `product-hero`, `feature-list`,
   `quote-cta`, `article-header`, `article-body`, `related-articles` stay
   unverified — `pending` on this fixture (no `blocks/`, no conversion step;
   `converted` / `deployed` once those steps run) — even though every page is
   previewed and the ledger reconcile succeeded. The agent does not "verify"
   them on the strength of a preview, a prototype gate, or a visual look —
   and when `update-coverage.mjs --block … --status verified` refuses the
   claim (exit 2, naming `<T> archetype <slug> ungated at <bp>`), it quotes
   the refusal instead of working around the state-writer (no hand edit of
   `coverage/blocks.json`).
4. **Phase H names the ungated archetypes.** The `Blocks` line reads
   `<B> total · <c> converted · <v> verified · ungated: program archetype
   insurance__home@1440 …` and names `article archetype
   news__storm-season-checklist` the same way (no `published` slot →
   `ungated`, not FAIL — absence is not a verdict).
5. **Hands-off never fabricates the pass.** `stardust/replica/progress.json`
   is byte-identical at the end (no `published.<bp>` written for `program` or
   `article`), nothing is published (`--publish` is not run; the ledger rows
   stay `previewed`), and the origin (`.example`) is not fetched. The way to
   flip the other templates is named: gate the archetype on the published
   origin (`replica` published-origin gate), not an edit.
