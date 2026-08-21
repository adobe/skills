# Changelog — delivery contract, media reconciliation, fidelity tiers

Branch `stardust/delivery-media-fidelity`. Three generalized improvements drawn
from a real CE Credits Online → EDS migration (full notes in the project's
`stardust/skill-feedback.md`). The throughline: move what the *agent* had to
remember (the EDS delivery contract, per-image handling, the quality/coverage
trade) into what the *plugin* enforces.

## B — Encode the EDS/DA delivery contract as guardrails

The contract rules were tribal knowledge the pipeline re-learned by shipping a
broken page and reading it back. Now they're code, split into two halves:

- **Static, pre-PUT:** `rollout/scripts/delivery-lint.mjs` +
  `rollout/reference/delivery-lint.md`. Deterministic, offline checks over
  authored DA HTML: `<body><main>` wrapper, exactly-one-`<h1>` (typed),
  **one-CTA-per-`<p>`** (the silent buttonization defect), trailing-slash /
  `.html` links, `/img/` srcs, `about:error`, path-safety, metadata presence,
  cross-origin-in-optimizing-block. P0/P1 blocks the PUT.
- **Dynamic, post-deploy:** `rollout/scripts/verify.mjs` is now **artifact-type
  aware** (`page | fragment | index`). A page must render exactly one `<h1>`; a
  fragment (nav/footer) is no longer false-failed for lacking one; an index is
  validated as JSON with rows. Output reports the type distribution.

Wired into `rollout/SKILL.md` Phase C (new step 2, before the gates) and
cross-referenced from `rollout/reference/delivery-gates.md` (§ Two halves).

## C — Make media reconciliation a first-class decision

Imagery is the #1 fidelity risk. `rollout/scripts/media-reconcile.mjs` +
`migrate/reference/media-reconciliation.md` resolve **every** image on the
network and decide per image: **optimize** (same-origin Content Bus),
**keep** (external, 200 — skip block optimization), **rewrite** (repairable:
missing `?`-delimiter, wrong host), or **omit** (unresolvable — drop the `<img>`,
never ship `about:error`). `--apply` performs the rewrite/omit in place.

Documents the `createOptimizedPicture` cross-origin trap (it drops the `?v=`
key and corrupts external renditions) as a **block-code** rule: optimize
same-origin only. Wired into `migrate/SKILL.md` Phase 2 (new "Media
reconciliation" step) and `rollout` Gate 2 as the authoritative resolver.

## D — Formalize fidelity tiers (the budget/coverage trade)

`migrate/reference/fidelity-tiers.md` turns the existing render branches
(A / A′ / unique) into **declared, gated tiers**:

- **archetype** (Path A) — craft-gated once per template (full prototype stack).
- **sibling** (Path A′) — canon-fork; inherits the archetype's validated
  structure, re-checks only content-fidelity + delivery-lint + media-reconcile.
  **The cheap default for breadth** — the reflex for "page N of an established
  template" is *fork the archetype*, never *re-author*.
- **thin** — bodyless/PDF pages rendered gracefully, no fabricated filler.

Each page declares `fidelityTier` + `archetypeSource` + `gatesPassed[]`
(`migrate/SKILL.md` Phase 2). The rollout dashboard surfaces the **tier
distribution** so "92/92 deployed" can't hide "1 craft-gated, 91 ungated"
(`rollout/reference/coverage-model.md` § Artifact type + fidelity tier).

## Files

New: `rollout/scripts/delivery-lint.mjs`, `rollout/scripts/media-reconcile.mjs`,
`rollout/reference/delivery-lint.md`, `migrate/reference/media-reconciliation.md`,
`migrate/reference/fidelity-tiers.md`.
Modified: `rollout/scripts/verify.mjs` (typed), `rollout/SKILL.md`,
`migrate/SKILL.md`, `rollout/reference/delivery-gates.md`,
`rollout/reference/coverage-model.md`.

All scripts are dependency-free Node, `node --check` clean, and were smoke-tested
against the CE Credits Online migrated tree (home, nav fragment, synthetic
broken-image and bad-path fixtures).
