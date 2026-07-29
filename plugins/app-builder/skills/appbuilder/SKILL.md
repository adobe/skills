---
name: appbuilder
description: >-
  Single entry point for all Adobe App Builder skills. Covers project initialization, Runtime action
  scaffolding, React Spectrum UI development, Jest unit testing, Playwright E2E testing, and CI/CD
  pipeline setup for App Builder projects. Use this skill for any App Builder task — it routes to
  the right specialist skill based on your intent.
license: Apache-2.0
compatibility: Requires aio CLI (Adobe I/O CLI), Node.js 18+
metadata:
  version: "1.0"
---

# Adobe App Builder

Route user requests to the appropriate specialist skill based on intent.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Create a new App Builder project, scaffold from a template, set up Developer Console project/workspace, `aio app init`, bootstrap APIs | Project Init | [../appbuilder-project-init/SKILL.md](../appbuilder-project-init/SKILL.md) |
| Add, implement, deploy, or debug Adobe Runtime actions; action manifest, SDK usage, webhooks, scheduled actions | Action Scaffolder | [../appbuilder-action-scaffolder/SKILL.md](../appbuilder-action-scaffolder/SKILL.md) |
| Build React Spectrum UI components for ExC Shell SPAs or AEM UI Extensions; `@adobe/exc-app`, `@adobe/uix-guest`, pages, forms, dialogs | UI Scaffolder | [../appbuilder-ui-scaffolder/SKILL.md](../appbuilder-ui-scaffolder/SKILL.md) |
| Write or run Jest unit tests, integration tests, or contract tests for actions and React components; mock Adobe SDKs | Testing | [../appbuilder-testing/SKILL.md](../appbuilder-testing/SKILL.md) |
| Write Playwright browser E2E tests for ExC Shell SPAs or AEM extension UIs; headless browser testing in CI | E2E Testing | [../appbuilder-e2e-testing/SKILL.md](../appbuilder-e2e-testing/SKILL.md) |
| Set up GitHub Actions, Azure DevOps, or GitLab CI pipelines; automate `aio app deploy`; multi-workspace promotion | CI/CD Pipeline | [../appbuilder-cicd-pipeline/SKILL.md](../appbuilder-cicd-pipeline/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow and guidance defined in that skill.
4. For multi-step tasks (e.g., init a project then add actions then write tests), chain skills in order: **Project Init → Action Scaffolder or UI Scaffolder → Testing → CI/CD Pipeline**.

## Skill Overview

### Project Init

End-to-end App Builder project creation without Developer Console UI clicks:
- **Developer Console bootstrap**: create project, workspace, subscribe APIs via `aio console …`
- **Template selection**: ExcShell SPA, headless/bare, AEM extension, API Mesh, Asset Compute worker, MCP server
- **Non-interactive `aio app init`**: wires local project to Console workspace automatically
- **Post-init guidance**: run, deploy, and debug common init failures

**When to use:** Starting a brand-new App Builder project or debugging `aio app init` failures.

### Action Scaffolder

Full lifecycle for Adobe Runtime actions:
- **Scaffold**: consistent directory layout at `src/<ext>/actions/<name>/index.js`
- **Implement**: params, response format, web/raw actions, IMS auth, SDK integrations (State, Files, Events)
- **Deploy**: `aio app deploy`, manifest configuration, `ext.config.yaml` wiring
- **Debug**: action logs, invocation errors, timeout and cold-start issues
- **Patterns**: webhook receivers, custom event providers, journaling consumers, Asset Compute workers, MCP server actions

**When to use:** Adding or debugging Runtime actions in an existing App Builder project.

### UI Scaffolder

React Spectrum UI components for Adobe Experience Cloud surfaces:
- **ExC Shell SPAs**: pages, forms, data tables, dialogs, navigation using `@adobe/react-spectrum`
- **Shell integration**: `runtime.done()`, IMS token passthrough, shell theming via `@adobe/exc-app`
- **AEM UI Extensions**: Content Fragment Console, CF Editor, Universal Editor, Assets View via `@adobe/uix-guest`
- **Extension points**: menus, action bars, panels, badges, badges, and rail items

**When to use:** Building or extending the web UI of an App Builder application.

### Testing

Jest-based unit and integration tests:
- **Unit tests**: scaffold Jest tests for Runtime actions and React components
- **Integration tests**: test against deployed actions in Stage workspace
- **Contract tests**: validate Adobe API interactions with mock clients
- **Mocks**: `@adobe/aio-lib-state`, `@adobe/aio-lib-files`, Events SDK, ExC Shell context, UIX Guest SDK
- **React component tests**: React Testing Library with Provider wrappers

**When to use:** Writing or running tests for actions or UI components before deploying or setting up CI.

### E2E Testing

Playwright browser E2E tests for browser-level validation:
- **ExC Shell SPAs**: full in-shell navigation, form submission, and data flow tests
- **AEM extension UIs**: test extension panels and dialogs in the host AEM UI
- **CI integration**: headless Playwright runs in GitHub Actions or other CI systems

**When to use:** Validating the full application flow in a real browser after unit tests pass. For Jest unit tests use **Testing** instead.

### CI/CD Pipeline

Automated build and deployment pipelines:
- **GitHub Actions**: `adobe/aio-cli-setup-action@3` + `adobe/aio-apps-action@3.3.0` workflows
- **Azure DevOps** and **GitLab CI**: equivalent pipeline patterns
- **Secrets injection**: OAuth S2S credentials, IMS org/client IDs
- **Multi-workspace promotion**: Stage → Production deploy gating with manifest validation

**When to use:** Automating `aio app deploy` on push/PR or setting up a multi-environment release process.

## Common Workflows

### New Project (Actions + UI)
1. **Project Init** → bootstrap Console, `aio app init` with ExcShell template
2. **Action Scaffolder** → add and implement Runtime actions
3. **UI Scaffolder** → build React Spectrum pages and dialogs
4. **Testing** → scaffold Jest tests for actions and components
5. **CI/CD Pipeline** → automate deploy on merge

### Add Actions to Existing Project
1. **Action Scaffolder** → implement, configure manifest, deploy, debug
2. **Testing** → add/update unit and integration tests
3. **CI/CD Pipeline** → update pipeline if needed

### Browser E2E Validation
1. **UI Scaffolder** or **Testing** (ensure unit tests pass first)
2. **E2E Testing** → generate Playwright tests for SPA or AEM extension
3. **CI/CD Pipeline** → add E2E step to pipeline

## Official Documentation

- [App Builder Documentation](https://developer.adobe.com/app-builder/docs/overview/)
- [Adobe I/O CLI (`aio`)](https://github.com/adobe/aio-cli)
- [Runtime Actions](https://developer.adobe.com/runtime/docs/)
- [React Spectrum](https://react-spectrum.adobe.com/)
- [AEM UI Extensibility](https://developer.adobe.com/uix/docs/)
