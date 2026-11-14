# rollout — design package

> **SUPERSEDED.** This folder is the historical design proposal for the
> `rollout` skill and is kept for context only. The skill has since shipped at
> `skills/rollout/` and has evolved well past this plan (delivery gates,
> verify scripts, runtime-contract detection, fidelity-tier coverage). The
> JSON Schemas are now maintained under `skills/rollout/schemas/` — the copies
> in this folder's `schemas/` are frozen at proposal time and should not be
> edited.

Proposal for **`rollout`**: a new skill that delivers a **whole redesigned site
to AEM Edge Delivery Services**. It is the full-site sibling of the existing
single-page `deploy`. This folder is the review deliverable; **no skill code is
written yet**.

## Contents

- **`PLAN.md`** — the design document. Start here.
- **`schemas/`** — JSON Schema (draft 2020-12) for every new file:
  - `rollout-config.schema.json` — `rollout.json` (target + DA config + run summary).
  - `rollout-pages.schema.json` — the per-page delivery ledger.
  - `rollout-templates.schema.json` — template grouping that drives block reuse.
  - `rollout-blocks.schema.json` — the block dedup unit + EDS mapping.
- **`examples/`** — `rollout-pages.example.json`, a worked delivery ledger.

## The shape (simplified design)

| Layer | Skill(s) | Status |
|---|---|---|
| Platform-agnostic redesign (page by page) | `extract` `direct` `prototype` `migrate` `uplift` | **unchanged** — no orchestrator wraps them |
| Single page → AEM | `deploy` | **unchanged** |
| **Whole site → AEM** | **`rollout`** | **new** |

Key decisions:

- `rollout` is **delivery-only**: it consumes the per-page agnostic outputs
  (`stardust/migrated/`) and delivers the whole site, calling `deploy` per page.
- It owns two capabilities: **coverage tracking** (pages / templates / blocks,
  delivery-scoped) and a **dashboard**. No audit/optimize subsystem for now.
- All `rollout` state lives under `stardust/rollout/`, so the agnostic core and
  its `state.json` are never touched.
- Block **dedup** (convert each distinct block once, reuse everywhere) is the
  core efficiency win and the reason blocks are a first-class tracking dimension.

## Open questions

See `PLAN.md` § 10 — block-dedup vs. the deploy black box, the template/type
source of truth, the fragment source, and cross-page parallel delivery.
