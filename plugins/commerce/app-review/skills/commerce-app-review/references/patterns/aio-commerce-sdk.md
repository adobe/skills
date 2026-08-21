# Adobe Commerce SDK Usage

## Context

Adobe publishes an official SDK family for interacting with Adobe Commerce from App Builder
actions. Using packages from this family instead of writing custom HTTP/auth/eventing logic
is the Adobe-endorsed approach — it provides typed clients, built-in authentication, retry
logic, and alignment with submission guidelines.

**Five packages can be used independently, without adopting App Management:**
- `@adobe/aio-commerce-lib-auth` — authentication flows for Adobe IMS and Commerce integrations
- `@adobe/aio-commerce-lib-api` — HTTP/API client builders for Adobe Commerce and Adobe I/O Events
- `@adobe/aio-commerce-lib-events` — event-driven integrations between Commerce and Adobe I/O Events
- `@adobe/aio-commerce-lib-webhooks` — utilities for the Adobe Commerce Webhooks API
- `@adobe/aio-commerce-lib-core` — shared foundational utilities used across the family

**Three packages are specific to apps that adopt full App Management** (per Adobe's App Management overview):
- `@adobe/aio-commerce-lib-app` — app definition, validation, and manifest generation
- `@adobe/aio-commerce-lib-config` — configuration management with scope trees and inheritance
- `@adobe/aio-commerce-lib-admin-ui` — wire contract builders, menu constants, and the permission client for Admin UI SDK extension points

There is also `@adobe/aio-commerce-sdk`, a convenience meta-package bundling several of the packages above.

Reference: https://github.com/adobe/aio-commerce-sdk

Separately, **App Management** lets you define your configuration schema, event
subscriptions, and Admin UI once in an `app.commerce.config` file, and the system
auto-generates the required runtime actions and Admin UI. This is Adobe's endorsed approach
for installing, configuring, and managing App Builder applications in Commerce.

App Management requires:
- Admin UI SDK version 3.3.0 or later (4.2.0 or later specifically for `adminUi` menu entries, grid columns, mass actions, or order view buttons)
- `@adobe/aio-commerce-lib-config` version 1.0.0 or later — required only if the app defines business configuration
- `@adobe/aio-commerce-lib-app` version 1.0.0 or later (some features, e.g. the `getCommerceClient`/`getCommerceInstance` helpers, require newer versions — 1.8.0+)
- `@adobe/aio-commerce-lib-admin-ui` version 1.0.0 or later — required only for the `commerce/backend-ui/2` Admin UI extension point
- `@adobe/aio-commerce-sdk` version 1.0.0 or later
- A hosted (cloud or on-premises) environment — **not currently supported for local Commerce installations**

Reference: https://developer.adobe.com/commerce/extensibility/app-management/

## Recommendations (independent of each other)

1. **SDK:** Declare at least one package from the standalone-usable set above in
   `package.json` `dependencies`, instead of writing custom HTTP/auth/eventing logic.
2. **App Management:** Add an `app.commerce.config` file to the project root (exact
   supported file extensions not independently verified — check Adobe's current App
   Management documentation) if the app is hosted (not a local installation) and meets the
   version requirements above.

An app can adopt one, both, or neither — App Management is a further step beyond basic SDK
usage, not a prerequisite for it.

> **Note:** as of the current [App submission guidelines](https://developer.adobe.com/commerce/extensibility/app-development/app-submission-guidelines), Adobe Commerce SDK / App Management adoption is listed under Best Practices, not Requirements — so these findings are `NICE`, not `MUST`. This is expected to change to a `MUST` requirement in a future update; when Adobe's guidelines move this section to Requirements, update the severities below accordingly.

## Findings

| Condition | Severity |
|---|---|
| Custom HTTP/auth/eventing logic exists that duplicates what `@adobe/aio-commerce-lib-auth`, `-api`, `-events`, or `-webhooks` already provides | `NICE` |
| Consider adding `app.commerce.config` to enable App Management — if the app is hosted (not local) and no existing constraint (e.g. Admin UI SDK version) blocks it | `NICE` |
| Any SDK family package present in `package.json` dependencies | `NA` |
| An `app.commerce.config` file is present in the project root | `NA` |
