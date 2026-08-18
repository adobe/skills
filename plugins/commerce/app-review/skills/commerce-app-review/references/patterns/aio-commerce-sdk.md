# Adobe Commerce SDK Usage

## Context

Adobe publishes an official SDK family for interacting with Adobe Commerce from App Builder
actions. Using any package from this family is the Adobe-endorsed approach — it provides
typed clients, built-in auth, retry logic, and alignment with submission guidelines.

The family includes:
- `@adobe/aio-commerce-sdk` — umbrella package (recommended entry point)
- `@adobe/aio-commerce-lib-auth` — IMS and Commerce authentication utilities
- `@adobe/aio-commerce-lib-core` — core utilities
- `@adobe/aio-commerce-lib-api` — HTTP/API client builders
- `@adobe/aio-commerce-lib-events` — Adobe I/O and Commerce Eventing
- `@adobe/aio-commerce-lib-webhooks` — Commerce Webhooks API
- `@adobe/aio-commerce-lib-admin-ui` — Admin UI SDK v2 extensions (`commerce/backend-ui/2`)

Reference: https://github.com/adobe/aio-commerce-sdk

An `app.commerce.config` file in the project root enables Commerce app management
features (deployment tracking, lifecycle hooks, environment configuration).
Supported formats: `.js`, `.ts`, `.cjs`, `.mjs`, `.mts`, `.cts`.

Reference: https://developer.adobe.com/commerce/extensibility/app-management/

## Required implementation

**SDK:** Declare at least one package from the family above in `package.json` `dependencies`.
The umbrella package (`@adobe/aio-commerce-sdk`) is the recommended starting point.

**Config file:** Add an `app.commerce.config.*` file to the project root in any of the
supported formats above.

## Findings

| Condition | Severity |
|---|---|
| Consider using `@adobe/aio-commerce-sdk` or one of the `@adobe/aio-commerce-lib-*` packages (excluding `@adobe/aio-commerce-lib-admin-ui` which is specific to Admin UI SDK v2) for interacting with Adobe Commerce from your runtime actions — they provide typed API clients, built-in IMS authentication, retry logic, and keep your code aligned with Adobe's recommended patterns | `NICE` |
| Consider adding `app.commerce.config` to enable App Management — it allows merchants to configure the app directly from the Commerce Admin without needing environment variables or CLI access. | `NICE` |
| Any SDK family package present in `package.json` dependencies | `NA` |
| An `app.commerce.config.*` file is present in the project root | `NA` |
