# Contracts reference

Build contracts from browser observations plus static candidates:

```bash
node scripts/api-contracts.mjs --observations stardust/api/observations.json --static stardust/api/static-candidates.json --out stardust/api [--fixture id=file] [--offline]
```

One integration is grouped by host + method + path pattern, plus GraphQL operation name when present. Static-only candidates remain in the inventory with `confirmed: false` and `status: detected`.

## Contract fields

Each `stardust/api/contracts/<id>.json` carries:

| field | meaning |
|---|---|
| `id` | stable integration id. |
| `endpoint`, `method`, `kind` | endpoint URL/pattern, HTTP method, and `rest-read`, `rest-write`, `graphql-query`, or `graphql-mutation`. |
| `origin` | `first-party`, `api-subdomain`, or `third-party`. Unknown third-party data hosts stay visible as inspect. |
| `trigger` | `load` or interaction trigger with selector. |
| `pages`, `reach` | pages where seen and known reach. |
| `auth` | `none`, `cookie`, `bearer`, or `api-key` plus header names. Derived from request headers only; cookie values used in payloads are `clientDeps`, not auth. |
| `contentType` | captured request content type. |
| `graphql` | `{ operationName, type, variables, persistedHash }` for GraphQL, otherwise `null`; variable values are redacted/placeholders. |
| `requestSchema`, `requestExample` | inferred schema and redacted example. Placeholders map back to schema formats. |
| `fieldMap` | UI-to-payload entries `{ path, selector, name, value }`; `value` is the synthetic value typed at detect time. |
| `clientDeps` | reCAPTCHA site key/action, cookies by name, page context dependencies, and similar client-side inputs. |
| `responses` | success/error status, schema, and redacted examples. |
| `uiBehavior` | redacted success/error messages, reset behavior, dataLayer event names/shapes. |
| `blockParty` | top 3 matches with `title`, `url`, `category`, `score`, and `reason`. |
| `status` | lifecycle state, separate from `cors`. |
| `confirmed` | whether the browser observed the integration. |
| `cors` | CORS results by origin; separate from `status`. |

## Status lifecycle

Common states:

- `detected`: found statically only.
- `contracted`: observed and contract generated.
- `implemented`: code exists but parity is not verified.
- `verified-L1`, `verified-L2`, `verified-L3`, `verified-L4`: highest confirmed check level.
- `blocked-cors`: L3 is environment-limited by CORS, not a code defect.
- `awaiting-owner`: owner input is required.

`status` and `cors` are separate: a contract can have detailed CORS results while its lifecycle status records implementation/verification progress.

## Block Party ranking

The script reads the curated Block Party index when online. Terms come from vendor/host, kind, and page context. Ranking is weighted term overlap, not strict all-term matching. Keep up to 3 matches and the reason; use them as implementation starting points, not proof that the integration is solved.
