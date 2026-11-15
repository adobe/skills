# stardust:migrate: phase 4, state and report

The text of this part of `skills/migrate/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 4 — State and report

Update `state.json`:

- For each successfully migrated page: `status` advances to
  `migrated`, append a history entry, clear any `stale` flag,
  set `migratedPath`.
- For pages skipped via idempotent skip: leave state
  unchanged.
- For pages that failed validation: leave state unchanged, log
  the failure in `state.json.lastRun.failures[]`.
- Write the top-level `migrate` block per
  `skills/stardust/reference/migrate-output-format.md`
  § State.json contract: `selfContained: true`, `outputDir`,
  `totalAssetsBundled`, `bundledAssets[]`, per-page
  `assetsBundled` counts, `missingAssets[]`, `cleanedAssets[]`.
  This is the forward-compat signal downstream consumers test
  for.

Print the run summary:

```
migrate complete
================

 122 migrated         home, about, news/post-housing-summit, ...
   3 unchanged        about, programs/shelter, news/post-old (idempotent skip)
   2 failed           contact (validation: required slot missing),
                      legal/privacy (validation: color-reservation violated)
   0 stale skipped

Render branches:
  Path A   6   approved-from-prototype
  Path A'  116 template-applied (84 article, 5 listing, 11 program, 2 form, 14 static)
  Path B   3   unique-render (404, search, faq)

Pages with non-trivial decisions: 12
  about            canon-deviation: footer carries financials disclaimer
  donate           template-adapted: amount-pills slot moved above headline
  ...

Broken internal links: 5
  /events       referenced by 2 pages; not in inventory
  /press        referenced by 1 page; not in inventory
  ...

Bespoke slots crossing promotion threshold: 1
  hotline-211: "state"  (3 instances) — consider `$stardust prepare-migration --refine-module`

Missing assets: 2
  generated/orphan-1.jpg     referenced by 1 page  (home)
  generated/orphan-2.jpg     referenced by 2 pages (about, contact)
  (Re-extract or accept the gap — bundle is deployable; refs 404 at view time.)

Output:  stardust/migrated/  (122 pages, 47 bundled assets, 4.2 MB) — self-contained, zip-and-deploy

Next:
  - Review:    open stardust/migrated/index.html in a browser
  - Audit:     $impeccable critique stardust/migrated/
  - Deploy:    cd stardust/migrated && zip -r ../site.zip .
               upload the zip to any static host that serves at the host root
  - Refine:    edit DESIGN.md or canon files, then re-run $stardust migrate
```
