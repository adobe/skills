# State machine

Stardust tracks state per page so multi-page redesigns can be incremental
and resumable. The state file is `stardust/state.json`. It is written by
`extract`, `direct`, `prototype`, and `migrate`, and read by `stardust`
(the master) for the state report.

---

## File: `stardust/state.json`

```json
{
  "_provenance": {
    "writtenBy": "stardust:<sub-command>",
    "writtenAt": "<ISO timestamp>",
    "stardustVersion": "0.2.0"
  },
  "site": {
    "originUrl": "https://example.com",
    "deployUrl": null,
    "extractedAt": "<ISO timestamp>",
    "pageCap": 25,
    "totalDiscovered": 38,
    "crawled": 25
  },
  "direction": {
    "resolvedAt": "<ISO timestamp>",
    "phrase": "<verbatim user phrase>",
    "directionFile": "stardust/direction.md",
    "iaFidelity": "reimagined"
  },
  "pages": [
    {
      "slug": "home",
      "url": "https://example.com/",
      "title": "Example Home",
      "type": "landing",
      "status": "approved",
      "history": [
        { "status": "extracted",   "at": "..." },
        { "status": "directed",    "at": "..." },
        { "status": "prototyped",  "at": "..." },
        { "status": "approved",    "at": "..." }
      ],
      "stale": false,
      "staleReason": null,
      "currentStatePath": "stardust/current/pages/home.json",
      "prototypePath":    "stardust/prototypes/home-proposed.html",
      "migratedPath":     null
    }
  ]
}
```

Top-level keys: `_provenance`, `site`, `direction`, `pages`. Always in
that order. `_provenance` is always the first key.

---

## Page lifecycle states

A page moves linearly through these states. It can be marked **stale**
at any non-terminal state when direction changes; `stale: true` does not
move the state, it flags it.

| State        | Meaning                                                                 | Set by                  |
|--------------|-------------------------------------------------------------------------|-------------------------|
| `extracted`  | Crawled and parsed. `current/pages/<slug>.json` exists.                 | `stardust:extract`      |
| `directed`   | Direction `direction.md` resolved; this page is in scope of the direction. | `stardust:direct`     |
| `prototyped` | A proposed-redesign prototype exists at `prototypes/<slug>-proposed.html`. | `stardust:prototype` |
| `approved`   | The user explicitly approved the prototype.                             | `stardust:prototype`    |
| `migrated`   | Final redesigned static HTML written to `migrated/<slug>.html`.         | `stardust:migrate`      |

**Linearity rule.** A page never moves backward. Re-running `prototype`
after `approved` does not demote — it produces a new prototype with a
new history entry, and the user must re-approve to advance.

---

## Page types

A page carries a `type` field describing its content shape. Types let
`migrate` apply the right approved-template-archetype across siblings:
an approved `article` template renders every other `article` page;
an approved `listing` template renders every `listing` page.

| Value      | When the page is...                                                       |
|------------|---------------------------------------------------------------------------|
| `landing`  | Multi-audience landing or home page                                       |
| `article`  | Blog post, news article, story — long-form prose with a single subject    |
| `listing`  | Index of articles, programs, products — repeating cards                   |
| `program`  | Service / program / product detail — feature-rich                         |
| `form`     | Donation, contact, sign-up — form-driven funnel                           |
| `static`   | About / team / financials — content-driven, low-frequency change          |
| `unique`   | Escape hatch — none of the above; render as one-off                       |

The catalog is per-site; new types may be added at `direct --prep`
time when the inventory surfaces a shape no existing type covers.

**When set.** `type` is inferred during `extract --prep` from URL
pattern and content shape (LLM judgment). The user confirms or
refines the catalog during `direct --prep`. Discovery-mode runs of
`extract` skip type-tagging — `type` is `null` until prep-mode sets
it.

**Effect on migrate.** A page typed `article` whose own status is
`directed` is migrated by forking the approved `article` sibling's
structure (Path A′ in `skills/migrate/SKILL.md`). A page typed
`unique` is rendered as a one-off using DESIGN.md/json + canon +
brand modules.

---

## Stale flagging (content-aware)

When `$stardust direct` resolves a new direction that differs from
the prior one, stale-flagging is **content-aware**, not blanket:
each page in `prototyped`, `approved`, or `migrated` state is
flagged stale only if the new direction's changes actually affect
that page's deployment. The earlier blanket rule (every prior-state
page goes stale on every re-direct) over-invalidated work and
forced the user to re-render
pages whose composition was unchanged by the direction edit.

The rule:

1. Compute the **delta** between old and new direction:
   - Token vocabulary changes (colors, typography, spacing,
     radii) — affects every page that consumed the changed
     tokens.
   - Voice rule additions/removals — affects every page whose
     content the new rule would re-judge.
   - Anti-toolbox audit changes — affects every page whose
     proposed file declared an audited move.
   - Abstract component vocabulary changes (button-primary
     redefined, etc.) — affects every page deploying that
     component.
   - Named system-component role changes — affects every page
     deploying that role.
   - Canon changes (chrome HTML in `stardust/canon/header.html`
     or `footer.html`, compound CSS in `canon.css`, pinned token
     values, compositional moves) — affects every approved or
     migrated page (canon is universal once written).
   - Module catalog changes (a module added or removed; a
     module's `canonicalRendering` edited; a slot added,
     removed, or re-typed) — affects every page deploying that
     module.

   The trigger for delta computation is direction-edit by default,
   but applies identically when canon updates land via
   `prototype --prep` approval or when the module catalog updates
   via `extract --prep`, or when **approval fold-back** lands a
   site-wide direction addendum (per
   `skills/prototype/reference/approval-fold-back.md`). Stale-
   flagging is content-aware in all four cases. The fold-back
   case carries a special exemption: the **approved page that
   triggered the fold-back does NOT go stale** — its moves ARE
   the fold, so by definition the fold can't invalidate them.
   Page-local folds skip stale-flagging entirely (no other page
   is affected by construction).
2. For each page in `prototyped`, `approved`, or `migrated`:
   - Read its `<slug>-shape.md` (per
     `skills/prototype/reference/page-shape-brief.md`) to see
     which tokens, components, voice rules, and roles the
     deployment consumes.
   - If any consumed item appears in the delta, flag the page
     `stale: true` with `staleReason: "direction changed at
     <timestamp>; affected: <comma-separated list of changed
     items consumed by this page>"`.
   - If no consumed item appears, **do not** flag the page.
     The deployment is unaffected by the direction edit.
3. Pages that lack a `<slug>-shape.md` (legacy prototypes from
   before the site/page split landed) fall back to the blanket
   rule for safety — without a brief, the agent cannot determine
   which tokens/components/rules the deployment consumes.

The state itself does not change — the artifact on disk is still
valid; stale just means "may be out of step with the latest
direction." The user opts in to refresh:

- `$stardust prototype` with no args operates only on **non-stale**
  pages, plus shows a count of stale ones with a hint to use
  `$stardust prototype --all`. The hint includes the per-page
  `staleReason` so the user can decide which pages actually need
  work.
- `$stardust prototype --all` re-prototypes every directed page
  including stale ones.
- `$stardust prototype <slug>` always operates on the named page,
  stale or not.
- Same flags for `migrate`.

When a stale page is successfully re-prototyped or re-migrated,
clear its `stale` flag and append the new history entry. The brief
is updated only when the user's iteration phrase moves the
composition (per `prototype` Phase 1) — token-only changes
re-render the proposed file from the existing brief.

---

## State report (rendered by `$stardust` with no args)

```
stardust state
==============

Site:        https://example.com (extracted 2026-04-25, 25/38 pages)
Direction:   "make it more expressive for a young audience"
             (resolved 2026-04-25, see stardust/direction.md)

Pages
-----
  ✓ migrated   home, about, pricing
  ✓ approved   features, contact
  · prototyped blog, docs/index
    directed   docs/api, docs/guide
    extracted  (15 more)

Stale: 2 pages (home, about) — direction changed since they were migrated.
       Re-run with `$stardust migrate --all` to update.

Recommended next: $stardust prototype features
                  (5 directed pages waiting; closest to migration)
```

The recommended next step uses these heuristics, in order:

1. If no `extracted` data → recommend `$stardust extract`.
2. If extracted but no direction → recommend `$stardust direct`.
3. If stale pages exist and the user just changed direction →
   surface them but don't auto-recommend a refresh.
4. If `directed` pages exist → recommend `$stardust prototype`.
5. If `approved` pages exist that aren't migrated → recommend
   `$stardust migrate`.
6. Otherwise the redesign is complete; recommend a final
   `$impeccable critique` against `migrated/`.

---

## Provenance validation

Every downstream phase that reads per-page extracted JSON must
validate its `_provenance` block before doing any work. The check
is read-time defense-in-depth against the failure mode where
extract (or a sub-agent delegated to it) wrote a page record by
synthesizing from existing artifacts instead of running a live
Playwright render. Extract's own write-time refusal
(`current-state-schema.md` § Live-render evidence) is the
primary guard; the read-time validator catches mid-cascade
corruption, manual edits, partial re-runs, and recurrences of
the synthesis bug under different rationales.

### `validateProvenance(page)` — contract

Given a page entry and the path to its `current/pages/<slug>.json`,
the helper succeeds when every condition below holds and aborts
the calling phase otherwise:

| condition | rule |
|---|---|
| file exists | `current/pages/<slug>.json` resolves to a regular file |
| renderedBy | `_provenance.renderedBy === "playwright"` (string equality) |
| fetchedAt | parses as ISO 8601, not in the future, not before the project's earliest extract |
| waitMs | integer, strictly `> 0` |
| waitMode | matches `^(fast|medium|spec|networkidle|domcontentloaded)(\(fallback\))?$` |
| httpStatus | integer in `[200, 399]` (4xx/5xx pages should never have landed in `state.json` as `extracted` per `extract/reference/playwright-recipe.md` § Response validation; if one did, the validator surfaces it) |

When any condition fails, the calling phase aborts immediately
with a structured error naming the slug, the failed condition,
and the artifact path. Hint at the recovery command:
> Page `<slug>` lacks live-render evidence (`<failed condition>`).
> Re-extract with `$stardust extract --refresh <slug>`, or
> investigate the synthesis source if the page record was
> hand-edited.

### When each phase calls it

| phase | scope of validation |
|---|---|
| `direct --prep` | every page in the inventory before typing / module detection |
| `prototype` (any mode) | every page referenced by the variant being rendered |
| `prototype --prep` | every page-type representative slated for the archetype pass |
| `migrate` (any mode) | every page in the migrate target list |
| `prepare-migration` orchestrator | every claimed-extracted page at the start of Phase 1, **before** invoking `direct --prep` |

Discovery-mode `extract` does **not** call the validator on its
own outputs (it just wrote them); but extract Phase 6 must
include a **`live: yes/no` column** in its summary report so the
user can eyeball provenance coverage before the next phase runs.
A column of `live: yes` across every row is the visible signal
that the validator will pass downstream. See
`skills/extract/SKILL.md` § Phase 6 for the report format.

### Surfacing validation in reports

Each consumer phase prefixes its report with a one-liner:
> `Provenance OK on N pages.`

When validation fails, the failure replaces the report:
> `Provenance check failed on M of N pages — see error above. Phase aborted.`

The visible signal makes regression cheap to catch — a
maintainer running the cascade twice should see `Provenance OK`
twice; a quiet absence of that line is itself a smell.

---

## IA-fidelity and iaPriorities mutability

`direction.iaFidelity` stamps the value pinned at direct time (per
`stardust/reference/intent-dimensions.md` § 9): `verbatim` or
`reimagined`. The stamp gates:

- **Variant fork shape** at prototype (A1/A2/A3 under verbatim;
  A+B+C under reimagined; per `direct/SKILL.md` § Phase 2.6).
- **Per-page surprise budget ceiling** at prototype Phase 1
  (capped at `low` under verbatim; per
  `prototype/SKILL.md` § Brief-time disciplines / Discipline 3).
- **Approval fold-back at Phase 5** (no-op under verbatim by
  construction; runs under reimagined; per
  `prototype/reference/approval-fold-back.md`).
- **Discipline 10 convergence detector mode** (structural deltas
  required under reimagined; forbidden under verbatim).

The `direction.iaFidelity` value propagates to each
`DESIGN.json.extensions.iaPriorities[]` entry as a `mutability`
field: `locked` under verbatim (variants may not move the
priority), `movable` under reimagined (variants may demote /
promote / re-shape the priority's deployment).

Re-pinning `ia-fidelity` (via `direct --re-direct` with an
explicit phrase signal or the one-shot question) updates
`direction.iaFidelity` AND re-stamps every iaPriorities `mutability`
field. Stale-flagging follows the content-aware rule: pages whose
brief consumed the mutability field (e.g., a B/C variant brief
authored under reimagined that re-pins to verbatim invalidates the
brief's structural moves) are flagged stale.

## Fold-back state record

When `prototype` Phase 5 fold-back runs, the result is recorded
in two places:

1. **Direction addendum** in `stardust/direction.md` (per
   `prototype/reference/approval-fold-back.md`) — the human-
   readable record.
2. **Approved file `_provenance.foldBackDecision`** — the
   machine-readable per-file record: `{ choice: "site-wide" |
   "page-local" | "none", at, scope, rationale?, rejectedOptions?,
   staleFlagged? }`.

`state.json` itself does not gain a fold-back-specific field —
the page's `status: "approved"` history entry plus the file's
`_provenance.foldBackDecision` is the source of truth. Subsequent
prototype / migrate runs read the approved file's
`foldBackDecision` to know whether the page's structural moves
are site-wide (consumed by other pages too), page-local (this
page only), or unfolded (the moves stay file-local).

## Concurrency

Stardust does not own a long-running process. Every sub-command reads
`state.json` at start, writes once at end. If two sub-commands run
concurrently from different shells, last-write-wins. Document this in
the `extract` and `migrate` SKILL.md files; do not try to lock.

---

## Schema versioning

The schema version is implicit in `_provenance.stardustVersion`. If
stardust later changes the schema, write a one-shot migrator under
`skills/stardust/scripts/migrate-state.mjs` and call it from setup.
