# Module & Add-on Catalog (AEM 6.5 LTS / AMS)

Use this catalog when generating AGENTS.md. Only include entries whose directories actually exist in the project.

## Core modules

| Module | Description |
|---|---|
| `core` | OSGi bundle. Contains the Java code for backend services, models, and business logic. Uses OSGi for dependency injection, Sling models for exposing content to Sling scripts and JUnit for unit testing. |
| `dispatcher` | Dispatcher configuration for Apache HTTP Server (caching, filters, virtual hosts). Validated with `httpd -t` or `apachectl configtest`. Layout may follow AMS immutable-file conventions or a classic on-prem structure. |
| `ui.apps` | FileVault content package. Contains the application code, including components, templates, client libraries, and content structure. Uses HTL as the scripting engine. |
| `ui.apps.structure` | FileVault content package. Empty module that defines the structure of the repository content. |
| `ui.config` | FileVault content package. Contains OSGi configurations for the application. |
| `ui.content` | FileVault content package. Contains the mutable content for the application, such as the initial site structure, templates, sample assets. |
| `it.tests` | Integration tests module. Uses the AEM Testing clients to run tests against running AEM instances. Run in CI or locally before releases. |
| `ui.tests` | UI tests module. Often Cypress or similar for end-to-end tests against running AEM instances. Run in CI or locally; AMS teams may wire this into Cloud Manager where applicable. |
| `all` | FileVault content package. Includes all other FileVault packages for easy deployment. |

## Frontend module variants

Only ONE of these applies per project. Match by detected frontend type.

| Variant | Module name | Description |
|---|---|---|
| **General (Webpack)** | `ui.frontend` | Frontend module built with Webpack. Compiles TypeScript/JavaScript and Sass/SCSS. During the build it's copied to the `ui.apps` module as client libraries. Uses Node.js, npm, and webpack. |
| **React SPA** | `ui.frontend` | React-based SPA module. Uses `@adobe/aem-react-editable-components` for SPA Editor integration. During the build it's copied to the `ui.apps` module as client libraries. Run `npm start` to develop locally with a proxy to AEM (port 3000 is common). Uses Node.js, npm, and webpack. |
| **Angular SPA** | `ui.frontend` | Angular-based SPA module. Uses `@adobe/aem-angular-editable-components` for SPA Editor integration. During the build it's copied to the `ui.apps` module as client libraries. Run `npm start` to develop locally with a proxy to AEM (port 4200 is common). Uses Node.js, npm, and webpack. |
| **Decoupled** | `ui.frontend` | Decoupled frontend (headless or externally hosted). Consumes AEM content via HTTP/APIs; deployment may be separate from the AEM packages. May not emit client libraries into `ui.apps` depending on setup. |

## Add-ons (include only if detected)

| Add-on | Section text for AGENTS.md |
|---|---|
| **CIF (Commerce)** | **Commerce Integration Framework (CIF)**: The commerce backend endpoint is configured in `ui.config` OSGi configurations. CIF Core Components support commerce experiences (product pages, catalog, search, cart, checkout) for AEM 6.5 Content and Commerce. |
| **AEM Forms** | **AEM Forms**: Adaptive Forms, templates, themes, and configurations for building form experiences on AEM 6.5. |
| **Headless Forms** | **Headless Adaptive Forms**: The `ui.frontend.react.forms.af` module provides a React-based rendering layer for forms consumed via form model JSON, where this add-on is used. |
| **Precompiled Scripts** | **Precompiled Scripts**: HTL scripts from `ui.apps` can be precompiled into a bundle during the build for improved runtime performance (archetype / Core Components pattern). |

When an add-on is detected, add a `## Add-ons and extensions` section between the intro paragraph and `## Modules`, listing each detected add-on as a bullet.

## CIF-specific module note

If CIF is detected, append to the `core` module description: `, including commerce-specific models and servlets`.

## Headless Forms module

If Headless Forms is detected, add this module to the Modules list:
- `ui.frontend.react.forms.af`: React-based headless Adaptive Forms rendering module. Consumes form models and renders forms in a headless manner. Uses Node.js, npm, and webpack.

## Conditional resources

### Base resources (always include)

These are already in the AGENTS.md template. Always keep them.

### SPA resources (React or Angular detected)

Add after the base resources (skip if already present from the base template):

If React:
- [AEM React Editable Components](https://www.npmjs.com/package/@adobe/aem-react-editable-components)

If Angular:
- [AEM Angular Editable Components](https://www.npmjs.com/package/@adobe/aem-angular-editable-components)

### Decoupled frontend resources

- [AEM 6.5 — Headless overview](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/headless/overview)

### CIF resources

- [AEM Content and Commerce introduction](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/commerce/introduction)
- [CIF Core Components](https://github.com/adobe/aem-core-cif-components)

### Forms resources

- [Introduction to AEM Forms](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/forms/getting-started/introduction-aem-forms)
- [Forms Core Components](https://github.com/adobe/aem-core-forms-components)

### Headless Forms resources

- [Introduction to AEM Forms](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/forms/getting-started/introduction-aem-forms) (confirm headless modules in your project README)

### Precompiled Scripts resources

- [Precompiled Bundled Scripts (Core Components)](https://experienceleague.adobe.com/en/docs/experience-manager-core-components/using/developing/archetype/precompiled-bundled-scripts)
