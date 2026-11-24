# figma-to-content: phase 5, deploy to DA

The text of this part of `SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Phase 5 — Deploy to DA

**If a DA MCP server is available in the session, use its tools** for auth and
source writes (da-auth and da-content both defer to it when present).
Otherwise use the Source API directly, below.

```bash
# Two identities — keep them separate. DA (Document Authoring) and GitHub are the
# same org/repo in the standard EDS setup, but nothing guarantees it, so never
# assume one from the other. DA endpoints (admin.da.live/source, content.da.live,
# da.live/edit) use the DA pair; the render host and admin.hlx.page (code, preview,
# live) use the GitHub pair.
DA_ORG=<da-org>        # Document Authoring org
DA_REPO=<da-repo>      # Document Authoring repo/site
GH_OWNER=<gh-owner>    # GitHub owner
GH_REPO=<gh-repo>      # GitHub repo
# In the standard setup all four match: DA_ORG=GH_OWNER=<owner>, DA_REPO=GH_REPO=<repo>.
BRANCH=<branch>        # git deploy ref (usually main). For content+code this MUST be
                       # the branch the new-block code was pushed to and Code Sync built.
BRANCH_HOST=${BRANCH//\//-}   # host label: slashes → dashes ('feature/x' → 'feature-x').
                              # Used BOTH for the aem.page/aem.live hostname AND as the ref
                              # segment in every admin.hlx.page path (code/preview/live): that
                              # ref is a SINGLE path segment, so a slashed branch ('figma/x')
                              # splits it and 404s — pass the dashed label ('figma-x'), which is
                              # what AEM actually resolves. Only git itself (push/checkout) uses
                              # the literal slashed $BRANCH. For a slash-free branch the two
                              # forms are identical, so $BRANCH_HOST is always the safe choice
                              # for admin.hlx.page.
P=<path-without-extension>
TOKEN="$DA_TOKEN"      # from da-auth; 401 ⇒ missing/invalid/expired, re-auth

# Fail fast if the branch host would be unresolvable (>63 chars won't resolve).
host="$BRANCH_HOST--$GH_REPO--$GH_OWNER"
[ "${#host}" -le 63 ] || { echo "❌ branch host '$host' is ${#host} chars (>63) — won't resolve; use a shorter branch/repo/org"; exit 1; }

# --- checked-request helper: every call asserts its status; a bare `curl -sS`
#     exits 0 on 401/403/409/5xx, so an unchecked curl silently "succeeds" on a
#     failed write. req <expected-codes> <curl-args…>: prints the body, retries a
#     few times on network/429/5xx, and aborts (non-zero) on any other mismatch.
#     Use it for every PUT/POST below; if a DA MCP server is used instead, apply
#     the same rule — assert the returned status, don't assume success. ---
req() {
  local expect="$1"; shift
  local attempt out code body
  for attempt in 1 2 3 4 5; do
    if out=$(curl -sS -w $'\n%{http_code}' "$@"); then code="${out##*$'\n'}"; else code="000"; fi
    body="${out%$'\n'*}"
    case ",$expect," in *",$code,"*) printf '%s' "$body"; return 0;; esac
    case "$code" in
      000|429|5??) sleep $((attempt * 2)); continue;;   # transient — bounded retry
      401)         echo "❌ 401 (token missing, invalid or expired) — re-auth (da-auth) and retry" >&2; return 1;;
      *)           echo "❌ HTTP $code (expected $expect) — $*" >&2; return 1;;   # 4xx: do not retry
    esac
  done
  echo "❌ giving up after retries (last status $code) — $*" >&2; return 1
}

# --- content+code path ONLY: block code must be LIVE before the page renders ---
# (skip this whole block for content-only — the code is already deployed)
#   1. commit the new block(s) and push to the deploy branch (open a PR if the
#      project protects $BRANCH; the branch that renders the page must contain
#      the block code):
#        git add blocks/<new-block> && git commit -m "feat: <new-block> block" && git push origin "$BRANCH"
#   2. Code Sync builds automatically on push. Optionally force it (non-2xx here
#      isn't fatal if the push already synced, so don't abort on it):
req 200,202 -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/code/$GH_OWNER/$GH_REPO/$BRANCH_HOST/*" >/dev/null || true
#   3. poll until the new block's JS is live on the branch host (bounded — don't hang):
BH="https://$BRANCH_HOST--$GH_REPO--$GH_OWNER.aem.page"
for i in $(seq 1 24); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --compressed "$BH/blocks/<new-block>/<new-block>.js")
  [ "$code" = "200" ] && break
  [ "$i" = "24" ] && { echo "❌ block JS not live after ~2min — check push/branch/Code Sync"; exit 1; }
  sleep 5
done
#      also confirm the block's CSS is live — a block whose JS loads but CSS 404s
#      renders unstyled:
csscode=$(curl -s -o /dev/null -w '%{http_code}' --compressed "$BH/blocks/<new-block>/<new-block>.css")
[ "$csscode" = "200" ] || echo "⚠ block CSS not live ($csscode) — block will render unstyled"

# --- both paths ---
# 1) Upload referenced media FIRST — every authored <img> must resolve at PREVIEW
#    time. For each image downloaded in Phase 1, PUT the binary to DA (field name
#    MUST be "data"). Detect the format from the BYTES and keep <image/mime>, the
#    <media-path> extension, and the authored content.da.live URL extension all in
#    agreement (see Phase 4 "Normalize format, extension, and MIME together") — the
#    filename/URL suffix is not authoritative.
#    Skip images that use a stable external URL the preview can sideload.
req 200,201 -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@<local-image>;type=<image/mime>" \
  "https://admin.da.live/source/$DA_ORG/$DA_REPO/<media-path>" >/dev/null
#    then reference it in the HTML as https://content.da.live/$DA_ORG/$DA_REPO/<media-path>

# 2) Overwrite guard — the Source-API PUT clobbers an existing page and still
#    returns 200, so the abort MUST be bound to an explicit decision, not to a
#    warning. Two facts come from the Phase 2.2 plan (record them there, per path):
#      PLANNED_STATE = new | exists   — what the 2.2 existence check saw
#      OVERWRITE_OK  = yes            — set ONLY when the user confirmed overwriting
#                                       an existing page; unset/no otherwise
#    Re-GET now (auth is checked BEFORE existence, so a 401 = token problem
#    (missing, invalid or expired), NOT "new"). Refuse to write if the state changed since planning or the
#    overwrite was never confirmed — a page can be created in the gap between
#    planning and this write.
exists=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "https://admin.da.live/source/$DA_ORG/$DA_REPO/$P.html")
case "$exists" in
  404)  # absent now
    [ "$PLANNED_STATE" = "exists" ] && { echo "❌ plan expected an existing page but it's gone (404) — STOP and reconfirm"; exit 1; }
    ;;   # planned-new and still absent → proceed
  200)  # present now
    if [ "$OVERWRITE_OK" != "yes" ]; then
      echo "❌ $P.html exists in DA but overwrite was NOT confirmed in the plan — STOP and reconfirm with the user"; exit 1
    fi
    if [ "$PLANNED_STATE" != "exists" ]; then
      echo "❌ plan saw a NEW path (404) but it exists now (200) — a page was created since planning;"
      echo "   do NOT overwrite on the stale confirmation — STOP and reconfirm"; exit 1
    fi
    echo "→ overwriting $P.html (existing page, confirmed in the plan)"
    ;;
  401) echo "❌ 401 on existence check — token missing, invalid or expired; re-auth (da-auth) and retry"; exit 1;;
  *)   echo "❌ unexpected $exists on existence check — resolve before writing"; exit 1;;
esac

# 3) Write content — multipart, field name MUST be "data", type text/html
req 200,201 -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@content/$P.html;type=text/html" \
  "https://admin.da.live/source/$DA_ORG/$DA_REPO/$P.html" >/dev/null   # 201 (new) or 200 (update)

# Preview — separate, required. Path WITHOUT .html; ref = $BRANCH_HOST (the dashed
# label, NOT the slashed git branch — see the BRANCH_HOST note above).
# The deploy sequence STOPS here, at preview. Publishing to the live host is a
# SEPARATE, FINAL step (see "Publish to the live host" after the pre-publish
# gate) that runs ONLY after every gate box passes AND only if the user asked to
# publish — never inline here, before verification.
req 200 -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/$GH_OWNER/$GH_REPO/$BRANCH_HOST/$P" >/dev/null
```

**Verify (do not skip).** Two stages — a fragment curl is *not* enough for a new
block, and it can *never* stand in for the browser stage:

*Stage A — server-side (curl the plain fragment; fast, no JS):*

```bash
BASE="https://$BRANCH_HOST--$GH_REPO--$GH_OWNER.aem.page/$P.plain.html"
curl -s --compressed "$BASE" | grep -c about:error        # expect 0 (no broken images)
curl -s --compressed "$BASE" | grep -o '<img' | wc -l     # expect = authored image count
curl -s --compressed "$BASE" | grep -o 'class="[a-z][a-z-]*"' | sort -u   # every authored block class present
```

Also confirm the **section count matches the plan** — top-level sections, not
every `<div>` (blocks and rows are divs too, so a raw `<div>` count runs several
times high). **Do not count this on `.plain.html`:** the fragment has **no**
`<main>` (nor `<section>`) wrappers — see the metadata scope-note below — so a
`<main> > div` count there is always 0. Count it on an artifact that has them:

```bash
# rendered (post-preview): EDS wraps each top-level section as <div class="section">
curl -s --compressed "https://$BRANCH_HOST--$GH_REPO--$GH_OWNER.aem.page/$P" \
  | grep -oE 'class="section[ "]' | wc -l    # expect = planned section count
```

or count the **top-level `<main> > div`** in the **local source** `content/$P.html`
before upload — it carries the Phase 4 `<body>/<main>` skeleton, so its direct
`<main>` children *are* the sections. Rich default content (heading / list / link
counts) *does* survive in `.plain.html`, so spot-check that there.

*Stage B — browser (testing-blocks); mandatory, and curl is not a substitute.*
**`.plain.html` shows blocks UNDECORATED** (`<div class="name">` with raw rows);
a block's JS runs in the **browser**, so the fragment — and a curl of the block's
CSS/JS, which only proves the files return `200` — can never tell you whether the
block **decorated** or whether it **looks like the design**. For a **new block**
(3B) that decoration and visual fit *are* the deploy's payoff, so this stage runs
through **testing-blocks**: render `https://$BRANCH_HOST--$GH_REPO--$GH_OWNER.aem.page/$P`
in a browser, confirm the block got `data-block-status="loaded"` with its
transformed DOM and applied CSS, and **compare the rendered block against the
Figma section screenshot** (get_screenshot from Phase 1). If **no browser is
available**, Stage B is **UNVERIFIED** — the page is **preview-only**, never
"done" (see the pre-publish gate). (Reused existing blocks are already
known-good, so Stage A suffices for them; Stage B still applies to their visual
fit if the token retheme changed their look.)

Non-obvious rules *(da-content / EDS)*:
- multipart field name is exactly **`data`** — other names silently 200 with
  nothing written.
- verify media on the **render host** (`…aem.page/$P.plain.html` or the page),
  **not** by GETting `content.da.live/…` directly — a direct GET returns `401`
  by design even when the upload succeeded and the pipeline internalizes it.
- payload is a **body fragment**, not a full document.
- upload only **stages** the doc; the page is not reachable until **preview**.
  Referenced binaries/external image URLs must be reachable at **preview** time.
- branch host `<branch-host>--<gh-repo>--<gh-owner>` must be **≤ 63 chars** or it
  won't resolve (asserted by the `host` length check in the deploy block above;
  `<branch-host>` is the deploy ref with slashes replaced by dashes).

For many pages, drive `PUT → preview` (publish stays a gated, post-verify step —
see below) with a concurrency pool + retry (`429`/`5xx`) rather than a
hand-rolled loop. Each page still clears the pre-publish gate
before it is eligible to publish; a gate failure on one page blocks that page's
publish, not the batch.

### Pre-publish gate — the page is not "done" until every box is checked

The verify steps above only help if you **act on a failure**. An autonomous run
tends to *note* a problem in the plan and ship anyway — **a plan note is not a
check.** The boxes below are split into two stages: **Stage A** is server-side
and can be cleared by `curl` of the fragment plus the referenced block CSS/JS and
assets; **Stage B** requires a real browser (via **testing-blocks**) and `curl`
is **not** an accepted substitute — a `200` on a block's CSS/JS proves the file
exists, never that the block decorated or matches the design. Fix-and-redeploy
any box that fails. **Any box you cannot positively verify counts as failed, not
passed** — an un-run check is a blocker, not a green light, and narrowing your
attention to this list must not drop a check the phases above already require.
**If no browser is available, the Stage B boxes are UNVERIFIED: report the page
preview-only and never call it "done."**

**Stage A — server-side (curl the fragment + referenced assets):**

- [ ] **The legibility check actually ran on real content** for every section
      whose text sits over media or a color fill — **every** text element, not
      just the heading (`h1`/`h2`/`h3`, `p`, `a`, `.button`, `li`). With a
      browser, read the rendered contrast; **with `curl` only it is still
      mandatory** — fetch the section's block CSS on the branch host and confirm
      each of those elements is given an explicit contrasting color (the
      colors-only-the-heading failure mode is the Phase 3A reuse gate). The fix is
      a dark variant *as a new isolated block/variant*, never an edit to the
      shared block; flagging it in the plan does **not** satisfy this box, and if
      you cannot verify legibility by either route the box is **FAILED** — block,
      never publish on an unchecked assumption.
- [ ] **No placeholder survived into the deployed output** — grep the fragment
      for `lorem`, CTA labels like "Button"/"Lorem Ipsum", and repeated-identical
      items; every item that should be distinct has distinct copy **and** a
      distinct image.
- [ ] **Every referenced icon resolves** — each `:x:` icon
      returns `200` at `/icons/x.svg` on the branch host (or is a full DA-`/media`
      URL on an `<img>`); **no emoji or Unicode glyph standing in for a designed
      icon.**
- [ ] **Every new block's code is live** — its JS **and** CSS return `200` on the
      branch host. (A `200` on the file proves it *exists*, not that the block
      *decorated* — that is the Stage B decoration box below.)
- [ ] **0 `about:error`** and the `<img>` count matches what you authored (both on
      `.plain.html`), and the **top-level section count** matches the plan —
      counted on the **rendered page** (`class="section"` under `<main>`) or the
      **local source**, **never** as `<main> > div` on `.plain.html` (no `<main>`
      there ⇒ always 0). See the Stage A verify block above.
- [ ] **The `metadata` block is present** — a `<div class="metadata">` (exact
      class) is the **last element of the last section** per Phase 4, carrying the
      keys the plan calls for (title, description, image, …). An
      intended-but-unauthored block — a bare `<!-- Metadata block -->` comment
      with no `<div class="metadata">` — is a **failed** box, not a passed one.
      (Scope note: the `.plain.html` fragment legitimately has **no**
      `<body>/<header>/<main>/<footer>` wrappers — it is a body fragment, so their
      absence there is **not** a defect. Check only for the `metadata` block.)

**Stage B — browser (testing-blocks); mandatory. `curl` cannot clear these:**

- [ ] **Every new block actually decorated** — on the **rendered** page
      (`…aem.page/$P`, not the fragment) the block element carries
      `data-block-status="loaded"`, shows its expected transformed DOM, and its
      CSS applied. The Stage A "code is live" `200` does **not** satisfy this — a
      block whose JS 500s on load still serves its JS file with a `200`.
- [ ] **The rendered result matches the design** — run **testing-blocks** to
      screenshot each new or restyled block on the rendered page and compare it to
      the Figma section screenshot (get_screenshot, Phase 1). A visible mismatch
      (layout, spacing, type scale, color, imagery) is a **failure to fix**, not a
      caveat to log — refine the block (as an isolated block/variant) and
      redeploy. This is the check whose omission most often ships a page that
      deploys cleanly but looks nothing like the design.

If **no browser is available**, both Stage B boxes are **UNVERIFIED** — do not
tick them and do not call the page "done"; report it **preview-only** and say
which checks could not run (Phase 6). Never substitute a Stage A `curl` for a
Stage B box.

If an item can't be fixed unattended (e.g. the design *itself* only contains
placeholder copy, or real icon SVGs aren't available), **stop and get the real
content/decision from the user** — don't publish the failing page and don't
fabricate the missing piece.

### Publish to the live host — the FINAL step, gated on the checklist

Publishing (`POST admin.hlx.page/live/...`) is **not** part of the deploy
sequence in Phase 5 — it is the **last** action, and it runs **only when both**
hold:

1. **Every** pre-publish gate box above **positively passed** — an unchecked or
   failed box blocks publish (fail-closed). A page with an unresolved gate item
   is preview-only, full stop.
2. The **user asked to publish.** Preview-only is the default deliverable — a
   page reachable at the preview host is usually enough. Do **not** publish to
   "save a round-trip," and never publish inline right after preview.

```bash
# Preconditions asserted by the caller: gate fully passed AND publish requested.
# ref = $BRANCH_HOST (dashed label, not the slashed git branch — see BRANCH_HOST note).
req 200 -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/live/$GH_OWNER/$GH_REPO/$BRANCH_HOST/$P" >/dev/null \
  || { echo "❌ publish failed — page stays preview-only"; exit 1; }
```
