# DA Deploy Protocol

Reference for the headless deploy sequence: write the sanitised **body-fragment** HTML to DA via the Source API, then preview. Replaces the older `aem put` / `aem preview` / `aem publish` pipeline.

Read:
- § Deploy (DA Source API + curl) — when writing or debugging a single page's PUT → preview → live, or a preview 409 / `about:error`;
- § Delivery pipeline — before the first deploy of a run: the stage table, the batch driver (#4), the per-page atomic delivery contract, link localization, the computed-style guard, token hygiene and the `DA_TOKEN` lifecycle.

## Deploy (DA Source API + curl)

Needs an IMS token (`DA_TOKEN`; see the `da-content` / `da-auth` skills — may live in the repo `.env`, which MUST be gitignored). Also **push the code branch to GitHub first** so AEM Code Sync builds it and the branch preview renders your blocks.

**Two preconditions bite (both cost real debugging):**
- **Branch-host length ≤ 63 chars.** The host label `<branch>--<repo>--<owner>` must fit the DNS 63-char limit. Over it, the host does not resolve at all (curl `000`, "label too long") — nothing renders. The page PATH is independent of the host, so keep the path descriptive and **shorten the BRANCH** (e.g. `velocity-refined-content-2`, not `velocity-global-refined-content-2`).
- **Force Code Sync for a fresh/programmatic branch.** The GitHub webhook frequently does NOT fire on a scripted push — symptom: your edited blocks/assets `404` on the branch host (`code.status: 404` via `admin.hlx.page/status/...`) while baseline files serve. Force it: `POST https://admin.hlx.page/code/$ORG/$REPO/$BRANCH/*` (→ `202` + a job), then poll until the edited block JS/CSS are live before previewing.

```bash
ORG=<daOrg>; REPO=<daRepo>; BRANCH=<branch>; P=<path-without-extension>   # e.g. snowflake-blocks/test-1
TOKEN="$DA_TOKEN"

# 0. force Code Sync (webhook may not fire for a scripted push) — then wait for
#    your edited blocks to be live before previewing. Assets gzip → curl --compressed.
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/code/$ORG/$REPO/$BRANCH/*"          # expect 202
for i in $(seq 1 60); do   # capped: ~3 min, then fail loud — never an unbounded wait
  curl -s --compressed "https://$BRANCH--$REPO--$ORG.aem.page/blocks/<edited-block>/<edited-block>.js" \
    | grep -q "<a marker string from your edit>" && break
  [ "$i" = 60 ] && { echo "code sync did not land in 3 min — check the POST above / Code Sync installation" >&2; exit 1; }
  sleep 3
done

# 1. sanitise non-ASCII to entities (in place, idempotent) — DA corrupts raw UTF-8
node skills/deploy/scripts/sanitise.js content/$P.html

# 2. write the body fragment to DA (multipart, field name MUST be `data`, type text/html)
curl -sS -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@content/$P.html;type=text/html" \
  "https://admin.da.live/source/$ORG/$REPO/$P.html"           # expect 201

# 2b. NEW image assets must be LIVE on Code Bus BEFORE the preview ingests them (#75).
#     The preview fetches every <img src>, hashes the bytes into Media Bus, and writes
#     about:error if a URL doesn't return image bytes AT THAT MOMENT. A just-pushed
#     img/<brand>/x.jpg can lose the race with Code Sync. Wait for each authored image:
for u in $(grep -oE 'https://[^"]+/img/[^"]+\.(jpg|jpeg|png|webp|svg)' content/$P.html | sort -u); do
  for i in $(seq 1 40); do   # capped: ~2 min per asset, then fail loud
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$u")" = "200" ] && break
    [ "$i" = 40 ] && { echo "asset never became live: $u" >&2; exit 1; }
    sleep 3
  done
done
# NB (#2): this bare-curl wait is for repo-relative /img/ assets only. Do NOT bare-curl
#   - content.da.live/admin.da.live media URLs — they 401 to anon curl but ingest fine
#     (verify them via step 3b about:error instead); and
#   - external SOURCE/CDN <img> srcs on a bot-walled origin (Akamai/Cloudflare 403 a curl
#     while serving a real browser) — verify those with the recorded headed-chrome in-page
#     fetch, and rehost a 403'd asset to DA media rather than omitting it
#     (see `reference/encode-contract.md` § Images — image-fidelity rules).

# 3. preview (separate, required; path WITHOUT .html; ref = the code branch)
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/$ORG/$REPO/$BRANCH/$P"       # expect 200

# 3a. preview 409 "error from content-bus" — the error is OPAQUE (no per-asset
#     detail); do NOT dead-end on it. Two cheap diagnostics, in order:
#   (i)  upload a known-good doc to the SAME path and re-preview — separates
#        path-state problems from content problems in one request;
#   (ii) if the known-good doc previews, check every image URL the real doc
#        references for an SVG over ~40KB — a hard pipeline limit that
#        surfaces at PREVIEW, not at upload (and distinct from the
#        raster-embedding-SVG case, `reference/encode-contract.md` § Images #99: both present as this
#        same 409). Remedy: rasterize the SVG to PNG, upload the PNG to DA
#        media, re-author, re-preview. Field-proven: this turned a dead-end
#        409 into a 3-minute fix.

# 3b. VERIFY ingestion on the delivered .plain.html (per page; assets gzip → --compressed):
#   (i)  no broken-image ingestion (#75) — must be 0; if not, an asset wasn't on Code Bus
#        yet. Re-run step 3 (preview is idempotent; it re-ingests and repairs).
#   (ii) authored EDITORIAL images actually landed — assert the expected <img>/alt count.
#        CSS-background images are absent from .plain.html, so "it renders" is NOT proof
#        that an image is authorable/AI-visible (see `reference/encode-contract.md` § Images).
curl -s --compressed "https://$BRANCH--$REPO--$ORG.aem.page/$P.plain.html" | grep -c about:error      # expect 0
curl -s --compressed "https://$BRANCH--$REPO--$ORG.aem.page/$P.plain.html" | grep -oc '<img'          # expect = authored editorial image count

# 4. (optional) publish to aem.live
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/live/$ORG/$REPO/$BRANCH/$P"
```

URLs: DA edit `https://da.live/#/$ORG/$REPO/$P` · preview `https://$BRANCH--$REPO--$ORG.aem.page/$P` · live `https://$BRANCH--$REPO--$ORG.aem.live/$P`. Token pre-flight: a 401 with empty body means it expired (dev tokens last ~24h) — re-auth.

## Delivery pipeline — stages, batch driver, per-page atomic contract, token lifecycle

**Steps 1–9 are the conversion methodology**; deploy is the one transport-specific step. From a local agent (Claude Code / CLI), each converted page deploys headlessly:

| Stage | How |
|---|---|
| Code | `git push` the branch → AEM Code Sync builds it |
| Localize links | `skills/deploy/scripts/localize-links.mjs --source-host <live-host> [--redirects stardust/redirects.tsv]` — after EVERY generator, before EVERY write, over the WHOLE tree (below) |
| Sanitise | `skills/deploy/scripts/sanitise.js` — run it before the write (DA corrupts raw UTF-8) |
| Content write | DA Source API: `PUT admin.da.live/source/<org>/<repo>/<path>.html` (multipart, field name **`data`**, `type=text/html`) |
| Make live | `POST admin.hlx.page/preview/<org>/<repo>/<branch>/<path>` (then optionally `/live/...`) |
| Auth | IMS token (`DA_TOKEN`) — see the `da-content` / `da-auth` skills |

The content payload is a **body fragment** (see Step 9). The deploy needs the **code branch pushed to GitHub** so the branch preview (`<branch>--<repo>--<org>.aem.page`) renders with your blocks. See § Deploy (DA Source API + curl) above for the full curl contract.

**For more than a few pages, use the bundled driver instead of a hand-rolled loop (#4).** `node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> --content content [--concurrency 4] [--no-publish]` runs `PUT → preview → live` across a content tree with bounded concurrency, a **persistent ledger** (`content/.deploy-ledger.json`) so a re-run **skips pages already live** and only re-drives FAILs, capped-backoff retries on `000/429/5xx`, an **append-only** log (survives a restart), and a delivered-`.plain.html` check before flipping a page to `live` (admin 200 ≠ delivered). It's idempotent — safe to Ctrl-C and re-run, which is the documented recovery for a transient-blip half-deploy. A serial hand-rolled bash loop that truncates its own log on restart is the anti-pattern this replaces.

**Per-page atomic delivery contract.** A page is `deployed` only when the full chain passes, in order: `localize-links.mjs` run over the content tree (then `--check` exit 0 — no source-host href left whose target exists locally) → `davids-model-lint.mjs` exit 0 (0 🔴 — the content-structure gate) → sanitise-wrapped file (`scripts/sanitise.js`) → `PUT` (multipart field `data`, `type=text/html`) → `POST /preview/` → `POST /live/` → **GET the rendered `.plain.html` and assert**: HTTP 200, the `<body>` wrapper intact, exactly one `<h1>`, zero `about:error`, no `/img/` srcs — plus, when key facts are declared for the site (#86 — `DESIGN.json.extensions.metadata.keyFacts[]`, written by `direct`; skip the gate and note the skip when the field is absent), grep the RAW full-page HTML (not the rendered DOM) for each fact string on the pages that carry them. → **AI-readability gate (#100)**: `node skills/deploy/scripts/ai-readability.mjs --origin <live> <paths>` — the checker score (served words ÷ rendered-DOM words, landmarks ignored) with fragments credited must be **≥ 98** on the published page; record the strict score and the per-block served gap in the gate report (`reference/ai-readability.md`). Only then flip the page's ledger entry to `deployed` — never on the POST codes (admin 200 ≠ delivered).

**Link localization is a pipeline stage, not an afterthought.** Generators faithfully carry captured hrefs as fully-qualified source-domain URLs — the D4 "author URLs as opaque tokens" rule — and that silently shipped ~500 links across ~150 pages that bounced visitors OFF the migrated origin back to the live site, for targets that existed on the new origin all along (recorded). **D4 is a capture-fidelity rule for media and external targets; it is never a delivery rule for internal links.** The pipeline owns a URL map (every served path in the content tree + `stardust/redirects.tsv` entries) and `localize-links.mjs` rewrites, idempotently, every source-host `<a href>` whose path resolves in the map to the canonical root-relative form — extensionless, no trailing slash (EDS 404s on `/x/` and `/x.html`), query and fragment preserved — and normalizes root-relative internal hrefs the same way. Everything else stays absolute: genuinely external targets and not-yet-migrated pages are the honest integration boundary, and the tool lists them. **Re-run it over the WHOLE tree after every wave**: earlier waves' pages gain newly valid internal targets only when a later wave ships them (recorded: wave-1 pages linking a section that wave 5 delivered). `davids-model-lint.mjs --source-host <live-host>` flags any remaining localizable link as a 🟡 LOCALIZE advisory (advisory in this release; the fix is the stage, never a hand edit).

**A `.plain.html` pass is NOT a layout pass — add one computed-style assertion (#the silent-failure guard).** The text-level asserts above are all satisfied while the page renders as a single stacked column, because a block-CSS scoping mistake (a selector keyed to a wrapper class the target runtime doesn't emit — see `blockWrapperClass` in the runtime contract) makes every grid fall back to `display: block` *with the typography still correct*. This shipped green on a real e2e site. So the contract's final gate is a **headless computed-style check on the delivered live URL** (not `.plain.html`): load the page in a headless browser and assert, for the first page of each template, that every block whose CSS declares a grid/flex layout **computes `display: grid`/`flex` (not `block`)**, `main .section` count > 0, blocks are decorated (`data-block-name` present), zero `pageerror`, zero broken images — **and every visible loaded image renders non-zero: `clientWidth > 0` (#122)**. Loaded ≠ rendered: an `<img>` with `naturalWidth > 0` can still render 0×0 (recorded: a flex item whose width derives from the image while the image's `max-width: 100%` derives from the item — circular sizing collapses to zero), and both the `.plain.html` checks and a `naturalWidth === 0` broken-image probe miss it. A block that should grid but computes `block` fails the page — do not flip it to `deployed`. This is the assertion `blockWrapperClass` in the runtime contract calls for; the atomic contract is where it must actually run, once per template. Two field-decodes worth pinning: a **burst of `PUT` 400s is a malformed path, not rate limiting** — lowercase every segment, never a double slash (`content//…` 400s the PUT while preview/live still 200), no trailing `-`/`_` on a segment; and **write long loops to a bash script file with absolute binary paths** (`/usr/bin/curl`, the full `node` path) — zsh drops PATH inside `while`/`for` in some contexts, and the resulting `command not found` burst mimics a transport failure.

**Token hygiene (#16).** The IMS token typically lives in repo `.env` as `DA_TOKEN`. Before the first commit, make sure `.gitignore` excludes `.env` and `.env.*` **on the branch you'll branch tests from** — otherwise every test subbranch re-exposes the token (the master skill's Setup step 6 writes the managed block; the local harness and pre-renders live under `stardust/.work/`, which `stardust/.gitignore` already excludes). Dev tokens last ~24h; a `401` with an empty body means expired → refresh and retry (the write is idempotent).

**DA_TOKEN lifecycle — preflight and re-check, never fail pages on it.** At setup, preflight the token: decode the JWT `exp` claim when present (base64-decode the middle segment) and smoke-test ONE authenticated DA call before any batch. **Re-check before each long batch** — a token fresh at setup can expire mid-run. On a `401` mid-batch: checkpoint the ledger (the batch driver's persistent ledger already records per-page state), stop the batch, and halt with a single actionable instruction — "DA_TOKEN expired; refresh it in `.env` and re-run the same command (the ledger skips delivered pages)" — instead of letting every remaining page fail red. Token expiry is the one credential failure the agent cannot self-recover; it is a legitimate hard stop even in a hands-off run.
