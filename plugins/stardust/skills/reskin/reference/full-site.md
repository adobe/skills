# Full site — inventory, page typing, delivery scope

A reskin migration covers the whole content site. Archetypes are the
means, not the delivery.

## Full-inventory check

Run it on resume, and again after Phase 1's crawl, before Phase 2.

The content crawl is always `--all`, the full junk-filtered inventory,
with `crawl.mjs --consent-overlays` when a cookie panel survives capture.
Extract's discovery cap (5; `crawl.mjs --max` 25) never applies to the
content site. Not `--prep`: that is `prepare-migration`'s cascade, and
reskin never runs `direct --prep` or `prepare-migration`. `--all`
scopes the content inventory only; the donor keeps its own cap
(`donor-sources.md` § 1).

The crawl is uncapped when `state.json.site.pageCap` is `0` or null and
`stardust/current/_crawl-log.json#discovery.cut[]` holds no `below cap`
row (so `site.crawled` + `crawl.failures[]` equals
`discovery.filteredCount`). Anything else — an earlier discovery-mode
extract, a `--cap` run, a 25-page `crawl.mjs` default — is a setup
error: re-crawl the content site with `--all` (Phase 1) before going
on. A failed page is retried or recorded, never dropped.

## Page typing

`--all` leaves `state.json.pages[].type` null (only `--prep` types).
Reskin types each page itself, before Phase 2: from a spec's
`archetypes.json` when present, else inferred from URL pattern and
content shape over the catalog in
`../../stardust/reference/state-machine.md` § Page types (the rule in
`../../extract/reference/prep-mode.md` § 2). One archetype per type is
the default `--pages` set; `migrate` groups siblings by this field.
Print the count per type with its archetype.

## Delivery scope

Once every archetype is gated (residuals logged), every page of the
Phase 1 inventory is migrated and shipped. Every non-archetype
inventory page renders at the **sibling tier** against its type's gated
archetype; a page whose type has no archetype gets one (Phases 2–5) or
the unique-render branch, never a skip. `rollout` runs over the full
migrated tree.

Archetypes-only delivery (`rollout` archetypes-only mode, the rest
`content-pending`) is an opt-out the user asks for in words. Record it
as `ledger.json#delivery = { scope: "archetypes-only", requestedBy:
"user", reason, at }` (default `scope: "full-site"`) and name it in the
handoff report.
