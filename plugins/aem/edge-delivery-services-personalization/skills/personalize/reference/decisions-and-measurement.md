# Decisions and Measurement (contract sections 4 and 9)

## Contents

- Outcomes
- Events
- Decision identity and re-evaluation
- Where events go
- Analysis views
- Debugging

## Outcomes

Every decision ends with exactly one outcome. It is written on the section as
`data-pzn-outcome` and sent in `pzn:decided`.

| Outcome | Meaning | Shows | `assigned` |
|---|---|---|---|
| `variant` | A variant was chosen | Variant | The variant |
| `control` | The control arm: the split default arm, an engine `{ "control": true }`, or a Target `{ "control": true }` offer | Default (no Rule rows) | `default` |
| `intentional-default` | The engine chose the authored content as the best fit (`variant: "default"`) | Default (no Rule rows) | `default` |
| `no-match` | No rule matched; the engine had no candidate, didn't answer for the section, or gave an unlisted reason; Target returned nothing | Rule rows for `api`, else default | Absent, unless Rule rows picked a variant |
| `low-confidence` | The engine answered `reason: "low_confidence"` | Rule rows for `api`, else default | Same as `no-match` |
| `no-consent` | No consent and no approved exception; also an `api` section whose Rule rows decided under the `rules` exception (`source: rules`, contract Q14) | Default, or the Rule rows' pick under the `rules` exception | Absent, even when the Rule rows picked a variant |
| `fallback` | The source failed (HTTP error, bad JSON, `provider_error`, `invalid_choice`, request timeout) or answered something not listed | Rule rows for `api`, else default | Same as `no-match` |
| `timeout` | The section's budget ran out | Default | Absent |
| `error`, `invalid` | A code error, or invalid rows | Default | Absent |
| `bot`, `override` | Crawler, or a `?pzn=` preview | Default, or the forced variant | `override`: the forced variant |

When an `api` section falls back to its Rule rows, the outcome still says why the engine wasn't
used, `source` becomes `rules`, and `variant` is what the Rule rows picked. `data-pzn-reason` and
the event's `reason` keep the detail: `HTTP 500`, `not listed: x`, `fragment failed: /path`,
`no decision`, or the engine's code. **The reason a default was shown is never lost.**

## Events

Every event has `id`, `decisionId`, `variant` (what is shown), `source`, `where` (`browser` or
`edge`) and `outcome`. It also has `assigned` when a source assigned something. Schema:
`assets/contract/schemas/measurement-event.schema.json`.

| Event | When | Also carries |
|---|---|---|
| `pzn:decided` | A source answered (or failed) | `trigger` (`initial`, `refresh`, `state`, `consent`), `reason`, `ms`, `cached`, `tracking`, `test` |
| `pzn:applied` | The page shows the result | `result`: `applied`, `kept-default`, `unchanged`, `failed` |
| `pzn:seen` | At least `analytics.seenThreshold` (25 %) of the section is visible; a popup when it opens | `result`, `tracking`, `test` |
| `pzn:clicked` | The first link click inside the section | `result`, `href` (no query or hash) |
| `pzn:notified` | A Target notification (`display`, `click`) or engine feedback (`seen`, `clicked`) was sent | `notification: { product, type, ok }` |

`seen`, `clicked`, Target display/click and engine feedback go out **at most once per
`decisionId`**. Some outcome and result combinations are not allowed; `scripts/schema.mjs` checks
them:

| `outcome` | `result` | `variant` shown |
|---|---|---|
| `variant` | `applied`, `unchanged` | The assigned variant |
| `variant` | `failed` | `default` |
| `control`, `intentional-default` | `kept-default`, `unchanged` | `default` |
| Any other | `applied` or `unchanged` (Rule rows picked a variant), `kept-default`, `failed` | What is shown |

A failed treatment is therefore `assigned: "pro", variant: "default", result: "failed"`. A
visitor without consent has `outcome: "no-consent"` and no `assigned`, so neither can look like
control exposure.

`split` sections carry `test: { type: "split", weights }`; `target` sections carry
`test: { type: "target" }`, with Target's activity and experience names in `tracking`.

## Decision identity and re-evaluation

`decisionId` is `<section id>#1`, then `#2` and so on within the page view. It is new on every
page view, even for a cached answer (`cached: true`; the engine's own id in `tracking` keeps its
original value).

Two evaluations are the same decision only when all of these are equal: `source`, `assigned`,
`outcome`, `reason`, `cached`, `tracking`, `test`, and the Target notification tokens. A
re-evaluation comes from `refresh()`, `setState()` or a consent change.

| The new evaluation | Decision | Events |
|---|---|---|
| Same identity | The same `decisionId` | None. It is listed in the `?pzn-debug` table with its `trigger` |
| Same variant, different identity | New `decisionId` | `decided`; `applied` with `unchanged`; `seen` again (at once if the section is visible); then `clicked`, notifications and feedback for the new decision |
| A different variant, or the default | New `decisionId` | The full set, as on page load |
| Consent withdrawn | New `decisionId`; the default is restored, outcome `no-consent` | Only what the `rum` and `data-layer` exceptions allow |

Variant equality alone never suppresses events: identity decides. An older answer that arrives
late is ignored.

## Where events go

- **DOM.** A `CustomEvent` with the event name is dispatched on the section (it bubbles).
  `detail` is the `personalization` object.
- **Data layer.** `window.adobeDataLayer.push({ event, personalization })`, when
  `analytics.dataLayer` is on (the default). The array is created if missing. The site's
  Tags/Analytics rules map these events.
- **RUM.** On `pzn:applied`, for successfully applied arms only, when `analytics.rum` is on (the
  default):
  - `sampleRUM('experiment', { source: <id>, target: <assigned> })` for `split` sections;
  - `sampleRUM('audience', …)` for other sections with outcome `variant` or `intentional-default`.

  RUM is sampled and marks **application**, not exposure. The full record is the data layer.
- **Target and engines.** Target gets its display and click notifications (`target.md`). The
  engine gets optional feedback (`decision-api.md`).

All of this follows the consent policy: without consent, only what the `rum` and `data-layer`
exceptions allow is sent (`consent.md`).

## Analysis views

Report these three views together:

1. **Assignment** (the A/B population): `pzn:decided` with outcome `variant` or `control`
   (`intentional-default` as its own group). It includes visitors whose treatment then failed.
2. **Application**: `pzn:applied` for the same decisions. It shows the failure rate per arm.
3. **Exposure**: `pzn:seen` with a successful result. This is a secondary, filtered view and never
   replaces the assignment population.

Failed treatments stay in their assigned arm. Timeouts, fallbacks, low confidence, no match and
no consent are in no arm; report their counts beside the test.

## Debugging

`?pzn-debug` prints a table with these columns: id, decisionId, variant, source, outcome, reason,
ms, cached, trigger, popup status and notifications. `window.hlx.personalization.decisions` holds
the same rows, including evaluations that produced no new decision.
