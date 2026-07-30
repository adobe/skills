---
name: commerce-app-storage
description: >
  Integrate App Builder Database Storage (@adobe/aio-lib-db) into an Adobe
  Commerce app and scaffold a runtime action that reads and writes documents.
  Use when the user wants persistent, queryable storage backing a Commerce app —
  either from a web action (HTTP-invokable) or from an event/webhook handler.
  Requires a base app initialized with commerce-app-init.
license: Apache-2.0
compatibility: >
  Requires Node.js 22+, aio CLI, @adobe/aio-commerce-lib-app, and a provisioned
  workspace database with the App Builder Data Services API added to the project
  in the Adobe Developer Console. Requires a base app initialized with commerce-app-init.
metadata:
  author: adobe
  sdk-package: "@adobe/aio-commerce-lib-app"
  version: "0.0.3"
---

# Add Database Storage to a Commerce App

Integrates App Builder Database Storage into an existing Commerce app and scaffolds a runtime action that uses `@adobe/aio-lib-db` to read and write documents. The library is MongoDB-like: data lives in collections of documents, queried with familiar filters.

The db-access code is identical regardless of action type — what differs is how the action is registered and what its handler returns:

- **Web action** — HTTP-invokable (`web: "yes"`); returns a response built with the `responses` helpers from `@adobe/aio-commerce-lib-core`.
- **Event/webhook action** — invoked by a Commerce event or webhook; referenced from `app.commerce.config.ts` via `commerce-app-eventing` (`runtimeActions`) or `commerce-app-webhooks` (`runtimeAction`).

## Prerequisites

- Verify the app is **scaffolded and initialized**, not merely that the config exists. Require **both**:
  - `app.commerce.config.ts` present in the project root, **and**
  - the project initialized — signalled by the generated `src/commerce-extensibility-1/` directory and installed `node_modules` (the `@adobe/aio-commerce-lib-app` dependency).
- If `app.commerce.config.ts` is **missing**, stop and invoke `commerce-app-init` first (it writes the config, then runs init).
- If the config is **present but the project is not initialized** (no `src/commerce-extensibility-1/` or `node_modules`), run `npx @adobe/aio-commerce-lib-app init` before continuing. Init is idempotent — it finds the existing config, skips the interactive prompts, installs dependencies, and generates the project files.
- The **App Builder Data Services** API (API code `AppBuilderDataServicesSDK`) must be **added to the project in the Adobe Developer Console** — in every workspace that uses the database (no special license beyond App Builder). Without it, runtime actions cannot authenticate to the database service.

## Step 1 — Provision the workspace database

There is a strict one-to-one relationship between an AIO project workspace and a workspace database. The recommended way to provision it is **declaratively** in `app.config.yaml` — the database is provisioned (if not already present) on `aio app deploy`:

```yaml
application:
  runtimeManifest:
    database:
      auto-provision: true
      region: emea # amer | apac | emea | aus — the single source of truth for the region
```

**Extension-only apps need a workaround.** Due to a bug in the `aio app` CLI plugin (not `aio-lib-db`), `aio app deploy` only runs declarative auto-provision when the `application` runtime manifest has at least one package with a runtime action. Apps built purely with `extensions` (the recommended layout per the submission guidelines) have no `application` actions, so deploy silently skips provisioning. Make the `application` block "real enough" for provisioning to run by adding an empty packages map and a `post-app-build` hook that creates the directory the provisioning step expects:

```yaml
application:
  hooks:
    post-app-build: "mkdir -p dist/application/actions" # provisioning expects this dir to exist
  runtimeManifest:
    packages: {} # empty map — required by the config schema so the application block validates with no actions
    database:
      auto-provision: true
      region: emea # single source of truth — see the region callout below
```

For **local development**, declarative auto-provisioning does **not** run during `aio app run` / `aio app dev`. Provision once up front with the CLI fallback (self-service, no special permissions). The `aio app db …` commands are only available once the [storage CLI plugin](https://github.com/adobe/aio-cli-plugin-app-storage) is installed:

```sh
aio plugins install @adobe/aio-cli-plugin-app-storage
aio app db provision --region <amer|apac|emea|aus>
```

> **Region is a single source of truth.** The `region` in the manifest `database` block must match the `region` passed to every `initDb({ region })` call (or `AIO_DB_REGION`) — in every action **and** in the install step (Step 6). A mismatch fails the connection. Changing region is destructive: `aio app db delete`, update `database.region` in the manifest, then re-provision.

## Step 2 — Install the library

```sh
npm install @adobe/aio-lib-db
```

## Step 3 — Understand intent

Gather from the user:

- **Action type**: web action or event/webhook action (see the two shapes above).
- **Collection name** and the **operations** needed (insert / find / update / delete).
- **Region**: must match the manifest `database.region` (see the region callout in Step 1). Pass it to `init()` or set `AIO_DB_REGION`.

## Step 4 — Register the action

Add the action to a user-defined package in `src/commerce-extensibility-1/ext.config.yaml` (any name except `app-management`, which is reserved).

> **`include-ims-credentials: true` is required on every DB action.** Without it, `aio-lib-db` has no IMS token to authenticate with and the connection fails at runtime (and the app installation fails if the action runs during install). Do not omit this annotation.

```yaml
# src/commerce-extensibility-1/ext.config.yaml
runtimeManifest:
  packages:
    app-management:
      # ... auto-generated — do not edit
    my-app: # any name except "app-management"
      actions:
        store-record:
          function: actions/store-record/index.js # relative to src/commerce-extensibility-1/
          runtime: nodejs:24
          web: "yes" # "yes" for a web action; "no" for an event/webhook action
          annotations:
            include-ims-credentials: true # REQUIRED for aio-lib-db auth
```

| Field                     | Constraint                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| Package name              | Lowercase alphanumeric + hyphens; never `app-management` (reserved)               |
| `function`                | Path relative to `src/commerce-extensibility-1/` — not `src/...` or root-relative |
| `include-ims-credentials` | Must be `true` — without it `init()` has no IMS token and the connection fails    |
| `web`                     | `"yes"` for HTTP-invokable web actions; `"no"` for event/webhook handlers         |
| Collection name           | Non-empty string; created on first write if it doesn't exist                      |
| Region                    | Must match the manifest `database.region` (`amer` \| `apac` \| `emea` \| `aus`)   |

## Step 5 — Implement the handler

Every handler follows the same lifecycle: resolve IMS auth → mint token → `init` → `connect` → use a collection → **always `close` in `finally`**.

```ts
// Web action — src/commerce-extensibility-1/actions/store-record/index.ts
import { buildErrorResponse, ok } from "@adobe/aio-commerce-lib-core/responses";
import {
  getImsAuthProvider,
  resolveImsAuthParams,
} from "@adobe/aio-commerce-lib-auth";
import { init as initDb } from "@adobe/aio-lib-db";

export async function main(params: Record<string, unknown>) {
  let client;
  try {
    // Resolve the injected AIO_COMMERCE_AUTH_IMS_* params, then mint a raw token string.
    const authProvider = getImsAuthProvider(resolveImsAuthParams(params));
    const token = await authProvider.getAccessToken();
    const db = await initDb({ token, region: "emea" }); // must match the manifest database.region
    client = await db.connect();
    const records = client.collection("records");

    const result = await records.insertOne({
      ...(params.document as object),
      createdAt: new Date().toISOString(),
    });
    return ok({ body: { result } });
  } catch (error: any) {
    return buildErrorResponse(error.statusCode || 500, {
      body: { message: error.message },
    });
  } finally {
    if (client) await client.close(); // always close — avoids connection leaks
  }
}
```

For an **event/webhook action** the only differences are `web: "no"` in registration and that the payload arrives in `params.data`:

```ts
// Event/webhook handler — same init/connect/close lifecycle
export async function main(params: Record<string, unknown>) {
  const data = params.data as Record<string, unknown>;
  let client;
  try {
    const authProvider = getImsAuthProvider(resolveImsAuthParams(params));
    const token = await authProvider.getAccessToken();
    const db = await initDb({ token, region: "emea" });
    client = await db.connect();
    await client
      .collection("orders")
      .insertOne({ orderId: data.order_id, receivedAt: new Date() });
    return ok({ body: { processed: true } });
  } finally {
    if (client) await client.close();
  }
}
```

See [assets/db-action.ts](assets/db-action.ts) for the full annotated reference covering all CRUD operations and cursor iteration.

## Step 6 — Set up collections and indexes on install

For an App Management app, create collections and indexes with a **custom installation step** — a script that runs once when the app is installed from the Commerce Admin, and can be reversed on uninstall. Prefer this over creating them ad-hoc on the first request.

Author the step with `defineCustomInstallationStep` (an `install` handler plus an optional `uninstall`). Inside it, resolve the IMS auth params from **`context.params`** — _not_ `config` — then follow the same init → connect → `close` lifecycle as Step 5, and call `createIndex` **on the collection object**:

```ts
// ./scripts/setup-database.ts — referenced from config as ./scripts/setup-database.js
import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import {
  getImsAuthProvider,
  resolveImsAuthParams,
} from "@adobe/aio-commerce-lib-auth";
import { init as initDb } from "@adobe/aio-lib-db";

export default defineCustomInstallationStep({
  install: async (config, context) => {
    let client;
    try {
      // context.params carries the injected IMS credentials — NOT config.
      const authProvider = getImsAuthProvider(
        resolveImsAuthParams(context.params),
      );
      const token = await authProvider.getAccessToken();
      const db = await initDb({ token, region: "emea" }); // must match the manifest database.region
      client = await db.connect();

      const orders = client.collection("held_orders"); // get the collection object first
      await orders.createIndex({ order_id: 1 }, { unique: true }); // createIndex on the collection, not a name string
      return { status: "success" };
    } finally {
      if (client) await client.close(); // always close — avoids connection leaks
    }
  },
  uninstall: async (config, context) => {
    // Tear down your database state here.
    // Leave empty to preserve data across reinstalls.
  },
});
```

> **Author the install script as an ES module with `export default` — never `module.exports`.** The installation action loads each step via `import * as step from "<script>"` and reads `step.default`, so the script must default-export the `defineCustomInstallationStep(...)` result. CommonJS breaks this: `module.exports.default` surfaces as `step.default.default` and validation fails. The `script` path must end in `.js`; if you author in TypeScript, compile it and keep the emitted `.js` an ES module.

Register the step in `app.commerce.config.ts` under `installation.customInstallationSteps`. The `script` path points at the compiled `.js` output:

```ts
// app.commerce.config.ts
installation: {
  customInstallationSteps: [
    {
      script: "./scripts/setup-database.js", // compiled output of setup-database.ts
      name: "Set up held-orders collection",
      description: "Creates the held_orders collection and a unique index on order_id",
    },
  ],
},
```

| Field         | Constraint                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `script`      | Path relative to the project root; must be an ES module (`export default`) ending in `.js` (compile from TS if you author it that way) |
| `name`        | Non-empty string, ≤ 255 characters; **unique** across all installation steps                                                           |
| `description` | Non-empty string, ≤ 255 characters                                                                                                     |

See [assets/setup-database.ts](assets/setup-database.ts) for the full annotated install/uninstall reference.

## Step 7 — Validate

```sh
aio app build
```

A build failure points directly to the offending config field. To exercise the action against the real database, deploy and invoke it (`aio app deploy`).

## Best practices

- **Always close connections** in a `finally` block — leaked connections exhaust resources.
- **Match the region** — the manifest `database.region` is the single source of truth; every `init()` call and the install step must use it (see the region callout in Step 1). A mismatch fails the connection silently from the caller's view.
- **Use projections** (`.project({ field: 1 })`) and **indexes** (`createIndex`) for frequently queried fields; index fields must total ≤ 2048 bytes.
- **Iterate large result sets with cursors** (`for await (const doc of collection.find(...))`) instead of `toArray()` to bound memory.
- **Don't hardcode the region or secrets** — prefer `AIO_DB_REGION` and the injected IMS token over inline values.
- **Prefer the most specific Adobe I/O library** in runtime actions over the `@adobe/aio-sdk` umbrella — e.g. `@adobe/aio-commerce-lib-auth` for IMS auth and `@adobe/aio-lib-core-logging` for the logger — to keep action bundles small.
- **Set up collections and indexes during installation** with a custom installation step (`defineCustomInstallationStep`, see Step 6) rather than ad-hoc on the first request — it runs once when the app is installed from the Commerce Admin and is reversible on uninstall. A generic App Builder `post-app-deploy` hook is only an alternative when the app is not installed through App Management.

## Common Issues

- **Connection fails despite a valid token**: the action is missing `include-ims-credentials: true`, or the **App Builder Data Services** API has not been added to the project in the Adobe Developer Console (see Prerequisites).
- **DB not provisioned after `aio app deploy` (extension-only app)**: a bug in the `aio app` CLI plugin (not `aio-lib-db`) skips declarative auto-provision when the `application` runtime manifest has no runtime action. Apply the extension-only workaround from Step 1 — add `packages: {}` and a `post-app-build: "mkdir -p dist/application/actions"` hook under `application` — or provision once with the CLI fallback for local dev.
- **Connection fails after a region change**: the library region doesn't match the manifest `database.region`. Moving regions is destructive — `aio app db delete`, update `database.region` in the manifest, then re-provision (`aio app deploy`, or the CLI fallback for local dev).
- **Querying by `_id` from a string returns nothing**: convert it first — `new ObjectId(idString)` from `bson`. A raw string never matches the stored `ObjectId`.
- **`DbError` vs unexpected error**: errors thrown by the service have `name === "DbError"`; branch on it to separate database failures from application bugs.
- **Auth fails inside an installation step**: resolve the IMS auth params from `context.params` (`resolveImsAuthParams(context.params)`) — which carries the injected `AIO_COMMERCE_AUTH_IMS_*` credentials — not from `config`, which holds no credentials. Use `@adobe/aio-commerce-lib-auth`, not `@adobe/aio-lib-core-auth`: the latter's `generateAccessToken` expects `clientId`/`clientSecret` directly and cannot consume the injected params.
- **Installation step fails to load (`must export a default function or object`)**: the script was authored as CommonJS. Author it as an ES module with `export default`; `module.exports` (or `module.exports.default`) surfaces through the framework's `import * as` loader as `.default.default` and fails validation.
- **`createIndex` errors or has no effect**: it must be called on a collection object (`client.collection("name").createIndex({ field: 1 })`), not with a collection-name string. Get the collection first, then call `createIndex` on it.

## Quality Bar

- `aio app build` completes without errors
- Every user-authored DB action declares `include-ims-credentials: true` in its annotations
- The action closes the client in a `finally` block and initializes the library in the region declared in the manifest `database` block

## Chaining

- **Wire the action to an event** — invoke `commerce-app-eventing` and reference this action in an event's `runtimeActions`.
- **Wire the action to a webhook** — invoke `commerce-app-webhooks` and reference this action via `runtimeAction`.
- **Trigger the action from Admin UI** — invoke `commerce-app-admin-ui` to add a mass action, order view button, or grid column that invokes this runtime action.

## References

- [assets/db-action.ts](assets/db-action.ts) — Full annotated handler: init/connect, CRUD, cursor iteration, and the close lifecycle
- [assets/setup-database.ts](assets/setup-database.ts) — Full annotated custom installation step: install creates a collection and a unique index, uninstall drops it, with the `context.params` and `createIndex`-on-collection patterns
