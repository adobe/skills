# Debugging App Builder Project Init

Common failures during `aio app init`, post-init setup, and first run — with root causes and fixes.

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
