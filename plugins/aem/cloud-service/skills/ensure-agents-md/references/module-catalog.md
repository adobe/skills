# Module & Add-on Catalog

Use this catalog when generating AGENTS.md. Only include entries whose directories actually exist in the project.

## Core modules

| Module | Description |
|---|---|
| `core` | OSGi bundle. Contains the Java code for backend services, models, and business logic. Uses OSGi for dependency injection, Sling models for exposing content to Sling scripts and JUnit for unit testing. |
| `dispatcher` | Contains the cloud-optimized Dispatcher configuration, including caching and security settings. Uses immutable files that are validated by the Dispatcher SDK. |
| `ui.apps` | FileVault content package. Contains the application code, including components, templates, client libraries, and content structure. Uses HTL as the scripting engine. |
| `ui.apps.structure` | FileVault content package. Empty module that defines the structure of the repository content. |
| `ui.config` | FileVault content package. Contains OSGi configurations for the application. |
| `ui.content` | FileVault content package. Contains the mutable content for the application, such as the initial site structure, templates, sample assets. |
| `it.tests` | Integration tests module. Uses the AEM Testing clients to run tests against running AEM instances. Executed by Cloud Manager during the _Custom Functional Testing_ step of a full stack pipeline. |
| `ui.tests` | UI tests module. Uses Cypress to run end-to-end tests against running AEM instances. Executed by Cloud Manager during the _Custom UI Testing_ step of a full stack pipeline. |
| `all` | FileVault content package. Includes all other FileVault packages for easy deployment. |

## Frontend module variants

Only ONE of these applies per project. Match by detected frontend type.

| Variant | Module name | Description |
|---|---|---|
| **General (Webpack)** | `ui.frontend` | Frontend module built with Webpack. Compiles TypeScript/JavaScript and Sass/SCSS. During the build it's copied to the `ui.apps` module as client libraries. Uses Node.js, npm, and webpack. |
| **React SPA** | `ui.frontend` | React-based SPA module built with Create React App. Uses `@adobe/aem-react-editable-components` for SPA Editor integration. During the build it's copied to the `ui.apps` module as client libraries. Run `npm start` to develop locally with a proxy to AEM (port 3000). Uses Node.js, npm, and webpack. |
| **Angular SPA** | `ui.frontend` | Angular-based SPA module built with Angular CLI. Uses `@adobe/aem-angular-editable-components` for SPA Editor integration. During the build it's copied to the `ui.apps` module as client libraries. Run `npm start` to develop locally with a proxy to AEM (port 4200). Uses Node.js, npm, and webpack. |
| **Decoupled** | `ui.frontend` | Decoupled frontend module (headless). Consumes AEM content via JSON model APIs. Deployed via the AEM as a Cloud Service Frontend Pipeline separately from backend code. No client libraries are generated in `ui.apps`. |

## Add-ons (include only if detected)

| Add-on | Section text for AGENTS.md |
|---|---|
| **CIF (Commerce)** | **Commerce Integration Framework (CIF)**: The commerce backend endpoint is configured in `ui.config` OSGi configurations. CIF Core Components are included for building commerce experiences (product pages, catalog, search, cart, checkout). |
| **AEM Forms** | **AEM Forms**: Forms Core Components are provided OOTB in AEM as a Cloud Service. The project contains Adaptive Forms components, templates, themes, and configurations for building form experiences. |
| **Headless Forms** | **Headless Adaptive Forms**: The `ui.frontend.react.forms.af` module provides a React-based rendering layer for forms consumed via the form model JSON. Forms can be rendered in external applications while leveraging AEM Forms capabilities for form logic and data handling. |
| **Precompiled Scripts** | **Precompiled Scripts**: HTL scripts from `ui.apps` are precompiled into a bundle during the build and attached as a secondary bundle artifact for improved performance. |

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

Add after the base resources:
- [SPA Editor Overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/hybrid/introduction)
- [Developing SPAs for AEM](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/hybrid/developing)

If React:
- [AEM React Editable Components](https://www.npmjs.com/package/@adobe/aem-react-editable-components)

If Angular:
- [Create your first Angular SPA in AEM](https://experienceleague.adobe.com/en/docs/experience-manager-learn/getting-started-with-aem-headless/spa-editor/angular/overview)
- [AEM Angular Editable Components](https://www.npmjs.com/package/@adobe/aem-angular-editable-components)

### Decoupled frontend resources

- [Enabling Front-End Pipeline](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/administering/site-creation/enable-front-end-pipeline)

### CIF resources

- [Adobe Commerce Integration](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/content-and-commerce/storefront/getting-started)
- [CIF Core Components](https://github.com/adobe/aem-core-cif-components)

### Forms resources

- [AEM Forms Overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/forms/forms-overview/home)
- [Forms Core Components](https://github.com/adobe/aem-core-forms-components)
- [Form builder: Create forms with core components](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/forms/adaptive-forms-authoring/authoring-adaptive-forms-core-components/create-an-adaptive-form-on-forms-cs/creating-adaptive-form-core-components)

### Headless Forms resources

- [Headless Adaptive Forms](https://experienceleague.adobe.com/en/docs/experience-manager-headless-adaptive-forms/using/overview)

### Precompiled Scripts resources

- [Precompiled Bundled Scripts](https://experienceleague.adobe.com/en/docs/experience-manager-core-components/using/developing/archetype/precompiled-bundled-scripts)
