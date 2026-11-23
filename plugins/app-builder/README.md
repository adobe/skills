# App Builder

Development, customization, testing, and deployment skills for Adobe App Builder projects.

```bash
/plugin install app-builder@adobe-skills
```

**Skill chaining:**

- **Actions path:** `appbuilder-project-init` → `appbuilder-action-scaffolder` → `appbuilder-testing` → `appbuilder-cicd-pipeline`
- **UI path:** `appbuilder-project-init` → `appbuilder-ui-scaffolder` → `appbuilder-testing` → `appbuilder-cicd-pipeline`
- **E2E path:** `appbuilder-ui-scaffolder` or `appbuilder-testing` → `appbuilder-e2e-testing` → `appbuilder-cicd-pipeline`

| Skill                            | Description                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `appbuilder-project-init`      | Initialize App Builder projects and choose the bootstrap path; also first-time machine/CLI setup (Node 20, aio install/login, stage vs prod) |
| `appbuilder-action-scaffolder` | Scaffold, implement, deploy, and debug Adobe Runtime actions                              |
| `appbuilder-ui-scaffolder`     | Generate React Spectrum UI components for ExC Shell SPAs and AEM UI Extensions            |
| `appbuilder-testing`           | Generate and run Jest unit, integration, and contract tests for actions and UI components |
| `appbuilder-e2e-testing`       | Playwright browser E2E tests for ExC Shell SPAs and AEM extensions                        |
| `appbuilder-cicd-pipeline`     | Set up CI/CD pipelines for GitHub Actions, Azure DevOps, and GitLab CI                    |

## Workfront UI Extensions

Skills for building customized **Workfront** UI applications on Adobe App Builder — a React/Spectrum SPA embedded through Workfront extension points, backed by Adobe I/O Runtime actions that call the Workfront / Planning / Adobe APIs. Shipped as part of the `app-builder` plugin: the umbrella skill `appbuilder-workfront` plus three sub-skills, each a folder of its own under `skills/`. Machine setup and `aio app init` live in `appbuilder-project-init`.

> **Usage guide:** [`USAGE.md`](USAGE.md) is the end-to-end walkthrough for driving these skills from an AI harness — set up the `aio` CLI → build a new project (or migrate existing code) → deploy → publish — with the start point, harness wiring, the questions the AI will ask, copy-paste prompts, and the gotchas to watch for.

**Journey:** `appbuilder-project-init` (set up + scaffold) → `workfront-ui-extension` + `workfront-actions` (build) → `workfront-local-testing` (test) → deploy & publish. Start at the **`appbuilder-workfront`** umbrella for the end-to-end map.

| Skill                     | Description                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `appbuilder-workfront`    | Umbrella / onboarding: the end-to-end roadmap and how the SPA, actions, and extension points fit; routes to the three sub-skills below |
| `workfront-ui-extension`  | Front-end SPA: extension points (Main Menu, per-object left panel, widgets), routing, shared context, `actionWebInvoke` |
| `workfront-actions`       | Runtime actions: `{data,error}` shape, IMS auth passthrough, inputs/config, CommonJS, and the Workfront Public API v21 (search/count, bulk PUT, custom `DE:` fields) |
| `workfront-local-testing` | Preview a local (`extensionOverride`) or deployed (Extension Manager BYO) build inside Workfront; fix common "not showing" issues |

## Cursor (preview)

This plugin has a Cursor manifest at `.cursor-plugin/plugin.json`, as the pilot for Cursor distribution. To install it locally from a checkout of this repository:

```bash
mkdir -p ~/.cursor/plugins/local/app-builder
cp -R plugins/app-builder/. ~/.cursor/plugins/local/app-builder/
# Then in Cursor: Cmd+Shift+P → Developer: Reload Window
```

Check **Cursor Settings → Plugins**: the plugin should be listed with the App Builder skills, including the `appbuilder-workfront` suite. The skills also show in **Settings → Rules** under "Agent Decides".

The folders under [`skills/`](skills/) are the complete list of skills.
