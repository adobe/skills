# State machine

## When to read what

- § File: `stardust/state.json` — before reading or writing state: the full shape.
- § Hands-off keys · § Flow keys — when the run is hands-off or a migration flow was chosen: the markers every sub-command checks.
- § Page lifecycle states · § Page types — when moving a page between states or typing it for template reuse across siblings.
- § Stale flagging — when `direct` resolves a new direction: which pages actually go stale.
- § State report — when rendering the no-args status view.
- § Provenance validation — before any downstream phase consumes per-page JSON: the read-time synthesis guard.
- § IA-fidelity and iaPriorities mutability — when a later phase wants to change what `direct` pinned.
- § Fold-back state record — after prototype fold-back: where the decision is recorded.
- § Concurrency — when parallel writers touch `state.json`: the merge-by-slug contract.
- § Schema versioning — when the schema changes.

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
    "stardustVersion": "0.10.0"
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
  "flow": "redesign",
  "flowChosenAt": "<ISO timestamp>",
  "flowSource": "user-phrase",
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
that order. `_provenance` is always the first key. A hands-off run adds
one optional top-level key, `handsOff` (after `direction`; see
§ Hands-off keys). A migration project adds `flow`, `flowChosenAt`,
`flowSource` (after `direction` and `handsOff`, before `pages`; see
§ Flow keys).

---

## Hands-off keys

When the run was activated hands-off (`skills/stardust/SKILL.md`
§ Hands-off mode), two extra markers appear:

- Top-level `"handsOff": true` — stamped by the master skill at
  activation; every sub-command reads it to auto-resolve its
  interactive gates.
- On a page's `approved` history entry, `"approvedBy": "hands-off"` —
  the approval was granted by the agent's own judgment after all
  quality gates passed, not by the user. A later explicit user
  approval appends a new history entry (without the marker); it does
  not rewrite the hands-off one.

---

## Flow keys

A migration project records the flow it runs — the answer to the master
skill's first migration question (`skills/stardust/SKILL.md` § Two
migration flows) — so every sub-skill checks it instead of inferring it
from the ask:

- `"flow": "redesign" | "replica" | "reskin"`.
- `"flowChosenAt": "<ISO timestamp>"`.
- `"flowSource": "user-phrase" | "question" | "hands-off-default"` — a
  keep-design or redesign phrase in the ask, the one keep-vs-redesign
  question, or the hands-off rule (keep-design phrase → `replica`,
  otherwise `redesign`).

Stamped once, by whichever entry resolves the choice first: the master
skill when § Two migration flows resolves; `replica` Setup (`replica`),
`prepare-migration` Setup (`redesign`) and `reskin` Setup (`reskin`) when
invoked directly; `direct` when a zero-movement phrase hands off
(`replica`). Absent on redesign-only projects that never migrate (a bare
`extract` for audit or uplift): the keys mean "a migration flow was
chosen", not "this is a migration".

**Guards that read it.** `migrate`, `deploy`, `rollout` and (for migration
asks only) `extract` refuse to run a migration on a project that has
`state.json` but no `flow`: they print the two-flow table and hand back to
the master routing. `prepare-migration` refuses under `flow: replica`;
`replica` refuses under `flow: redesign`. Both print the never-mix line and
the one command that switches flows explicitly. `migrate` (sibling tier)
and `rollout` additionally require, under `flow: replica`, a gated
archetype per page type before siblings ship (`skills/rollout/SKILL.md`
§ Setup).

**Switching.** `$stardust replica --switch-flow` / `$stardust
prepare-migration --switch-flow` / `$stardust reskin --switch-flow` rewrite `flow` (+ `flowChosenAt`,
`flowSource: "question"`), append a `MODE SWITCH` entry to
`stardust/direction.md` naming the artefacts the old flow produced, and
mark every `prototyped` / `migrated` page stale (`staleReason:
"flow-switch"`, § Stale flagging) — nothing is deleted or re-run
automatically. A switch is the only way `flow` changes.

---

## Page lifecycle states

A page moves linearly through these states. It can be marked **stale**
at any non-terminal state when direction changes; `stale: true` does not
move the state, it flags it.

| State        | Meaning                                                                 | Set by                  |
|--------------|-------------------------------------------------------------------------|-------------------------|
| `extracted`  | Crawled and parsed. `current/pages/<slug>.json` exists.                 | `extract` |
| `directed`   | Direction `direction.md` resolved; this page is in scope of the direction. | `direct` |
| `prototyped` | A proposed-redesign prototype exists at `prototypes/<slug>-proposed.html`. | `prototype` |
| `approved`   | The user explicitly approved the prototype.                             | `prototype` |
| `migrated`   | Final redesigned static HTML written to `migrated/<slug>.html`.         | `migrate` |

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

Blocked on owner:  gh repo create <org>/sdt-<slug> --template adobe/aem-boilerplate --private
                   (since 2026-04-25T09:12Z · run continues author-only; `stardust/.work/ship.sh` carries the ship step)

Site:        https://example.com (extracted 2026-04-25, 25/38 pages)
Direction:   "make it more expressive for a young audience"
             (resolved 2026-04-25, see stardust/direction.md)
Flow:        redesign (chosen 2026-04-25 from the user's phrase)

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

Repo:  tracked 412 files / 31 MB under stardust/; not tracked 1,165 (captures, screenshots)
       state.json tracked ✓ · outside stardust/: none ✓ · secrets tracked: none ✓
       current/assets/ absent on this checkout → brand-review has no thumbnails;
       run `$stardust extract` before migrate/deploy.
```

The `Repo:` block is rendered only when the project is a git repo. Its
four facts come from `git ls-files` / `git check-ignore` and the master
skill's write boundary (SKILL.md § Artifacts): counts and size of tracked
files under `stardust/`; whether `stardust/state.json` is tracked (must
be, or say which ignore rule drops it); any tracked file outside
`stardust/`, the impeccable root files and the EDS project; any tracked
file matching a secret shape (`.env*`, `_storage-state.json`,
`*-clearance.json`). Then one line per consequence that applies on this
checkout (`current/assets/` missing, baselines missing). Above 50 MB of
tracked binaries under `stardust/`, add "consider Git LFS (optional)".

The `Blocked on owner:` block leads the report only while a
`status.jsonl` `blocked` line carrying `owner` has no later `end` line
for the same phase — one line per open command, verbatim from `owner`,
plus the timestamp and what continues meanwhile
(`reference/run-status.md`). Omitted otherwise.

When `stardust/decisions.md` exists, a `Decisions:` line follows `Flow:`
with the count of `default-applied` rows and, one per line, every
`owner-only-pending` row by id (`reference/decisions.md`).

The `Flow:` line is omitted when no flow key exists; on a migration ask
with no flow, the report ends with the two-flow table instead of a
recommendation (§ Flow keys). Under `flow: replica` the redesign heuristics
below do not apply: recommend from `stardust/replica/progress.json` — an
ungated archetype → `$stardust replica <archetype>`, all archetypes gated →
`$stardust migrate` / `rollout` — and print the last gate numbers per
archetype so a resumed session restarts without re-diagnosis.

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

Stardust does not own a long-running process, but sub-commands and
their sub-agents DO run in parallel. `state.json` writers follow a
**merge-by-slug** contract instead of blind overwrites:

1. **Re-read before write.** Immediately before writing, re-read
   `state.json` from disk and merge your changes into that fresh
   copy — never write from a snapshot taken at phase start.
2. **Merge per page / per key.** Page entries are independent (keyed
   by `slug`): a writer touches only the entries for pages it worked
   on and preserves every other entry verbatim. Top-level keys are
   owned by single phases (`site` → extract, `direction` → direct,
   `handsOff` → the master skill); a writer never rewrites a
   top-level key another phase owns.

Safe parallel lanes — all merge cleanly under this contract:

- **N pages may migrate concurrently.** Each writer merges only its
  own slugs' entries.
- **Sibling variants may prototype concurrently.** Distinct
  prototype/shape artifacts, distinct page entries.
- **Viewport captures batch in one Playwright session.** One browser,
  all viewports, per `extract/reference/playwright-recipe.md` — no
  session-per-viewport fan-out.
- **Extract captures pages concurrently.** Per-page
  `current/pages/<slug>.json` files are disjoint; the inventory
  update merges per slug.

**Same-slug concurrent runs remain last-write-wins** — two writers
racing on the SAME page entry are not merged; the later write wins.
When the pre-write re-read shows your page's entry changed underneath
you, surface a warning in the report naming the slug. Do not lock;
do not engineer around it.

---

## Schema versioning

The schema version is implicit in `_provenance.stardustVersion`. If
stardust later changes the schema, write a one-shot migrator
(`migrate-state.mjs`, under the stardust skill's `scripts/`) and call it
from setup.
