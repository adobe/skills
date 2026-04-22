# Debugging App Builder Project Init

Common failures during Developer Console bootstrap, `aio app init`, post-init setup, and first run — with root causes and fixes.

For bootstrap-specific guidance (project / workspace / API subscription), see [bootstrap.md](bootstrap.md).

## `aio console project create` or `aio console workspace create` is unrecognised

| Cause | Fix |
| --- | --- |
| `@adobe/aio-cli-plugin-console` is older than 5.2.0 — the non-interactive `create` commands did not exist yet | `npm install -g @adobe/aio-cli` to pull in plugin 5.2.0+. Verify with `aio plugins --core | grep aio-cli-plugin-console`. |
| `aio` not installed in the same shell PATH as `npm -g` | Run `which aio` and `npm root -g`; if they disagree, fix PATH or reinstall the CLI. |

## `aio console api list` / `aio console workspace api add` is unrecognised

| Cause | Fix |
| --- | --- |
| `@adobe/aio-cli-plugin-console` is older than 5.3.0 — these subcommands shipped in 5.3.0 | `npm install -g @adobe/aio-cli` to pull in plugin 5.3.0+. |
| Typo in the service code passed to `--service-code` | Run `scripts/init.sh api-list` (or `aio console api list --json`) to copy the exact `code` field. |

## `aio console project create` returns "already exists"

| Cause | Fix |
| --- | --- |
| A project with that name already exists in the org | Read `aio console project list --json` and reuse the existing project's name. Skip directly to `aio console workspace create`. |
| No org selected (and `--orgId` not passed) — error wording can be misleading | Run `aio console org select <orgId>` once, or pass `--orgId` to every bootstrap command. |
| Token expired | `aio auth login` and retry. |

## `aio console workspace api add` returns "product profile required"

| Cause | Fix |
| --- | --- |
| The service code requires a product profile and `--license-config` was not supplied | Re-run `aio console api list --json` to confirm which services need profiles, then retry with `--license-config CODE=PROFILE`. Repeat the flag once per profile-bound service. |
| Product profile name is wrong / case-mismatched | Profile names are case-sensitive and org-specific; confirm with the org admin or via the Adobe Admin Console. |

## `aio app use` after bootstrap doesn't pick up the new workspace

| Cause | Fix |
| --- | --- |
| Local `.aio` was already populated from a prior project | Run `aio app use --no-input` from the project root after bootstrap; it adopts the currently selected console workspace without prompting. |
| Console selection drifted between bootstrap and `aio app use` | Re-select explicitly: `aio console project select <projectId> && aio console workspace select <workspaceId>`. |
| Plugin-app is too old for `aio app init --project`/`--org` | Update to `@adobe/aio-cli-plugin-app >= 14.2.0` (`npm install -g @adobe/aio-cli`), then either re-init with the flags or stay on the `aio app use --no-input` path. |

## `aio app *` fails with config validation errors right after init

Since `@adobe/aio-cli-plugin-app@14.4.0` (2026-01-20) every `aio app *` command validates `app.config.yaml` by default, and `@adobe/aio-cli-lib-app-config@4.2.0` (2026-03-10) tightened that schema to match the OpenWhisk spec for actions and packages.

| Cause | Fix |
| --- | --- |
| Manifest is intentionally mid-edit and not yet schema-valid | Pass `--no-config-validation` to unblock for that one command. Treat this as a temporary escape hatch, not a permanent setting — re-validate as soon as the manifest is whole. |
| Pre-existing manifest predates the OpenWhisk schema alignment | Reconcile the action/package shapes with the OpenWhisk spec referenced in the 4.2.0 release notes. Re-run with default validation (or `--config-validation`). |
| Root-level `runtimeManifest` in `app.config.yaml` (the long-standing guardrail) | Move it under `application.runtimeManifest`, or into an `ext.config.yaml` for extension projects. |

## `aio app init` template listing hangs behind a corporate proxy

| Cause | Fix |
| --- | --- |
| Older `@adobe/aio-lib-templates` and `@adobe/aio-cli-plugin-telemetry` did not honour `HTTP_PROXY`/`HTTPS_PROXY` for the SSL CONNECT handshake | Update the CLI to pull in `aio-lib-templates@3.0.4` / `aio-cli-plugin-telemetry@2.0.3` or newer: `npm install -g @adobe/aio-cli`. Confirm `HTTPS_PROXY` is exported in the same shell. |

## `aio login` from inside Docker / a CI runner cannot complete the browser callback

The interactive login launches a local server on a random port and waits for the browser redirect. When `aio` is running inside a container, that port is hidden from the host browser by default.

| Cause | Fix |
| --- | --- |
| Local login port is not forwarded into the container | Set `AIO_IMS_LOCAL_LOGIN_PORT` (added in `@adobe/aio-lib-ims-oauth@6.1.0`, 2026-03-24) and forward it: `docker run -p $PORT:$PORT -e AIO_IMS_LOCAL_LOGIN_PORT=$PORT …`. The CLI then advertises a stable URL the browser on the host can resolve. |
| `--no-open` flag was being silently ignored on Windows | Reinstall the CLI to pull in `@adobe/aio-lib-ims-oauth@6.0.5`+ (2025-12-02), which fixed `--no-open` on all OSes and surfaced auto-open errors instead of failing silently. |

## `aio app init` fails with "template not found"

| Cause | Fix |
| --- | --- |
| Template name misspelled | Check exact names in [templates.md](templates.md) — names are case-sensitive and scoped (e.g. `@adobe/generator-app-excshell`) |
| npm registry unreachable | Run `npm ping`; if it fails, check network/proxy settings (`npm config get registry`) |
| aio CLI outdated | Run `npm install -g @adobe/aio-cli@latest` — older CLI versions may not recognize newer templates |

## `aio app init` hangs or times out

| Cause | Fix |
| --- | --- |
| Corporate proxy blocks template download | Set `HTTP_PROXY` and `HTTPS_PROXY` environment variables |
| npm cache corrupt | Run `npm cache clean --force`, then retry |
| DNS resolution failure | Try `npm config set registry https://registry.npmjs.org/` to force HTTPS |
| Slow network + large template | Wait up to 5 minutes; if still stuck, `Ctrl+C` and retry with `--verbose` for diagnostics |

## Node version mismatch errors

| Cause | Fix |
| --- | --- |
| Node < 18 installed | App Builder requires Node 18+. Run `node -v` to check, then `nvm use 18` or `nvm use 20` |
| Template requires specific version | Check `engines` field in the generated `package.json` after init |
| Multiple Node versions conflict | Use `nvm` or `volta` to pin the version per project: `nvm use 18 && node -v` |

Tip: run `node -v && npm -v` before every init to confirm versions.

## `npm install` fails after init

| Cause | Fix |
| --- | --- |
| Node version incompatible with native modules | Match the Node version to `engines` in `package.json` |
| Missing build tools for native deps | Install Python 3 and a C++ compiler (`xcode-select --install` on macOS) |
| Lock file conflict | Delete `package-lock.json` and `node_modules/`, then run `npm install` again |
| Private registry not configured | Set `npm config set registry <your-registry-url>` or add `.npmrc` to project root |

Note: `aio app init` runs with `--no-install`, so init succeeds even when `npm install` would fail. Always run `npm install` after init and fix errors before proceeding.

## `aio app build` fails immediately after init

| Cause | Fix |
| --- | --- |
| Missing `.env` file | Copy `.env.example` to `.env` if the template provides one; otherwise create `.env` with required vars |
| `ext.config.yaml` references non-existent actions | Verify every `function:` path in `ext.config.yaml` points to an actual JS file |
| Webpack/Babel errors in `web-src` | Run `npm install` in the project root; check for missing `@babel/*` or `webpack` dev dependencies |
| Stale `app.config.yaml` `$include` paths | Ensure every `$include` entry resolves to a real file — remove entries for deleted extensions |

## Extension template creates wrong directory structure

| Cause | Fix |
| --- | --- |
| Extension type determines directory naming | CF Console extensions → `src/aem-cf-console-admin-1/`; ExC Shell → `src/dx-excshell-1/` |
| Multiple extensions create multiple `src/<ext>/` dirs | This is expected — each extension gets its own directory with its own `ext.config.yaml` |
| `app.config.yaml` `$include` entries don't match dirs | After init, verify each `$include` path matches an actual `src/<ext>/ext.config.yaml` file |
| Bare init created unexpected directories | If `init-bare` generates `actions/`, `src/`, or `web-src/`, remove them — bare means minimal scaffold only |

## `aio login` fails or token expires immediately

| Cause | Fix |
| --- | --- |
| Browser popup blocked | Use `aio login --no-open` to get a URL you can paste into the browser manually |
| Corporate SSO redirect loop | Try the direct IMS login URL from `aio login --no-open` output |
| Token TTL is 24 hours | Re-run `aio login` daily during development; there is no silent refresh |
| Wrong IMS org selected | Run `aio console org list` to see available orgs, then `aio console org select <orgId>` |

## Project init succeeds but `aio app run` shows nothing

| Cause | Fix |
| --- | --- |
| No actions or UI created | Init only scaffolds structure — add actions via `aio app add action` or the init script's `add-action` command |
| Port 9080 already in use | Kill the process on 9080 (`lsof -ti:9080 | xargs kill`) or set `PORT=9081 aio app run` |
| Missing `.env` credentials | `aio app run` needs `AIO_runtime_namespace` and `AIO_runtime_auth` in `.env` — run `aio app use` to populate |
| Actions deploy but UI is blank | Check browser console for CORS errors; verify `app.config.yaml` has correct `web` configuration |
