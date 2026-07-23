---
name: commerce-app-webhooks
description: >
  Add or modify webhook interceptors in an Adobe Commerce app. Use when the
  user wants to intercept Commerce operations to validate input, append data,
  or modify behavior — before or after execution. Requires a base app
  initialized with commerce-app-init.
license: Apache-2.0
compatibility: >
  Requires Node.js 22+, aio CLI, and @adobe/aio-commerce-lib-app.
  Requires a base app initialized with commerce-app-init.
metadata:
  author: adobe
---

# Configure Commerce App Webhooks

Adds or modifies webhook interceptors in an existing `app.commerce.config.ts`.
Webhooks intercept Commerce operations — you can validate input, append data, or modify behavior before or after an operation executes.
Other extensibility domains (events, business config) are added separately via their own skills.

## Prerequisites

- Verify the app is **scaffolded and initialized**, not merely that the config exists. Require **both**:
  - `app.commerce.config.ts` present in the project root, **and**
  - the project initialized — signalled by the generated `src/commerce-extensibility-1/` directory and installed `node_modules` (the `@adobe/aio-commerce-lib-app` dependency).
- If `app.commerce.config.ts` is **missing**, stop and invoke `commerce-app-init` first (it writes the config, then runs init).
- If the config is **present but the project is not initialized** (no `src/commerce-extensibility-1/` or `node_modules`), run `npx @adobe/aio-commerce-lib-app init` before continuing. Init is idempotent — it finds the existing config, skips the interactive prompts, installs dependencies, and generates the project files.

## Step 1 — Understand intent

Ask the user what they want to intercept and how:

- **What operation**: the `webhook_method` (the Commerce operation, e.g., `plugin.magento.catalog_product.save`) and `webhook_type` (`before` or `after`)
- **How the handler is reached**: either a **runtime action** in this app (`runtimeAction: "<package>/<action>"`) or an **explicit external URL** (`webhook.url`) — these are mutually exclusive
- **Category** (optional): `validation` (block if invalid), `append` (add data), or `modification` (alter data) — used for conflict detection
- **Batch and hook identifiers**: `batch_name` groups related hooks; `hook_name` uniquely identifies this hook within the batch

## Step 2 — Derive config values

Apply the following validation rules before writing. Surface any issues to the user before proceeding.

| Field                      | Constraint                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `batch_name`               | `[a-zA-Z0-9_]+` only — no hyphens, dots, or spaces                                    |
| `hook_name`                | `[a-zA-Z0-9_]+` only — no hyphens, dots, or spaces                                    |
| `category`                 | Optional; must be `validation`, `append`, or `modification`                           |
| `runtimeAction`            | `<package>/<action>` format; mutually exclusive with `webhook.url`                    |
| `webhook.url`              | Must be a valid absolute URL (`https://...`); mutually exclusive with `runtimeAction` |
| `label`                    | Required, non-empty                                                                   |
| `description`              | Required, non-empty                                                                   |
| `method`                   | Required HTTP method (e.g., `POST`)                                                   |
| `timeout` / `soft_timeout` | Optional; positive integer (milliseconds)                                             |
| `priority` / `batch_order` | Optional; positive integer                                                            |

## Step 3 — Update `app.commerce.config.ts`

Add entries to the top-level `webhooks` array (or create it), preserving all other domains. If the config already has a `webhooks` key, append to it rather than replacing it.

Minimal examples:

```ts
// Runtime action handler (handler lives in this app)
webhooks: [
  {
    label: "Validate Product Save",
    description: "Validates product data before saving.",
    category: "validation", // optional
    runtimeAction: "my-package/validate-product", // <package>/<action>
    webhook: {
      webhook_method: "plugin.magento.catalog_product.save",
      webhook_type: "before",
      batch_name: "my_app", // [a-zA-Z0-9_]+ only
      hook_name: "validate_product", // [a-zA-Z0-9_]+ only
      method: "POST",
    },
  },
];

// URL handler (external endpoint)
webhooks: [
  {
    label: "Fraud Check",
    description: "Calls external fraud service before order placement.",
    webhook: {
      webhook_method: "plugin.magento.sales_order.place",
      webhook_type: "before",
      batch_name: "my_app",
      hook_name: "fraud_check",
      method: "POST",
      url: "https://fraud.example.com/check", // inside webhook object, not top level
    },
  },
];
```

Each entry also accepts an optional `env` array (`"paas"` / `"saas"`) to scope it to specific Commerce environments. When omitted, the webhook applies to all environments; when set, it is only subscribed at install time on the listed environments.

See [assets/webhooks-config.ts](assets/webhooks-config.ts) for the full annotated reference.

## Creating the handler action

For webhook entries that use `runtimeAction`, create the action file under `src/actions/` and register it in `app.config.yaml`.

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
        validate-product:
          function: actions/validate-product/index.js # relative to src/commerce-extensibility-1/
          web: "yes"
          runtime: nodejs:24
          annotations:
            require-adobe-auth: true
```

The `<package>/<action>` format in `runtimeAction` maps directly: `my-app/validate-product` → package `my-app`, action `validate-product`.

### Handler skeleton

```typescript
// src/commerce-extensibility-1/actions/validate-product/index.ts
import {
  ok,
  successOperation,
  exceptionOperation,
  addOperation,
  replaceOperation,
  removeOperation,
} from "@adobe/aio-commerce-lib-webhooks/responses";

export async function main(params: Record<string, unknown>) {
  // params contains the Commerce operation payload

  // Allow the operation to proceed
  return ok(successOperation());

  // Block the operation (validation failure)
  // return ok(exceptionOperation("Product SKU is required"));

  // Append data to the operation result
  // return ok(addOperation("result/custom_field", { value: "appended" }));

  // Modify a field in the result
  // return ok(replaceOperation("result/price", 99.99));

  // Remove a field from the result
  // return ok(removeOperation("result/unwanted_field"));
}
```

Operation types:

| Response                        | Effect                                          |
| ------------------------------- | ----------------------------------------------- |
| `successOperation()`            | Allow — operation proceeds unchanged            |
| `exceptionOperation(message)`   | Block — operation is rejected with this message |
| `addOperation(path, value)`     | Append data at `path` in the result             |
| `replaceOperation(path, value)` | Replace the value at `path` in the result       |
| `removeOperation(path)`         | Remove the field at `path` from the result      |

## Step 4 — Validate

Build the project to confirm the updated config is valid:

```sh
aio app build
```

A build failure with a validation error points directly to the offending config field.

## Common Issues

- **`batch_name` or `hook_name` rejected**: Use underscores as separators (`my_app`, `validate_product_save`) — hyphens, dots, and spaces are not accepted.
- **Both `runtimeAction` and `webhook.url` set**: These are mutually exclusive — use `runtimeAction` when the handler lives in this app; `webhook.url` for an external endpoint.
- **`url` at wrong level**: For URL-based entries, `url` must be inside the nested `webhook` object, not at the top level alongside `label`.
- **`app-management` package name conflict**: The framework generates this package in `ext.config.yaml` on every build. Use any other name for your own actions.
- **Function path is relative to `src/commerce-extensibility-1/`**: Do not use `src/...` or project-root-relative paths. `actions/validate-product/index.js` resolves correctly; `src/commerce-extensibility-1/actions/validate-product/index.js` does not.
- **`defineConfig` not found**: Ensure `@adobe/aio-commerce-lib-app` is installed and `defineConfig` is imported from `@adobe/aio-commerce-lib-app/config`.

## Quality Bar

- `aio app build` completes without errors

## Chaining

After `aio app build` passes:

- **Add merchant settings** — invoke `commerce-app-business-config` to expose configurable settings in Commerce Admin
- **Add event subscriptions** — invoke `commerce-app-eventing` to subscribe to Commerce or external events
- **Extend the Admin UI** — invoke `commerce-app-admin-ui` to add custom columns, mass actions, order view buttons, or menu entries in Commerce Admin
- **Add persistent storage** — invoke `commerce-app-storage` to back webhook handlers with queryable DB storage

## References

- [assets/webhooks-config.ts](assets/webhooks-config.ts) — Reference config showing both runtime action and URL-based webhook entry shapes
