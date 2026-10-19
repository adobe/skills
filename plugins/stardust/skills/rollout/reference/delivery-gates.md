# Delivery gates + batched delivery (Phase C)

The per-page checks Phase C runs before flipping a page to `deployed`, and the
batched-delivery flow that runs them uniformly at scale. SKILL.md Phase C names
each gate in one line; the mechanics live here.

**Two halves.** The gates split into a **static** pre-PUT lint
(`reference/delivery-lint.md` → `scripts/delivery-lint.mjs`: wrapper,
one-CTA-per-`<p>`, trailing-slash, path-safety — deterministic and offline) and a
**dynamic** post-deploy check (`scripts/verify.mjs` § typed render-truth: does it
actually render, typed by page/fragment/index). Run the static lint first — it
catches the cheap failures before a network round-trip. Gate 2 (image-fidelity)
has its own network resolver, `scripts/media-reconcile.mjs`
(`migrate/reference/media-reconciliation.md`).

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
"it renders" hides. The systematic resolver is `media-reconcile.mjs` (it decides
optimize/keep/rewrite/omit per image and can `--apply` the fix). Content-host URLs
(`content.da.live`) are its `hosted` decision: verified offline against
`stardust/deploy/media-ledger.json`, never anonymously fetched (a `401` there is by
design); missing from the ledger fails the gate. The manual form, for a single
image, is a 200 check:

```bash
node skills/rollout/scripts/media-reconcile.mjs --file <html> --deploy-host <host>   # all images
curl -s -o /dev/null -w '%{http_code}' <url>                                          # one image
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
those into the EDS redirects config is a Phase D/assembly step. When a spec exists
(`stardust/spec/knowledge/`), run `seed-redirects.mjs` first: it adds every source
URL that changes on EDS and points the source's own redirects at the delivered
page (`deploy/scripts/eds-path.mjs` is the path contract), only toward delivered
pages, so re-run it after each wave; rows already in the file win.

## Gate 4 — Source-content hygiene (a sitemap roster contains dead and bodyless URLs)

At ~1000-page scale the roster comes from the source sitemap, which includes URLs
that **404 on the source** (stale entries) and pages with **no HTML body**
(PDF-only publication entries — a title plus a PDF download). Two rules:
- **Verify the source returns 200 before authoring** (a spec's `knowledge/urls.jsonl`
  says: `http-*`, `redirect-broken`, `loop` dead, `flag=empty` bodyless; probe `blocked`
  rows). A dead source URL is not a
  page to fabricate — leave it un-authored and let it show as the lone gap in the
  dashboard (e.g. 814/815). Never invent a body to fill the slot.
- **Bodyless/PDF-only source → author metadata + hero + the real download link,
  then STOP.** Don't pad with invented prose; the faithful page is a thin one, and
  that is correct. (Same root rule as Gate 1: reproduce the source, never
  out-author it.)

## Export freshness + gap-closure order

When `rollout.json` `exports` lists `migration-workspace`, the export a client
reads (`workspace/mapping.json` + `workspace/manifest.json`) is only valid while
it still describes the files it was built from. The mapping is built by
`block-origin.mjs` from three input families beside the content and block code:
the **captures** (`stardust/current/pages/<slug>.html`), the **eds-schema
sidecars** (`stardust/eds-schema/<slug>.json`, the default-content roles) and the
**encoder maps** (`stardust/import/<t>/vocabulary.json`, else
`stardust/migrate/encode/<t>/vocabulary.json`). `workspace-manifest.mjs` hashes
all three into the manifest's `inputs`, and `done-check.mjs` re-hashes the same
tree and raises `export_stale` naming any file whose hash differs — a sidecar,
capture or map rewritten after the mapping is a stale export, not a fresh one.

The export is therefore built only once the roster is frozen — no unit running,
no fix round open, gap-closure finished — and any later edit under `content/`,
`blocks/`, `styles/` or a judgement re-runs the whole sequence before
`done-check.mjs`.

**Run the steps in this order, never the other way round.** A gap-closure fix
(`done-check.mjs` → a `sidecars_missing` or similar gap → the fix) rewrites
sidecars/captures/content; it MUST land **before** the export is regenerated:

1. gap-closure fix writes (sidecars, captures, content, block code);
2. `block-origin.mjs --verify` → rewrites `workspace/mapping.json`;
3. `workspace-manifest.mjs` → records the new input hashes;
4. `done-check.mjs` → re-checks; `export_stale` clears only once 1–3 ran in order.

Regenerating the manifest BEFORE re-running `block-origin` records input hashes
the committed mapping was never built from: the manifest then looks fresh while
the mapping is stale. A recorded run closed `sidecars_missing` five minutes after
its mapping was committed and the export went out stale — this ordering is the
fix.

## Batched delivery at scale (clusters of 6–20+ siblings)

Separate the concerns so an agent crash or token blowout can't corrupt state, and
so the gates run uniformly:
- **Author-only agents, central deploy.** Each cluster agent reads its work-list +
  the cleaned archetype template and *only writes content files* — it does NOT
  deploy. The orchestrator deploys centrally (one idempotent `PUT`+preview loop):
  token stays in one place, retries are trivial, and a sub-agent dying mid-response
  leaves its files already on disk. The replica Phase 5 fan-out
  (`../../replica/reference/handoff-contract.md` § 3 row C) is the one sanctioned
  variant: each cluster subagent drives its own `deploy-batch.mjs --paths …
  --ledger stardust/deploy/ledger-<cluster>.json --concurrency 2` and gates on the
  preview origin itself, which is safe only because the shared ledgers are written
  under a lock (coverage, media) or per cluster (deploy), the token is read from
  the environment by every driver, and a persistent 401 halts that cluster's batch
  (exit 3) instead of failing pages — a recorded 36-page run delivered 36/36 this
  way. Outside that contract, author-only + central deploy stays the rule.
- **Schedule (the fan-out variant).** Once C0 is committed and frozen, every
  archetype unit starts in one turn, each cluster the moment its archetype is
  `done`, the lead looping `progress.mjs wait` → `progress.mjs show --waves`
  (each unit's subagent flips its own end) → start what its `can start now:` names;
  never serialize disjoint units to spare browsers — the browser slot queue paces
  captures, not the number of units. The one exception, a unit editing a shared
  file, waits for its lock inside the writer, never by starting later
  (`../SKILL.md` § Phase C).
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

## Iteration discipline + the fix-round brief

These rules set when fix rounds STOP, never what PASS means: the verdict
criteria and the cap of 3 rounds per page (handoff contract § 1 row 5) stay.
- **Stop at PASS at both widths, no "confirm" round:** a PASS with Δh ≠ 0 takes
  another round only while rounds remain and a named cause exists; at the cap a
  PASS is final (any Δh within the tolerance), a FAIL goes to the re-prototype
  decision.
- **Confirm once, only after a shared change** (`styles/`, `fonts/`,
  `head.html`, `scripts/`, `blocks/header/`, `blocks/footer/`, the chrome
  documents, a block other pages use): `gate-all.mjs --changed-only` at both
  widths, never every archetype. It re-gates each page whose fingerprint
  (delivered CSS/JS plus its own and the chrome documents, recorded beside a
  verdict only when the gate key proves the host serves that tree — a row
  without one is always re-gated) changed since its PASS, and leaves out and
  names each page at the cap (`at the cap: <slug>, … — C-final's roster gate
  measures them`); `--round-reset` follows only a recorded re-prototype decision.
- **Resume, never restart:** a killed `gate-all.mjs` run re-runs the same
  command plus `--skip-existing`.

**The fix-round brief** the lead fills in and pastes for a fix-round subagent
after C0 (project copy: `stardust/scripts/<skill>/` for `skills/<skill>/scripts/`):

```text
Fix round <n> of 3 — unit <unit>; pages <slug,…>; widths 1440 + 360; host <preview host>.
FAIL lines, verbatim from gate-all with their numbers (and <out>/triage.json): <lines>
Edit only blocks/<name>/; a frozen-file finding is ONE stardust/rollout/foundation-requests.md line:
  - <unit> | <what> | <evidence: instrument + numbers> | <templates affected>
A server: node skills/replica/scripts/run-bg.mjs start --kind server --name <unit>-srv -- <cmd> (never waited)
Each round: fix, npm run lint, then
  node skills/stardust/scripts/unit-commit.mjs <unit> --code blocks/<name> --push
  node skills/deploy/scripts/fresh-check.mjs <css-or-js-url> --grep '<marker>'
  node skills/replica/scripts/run-bg.mjs start --name <unit>-r<n>-<w> -- \
    node skills/replica/scripts/gate-all.mjs --only <pages> --eds-host <host> --width <w>
  # per width; after a shared change, instead:
  node skills/replica/scripts/run-bg.mjs start --name <unit>-changed-<w> -- \
    node skills/replica/scripts/gate-all.mjs --changed-only --eds-host <host> --width <w>
  node skills/replica/scripts/run-bg.mjs wait   # exit 75: wait again, 77: a unit returned
  node skills/rollout/scripts/update-coverage.mjs --gate <each width's "run →" file>
Stop: <the stop rule above>; at the cap the decision is not yours, never --round-reset. Then:
  write your report to stardust/rollout/units/<unit>.md (never git add it by hand)
  sidecar before commit: every delivered page has stardust/eds-schema/<slug>.json
    (node skills/deploy/scripts/section-schema.mjs <protoURL> --out stardust/eds-schema/<slug>.json);
    unit-commit refuses a missing one (--no-sidecar-check overrides, recorded in the message)
  node skills/stardust/scripts/unit-commit.mjs <unit>   # carries the report, pages and bookkeeping
  node skills/replica/scripts/run-bg.mjs stop --servers
  node skills/stardust/scripts/progress.mjs unit done|failed <unit> --verdict "<one verdict line>"   # last
STARDUST_PAUSE_FILE present → finish the round, stop your servers, return "paused: <report>" (no progress.mjs).
```
