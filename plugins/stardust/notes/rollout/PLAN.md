# rollout — full-site migration to AEM (Edge Delivery Services)

> Design plan. Status: **proposal for review**. No skill code is written yet —
> this document plus the JSON schemas under `schemas/` are the deliverable.

## 0. What this is (and what changed)

`deploy` today converts **one page** to AEM. This proposal adds **`rollout`**:
the whole-site sibling that delivers an **entire** redesigned site to AEM Edge
Delivery Services.

This is a deliberately **simplified** design (it replaces an earlier proposal
that introduced a `site` orchestrator, an `optimize` audit subsystem, and a
depth-ladder campaign model). The simplifications, decided with the user:

- **The platform-agnostic core is unchanged.** `extract`, `direct`, `prototype`,
  `migrate`, `uplift` keep working exactly as they do today, **page by page**.
  There is **no orchestrator** wrapping them.
- **`deploy` is unchanged.** It stays the **single-page** → AEM converter.
- **One new skill, `rollout`,** owns the full-site concern, and it lives entirely
  in the **platform-specific** layer.
- **`rollout` is delivery-only.** It does **not** redesign. It consumes the
  per-page agnostic outputs that already exist and delivers the whole site.
- **`rollout` carries two capabilities:** delivery **coverage tracking** and a
  **dashboard**. (No audit/optimize subsystem for now.)

## 1. Where rollout sits

```
  ── platform-AGNOSTIC core (UNCHANGED, page by page) ──┐
   extract → direct → prototype → migrate               │  produces, per page:
   (uplift as presales entry)                           │    stardust/migrated/<slug>.html
                                                         │    stardust/migrated/<slug>._meta.json
                                                         │    stardust/canon/  (block/module defs)
                                                         ▼
  ── platform-SPECIFIC (AEM-EDS) ──────────────────────────────────────────────
   deploy   : ONE page  → AEM        (UNCHANGED)
   rollout  : WHOLE site → AEM       (NEW)  — calls deploy per page, adds the
              across-pages layer: block dedup, fragments/sitemap, coverage, dashboard,
              full-site verify.
```

`rollout` : `deploy` :: "deliver the whole site" : "deliver one page". Same
methodology, scaled and coordinated, plus the tracking the user asked for.

## 2. Skill map

| Skill | Status | Role |
|---|---|---|
| `extract` `direct` `prototype` `migrate` `uplift` | **unchanged** | Agnostic redesign, page by page. Produce `migrated/` HTML + `_meta.json` + `canon/`. |
| `deploy` | **unchanged** | Single page → AEM-EDS (section→block conversion, fragments, DA Source API push). |
| **`rollout`** | **new** | Full-site delivery to AEM-EDS. Inventories the migrated outputs, dedups blocks, calls `deploy` per page, assembles site-level artifacts, verifies, and tracks coverage + renders a dashboard. |

> `rollout` **uses** `deploy` as a black box; it never modifies it. Everything
> `rollout` adds is *around* `deploy`, not *inside* it.

## 3. What `rollout` does (the pipeline)

A single `stardust:rollout` run is resumable and idempotent — it only acts on
work that is pending or stale.

1. **Inventory.** Scan `stardust/migrated/*.html` + `*._meta.json` + `canon/` to
   build/refresh the delivery coverage: every page, the template it uses, and
   the blocks it composes. Each page records the **source hash** of its migrated
   HTML so re-runs can detect what changed.
2. **Block conversion (dedup).** Identify the **distinct** blocks across the
   site and convert each **once** to an EDS block, recording the canonical
   `edsBlockName` in `blocks.json`. This is the core efficiency win of doing the
   site as a unit rather than page-by-page: 134 pages that share 19 blocks
   convert 19 blocks, not 134. (Mechanism + the deploy-black-box caveat: § 4.)
3. **Page delivery.** For each page that is pending or stale, invoke `deploy`,
   reusing the already-converted blocks, and push via the DA Source API. Record
   `pages[].delivery` (`pending → converting → deployed → verified`) +
   `deployedUrl`.
4. **Site-level assembly.** The artifacts that only make sense for the whole
   site: shared **fragments** (header / nav / footer), **sitemap.xml**, robots,
   per-page metadata, and self-canonical links. (Platform delivery mechanics —
   not content audit.)
5. **Verify.** Full-site verification: every page returns 200, internal links
   resolve, blocks render. Mark verified pages and surface failures.
6. **Report + dashboard.** Recompute counts, list what's still missing, and
   regenerate the dashboard.

## 4. `rollout` ↔ `deploy` (without changing deploy)

`rollout` treats `deploy` as a single-page black box and adds the across-pages
layer on top:

- **Drive order for dedup.** `rollout` delivers a **representative page per
  template first**; that establishes the EDS block library. Sibling pages of the
  same template then reuse those blocks.
- **Reconciliation.** Because `deploy` is unchanged and converts each page
  independently, `rollout` **reconciles** the emitted block library after the
  fact: identical blocks (matched by the canon/section signature captured at
  inventory) are collapsed to one canonical `edsBlockName`, and `blocks.json`
  records the mapping. This keeps dedup a `rollout` responsibility and leaves
  `deploy` untouched.
- **Idempotency.** A page whose migrated `sourceHash` is unchanged and whose
  `delivery.status == verified` is skipped on re-run. Re-redesign a page upstream
  → its hash changes → `rollout` marks it `stale` and re-delivers just that page.

> Open question (§ 10): exact, zero-redundancy dedup would be cleaner if `deploy`
> accepted an optional block-name map. That's a *small, later, optional* change
> to `deploy` — deliberately out of scope now to honour "don't change deploy".

## 5. Coverage model (delivery-scoped)

All `rollout` state lives under `stardust/rollout/`, so **nothing in the agnostic
core or its files changes** (no `state.json` edits):

```
stardust/
├── …                                  # agnostic outputs, UNCHANGED
│   ├── migrated/<slug>.html            #   rollout INPUT (read-only)
│   ├── migrated/<slug>._meta.json      #   rollout INPUT (read-only)
│   └── canon/                          #   rollout INPUT (read-only)  block/module defs
└── rollout/                            # NEW — all platform/full-site state
    ├── rollout.json                    #   target + DA config + run summary   (schema: rollout-config)
    ├── coverage/
    │   ├── pages.json                  #   delivery ledger per page           (schema: rollout-pages)
    │   ├── templates.json              #   grouping for block reuse           (schema: rollout-templates)
    │   └── blocks.json                 #   the dedup unit + EDS mapping        (schema: rollout-blocks)
    └── dashboard/
        ├── index.html                  #   self-contained delivery dashboard
        └── data.json                   #   the snapshot the HTML renders
```

The three coverage dimensions, now scoped purely to **delivery**:

- **pages** — every migrated page, its template, its `sourceHash`, and its
  delivery status + `deployedUrl`. Answers "how many delivered / how many left".
- **templates** — the grouping that drives block reuse: which pages share a
  structure, and which blocks that structure composes. Derived from `_meta.json`
  / `canon`; used to order delivery (representative first) and to roll up
  per-template delivery progress.
- **blocks** — the **dedup unit**. Each distinct block, the templates/pages that
  use it, its instance count, and its EDS mapping (`edsBlockName`, `blockPath`,
  delivery status). This is what makes "convert once, reuse everywhere" trackable.

## 6. Dashboard

`stardust/rollout/dashboard/index.html` — **self-contained, no external JS**, in
the captured brand's styling. Panels:

1. **Headline counts** — pages / templates / blocks totals + delivered vs.
   remaining.
2. **Delivery matrix** — pages by status (pending / converting / deployed /
   verified / failed); per-template delivery %; block conversion grid.
3. **What's missing** — the explicit list of undelivered or stale pages and
   unconverted blocks.

`dashboard/data.json` is the inspectable snapshot the HTML renders. `rollout`
regenerates it at the end of every run.

## 7. Counts & "what's missing" report

Printed at the end of a run (and rendered on the dashboard):

```
rollout — example.com → aem-eds
=====================================================================
Pages       134 total   ·  120 verified   ·  6 deployed (unverified)   ·  8 pending
            → 8 pages still to deliver · 2 stale (re-migrated upstream)
Templates     7 total   ·  delivery 112/134 pages verified
Blocks       19 total   ·  17 converted to EDS   ·  2 pending
            → pricing-table, comparison-grid not yet converted
Verify      3 link failures on /resources/* (see report)
```

## 8. Phasing (build order)

> **Design commitment (recorded for later phases).** Block **dedup** and
> **optimize** are not afterthoughts — both must become **first-class steps in
> the rollout flow**, not post-hoc reconciliation or an optional side-audit:
> - **Block dedup** should drive conversion *up front* (decide the distinct
>   block set and canonical EDS names before/at conversion, so each block is
>   converted exactly once), rather than the reconcile-after-the-fact stopgap
>   described in § 4. Achieving this cleanly may require the small optional
>   `deploy` block-name-map input noted in § 10.1.
> - **optimize** (the detect → fix → verify audit) should run *inside* the
>   rollout flow as a gate on delivery quality, not bolted on after.
> These are deferred to a future phase but are committed design intent; P1 is
> built so they slot in without rework.

- **P1 — Inventory + delivery loop.** Build `rollout/coverage/*` from the
  migrated outputs; deliver the site by calling `deploy` per page; track
  `pages.delivery`. Deliverable: a whole site pushed to AEM with live coverage.
- **P2 — Block dedup (first-class) + site assembly + verify.** Dedup-driven
  conversion + `blocks.json`; fragments/sitemap; full-site verification + stale
  re-delivery. Deliverable: efficient, coherent, re-runnable full-site rollout.
- **P3 — optimize in the flow (multi-source audit + AEM autofix).** optimize is
  an **aggregator** over existing audit skills, not a bespoke audit: a built-in
  deterministic `rollout:baseline` source plus `impeccable:critique`/`audit`, the
  marketing SEO skills (`seo-audit`, `schema`, `ai-seo`, `site-architecture`), and
  `stardust:tensions` — all normalized into one findings ledger (with `source`
  provenance) + scorecard, gated on open P1. A platform **autofix engine**
  (AEM-EDS first, aggressive incl. content) resolves the platform-fixable findings
  by editing the EDS project, then a re-`deploy` + re-`optimize` closes the loop.
  Sources are **referenced as dependencies**, not vendored. See
  `skills/rollout/reference/audit-sources.md`. Deliverable: an in-flow quality
  gate sourced from real audits, with hands-off AEM autofix.
- **P4 — Dashboard.** The self-contained, no-external-JS dashboard
  (`dashboard.mjs`), rendered in the **project's design identity** (brand tokens
  from the migrated `:root`). Centerpiece: a **lifecycle-coloured page tree**
  (identified → prototyped → deployed → optimised, spanning `state.json` +
  coverage + optimize). Node colour = most-advanced stage reached; legend counts
  are cumulative (identified = all pages). Template archetypes badged; plus a
  templates lifecycle table and the quality scorecard. `dashboard/data.json` is
  the inspectable snapshot. Deliverable: at-a-glance lifecycle + quality status.

**Status: P1–P4 implemented.** The flow runs end-to-end (inventory → dedup plan →
deliver → assemble → verify → multi-source optimize → AEM autofix → dashboard),
tested against fixtures. Live runs against a real AEM/DA target + the external
audit skills are the remaining validation.

## 9. Reference map

- Built on the existing `skills/deploy/SKILL.md` methodology (section→EDS block,
  fragments, DA Source API, archetype-cluster parallelism) — `rollout` scales and
  coordinates it without changing it.
- Inputs are the unchanged agnostic outputs: `skills/migrate/SKILL.md`
  (`migrated/` + `_meta.json`), `skills/stardust/reference/artifact-map.md`
  (file ownership), `canon/`.
- Schemas accompanying this plan: `schemas/rollout-*.schema.json`; worked
  example: `examples/rollout-pages.example.json`.

## 10. Open questions for the next review

1. **Exact block dedup vs. deploy black box.** Accept post-hoc reconciliation
   (this plan), or later add a small optional block-name-map input to `deploy`
   for zero-redundancy conversion?
2. **Template/type source.** Where does `rollout` read the template a page
   belongs to — from `_meta.json`, from a `canon` index, or inferred from shared
   block signatures? (The schema allows any; confirm the source of truth.)
3. **Fragment source.** Where do header/nav/footer come from for shared
   fragments — the chrome captured in `canon`, or the first delivered page?
4. **Cross-page parallel delivery.** Rely on `deploy`'s in-page parallelism only,
   or have `rollout` deliver multiple pages concurrently (and if so, how light
   can the coordination be)?
```
