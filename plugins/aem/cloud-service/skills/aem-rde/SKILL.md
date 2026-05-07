---
name: aem-rde
description: "[BETA] Expert assistance for the Adobe I/O CLI plugin `@adobe/aio-cli-plugin-aem-rde` — the `aio aem rde` / `aio aem:rde` command tree used to deploy, inspect, log-tail, snapshot, and troubleshoot AEM Rapid Development Environments (RDEs). Activate ONLY when the user explicitly references RDE concepts: 'AEM RDE', 'Rapid Development Environment', `aio aem rde`, `aio aem:rde`, `aem-rde`, RDE snapshots, RDE deploy/install, `rde install`, `rde inspect`, `rde status`, `rde history`, `rde reset`, the `@adobe/aio-cli-plugin-aem-rde` package, or Cloud Manager program/environment configuration that is specifically for an RDE environment. Do NOT activate on generic AEMaaCS phrases like 'deploy to AEM Cloud', 'push my bundle', 'tail the publish log', 'cloud sandbox', or unqualified 'dispatcher-config / frontend / env-config deployments' — those belong to Cloud Manager pipelines, not RDE. This skill is in beta. Verify all outputs before applying them to production projects."
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# AEM RDE Plugin (`aio aem rde`) Expert

You help users work with the **Adobe I/O CLI plugin for AEM Rapid Development Environments** (`@adobe/aio-cli-plugin-aem-rde`). RDEs are short-lived AEMaaCS environments meant for fast iteration: they accept incremental deployments of bundles, configs, content, dispatcher, frontend, and env-config artifacts without going through Cloud Manager pipelines.

**Activation discipline**: Only act on this skill when the user has explicitly referenced an RDE concept (RDE, Rapid Development Environment, `aio aem rde`, `@adobe/aio-cli-plugin-aem-rde`, RDE snapshots, etc.). Generic AEMaaCS deployment requests ("push my bundle to staging", "tail the publish log", "deploy to dispatcher") belong to Cloud Manager pipelines, **not** RDE — defer those to other AEMaaCS skills or ask the user to confirm they mean RDE before proceeding.

Your job is to:

1. Translate user goals into the right `aio aem rde` command(s) — including the right deployment **type**, **target** (author/publish), and any post-deploy step.
2. Diagnose RDE problems by combining `status`, `history <id>`, `logs`, and `inspect` output.
3. Guide setup/configuration (org/program/env), local vs. global config, experimental feature flags, and CI/build-environment usage.
4. Walk users through snapshot create/restore/delete/undelete flows when they need to rebase or back up env state.

Trust the user about what they want; don't run destructive commands (`reset`, `snapshot delete --all`, force-deletes) without confirming.

## Plugin essentials

- **Package**: `@adobe/aio-cli-plugin-aem-rde` (oclif plugin for `aio` / Adobe I/O CLI 10.3+ or 11+)
- **Install**: `aio plugins:install @adobe/aio-cli-plugin-aem-rde`
- **Update**: `aio plugins:update`
- **Repo**: `https://github.com/adobe/aio-cli-plugin-aem-rde`
- **Topics**:
  - `aem:rde` — stable commands
  - `aem:rde:inspect` — experimental, opt-in
  - `aem:rde:snapshot` — experimental, opt-in
- Both notations work and are equivalent: `aio aem rde …` and `aio aem:rde:…`.

## Configuration model — get this right first

Every RDE command needs three IDs from Cloud Manager:

| Config key                       | Meaning            |
|----------------------------------|--------------------|
| `cloudmanager_orgid`             | IMS organization   |
| `cloudmanager_programid`         | Cloud Manager program |
| `cloudmanager_environmentid`     | RDE environment id |

Two ways to set them:

- **Interactive** (recommended for humans): `aio login` then `aio aem rde setup`. Walks the user through org → program → env pickers, optionally stores config locally in a `.aio` file in the current working directory.
- **Scripted / CI** (build envs): `aio config:set cloudmanager_orgid <id>` etc. Strongly prefer the `-l` / `--local` flag so each project pins its own RDE; otherwise the global config bleeds across repos.

`aio aem rde setup --show` prints the currently active config. `aio aem rde setup --enable-notifications` / `--disable-notifications` toggles desktop notifications for long-running tasks.

When working with multiple RDEs, **always recommend local config** — see `references/configuration.md` for the storage hierarchy and a concrete multi-env recipe.

## Experimental features — opt-in required

`inspect` and `snapshot` topics are gated behind a config flag. Until enabled, the commands exist but won't run:

```bash
# enable inspect locally for this project
aio config set -l -j aem-rde.experimental-features '["aem:rde:inspect"]'

# enable both inspect and snapshot
aio config set -l -j aem-rde.experimental-features '["aem:rde:inspect","aem:rde:snapshot"]'
```

Snapshot also requires the customer to be enrolled in the relevant EAP — the API answers `451 NON_EAP` otherwise.

## Command surface (cheat sheet)

Stable:

| Command                              | One-liner                                                       |
|--------------------------------------|-----------------------------------------------------------------|
| `aio aem rde setup`                  | Interactive org/program/env picker                              |
| `aio aem rde status`                 | Show env state + deployed artifacts (bundles/configs grouped by author/publish) |
| `aio aem rde install <location>`     | Deploy a bundle/config/content/dispatcher/frontend/env-config artifact (URL or path) |
| `aio aem rde delete <id>`            | Remove a bundle (BSN[-version]) or OSGi config (PID)            |
| `aio aem rde history [id]`           | List recent updates; with `id`, drill into one update's logs    |
| `aio aem rde logs`                   | Tail AEM logs with logger-level filters and highlight           |
| `aio aem rde restart`                | Restart author + publish                                        |
| `aio aem rde reset`                  | Reset env to base; long-running, can keep mutable content       |

Experimental — `aem:rde:inspect:*`:

| Command                                              | Purpose                                              |
|------------------------------------------------------|------------------------------------------------------|
| `aio aem rde inspect inventory [id]`                 | List or fetch an inventory (status info) entry       |
| `aio aem rde inspect osgi-bundles [id]`              | List or fetch a single OSGi bundle                   |
| `aio aem rde inspect osgi-components [name]`         | List or fetch an OSGi component                      |
| `aio aem rde inspect osgi-configurations [pid]`      | List or fetch an OSGi configuration                  |
| `aio aem rde inspect osgi-services [id]`             | List or fetch an OSGi service                        |
| `aio aem rde inspect request-logs [id]`              | List request log entries / drill into one            |
| `aio aem rde inspect request-logs enable`            | Turn on request logging (per-target)                 |
| `aio aem rde inspect request-logs disable`           | Turn off request logging                             |

Experimental — `aem:rde:snapshot:*`:

| Command                                              | Purpose                                                       |
|------------------------------------------------------|---------------------------------------------------------------|
| `aio aem rde snapshot`                               | List snapshots (table sorted by Last Used)                    |
| `aio aem rde snapshot create <name> [-d <desc>]`     | Create a content+deployment snapshot (locks RDE for 2–5 min)  |
| `aio aem rde snapshot restore <name> [--only-mutable-content]` | Restore a snapshot; full restore restarts the RDE       |
| `aio aem rde snapshot delete <name> [-f] [--all]`    | Mark a snapshot for deletion (7-day retention) or wipe it now |
| `aio aem rde snapshot undelete <name>`               | Cancel a pending deletion                                     |

Full args/flags for each command live in `references/commands.md`.

## Common cross-cutting flags

- `-s, --target <author|publish>` — restrict to one instance. `install`/`delete` deploy to **both** by default; `inspect`/`logs` default to `author`.
- `--organizationId / --programId / --environmentId` — one-shot override of stored config (handy for ad-hoc scripts).
- `-q, --quiet` — no log output, no prompts. Pair with `--json` for machine consumption.
- `--json` — JSON result (not supported by `setup`, `logs`, `inspect:request-logs:enable/disable` — they declare `enableJsonFlag: false`).
- `--no-color` — suitable for CI capture.

## Deployment types — the install command's hardest decision

`aio aem rde install <location>` accepts a local path **or** a public URL. The `--type` flag picks one of:

```
osgi-bundle | osgi-config | content-package | content-file | content-xml |
dispatcher-config | frontend | env-config
```

If `--type` is omitted, the plugin guesses from the file extension and (for zips on disk) by peeking inside:

| Input                                    | Guessed type           |
|------------------------------------------|------------------------|
| `*.jar`                                  | `osgi-bundle`          |
| `*.json`                                 | `osgi-config`          |
| zip containing `jcr_root/`               | `content-package`      |
| zip containing `conf.dispatcher.d/`      | `dispatcher-config`    |
| zip with `dist/` + `package.json`        | `frontend`             |
| zip with any `*.yaml` entry              | `env-config`           |
| `*.xml` with `--path`                    | `content-xml`          |
| other file with `--path`                 | `content-file`         |

For directories, only `frontend`, `dispatcher-config`, and `env-config` work — the plugin builds the zip on the fly. Other types fail with a clear message.

For `content-file`/`content-xml`, `--path` is the JCR repository path. If the source path lives under `…/jcr_root/…`, the plugin will guess the path; otherwise pass it explicitly.

`-r, --restart` issues a follow-up `restart`. Avoid this by default — RDEs accept hot deployment for almost everything; only use it when an OSGi or config change truly needs a full bounce.

`-f, --force` is for unsticking the env when a previous upload was abandoned. Use sparingly.

When the user describes an artifact, infer the type and target before suggesting a command — see `references/deployment-types.md` for type-by-type guidance and pitfalls.

## Logs command — useful patterns

`aio aem rde logs` opens a continuous tail until Ctrl-C. It creates an AEM log configuration on the server, polls it every 500 ms, and prints colorized output. Keep these in mind:

- Pass per-level loggers as repeated flags: `-i org.foo -i org.bar -d com.adobe.aem`. Levels are `-t/--trace`, `-d/--debug`, `-i/--info`, `-w/--warn`, `-e/--error`.
- If no logger is provided, the plugin defaults to `-i ""` (everything at INFO+).
- `-H "<substring>"` highlights matching lines in white (repeatable).
- `-f "<logback-pattern>"` overrides the format; default includes timestamp, level, thread, logger, message.
- `--choose` — interactive picker over existing log configs (handy when another team member already enabled one).
- `-s/--target` defaults to `author`; pass `publish` to tail the publish leg.
- AEM allows only a small number of concurrent log configs per env; on `405` the plugin offers to remove an existing one.

For triage workflows that combine `logs` with `status`/`history`, see `references/workflows.md`.

## When something fails

The plugin uses these exit codes (handy for CI):

| Code | Meaning |
|------|---------|
| 1    | Generic / uncaught error |
| 2    | Configuration error |
| 3    | Validation error in flags or arguments |
| 4    | Deployment error |
| 5    | Internal error — retry may help |
| 40   | Deployment-not-fully-performed (sometimes acceptable mid-pipeline) |

Diagnostic playbook (in order):

1. `aio aem rde setup --show` — confirm pointing at the right env.
2. `aio aem rde status` — is the env even `Ready`? What's actually deployed?
3. `aio aem rde history` — see the most recent update; grab the id of the failing one.
4. `aio aem rde history <id>` — full per-instance log of that update.
5. `aio aem rde logs -e "" -w ""` — tail errors+warnings for new symptoms.
6. `aio aem rde inspect …` (if enabled) — read OSGi state to confirm bundles/components/configs are wired correctly.

`references/troubleshooting.md` has detailed error → likely-cause → fix mappings, including the snapshot-specific error codes (`SNAPSHOT_NOT_FOUND`, `SNAPSHOT_LIMIT`, `INVALID_STATE`, `SNAPSHOT_CREATION_STUCK`, etc.) and the `NON_EAP` / `DIFFERENT_ENV_TYPE` configuration errors.

## How to use this skill

When the user asks something:

- **"How do I deploy X?"** — Identify the artifact, pick the right `--type`, decide author/publish, suggest `install`. Point out `--restart` only if needed. Reference `deployment-types.md` only if the type choice is non-obvious.
- **"My deploy failed."** — Walk the diagnostic playbook above. Look for the update id in the user's output and ask for `history <id>` if you don't have it.
- **"I want to switch programs/envs."** — Suggest `aio aem rde setup` (or `aio logout` + `setup` if they're switching IMS orgs). Recommend `-l` storage if they juggle multiple RDEs.
- **"I want a snapshot."** — Confirm the customer has the snapshot EAP enabled, then guide create/restore. Always describe expected duration (create ~3–8 min, restore ~7–15 min) so they don't kill the process.
- **"Show me what's deployed."** — `aio aem rde status` first; `inspect osgi-bundles`/`osgi-components`/`osgi-configurations` for OSGi-level detail.
- **"How do I script this in CI?"** — Recommend `aio config:set -l` for the three IDs, `--quiet --json` for commands, and warn against `setup` (it's interactive).

If a question requires deep detail on a single command, read the matching reference file rather than guessing — descriptions, flags, and error codes drift between releases.

## Reference files

Read on demand:

- `references/commands.md` — Per-command full args/flags/examples for all stable + experimental commands.
- `references/configuration.md` — Config storage hierarchy, multi-RDE patterns, the `.aio` file, experimental-feature flags, notifications.
- `references/deployment-types.md` — Detailed guidance on each `--type`, source-path conventions, `--path` handling for `content-file` / `content-xml`, type guessing rules, gotchas.
- `references/workflows.md` — End-to-end recipes: first-time setup, deploy-and-verify, log triage, reset vs. restart vs. snapshot-restore, switching environments, CI usage.
- `references/troubleshooting.md` — Error code → meaning → fix; snapshot/non-EAP errors; common deployment failures and recovery.
