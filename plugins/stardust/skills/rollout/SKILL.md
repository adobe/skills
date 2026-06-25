---
name: rollout
description: Deliver a WHOLE redesigned site to AEM Edge Delivery Services. The full-site sibling of `deploy` (which converts one page). Inventories the platform-agnostic migrated tree (stardust/migrated/ + _meta.json sidecars) into a delivery coverage ledger, then delivers each page by invoking the `deploy` methodology, tracking what is done and what is missing across the whole site. Use when the user has a migrated stardust site and wants to push the entire site to AEM, not just one page. Supports archetypes-only mode: if only the template archetype pages have been migrated, rollout can deploy all block code immediately and register the remaining pages as content-pending for later population.
license: Apache-2.0
---

# stardust:rollout — whole site → AEM (Edge Delivery Services)

`deploy` converts **one** page to AEM. `rollout` delivers the **whole site**: it
inventories the agnostic output of `migrate`, then drives `deploy` across every
page, tracking delivery coverage so you always know what's done and what's left.

`rollout` is **delivery-only** — it does not redesign. The page-by-page redesign
(`extract → direct → prototype → migrate`) and `deploy` itself are **unchanged**;
`rollout` is the across-pages layer on top. The full design rationale, the
coverage model, and the phasing are in
[`notes/rollout/PLAN.md`](../../notes/rollout/PLAN.md).

> **The full flow is built**: inventory + page coverage (P1); first-class block
> dedup + site assembly + verify (P2); multi-source optimize + AEM autofix (P3);
> and the dashboard (P4). The flow runs **A→I** below.

## When to use

**Full mode** — the user has:
1. A fully migrated stardust site at `stardust/migrated/` (the output of
   `stardust migrate`: per-page HTML + `_meta.json` sidecars). This is the
   explicit handoff `migrate` documents for downstream AEM conversion.
2. An EDS/AEM project + DA destination (the same target `deploy` needs — see
   `skills/deploy/SKILL.md` and `da-deploy-protocol.md`).
3. A goal to deliver the **entire** site, incrementally and resumably.

**Archetypes-only mode** — the user has:
1. One migrated archetype page per template in `stardust/migrated/` (the
   representative pages, not every sibling), plus a full page inventory in
   `stardust/state.json` with `type` assignments for all pages.
2. The same EDS/AEM project + DA destination as above.
3. A goal to ship all block code immediately without waiting for every page to
   be individually migrated. Sibling pages are registered as `content-pending`
   in the coverage ledger; their document content is populated later through a
   separate content track.

If there is no `stardust/migrated/` tree at all, recommend `stardust migrate`
on at least the archetype pages first. For a single page, use `stardust deploy`
directly — `rollout` is for the whole site.

## Setup

1. Run the master skill's setup (`skills/stardust/SKILL.md` § Setup).
2. Verify `stardust/migrated/` exists and contains at least one `*.html` page.
   If not, recommend `stardust migrate` on the template archetypes and stop.
   - **Full mode**: `migrated/` covers all pages in scope.
   - **Archetypes-only mode**: `migrated/` covers only the archetype pages (one
     per template). Verify `stardust/state.json` exists and has `type` populated
     for all pages whose siblings need coverage. If `state.json` is absent or
     lacks `type` assignments, recommend resolving those before proceeding.
3. Verify the EDS/AEM target is ready exactly as `deploy` requires (project
   scaffolding, `DA_TOKEN`, code branch pushable). `rollout` adds no new transport
   — it reuses `deploy`'s.

## Procedure

### Phase A — Inventory (build the coverage)

Run the inventory script to project the migrated tree into the delivery coverage:

```bash
node skills/rollout/scripts/inventory.mjs --site-url <source-url>
# defaults: --migrated stardust/migrated  --out stardust/rollout

# archetypes-only mode: supplement migrated/ with the full page roster from state.json
node skills/rollout/scripts/inventory.mjs --site-url <source-url> --state stardust/state.json
```

It writes:
- `stardust/rollout/coverage/pages.json` — one row per page: slug, delivered
  `path`, `templateId` (from the sidecar `template`/`type`), the `blocks` it
  composes (from the sidecar `modules`), a `sourceHash`, and the per-page
  `delivery` status.
- `stardust/rollout/coverage/templates.json` — pages grouped by template (drives
  delivery order and per-template roll-ups).
- `stardust/rollout/rollout.json` — target + DA config + a `lastRun` counts
  summary.

**Archetypes-only mode** (triggered by `--state`): inventory reads `state.json`
for the full page roster and merges it with `migrated/`:
- Pages with a `_meta.json` in `migrated/` are seeded from their sidecar
  exactly as in full mode.
- Pages present only in `state.json` (not yet individually migrated) are seeded
  with `templateId` inferred from their `type` field and `blocks` inferred from
  the archetype sidecar for that template. Their `sourceHash` is derived from
  `state.json[].currentStatePath` content. Their initial `delivery.status` is
  `content-pending`.

The inventory is **idempotent and incremental**: existing delivery status is
preserved; a page whose migrated HTML changed after it was delivered is
re-flagged `stale`. Re-run it any time `migrate` re-emits pages or `state.json`
adds new pages.

Fill in the DA coordinates in `stardust/rollout/rollout.json` (`site.da.org`,
`site.site`, `site.da.ref`, and `site.liveHost`) if the inventory didn't infer
them — `deploy` needs them for the push and `verify` needs the host.

### Phase B — Block dedup plan (FIRST-CLASS, before any conversion)

Derive the distinct block set and the dedup-driven delivery plan **up front** —
this is what makes "convert each block once" a driving step, not a cleanup:

```bash
node skills/rollout/scripts/blocks.mjs   # → coverage/blocks.json (the dedup unit)
node skills/rollout/scripts/plan.mjs     # → plan.json + a readable conversion plan
```

- `blocks.mjs` collapses every block instance across the site (the per-page
  `modules` + chrome) into the **distinct** set, assigns each a canonical
  `edsBlockName` (kebab; reserved-class-guarded per deploy #15), and records
  `usedByPages` / `instanceCount`. Chrome (`header`/`nav`/`footer`) is marked
  `kind: chrome` → delivered as site-wide fragments, not per-page blocks. In
  archetypes-only mode the distinct block set is fully determined by the archetype
  sidecars alone — `content-pending` sibling pages add no new blocks.
- `plan.mjs` orders pages **representative-first per template**, walks them once,
  and assigns each distinct block a **single conversion point**: the first page
  in order that uses it CONVERTS it; every later page REUSES it by name. The
  per-page `convert` / `reuse` lists are exactly `deploy`'s Step-7 brief input
  (*"Existing blocks — REUSE, do not recreate: …"*), so each block converts once
  **without changing deploy**. `content-pending` pages are always assigned
  `convert: []` / `reuse: [all template blocks]` — they never introduce new blocks.

### Phase B2 — Dynamic-blocks map + metadata contract (PRE-IMPORT GATE)

**Do this before Phase C — the import is blocked on it.** What a dynamic listing
block can show is bounded by what each page emits, and an index row can carry only
page-intrinsic DOM **or** authored metadata (see Phase D2 for the full mechanics).
So the metadata a block will need must be decided **before** the batch import —
emitting it per page at write time is one extra field; retrofitting it across
thousands of already-imported, already-published pages is a second migration.

Produce two artifacts now:

1. **`dynamic-blocks-map.md`** — classify every listing-candidate block: dynamic
   (index-driven) vs static (editorial curation), and for each dynamic one, the
   index it reads and the fields its cards need.
2. **The metadata contract** — the concrete `<meta name="…">` fields each content
   TYPE must carry for its dynamic blocks to work (e.g. clinic →
   `canton`/`city`/`address`/`phone`; news → `publishdate`/`category`; event →
   `eventdate`/`clinic`/`location`). Fields already intrinsic to the DOM (title,
   image, authored cross-links) need NO metadata — only what the DOM lacks.

**Then make Phase C's `deploy` brief emit the contract**: each authoring agent adds
the type's metadata rows to every page's metadata block as it writes it. Author
`helix-query.yaml` (Phase D2) from the same contract so selectors and emitted names
line up. A block whose contract can't be met from the source (a relationship like
center↔disease) stays static — record that in the map, don't fake it.

**Metadata key → meta-name mechanics.** A metadata-block row `<div><div>KEY</div>
<div>VALUE</div></div>` renders to `<meta name="<key lowercased>">`. Use
single-token capitalized keys (`PublishDate`→`name="publishdate"`,
`Canton`→`name="canton"`) and make `helix-query.yaml`'s `select:
meta[name="publishdate"]` match. Emit dates as ISO `YYYY-MM-DD` (sortable). Emitting
the contract during authoring is one row per page; retrofitting it across an
already-imported, already-published batch is a full extra pass + republish — which
is the whole reason B2 is a gate.

### Phase C — Deliver the site (drive `deploy` per page, per the plan)

**Blocked on Phase B2** — author each page's metadata contract (above) into its
metadata block during delivery, so the indexes are rich at import time.

Walk `plan.json.steps` in order (representative pages first). For each page:

1. **Convert + push** the page's migrated HTML (`source.migratedHtml`) to AEM via
   the `deploy` methodology (`skills/deploy/SKILL.md`). **Pass the page's plan
   step into deploy's brief**: create only the blocks in `convert`; for every
   block in `reuse`, instruct deploy to REUSE the existing block by its
   `edsBlockName` (do not recreate). This is the dedup contract in action.

   **`content-pending` pages** (archetypes-only mode): these pages have no
   migrated HTML. Skip the document push entirely — do not create a shell or
   placeholder document. Record them as `content-pending` in the coverage ledger
   and surface them in the report as "awaiting content track." Block code for
   these pages is already deployed via their template's archetype; no conversion
   work remains.

2. **Source-fidelity gate — "don't add sections the source doesn't have."**
   Before flipping a page to `deployed`, confirm every authored section maps to a
   real region on the *source* page. A migration reproduces the source; it must
   not invent sections — and the failure is silent, because invented sections
   render as empty placeholders or, worse, get back-filled with fabricated facts.
   This recurs as trailing **cross-link rails** (`related-*`, `*-teasers`),
   **specialist/teaser grids**, and generic **trailing CTAs** appended to every
   leaf page regardless of source.

   ```bash
   node skills/rollout/scripts/section-fidelity.mjs \
     --file <content.html> --source <sourceUrl>   # lays authored vs source side-by-side
   ```

   The helper is a scaffold, not a judge: it lists the authored block sections
   (pre-flagging known filler shapes as `⟵ REVIEW`) against the source's heading
   outline. For each authored section — especially flagged ones — decide:
   - **HARD-FAIL → remove before `deployed`:** the section carries FABRICATED
     facts (invented person names, made-up events/dates, boilerplate prose not on
     the source). Fabricated content on a real site is the worst migration defect.
   - **Soft call:** an invented rail whose links all point to REAL pages — prefer
     remove (honor the rule); keep only as a plain text link-row if cross-linking
     is explicitly wanted, never as an image-card grid that needs assets to exist.
   - **Pass:** the section backs a real source region.

   Delete the section from the content file (and `git rm` the block if it becomes
   orphaned — no other page references it). Genuinely-missing *real* content is a
   different case: leave the block, render gracefully (no placeholder void), and
   log it as a content gap — do NOT invent filler to fill it.

3. **Image-fidelity gate — every authored `<img>` src must RESOLVE, or be omitted.**
   This is the #1 recurring defect at scale: an authored external image URL that
   the preview ingester can't fetch delivers as `<img src="about:error">` — a
   silent break that "it renders" hides. Before deploy, for EACH authored `<img>`
   whose src is an external/source URL, verify it returns 200
   (`curl -s -o /dev/null -w '%{http_code}' <url>`); if it doesn't, OMIT the image
   (the block renders without it) rather than ship `about:error`. Never author a
   logo/placeholder stand-in (`…hirslanden-logo…`) as if it were editorial.
   Two failure signatures seen on real sites — fix the URL, don't drop the image,
   when the asset truly exists behind a malformed URL:
   - **Wrong rendition variant** — the source page exposes only a derivative that
     404s (e.g. a doctor portrait's `…/4x3/768/…` 404s; the `…/original/768/…`
     sibling resolves). Rewrite to the resolving variant.
   - **Missing query delimiter** — a CDN URL built as `…/<id>&wid=600&hei=…`
     (no `?`) makes the whole `<id>&wid=…` a bogus asset id → 403. Repair the
     first `&` after the id to `?` (`…/<id>?wid=600&hei=…`).
   After preview, the authoritative check is `.plain.html`: 0 `about:error` and
   the expected `<img>`+alt count (CSS-background images are absent from it).

4. **Path-safety gate — source paths must be AEM-Edge-safe, or normalized + redirected.**
   Real source URLs are not always valid EDS resource paths; DA accepts the `PUT`
   (`201`) but the preview/serve then 404s/400s, so this is invisible until verify.
   Before deploy, normalize each path and, when it changes, record the original→
   normalized pair so the source URL can be redirected (a final-migration must not
   404 inbound links). Rules: lowercase the whole path; trim a trailing `-`/`_` in
   any segment; collapse `_`→`-` and runs of `-`; replace the `--` segment
   delimiter (e.g. `klinik-st--anna`) — AEM reserves `--` as the
   `branch--repo--owner` host delimiter, so a `--` in a path 400s. Append each
   change to `stardust/redirects.tsv` (`source<TAB>destination`); wiring those into
   the EDS redirects config is a Phase D/assembly step.

5. **Record outcomes** with the state-writer (never hand-edit the ledger):

   ```bash
   node skills/rollout/scripts/update-coverage.mjs <slug> --status converting
   # for each block this page converts:
   node skills/rollout/scripts/update-coverage.mjs --block <id> --status converted --eds-name <name>
   # … run the deploy steps …
   node skills/rollout/scripts/update-coverage.mjs <slug> --status deployed --url <branch-preview-url>
   # for content-pending pages (no document push):
   node skills/rollout/scripts/update-coverage.mjs <slug> --status content-pending
   ```

   **Publish in the loop (`PUT → preview → live`), don't stop at preview.** If the
   site has any query-index block (Phase D2), the index builds from the **live**
   tree — a preview-only delivery leaves every index empty. Make `POST /live/…` a
   per-page step of the delivery loop, not a deferred batch, so indexes populate as
   pages land. (Indexing is async; the index `total` settles a little after the
   publishes.)

   On failure: `--status failed --error "<reason>"` and continue (one page's
   failure never aborts the rollout — mirrors `migrate`).

Parallelism: deliver multiple template clusters concurrently (one agent per
cluster, non-overlapping page sets), as `deploy` Step 7 dispatches per-archetype
agents. **Deliver each template's representative — the page that converts that
template's blocks — before its siblings**, so the blocks exist to be reused. The
state-writer is per-unit so concurrent updates don't collide.

**Batched delivery at scale (clusters of 6–20+ siblings).** Proven flow for a
large content track — separate the concerns so an agent crash or a token blowout
can't corrupt state, and so the gates above run uniformly:
- **Author-only agents, central deploy.** Each cluster agent reads its work-list
  + the cleaned archetype template and *only writes content files* — it does NOT
  deploy. The orchestrator deploys centrally (one idempotent `PUT`+preview loop),
  which keeps the token in one place, makes retries trivial, and survives a
  sub-agent dying mid-response (its files are already on disk).
- **Validate structure BEFORE deploy.** Cheap deterministic check on every
  authored file — exactly one `<h1>`, the body/`<main>`/`<footer>` wrapper,
  balanced `<div>`s — catches a truncated/garbled file (e.g. from an agent that
  crashed) before it reaches DA.
- **Verify-THEN-flip, never flip blind.** Only flip a page to `deployed` after
  its rendered `.plain.html` passes (HTTP 200, 0 `about:error`, `<h1>` present).
  The verify pass is where the image- and path-fidelity defects above actually
  surface at scale — 4-page samples won't show them; a 130-page batch will.
- **Long batches run in the background** (a 130-page `PUT`+preview loop far
  exceeds a 2-min foreground budget); log per-page OK/FAIL and re-drive only the
  FAILs. Transient `PUT=000` → retry; `PUT=201 PRE=4xx/400` → a path-safety case
  (gate 4); `200 + about:error` → an image case (gate 3).
- **zsh gotcha:** `node`/`curl` inside a multi-line `while`/`for` can lose PATH
  ("command not found") — write the loop to a `bash` script file with absolute
  binaries and run it, rather than inlining.

### Phase D — Site assembly (whole-site artifacts)

```bash
node skills/rollout/scripts/assemble.mjs   # → rollout/site/{sitemap.xml,robots.txt,manifest.json}
```

Generates the artifacts that only make sense site-wide: `sitemap.xml` +
`robots.txt` from the delivered paths, and a **fragments manifest** mapping the
chrome blocks to `fragments/header.html` / `fragments/footer.html` with their
`canon/*.html` source. `deploy` lifts and pushes the actual fragment content
(Step 6); `assemble` prepares and records what to push.

**Redirects.** If Phase C's path-safety gate (#4) emitted `stardust/redirects.tsv`
(original source path → normalized EDS path), wire it into the site's EDS
redirects mechanism here so the original inbound URLs don't 404 — a final
migration must preserve link/SEO continuity. (DA also holds orphan content at the
pre-normalization paths from the accepted `PUT`s; harmless since they never
preview-serve, but clean them up if you want the DA tree to match the live tree.)

### Phase D2 — Dynamic listings (query-index)

Most sites have blocks that LIST other pages (doctor directories, news/event
feeds, clinic grids, "related" rails). Statically authoring those cards doesn't
scale and goes stale — they should read an EDS **query-index** (a published JSON
of pages with per-page properties). The map + metadata contract are decided in the
**Phase B2 pre-import gate**; this phase covers the mechanics of building the index
and wiring the blocks. What the blocks can list is bounded by what the import
emitted — which is why B2 comes first.

**A query-index row can carry only:**
1. **Page-intrinsic DOM** — `h1`, `og:image`, and links the content already
   authored. Extract via CSS selectors in `helix-query.yaml`
   (e.g. a doctor's specialty/clinic from `a[href*="/fachgebiete/"]` /
   `a[href*="/home"]`). **Zero content change.** Author meaningful internal links
   in content and they become free index facets.
2. **Page metadata** — anything NOT in the DOM (article/event date, clinic
   canton/address/phone) must be emitted as `<meta name="…">` via each page's
   metadata block. → **Define a metadata contract per content type up front and
   have Phase C emit it.** Retrofitting metadata across thousands of live pages
   later is the expensive path.
3. **NOT relationships.** A flat index can't express many-to-many
   (centers↔disease, clinic↔specialty). Those need an explicit join field
   (`treats:`/`topics:` slug list) in metadata on one side — and the related items
   must themselves BE indexed pages (a block whose cards link only to `tel:` has
   nothing to fetch). Without that, keep the block static; don't fake it.

**The publish gotcha (cost a debugging cycle):** the query-index builds against the
**PUBLISHED (live)** tree, not preview. A preview-only rollout has an EMPTY index —
`query-index.json` 404s and `POST /index/…` returns `"requested path returned a 301
or 404"` per index (that message == "page not published," not "bad selector").
**Publish pages (`POST /live/…`) before expecting index rows.** Indexing is async:
bulk-publish, then poll the index `total` until it settles.

**Also localize internal links.** Migrated content often keeps absolute
source-site URLs (`https://www.source.com/…`); the index then captures those as
paths and on-site nav breaks. Rewrite internal links to delivered local paths
(a Phase C / deploy concern) so index `*Path` fields are usable as links.

Deliverables: `helix-query.yaml` (scoped indexes: include globs + `target`), the
listing blocks rewritten to `fetch` their index (chunked for scale, with filter/
sort/paginate + an authored fallback), and a `dynamic-blocks-map.md` recording
which blocks are dynamic, which stay static (editorial curation), and the metadata
contract. Validate one flagship end-to-end (e.g. a doctor directory + search with a
`?q=` hand-off) before converting the rest.

### Phase E — Full-site verify

```bash
node skills/rollout/scripts/verify.mjs            # uses rollout.json site.liveHost
# or: --base <url>   (explicit host)   |   --root <dir>   (offline, against a local export)
```

For every delivered page, `verify` confirms it's reachable (HTTP 200), has no
`about:error` (broken-image ingestion, deploy #75), and that every internal
`href="/…"` resolves to a known delivered path — then flips each page to
`verified` or `failed` with the reason. It exits non-zero if any page failed.

### Phase F — Optimize: multi-source audit + gate (delivery quality)

The in-flow **quality gate**. optimize aggregates findings from **existing audit
skills** into one ledger (`optimize/findings.json` + `optimize/scorecard.json`),
tags each by **fixability**, and gates the rollout. Sources (see
`reference/audit-sources.md` for the full mapping):

1. **`rollout:baseline`** — built-in deterministic detectors. Run it directly:

   ```bash
   node skills/rollout/scripts/optimize.mjs        # uses rollout.json site.liveHost
   # or: --base <url> | --root <dir> | --slug <s> | --all
   ```

2. **`impeccable:critique` + `impeccable:audit`** — run them against the delivered
   output for design quality (P-levels) and a11y/perf/responsiveness.
3. **The marketing SEO skills** (`coreyhaines31/marketingskills`) — `seo-audit`,
   `schema`, `ai-seo`, `site-architecture`.
4. **`stardust:tensions`** — the mechanical design tensions from
   `stardust/current/brand-review.html` (type-scale, CTA-vocab, content-free
   links, generic/empty alt, contrast…).

These are referenced as **dependencies** (run them by invocation — nothing is
vendored). Normalize each one's findings into the ledger with the writer:

```bash
node skills/rollout/scripts/findings.mjs record \
  --source marketing:seo-audit --layer seo --check thin-content \
  --severity P2 --fixability platform-migration \
  --scope-ids blog/post --evidence "…" --recommend "…"
# resolve/accept/wontfix a finding:
node skills/rollout/scripts/findings.mjs resolve <id> --status accepted --note "…"
```

All sources share one id space, dedup, scorecard, and the **detect → fix →
verify loop**: re-running a source resolves *its own* findings no longer present
(a baseline run never resolves another source's finding); a regressed `fixed`
finding re-opens; human `accepted`/`wontfix` are preserved. Each finding also
carries an **`autofix`** descriptor (the registered AEM fixer, if any).

**Fixability routing:** `platform-migration` → the AEM autofix engine / re-deploy
fixes it; `design-pass` → upstream (surface only); `out-of-scope` → informational.

The gate **exits non-zero if any open P1 is in scope** — a page is delivery-clean
only when verify passes *and* the ledger has no open P1.

> The judgment layers (brand-tensions, design-ux, content-conversion) are scored
> `null` (not assessed by the automated baseline) until populated by the
> impeccable/tensions sources — the scorecard shows not-assessed rather than
> faking a score.

### Phase G — AEM autofix (close the loop)

```bash
node skills/rollout/scripts/autofix-aem.mjs --project <eds-root>   # [--dry-run] [--slug s] [--check c]
```

The platform autofix engine (AEM-EDS, v1 — **aggressive**). For every open finding
whose `check` has a registered EDS fixer, it edits the EDS **project** files and
logs the change on `finding.autofix`, staging the finding `in-progress`:

- **deterministic** — `eds-fix-h1` (promote/demote so exactly one `<h1>`),
  sitemap (re-assemble).
- **content-draft** (applied under the aggressive policy, logged for review) —
  `eds-metadata-title` / `eds-metadata-description` (draft from `<h1>`/first
  paragraph), `eds-alt-draft` (alt from filename), `eds-disambiguate-title`.
- **manual** (autofix prepares guidance/payload, a human applies) — `eds-jsonld`
  (use `marketing:schema` for the payload), `eds-canonical`, `eds-landmark-main`.

Use `--dry-run` first to preview edits. After applying, **re-deploy** the edited
pages (`deploy`), then re-run **verify** + **optimize** — the staged findings flip
to `fixed`, closing the loop. `design-pass` findings are surfaced, not auto-fixed.

### Phase H — Report

Read `rollout.json.lastRun` + `optimize/scorecard.json` (or re-run `inventory.mjs`)
and print the counts:

```
rollout — <site> → aem-eds
==================================================
Pages       <N> total · <v> verified · <d> deployed · <p> pending · <cp> content-pending · <s> stale
Templates   <T> (per-template delivered/total)
Blocks      <B> total · <c> converted · <p> pending
Quality     health <H>/100 · open P1 <n> / P2 <n> / P3 <n>
To deliver  <list of remaining slugs>
Content     <cp> pages awaiting content track (block code deployed, document not yet pushed)
```

Surface anything still `pending`/`stale`/`failed` as the explicit "what's
missing" list. `content-pending` pages are listed separately — they are not
failures; their block code is live and they advance to `pending` automatically
when `migrate` emits their individual HTML and `inventory` is re-run. Re-run
from Phase B/C to pick up exactly the pages that changed.

### Phase I — Dashboard

```bash
node skills/rollout/scripts/dashboard.mjs    # → dashboard/index.html + data.json
```

A **self-contained, no-external-JS** dashboard rendered in the **project's design
identity** — brand tokens (bg / fg / accent / heading + body fonts / radius) are
read from the `:root` block of a migrated page (the canonical token interface,
`token-contract.md`).

Its centerpiece is a **page tree** of every identified page, nested by URL path,
each node colour-coded by the **most-advanced lifecycle stage** it has reached:

```
identified → prototyped → deployed → optimised
```

The stage spans all three sources: `stardust/state.json` (agnostic
`rostered/extracted/directed` → identified, `prototyped/approved/migrated` →
prototyped), rollout coverage (`deployed`/`verified` → deployed), and optimize
(`optimised` = verified **and** no open findings for the page). **A
`content-pending` sibling (archetypes-only mode) stays at `identified`** — it sits
in the coverage ledger so its delivery can be tracked, but it has no designed
document yet, so being in coverage alone does **not** advance it to `prototyped`
(only a page in the migrated tree does). The legend **counts are
cumulative** — a page counts toward every stage up to the one it reached, so
`identified` equals the total page count, `prototyped` includes everything
prototyped-or-beyond, and so on. **Template archetypes** — the page that defines a
template for its siblings (`templates.json[].representativeSlug`) — are badged
`T`. A page with open findings shows a red count.

Also: a **templates** table (archetype + member count + a per-stage lifecycle
bar) and the quality scorecard. `dashboard/data.json` is the inspectable snapshot.
Regenerate it at every iteration boundary. (`state.json` is read-only and
optional — without it the tree starts at the `migrated` stage.)

## Inputs

| Input | Source | Used for |
|---|---|---|
| `stardust/migrated/*.html` | `migrate` | the pages to deliver (read-only) |
| `stardust/migrated/**/_meta.json` | `migrate` | `templateId` (`template`/`type`), `blocks` (`modules`), `title` |
| `stardust/state.json` | stardust core | *(archetypes-only mode)* full page roster + `type` assignments for pages not yet individually migrated |
| `stardust/rollout/rollout.json` | rollout / user | DA target coordinates |

## Outputs

| Path | Purpose |
|---|---|
| `stardust/rollout/coverage/pages.json` | per-page delivery ledger (schema: `schemas/rollout-pages.schema.json`) |
| `stardust/rollout/coverage/templates.json` | template grouping + roll-ups (schema: `schemas/rollout-templates.schema.json`) |
| `stardust/rollout/coverage/blocks.json` | the block dedup ledger + EDS mapping (schema: `schemas/rollout-blocks.schema.json`) |
| `stardust/rollout/plan.json` | dedup-driven delivery order + per-page convert/reuse briefs |
| `stardust/rollout/optimize/findings.json` | multi-source quality findings ledger (schema: `schemas/rollout-findings.schema.json`) |
| `stardust/rollout/optimize/scorecard.json` | quality scorecard + history (schema: `schemas/rollout-scorecard.schema.json`) |
| `stardust/rollout/rollout.json` | config + `lastRun` summary (schema: `schemas/rollout-config.schema.json`) |
| `stardust/rollout/site/{sitemap.xml,robots.txt,manifest.json}` | site-level assembly artifacts |
| `stardust/rollout/dashboard/{index.html,data.json}` | self-contained progress dashboard + snapshot |
| edits to the **EDS project** (`content/**`, `styles/`) | applied by `autofix-aem` (the only files rollout writes outside `stardust/rollout/`) |
| the delivered EDS site | produced by `deploy` per page (blocks/, content/, fragments — owned by `deploy`) |

`rollout` writes under `stardust/rollout/` and — only via `autofix-aem` — to the
**EDS project** it is delivering to. It never modifies the agnostic core,
`state.json`, or `migrated/` — those are read-only inputs.

## Dependencies (audit sources — referenced, not vendored)

optimize orchestrates existing audit skills by invocation; they must be installed:

- **impeccable** (`critique`, `audit`) — already a stardust dependency.
- **marketing skills** (`coreyhaines31/marketingskills`) — `seo-audit`, `schema`,
  `ai-seo`, `site-architecture`. Optional; surface a note if absent.
- **stardust tensions** — emitted in-repo by `extract` (`brand-review.html`).

Normalize each one's output into the ledger via `findings.mjs record`. See
`reference/audit-sources.md`.

## What rollout does NOT do

- **No upstream redesign.** `design-pass` findings are surfaced, not fixed here —
  they belong to `migrate`/`prototype`. autofix only touches platform-fixable
  findings in the EDS project.
- **No new transport.** Delivery is `deploy`'s DA Source API path, unchanged.
- **No redesign of the agnostic core.** `extract`/`direct`/`prototype`/`migrate`
  and `deploy` are untouched; rollout is the across-pages delivery layer on top.
- **No full pre-migration requirement.** Rollout does not require every page to
  be individually migrated before it runs. Archetypes-only mode is a first-class
  path: block code is fully deployed from the archetype pages; the remaining
  pages advance from `content-pending` to `deployed` as `migrate` emits their
  HTML and `inventory` is re-run — no rollout restart needed.

## Scripts

- `scripts/inventory.mjs` — migrated tree → page + template coverage (idempotent;
  stale-aware). `--state <path>` enables archetypes-only mode: supplements the
  migrated tree with the full page roster from `state.json`, seeding non-migrated
  pages as `content-pending` with template and blocks inferred from the archetype.
- `scripts/blocks.mjs` — distinct-block dedup ledger (`blocks.json`).
- `scripts/plan.mjs` — dedup-driven delivery order + per-page convert/reuse briefs.
- `scripts/update-coverage.mjs` — deterministic delivery state-writer for pages
  (`<slug> --status …`) and blocks (`--block <id> --status …`); re-derives all
  roll-ups.
- `scripts/section-fidelity.mjs` — Phase C source-fidelity gate scaffold: lays a
  page's authored sections (pre-flagging known invented-filler shapes) against the
  source page's heading outline, so the agent can remove sections the source lacks
  before flipping to `deployed`. Informs the gate; never auto-decides (exit 0).
- `scripts/assemble.mjs` — site-level sitemap / robots / fragments manifest.
- `scripts/verify.mjs` — full-site structural verification (HTTP or offline `--root`).
- `scripts/optimize.mjs` — `rollout:baseline` detectors + the multi-source gate:
  scorecard, fixability routing, detect → fix → verify loop; exits non-zero on open P1.
- `scripts/findings.mjs` — record/resolve findings from the external audit sources
  into the shared ledger.
- `scripts/autofix-aem.mjs` — the AEM autofix engine (edits the EDS project, logs
  to `finding.autofix`, stages findings for re-deploy).
- `scripts/dashboard.mjs` — design-identity dashboard: lifecycle-coloured page
  tree + templates + scorecard, `data.json` snapshot (reads `state.json` for the
  agnostic stages).
- `scripts/lib.mjs` — shared IO + roll-up + page-loading + autofix-registry helpers.

## References

- `notes/rollout/PLAN.md` — design, coverage model, phasing, open questions.
- `reference/audit-sources.md` — the audit-source → layer → fixability → autofix map.
- `reference/checks.md` — the `rollout:baseline` check catalog.
- `skills/deploy/SKILL.md` — the single-page conversion methodology rollout drives.
- `skills/deploy/da-deploy-protocol.md` — the DA Source API transport.
- `skills/migrate/SKILL.md` — produces the `migrated/` + `_meta.json` inputs.
- `schemas/*.schema.json` — the coverage + config contracts.
