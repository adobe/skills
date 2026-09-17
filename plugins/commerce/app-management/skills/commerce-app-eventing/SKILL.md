---
name: commerce-app-eventing
description: >
  Add or modify Commerce and external event subscriptions, configure event field
  extraction and filter rules in an Adobe Commerce app. Use when the user wants
  to set up event-driven workflows triggered by Commerce operations (such as order
  placement or catalog changes) or third-party systems. Requires a base app
  initialized with commerce-app-init.
license: Apache-2.0
compatibility: >
  Requires Node.js 22+, aio CLI, and @adobe/aio-commerce-lib-app.
  Requires a base app initialized with commerce-app-init.
metadata:
  author: adobe
---

# Configure Commerce App Eventing

Adds or modifies event sources — Commerce-native events or external events — in an existing `app.commerce.config.ts`.
Extensibility domains other than eventing (webhooks, business config) are added separately via their own skills.

## Prerequisites

- Verify the app is **scaffolded and initialized**, not merely that the config exists. Require **both**:
  - `app.commerce.config.ts` present in the project root, **and**
  - the project initialized — signalled by the generated `src/commerce-extensibility-1/` directory and installed `node_modules` (the `@adobe/aio-commerce-lib-app` dependency).
- If `app.commerce.config.ts` is **missing**, stop and invoke `commerce-app-init` first (it writes the config, then runs init).
- If the config is **present but the project is not initialized** (no `src/commerce-extensibility-1/` or `node_modules`), run `npx @adobe/aio-commerce-lib-app init` before continuing. Init is idempotent — it finds the existing config, skips the interactive prompts, installs dependencies, and generates the project files.
- Actions can be authored in TypeScript only once the project has the TypeScript build setup (`webpack-config.cjs` + root `tsconfig.json`) that `init` scaffolds for a TypeScript Commerce config — see `commerce-app-init`. Otherwise, author actions in JavaScript.
- Ensure `CloudIntegrationSDK` (I/O Events) and `commerceeventing` (Adobe I/O Events for Adobe Commerce) are subscribed in the Developer Console workspace:
  1. List currently subscribed services:

     ```sh
     aio console workspace api list --projectName <project> --workspaceName <workspace> --json
     ```

  2. If either service is missing, re-subscribe with the **full merged set** of service codes (existing + missing). `aio console workspace api add` replaces the subscription list — omitting a currently-subscribed service will remove it.

     ```sh
     aio console workspace api add \
       --projectName <project> \
       --workspaceName <workspace> \
       --service-code <existing-codes>,CloudIntegrationSDK,commerceeventing \
       --json
     ```

     If the command fails with "product profile required" for `commerceeventing`, ask the user for the profile name and retry with `--license-config commerceeventing=<profile>`.

## Step 1 — Understand intent

Ask whether the user wants to configure Commerce events, external events, or both:

- **Commerce events** (`eventing.commerce`): native Commerce events. Names follow `plugin.<segments>` or `observer.<segments>`.
- **External events** (`eventing.external`): events from third-party systems (e.g., ERP, CRM). Names are free-form (`[\w\-_.]+`).

For each event source, gather:

- Provider label, description, and optional key
- For each event: name, label, description, and which runtime action(s) should handle it (format: `<package>/<action>`)
- For Commerce events only: fields to extract from the event payload (empty array captures the full payload), and any optional filter rules
- Optionally, which Commerce environments the event applies to (`env`)

## Step 2 — Derive config values

Apply the following validation rules before writing the config. Surface any issues to the user before proceeding.

| Field                | Constraint                                                                          |
| -------------------- | ----------------------------------------------------------------------------------- |
| Commerce event name  | Starts with `plugin.` or `observer.`; each segment matches `[a-z_]+`; max 180 chars |
| External event name  | `[\w\-_.]+`; max 180 chars                                                          |
| Provider label       | Max 100 chars                                                                       |
| Provider description | Max 255 chars                                                                       |
| Provider key         | Optional; alphanumeric + hyphens only; max 50 chars                                 |
| Event label          | Max 100 chars                                                                       |
| Event description    | Max 255 chars                                                                       |
| Field name           | `[a-zA-Z0-9_\-.[\]]+` or `*`                                                        |
| Rule operator        | `greaterThan`, `lessThan`, `equal`, `regex`, `in`, or `onChange`                    |
| Runtime action       | `<package>/<action>` (e.g., `my-package/handle-order-placed`)                       |
| Event env (optional) | Non-empty array of `"paas"` / `"saas"`; omitted = all environments                  |

## Step 3 — Update `app.commerce.config.ts`

Add or merge `eventing.commerce` and/or `eventing.external` into the existing config, preserving all other domains. If the config already has an `eventing` key, extend it rather than replacing it.

Minimal example (Commerce event):

```ts
eventing: {
  commerce: [{
    provider: { label: "Commerce Events Provider", description: "..." },
    events: [{
      name: "plugin.order_placed",          // plugin.<segments> or observer.<segments>
      label: "Order Placed",
      description: "Triggered when a customer places an order.",
      fields: [{ name: "order_id" }],       // empty array = full payload; Commerce events only
      runtimeActions: ["my-package/handle-order-placed"], // <package>/<action>
    }],
  }],
}
```

See [assets/eventing-config.ts](assets/eventing-config.ts) for the full reference including external event sources.

## Creating the handler action

For events that reference runtime actions via `runtimeActions`, create the action file under `src/actions/` and register it in `app.config.yaml`.

### Register the action

Add a user-defined package to `src/commerce-extensibility-1/ext.config.yaml` alongside the existing `app-management` package. Use any name except `app-management` (reserved by the framework):

```yaml
# src/commerce-extensibility-1/ext.config.yaml
# (add below the auto-generated app-management package)
runtimeManifest:
  packages:
    app-management:
      # ... auto-generated — do not edit
    my-app: # your package name — any name except "app-management"
      actions:
        handle-order-placed:
          function: actions/handle-order-placed/index.js # relative to src/commerce-extensibility-1/
          web: "no"
          runtime: nodejs:24
          annotations:
            require-adobe-auth: false
```

The `<package>/<action>` format in `runtimeActions` maps directly: `my-app/handle-order-placed` → package `my-app`, action `handle-order-placed`.

### Handler skeleton

Event handlers receive a CloudEvents-shaped payload. `params.data` bundles the event payload together with metadata, so don't read fields directly off `params.data`: `params.data.value` is the event payload — the fields declared in the event's `fields` array (or the full payload if `fields` is empty); `params.data._metadata` is Commerce instance metadata; `params.data.source` is the merchant/environment ID pair configured in the Commerce eventing configuration.

Payload shape varies by event — check the [Adobe Commerce events reference](https://developer.adobe.com/commerce/extensibility/events/events-reference) for the specific event name before deciding on a `fields` path. Some events nest the payload in a sub-object (e.g. `value.order.entity_id`); others put the fields flat on `value` (e.g. `value.order_id`), as in the example below.

```typescript
// src/commerce-extensibility-1/actions/handle-order-placed/index.ts
export async function main(params: Record<string, unknown>) {
  const data = params.data as Record<string, unknown>;
  const value = data.value as Record<string, unknown>;
  // value contains the fields declared in the event's `fields` array
  // (or the full payload if fields is empty)

  const orderId = value.order_id;

  // process the event ...

  return { statusCode: 200, body: { processed: true } };
}
```

Numeric-looking fields aren't guaranteed to be numbers — Commerce serializes some as strings inconsistently, even within the same event (e.g. an id field delivered as `"3"` while a total on that same payload stays a number). Validate and coerce before comparing or forwarding a field, and skip (don't throw) when it doesn't coerce cleanly:

```typescript
function toFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Could not convert "${value}" to a finite number`);
}
```

### Calling the Commerce REST API from a handler

If the handler needs to call the Commerce REST API (e.g. to fetch additional order data), use `getCommerceClient` from `@adobe/aio-commerce-lib-app` instead of reinventing config or env-based access to the Commerce instance (e.g. a custom `.env` variable such as `AIO_COMMERCE_API_BASE_URL`, or a business config field for the base URL). The SDK already stores the Commerce base URL and deployment type from the app's association, so `getCommerceClient` resolves them for you:

```typescript
// src/commerce-extensibility-1/actions/handle-order-placed/index.ts
import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-lib-auth";

export async function main(params: Record<string, unknown>) {
  const data = params.data as Record<string, unknown>;
  const value = data.value as Record<string, unknown>;
  const orderId = value.order_id;

  const client = await getCommerceClient(resolveImsAuthParams(params));
  const order = await client.get(`orders/${orderId}`).json();

  // process the event using order details ...

  return { statusCode: 200, body: { processed: true } };
}
```

The client's base URL already includes the REST prefix and API version (`rest/<store>/V1` for PaaS, `V1` for SaaS) — pass only the resource path (`orders/${orderId}`, not `V1/orders/${orderId}` or `rest/all/V1/orders/${orderId}`).

See [Accessing the Associated Commerce Instance from Runtime Actions](https://github.com/adobe/aio-commerce-sdk/blob/main/packages/aio-commerce-lib-app/docs/usage.md#accessing-the-associated-commerce-instance-from-runtime-actions) for the full pattern, including handling the unassociated state (`AssociationRecordNotFoundError`).

## Step 4 — Regenerate the `installation` action

If eventing is the first install-requiring domain in the config (the others are `webhooks`, `adminUi`, `installation.customInstallationSteps`), re-run:

```sh
npx @adobe/aio-commerce-lib-app init
```

This is what adds the `installation` action to `ext.config.yaml`'s `app-management` package — `aio app build`/`aio app deploy` only read the existing file, they never regenerate it. Skip this and Commerce has no endpoint to call, so the event source builds and deploys fine but never actually gets subscribed. Safe to re-run even when the action already exists.

## Step 5 — Validate

Build the project to confirm the updated config is valid:

```sh
aio app build
```

A build failure with a validation error points directly to the offending config field. If this event source needed Step 4, also check that `ext.config.yaml` now has `actions.installation` under `app-management`.

## Common Issues

- **External event has `fields`**: The `fields` property is only valid on Commerce events; external events don't support it.
- **`runtimeActions` format error**: Must be `<package>/<action>`. Both parts are lowercase alphanumeric + hyphens only.
- **`app-management` package name conflict**: The framework generates this package in `ext.config.yaml` on every build. Use any other name for your own actions.
- **Function path is relative to `src/commerce-extensibility-1/`**: Do not use `src/...` or project-root-relative paths. `actions/handle-order-placed/index.js` resolves correctly; `src/commerce-extensibility-1/actions/handle-order-placed/index.js` does not.
- **`defineConfig` not found**: Ensure `@adobe/aio-commerce-lib-app` is installed and `defineConfig` is imported from `@adobe/aio-commerce-lib-app/config`.
- **Build fails on missing action**: A runtime action referenced in `runtimeActions` must exist in the project. Check the action files under `src/commerce-extensibility-1/actions/` and create any missing stubs.
- **Handler needs the Commerce base URL**: Use `getCommerceClient` (`@adobe/aio-commerce-lib-app`), not a custom `.env` variable or business config field. See [Calling the Commerce REST API from a handler](#calling-the-commerce-rest-api-from-a-handler).
- **Event deployed but Commerce never subscribes it**: `init` wasn't re-run after adding the first install-requiring domain (Step 4) — no `installation` action, no install endpoint.
- **Numeric field arrives as a string**: don't assume `typeof value.field === "number"` — an id/qty/total field can be serialized as a string even when other fields on the same event stay numeric. Coerce with `Number(...)` and check `Number.isFinite` before using it.

## Quality Bar

- `aio app build` completes without errors
- `installation` action present in `ext.config.yaml` when this event source requires it
- Numeric fields extracted from the event payload are coerced/validated before use, not assumed to already be numbers

## Chaining

After `aio app build` passes:

- **Add webhook interception** — invoke `commerce-app-webhooks` to intercept Commerce operations
- **Add merchant settings** — invoke `commerce-app-business-config` to expose configurable settings in Commerce Admin
- **Extend the Admin UI** — invoke `commerce-app-admin-ui` to add custom columns, mass actions, or menu entries in Commerce Admin
- **Add persistent storage** — invoke `commerce-app-storage` to back event handlers with queryable DB storage

## References

- [assets/eventing-config.ts](assets/eventing-config.ts) — Reference config showing both Commerce and external event source shapes
- [Accessing the Associated Commerce Instance from Runtime Actions](https://github.com/adobe/aio-commerce-sdk/blob/main/packages/aio-commerce-lib-app/docs/usage.md#accessing-the-associated-commerce-instance-from-runtime-actions) — how `getCommerceClient` resolves the Commerce base URL and auth for REST calls made from a handler
- [Adobe Commerce events reference](https://developer.adobe.com/commerce/extensibility/events/events-reference) — payload shapes per event, needed to determine the correct field path when extracting fields
