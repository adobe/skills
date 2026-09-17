# Forms

## 1. Record the live form as a definition — controls, not `<form>` tags

`scripts/snapshot-forms.mjs` collects content-area `input/select/textarea` controls (chrome, search,
consent, login excluded; forms inside dialogs included), groups radio/checkbox by name, reads label,
section heading, required, options **after settle** (servers ship selects empty and fill them
client-side — 53 states / 260 countries in one case), conditional visibility, the submit label and
hidden field names, and flags `piiSignals`. Output `data/forms/<name>.json` with provenance. Forms
the source has retired become the same notice, not a form.

## 2. Key the inventory on name + field signature, never on `action`

Modern forms carry no action (endpoint injected at runtime) or no form tag at all. Field-signature
→ disposition heuristics that held across sites: `tel:amount,rate,term` = calculator
(`client-only`); `select:score,issuer` = in-DOM filter (`client-only`); `text:q` / `role=search` =
site search (`index-backed`, needs a results page); email + message = intake (`rebuild-native`,
`needs-backend`).

## 3. Decide the intake by content source

| content source | sheet intake | interim | production |
|---|---|---|---|
| SharePoint / Google Drive | POST to the published `incoming` sheet works | sheet | sheet, forms service, vendor endpoint |
| Document Authoring | **none** (origin `.json` POST → 405, admin form endpoint → 404) | definition-driven block + configurable endpoint + **local capture with an explicit "no backend connected" message** | forms service, the customer's endpoint on the production host, or a relay the owner runs |

Never pretend: success copy on a captured submission says it was captured locally.

## 4. The block

Definition-driven (`Source | /data/forms/<name>.json`) or field rows; optional `Action`, `Success`,
`Intro`. Sections, selects with a placeholder option, choice groups, required marks, validation copy
from live, dependent fields follow their controlling option, **empty submission refused**, honeypot
instead of the source's anti-forgery token, posts `{ data, page, timestamp }` as JSON to `Action` or
a per-page endpoint in `scripts/site-config.js` (empty = native post). Vendor-backed flows
(marketing-automation token + antibot key) **cannot be replayed off-origin**: keep the token fetch
client-side and let the owner name the vendor form id and field mapping.

## 5. Regulated data — hard rule

`regulated-pii` (SSN, date of birth, financial account, minors, ID upload): rebuild the UI with
submission **blocked** until a human configures the secured endpoint; never route to a sheet or a
generic handler; never replicate a payment or card capture on a sandbox. Most intake help pages
deep-link to an authenticated app — migrate the link, do not manufacture a form.

## 6. Verify (flow)

Empty submit → refused with the live wording; filled submit → reaches the endpoint (capture count
or backend row); success copy shown; no page errors. `dynamics-check.mjs` type `form-flow`.
