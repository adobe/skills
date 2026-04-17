# appbuilder-project-init

## Overview

This skill initializes new Adobe App Builder projects end-to-end without the interactive `aio app init` wizard. It maps user intent to the correct template, runs non-interactive initialization, and guides post-init customization.

Use it when the user wants to create a new App Builder app, scaffold a project, set up an Experience Cloud extension, or anything related to `aio app init`.

## Structure

```
appbuilder-project-init/
├── SKILL.md              ← Agent entry point (frontmatter + workflow)
├── README.md             ← This file
├── scripts/
│   └── init.sh           ← Bash wrapper around aio app init (JSON output)
├── references/
│   └── templates.md      ← Template catalog with intent mapping and post-init guidance
└── evals/
    └── evals.json        ← 5 evaluation test cases for grading agent output
```

## Prerequisites

1. **Adobe I/O CLI** — `aio --version` must return a version
2. **Node.js 18+** — Required by aio CLI and App Builder SDKs
3. **Bash shell** — `scripts/init.sh` requires bash
4. **Authenticated session** — `aio auth login` must have been completed
5. **Adobe I/O project** — An org and project must already be selected

## Configuration

No additional configuration is needed beyond the prerequisites. The skill uses `scripts/init.sh` which wraps `aio app init` with non-interactive flags (`-y --no-login --no-install`).

## Usage

### Initialize with a template

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

All commands output JSON with `success`, `path`, and `output` fields. Check `success` before proceeding.

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
| aio: command not found | Install Adobe I/O CLI and run aio auth login before retrying |
| npm install fails after init | Check Node.js/npm version compatibility, rerun npm install from project root |
| Ambiguous template choice | Ask one clarifying question (UI vs headless, extension point, target product). Default to @adobe/generator-app-excshell if unclear |
| Project directory already exists | Do not overwrite silently — ask whether to use a different directory or clear the existing one |
| API Mesh mesh.json missing | Copy from node_modules/@adobe/generator-app-api-mesh/templates/mesh.json to project root |
| Bare project has unexpected scaffolded files | Remove any auto-generated actions/, src/, or web-src/ directories |

## Skill Chaining

After initialization, hand off to `appbuilder-action-scaffolder` for action implementation, manifest wiring, and deployment workflows.