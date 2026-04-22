# appbuilder-project-init

## Overview

This skill initializes new Adobe App Builder projects end-to-end without the interactive `aio app init` wizard **and** without ever opening the Developer Console UI. It can:

- Walk the agent through standing up a Developer Console project, workspace, and API subscriptions non-interactively, by calling `aio console …` directly (no wrapper script needed — those commands are non-interactive in current `@adobe/aio-cli` releases).
- Map user intent to the correct App Builder template and run non-interactive `aio app init`, optionally wired to a specific Console org/project via the un-hidden `--org` / `--project` flags.
- Add actions or web assets to an existing project.

Use it when the user wants to create a new App Builder app, scaffold a project, set up an Experience Cloud extension, bootstrap a Developer Console project/workspace, add APIs to a workspace, or anything related to `aio app init` / `aio console project|workspace|api`.

## Structure

```
appbuilder-project-init/
├── SKILL.md                ← Agent entry point (frontmatter + workflow)
├── README.md               ← This file
├── scripts/
│   └── init.sh             ← Bash wrapper around `aio app init|init-bare|add-action|add-web-assets` (JSON output)
├── references/
│   ├── bootstrap.md        ← Agentic Console bootstrap playbook (project / workspace / APIs)
│   ├── templates.md        ← Template catalog with intent mapping and post-init guidance
│   └── debugging.md        ← Troubleshooting (init failures, bootstrap failures, login issues)
└── evals/
    └── evals.json          ← Evaluation test cases for grading agent output
```

The script intentionally only wraps the `aio app *` commands — those need a non-trivial flag set (`-y --no-login --no-install`) plus mkdir/cwd glue. The `aio console …` bootstrap commands are already non-interactive, so the agent calls them directly per [`references/bootstrap.md`](references/bootstrap.md). That keeps idempotency and per-step error handling (e.g. "already exists", "needs a product profile") in the skill where the agent can branch, instead of buried inside bash.

## Prerequisites

1. **Adobe I/O CLI (latest bundle)** — `npm install -g @adobe/aio-cli`, then `aio --version`. Always install / refresh the bundle rather than chasing individual plugin versions; the latest bundle is what makes the non-interactive `aio console …` and `aio app init --org/--project/--template-options/--no-config-validation` commands available.
2. **Node.js 18+** — required by the aio CLI and App Builder SDKs. Node 24 is supported on Stage runtimes.
3. **Bash shell** — `scripts/init.sh` requires bash.
4. **Authenticated session** — `aio auth login` must have been completed. For Docker / CI scenarios, set `AIO_IMS_LOCAL_LOGIN_PORT` and forward that port into the container.
5. **IMS org selected** — `aio console org select <orgId>`, or pass `--orgId` to every bootstrap command. The Console project / workspace / API subscriptions can all be created from this skill, so they no longer have to exist beforehand.

## Usage

### Bootstrap a Developer Console project + workspace + APIs

Bootstrap is done by calling `aio console …` directly — see [references/bootstrap.md](references/bootstrap.md) for the full playbook (preflight, decision rule, raw commands, recovery from per-step failures). The short version:

```bash
aio console project create -n my-project --json
aio console workspace create --projectName my-project --name Stage --json
aio console api list --json   # discover service codes (and which need a product profile)
aio console workspace api add \
  --projectName my-project --workspaceName Stage \
  --service-code AdobeIOManagementAPISDK \
  --json
# For a profile-bound service, add: --license-config "AdobeAnalyticsSDK=AnalyticsProductionProfile"
```

### Initialize the local app with a template

```bash
skills/appbuilder-project-init/scripts/init.sh init "@adobe/generator-app-excshell" ./my-project
```

To wire init directly to a Console org/project (so `aio app deploy` lands in the right namespace without a follow-up `aio app use`):

```bash
skills/appbuilder-project-init/scripts/init.sh init \
  "@adobe/generator-app-excshell" ./my-project \
  --org <orgId> --project my-project
```

`--template-options` (base64-encoded JSON) and `--no-config-validation` are also passed through to `aio app init`. If any of these flags is rejected as unknown, refresh the CLI bundle (`npm install -g @adobe/aio-cli`) and retry.

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

All `init.sh` commands output a single JSON line with `success`, `path`, and `output` (or `error`) fields. Always check `success` before proceeding.

### After bootstrap, wire the app to the new workspace

If you didn't pass `--org` / `--project` to `init`, point the local app at the bootstrapped workspace before deploying:

```bash
cd ./my-project
aio app use --no-input   # adopts the currently selected console workspace, no prompts
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
| `aio: command not found` | Install Adobe I/O CLI (`npm install -g @adobe/aio-cli`) and run `aio auth login` before retrying |
| `aio console …` or `aio app init` rejects a documented flag / subcommand | CLI bundle is stale — `npm install -g @adobe/aio-cli` and retry. Don't chase individual plugin versions. |
| `aio console project create` fails with "already exists" | Read `aio console project list --json`, reuse the existing project, and continue from `workspace create` |
| `aio console workspace api add` fails with "product profile required" | Re-run with `--license-config CODE=PROFILE`. Use `aio console api list --json` to see which services need profiles. |
| `aio app *` fails on schema validation right after init | Manifest is mid-edit; pass `--no-config-validation` for that one command, then re-validate once the manifest is whole. |
| `aio app init` template listing hangs behind a corporate proxy | `npm install -g @adobe/aio-cli` to pick up the proxy fix, confirm `HTTPS_PROXY` is exported in the same shell |
| `aio login` from inside Docker can't complete the browser callback | Set `AIO_IMS_LOCAL_LOGIN_PORT` and forward that port into the container |
| `npm install` fails after init | Check Node.js/npm version compatibility, rerun `npm install` from project root |
| Ambiguous template choice | Ask one clarifying question (UI vs headless, extension point, target product). Default to `@adobe/generator-app-excshell` if unclear |
| Project directory already exists | Do not overwrite silently — ask whether to use a different directory or clear the existing one |
| API Mesh mesh.json missing | Copy from `node_modules/@adobe/generator-app-api-mesh/templates/mesh.json` to project root |
| Bare project has unexpected scaffolded files | Remove any auto-generated `actions/`, `src/`, or `web-src/` directories |

## Skill Chaining

After initialization, hand off to `appbuilder-action-scaffolder` for action implementation, manifest wiring, and deployment workflows.