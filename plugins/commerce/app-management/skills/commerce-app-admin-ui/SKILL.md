---
name: commerce-app-admin-ui
description: >
  Add or modify Adobe Commerce Admin UI extensions on the
  commerce/backend-ui/2 extension point: custom grid columns, mass actions,
  order view buttons, and a custom Admin menu entry. Use whenever the user
  wants to extend the Commerce Admin — add a column to the order, product, or
  customer grid, add a bulk/mass action to a grid, add a button to the order
  view page, or add a custom menu item or page — even when they don't name the
  extension point.
license: Apache-2.0
compatibility: >
  Requires Node.js 22+, aio CLI, @adobe/aio-commerce-lib-app, and
  @adobe/aio-commerce-sdk (for Admin UI runtime action handlers).
  View variants use @adobe/aio-commerce-lib-admin-ui/web (installed
  automatically by the web-src scaffold).
  Requires a base app initialized with commerce-app-init.
metadata:
  author: adobe
---

# Configure Commerce App Admin UI

Adds or modifies the `adminUi` block in an existing `app.commerce.config.ts`.
The Admin UI extension point (`commerce/backend-ui/2`) lets a Commerce app extend the Commerce Admin with custom grid columns, mass actions, order view buttons, and a menu entry.
Other extensibility domains (webhooks, events, business config) are added separately via their own skills.

## Prerequisites

- Verify the app is **scaffolded and initialized**, not merely that the config exists. Require **both**:
  - `app.commerce.config.ts` present in the project root, **and**
  - the project initialized — signalled by the generated `src/commerce-extensibility-1/` directory and installed `node_modules` (the `@adobe/aio-commerce-lib-app` dependency).
- If `app.commerce.config.ts` is **missing**, stop and invoke `commerce-app-init` first (it writes the config, then runs init).
- If the config is **present but the project is not initialized** (no `src/commerce-extensibility-1/` or `node_modules`), run `npx @adobe/aio-commerce-lib-app init` before continuing. Init is idempotent — it finds the existing config, skips the interactive prompts, installs dependencies, and generates the project files.

## Extension points at a glance

| Extension point    | Entities                      | Variants      | Server handler | Reference                                              |
| ------------------ | ----------------------------- | ------------- | -------------- | ------------------------------------------------------ |
| Grid columns       | order, product, customer      | worker only   | yes            | [grid-columns](references/grid-columns.md)             |
| Mass actions       | order, product, customer      | view / worker | worker only    | [mass-actions](references/mass-actions.md)             |
| Order view buttons | order only                    | view / worker | worker only    | [order-view-buttons](references/order-view-buttons.md) |
| Menu               | single entry (`adminUi.menu`) | view (iframe) | no             | [menu](references/menu.md)                             |

`view` renders an iframe into the app's web UI (`web-src`) at the entry's `path`; `worker` invokes a runtime action server-side.
Grid columns are always worker; the menu is always an iframe.

## Step 1 — Understand intent

For each thing the user wants to add, gather:

- **Which extension point** — grid columns, mass actions, order view buttons, or menu
- **Which entity** — `order`, `product`, or `customer` (grid columns and mass actions; view buttons are order-only; menu has no entity)
- **For mass actions and view buttons, the variant** — `worker` (runtime action) or `view` (iframe into `web-src`)
- The fields for that extension point (column definitions, button labels, menu parent, etc.) — see the reference file in the table above for the full field set

## Step 2 — Declare in `app.commerce.config.ts`

Add (or merge into) the top-level `adminUi` block, preserving all other domains. If `adminUi` already exists, merge into it rather than replacing — keep existing entities, the menu, and existing array entries.

These fields are shared across the extension points:

| Field                | Constraint                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `runtimeAction`      | `<package>/<action>`; must resolve to a handler action you declare (Step 4)                                                   |
| `confirm`            | Optional `{ title?, message? }` — confirmation dialog before the action runs                                                  |
| `notifications`      | Optional `{ success?, error? }` — toast text Commerce shows on completion                                                     |
| `sandboxPermissions` | Optional array (view/iframe entries); non-empty, no duplicates; each one of `allow-downloads`, `allow-modals`, `allow-popups` |

Minimal example covering each feature (use only the parts you need):

```ts
import { MENU_SALES } from "@adobe/aio-commerce-sdk/admin-ui/menu";

// inside defineConfig({ ... }):
adminUi: {
  order: {
    // Custom column on the order grid (worker only)
    gridColumns: {
      label: "Fulfillment data",
      description: "Fulfillment status from the warehouse system.",
      runtimeAction: "my-app/order-grid", // <package>/<action> — declare in Step 4
      columns: [
        { id: "fulfillment_status", label: "Fulfillment", type: "string", align: "left" },
      ],
    },
    // Bulk action on selected orders (worker variant shown)
    massActions: [
      { type: "worker", id: "archive-orders", label: "Archive",
        runtimeAction: "my-app/archive-orders", selectionLimit: 500 },
    ],
    // Button on the order view page (worker variant shown)
    viewButtons: [
      { type: "worker", id: "sync-inventory", label: "Sync inventory",
        runtimeAction: "my-app/sync-inventory" },
    ],
  },
  // Custom Admin menu entry (iframe into the app)
  menu: {
    id: "my_app_dashboard", // letters, digits, / : _ only
    label: "My Dashboard",
    description: "Custom dashboard for my app.",
    parentMenu: MENU_SALES,
  },
}
```

For the `view` variants (iframe) and the complete field set and constraints of each extension point, read the matching reference file under [References](#references) before writing.

## Step 3 — Register the extension point

Run init so that `commerce/backend-ui/2` is added to `app.config.yaml` and `install.yaml`, and the `src/commerce-backend-ui-2/` extension folder is generated. This is idempotent — safe to run even if the extension is already registered.

```sh
npx @adobe/aio-commerce-lib-app init
```

The build derives the extension's `ext.config.yaml` from your `adminUi` config: each worker `runtimeAction` becomes a `workerProcess` operation, and when you declare a `menu` or any `view`-type entry, a `view` operation plus an explicit `web: web-src` key are written. Those `hooks`, `operations`, and `web` sections are managed by the library — do not hand-edit them.

When a `view` operation is present, init/generate also scaffolds the web frontend automatically (skipped if `web-src/index.html` already exists). It generates `src/commerce-backend-ui-2/web-src/` — `index.html`, `src/app.jsx`, `src/pages/main-page.jsx`, `src/components/welcome.jsx` (`.tsx` plus a `tsconfig.json` when the app config is TypeScript) — adds the `#web/*` import alias to `package.json`, and declares and installs pinned versions of `react`, `react-dom`, `@react-spectrum/s2`, and `@adobe/aio-commerce-lib-admin-ui` (React and Spectrum S2 are optional peer dependencies of the admin-ui library), plus some `devDependencies` for proper TypeScript support/config. Do not hand-pick different versions of these dependencies; the scaffold fails if incompatible versions are already installed.

## Step 4 — Implement the handlers

What you implement depends on the variant. Examples below are in TypeScript; if the project uses JavaScript, omit type imports and annotations.

### Worker variants (grid columns, worker mass actions, worker view buttons)

Each worker `runtimeAction` needs an action you declare and implement, inside the Admin UI extension folder `src/commerce-backend-ui-2/`.

1. Put the handler source under `src/commerce-backend-ui-2/actions/`.
2. Declare it in `src/commerce-backend-ui-2/ext.config.yaml` under your own package in `runtimeManifest` (any package name). The build manages `hooks` and `operations` in this file but preserves the packages you add under `runtimeManifest`, so your action survives rebuilds:

```yaml
# src/commerce-backend-ui-2/ext.config.yaml
runtimeManifest:
  packages:
    my-app: # must match the <package> in runtimeAction
      actions:
        order-grid:
          function: actions/order-grid/index.js # relative to src/commerce-backend-ui-2/
          web: "yes"
          runtime: nodejs:24
          annotations:
            require-adobe-auth: true # Commerce calls the action with an IMS token — validate it
            final: true
```

The `<package>/<action>` in `runtimeAction` maps directly: `my-app/order-grid` → package `my-app`, action `order-grid`. Commerce invokes these worker actions with an Adobe IMS token, so they need `require-adobe-auth: true` (and `final: true` to lock the bound inputs).

Implement the handler with the wire-contract builders from the `@adobe/aio-commerce-sdk/admin-ui/*` entrypoints.
The builders differ per extension point — the reference file gives the exact request shape and response builders. Grid columns example:

```typescript
// src/commerce-backend-ui-2/actions/order-grid/index.ts
import {
  parseGridRequest,
  okGridResponse,
  errorGridResponse,
} from "@adobe/aio-commerce-sdk/admin-ui/grid-columns";
import type { RuntimeActionParams } from "@adobe/aio-commerce-sdk/core/params";

export async function main(params: RuntimeActionParams) {
  const { gridType, ids } = parseGridRequest(params);
  try {
    const rows = await fetchRows(gridType, ids);
    // row keys must match the column ids declared in config
    return okGridResponse(rows, { fulfillment_status: "unknown" });
  } catch (error) {
    return errorGridResponse(
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
```

### View variants (view mass actions, view buttons, menu)

No server handler. Commerce opens an iframe into the app's `web-src` at the entry's `path` — and that frontend was generated for you in Step 3 (`index.html`, `src/app.jsx`, `src/pages/main-page.jsx`, `src/components/welcome.jsx`). The generated `src/app.jsx` mounts the `commerce/backend-ui/2` iframe app with `createExtensionApp` from `@adobe/aio-commerce-lib-admin-ui/web`, and its `routes` array must start with the index route:

```jsx
// src/commerce-backend-ui-2/web-src/src/app.jsx (generated)
import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "#app.commerce.config";
import { MainPage } from "#web/pages/main-page.jsx";

createExtensionApp({
  metadata: { extensionId: config.metadata.id },
  routes: [{ index: true, element: <MainPage /> }],
});
```

Just as the worker variants wire a `runtimeAction` to an action, each `view` entry's `path` must be wired to a page and a route. Scaffold that wiring per entry — but **only create what is missing. Never overwrite or modify an existing page or route.**

The **menu** has no `path`: it renders at the index route (`src/pages/main-page.jsx`), which the scaffold already created as a plain page. There is nothing to scaffold for the menu — leave `main-page.jsx` in place (customize its content if you like). It needs only the `MENU_*` constant for `parentMenu` in the config (see [menu](references/menu.md)).

For each `view`-type **mass action** and **order view button** (both carry a `path`):

1. **Check for the route.** Look in `src/app.jsx` for a `routes` entry whose `path` equals the entry's config `path`, and in `web-src/src/pages/` for its page file. If a route for that `path` already exists, leave it and its page untouched and move on.

2. **Create the placeholder page (missing only).** Add `web-src/src/pages/<name>.jsx` — use `.tsx` (and TypeScript) when the app config is TypeScript. Keep it minimal, matching the look of the generated `main-page`/`welcome` (a `<main>` with a heading). Do not add a copyright header — the generated `web-src` files carry none. Pre-wire the context hook for the entry type (table below).

3. **Register the route in `src/app.jsx` (missing only).** Import the page via the `#web/pages/*` alias and append a `{ path, element }` entry to `routes`. Write `path` as the **exact same string as the config `path`, including the leading `#/`** — copy it verbatim so the route and the config entry visibly line up. Keep the index route first.

Pre-wire the hook by view type — all from `@adobe/aio-commerce-lib-admin-ui/web`:

| View entry           | Context hook                                                          | Also                                                                | Reference                                              |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Mass action (`view`) | `useMassActionContext()` → `{ data, error }`; use `data.selectedIds`  | `useHostConnection()` → `{ actions, error }`; use `actions.close()` | [mass-actions](references/mass-actions.md)             |
| Order view button    | `useOrderViewButtonContext()` → `{ data, error }`; use `data.orderId` | `useHostConnection()` → `{ actions, error }`; use `actions.close()` | [order-view-buttons](references/order-view-buttons.md) |
| Menu                 | none (plain index page)                                               | —                                                                   | [menu](references/menu.md)                             |

These hooks return errors instead of throwing them. A route can throw a returned error during render to send it to the SDK's error boundary, which replaces the extension content with its fallback UI. If the route must stay mounted, handle the error locally by rendering a message, offering a retry, disabling the affected feature, or providing another degraded state. The placeholder examples below throw because they don't define custom recovery UI.

A route component may also call `useIms()` and `useCommerce()` to reach the Commerce REST API or retrieve data directly from the host, respectively. Both return `{ data, error }`; after handling `error`, read `data.imsToken` and `data.imsOrgId` from `useIms()`, and `data.commerceHost` from `useCommerce()`. The generated `Welcome` component demonstrates this result handling for `useIms()`. Add those hooks only when the page actually needs them.

Example — a `view` mass action placeholder page and its route registration:

```jsx
// src/commerce-backend-ui-2/web-src/src/pages/export-customers.jsx
import {
  useHostConnection,
  useMassActionContext,
} from "@adobe/aio-commerce-lib-admin-ui/web";

export function ExportCustomersPage() {
  const { data, error: contextError } = useMassActionContext();
  const { actions, error: hostError } = useHostConnection();
  if (contextError) throw contextError;
  if (hostError) throw hostError;

  const { selectedIds } = data; // non-empty string[] — the selected record ids
  const { close } = actions; // await close() (or actions.closeWithError()) when done

  return (
    <main>
      <h1>Export customers</h1>
      <p>{selectedIds.length} selected</p>
    </main>
  );
}
```

```jsx
// src/commerce-backend-ui-2/web-src/src/app.jsx
import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "#app.commerce.config";
import { MainPage } from "#web/pages/main-page.jsx";
import { ExportCustomersPage } from "#web/pages/export-customers.jsx";

createExtensionApp({
  metadata: { extensionId: config.metadata.id },
  routes: [
    { index: true, element: <MainPage /> }, // keep the index route first
    { path: "#/export-customers", element: <ExportCustomersPage /> }, // path === config `path`
  ],
});
```

For an order view button, swap the hook for `useOrderViewButtonContext()` and read `data.orderId` after handling `error` — see [order-view-buttons](references/order-view-buttons.md).

## Step 5 — Validate

Build the project to confirm the updated config is valid:

```sh
aio app build
```

A build failure with a validation error points directly to the offending `adminUi` field.

## Common Issues

- **`view` vs `worker` mismatch**: each variant is a strict object — a `worker` entry requires `runtimeAction` (and rejects `path`/`sandboxPermissions`); a `view` entry requires `path` (and rejects `runtimeAction`/`timeout`). They are discriminated by `type`.
- **Grid columns are worker-only**: there is no `view` grid column. Only `order`, `product`, and `customer` support `gridColumns`, and only `order` supports `viewButtons`.
- **`runtimeAction` with no handler**: a worker entry whose `<package>/<action>` is not declared under `runtimeManifest` in `src/commerce-backend-ui-2/ext.config.yaml` leaves the generated `workerProcess` reference unresolved at deploy.
- **Wrong action location**: handler sources and their `runtimeManifest` entry belong in the Admin UI extension folder `src/commerce-backend-ui-2/` — not `src/commerce-extensibility-1/` (where webhook and event handlers live). The `function` path is relative to `src/commerce-backend-ui-2/`.
- **Grid row keys must match column ids**: keys in the `okGridResponse` rows must equal the `id`s in `gridColumns.columns`, or cells render empty (or fall back to the defaults bag).
- **View route `path`**: register the `{ path }` in `src/app.jsx` as the exact same string as the entry's config `path` — copy it verbatim, hash included, so the two line up.
- **Menu `id` charset**: the menu `id` allows only letters, digits, `/`, `:`, and `_` — no hyphens or spaces.
- **`defineConfig` not found**: import `defineConfig` from `@adobe/aio-commerce-lib-app/config`.
- **Double renders/requests in development**: `createExtensionApp` wraps the app in React `<StrictMode>`, so under `aio app dev` or `aio app run` components render twice and effects run an extra setup + cleanup cycle on mount. Duplicate renders or effect-triggered requests in development are expected StrictMode behavior, not a bug to fix; production builds are unaffected.

## Quality Bar

- `aio app build` completes without errors
- Every worker `runtimeAction` has a matching action declared under `runtimeManifest` in `src/commerce-backend-ui-2/ext.config.yaml`

## Chaining

After `aio app build` passes:

- **Add merchant settings** — invoke `commerce-app-business-config` to expose configurable settings in Commerce Admin
- **Add webhook interceptors** — invoke `commerce-app-webhooks` to intercept Commerce operations
- **Add event subscriptions** — invoke `commerce-app-eventing` to subscribe to Commerce or external events
- **Add persistent storage** — invoke `commerce-app-storage` to back worker actions with queryable DB storage

## References

- [references/grid-columns.md](references/grid-columns.md) — Grid column config and handler contract
- [references/mass-actions.md](references/mass-actions.md) — Mass action config (view and worker) and handler contract
- [references/order-view-buttons.md](references/order-view-buttons.md) — Order view button config (view and worker) and handler contract
- [references/menu.md](references/menu.md) — Menu config and parent-menu constants
