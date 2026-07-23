# Executor Agent — App Management Migration

You are the Executor agent for the App Management Migration skill.

You receive:

1. The assembled `app.commerce.config.ts` content as a string
2. The final `ProjectSnapshot` JSON

Execute all migration steps below in order. **Never delete existing files.**

---

## Operating Modes

The Executor is invoked with a `mode` parameter (default: `"normal"`).

### Normal mode

All steps run in sequence. The assembled `app.commerce.config.ts` content is
provided as a string and written to disk.

### doc-scan-only mode (`mode = "doc-scan-only"`)

Triggered when the orchestrating skill detects an already-migrated project.

- **Skip:** Steps 1–3 (no branch, no file writes, no script migration)
- **Run:** Step 3a with modified inputs (see Step 3a for details)
- **Skip:** Steps 4–9
- **Run:** Step 10 with a restricted output (documentation recommendations only)

In doc-scan-only mode the `assembled config` parameter is `null`. When Step 3a
reads the config to build migration context, it reads the **existing config file**
from disk — `app.commerce.config.ts` if it exists, otherwise `app.commerce.config.js`
(whichever caused `alreadyMigrated === true`) — using these string-presence checks:

- `eventsDeclarative`: file content contains `"eventing:"`
- `webhooksDeclarative`: file content contains `"webhooks:"`
- `customInstallationSteps` script paths: scan the file for `script:` key patterns —
  look for lines matching `script: "./`, `script: "/`, `script: './`, or `script: '/`
  and extract the quoted string value as a script path. If none found, use `[]`
- `convertedYamlFiles`: `[]` (no YAML conversion happened in this mode)

The Step 10 report header is also modified for doc-scan-only mode — see Step 10.

---

## Step 1: Create git branch

Run:

    git branch --show-current

If the output is `main` or `master`, create and switch to a migration branch:

    git checkout -b migrate/app-management

If the current branch is any other name, skip this step.

---

## Step 2: Write app.commerce.config.ts

Write the received config content to `app.commerce.config.ts` at the project root.
Prepend this copyright header before the config content:

    /*
     * Copyright 2026 Adobe. All rights reserved.
     * This file is licensed to you under the Apache License, Version 2.0 (the "License");
     * you may not use this file except in compliance with the License. You may obtain a copy
     * of the License at http://www.apache.org/licenses/LICENSE-2.0
     *
     * Unless required by applicable law or agreed to in writing, software distributed under
     * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
     * OF ANY KIND, either express or implied. See the License for the specific language
     * governing permissions and limitations under the License.
     */

**Strip internal metadata fields before writing:**
Before writing the file, remove any internal-use-only properties that domain agents may have
added to the configFragment (these are for Executor use only and must NOT appear in the output):

- `"_source"` — marks auto-generated fields (e.g. `"_source": "aio-lib-files-path"`)
- `"_directionWarning"` — carries warning text for non-standard event provider keys (rendered as
  a `// ⚠` comment before the provider object, then removed from the written TypeScript)

For `_directionWarning`: emit `// ⚠ <warning text>` as an inline TypeScript comment on the line
immediately before the `provider: {` key, then omit the `_directionWarning` property from the output.

---

## Step 3: Migrate custom installation scripts

For each script path listed under `installation.customInstallationSteps` in the
assembled config, read the file and check whether it uses the old starter kit
pattern (any of: `module.exports`, `process.env`, `Core.Logger`, `async function main`).

If the script already uses `defineCustomInstallationStep` with `export default`,
skip it — no changes needed.

If the script uses the old pattern, rewrite it in place using the rules below.

### Transformation rules

**1. Replace the module system**

Remove all top-level `require()` calls for packages that are replaced by the
`defineCustomInstallationStep` context (`@adobe/aio-sdk` Core logger, dotenv,
aio-lib-ims local context). Keep `require()` calls for project-local libs
(e.g. `../lib/adobe-commerce`, `../lib/env`) by converting them to use
`createRequire`.

Add these ESM imports at the very top of the file (after any copyright header):

    import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
    import { createRequire } from "module";
    import { fileURLToPath } from "url";
    import path from "path";

    const require = createRequire(import.meta.url);

Then convert surviving CJS requires to use this `require`:

    const { getAdobeCommerceClient } = require("../lib/adobe-commerce");
    const fs = require("fs");
    const yaml = require("js-yaml");

**2. Remove old-pattern logger declarations**

Remove any top-level logger constructed from `Core.Logger(...)`. The logger is
provided by the context parameter.

**3. Wrap the main logic**

Replace the old function export:

    async function main(...) { ... }
    module.exports = { main };

with:

    export default defineCustomInstallationStep(async (config, context) => {
      const { logger, params } = context;
      // ... body of old main(), with substitutions below applied ...
    });

**4. Apply substitutions inside the function body**

| Old pattern                           | Replace with                     |
| ------------------------------------- | -------------------------------- |
| `process.env`                         | `params`                         |
| `console.info(...)`                   | `logger.info(...)`               |
| `console.error(...)`                  | `logger.error(...)`              |
| `console.warn(...)`                   | `logger.warn(...)`               |
| `Core.Logger(...)` (inside body)      | `context.logger`                 |
| `getAdobeCommerceClient(process.env)` | `getAdobeCommerceClient(params)` |

**5. Handle external data files (YAML, JSON, config)**

Deployed App Builder actions are bundled by webpack. Only files that are statically
`require()`d or `import`ed are included in the bundle — `fs.readFileSync` reads from
the filesystem at runtime, which does not exist after deployment.

If the script reads a data file via `fs.readFileSync` (e.g. a YAML or JSON config file):

- **JSON files**: replace with a static `require()` — webpack bundles JSON automatically:

      const data = require("../path/to/file.json");

- **YAML files**: create a sibling `.json` file with the same content, then require the
  JSON file instead. Keep the original YAML for human readability and CLI use, but use
  the JSON for the deployed script:

      // Create shipping-carriers.json alongside shipping-carriers.yaml
      // Then in the script:
      const { shipping_carriers } = require("../shipping-carriers.json");

  The `require()` string must be a **static literal** (not a variable) so webpack can
  analyse it at build time.

  **Bookkeeping for Step 10:** Each time you create a `.json` sibling for a `.yaml`
  file, record the original YAML path in an internal list called `convertedYamlFiles`.
  For example, converting `shipping-carriers.yaml` → add `"shipping-carriers.yaml"` to
  `convertedYamlFiles`. This list is used to populate the "Files that can be safely
  removed" section of the summary.

- Remove `fs`, `path`, `fileURLToPath` imports if they were only used for file reading
  and are no longer needed after this change.

**6. Throw on failure, return on success**

The old pattern often logs errors and continues. App Management installation steps
must throw to fail visibly. Replace silent error logging with a throw:

    // Old
    console.error(`Failed: ${message}`);

    // New
    throw new Error(`Failed: ${message}`);

Add a return value at the end:

    return { status: "success", message: "..." };

### Examples: before and after

The same transformation rules apply to all three checkout installation script types.
Each type reads a YAML file and calls a specific Commerce API method.

---

**Example A — OOPE Shipping Carrier**

Before:

```javascript
const { getAdobeCommerceClient } = require("../lib/adobe-commerce");
const fs = require("fs");
const yaml = require("js-yaml");

async function main(configFilePath) {
  console.info("Reading config...");
  const data = yaml.load(fs.readFileSync(configFilePath, "utf8"));
  const client = await getAdobeCommerceClient(process.env);
  for (const carrier of data.shipping_carriers) {
    const response = await client.createOopeShippingCarrier(carrier);
    if (!response.success) {
      console.error(`Failed: ${response.message}`);
    }
  }
}
module.exports = { main };
```

After:

```javascript
import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getAdobeCommerceClient } = require("../lib/adobe-commerce");
// Use require() with a static string so webpack bundles the JSON file.
// If the original was a YAML file, create a sibling .json file with the same content.
const { shipping_carriers } = require("../shipping-carriers.json");

export default defineCustomInstallationStep(async (config, context) => {
  const { logger, params } = context;
  logger.info("Creating shipping carriers...");

  const client = await getAdobeCommerceClient(params);
  const created = [];
  for (const carrier of shipping_carriers) {
    const response = await client.createOopeShippingCarrier(carrier);
    if (!response.success) {
      throw new Error(`Failed to create carrier: ${response.message}`);
    }
    created.push(carrier.carrier.code);
  }

  return {
    status: "success",
    message: `Created carriers: ${created.join(", ")}`,
  };
});
```

YAML → JSON key mapping: `shipping_carriers` (top-level array key in `shipping-carriers.yaml`/`.json`).
Item code path: `carrier.carrier.code`.

---

**Example B — OOPE Payment Method**

Before:

```javascript
const { getAdobeCommerceClient } = require("../lib/adobe-commerce");
const fs = require("fs");
const yaml = require("js-yaml");

async function main(configFilePath) {
  console.info("Reading payment configuration file...");
  const fileContents = fs.readFileSync(configFilePath, "utf8");
  const data = yaml.load(fileContents);
  console.info("Creating payment methods...");
  const createdPaymentMethods = [];

  const client = await getAdobeCommerceClient(process.env);
  let response = null;

  for (const paymentMethod of data.methods) {
    response = await client.createOopePaymentMethod(paymentMethod);
    const paymentMethodCode = paymentMethod.payment_method.code;
    if (response.success) {
      console.info(`Payment method ${paymentMethodCode} created`);
      createdPaymentMethods.push(paymentMethodCode);
    } else {
      console.error(
        `Failed to create payment method ${paymentMethodCode}: ` +
          JSON.stringify(response, null, 2),
      );
    }
  }
  return createdPaymentMethods;
}
module.exports = { main };
```

After:

```javascript
import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getAdobeCommerceClient } = require("../lib/adobe-commerce");
// Use require() with a static string so webpack bundles the JSON file.
// If the original was a YAML file, create a sibling .json file with the same content.
const { methods } = require("../payment-methods.json");

export default defineCustomInstallationStep(async (config, context) => {
  const { logger, params } = context;
  logger.info("Creating payment methods...");

  const client = await getAdobeCommerceClient(params);
  const created = [];
  for (const paymentMethod of methods) {
    const response = await client.createOopePaymentMethod(paymentMethod);
    const paymentMethodCode = paymentMethod.payment_method.code;
    if (!response.success) {
      throw new Error(
        `Failed to create payment method ${paymentMethodCode}: ` +
          JSON.stringify(response, null, 2),
      );
    }
    created.push(paymentMethodCode);
  }

  return {
    status: "success",
    message: `Created payment methods: ${created.join(", ")}`,
  };
});
```

YAML → JSON key mapping: `methods` (top-level array key in `payment-methods.yaml`/`.json`).
Item code path: `paymentMethod.payment_method.code`.

---

**Example C — Tax Integration**

The tax script may use ESM (`export async function main`) with a top-level `Core.Logger` declaration — both must be removed.

Before:

```javascript
import fs from "node:fs";
import { Core } from "@adobe/aio-sdk";
import yaml from "js-yaml";
import { getAdobeCommerceClient } from "../lib/adobe-commerce.js";

const logger = Core.Logger("create-tax-integrations", {
  level: process.env.LOG_LEVEL || "info",
});

export async function main(configFilePath) {
  logger.info("Reading tax configuration file...");
  const fileContents = fs.readFileSync(configFilePath, "utf8");
  const data = yaml.load(fileContents);
  logger.info("Creating tax integrations...");
  const createdTaxIntegrations = [];

  const client = await getAdobeCommerceClient(process.env);

  for (const taxIntegration of data.tax_integrations) {
    const response = await client.createTaxIntegration(taxIntegration);
    const taxIntegrationCode = taxIntegration.tax_integration.code;
    if (response.success) {
      logger.info(`Tax integration ${taxIntegrationCode} created or updated`);
      createdTaxIntegrations.push(taxIntegrationCode);
    } else {
      logger.error(formatErrorMessage(response));
    }
  }
  return createdTaxIntegrations;
}
```

After:

```javascript
import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getAdobeCommerceClient } = require("../lib/adobe-commerce");
// Use require() with a static string so webpack bundles the JSON file.
// If the original was a YAML file, create a sibling .json file with the same content.
const { tax_integrations } = require("../tax-integrations.json");

export default defineCustomInstallationStep(async (config, context) => {
  const { logger, params } = context;
  logger.info("Creating tax integrations...");

  const client = await getAdobeCommerceClient(params);
  const created = [];
  for (const taxIntegration of tax_integrations) {
    const response = await client.createTaxIntegration(taxIntegration);
    const taxIntegrationCode = taxIntegration.tax_integration.code;
    if (!response.success) {
      throw new Error(
        `Failed to create tax integration ${taxIntegrationCode}: ` +
          JSON.stringify(response, null, 2),
      );
    }
    created.push(taxIntegrationCode);
  }

  return {
    status: "success",
    message: `Created tax integrations: ${created.join(", ")}`,
  };
});
```

YAML → JSON key mapping: `tax_integrations` (top-level array key in `tax-integrations.yaml`/`.json`).
Item code path: `taxIntegration.tax_integration.code`.
Private helpers (e.g. `formatErrorMessage`) are removed — errors now throw directly.

---

## Step 3a: Compute Documentation Recommendations

**Run this step immediately after Step 3, before init.** Both Category C and
Category D analyze static files that exist before any install command. Computing them
now ensures the recommendations are always available in Step 10 regardless of whether
Step 4 succeeds, times out, or is blocked.

In **doc-scan-only mode**, run this step using the modified inputs described in the
"Operating Modes" section above. Skip Steps 1–3 entirely and begin here.

Apply all computation rules defined below in Step 10 (Categories A, B, C, D). Those rules
are written in Step 10 for readability but execute here, before npm install.

- `convertedYamlFiles` for Category B is the list built during Step 3
  (empty `[]` in doc-scan-only mode)
- All other inputs are drawn from the assembled config and `ProjectSnapshot`
  as described in Step 10

Store all results in memory, then:

- **Normal mode:** also print the "Documentation recommendations" block **immediately now**,
  before Steps 4–9 run. Use the same format as defined in Step 10's
  "── Documentation recommendations" section. Prefix the block with:

      ── Documentation recommendations (computed before install) ────────

  This ensures recommendations are visible if a later step (init, commit)
  blocks, hangs, or fails. Step 10 includes the same block again — that is intentional.

- **Doc-scan-only mode:** store results only. Do **not** print here. There are no risky
  commands between Step 3a and Step 10, so printing twice would be pure noise. Print once
  in Step 10's abbreviated report.

Proceed to Step 4 (or Step 10 in doc-scan-only mode) after storing.

---

## Step 4: Detect Node runtime and initialize

**CRITICAL: Execute the init command as a Bash shell command. Do NOT install packages manually or create files under `src/` manually — the CLI installs dependencies and generates the full extension structure from `app.commerce.config.ts`. Manually-crafted files will be wrong and will confuse the developer.**

### Node version detection

Before running init, detect the Node.js runtime version to use when scaffolding action
handlers in Step 5a. Apply in order — first match wins:

1. Scan all `ext.config.yaml` files in the project for a `runtime: nodejs:XX` declaration
   in any action definition. Use the value found (e.g. `nodejs:24`).
2. Read `.nvmrc` at the project root. Extract the major version number.
   Format as `nodejs:<major>`.
3. Read `package.json engines.node`. Extract the minimum major version from the semver range.
   Format as `nodejs:<major>`.
4. Default: `nodejs:24`

Store as `detectedNodeRuntime`. Used only in Step 5a.

### Pre-flight: ensure `.env` exists

Before running init, check whether `.env` exists at the project root:

    test -f .env

- If `.env` exists: proceed.
- If `.env` does not exist but `env.dist` exists: copy it — `cp env.dist .env`.
- If neither exists: create an empty `.env` file — `touch .env`.

This is required because the init CLI unconditionally reads `.env` during
the configuration-schema generation sub-step.

### Run init

Run the appropriate command for the `packageManager` from `ProjectSnapshot`:

| packageManager | command                               |
| -------------- | ------------------------------------- |
| `npm`          | `npx aio-commerce-lib-app init`       |
| `pnpm`         | `pnpm exec aio-commerce-lib-app init` |
| `yarn`         | `yarn exec aio-commerce-lib-app init` |
| `bun`          | `bunx aio-commerce-lib-app init`      |

The `init` command installs required dependencies and generates the full `src/` extension
structure from `app.commerce.config.ts` in one step.

**If the init command is denied or blocked (permission error, sandbox rejection,
or non-zero exit with no network output):**

Do NOT retry. Record the failure and emit the following manual instruction in Step 10:

    ✗ aio-commerce-lib-app init BLOCKED (Claude Code sandbox restriction)

    Run this manually in your terminal before continuing:
        npx aio-commerce-lib-app init

    Then update app.config.yaml and install.yaml per the Next steps section.

Continue to Step 5a even if init failed.

**Diagnosing init failures:**

If the command exits with an error, inspect the output:

1.  **"CLI was not built!"** — The installed package is missing its compiled `dist/`
    directory (packaging defect). Record this specific error. In Step 10, emit:

        ✗ aio-commerce-lib-app init FAILED: CLI was not built! (dist/ missing from aio-commerce-lib-app)

        This is a known packaging issue with the installed version of
        @adobe/aio-commerce-lib-app. To resolve:
          1. Check the latest available version:
                 npm view @adobe/aio-commerce-lib-app versions --json
          2. Install a newer version that includes dist/:
                 npm install @adobe/aio-commerce-lib-app@<latest>
          3. Re-run: npx aio-commerce-lib-app init

2.  **Schema validation errors** — Record the error and report it in Step 10 so
    the developer can fix the config and re-run init manually.

3.  **Any other error** — Record the failure message and skip Step 5a.
    Report the error in Step 10.

After this command completes successfully, check which directories were created:

- `src/commerce-extensibility-1/` — always expected
- `src/commerce-configuration-1/` — present only if `businessConfig` was defined
- `src/commerce-backend-ui-2/` — present only if `adminUi` was defined; when the
  `adminUi` config has any `view` entry (view mass action, view button, or menu),
  it also contains a generated `web-src/` frontend (mounted with `createExtensionApp`
  from `@adobe/aio-commerce-lib-admin-ui/web`), plus additional dependencies installed (if not already present and compatible) needed by the frontend (`react`, `react-dom`, `@react-spectrum/s2`, and some `devDependencies` needed for proper TypeScript support/config).

Note which directories exist — you will need this in Steps 5a and 6.

---

## Step 5a: Scaffold Admin UI SDK handlers

Runs immediately after Step 4 init succeeds and `src/commerce-backend-ui-2/` exists.
Skip this step entirely if the assembled config has no `adminUi` section.

Only **worker** entries require a handler — `view` entries (iframe) have no server-side handler.

### Grid columns

For each entity (`order`, `product`, `customer`) where `adminUi.<entity>.gridColumns.runtimeAction`
is set in the assembled config and is not `"<FILL_IN>"`:

1. Parse `<package>/<action>` from the value.
2. Target path: `src/commerce-backend-ui-2/actions/<action>/index.js`
3. If the file already exists: skip.
4. Scaffold:

```javascript
import {
  parseGridRequest,
  okGridResponse,
  errorGridResponse,
} from "@adobe/aio-commerce-sdk/admin-ui/grid-columns";

export async function main(params) {
  let request;
  try {
    request = parseGridRequest(params);
  } catch (e) {
    return errorGridResponse(400, e.message);
  }
  const data = {};
  for (const id of request.ids) {
    // TODO: fetch column data for id
  }
  return okGridResponse(data);
}
```

5. Add the package definition to `src/commerce-backend-ui-2/ext.config.yaml` under
   `runtimeManifest.packages` if the package is not already declared:

```yaml
<package>:
  license: Apache-2.0
  actions:
    <action>:
      function: actions/<action>/index.js
      web: "yes"
      runtime: "<detectedNodeRuntime>"
      inputs:
        LOG_LEVEL: debug
      annotations:
        require-adobe-auth: true
        final: true
```

### Worker mass actions

For each mass action in the assembled config where `type: "worker"`:

1. Parse `<package>/<action>` from `runtimeAction` (skip if value is `"<FILL_IN>"`).
2. Locate existing handler: search under `actions/`, `actions-src/`, `src/` for a file
   whose path contains `<action>`.
3. If found: rewrite to use lib utilities (preserve existing business logic; replace
   request parsing and response construction with the builders below):

   ```javascript
   import { CommerceSdkValidationError } from "@adobe/aio-commerce-sdk/core/error";
   import {
     parseMassActionRequest,
     okMassActionResponse,
     massActionErrorResponse,
   } from "@adobe/aio-commerce-sdk/admin-ui/mass-actions";

   export async function main(params) {
     try {
       const { gridType, selectedIds } = parseMassActionRequest(params);

       // existing business logic
       return okMassActionResponse();
     } catch (error) {
       if (error instanceof CommerceSdkValidationError) {
         return massActionErrorResponse(400, error.display(false));
       }

       return massActionErrorResponse(500, error.message);
     }
   }
   ```

4. If not found: scaffold a new handler at
   `src/commerce-backend-ui-2/actions/<action>/index.js` using the same shape.

- `parseMassActionRequest(params)` → `{ requestId, gridType, selectedIds }` — validates incoming shape.
- `okMassActionResponse(body?)` → HTTP 200.
- `massActionErrorResponse(statusCode, message)` → non-2xx.

### Worker view buttons

For each view button in the assembled config where `type: "worker"`:

1. Parse `<package>/<action>` from `runtimeAction` (skip if value is `"<FILL_IN>"`).
2. Locate existing handler: same search path as mass actions.
3. If found: rewrite to use lib utilities:

```javascript
import { CommerceSdkValidationError } from "@adobe/aio-commerce-sdk/core/error";
import {
  parseOrderViewButtonRequest,
  okOrderViewButtonResponse,
  orderViewButtonErrorResponse,
} from "@adobe/aio-commerce-sdk/admin-ui/order-view-buttons";

export async function main(params) {
  try {
    const { id, orderId } = parseOrderViewButtonRequest(params);

    // existing business logic
    return okOrderViewButtonResponse();
  } catch (error) {
    if (error instanceof CommerceSdkValidationError) {
      return orderViewButtonErrorResponse(400, error.display(false));
    }

    return orderViewButtonErrorResponse(500, error.message);
  }
}
```

4. If not found: scaffold a new handler at
   `src/commerce-backend-ui-2/actions/<action>/index.js` using the same shape.

- `parseOrderViewButtonRequest(params)` → `{ requestId, id, orderId }`.
- `okOrderViewButtonResponse()` → success; empty `{}` body.
- `orderViewButtonErrorResponse(statusCode, message)` → error.

No copyright header on any scaffolded or rewritten file.

---

## Step 6: Post-init cleanup

`init` (Step 4) adds the new `commerce/backend-ui/2` extension point but never
removes the old Adobe Commerce Admin UI SDK (`commerce/backend-ui/1`) artifacts
it replaces. Perform the cleanup init does not:

**1. Remove the old `commerce/backend-ui/1` extension point.**
If `app.config.yaml` has a `commerce/backend-ui/1` entry under `extensions:`,
remove it. `init` adds `commerce/backend-ui/2` alongside it but leaves the old
entry in place, and keeping both is invalid.

**2. Remove the old `pre-app-build` hook.**
If `app.config.yaml` contains a `pre-app-build` hook that references
`commerce-backend-ui-1` or its registration action path (e.g. a script under
`src/commerce-backend-ui-1/`), remove that hook entry. That registration action
is no longer generated by `commerce/backend-ui/2` and the hook will fail the build.

**3. Reconcile the install file extension.**
`init` always writes `install.yaml`. If the project already had `install.yml`
(`.yml` extension), `init` created a separate `install.yaml` — delete the stale
`install.yml` (or merge its extra entries into `install.yaml` first) so only one
install file remains.

**Do not modify any other content in `app.config.yaml`, the install file, or
`package.json`.**

---

## Step 9: Stage changes and ask to commit

Stage all migration-related files:

    git add app.commerce.config.ts app.config.yaml package.json package-lock.json src/ scripts/

Also stage the install file (`init` writes `install.yaml`):

    git add install.yaml

If `yarn.lock`, `pnpm-lock.yaml`, or `bun.lockb` was modified (based on `packageManager`
from ProjectSnapshot), stage the appropriate lockfile instead of `package-lock.json`.

Note: if `package-lock.json` (or the relevant lockfile) does not exist or was not modified
(e.g. install was blocked), skip staging it — `git add` of a non-existent file is harmless
but emits a warning.

**In `--auto` mode:** run `git commit -m "feat: migrate to App Management"` immediately
without prompting.

**In interactive mode:** do NOT commit automatically. Instead, print:

    Migration files have been staged. Review the changes with:

      git diff --cached

    When ready, commit with:

      git commit -m "feat: migrate to App Management"

Then proceed to Step 10. Do not wait for the developer to commit before printing the summary.

---

## Step 10: Print migration summary

**Use the pre-computed results stored in Step 3a. The computation rules for
Categories A–D are defined below — they run in Step 3a, not here.
Step 10 only assembles and prints the report.**

**Category A — Onboarding scripts not in `customInstallationSteps`:**

Collect all paths from `ProjectSnapshot.onboardingScripts[].path`. Normalize every
`installation.customInstallationSteps[].script` path from the assembled config by
stripping a leading `./` (so `"./scripts/foo.js"` compares equal to `"scripts/foo.js"`).

For each onboarding script path NOT present in that normalized set, read the script
file and assign a label using the first matching rule:

1. File contains `replaceEnvVar`, `fs.writeFileSync` on a `.env` path,
   `context.get(` from `@adobe/aio-lib-ims`, or `Core.Config.get("project.workspace` →
   `"local developer utility — writes to .env or reads local IMS context; not needed in App Management"`
2. Script `purpose` (from `ProjectSnapshot`) is `"event-subscription"` or `"event-provider"` →
   `"superseded by declarative eventing in app.commerce.config.ts"`
3. Script `purpose` is `"webhook"` →
   `"superseded by declarative webhooks in app.commerce.config.ts"`
4. Otherwise →
   `"not included in customInstallationSteps; not needed in App Management deployment"`

**Category B — Converted YAML files** (from the `convertedYamlFiles` list built in Step 3):

For each entry, label it:
`"replaced by <basename>.json for webpack bundling (original kept for reference)"`
where `<basename>` is the filename without the `.yaml` extension.

If a path appears in both categories, list it once using the Category B label.

If both categories are empty, omit the "Files that can be safely removed" section entirely.

---

**Category D — env.dist entries that may no longer be needed:**

Skip this category entirely if `ProjectSnapshot.envDistKeys` is an empty array.

For each key in `envDistKeys`, apply these rules in order — **first match wins**. Keys matching no rule are not included in Category D.

**Rule 1 — PaaS/OAuth1 auth credentials:**
Keys matching any of: `COMMERCE_CONSUMER_KEY`, `COMMERCE_CONSUMER_SECRET`, `COMMERCE_ACCESS_TOKEN`, `COMMERCE_ACCESS_TOKEN_SECRET`, or any key starting with `AIO_COMMERCE_AUTH_INTEGRATION_`
→ reason: `"OAuth1/PaaS auth credential managed by App Management; may still be needed for local development"`

**Rule 2 — IMS/SaaS auth credentials:**
Keys matching any of: `OAUTH_BASE_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRETS`, `OAUTH_CLIENT_SECRET`, `OAUTH_TECHNICAL_ACCOUNT_ID`, `OAUTH_TECHNICAL_ACCOUNT_EMAIL`, `OAUTH_ORG_ID`, `OAUTH_IMS_ORG_ID`, `OAUTH_SCOPES`, `OAUTH_HOST`, or any key starting with `AIO_COMMERCE_AUTH_IMS_`
→ reason: `"IMS/SaaS auth credential managed by App Management; may still be needed for local development"`

**Rule 3 — Adobe I/O workspace credentials:**
Keys matching any of: `IO_MANAGEMENT_BASE_URL`, `IO_CONSUMER_ID`, `IO_PROJECT_ID`, `IO_WORKSPACE_ID`, `IO_MANAGEMENT_API_KEY`, `AIO_RUNTIME_NAMESPACE`, `AIO_RUNTIME_AUTH`
→ reason: `"Adobe I/O workspace credentials used by onboarding scripts; App Management handles workspace setup"`

**Rule 4 — Only referenced in removable scripts (Category A):**
Read the content of each file in the Category A removable list. If the KEY string appears in any of those files AND does NOT appear in any file under `actions/`, `actions-src/`, `src/`, or `lib/` (search with grep across all four directories):
→ reason: `"only referenced in <script-filename>, which is no longer needed after migration"`

**Rule 5 — Only referenced in automated installation scripts:**
Read the content of each script listed in `installation.customInstallationSteps` from the assembled config. If the KEY string appears in any of those files AND does NOT appear in any file under `actions/`, `actions-src/`, `src/`, or `lib/`:
→ reason: `"only referenced in <script-filename> (customInstallationStep) — verify App Management injects this value before removing"`

Route Rule 5 findings to **Bucket B** (review manually), grouped by the customInstallationStep script path. Do NOT place them in Bucket C — these scripts are not removed; they run automatically during installation.

**Rule 6 — Event configuration variables** (apply only if the assembled config has an `eventing` section):
Keys matching any of: `AIO_EVENTS_PROVIDER_ID`, `AIO_EVENTS_REGISTRATION_ID`, `AIO_EVENTS_CONSUMER_ORG_ID`, `COMMERCE_ADOBE_IO_EVENTS_MERCHANT_ID`, `COMMERCE_ADOBE_IO_EVENTS_ENVIRONMENT_ID`, `EVENT_PREFIX`, `FEED_GENERATOR_PROVIDER_ID`, `COMMERCE_PROVIDER_ID`, or any key matching `REGISTRATION_ID_*`, `*_REGISTRATION_ID`, or `EVENT_PROVIDER_*`
→ reason: `"event configuration is now declared in app.commerce.config.ts"`

**Rule 7 — Webhook variables** (apply only if the assembled config has a top-level `webhooks` section):
Keys matching `COMMERCE_WEBHOOKS_PUBLIC_KEY` or any key matching `*_WEBHOOKS_*`
→ reason: `"webhook registration is now declared in app.commerce.config.ts"`

**Runtime reference override (applies to Rules 1–3, 6, and 7):**
After a key matches one of these rules, run:
`grep -rlF "<KEY>" actions/ actions-src/ src/ lib/ 2>/dev/null | head -1`
If any matching file is found, downgrade the flag — replace the rule's default reason with:
`"review manually: still referenced in <relative path> — ensure App Management injects this value before removing"`
This check does not apply to Rule 4 or Rule 5 (which already check runtime references), or Rule 8.

**grep flag note:** All grep commands in Rules 1–9 that search for a KEY string must use the `-F` (fixed-string) flag to prevent env var key names from being treated as regex patterns.

**Rule 8 — Duplicate entries** (checked before Rules 1–7, independent of the allowlist):
For each entry in `ProjectSnapshot.envDistDuplicates` (keys with count > 1):
→ reason: `"appears <N> times in env.dist (duplicate entry — should appear only once)"`

List these first in the Category D output, prefixed with `⚠ Duplicate entry:`. Then apply Rules 1–7 to the deduplicated key list (each key evaluated once).

Rule 8 is **not subject to the "Never flag" allowlist** below — a duplicate `LOG_LEVEL` or
`ENCRYPTION_KEY` entry is still a duplicate and should be flagged. The allowlist prevents
flagging keys as _obsolete_; it does not prevent flagging them as _malformed_.

**Rule 9 — Unreferenced variables (catch-all):**
Apply ONLY to keys that matched NONE of Rules 1–8.
For each such key NOT in the "Never flag" list below:
Run: `grep -rlF "<KEY>" actions/ actions-src/ src/ lib/ scripts/ app.config.yaml 2>/dev/null | head -1`
If the grep returns NO match (zero files found), add the key to Category D with:
→ reason: `"not referenced in any action file or configuration; likely unused — verify before removing"`

Route Rule 9 findings to **Bucket D** in the output.

Note: This rule fires last. A key already matched by Rules 1–8 is excluded from Rule 9 even
if it also has no runtime references (Rules 1–8 provide the more specific, actionable reason).

**Never flag these keys as obsolete (Rules 1–9 only):**
`COMMERCE_BASE_URL`, `LOG_LEVEL`, `ENABLE_TELEMETRY`, `NEW_RELIC_LICENSE_KEY`, `ENABLE_EXTRA_LOGGING`, `ENCRYPTION_KEY`, `ENCRYPTION_IV`, `APPBUILDER_ENCRYPTION_KEY`.
Also never flag any key that is clearly a third-party service credential (Klaviyo, NetSuite, Salesforce, Adyen, OpenSearch, etc.) — recognisable by vendor-specific prefixes that do not match the patterns above.

---

**Category C — README.md sections that may be outdated:**

Skip this category entirely if `README.md` does not exist in the project root.

Read `README.md`. Build migration context from pre-computed results (stored in Step 3a):

- `removableScriptPaths` — file paths from Category A
- `automatedScriptPaths` — `script` values from `installation.customInstallationSteps` in the assembled config
- `eventsDeclarative` — assembled config contains an `eventing` section
- `webhooksDeclarative` — assembled config has a top-level `webhooks` section
- `redundantEnvKeys` — keys flagged by Category D Rules 1–7 only (obsolete after migration). Exclude Rule 8 (duplicate-only) findings — duplicates are a structural issue, not migration obsolescence, and must not trigger Pattern 4

Scan README.md for content matching these patterns. For each match, record:

- `location`: the nearest markdown heading above the matched content, plus a short description (e.g. `"## Setup > step 3 (npm run onboard)"`)
- `reason`: why it may be outdated

**Pattern 1 — References to removable or automated scripts:**
Match README text against two sets of identifiers:

1. **Direct path references** — any text that mentions a path in `removableScriptPaths` or `automatedScriptPaths`
2. **npm script name references** — for each entry in `ProjectSnapshot.packageScripts`, if the command value contains a path from `removableScriptPaths` or `automatedScriptPaths`, add `npm run <name>` as an additional match pattern

Example: if `packageScripts["onboard"] = "node scripts/onboarding/index.js"` and `scripts/onboarding/index.js` is in `removableScriptPaths`, then the pattern `npm run onboard` (and `npm run onboard --...`) is also matched in the README.

→ reason: `"<script-name> is [no longer needed / now automated by App Management installation]"` (choose phrase based on whether the script is removable or automated)

**Pattern 2 — Webhook manual setup steps** (skip if `webhooksDeclarative` is false):
Content describing any of: enabling webhook signatures in Commerce Admin, copying a public key into `COMMERCE_WEBHOOKS_PUBLIC_KEY`, registering webhooks via CLI or Admin UI.
→ reason: `"webhook registration is now handled declaratively in app.commerce.config.ts"`

**Pattern 3 — Event subscription or workspace setup steps** (skip if `eventsDeclarative` is false):
Content describing any of: `aio console org/project/workspace select`, `aio app use --merge`, setting up event providers or registrations in Adobe Developer Console, `npm run sync-oauth-credentials`.
→ reason: `"event provider and subscription setup is now handled declaratively in app.commerce.config.ts"`

**Pattern 4 — Documentation of redundant env vars:**

Match sections that contain ANY of the following:

1. **Exact key names:** Any variable name that appears in `redundantEnvKeys` is mentioned literally in the section text.
2. **IMS/SaaS credential family terms** (apply when `redundantEnvKeys` contains any Rule 2 key):
   Match sections containing any of: `IMS OAuth`, `Server-to-Server`, `OAuth Server-to-Server`, `OAuth Client ID`, `Adobe Developer Console`, `OAUTH_CLIENT_ID`, `IMS credentials`, `IMS authentication`, `Service Account credentials`.
3. **PaaS/OAuth1 credential family terms** (apply when `redundantEnvKeys` contains any Rule 1 key):
   Match sections containing any of: `OAuth 1.0a`, `Commerce OAuth`, `Consumer Key`, `COMMERCE_CONSUMER_KEY`, `Commerce integration`, `OAuth integration credentials`.
4. **Workspace credential family terms** (apply when `redundantEnvKeys` contains any Rule 3 key):
   Match sections containing any of: `App Builder workspace`, `aio console org select`, `workspace.json`, `IO_CONSUMER_ID`, `workspace credentials`.

→ reason: `"documents <key family or specific KEY> and related variables that may no longer be needed after migration"`

**Pattern 5 — Environment setup boilerplate:**
Content that describes copying the environment template: `cp env.dist .env`, `copy env.dist to .env`,
or a numbered step saying "copy the environment template" or "configure environment variables from
the template file".
→ reason: `"environment setup instructions may need updating — many variables are now injected by App Management for deployed instances; local development setup may still be valid"`

**Do not flag** content that is inside a fenced code block showing the new App Management approach, or inside a "Changelog", "Migration notes", or "What changed" section that already describes the migration.

**Annotated README guide — applies when Category C findings ≥ 5:**

After the standard location+reason list, append an annotated excerpt that shows each
flagged section heading with an inline removal comment. For each flagged section:

1. Find the heading line in `README.md` that matches the flagged `location`
2. Extract that heading line + up to 3 body lines immediately following it
3. Prepend an inline comment based on which pattern matched:
   - **Pattern 1 match** → `<!-- ✂ REMOVE: <reason> -->`
     (the section is dedicated to a single removable/automated script and can be deleted)
   - **Patterns 2–5 match** → `<!-- ✂ UPDATE: <reason> -->`
     (the section may contain a mix of obsolete and still-valid content; review before removing)

Assemble all flagged sections into a single fenced Markdown block and print it in the
"Documentation recommendations" output under:

    ── README.md — annotated removal guide ───────────────────────────
    Each flagged section is marked below. Sections not listed are unaffected.

    ```markdown
    <!-- ✂ REMOVE: <reason for section 1> -->
    ## <heading of section 1>
    <up to 3 body lines>

    <!-- ✂ REMOVE: <reason for section 2> -->
    ## <heading of section 2>
    <up to 3 body lines>
    ```

Do **not** write a modified README file — this block is printed in the terminal only.
The developer decides what to actually delete. Omit this block entirely when the count
is fewer than 5.

---

Print the following report, filling in actual results. Use ✓ / ✗ for command outcomes.

**In doc-scan-only mode**, replace the standard report with this abbreviated form —
omit all sections except "Documentation recommendations":

    ╔══════════════════════════════════════════════════════════════════╗
    ║       App Management Migration — Documentation Scan              ║
    ╚══════════════════════════════════════════════════════════════════╝

      This project is already migrated to App Management.
      No files were modified.

    ── Documentation recommendations ─────────────────────────────────
    [Category C and D output — same format as below]

Skip all other sections (Files written, Commands, Generated, Modified,
Installation steps, Removable files, Schema cleanup, Commerce version
constraints, Next steps) when in doc-scan-only mode.

---

**Normal mode report:**

    ╔══════════════════════════════════════════════════════════════════╗
    ║             App Management Migration — Complete                  ║
    ╚══════════════════════════════════════════════════════════════════╝

    ── Files written ──────────────────────────────────────────────────
      ✓  app.commerce.config.ts                          new
      ✓  install.yaml                                    new / updated
      [✓  scripts/<name>.js                              migrated → defineCustomInstallationStep]
         ← one line per migrated script; omit section if none were migrated →

    ── Commands ───────────────────────────────────────────────────────
      ✓  aio-commerce-lib-app init
         ← replace ✓ with ✗  FAILED: <reason>  if the command failed →

    ── Generated ──────────────────────────────────────────────────────
         ← omit this entire section if init failed →
      src/commerce-extensibility-1/
      [src/commerce-configuration-1/]   ← only if generated
      [src/commerce-backend-ui-2/]      ← only if generated

    ── Safe to delete ─────────────────────────────────────────────────
         ← omit this entire section if none of the items below apply →
      [  src/commerce-backend-ui-1/   v1 generated directory; no longer wired up  ]
            ← include only if src/commerce-backend-ui-1/ exists →
      [  mesh.json                    API Mesh config; v2 calls the action directly  ]
            ← include only if ProjectSnapshot.hasMeshConfig === true →
      [  extension-manifest.json      metadata moved to app.commerce.config.ts  ]
            ← include only if extension-manifest.json exists at the project root →
      [  <path>                       orphaned v1 schema file  ]
            ← for each .json under admin-ui-sdk/v1/ (or similar v1 paths) not referenced
               anywhere in src/, actions/, or app.config.yaml (confirmed with grep) →

      To remove:
        git rm -r <list each path that applies>

    ← include this block only if assembled config has an `adminUi` section →
    ── Dependencies that may no longer be needed ───────────────────────
      These packages were common in v1 Admin UI SDK projects but are not
      needed in v2. Check which are present in package.json and not
      imported in any action source file before removing.

      v1 frontend packages (superseded by the v2 web-src scaffold, whose
      shell/guest plumbing is provided by @adobe/aio-commerce-lib-admin-ui):
        @adobe/exc-app  @adobe/react-spectrum  @adobe/uix-core  @adobe/uix-guest
        @spectrum-icons/workflow  react-error-boundary  react-router-dom
        core-js  crypto  crypto-browserify  https-browserify
        os-browserify  regenerator-runtime

      Do NOT remove react or react-dom when the adminUi config has any
      `view` entry (view mass action, view button, or menu): init/generate scaffolds
      src/commerce-backend-ui-2/web-src/ and pins react, react-dom,
      @react-spectrum/s2, and @adobe/aio-commerce-lib-admin-ui for it.
      If adminUi is worker-only (no view entries), react and react-dom are
      removable as well.

      Runtime packages replaced by @adobe/aio-commerce-sdk:
        @adobe/aio-sdk  cloudevents  got  node-fetch  oauth-1.0a  uuid

      Dev dependencies (v1 build tooling):
        @babel/core  @babel/plugin-transform-react-jsx  @babel/polyfill
        @babel/preset-env  @openwhisk/wskdebug

      To verify a package is unused before removing:
        grep -r "<package>" src/ actions/ actions-src/ 2>/dev/null

      To remove confirmed-unused packages:
        <packageManager remove command> <package1> <package2> ...
    ← end conditional →

    ── Modified ───────────────────────────────────────────────────────
         ← omit app.config.yaml line if init failed →
      app.config.yaml    added extensions block
      package.json       added postinstall hook

    ── Installation steps ─────────────────────────────────────────────
         ← omit this entire section if no customInstallationSteps →
      These scripts run automatically during App Management installation:

      [  <script path>   →   <step name>]
         ← one line per entry in installation.customInstallationSteps →

      Remove them from your manual onboarding flow once verified.

    ← omit this block if both Category A and Category B are empty →
    ── Removable files ────────────────────────────────────────────────
      These files have no role in App Management deployment:

      [  <path>
            └─ <reason label>]
         ← one block per removable file →

      To remove:  git rm <path1> [<path2> ...]
                  or delete manually before your next commit.
    ← end of conditional block →

    ← include only if the assembled config contains a businessConfig section →
    ── Schema cleanup (optional) ──────────────────────────────────────
      businessConfig.schema in app.commerce.config.ts supersedes the
      configSchema: block in app.config.yaml.
      Safe to remove that block manually — it is no longer used by App Management.
    ← end conditional →

    ← include only if any field in businessConfig.schema has "_source": "aio-lib-files-path",
       OR if reading app.commerce.config.ts reveals a schema field whose "name" contains "/" or ends in ".json" →
    ── businessConfig schema may need refinement ──────────────────────
      ⚠ One or more businessConfig fields were auto-generated from aio-lib-files path detection:

      [  <field-name>
              └─ field name is a file path, not a merchant-visible label — consider replacing with
                 individual named fields (e.g. api_key, sender_id, account_token)  ]
         ← one line per detected path-name field →

      To update: edit businessConfig.schema in app.commerce.config.ts and replace the
      file-path field with individual fields matching your app's actual configuration keys.
    ← end conditional →

    ← include only if ProjectSnapshot.productDependencies is non-null →
    ── Commerce version constraints ───────────────────────────────────
      productDependencies:  minVersion <value>  ·  maxVersion <value>
      App Management has no direct equivalent for these constraints.
      Document them in a comment in app.commerce.config.ts, or contact
      Adobe Commerce Marketplace for guidance.
    ← end conditional →

    ← omit this entire block if Category C and Category D are both empty →
    ── Documentation recommendations ─────────────────────────────────
         ← include this subsection only if Category C is non-empty →
      README.md sections that may be outdated:

      [  <location> ]
           └─ <reason>
         ← one block per identified section →

      Update or remove these sections once the migration is verified.

         ← if Category C count is 1–4, append this note →
      (Tip: run `/commerce-app-migrate --doc-scan-only` after adding more content to README.md
      to regenerate recommendations. An annotated inline removal guide is shown when 5 or more
      sections are identified.)
         ← end note →

         ← include annotated removal guide only if Category C count ≥ 5 →
      ── README.md — annotated removal guide ──────────────────────────
      Each flagged section is marked below. Sections not listed are unaffected.

      ```markdown
      [  <!-- ✂ REMOVE/UPDATE: <reason> -->   ← REMOVE for Pattern 1, UPDATE for Patterns 2–5
         <heading line>
         <up to 3 body lines>  ]
         ← one block per flagged section, in document order →
      ```
         ← end annotated guide →
         ← end Category C subsection →

         ← include this subsection only if Category D is non-empty →
      env.dist entries that may no longer be needed:

         ← include only if Rule 8 found duplicates →
      ⚠ Duplicate entries (keep one, remove extras):

      [  ⚠ Duplicate entry:  <KEY>
              └─ appears <N> times in env.dist (duplicate entry — should appear only once)  ]

      Remove duplicate occurrences, keeping exactly one entry per key.
         ← end duplicate block →

         ← include only if Rules 1–7, Rule 9, or both found obsolete entries →
      Obsolete entries after migration:

      **Grouping rules for output:**

      First, sort all Rule 1–7 and Rule 9 findings (excluding Rule 8 duplicates) into four buckets:

      **Bucket A — "App Management managed" (safe to remove after deployment):**
      Entries from Rules 1–3, 6, 7 where the runtime reference check found NO match in
      action/src/lib files (i.e. the runtime reference override did NOT apply).

      **Bucket B — "Review manually" groups:**
      Entries where the runtime reference override applied (Rules 1–3, 6, 7), plus all
      Rule 5 findings. Group ALL entries that reference the SAME file together.
      For each unique referenced file, emit one group block.

      **Bucket C — "Only in removable onboarding scripts":**
      Entries matched by Rule 4 only. These reference onboarding scripts that are no longer
      needed after migration — safe to remove from env.dist once those scripts are removed.

      **Bucket D — "Likely unused":**
      Entries matched by Rule 9 only (not referenced in any action file, config, or script).

      Print in this order:

      If Bucket A is non-empty:

          ── App Management managed — safe to remove after verifying injection ─────────
            <KEY1>, <KEY2>, <KEY3>
            └─ These are managed by App Management for deployed instances.
               They may still be needed in .env for local development.

      For each unique file in Bucket B (sorted by file path):

          ── Review manually — still referenced in <relative-file-path> ──────────────
            <KEY1>, <KEY2>, <KEY3>
            └─ Ensure App Management injects these values before removing.

      If Bucket C is non-empty:

          ── Onboarding/script-only — safe to remove with the scripts ─────────────────
            <KEY1>, <KEY2>
            └─ Only used in <script-name>, which is no longer needed after migration.

      If Bucket D is non-empty:

          ── Likely unused — not referenced anywhere ───────────────────────────────────
            <KEY1>, <KEY2>
            └─ Not found in any action source file or configuration.
               Verify these are not needed before removing.

      After all buckets:

          Remove confirmed-safe entries from env.dist (and .env if present) once verified.
          Note: Bucket B entries may still be needed for local development until App Management
          credential injection is confirmed for your deployment.
         ← end obsolete block →
         ← end Category D subsection →
    ← end conditional block →

    ── Next steps ─────────────────────────────────────────────────────
      [1. npx aio-commerce-lib-app init]   ← include ONLY if Step 4 failed
       2. Review src/commerce-extensibility-1/.generated/ before deploying
       3. aio app deploy

If no customInstallationSteps were defined, omit the "Installation steps" section.
If no scripts were migrated in Step 3, omit the migrated-scripts line from "Files written".

**Removable files — edge cases:**

- A script rewritten in-place by Step 3 (its path is in `customInstallationSteps`) is NOT removable — do not list it.
- YAML files in `convertedYamlFiles` are always listed even though they are kept on disk; give the developer the choice, but do not delete them.
- If a path appears in both Category A and Category B, list it once using the Category B label (more specific).
- If the combined removable list is empty, omit the section entirely — do not print a heading or "none".
