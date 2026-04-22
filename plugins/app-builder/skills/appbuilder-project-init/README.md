# appbuilder-project-init

## Overview

This skill initializes new Adobe App Builder projects end-to-end without the interactive `aio app init` wizard **and** without ever opening the Developer Console UI. It can:

- Create a Developer Console project, workspace, and API subscriptions non-interactively (via `aio-cli-plugin-console` 5.2.0/5.3.0).
- Map user intent to the correct App Builder template and run non-interactive `aio app init`.
- Add actions or web assets to an existing project.

Use it when the user wants to create a new App Builder app, scaffold a project, set up an Experience Cloud extension, bootstrap a Developer Console project/workspace, add APIs to a workspace, or anything related to `aio app init` / `aio console project|workspace|api`.

## Structure

```
appbuilder-project-init/
├── SKILL.md                ← Agent entry point (frontmatter + workflow)
├── README.md               ← This file
├── scripts/
│   └── init.sh             ← Bash wrapper around `aio app *` and `aio console *` (JSON output)
├── references/
│   ├── bootstrap.md        ← Agentic Console bootstrap playbook (project / workspace / APIs)
│   ├── templates.md        ← Template catalog with intent mapping and post-init guidance
│   └── debugging.md        ← Troubleshooting (init failures, bootstrap failures, login issues)
└── evals/
    └── evals.json          ← Evaluation test cases for grading agent output
```

## Prerequisites

1. **Adobe I/O CLI** — `aio --version` must return a version.
2. `@adobe/aio-cli-plugin-console` **>= 5.3.0** — required for non-interactive `project create`, `workspace create`, `api list`, and `workspace api add/list`. Verify with `aio plugins --core | grep aio-cli-plugin-console`. Reinstall with `npm install -g @adobe/aio-cli` if older.
3. **Node.js 18+** — required by the aio CLI and App Builder SDKs.
4. **Bash shell** — `scripts/init.sh` requires bash.
5. **Authenticated session** — `aio auth login` must have been completed.
6. **IMS org selected** — `aio console org select <orgId>`, or pass `--orgId` to every bootstrap call. The Console project / workspace / API subscriptions can all be created from this skill, so they no longer have to exist beforehand.

## Configuration

No additional configuration is needed beyond the prerequisites. The skill uses `scripts/init.sh` which wraps:

- `aio app init` with non-interactive flags (`-y --no-login --no-install`).
- `aio console project|workspace|api` with `--json` and explicit positional/flag inputs (no TTY prompts).

## Usage

### Bootstrap a Developer Console project + workspace + APIs (one shot)

```bash
skills/appbuilder-project-init/scripts/init.sh bootstrap "my-project" \
  --workspace Stage \
  --api AdobeIOManagementAPISDK \
  --api AdobeAnalyticsSDK=AnalyticsProductionProfile
```

See [references/bootstrap.md](references/bootstrap.md) for the full playbook (defaults, idempotency, recovery).

### Discover available API service codes

```bash
skills/appbuilder-project-init/scripts/init.sh api-list
```

### Step-by-step bootstrap

```bash
skills/appbuilder-project-init/scripts/init.sh project-create "my-project"
skills/appbuilder-project-init/scripts/init.sh workspace-create "my-project" "Stage"
skills/appbuilder-project-init/scripts/init.sh workspace-api-list "my-project" "Stage"
skills/appbuilder-project-init/scripts/init.sh workspace-api-add "my-project" "Stage" "AdobeIOManagementAPISDK"
```

### Initialize the local app with a template

```bash
skills/appbuilder-project-init/scripts/init.sh init "@adobe/generator-app-excshell" ./my-project
```

### Initialize a bare project

```bash
skills/appbuilder-project-init/scripts/init.sh init-bare ./my-project
```

### Add an action to an existing project

```bash
cd ./my-project
skills/appbuilder-project-init/scripts/init.sh add-action "my-action"
```

### Add web assets to an existing project

```bash
skills/appbuilder-project-init/scripts/init.sh add-web-assets
```

All commands output a single JSON line. Bootstrap subcommands include a `data` field carrying the raw `aio … --json` payload (for IDs and metadata). App-scaffolding commands include `success`, `path`, and `output` fields. Always check `success` before proceeding.

### After bootstrap, wire the app to the new workspace

```bash
cd ./my-project
aio app use --no-input   # adopts the workspace selected by `bootstrap`
```

Then `aio app deploy` will publish to the namespace owned by that workspace.

### Available templates

| User intent | Template |
| --- | --- |
| SPA with actions + React UI | @adobe/generator-app-excshell |
| AEM Content Fragment Console extension | @adobe/aem-cf-admin-ui-ext-tpl |
| AEM React SPA (WKND) | @adobe/generator-app-aem-react |
| API Mesh / GraphQL gateway | @adobe/generator-app-api-mesh |
| Asset Compute custom worker | @adobe/generator-app-asset-compute |
| MCP server on Runtime | @adobe/generator-app-remote-mcp-server-generic |
| Blank / from scratch | init-bare |

See `references/templates.md` for detailed per-template post-init guidance.

### After initialization

1. Run `npm install` in the project directory (init uses `--no-install`)
2. Validate the manifest structure — no root-level `runtimeManifest` in `app.config.yaml`
3. Optionally build, test, and deploy: `aio app build`, `aio app test`, `aio app deploy`

## Troubleshooting

| Problem | Fix |
| --- | --- |
| aio: command not found | Install Adobe I/O CLI and run `aio auth login` before retrying |
| `aio-cli-plugin-console` too old for bootstrap | `npm install -g @adobe/aio-cli` to pull in plugin >= 5.3.0 |
| Bootstrap step `project-create` fails with "already exists" | Pick a different project name, or skip create and run `workspace-create` against the existing project |
| Bootstrap step `workspace-api-add` fails with "product profile required" | Re-run with `--api CODE=PROFILE` (bootstrap) or `--license-config CODE=PROFILE` (workspace-api-add). Use `api-list` to see which services need profiles. |
| npm install fails after init | Check Node.js/npm version compatibility, rerun `npm install` from project root |
| Ambiguous template choice | Ask one clarifying question (UI vs headless, extension point, target product). Default to `@adobe/generator-app-excshell` if unclear |
| Project directory already exists | Do not overwrite silently — ask whether to use a different directory or clear the existing one |
| API Mesh mesh.json missing | Copy from `node_modules/@adobe/generator-app-api-mesh/templates/mesh.json` to project root |
| Bare project has unexpected scaffolded files | Remove any auto-generated `actions/`, `src/`, or `web-src/` directories |

## Skill Chaining

After initialization, hand off to `appbuilder-action-scaffolder` for action implementation, manifest wiring, and deployment workflows.