# Debugging App Builder Project Init

Common failures during Developer Console bootstrap, `aio app init`, post-init setup, and first run — with root causes and fixes.

For bootstrap-specific guidance (project / workspace / API subscription), see [bootstrap.md](bootstrap.md).

## An `aio console …` or `aio app …` subcommand / flag is unrecognised

The non-interactive Console + app init commands (`project create`, `workspace create`, `api list`, `workspace api add` with `--license-config`, `aio app init --org/--project/--template-options`, `--no-config-validation`) all ship in the latest `@adobe/aio-cli` bundle. Don't chase individual plugin versions — just refresh the bundle.

| Cause | Fix |
| --- | --- |
| CLI bundle is stale | `npm install -g @adobe/aio-cli`, then `aio --version`, then retry the failing command. |
| `aio` on PATH is from a different install than `npm -g` | Run `which aio` and `npm root -g`; if they disagree, fix PATH (or remove the stale `aio`) and reinstall. |
| Typo in the value passed to a flag (e.g. `--service-code`) | Re-list the canonical values, e.g. `aio console api list --json` for service codes, and copy the `code` field exactly. |

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
| `aio app init --project` / `--org` was rejected as unknown | CLI bundle is stale — `npm install -g @adobe/aio-cli`, then either re-init with the flags or stay on the `aio app use --no-input` path. |

## `aio app *` fails with config validation errors right after init

Recent `aio app *` versions validate `app.config.yaml` by default against an OpenWhisk-aligned schema for actions and packages.

| Cause | Fix |
| --- | --- |
| Manifest is intentionally mid-edit and not yet schema-valid | Pass `--no-config-validation` to unblock for that one command. Treat this as a temporary escape hatch, not a permanent setting — re-validate as soon as the manifest is whole. |
| Pre-existing manifest predates the OpenWhisk schema alignment | Reconcile the action/package shapes with the current OpenWhisk-aligned schema, then re-run with default validation (or `--config-validation`). |
| Root-level `runtimeManifest` in `app.config.yaml` (the long-standing guardrail) | Move it under `application.runtimeManifest`, or into an `ext.config.yaml` for extension projects. |

## `aio app init` template listing hangs behind a corporate proxy

| Cause | Fix |
| --- | --- |
| Stale CLI bundle didn't honour `HTTP_PROXY` / `HTTPS_PROXY` during the template registry SSL handshake | `npm install -g @adobe/aio-cli` to pick up the proxy fix, confirm `HTTPS_PROXY` is exported in the same shell, then retry `aio app init`. |

## `aio login` from inside Docker / a CI runner cannot complete the browser callback

The interactive login launches a local server on a random port and waits for the browser redirect. When `aio` is running inside a container, that port is hidden from the host browser by default.

| Cause | Fix |
| --- | --- |
| Local login port is not forwarded into the container | Export `AIO_IMS_LOCAL_LOGIN_PORT=<port>` and forward it into the container, e.g. `docker run -p $PORT:$PORT -e AIO_IMS_LOCAL_LOGIN_PORT=$PORT …`. The CLI then advertises a stable URL the browser on the host can resolve. (If `aio` doesn't honour the env var, refresh the CLI bundle: `npm install -g @adobe/aio-cli`.) |
| `aio login --no-open` is being silently ignored on Windows | `npm install -g @adobe/aio-cli` to pull in the fix that makes `--no-open` honour the flag and surface auto-open errors instead of failing silently. |

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
