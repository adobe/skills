---
name: appbuilder-project-init
description: Initialize a new Adobe App Builder project end-to-end without manual template selection. Maps user intent to the correct template, runs non-interactive initialization, and guides post-init customization. Use this skill whenever the user mentions creating an App Builder app, scaffolding a project, initializing with aio, setting up an Experience Cloud extension, adding actions or web assets to an existing project, or anything related to 'aio app init', even if they don't explicitly say 'App Builder'. Also use when users mention SPA templates, AEM extensions, API Mesh setup, Asset Compute workers, or MCP server projects. Also handles debugging and troubleshooting init failures — use when users report template not found errors, aio app init hanging or timing out, Node version mismatches, npm install failures after init, build errors right after project setup, wrong directory structure from extension templates, aio login or token issues, or aio app run showing nothing.
metadata:
  category: project-initialization
license: Apache-2.0
compatibility: Requires aio CLI (Adobe I/O CLI), Node.js 18+, and bash shell
allowed-tools: Bash(aio:*) Bash(npm:*) Bash(node:*) Read Write
---
# App Builder Project Initialization

Maps user intent to the right Adobe App Builder template and runs non-interactive `aio app init`. Default: `@adobe/generator-app-excshell` (SPA + actions). For headless/bare projects, use `init-bare`.

## Fast Path (for clear requests)

When the user's intent maps unambiguously to a single template — for example, they name a template directly or describe an app that clearly matches exactly one entry below — skip straight to **Initialize via Script** below. Use the matched template and any project name the user provided (or a sensible default).

Examples of fast-path triggers:

- "Create an App Builder app using `@adobe/generator-app-excshell`" → use that template, run init
- "Set up an Asset Compute worker" → maps unambiguously to `@adobe/generator-app-asset-compute`, run init
- "Create a new App Builder app" (no specifics) → defaults to `@adobe/generator-app-excshell`, run init
- "Initialize a bare project" → use `init-bare`, run init

If there is any ambiguity — multiple templates could fit, or the user's constraints are unclear — use the full template decision table and workflow below.

## Template Decision Table

Pick the template that matches the user's intent. When unclear, default to `@adobe/generator-app-excshell`.

| User wants | Template |
| --- | --- |
| SPA with actions + React UI | @adobe/generator-app-excshell |
| AEM Content Fragment Console extension | @adobe/aem-cf-admin-ui-ext-tpl |
| AEM React SPA (WKND-based) | @adobe/generator-app-aem-react |
| Adobe API Mesh (GraphQL) | @adobe/generator-app-api-mesh |
| Asset Compute custom worker | @adobe/generator-app-asset-compute |
| Remote server on App Builder | @adobe/generator-app-remote-mcp-server-generic |
| Bare / from-scratch project (no pre-scaffolded actions or UI) | init.sh init-bare |

For a headless/backend-only request, prefer `init-bare` when possible. If the user still needs a template that generates UI files, plan a post-init cleanup so the final project has no `web-src` frontend directory or web manifest wiring.

## Initialize via Script

All commands go through a single script: `scripts/init.sh`

> **Note:** The path to this skill's scripts may be `skills/`, `.augment/skills/`, or `.github/skills/` depending on your platform and repository layout. Adjust the prefix in the commands below accordingly.

**With a template:**

```bash
skills/appbuilder-project-init/scripts/init.sh init "@adobe/generator-app-excshell" ./my-project
```

**Bare project (no template):**

```bash
skills/appbuilder-project-init/scripts/init.sh init-bare ./my-project
```

Use `init-bare` only when the user explicitly wants to configure everything from scratch. In that case, "bare" means the generated project should stay minimal:

- `app.config.yaml` exists with an empty or minimal `application.runtimeManifest`
- `package.json` exists with only the basic project dependencies
- No pre-scaffolded `src/`, `web-src/`, or `actions/` directories

Why this matters: if the user asked for a bare project, pre-generated actions or web assets contradict that intent and remove the clean starting point they requested.

The script outputs JSON with `success`, `path`, and `output` fields. Check `success` before proceeding.

## Full Workflow (for ambiguous or complex requests)

### Step 1 — Gather intent

Ask the user (or infer from conversation context):

| Question | Examples |
| --- | --- |
| What type of app? | SPA shell, headless API, AEM extension, Asset Compute worker, API Mesh, remote server |
| Needs a UI? | Yes (React Spectrum in ExC Shell), No (actions only) |
| Extension point? | dx/excshell/1, aem/cf-console-admin/1, dx/asset-compute/worker/1, or N/A |
| Additional actions? | Names and purposes of custom actions beyond the default |

If the user simply says "create an App Builder app" with no specifics, default to `@adobe/generator-app-excshell`.

### Step 2 — Select template

Consult the Template Decision Table above and [references/templates.md](references/templates.md) to map the user's intent to a template.

### Step 3 — Initialize, customize, validate

Follow the **Initialize via Script**, **Post-init customization**, and **Validate** sections below.

## Post-init Customization

Consult [references/templates.md](references/templates.md) for template-specific post-init guidance. Common tasks:

1. **Install dependencies** — Run `npm install` in the project directory. The init script uses `--no-install` to keep initialization fast, but dependencies are required before building or testing.
2. **For API Mesh projects, verify **`mesh.json`** is at the project root** — After `aio app init` with `@adobe/generator-app-api-mesh`, confirm `./mesh.json` exists before treating the scaffold as ready. If the file only exists at `node_modules/@adobe/generator-app-api-mesh/templates/mesh.json`, copy it into place with `cp node_modules/@adobe/generator-app-api-mesh/templates/mesh.json ./mesh.json`. The file under `node_modules/` is the generator's template source, not the project's active API Mesh configuration. Then customize the root `mesh.json` with the user's real source handlers; for multi-backend scenarios, configure at least two handlers.
3. **Clean up bare-project scaffolding if needed** — After `init-bare`, inspect the generated project. If the initializer created `actions/`, `src/`, or `web-src/`, remove those directories before continuing. A bare project should not keep auto-generated action code or web assets.
4. **Headless cleanup after template init** — If the user wants a headless project with **no frontend**, delete any generated UI directory after `aio app init`: `rm -rf web-src/` or the template-specific path such as `rm -rf src/<extension>/web-src/`. Then remove matching `web-src` config from `app.config.yaml` or `ext.config.yaml` if present, especially `web: web-src` and `operations.view` / `impl: index.html` entries. This avoids unnecessary frontend build artifacts and stale manifest wiring in a backend-only project.
5. **Add actions** — If the user later wants custom actions, run `cd ./my-project && skills/appbuilder-project-init/scripts/init.sh add-action "my-action"`.
6. **Add web assets** — Only if the user later decides the bare project needs a UI, run `skills/appbuilder-project-init/scripts/init.sh add-web-assets`.
7. **Edit ext.config.yaml directly** — Customize action definitions:

- Set `runtime: nodejs:22` (latest supported)
- Add `inputs:` for environment variables the action needs
- Set `annotations.require-adobe-auth: true` if the action needs IMS tokens
- Set `web: 'yes'` or `web: 'raw'` depending on HTTP access needs

8. **Edit app.config.yaml** — For multi-extension projects, add `$include` entries.
9. **Apply action boilerplate** — Use the `appbuilder-action-scaffolder` skill's boilerplate pattern for production-ready action code with logging, input validation, and error handling.

## Validate

Verify the project structure by checking these items directly:

1. `app.config.yaml`** exists** and contains valid YAML
2. **All **`$include`** paths resolve** to real files
3. `ext.config.yaml` (if present) has `runtimeManifest.packages` with at least one action
4. **Action JS files exist** at all declared `function:` paths
5. `package.json`** exists** with `name`, `version`, and an Adobe SDK dependency (`@adobe/aio-sdk` or `@adobe/aio-lib-core-logging`)
6. **No root-level **`runtimeManifest` in `app.config.yaml` (see Manifest guardrail below)

Read the relevant files and verify each check. Fix any issues before proceeding.

## Build, Test, Deploy (optional)

If the user wants to go beyond scaffolding:

```bash
aio app build       # Build
aio app test        # Run tests
aio app deploy      # Deploy to Adobe I/O Runtime
aio app dev         # Run locally for development (use `aio app run` instead if actions use State SDK, Files SDK, or sequences)
```

## Manifest guardrail

**Extension projects:** Actions are defined under `runtimeManifest` in `ext.config.yaml`, referenced via `$include` from `app.config.yaml`.

**Standalone apps:** Actions go under `application.runtimeManifest` in `app.config.yaml`.

Do not place a root-level `runtimeManifest` directly in `app.config.yaml`: the CLI ignores those actions, so they will not deploy. If you see this shape, move it under `application.runtimeManifest` or into `ext.config.yaml`.

## Troubleshooting & Edge Cases

- `aio`** CLI not installed:** If `aio --version` returns `command not found` or fails, stop before initialization. Ask the user to install Adobe I/O CLI, complete `aio auth login`, and retry only after the CLI is available.
- `npm install`** fails after init:** The scaffold can still be created because init runs with `--no-install`, but builds/tests will fail until dependencies install cleanly. Capture the first package error, confirm the Node/npm version is compatible, rerun `npm install` from the project root, and only continue once it succeeds.
- **Template choice is ambiguous:** If the request could map to multiple templates, ask one clarifying question about UI vs headless, extension point, or target Adobe product. If the user has no preference, default to `@adobe/generator-app-excshell` and state that assumption explicitly.
- **Project directory already exists or is not empty:** Do not overwrite it silently. Ask whether to use a different directory, clear the existing folder, or initialize into a new path.

## Chaining with other skills

After initialization, hand off to:

- `appbuilder-action-scaffolder` — For scaffolding actions with playbook, checklist, boilerplate templates, and manifest validation
- `appbuilder-ui-scaffolder` — Build React Spectrum UI for ExC Shell SPAs and AEM extensions

## Pattern Quick-Reference

| Task | Reference | Script |
| --- | --- | --- |
| Debug project init issues | [references/debugging.md](references/debugging.md) | — |

## References

- [references/templates.md](references/templates.md) — Template catalog with intent mapping and per-template post-init guidance
- [references/debugging.md](references/debugging.md) — Troubleshooting guide for init failures, Node/npm issues, login problems, and first-run errors