# aio CLI command reference

Sections: Auth/config · App lifecycle · Add/remove · Templates · Maintenance · Gotchas

## Auth / config

| Command | Use |
|---|---|
| `aio login` / `aio login -f` | Log in (force a fresh prompt) |
| `aio logout` | Log out (required when switching prod ↔ stage) |
| `aio where` | Show current IMS org/context |
| `aio console org list` | List orgs and org IDs |
| `aio console project list` | List projects in the current org |
| `aio console project create -n <name> -t "<title>"` | **Create** an App Builder project (name **< 20 chars**; gets Prod + Stage workspaces) — the CLI *can* create projects |
| `aio console project select <id\|name>` | Select a project as the current context |
| `aio console workspace list` | List workspaces in the selected project |
| `aio config` | Inspect/manage CLI config |
| `export AIO_CLI_ENV=stage` | Target the stage Console (then logout + login) |

## App lifecycle

| Command | Use |
|---|---|
| `aio app init <name>` | Scaffold (Org→Project→Workspace, extension point, template) |
| `aio app init <name> --standalone-app` | Empty app with a feature picker |
| `aio app init <name> --import <console.json>` | Scaffold from a downloaded workspace config |
| `aio app init <name> -y` | No-creds, code-only sample (generic action) |
| `aio app init <dir> -o <org> -p <project> -w <ws> -t @adobe/workfront-ui-ext-tpl -y` | **Non-interactive** WF scaffold (flags instead of prompts). ⚠️ `-y` also skips the Main Menu prompt → no menu item is generated |
| `aio app dev` | Local UI + actions in Node; hot reload; debug; console logs |
| `aio app run` | Local UI; actions on the deployed Runtime |
| `aio app run --local` | Deprecated; local OpenWhisk (not on Apple Silicon — use `aio app dev`) |
| `aio app deploy` | Build + deploy actions + static SPA |
| `aio app undeploy` | Remove the deployed app |
| `aio app logs --limit <n>` | Fetch recent activation logs (after run/deploy) |
| `aio app test` / `aio app test -e` | Unit / end-to-end tests (Jest) |

## `aio app init` prompts

`init` is interactive; the questions depend on the flow.

**Workfront template flow** (`aio app init <name>` → WF template):

| Prompt | Answer |
|---|---|
| Select Org | your IMS org (type to filter) |
| Select Project | the Console project you created |
| Select Workspace | Production / Stage / a dev workspace |
| Which extension point(s) do you wish to implement? | multi-select — `space` toggle, `a` all, `i` invert |
| Choose a template | **`@adobe/workfront-ui-ext-tpl`** |
| Name / description / version | extension metadata |
| What would you like to do next? | *Add a custom button to Main Menu Item* (optional) → *I'm done* |

**Empty / feature flow** (`--standalone-app`, or generic init) — asks these instead of a single template pick:

| Prompt | Options |
|---|---|
| Which Adobe I/O App features…? | Actions (Runtime) · Events · Web Assets (SPA) · CI/CD (GitHub Actions) |
| Which type of sample actions…? *(if Actions)* | Generic · Adobe Analytics · Adobe Experience Platform: Realtime Customer Profile · … (list depends on services attached to the workspace) |
| Which type of UI…? *(if Web Assets)* | **React Spectrum 3 UI** · Raw HTML/JS UI |
| How would you like to name this action? | one per sample action (or keep the default) |

`--import <console.json>` asks the same config prompts but needs no login; `-y` skips every prompt and generates only the generic action.

## Add / remove parts

`aio app add ext|action|web-assets|ci`
`aio app delete ext|action|web-assets|ci`

## Templates

| Command | Use |
|---|---|
| `aio templates discover` / `--interactive` | Browse the template registry |
| `aio templates install <pkg>` | Install a template (e.g. `@adobe/workfront-ui-ext-tpl`) |

## Maintenance

| Command | Use |
|---|---|
| `aio -v` + `npm show @adobe/aio-cli version` | Compare installed vs latest |
| `npm install -g @adobe/aio-cli` | Update the CLI |
| `aio update` | Update core plugins |

## Gotchas

- First `aio app dev` / `run` generates a self-signed cert you must accept at `https://localhost:<port>` before the app loads.
- `.env` is locked while the app runs (backed up + restored on exit) — edit it before starting.
- `aio app dev` runs actions in-process in Node and does **not** fully emulate Runtime; do not rely on `process.env` being present at runtime (see `workfront-actions`).
- Stage requires both `AIO_CLI_ENV=stage` **and** a logout/login, plus selecting a stage workspace/project.
- Every action needs a **`runtime` kind** (e.g. `runtime: nodejs:20`) in the manifest, or `aio app deploy` fails with *`Invalid or missing property "runtime"`* (also on the `__secured_` wrapper that `require-adobe-auth` adds).
- **Stop `aio app dev` before `aio app deploy`** — dev locks `.env`, so running a deploy alongside it conflicts.
