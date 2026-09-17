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
      "checks": [ { "type": "click-dialog", "path": "/", "trigger": "a[href$='#modal']", "headingIncludes": "…", "minWidth": 700 } ]
    }
  ]
}
```

Check types (closed set, all replayable): `fetch-json` · `dom-count` · `click-dialog` ·
`search-query` · `form-flow` · `video-plays` · `consent-gate` · `no-page-errors` — fields in the
script header. A feature with no checks is listed under "features without checks" with its status
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
