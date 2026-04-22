# Agentic Developer Console Bootstrap

Stand up the Adobe Developer Console "shell" (project + workspace + API subscriptions) for an App Builder app **without ever opening the Developer Console UI** and without any interactive `aio` prompts. This is the prerequisite state that `aio app init`, `aio app use`, and `aio app deploy` all assume.

## Why this exists

Before `@adobe/aio-cli-plugin-console@5.2.0`, `aio console project create` and `aio console workspace create` only existed as interactive wizards. Agents could not script them — they would block waiting for arrow-key input on a TTY that does not exist in agentic environments.

Two recent releases close that gap:

| Plugin version | Released | What it unlocks |
| --- | --- | --- |
| `@adobe/aio-cli-plugin-console@5.2.0` | 2026-04-01 | `aio console project create -n <name>` and `aio console workspace create --projectName <name> --name <name>` accept all inputs as flags — no prompts. |
| `@adobe/aio-cli-plugin-console@5.3.0` | 2026-04-20 | `aio console api list`, `aio console workspace api list`, and `aio console workspace api add --service-code <codes> [--license-config CODE=PROFILE]` round out the bootstrap: discover APIs, see what is subscribed, and subscribe new ones (including services that require a product profile) — all from the CLI. |

Together they remove every blocking "open the Developer Console UI and click" step from the agentic App Builder setup path.

`scripts/init.sh` wraps these commands with JSON output, sane defaults, and a single chained `bootstrap` subcommand.

## Prerequisites

1. `aio --version` returns a version (Adobe I/O CLI installed).
2. `aio plugins --core` shows `@adobe/aio-cli-plugin-console` at **5.3.0 or later**. If not, `npm install -g @adobe/aio-cli`.
3. The user is logged in: `aio auth login` has been completed in the current session.
4. An IMS org is selected (`aio console org select <orgId>`) **or** every bootstrap call passes `--orgId`.

`scripts/init.sh` re-validates prereqs 1 and 2 on every Console bootstrap subcommand and emits a JSON `error` (exit code 2) if either is missing — no silent hangs.

## One-shot bootstrap

The recommended entry point chains project, workspace, and API subscription so the agent only has to make a single tool call:

```bash
skills/appbuilder-project-init/scripts/init.sh bootstrap "my-project" \
  --workspace Stage \
  --orgId <orgId> \
  --api AdobeIOManagementAPISDK \
  --api AdobeAnalyticsSDK=AnalyticsProductionProfile
```

Behaviour:

1. `aio console project create -n my-project --json` (with `-o <orgId>` if provided).
2. `aio console workspace create --projectName my-project --name Stage --json`.
3. For each `--api CODE` flag, `aio console workspace api add --projectName my-project --workspaceName Stage --service-code CODE --json`. If the flag is `--api CODE=PROFILE`, an additional `--license-config CODE=PROFILE` flag is passed for services that require a product profile.

The script emits one JSON object on stdout summarising the run:

```json
{
  "success": true,
  "projectName": "my-project",
  "workspaceName": "Stage",
  "subscribedApis": "AdobeIOManagementAPISDK,AdobeAnalyticsSDK",
  "project_raw": { /* aio console project create --json output */ },
  "workspace_raw": { /* aio console workspace create --json output */ }
}
```

If any step fails, the chain short-circuits and the JSON includes a `step` field — `project-create`, `workspace-create`, or `workspace-api-add` — so the agent knows where to resume after fixing the issue.

### Defaults and overrides

| Flag | Default | Notes |
| --- | --- | --- |
| `--workspace` | `Stage` | First non-Production workspace name by convention. Override for `Dev`, `QA`, etc. Use a real, descriptive name in long-lived shared projects. |
| `--orgId` | currently selected org | Recommended to pass explicitly in CI or whenever the agent is not certain which org is selected. |
| `--api` | none | Repeatable. Can be `CODE` or `CODE=PROFILE[,PROFILE...]`. |

## Step-by-step alternative

When the user wants finer control — or only part of the chain needs to run — call the underlying subcommands directly. Each emits the same JSON contract.

### Discover available APIs

```bash
skills/appbuilder-project-init/scripts/init.sh api-list --orgId <orgId>
```

Returns the org's available services with a flag indicating whether each one requires a product profile. Use the `code` field for subsequent `--api` / `--service-code` flags.

### Create a project

```bash
skills/appbuilder-project-init/scripts/init.sh project-create "my-project" \
  --orgId <orgId> \
  --title "My Project" \
  --description "Bootstrapped by appbuilder-project-init"
```

`--title` and `--description` default to the project name when omitted (matching the upstream CLI behaviour).

### Create a workspace inside an existing project

```bash
skills/appbuilder-project-init/scripts/init.sh workspace-create "my-project" "Stage" \
  --orgId <orgId> \
  --title "Stage workspace"
```

### Inspect what an existing workspace subscribes to

```bash
skills/appbuilder-project-init/scripts/init.sh workspace-api-list "my-project" "Stage" \
  --orgId <orgId>
```

Use this before `workspace-api-add` to avoid re-subscribing services that are already attached.

### Subscribe a workspace to one or more APIs

```bash
# Free-tier services (no product profile required)
skills/appbuilder-project-init/scripts/init.sh workspace-api-add \
  "my-project" "Stage" "AdobeIOManagementAPISDK,FilesSDK" \
  --orgId <orgId>

# Service that requires a product profile
skills/appbuilder-project-init/scripts/init.sh workspace-api-add \
  "my-project" "Stage" "AdobeAnalyticsSDK" \
  --orgId <orgId> \
  --license-config "AdobeAnalyticsSDK=AnalyticsProductionProfile"
```

`--license-config` is repeatable when subscribing multiple profile-bound services in one call.

## Wiring the local app to the bootstrapped workspace

Bootstrap leaves the freshly created project + workspace selected as the active console context. After `aio app init`, point the local app at it:

```bash
cd ./my-project
aio app use --no-input
```

`aio app use --no-input` adopts the currently selected console workspace without prompting, so it composes cleanly with bootstrap. Then `aio app deploy` will publish to the namespace owned by that workspace.

## Idempotency

The console plugin's `project create` / `workspace create` / `workspace api add` commands are **not** idempotent — they will fail if the resource already exists. Two safe patterns:

1. **Pre-flight check.** Use `aio console project list --json` and the `workspace-api-list` subcommand to confirm what already exists, and only call create/add for the missing pieces.
2. **Tolerate the failure.** Inspect the JSON `output` field on a failed step. A 409-style "already exists" message is benign; surface it to the user, skip that step, and continue.

The chained `bootstrap` command does not retry or skip — it fails fast on the first error so the agent can decide how to recover. Re-running `bootstrap` against an existing project will surface the `project-create` failure on the first step.

## Recommended flow inside the skill

```text
1. Confirm Console state with the user (or `aio console project list --json`).
2. If a project + workspace + the right APIs already exist:
     → skip to `init` / `init-bare`.
3. Otherwise:
     → run `bootstrap` (or the individual subcommands) to create what is missing.
     → run `init` / `init-bare` for the local app scaffold.
     → `cd <project> && aio app use --no-input` to wire the app to the workspace.
4. Continue to post-init customization and validation per `SKILL.md`.
```

## Common bootstrap errors

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `"error": "@adobe/aio-cli-plugin-console <ver> is too old..."` | Plugin < 5.3.0 | `npm install -g @adobe/aio-cli` |
| `"error": "Unable to detect @adobe/aio-cli-plugin-console version"` | `aio plugins --core` did not include the console plugin (very old CLI install or partial install) | Reinstall the CLI: `npm install -g @adobe/aio-cli` |
| `"step": "project-create"` with `"already exists"` in output | Project name collides with an existing project in the org | Pick a different name, or skip create and continue with `workspace-create` |
| `"step": "workspace-api-add"` with `product profile required` in output | Service code needs a product profile | Re-issue with `--api CODE=PROFILE` (bootstrap) or `--license-config CODE=PROFILE` (workspace-api-add). Use `api-list` to confirm which services require profiles. |
| Bootstrap succeeds but `aio app deploy` deploys to the wrong namespace | Local `.aio` not pointing at the new workspace | Run `aio app use --no-input` from the project root. |

For broader debugging (Node version, npm install, login failures), see [debugging.md](debugging.md).
