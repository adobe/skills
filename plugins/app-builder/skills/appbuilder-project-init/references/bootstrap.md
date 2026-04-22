# Agentic Developer Console Bootstrap

Stand up the Adobe Developer Console "shell" (project + workspace + API subscriptions) for an App Builder app **without ever opening the Developer Console UI** and without any interactive `aio` prompts. This is the prerequisite state that `aio app init`, `aio app use`, and `aio app deploy` all assume.

This playbook is intentionally a sequence of raw `aio` commands rather than a wrapper script. The recent `aio-cli-plugin-console` releases made every step non-interactive by design — wrapping them again would only hide that surface area and force "fail fast on the first error" semantics where step-by-step branching (idempotency, profile prompts, etc.) is what you actually want.

## Why this exists

Earlier `aio` CLI bundles only exposed `aio console project create` / `workspace create` / `workspace api add` as interactive wizards. Agents could not script them — they would block waiting for arrow-key input on a TTY that doesn't exist in agentic environments. Recent CLI releases made every one of those commands fully non-interactive (all inputs as flags), added API discovery (`aio console api list`), added `--license-config CODE=PROFILE` for services that require a product profile, and un-hid `--project` / `--org` / `--template-options` on `aio app init` so init can be wired directly to a Console project/org without a follow-up `aio app use`.

Concretely, the latest `@adobe/aio-cli` bundle is what makes the entire chain below scriptable. **Don't try to assert specific plugin version numbers** — just install the latest CLI and use the commands.

## Preflight

1. **Install / refresh the CLI** so all the bundled plugins are current:

   ```bash
   npm install -g @adobe/aio-cli
   aio --version
   ```

   That's the supported way to pick up the non-interactive Console + app init commands and any proxy / login fixes. If a specific subcommand below is still rejected after a clean reinstall, the install itself failed (PATH, permissions, registry mirror) — fix that rather than working around it.

2. `aio auth login` has been completed in the current session.
3. An IMS org is selected, **or** every command below passes `--orgId`:

   ```bash
   aio console org list --json   # find the orgId / orgCode you want
   aio console org select <orgId>
   ```

4. (Optional, for Docker / CI scenarios where `aio login` would otherwise fail to receive the browser callback) export `AIO_IMS_LOCAL_LOGIN_PORT` and forward that port into the container before logging in. See [debugging.md](debugging.md).

## The chain

Always **inspect before you create** — every create/add command fails loudly on "already exists", and there is no `--upsert` flag.

### 0. Pre-flight discovery

```bash
aio console project list --json
# If a project with the desired name already exists, skip step 1 and reuse it.

aio console api list --json
# Lists every service code available to the org. Each entry includes
# whether a product profile is required.
```

### 1. Create the Console project

```bash
aio console project create -n my-project --json
# Optional flags:
#   -t "My Project Title"
#   -d "Bootstrapped by appbuilder-project-init"
#   -o <orgId>
```

Capture the JSON output — `id`, `orgId`, and `name` are useful downstream.

### 2. Create a workspace inside the project

`Stage` is the conventional first non-Production workspace. Pick a more descriptive name (`Dev`, `QA`, `<feature>-test`) for long-lived shared projects.

```bash
aio console workspace create \
  --projectName my-project \
  --name Stage \
  --json
# Optional: --orgId <orgId> --title "Stage workspace"
```

### 3. Subscribe the workspace to APIs

Discover which services the app needs (and which require a product profile) before subscribing:

```bash
aio console workspace api list \
  --projectName my-project \
  --workspaceName Stage \
  --json
# (Returns currently-subscribed services. New project = empty list.)
```

Subscribe free-tier services (multiple comma-separated codes accepted in one call):

```bash
aio console workspace api add \
  --projectName my-project \
  --workspaceName Stage \
  --service-code AdobeIOManagementAPISDK,FilesSDK,StateSDK \
  --json
```

Subscribe a service that requires a product profile:

```bash
aio console workspace api add \
  --projectName my-project \
  --workspaceName Stage \
  --service-code AdobeAnalyticsSDK \
  --license-config "AdobeAnalyticsSDK=AnalyticsProductionProfile" \
  --json
```

`--license-config` is repeatable when several profile-bound services are added together. Format: `SERVICE_CODE=PROFILE[,PROFILE...]`.

### 4. Wire the local app to the new project/workspace

Two equivalent paths:

**A. Pass the IDs directly to `aio app init`** (cleanest):

```bash
skills/appbuilder-project-init/scripts/init.sh init \
  "@adobe/generator-app-excshell" ./my-project \
  --org <orgId> --project my-project
```

The wrapper passes `--org` / `--project` / `--template-options` straight through to `aio app init` on top of the existing `-y --no-login --no-install` flags.

**B. Init first, then `aio app use` to adopt the selected workspace:**

```bash
skills/appbuilder-project-init/scripts/init.sh init \
  "@adobe/generator-app-excshell" ./my-project
cd ./my-project
aio app use --no-input
```

Either way, `.aio` and `.env` end up pointing at the namespace owned by the bootstrapped workspace, so `aio app deploy` publishes to the right place.

## Recovering from per-step failures

Because each step is a separate command, the agent can branch instead of blowing up the whole chain.

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `aio console project create` returns "Project already exists" | Name collision in the org | Read `aio console project list --json`, reuse the existing `id`/`name`, and continue at step 2. |
| `aio console workspace create` returns "Workspace already exists" | Name collision inside the project | List existing workspaces with `aio console workspace list --projectName <p> --json` and continue at step 3. |
| `aio console workspace api add` returns "product profile required" | Service code needs a product profile | Re-run `aio console api list --json` to confirm the requirement, ask the user / org admin for the correct profile, and retry with `--license-config CODE=PROFILE`. |
| Any command returns an org-selection error | No org selected, or wrong org selected | Pass `--orgId <id>` explicitly or run `aio console org select <id>` once before retrying. |
| `aio console …` or `aio app init --project`/`--org` reports "command not found" or "unknown flag" | CLI bundle is stale | `npm install -g @adobe/aio-cli` and retry. Don't try to chase individual plugin versions; just refresh the bundle. |
| Bootstrap succeeds but `aio app deploy` deploys to the wrong namespace | Local `.aio` not pointing at the new workspace | Run `aio app use --no-input` from the project root, or re-init with `--org`/`--project`. |

For broader Node/npm/login issues see [debugging.md](debugging.md).

## Recommended flow inside the skill

```text
1. Preflight: `npm install -g @adobe/aio-cli` (refresh the bundle),
   `aio --version`, `aio auth login`, and confirm an org is selected.
2. Discover state: `aio console project list --json`,
   `aio console api list --json`.
3. For each missing piece, run the matching create/add command.
   Branch on per-step errors (already exists → reuse; profile needed → ask).
4. `scripts/init.sh init <template> <path> --org <id> --project <name>`
   (or `init-bare`) to scaffold the local app wired to that workspace.
5. Continue to post-init customization, validation, and skill chaining
   per `SKILL.md`.
```
