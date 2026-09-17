---
name: commerce-app-business-config
description: >
  Manage custom business configuration in an Adobe Commerce app. Use when the
  user wants to add, modify, or remove merchant-configurable settings (config
  fields, admin config, store configuration) exposed through Commerce Admin.
  Creates typed config fields (text, password, email, url, tel, boolean, list)
  in businessConfig.schema. Requires a base app initialized with commerce-app-init.
license: Apache-2.0
compatibility: >
  Requires Node.js 22+, aio CLI, and @adobe/aio-commerce-lib-app installed.
  Requires a base app initialized with commerce-app-init.
metadata:
  author: adobe
---

# Configure Commerce App Business Config

Adds or modifies the `businessConfig.schema` array in an existing `app.commerce.config.ts`.
Each entry in the schema defines one merchant-configurable setting that Commerce Admin will render as a UI field.
Other extensibility domains (webhooks, events) are added separately via their own skills.

## Prerequisites

- Verify the app is **scaffolded and initialized**, not merely that the config exists. Require **both**:
  - `app.commerce.config.ts` present in the project root, **and**
  - the project initialized — signalled by the generated `src/commerce-extensibility-1/` directory and installed `node_modules` (the `@adobe/aio-commerce-lib-app` dependency).
- If `app.commerce.config.ts` is **missing**, stop and invoke `commerce-app-init` first (it writes the config, then runs init).
- If the config is **present but the project is not initialized** (no `src/commerce-extensibility-1/` or `node_modules`), run `npx @adobe/aio-commerce-lib-app init` before continuing. Init is idempotent — it finds the existing config, skips the interactive prompts, installs dependencies, and generates the project files.

## Step 1 — Understand intent

For each setting the user wants to expose, gather:

- **Name** — machine identifier for the field (used as the config key read by the app at runtime)
- **Type** — one of: `list`, `text`, `password`, `email`, `url`, `tel`, `boolean`
- **Label** (optional) — human-readable label shown in Admin
- **Description** (optional) — help text shown alongside the field in Admin
- **Default value** (optional, type-dependent — see constraints in Step 2)
- For `list` fields additionally: **`selectionMode`** (`"single"` or `"multiple"`) and **`options`** (each with a `label` and `value` string)

## Step 2 — Derive config values

Apply the following per-type validation rules before writing. Surface any issues to the user before proceeding.

| Field                   | Constraint                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `name`                  | Required, non-empty string                                                                      |
| `type`                  | Required; one of `list`, `text`, `password`, `email`, `url`, `tel`, `boolean`                   |
| `label`                 | Optional string                                                                                 |
| `description`           | Optional string                                                                                 |
| `list.selectionMode`    | Required for list fields: `"single"` or `"multiple"`                                            |
| `list.options`          | Required for list fields; each option needs both `label` and `value` strings                    |
| `list/single` default   | Required; must match one of the option `value` strings (non-empty)                              |
| `list/multiple` default | Optional array of strings (defaults to `[]`); each element must match an option value           |
| `text` default          | Optional string (defaults to `""`)                                                              |
| `password` default      | Must be `""` — any non-empty default is rejected to prevent secrets in config                   |
| `email` default         | Optional; `""` or a fully valid email address                                                   |
| `url` default           | Optional; `""` or a fully valid absolute URL                                                    |
| `tel` default           | Optional; `""` or matches `/^\+?[0-9\s\-()]+$/` (digits, spaces, hyphens, parens, optional `+`) |
| `boolean` default       | Optional boolean (defaults to `false`)                                                          |

`businessConfig.schema` must contain at least one field — an empty array is rejected at build time.

## Step 3 — Update `app.commerce.config.ts`

Add (or merge into) the top-level `businessConfig.schema` array, preserving all other domains. If the config already has a `businessConfig` key, append to `businessConfig.schema` rather than replacing it.

Minimal examples:

```ts
businessConfig: {
  schema: [
    // Password (masked input — API keys, secrets)
    { name: "api_key", type: "password", label: "API Key", default: "" },

    // Single-select list
    {
      name: "region", type: "list", selectionMode: "single",
      label: "Region",
      options: [{ label: "EU", value: "eu" }, { label: "US", value: "us" }],
      default: "eu",   // required; must match an option value
    },

    // Boolean toggle
    { name: "debug_mode", type: "boolean", label: "Enable Debug Mode", default: false },

    // Dynamic list — options resolved at runtime via a factory that receives the action's params.
    // Required `default` factory for single-select; optional for multiple (falls back to []).
    {
      name: "paymentMethod", type: "dynamicList", selectionMode: "single",
      label: "Default Payment Method",
      options: async (params) => {
        const methods = await fetchPaymentMethods(params.SOME_API_KEY);
        return methods.map((m) => ({ label: m.title, value: m.code }));
      },
      default: (resolvedOptions) => resolvedOptions[0].value,
    },
  ],
}
```

See [assets/business-config.ts](assets/business-config.ts) for the full reference showing all field types.

## Step 4 — Register the extension point

Run init so that `commerce/configuration/1` is added to `app.config.yaml` and `install.yaml`, and the required `@adobe/aio-commerce-lib-config` dependency is installed. This is idempotent — safe to run even if the extension is already registered.

```sh
npx @adobe/aio-commerce-lib-app init
```

## Step 5 — Validate

Build the project to confirm the updated config is valid:

```sh
aio app build
```

A build failure with a validation error points directly to the offending field.

## Reading config in runtime actions

Use `@adobe/aio-commerce-lib-config` to read the values merchants set in Commerce Admin.
The library must be initialized with the generated schema on every action invocation before any config call.

### Basic pattern

```typescript
import {
  initialize,
  getConfigurationByKey,
  getConfiguration,
  byCodeAndLevel,
} from "@adobe/aio-commerce-lib-config";
// Schema is generated by `aio app build` into .generated/configuration-schema.json
// under the commerce-configuration-1 extension; adjust the relative path for your action.
import schema from "../../.generated/configuration-schema.json" with { type: "json" };

export async function main(params) {
  await initialize({ schema });

  // Read a single field — config is null if the key has never been set
  const { config } = await getConfigurationByKey(
    "api_key", // the `name` from your schema
    byCodeAndLevel("global", "global"), // scope
  );
  const apiKey = config?.value ?? "";

  // Read all fields for a scope
  const { config: allConfig } = await getConfiguration(
    byCodeAndLevel("global", "global"),
  );
  // allConfig is an array of { name, value, origin } entries

  return { statusCode: 200, body: { success: true } };
}
```

### Scope selectors

| Selector                                  | When to use                                        |
| ----------------------------------------- | -------------------------------------------------- |
| `byCodeAndLevel("global", "global")`      | App-wide settings — applies to all stores          |
| `byCodeAndLevel(storeCode, "store_view")` | Per store view (most specific)                     |
| `byCode(storeCode)`                       | Resolves using the default level for the scope     |
| `byScopeId(scopeId)`                      | When you have the scope's numeric ID from Commerce |

Values inherit from parent scopes — a field not set on `store_view` falls back to `store`, `website`, then `global`.

### Password fields

`aio app build` generates `AIO_COMMERCE_CONFIG_ENCRYPTION_KEY` automatically into `.env` the first time it encounters a password field (and validates it on subsequent builds). No manual setup needed.

To decrypt values at runtime, the key must be available to the action. Wire it as an input in the action's `ext.config.yaml`:

```yaml
inputs:
  AIO_COMMERCE_CONFIG_ENCRYPTION_KEY: $AIO_COMMERCE_CONFIG_ENCRYPTION_KEY
```

With the key in place, `getConfigurationByKey` returns the plaintext value — no extra decryption code needed.

## Common Issues

- **`list/single` default missing**: Single-select list fields require a `default` — it can't be omitted. It must exactly match one of the option `value` strings.
- **`defineConfig` not found**: Ensure `@adobe/aio-commerce-lib-app` is installed and `defineConfig` is imported from `@adobe/aio-commerce-lib-app/config`.

## Quality Bar

- `aio app build` completes without errors

## Chaining

After `aio app build` passes:

- **Add webhook interceptors** — invoke `commerce-app-webhooks` to intercept Commerce operations before or after they execute
- **Add event subscriptions** — invoke `commerce-app-eventing` to subscribe to Commerce or external events
- **Extend the Admin UI** — invoke `commerce-app-admin-ui` to add custom columns, mass actions, order view buttons, or menu entries in Commerce Admin

## References

- [assets/business-config.ts](assets/business-config.ts) — Reference config showing all field types with inline constraint comments
