# DA Deploy Protocol

Reference for the headless deploy sequence: write the sanitised **body-fragment** HTML to DA via the Source API, then preview. Replaces the older `aem put` / `aem preview` / `aem publish` pipeline.

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
until curl -s --compressed "https://$BRANCH--$REPO--$ORG.aem.page/blocks/<edited-block>/<edited-block>.js" \
  | grep -q "<a marker string from your edit>"; do sleep 3; done

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
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "$u")" = "200" ]; do sleep 3; done
done
# NB (#2): this bare-curl wait is for repo-relative /img/ assets only. Do NOT bare-curl
#   - content.da.live/admin.da.live media URLs — they 401 to anon curl but ingest fine
#     (verify them via step 3b about:error instead); and
#   - external SOURCE/CDN <img> srcs on a bot-walled origin (Akamai/Cloudflare 403 a curl
#     while serving a real browser) — verify those with the recorded headed-chrome in-page
#     fetch, and rehost a 403'd asset to DA media rather than omitting it
#     (see deploy SKILL "The ENCODE contract → Images" image-fidelity rules).

# 3. preview (separate, required; path WITHOUT .html; ref = the code branch)
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/$ORG/$REPO/$BRANCH/$P"       # expect 200

# 3b. VERIFY ingestion on the delivered .plain.html (per page; assets gzip → --compressed):
#   (i)  no broken-image ingestion (#75) — must be 0; if not, an asset wasn't on Code Bus
#        yet. Re-run step 3 (preview is idempotent; it re-ingests and repairs).
#   (ii) authored EDITORIAL images actually landed — assert the expected <img>/alt count.
#        CSS-background images are absent from .plain.html, so "it renders" is NOT proof
#        that an image is authorable/AI-visible (see SKILL "The ENCODE contract → Images").
curl -s --compressed "https://$BRANCH--$REPO--$ORG.aem.page/$P.plain.html" | grep -c about:error      # expect 0
curl -s --compressed "https://$BRANCH--$REPO--$ORG.aem.page/$P.plain.html" | grep -oc '<img'          # expect = authored editorial image count

# 4. (optional) publish to aem.live
curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/live/$ORG/$REPO/$BRANCH/$P"
```

URLs: DA edit `https://da.live/#/$ORG/$REPO/$P` · preview `https://$BRANCH--$REPO--$ORG.aem.page/$P` · live `https://$BRANCH--$REPO--$ORG.aem.live/$P`. Token pre-flight: a 401 with empty body means it expired (dev tokens last ~24h) — re-auth.
