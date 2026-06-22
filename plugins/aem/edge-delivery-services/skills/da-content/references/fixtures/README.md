# Asset boundary fixtures

Empirical test fixtures used to verify the asset-handling rules in
[references/media.md §2 (Asset lifecycle)](../media.md). If
EDS preview-time sideloading behavior changes, re-upload these and
diff the rendered output to confirm.

## What's here

| File | Purpose |
|---|---|
| `asset-boundary-test.html` | Source HTML with 10 image URL forms (A–J): external reachable, DNS-fail, non-image content-type, self-host Media Bus, dedup, anchor href, SVG, section-metadata Background, page-metadata image. |
| `asset-boundary-test.expected-rendered.html` | Captured `aem.page` output for the file above, taken 2026-05-21. Each test case's outcome is in the table below. |
| `asset-boundary-test-v2.html` | Source HTML for 5 more cases (K–O): content.da.live same-org, content.da.live cross-page dedup, aem.page non-`media_*` path, content.da.live other-org, repo-relative. |
| `asset-boundary-test-v2.expected-rendered.html` | Captured `aem.page` output for v2. |

## Expected outcomes

| # | Source URL form | Delivered output |
|---|---|---|
| A | External reachable picsum in `<img src>` | Sideloaded → `./media_<hash>.jpg` + responsive `<picture>` |
| B | External in author `<source srcset>` | Sideloaded → author `<picture>` replaced by pipeline `<picture>` |
| C | DNS-fail URL (`*.invalid/foo.png`) | `<img src="about:error">` |
| D | URL returning HTML, not image | `<img src="about:error">` |
| E | aem.page Media Bus path (`media_<hash>`) | Recognized; not re-fetched; relative-rewritten |
| F | Same URL as A (dedup) | Same hash as A |
| G | External URL in `<a href>` | Preserved as anchor; **not sideloaded** |
| H | External SVG (wikimedia) | Sideloaded → `./media_<hash>.svg` + responsive `<picture>` |
| I | Section-metadata `Background` cell URL | Preserved as `data-background="<URL>"`; **not sideloaded** |
| J | Page-metadata `image` block | Sideloaded; hash propagated to `og:image` / `twitter:image` |
| K | `content.da.live` same-org/repo | Sideloaded → Media Bus |
| L | Same content.da.live URL as K | Deduplicated |
| M | aem.page non-`media_*` path | `<img src="about:error">` (aem.page doesn't serve plain binaries) |
| N | content.da.live cross-tenant | `<img src="about:error">` |
| O | Repo-relative `/path/foo.png` | `<img src="about:error">` |

## How to re-verify

Uploads target a DA project the skill author controls. To re-run against
a different project, edit the URLs at the top of each `*-test.html`
file, then:

```bash
TOKEN="${DA_TOKEN:?invoke the da-auth skill to obtain a DA admin token}"
ORG=<your-org>
REPO=<your-repo>
PATH_PREFIX=<your-path>

# Upload binary referenced by v2 test K/L
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -F "data=@test-image.png;type=image/png" \
  "https://admin.da.live/source/$ORG/$REPO/$PATH_PREFIX/test-media-asset.png"

# Upload + preview each HTML fixture
for f in asset-boundary-test.html asset-boundary-test-v2.html; do
  curl -X PUT -H "Authorization: Bearer $TOKEN" \
    -F "data=@$f;type=text/html" \
    "https://admin.da.live/source/$ORG/$REPO/$PATH_PREFIX/$f"
  curl -X POST -H "Authorization: Bearer $TOKEN" \
    "https://admin.hlx.page/preview/$ORG/$REPO/main/$PATH_PREFIX/${f%.html}"
done

# Fetch rendered HTML
for f in asset-boundary-test asset-boundary-test-v2; do
  curl -s "https://main--$REPO--$ORG.aem.page/$PATH_PREFIX/$f" > $f.rendered.html
  diff $f.expected-rendered.html $f.rendered.html
done
```

Differences in `media_<hash>` values are expected (picsum.photos seeds
generate different bytes per server). Differences in URL forms (e.g., a
case that previously sideloaded now produces `about:error`) indicate
a real behavior change worth investigating.
