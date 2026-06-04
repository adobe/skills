# Module and add-on catalog

> **Beta Skill:** Outputs must be reviewed before applying to production.

Use this catalog when generating per-module `AGENTS.md`. Only include
entries whose directories actually exist in the project.

## Core modules

| Module | Description |
|---|---|
| `core` | OSGi bundle. Backend services, Sling Models, business logic. Uses OSGi for dependency injection, Sling Models for exposing content to scripts, and JUnit for unit testing. |
| `dispatcher` | Cloud-optimized Dispatcher configuration: caching and security. Immutable files validated by the Dispatcher SDK. |
| `ui.apps` | FileVault content package. Application code: components, templates, client libraries, content structure. HTL is the scripting engine. |
| `ui.apps.structure` | FileVault content package. Empty module that defines the structure of the repository content. |
| `ui.config` | FileVault content package. OSGi configurations. |
| `ui.content` | FileVault content package. Mutable initial content, templates, sample assets. |
| `ui.content.sample` | FileVault content package. Sample content; not deployed to production. |
| `it.tests` | Integration tests. AEM Testing clients. Run by Cloud Manager during *Custom Functional Testing*. |
| `ui.tests` | UI tests. Cypress. Run by Cloud Manager during *Custom UI Testing*. |
| `all` | FileVault content package. Aggregates other FileVault packages for deployment. |

## Frontend module variants

| Variant | Module | Description |
|---|---|---|
| **General (Webpack)** | `ui.frontend` | Webpack build, TypeScript / JavaScript / Sass / SCSS. Output copied to `ui.apps` as client libraries. |
| **React SPA** | `ui.frontend` | React via Create React App. `@adobe/aem-react-editable-components`. `npm start` proxies to AEM (port 3000). |
| **Angular SPA** | `ui.frontend` | Angular via Angular CLI. `@adobe/aem-angular-editable-components`. `npm start` proxies to AEM (port 4200). |
| **Decoupled** | `ui.frontend` | Headless. Consumes AEM via JSON Model APIs. Deployed via the AEM Frontend Pipeline; no client libraries produced. |

## Add-on detection

| Signal | Add-on |
|---|---|
| `pom.xml` depends on `cif-connector` or `aem-core-cif-components` | **CIF (Commerce)** |
| `ui.frontend/package.json` contains `react` or `@adobe/aem-react-editable-components` | **React SPA** |
| `ui.frontend/package.json` contains `@angular/core` or `@adobe/aem-angular-editable-components` | **Angular SPA** |
| `ui.frontend` has no `clientlib.config.js` and `pom.xml` references `frontend-maven-plugin` with no clientlib output | **Decoupled frontend** |
| `pom.xml` depends on `aem-forms-*` or `forms.core` | **AEM Forms** |
| Module `ui.frontend.react.forms.af` exists | **Headless Forms** |
| `pom.xml` uses `precompiled-scripts-provider` | **Precompiled Scripts** |

If none of these are detected, treat as **General Webpack** frontend.

## Add-on per-module notes

| Add-on | Effect on per-module AGENTS.md |
|---|---|
| CIF | Append to `core/AGENTS.md` "Common entry points": commerce-specific models / servlets. |
| AEM Forms | Note in `ui.apps/AGENTS.md`: Forms Core Components OOTB. |
| Headless Forms | If `ui.frontend.react.forms.af` exists, write its per-module file too. |
| Precompiled Scripts | Note in `ui.apps/AGENTS.md`: HTL is precompiled. |

## Cloud Service documentation links (per-module hints)

Per-module `AGENTS.md` files include up to 3 Cloud Service documentation
links per module, selected from:

- Core Concepts, AEM Project Structure, AEM Development Guidelines
- Sling Adapters, Sling Resource Merger, HTL Getting Started
- Templates, Components Reference, Core Components Introduction
- Best Practices for Sling Service User Mapping
- Client-Side Libraries, Universal Editor, Content Fragments, Experience Fragments
- Deprecated and Removed Features

Never embed AEM 6.5 documentation URLs.
