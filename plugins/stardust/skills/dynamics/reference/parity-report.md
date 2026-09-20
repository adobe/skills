# Dynamic parity report

Lives at `stardust/dynamics/parity.json`, written by the implement step, replayed by
`scripts/dynamics-check.mjs` into `stardust/qa/dynamics-report.md` (+ `.json`), surfaced by the qa
`dynamics` check and the rollout report. It sits next to the pixel gate and answers "what does the
site *do* now?".

## Schema

```json
{
  "_provenance": { "writtenBy": "stardust:dynamics", "writtenAt": "<iso>" },
  "method": "one line: how features were fed / built",
  "features": [
    {
      "id": "contact-modal", "feature": "contact modal", "class": "M", "pages": 49,
      "disposition": "rebuild-native", "reproducibility": "self",
      "status": "done | interim | scaffolded-awaiting-owner | decided-out | pending <phase> | skipped-source-broken",
      "verifiedBy": "numbers: dialog 731px; heading; 22 fields; Escape closes",
      "owner": "optional: the exact decision the owner must take",
      "environmentLimit": "optional: what the test network cannot reach, egress region, why it is not a defect",
      "snapshot": "optional: date of the data snapshot the feature runs on",
      "checks": [ { "type": "click-dialog", "path": "/", "trigger": "a[href$='#modal']", "headingIncludes": "…", "minWidth": 700 },
                  { "type": "search-query", "path": "/search", "terms": ["<noun>", "<noun>", "<noun>"], "resultSelector": ".results li", "compareLive": { "url": "https://<live>/search", "resultSelector": ".result" }, "itemPattern": { "title": "h3", "href": "a", "pagination": ".pagination" } } ]
    }
  ]
}
```

Check types (closed set, all replayable): `fetch-json` · `dom-count` · `click-dialog` ·
`search-query` · `form-flow` · `video-plays` · `consent-gate` · `no-page-errors` · `listing-rows`
(`{ path, block, index?, minRows? }` — authored rows of the block in `<path>.plain.html`, minus
heading and label-list rows; one per listing page) — fields in the script header. A feature with no checks is listed under "features without checks" with its status
and owner; `decided-out` rows belong there.

## Rules

1. **Flows, not presence.** A check passes when the user-visible flow completes. "Block rendered" or
   "iframe present" is not a pass; an empty submission that "succeeded" was the first real defect a
   replay found.
2. **Numbers, not adjectives.** `verifiedBy` carries counts and samples so a regression is diffed,
   not re-discovered.
3. **Secrets to the origin only.** The site token rides a `context.route` filter on the origin host,
   never context-wide headers: a credentialed cross-origin XHR fails the vendor's CORS and the probe
   reports a vendor error real users never see. The replay records **third-party request statuses
   next to every DOM assertion** so a probe-induced failure is distinguishable from a vendor
   restriction.
4. **Environment limits are rows, not failures.** Geo-fenced hand-off targets: fresh context, no
   referer, record the egress region, ask for verification from the right region.
5. **Decided-out is explicit.** Reason + production statement, here and in the inconsistency
   register.
6. **Owner decisions by name.** `scaffolded-awaiting-owner` lists the exact decision, so the report
   is honest about what runs.
7. **Re-run after every phase** and before the final report. The check is read-only.
8. **`--gate` is the close-out condition.** `dynamics-check.mjs --origin <live> --gate` exits 3 when:
   this file is missing; a `reproducibility: self` row is still `pending*` / `in-progress`; a built
   S row (`done`, not `delivered-by-capture`) has no `search-query` carrying `compareLive` or
   `minResults`; a built V row whose `disposition` / `pattern` is `embed-passthrough`, `media-as-url`
   or `hls-stream` has no `video-plays`; a built `index-backed` row (disposition or pattern) while
   `stardust/dynamics/index-status.json` is missing or records `registered: denied` — exit 0 of
   `skills/rollout/scripts/query-index.mjs` clears it. Rollout Phase H and the pilot-only chain do not close while
   it exits non-zero. Undelivered non-`self` rows never block — they stay `interim` with a named
   owner decision; a blocked `self` row is implemented, or set `status: interim` with a one-line
   reason and a named owner decision, never left `pending`. The report always ends with "Delivered /
   interim / decided-out" counts and "Values the owner must supply" (feature · `owner`).
   Fixture-tested: `scripts/test/gate.test.mjs`.
