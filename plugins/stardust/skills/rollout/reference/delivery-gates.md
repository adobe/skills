# Delivery gates + batched delivery (Phase C)

The per-page checks Phase C runs before flipping a page to `deployed`, and the
batched-delivery flow that runs them uniformly at scale. SKILL.md Phase C names
each gate in one line; the mechanics live here.

## Gate 1 — Source-fidelity ("don't add sections the source doesn't have")

A migration reproduces the source; it must not invent sections. Invented
sections render as empty placeholders or, worse, get back-filled with fabricated
facts. This recurs as trailing **cross-link rails** (`related-*`, `*-teasers`),
**specialist/teaser grids**, and generic **trailing CTAs** appended to leaf pages
regardless of source.

```bash
node skills/rollout/scripts/section-fidelity.mjs \
  --file <content.html> --source <sourceUrl>   # authored vs source, side-by-side
```

The helper is a scaffold, not a judge: it lists authored block sections
(pre-flagging known filler shapes as `⟵ REVIEW`) against the source heading
outline. For each authored section decide:
- **HARD-FAIL → remove before `deployed`:** the section carries FABRICATED facts
  (invented names, made-up events/dates, boilerplate not on the source).
  Fabricated content on a real site is the worst migration defect.
- **Soft call:** an invented rail whose links all point to REAL pages — prefer
  remove; keep only as a plain text link-row if cross-linking is explicitly
  wanted, never as an image-card grid that needs assets to exist.
- **Pass:** the section backs a real source region.

Delete the section from the content file (and `git rm` the block if it becomes
orphaned). Genuinely-missing *real* content is different: leave the block, render
gracefully, log it as a content gap — do NOT invent filler.

## Gate 2 — Image-fidelity (every `<img>` src must RESOLVE, or be omitted)

The #1 recurring defect at scale: an authored external image URL the preview
ingester can't fetch delivers as `<img src="about:error">` — a silent break that
"it renders" hides. Before deploy, for each authored `<img>` whose src is an
external/source URL, verify 200:

```bash
curl -s -o /dev/null -w '%{http_code}' <url>
```

If it isn't 200, OMIT the image (the block renders without it) rather than ship
`about:error`. Never author a logo/placeholder stand-in as if it were editorial.
Two failure signatures where the asset exists behind a malformed URL — fix the
URL, don't drop the image:
- **Wrong rendition variant** — the source exposes only a derivative that 404s
  (e.g. a portrait's `…/4x3/768/…` 404s; the `…/original/768/…` sibling
  resolves). Rewrite to the resolving variant.
- **Missing query delimiter** — a CDN URL built as `…/<id>&wid=600&hei=…` (no
  `?`) makes the whole `<id>&wid=…` a bogus asset id → 403. Repair the first `&`
  after the id to `?`.

After preview, the authoritative check is `.plain.html`: 0 `about:error` and the
expected `<img>`+alt count (CSS-background images are absent from it).

## Gate 3 — Path-safety (source paths must be AEM-Edge-safe, or normalized + redirected)

Real source URLs are not always valid EDS resource paths; DA accepts the `PUT`
(201) but preview/serve then 404s/400s, so this is invisible until verify. Before
deploy, normalize each path and, when it changes, record the original→normalized
pair so the source URL can be redirected (a final migration must not 404 inbound
links). Rules:
- lowercase the whole path;
- trim a trailing `-`/`_` in any segment;
- collapse `_`→`-` and runs of `-`;
- replace the `--` segment delimiter (e.g. `klinik-st--anna`) — AEM reserves `--`
  as the `branch--repo--owner` host delimiter, so a `--` in a path 400s.

Append each change to `stardust/redirects.tsv` (`source<TAB>destination`); wiring
those into the EDS redirects config is a Phase D/assembly step.

## Gate 4 — Source-content hygiene (a sitemap roster contains dead and bodyless URLs)

At ~1000-page scale the roster comes from the source sitemap, which includes URLs
that **404 on the source** (stale entries) and pages with **no HTML body**
(PDF-only publication entries — a title plus a PDF download). Two rules:
- **Verify the source returns 200 before authoring.** A dead source URL is not a
  page to fabricate — leave it un-authored and let it show as the lone gap in the
  dashboard (e.g. 814/815). Never invent a body to fill the slot.
- **Bodyless/PDF-only source → author metadata + hero + the real download link,
  then STOP.** Don't pad with invented prose; the faithful page is a thin one, and
  that is correct. (Same root rule as Gate 1: reproduce the source, never
  out-author it.)

## Batched delivery at scale (clusters of 6–20+ siblings)

Separate the concerns so an agent crash or token blowout can't corrupt state, and
so the gates run uniformly:
- **Author-only agents, central deploy.** Each cluster agent reads its work-list +
  the cleaned archetype template and *only writes content files* — it does NOT
  deploy. The orchestrator deploys centrally (one idempotent `PUT`+preview loop):
  token stays in one place, retries are trivial, and a sub-agent dying mid-response
  leaves its files already on disk.
- **Validate structure BEFORE deploy.** Cheap deterministic check on every authored
  file — exactly one `<h1>`, the body/`<main>`/`<footer>` wrapper, balanced
  `<div>`s — catches a truncated/garbled file before it reaches DA.
- **Verify-THEN-flip, never flip blind.** Only flip to `deployed` after the rendered
  `.plain.html` passes (HTTP 200, 0 `about:error`, `<h1>` present). Verify is where
  the image- and path-fidelity defects surface at scale — a 4-page sample won't show
  them; a 130-page batch will.
- **Admin 200 ≠ delivered — verify the rendered URL, not the POST codes.** Some
  path-safety defects pass `PUT`+preview+live ALL 200 yet 404 at the delivery URL.
  The proven case: an **uppercase segment** (`.../CAR-T-Zellen`) — the admin API
  accepts and "publishes" it, but `*.aem.live/.../CAR-T-Zellen` 404s (delivery is
  lower-cased). The `PUT=201 PRE=4xx` heuristic MISSES it; Gate 3's "lowercase the
  whole path" prevents it at author time, and the GET-`.plain.html` verify is the
  only thing that catches it after the fact. Fix = rename to the lowercase path,
  redeploy, `DELETE` the stale uppercase DA source, add a redirect.
- **Long batches run in the background** (a 130-page `PUT`+preview loop exceeds a
  2-min foreground budget); log per-page OK/FAIL and re-drive only the FAILs.
  Transient `PUT=000` → retry; `PUT=201 PRE=4xx/400` → a path-safety case (Gate 3);
  `200 + about:error` → an image case (Gate 2).
- **zsh gotcha:** `node`/`curl` inside a multi-line `while`/`for` can lose PATH
  ("command not found") — write the loop to a `bash` script file with absolute
  binaries and run it, rather than inlining.
