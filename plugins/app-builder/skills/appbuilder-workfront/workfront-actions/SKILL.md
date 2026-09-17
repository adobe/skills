---
name: workfront-actions
description: "Use when writing or fixing the server-side code of a Workfront App Builder extension — the Adobe I/O Runtime action the React SPA calls to do work the browser can't. Reach for this whenever the user is: structuring or editing action code; deciding what shape an action returns so the frontend can tell success from failure (the {data,error} body); passing the IMS token through and calling an external API from the backend so credentials never reach the browser; calling Workfront's own Public API v21 (search/count, bulk PUT with the updates param, custom DE: field filters); calling Workfront Planning or another Adobe service; or troubleshooting why a deployed action can't read secrets (process.env is empty once deployed — inputs flow .env → config inputs → params). Also covers CommonJS-only structure, require-adobe-auth, and registering actions in app.config.yaml / ext.config.yaml. For generic non-Workfront action templates and SDKs see appbuilder-action-scaffolder."
license: Apache-2.0
---

# Workfront Runtime actions

Actions are the **back end** — small functions Adobe runs in its cloud on demand ("serverless"; Adobe I/O Runtime, built on OpenWhisk). The front end (SPA, see `workfront-ui-extension`) calls them via `actionWebInvoke`; they hold the credentials and call external APIs. **The browser must never call Workfront/Adobe APIs directly** — that is the action's job, so login tokens never reach the user's browser.

> For generic action *patterns and templates* (webhook receiver, database CRUD, custom event provider, journaling consumer, large-payload redirect, action sequence, Asset Compute worker) and the App Builder SDKs (State/Files/Events/DB), use **`appbuilder-action-scaffolder`**. This skill is the **Workfront-specific** layer: the `{data,error}` contract, IMS passthrough, and Workfront's own Public API.

## Anatomy

```
actions/<name>/index.js     # exports main(params)
```

- **CommonJS only** — export your function as `exports.main`. (App Builder supports only CommonJS, not ES Modules.)
- Register every action in `app.config.yaml`, or in an extension's `ext.config.yaml` (which compiles into `app.config.yaml`), following the OpenWhisk wskdeploy YAML spec.

```js
async function main (params) {
  // ...
  return { statusCode: 200, body: { data, error: null } }
}
exports.main = main
```

## Response shape

Always return `{ data, error }` in the body; the UI checks `error` before using `data`.

```js
return { statusCode: 400, body: { data: null, error: 'missing parameter(s) ...' } }
```

## Auth & inputs

- **`require-adobe-auth` is a per-action choice, *off* by default** (the platform default) — decide deliberately, don't blanket-enable it. When `true`, Adobe validates the user's IMS token at the gateway before your code runs.
  - Turn it **on** when the action itself is the security boundary (privileged work, or nothing downstream authorizes the caller).
  - Leave it **off** when the downstream API enforces its own authorization — e.g. the action just forwards the user's `imsToken` to Workfront/Planning, which rejects bad tokens — or unless explicitly asked to enable it.
- The UI passes `imsToken` (→ `Authorization: Bearer …`) and the Workfront instance URL as **params**; never hardcode them.
- **The IMS org id is in the shared context at `auth.imsOrgID`** (capital `ID` — not `imsOrgId`/`imsOrg`; that casing trap costs hours). The front end reads `sharedContext.get('auth').imsOrgID` and passes it down; the action uses `params.imsOrgId` / the `x-gw-ims-org-id` header. Two traps: (1) **reject the strings `"undefined"`/`"null"`/empty** — an empty front-end value becomes the header string `"undefined"` (→ `401 "Org Id undefined is not in the list of user org Ids"`); (2) with `require-adobe-auth: true` the gateway validates the org header *before* your code runs.
- **Inputs flow `.env` → action `inputs` (in config) → `params`. Do NOT read `process.env` at runtime.** Under `aio app dev` actions run in-process, so `process.env` may *appear* to work locally but will be empty once deployed. Wire keys/secrets as `inputs` and read them from `params`.

## Calling external APIs (the pattern)

For any API — Workfront, Planning, Adobe services:

1. Receive `imsToken` plus any `apiKey` / IDs as `params`.
2. `fetch` the **public** REST endpoint with `Authorization: Bearer <imsToken>` (add `x-api-key` / `x-gw-ims-org-id` where required).
3. Map the result to `{ data, error }`. Never log the token.

- **Workfront Planning** → **verify the Workfront MCP is connected, then fetch the v2 endpoint reference and data from it** (details in `references/integrations.md`); if it isn't connected, stop and tell the user to connect the Workfront MCP before continuing. **Other Adobe services** → `references/integrations.md`. Confirm endpoints from the live source rather than guessing.

## Workfront Public API v21.0

Workfront's own REST API — the `/attask/api/v21.0` layer. Call it from an action (never from the SPA).

- **wfClient / base URL:** `{workFrontInstanceUrl}/attask/api/v21.0{path}` — a single version constant. `workFrontInstanceUrl` and `imsToken` arrive as **params** (never hardcoded).
- **Search / count** objects (projects, tasks, issues) via the documented query params; map the response into `{ data, error }`.
- **Custom `DE:` fields** need `{field}_Mod=notblank` on search/count, or they are silently omitted from results.
- **Bulk update** with `PUT /{obj}?updates=[...]` (the `updates` array in the query string) — **chunk** requests to stay under the ~8 KB URL-length limit; fall back to per-record `PUT /{obj}/{ID}` when a chunk is still too long.
- Wrap the calls in a small `wfFetch` helper; register the action in `app.config.yaml`; the SPA reaches it via `actionWebInvoke` only.

## Time budget

The action the SPA calls via `actionWebInvoke` is a **web action**, so it's bound by Adobe I/O Runtime's **60 s cap** on web/blocking actions — raising `limits.timeout` doesn't lift it (full limits table in `appbuilder-action-scaffolder`). So don't fetch or process a big dataset in one call: page Workfront **search** and **chunk** bulk-PUT work across multiple `actionWebInvoke` calls (see *Workfront Public API v21.0* above), and show partial progress from the UI. A user-facing timeout is a *candidate* action-timeout, but can equally be a slow CDN/static load, cold start, or downstream API — check `aio app logs` before concluding.

## Add a new action

1. `aio app add action` (or hand-create `actions/<name>/index.js`).
2. Register it in `app.config.yaml` / `ext.config.yaml` with a **`runtime` kind** (e.g. `runtime: nodejs:20`) and its `inputs`; set `require-adobe-auth` per the Auth & inputs rule above. **`runtime` is mandatory** — deploy fails with *`Invalid or missing property "runtime"`* without it (and, when `require-adobe-auth` is on, the same error fires on the generated `__secured_<action>` wrapper).
3. Expose its URL to the SPA (the UI reads injected action URLs — never hardcodes them). See `workfront-ui-extension`.
4. Add tests under `test/actions/`; run `aio app test`. View logs with `aio app logs` (command catalog: `appbuilder-workfront` → `references/commands.md`).
5. Deploy with `aio app deploy`. A ready-to-edit starting point is in `assets/action-boilerplate.js`.
