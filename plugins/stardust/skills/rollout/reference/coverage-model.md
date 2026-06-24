# rollout coverage model (operational reference)

The contract the two scripts maintain. Design rationale is in
`notes/rollout/PLAN.md`; this doc is the runtime behaviour.

## Files (all under `stardust/rollout/`)

| File | Writer | Contract |
|---|---|---|
| `rollout.json` | inventory + blocks + update-coverage + verify | target + DA config + `lastRun` counts |
| `coverage/pages.json` | inventory (rows) + update-coverage/verify (delivery) | one row per migrated page |
| `coverage/templates.json` | inventory + roll-up writers | pages grouped by `templateId` + roll-ups |
| `coverage/blocks.json` | blocks (rows) + update-coverage (delivery) | one row per **distinct** block (dedup unit) |
| `plan.json` | plan | dedup-driven delivery order + per-page convert/reuse |
| `optimize/findings.json` | optimize + findings + autofix | multi-source quality findings (detect→fix→verify) |
| `optimize/scorecard.json` | optimize + findings + autofix | per-layer health + overall + history |
| `site/{sitemap.xml,robots.txt,manifest.json}` | assemble | site-level artifacts |
| `dashboard/{index.html,data.json}` | dashboard | self-contained progress view + snapshot |

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
`plan.json.fragments` and delivered as static fragments.

## Verify

`verify.mjs` flips delivered pages to `verified` or `failed` based on: reachable
(HTTP 200 / file present), no `about:error` in the body, and every internal
`href="/…"` resolving to a known delivered path. Offline `--root <dir>` mode maps
each delivered path back to a file for testing against a local export.

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
