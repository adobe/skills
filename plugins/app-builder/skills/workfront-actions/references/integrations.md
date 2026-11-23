# Action integrations: Workfront, Planning, other Adobe services

All integrations use the IMS Bearer token passed from the UI. Read everything from `params` (wired via `.env` → action `inputs`), never `process.env`. Always return `{ data, error }`. Never log tokens.

## Common headers

- `Authorization: Bearer <imsToken>` — always.
- `x-api-key: <apiKey>` — when the service requires an API key (from the workspace credentials; pass it in as an input).
- `x-gw-ims-org-id: <orgId>` — many Adobe APIs require the IMS org id.

## Workfront (Public API)

See the `workfront-actions` skill for full detail. Base: `{instanceUrl}/attask/api/v21.0{path}`; supports `search` / `count`, bulk `PUT ?updates=[...]` (chunk for URL-length limits), and `DE:` custom fields (add `{field}_Mod=notblank`). The instance URL comes from the shared context — never hardcode it.

## Adobe Workfront Planning

> **Always verify the Workfront MCP is connected before doing any Planning work.** The Planning (Maestro) API reference and data come **only** from the Workfront MCP — use it, and *only* it, to fetch Planning API resources (Workspaces, Record Types, Fields, Records, Views, Permissions, History — v2 endpoints). If the Workfront MCP is **not** connected, stop and tell the user to connect the Workfront MCP before continuing — do not guess endpoints, hardcode paths, or fall back to remembered/static references.

- **Base URL**: `https://{customer-domain}/maestro/api/...` — `{customer-domain}` is the customer's Workfront host (confirm per environment).
- **Auth**: `Authorization: Bearer <imsToken>` **and** `x-gw-ims-org-id: <orgId>` (both required); `x-api-key` per your IMS integration. Errors are RFC 7807 (`application/problem+json`) with an `errorCode`.
- **Limits**: bulk/move/delete arrays ≤ 100; list `limit` max 50 or 100 depending on resource.

The action pattern is identical to any integration: token + IDs arrive as params, you `fetch`, then map the response to `{ data, error }`. Ground every endpoint and payload shape in the live Workfront MCP source (per the callout above) — never in remembered or hardcoded references.

## Other Adobe services (Analytics, Target, AEP, Campaign, …)

`aio app init` can scaffold sample actions per service, with the right SDK and dependencies. Each requires:

- The **service added to the current workspace** in the Developer Console (credentials are per-workspace, not shared).
- The API key, which lands in `.env` / `console.json` — pass it to the action as an input.
- Product-specific values (tenant id, company id, etc.) that are **not** available from the CLI — get them from the product's documentation and pass them as inputs.

## Pre-flight checklist

- Service added to the *current* workspace (creds differ per workspace).
- All required params present — otherwise return a clear `missing parameter(s) '...'` error.
- `require-adobe-auth: true` so the token is validated before your code runs.
