# Local Dispatcher SDK Execution (Cloud)

Use this reference when cloud dispatcher work requires a local SDK-backed runtime, not just static validation.

This file documents the launcher contract exposed by the shipped Dispatcher SDK scripts. It aligns with [Set up Dispatcher Tools (Adobe Experience League)](https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/local-development-environment-set-up/dispatcher-tools): Dispatcher is run locally using Docker against the **src** Dispatcher and Apache Web server configuration files. Treat the help output from the installed SDK package as the final authority for your exact SDK version.

## When To Use This

Use local SDK execution when you need one of these:

- container-backed runtime verification for rewrites, filters, vhosts, cache behavior, or probe-path handling
- local `test` mode to confirm the processed config and basic HTTPD/dispatcher validity
- hot-reload feedback while iterating on dispatcher config changes

Do not confuse this with deployable cloud config content. These commands are local runtime helpers.

## Positional Contract

The shipped launcher usage is:

```bash
./bin/docker_run.sh <dispatcher-src> <aem-host>:<aem-port> <local-port>
./bin/docker_run.sh <dispatcher-src> <aem-host>:<aem-port> test
```

Common examples (first argument is the path to the Dispatcher configuration **src** folder):

```bash
./bin/docker_run.sh ./src <aem-host>:4503 8080
DISP_RUN_MODE=stage ./bin/docker_run.sh ./src <aem-host>:4503 8080
DISP_LOG_LEVEL=trace1 ./bin/docker_run.sh ./src <aem-host>:4503 8080
REWRITE_LOG_LEVEL=trace2 ./bin/docker_run.sh ./src <aem-host>:4503 8080
./bin/docker_run.sh ./src <aem-host>:4503 test
```

For an AEM project, point to the project's `dispatcher/src` folder (e.g. `~/code/my-project/dispatcher/src`).

Meaning of the positional arguments:

- `<dispatcher-src>`: path to the Dispatcher configuration **src** folder (e.g. SDK's `./src` or project's `dispatcher/src`). The launcher runs against these config files; there is no separate "out" deployment folder.
- `<aem-host>:<aem-port>`: backend AEM endpoint the local Dispatcher runtime should talk to
- `<local-port>`: host port that exposes the local Dispatcher runtime
- `test`: run config test mode instead of exposing a live local port

## Hot reload

Hot reload lets the container pick up changes to Dispatcher and Apache config files without restarting the container—useful when iterating on rewrites, filters, vhosts, or other config under `<dispatcher-src>`.

### Preferred: hot-reload launcher

Many SDK packages include a dedicated launcher:

```bash
./bin/docker_run_hot_reload.sh <dispatcher-src> <aem-host>:<aem-port> <local-port>
```

It uses the same positional contract as `docker_run.sh` but watches the config src folder and reloads when files change. Prefer this when available; if your SDK prints different usage, follow its help output.

### Fallback: `HOT_RELOAD` with standard launcher

If `docker_run_hot_reload.sh` is not present, some SDK versions support hot reload via the standard launcher and the `HOT_RELOAD` environment variable:

```bash
HOT_RELOAD=true ./bin/docker_run.sh ./src <aem-host>:<aem-port> 8080
```

Check your SDK version; when supported, config changes under the src folder are picked up without restarting. See [Runtime Environment Variables](#runtime-environment-variables) for the `HOT_RELOAD` variable details.

## Runtime Environment Variables

The shipped launcher help exposes these environment variables:

### `DISP_RUN_MODE`

Defines the simulated environment type for the local run.

Valid values:

- `dev`
- `stage`
- `prod`

Default is `dev`.

### `DISP_LOG_LEVEL`

Sets dispatcher log verbosity.

Valid values:

- `trace1`
- `debug`
- `info`
- `warn`
- `error`

Default is `warn`.

Use `trace1` when you need backend request flow or dispatcher decision detail.

### `REWRITE_LOG_LEVEL`

Sets rewrite-engine log verbosity.

Valid values:

- `trace1` through `trace8`
- `debug`
- `info`
- `warn`
- `error`

Default is `warn`.

Use this when debugging `RewriteRule` and `RewriteCond` behavior.

### `ENV_FILE`

Imports variables from a file before startup.

Use this when local SDK execution depends on variables that would otherwise be exported manually.

### `HOT_RELOAD`

Enables config reload when watched files in the config src folder change (no container restart).

Valid values:

- `true`
- `false`

Default is `false`.

Use this for local iteration loops on rewrites, filters, and vhosts. When your SDK does not provide `docker_run_hot_reload.sh`, try `HOT_RELOAD=true` with `docker_run.sh` if the package supports it. See [Hot reload](#hot-reload) for usage.

### `ALLOW_CACHE_INVALIDATION_GLOBALLY`

Overwrites the default invalidation behavior to allow all connections for cache invalidation.

Valid values:

- `true`
- `false`

Default is `false`.

Treat this as a local test convenience only. Do not carry this posture into production guidance.

### `HTTPD_DUMP_VHOSTS`

Enables vhost dump output for debugging.

Valid values:

- `true`
- `false`

Default is `false`.

### `ENABLE_MANAGED_REWRITE_MAPS_FLAG`

Enables managed rewrite maps.

Valid values:

- `true`
- `false`

Default is `true`.

This matters when local behavior depends on rewrite-map-backed redirects or readiness gating.

### `MANAGED_REWRITE_MAPS_PROBE_CHECK_SKIP`

Skips probe checks for managed rewrite maps.

Valid values:

- `true`
- `false`

Default is `false`.

Only use this when intentionally isolating local rewrite-map behavior and call out that the check was skipped.

## Host-Side Compatibility Variable

You may also see:

```bash
export DOCKER_API_VERSION=1.43
```

This is a host Docker-client compatibility override, not a dispatcher runtime setting. Use it only when the installed SDK scripts or local Docker environment require it.

## Recommended Execution Patterns

### 1. Static Config Test

Use this first when the goal is syntax or processed-config validation:

```bash
./bin/docker_run.sh ./src <aem-host>:<aem-port> test
```

Use this before claiming runtime behavior is verified.

### 2. Live Local Dispatcher Port

Use this when you need request/response verification:

```bash
./bin/docker_run.sh ./src <aem-host>:<aem-port> 8080
```

Then verify behavior with representative requests against the local port.

### 3. Hot Reload Iteration

Use this when tuning rewrites, filters, or vhosts repeatedly so config changes apply without restarting the container. See [Hot reload](#hot-reload) for the launcher and `HOT_RELOAD` fallback.

```bash
./bin/docker_run_hot_reload.sh ./src <aem-host>:<aem-port> 8080
```

If your SDK does not include `docker_run_hot_reload.sh`, use `HOT_RELOAD=true ./bin/docker_run.sh ./src <aem-host>:<aem-port> 8080` when supported.

## Skill Usage Guidance

When using local SDK execution in cloud dispatcher skills:

- state whether evidence came from static validation, local SDK runtime, or MCP runtime tools
- record the exact launcher mode used: live port, hot reload, or `test`
- record any non-default env vars that materially changed behavior
- call out when managed rewrite map checks, invalidation safety, or run-mode simulation could affect the conclusion
- do not treat local SDK behavior as stronger evidence than executed MCP/runtime evidence against the actual target environment
