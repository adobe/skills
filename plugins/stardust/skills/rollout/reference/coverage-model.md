# rollout coverage model (operational reference)

The contract the two scripts maintain. Design rationale is in
`notes/rollout/PLAN.md`; this doc is the runtime behaviour.

## Files (all under `stardust/rollout/`)

| File | Writer | Contract |
|---|---|---|
| `rollout.json` | inventory + blocks + update-coverage + verify | target + DA config + `lastRun` counts |
| `coverage/pages.json` | inventory (rows) + update-coverage/verify (delivery) | one row per migrated page + one per typed row (chrome, fragment, index) |
| `coverage/templates.json` | inventory + roll-up writers | pages grouped by `templateId` + roll-ups |
| `coverage/blocks.json` | blocks (rows) + update-coverage (delivery) | one row per **distinct** block (dedup unit) |
| `plan.json` | plan | dedup-driven delivery order + per-page convert/reuse |
| `optimize/findings.json` | optimize + findings + autofix | multi-source quality findings (detect→fix→verify) |
| `optimize/scorecard.json` | optimize + findings + autofix | per-layer health + overall + history |
| `site/{sitemap.xml,robots.txt,manifest.json}` | assemble | site-level artifacts |
| `dashboard/{index.html,data.json}` | dashboard | self-contained progress view + snapshot |
| `verify/{summary.json,summary.md}` | verify | ranked class report, per-page rows per class below the table (`slug-<s>/` under `--slug`) |

`rollout.json` fields the scripts read: `site.liveHost` — stored as given, with
or without a scheme or trailing slash; every script normalises it on read
(`lib.mjs` `siteBase`, `--base` overrides). `links.outsideInventory: "fail" |
"warn"` — what an internal link to a path that is no coverage row does to the
page in verify (default `fail`).

`rollout` writes nothing outside this directory. `stardust/migrated/`,
`state.json`, and the rest of the agnostic core are read-only inputs.

## Page delivery status lifecycle

```
                                     ┌──── migrate emits page ────────────────────────┐
                                     ▼                                                 │
  content-pending ──► pending ──► converting ──► deployed ──► verified ──────────► stale
        ▲                ▲            │                                                │
        │                └─ inventory │                                                │
        │                   seeds new └──► failed ──(retry)──► converting …           │
        │                                                                              │
        └─ inventory seeds (archetypes-only mode, no migrated HTML yet)               │
                         stale/failed pages are re-picked by the next Phase B pass ◄──┘
```

- **content-pending** — inventoried from `state.json` in archetypes-only mode;
  no migrated HTML exists yet. Block code is live (deployed via the archetype);
  the document push is deferred to the content track. Advances automatically to
  `pending` when `migrate` emits the page's HTML and `inventory` is re-run. Not
  a failure — these pages are tracked, not lost.
- **pending** — inventoried with migrated HTML, not yet delivered. New pages start
  here (full mode) or transition here from `content-pending`.
- **converting** — `deploy` is mid-flight on this page.
- **deployed** — pushed to the branch preview; not yet verified.
- **verified** — renders live (200, blocks decorate, no `about:error`).
- **failed** — a delivery error; `error` carries the reason. Non-fatal to the run.
- **stale** — was deployed/verified, but `migrate` re-emitted the page (its
  `sourceHash` changed). Needs re-delivery.
- **Ledger reconcile** — `update-coverage --from-ledger <content/.deploy-ledger.json>`
  folds a `deploy-batch` run into the rows in one pass (replaces the per-page
  calls): ledger `live | previewed` → `deployed` only from `pending | converting |
  failed | stale` (`verified` is never downgraded, `content-pending` untouched);
  `*-fail` → `failed` with the ledger's `lastError`; any other ledger status is no
  verdict. The ledger path is matched to `path` | `deployedPath` (`/index` ≡ `/`);
  a match by source slug (`/about.jsp` ↔ `/about`) carries `deployedPath`; a
  ledger path with no row is listed, never invented. The ledger is read-only here.

## Artifact type + fidelity tier (orthogonal to status)

Two further per-page fields make delivery quality auditable; both are independent
of `delivery.status`:

- **`delivery.type`** — `page | fragment | index`. Drives what "renders
  correctly" means: a fragment has no `<h1>`, an index is JSON with rows.
  `inventory.mjs --content <eds-root>/content` seeds the typed rows (`nav*`,
  `footer*` → `/nav`, `/footer`, `/nav-<lang>`; `fragments/**` → `/fragments/<x>`;
  `**/*.json` → `/<x>.json`; slugs `chrome-<name>` / `fragment-<x>` /
  `index-<x>`); they are preserved across runs (a gone source flags
  `source.missing: true`, never drops the row), excluded from template
  roll-ups, and `assemble` lists only `page` rows with status `deployed |
  verified | stale` in the sitemap — a stale URL is still served until its
  re-delivery, so it stays listed; `failed` and undelivered rows do not. Scripts infer
  the type from the path when unset; a one-size `<h1>` check false-fails
  fragments without it.
- **`delivery.deployedPath`** — the path the row is served on when it differs
  from `path` (source-slug key, normalised target): written by
  `update-coverage --from-ledger` or seeded by `inventory --redirects
  stardust/redirects.tsv`. verify/optimize fetch it; assemble lists it; links to
  either form resolve.
- **Ledger reconcile** — `update-coverage.mjs --from-ledger` after a
  `deploy-batch.mjs` run; merge rules once, under § Page delivery status
  lifecycle (Ledger reconcile).
- **`delivery.gates.<name>`** — per-page gate results ingested from the
  instrument's own artifact by `update-coverage.mjs --gate <name> <json>` /
  `verify.mjs --ai-readability` (`ai-readability`: `{strict, code, unmeasured,
  min, origin, at}`; `editability`: `{authored, editable, dead, duplicated,
  exempt, unmeasured, exemptSource, origin, at}`). Below the bar → `failed`
  with the reason; `unmeasured: true` → status untouched (no verdict ≠ FAIL);
  roll-up `rollout.json.lastRun.gates.<name>`. `delivery-gates.md` § Gate 5 · § Gate 6.
- **`delivery.gate`** — the published-origin **page gate**, copied from
  `stardust/rollout/gate-report.json` by `gate-publish.mjs --report` or
  `verify.mjs --gate-report` (never typed): `{ status: pass | fail |
  published-failing | unmeasured | ungated | blocked, at, breakpoints{<bp>:
  {pixelPct, heightDelta, cropsOk, pass}}, report }`. Orthogonal to
  `delivery.status` except for one rule: under `flow: replica` verify flips a
  row to `verified` only when `gate.status === 'pass'`; a row that renders but
  has no PASS stays `deployed` (advisory class `published-origin gate: <status>`).
  `unmeasured` is an instrument state (exit 124 / 5 / 6, crops not run), never a
  FAIL; `ungated` = no published-origin record. Contract and the publish hold:
  `delivery-gates.md` § Gate 8.
- **`fidelityTier`** — `archetype | sibling | thin` (+ `archetypeSource`,
  `gatesPassed[]`), set by `migrate` from the render branch
  (`migrate/reference/fidelity-tiers.md`). Records *how much QA the page carries*:
  `archetype` is craft-gated once per template; `sibling` is a canon-fork that
  inherits that structure and re-checks only content + media + the delivery
  contract; `thin` is a bodyless/PDF page rendered gracefully.

The dashboard surfaces the **tier distribution** alongside status, so
"92/92 deployed" cannot hide "1 craft-gated, 91 ungated clones". Many
`unique`/`thin` pages where one template was expected signals a missing
archetype — prototype it, then re-fork its siblings.

## Idempotency rules (inventory)

On every `inventory.mjs` run:
- A page's `sourceHash` is recomputed from its migrated HTML bytes (migrated
  pages) or from `state.json[].currentStatePath` content (content-pending pages).
- If a page already exists in `pages.json`:
  - hash **unchanged** → its `delivery` is preserved verbatim.
  - hash **changed** and prior status ∈ {`deployed`,`verified`} → status becomes
    `stale` (delivered URL retained); otherwise the prior status is kept.
  - prior status was `content-pending` and migrated HTML now exists → status
    advances to `pending` and `sourceHash` is recomputed from the HTML bytes.
- A page **not** in prior coverage → seeded `content-pending` (if sourced from
  `state.json` only) or `pending` (if migrated HTML is present).
- Pages are keyed by `slug` (from the `_meta.json` sidecar, else derived from the
  delivered path, else from `state.json[].slug`). The `assets/` bundle is never
  inventoried.

## Block delivery status lifecycle

```
  pending ──► converted ──► deployed ──► verified
     ▲            (the distinct block is converted ONCE, on its
     └─ blocks.mjs  conversion point in plan.json; siblings reuse it)
```

- **pending** — inventoried as a distinct block, not yet converted.
- **converted** — its EDS block (`blocks/<edsBlockName>/`) or fragment exists.
- **deployed / verified** — live on the delivered site.

`blocks.mjs` is idempotent: a block already past `pending` keeps its status and
`edsBlockName`; only still-`pending` blocks get a freshly derived name.

## Dedup contract (plan.json)

`plan.mjs` guarantees each distinct **module** block is converted on exactly one
page (the first in delivery order that uses it). Per page it emits:
- `convert[]` — blocks introduced here → `deploy` creates them;
- `reuse[]` — blocks already converted → `deploy`'s Step-7 brief reuses them by
  `edsBlockName`, never recreating.

Chrome (`header`/`nav`/`footer`) is not per-page; it's listed once under
`plan.json.fragments` and delivered as the authored `/nav` + `/footer` documents
(published content, on the roster like any page).

## Verify

`verify.mjs` flips delivered rows to `verified` or `failed` based on: reachable
(HTTP 200 / file present), no `about:error` in the body, the typed render check
(one `<h1>` per page, JSON `data[]` per index), and its internal `href="/…"`
targets. Offline `--root <dir>` mode maps each path back to a file for testing
against a local export or the migrated tree.

- **Which rows.** Default: `deployed | verified`. `--all`: every *delivered*
  row (`deployed | verified | failed | stale`); rows never delivered (`pending`,
  `content-pending`, `converting`) have nothing to GET — they are counted on one
  line (`not delivered: N (skipped)`) and never written (a skipped row is no
  verdict, not a FAIL); `--include-undelivered` probes them anyway. Offline the
  tree is the artefact, so `--root --all` covers every row. `--slug` targets
  any row.
- **Summary lines** (each printed only when non-zero): `unverified: N page(s)
  throttled` (429/503 through the inline retry — ledger untouched, re-run);
  `not delivered: N (skipped)` — or `(probed — --include-undelivered)`;
  `pending-target links: N page(s)`; `outside-inventory links: N page(s)`
  (`warn` policy only).
- **Link classes.** Target is a coverage row that is delivered → ok. A coverage
  row not yet delivered → **pending-target**: the page stays `verified`,
  `delivery.pendingLinks` lists the targets, one summary line counts the pages.
  No coverage row → **outside-inventory**: `links.outsideInventory: fail`
  (default) fails the page; `warn` records `delivery.outsideLinks` and keeps it
  `verified`.
- **Exit.** 0 · 1 iff a row is `failed` (advisory classes never flip it) ·
  2 = usage (no `--base`/`--root`), coverage missing (run `inventory.mjs`
  first — the family precondition code, shared by `assemble`, `optimize`,
  `dashboard` and `update-coverage`; `redirects` alone keeps 1, its 2 being the
  shadow gate), or a page left `unverified` by throttling.
- **Report.** stdout = counts + the ranked class table, ≤ 60 lines
  (`../../stardust/reference/context-hygiene.md` § Runner reports), nothing per
  page unless `--verbose`. `--report <dir>` (default `verify/`; `verify/slug-<s>/`
  under `--slug`, so a spot re-check never overwrites the site-wide report)
  receives `summary.json` (`total, checked, verified, failed, skipped,
  undelivered, unverified, classes[{class, count, severity, worstExample,
  pointer}], pages[]` — one row per slug, `class` = its failure else its first
  advisory, `advisories[]` the rest) and `summary.md` (the same table, then a
  `### <class> (<count>)` section per class listing its pages — where every
  pointer leads). Triage per class from the table; the sections stay in the file.

## Optimize gate (findings lifecycle)

```
  open ──(no longer detected, in scope)──► fixed ──(regression)──► open
   │                                                                ▲
   ├──(human)──► accepted / wontfix  (never auto-reopened)          │
   └────────────────────── still detected ─────────────────────────┘
```

`optimize.mjs` is the delivery-quality gate. It writes `optimize/findings.json`
(append-only `runs[]` + status-tracked `findings[]`) and `optimize/scorecard.json`
(per-layer 0–100, `null` for unassessed judgment layers, + `history[]`). The gate
exits non-zero while any **open P1** is in scope; fixability routes the fix
(platform-migration → rollout re-deploys; design-pass → upstream; out-of-scope →
informational). See `checks.md` for the catalog.

## Roll-ups

`update-coverage.mjs`, `inventory.mjs`, `blocks.mjs`, and `verify.mjs` all
re-derive, from the per-unit rows:
- each template's `{ verified, deployed, pending }` in `templates.json`;
- the site-wide `lastRun.pages` + `lastRun.blocks` counts in `rollout.json`.

So the counts never drift from the per-unit truth — they are always recomputed,
never incremented.
