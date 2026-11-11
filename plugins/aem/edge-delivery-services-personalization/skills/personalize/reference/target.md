# Target Sections (contract sections 6b and 7)

`Personalization Source | target` lets Adobe Target choose a section's variant.

- **What the skill does.** It wires sections to Target.
- **What it never does.** It never creates activities, audiences or offers. The Target user does
  that.
- **Out of scope.** AJO journeys, offer management's offer format, and Analytics for Target (A4T).

```
| Section Metadata          |                                                    |
| Personalization           | plan-offer                                         |
| Personalization Source    | target                                             |
| Personalization Variants  | /fragments/personalization/plan-offer/free-trial   |
|                           | /fragments/personalization/plan-offer/demo         |
| Personalization Location  | existing-mbox       (optional: else the section id) |
| Personalization Trigger   | scroll: 60%         (optional: makes it a popup)   |
| Personalization Display   | popup | inline      (optional)                     |
```

## Contents

- Mapping and what the Target user sets up
- Regions Target already owns
- Inline or popup
- Transport
- Consent, bots, budgets, edge
- Preview and tests

## Mapping and what the Target user sets up

| EDS | Target |
|---|---|
| Section | A location (mbox) named after the section id, or the `Personalization Location` row |
| Variant | A **JSON offer** `{ "fragment": "/fragments/personalization/<id>/<variant>" }` naming a listed variant (`target-offer.schema.json`) |
| Control (A/B) | A JSON offer `{ "control": true }`: the default shows, the outcome is `control`, and Target still gets display and click |
| Nothing returned | No activity qualified, or Target's default content: the default shows, outcome `no-match` |
| Context | Location parameters `device` (a `config.devices` name) and `visitor` (`new` or `returning`), plus Target's own (URL, geo, profile) |

The Target user creates an A/B Test or Experience Targeting activity on the location, with one
JSON offer per experience. Target assigns the visitors, keeps them in their experience and reports
results.

- An HTML offer, an offer that has both `fragment` and `control`, or an unlisted fragment gives
  outcome `fallback`.
- Variants are required and are the allowlist.
- A workspace property token goes in `config.target.propertyToken`.

## Regions Target already owns

The skill **asks which regions Target already changes**: Visual Experience Composer, at.js, or
Web SDK auto-rendering. The default answer is none of the requested sections. Those regions are
never personalized sections. `detect-project.mjs` reports `integrations.atjs`, `websdk`, `launch`
and `target`.

## Inline or popup

| Rows | Display | Behaviour |
|---|---|---|
| No Trigger, no Display | inline | The section is held until Target answers within its budget; the offer's fragment replaces the section's content |
| `Trigger` (any) | popup | The section shows its default at once. The offer opens in a modal dialog when the trigger fires |
| `Display \| popup`, no Trigger | popup | Trigger `scroll: 70%` |
| `Display \| inline` with a `Trigger` | inline | The Trigger is ignored (warning) |

**Triggers:**

- `scroll: N%`: the share of the page seen, `(scrollY + innerHeight) / scrollHeight`. It is
  checked on scroll events only, so a short page never opens the popup unless the visitor
  scrolls.
- `view`: 25 % of the section is visible.
- `load`: as soon as the offer is ready.

A popup opens at most **once per decision**. `pzn:applied` is sent once the offer's fragment is
loaded and the popup is armed. `pzn:seen` and the `display` notification are sent when it opens. A
`control` offer opens nothing, but `seen` and `display` are still sent when the trigger fires.

**The dialog** (`popup.js`) is a native `<dialog class="target-popup">` opened with
`showModal()`:

- It is labelled by the offer's first `h1` to `h4`, else by `aria-label`: the activity name, or
  `Offer`.
- A `.target-popup-close` button is labelled "Close". Escape and a backdrop click close the dialog
  and remove it.
- Its styles are in `styles/target-popup.css`: site-owned, created once, with a
  `prefers-reduced-motion` rule.

`?pzn-debug` shows the popup status: `armed`, `open`, `closed`, `waiting for consent`, `control`,
`control (triggered)` or `none`.

## Transport

`config.target.transport` selects one of two transports.

| | `delivery-api` (default) | `websdk` |
|---|---|---|
| When | No Web SDK on the page | The page already loads alloy (directly or through Tags) |
| Request | One Delivery API **prefetch** for every `target` section, each location with `parameters: { device, visitor }` | One `sendEvent` on `window[target.alloyInstance \|\| 'alloy']` with `type: "decisioning.propositionFetch"`, `renderDecisions: false`, `personalization: { decisionScopes, defaultPersonalizationEnabled: false }` |
| Offer | JSON offer content | JSON content item (`https://ns.adobe.com/personalization/json-content-item`) |
| Display | `display` notification when **seen** | Proposition display event when **seen** |
| Click | `click` notification on the first link click (`keepalive`) | Proposition interact event on the first click |
| Visitor id | `tntId` in localStorage `pzn-tnt-id`, with consent only | Owned by the Web SDK and its consent |
| Status | Built and tested with mocks | **Check it on a live datastream** (Adobe Experience Platform Debugger) before calling it supported |

**Delivery API details:**

- **URL.** The Delivery API URL is
  `https://<clientCode>.tt.omtrdc.net/rest/v1/delivery?client=<clientCode>&sessionId=<id>`. It
  can be replaced by `config.target.endpoint`: a same-origin proxy, or the local mock.
- **Session.** The session id is kept in sessionStorage (`pzn-tnt-session`). Later requests go to
  the edge host Target answered from (`pzn-tnt-edge`).
- **Notifications.** A notification is `ok` in `pzn:notified` **only when Target's answer lists
  the notification id**. There is no retry.
- **Tokens.** Event tokens stay in memory for the page view and are never stored.
- **Defaults.** `config.target` is
  `{ transport: 'delivery-api', clientCode, propertyToken, endpoint, timeout: 3000 }`. Without a
  `clientCode` the outcome is `fallback`.

Display and click go out at most once per `decisionId`. A re-evaluation with new Target tokens is
a new decision (`decisions-and-measurement.md`).

## Consent, bots, budgets, edge

- **Consent only, never through an exception.** Without consent no request is sent: inline
  sections show the default (`no-consent`) and popups wait (`waiting for consent`). When consent
  is given, `refresh()` decides them again.
- **Bots** get no request, the default, and no popup.
- **Budgets.** Inline sections are held within `budgets.eager` / `budgets.lazy` like any section.
  The request itself is a `fallback` after `target.timeout`. A held **first section** costs LCP,
  and the edge never decides target sections, so use a later section or a popup.

## Preview and tests

- **Preview.** `?pzn=plan-offer:free-trial` forces an offer without calling Target;
  `?pzn=plan-offer:default` forces the default, and no popup.
- **Mock activities** (`mock-engine.js`). In `activities.json`, each location maps to an activity.
  Experiences are checked in order, and the first whose audience matches wins; `null` matches
  everyone. Audiences use the condition syntax over the location parameters and the page's URL
  params:

  ```json
  { "plan-offer": { "name": "Plan offer (A/B)", "experiences": [
      { "name": "Control", "audience": "visitor: returning", "control": true },
      { "name": "Enterprise", "audience": "param: utm_campaign=enterprise", "offer": "/fragments/personalization/plan-offer/demo" },
      { "name": "Everyone", "audience": null, "offer": "/fragments/personalization/plan-offer/free-trial" } ] } }
  ```

- **Simulate.** `simulate.mjs content/<page>.html --target activities.json` gives the offer per
  case.
- **Browser setup.** Use one of these:
  - set `config.mock = { target: <activities> }`. It answers in the browser, which is needed on
    aem.page and for `--faults`;
  - run `node scripts/mock-decision-api.mjs --target activities.json` and point
    `config.target.endpoint` at `http://localhost:4100/rest/v1/delivery`, for the test only.
- **Browser checks.** `verify-preview.mjs --target activities.json` checks the following:
  - inline offers: the variant, its content, one `display` once seen, and `click` on click;
  - popups: closed before the trigger and open past it; modal and labelled; `display` notified;
    Escape closes the popup, and it doesn't reopen;
  - with `--faults`: a Target failure gives `fallback`, and a 3.5 s answer gives `timeout`.
- **Before launch.** Revert `config.mock` and `target.endpoint`.
