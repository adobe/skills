# Troubleshooting & real-world gotchas

Hard-won fixes from building a Workfront UI extension end-to-end. Read the row that matches your **symptom**; each links to the skill with the full detail. Most "it's broken and I don't know why" moments in this stack are one of these.

## Setup & CLI — `appbuilder-project-init`, `appbuilder-workfront`

| Symptom | Cause | Fix |
|---|---|---|
| `aio` throws `SyntaxError: Unexpected token '??='` | A pre-20 Node is *active*, running an `aio` installed under Node 20 | `nvm use 20` (and `nvm alias default 20`); reinstall `aio` under 20 |
| `aio: command not found` after switching Node | A global `aio` belongs to whichever Node was active at install | `npm i -g @adobe/aio-cli` under Node 20 |
| `aio login` opens the browser then errors `[IMSOAuthSDK:TIMEOUT]` after ~120 s | Manual SSO/MFA took longer than the CLI's wait | Harmless — re-run `aio login` (instant now) or just run the next `aio` command; confirm with `aio where` |
| "The CLI can't create the project" (old belief) | Stale docs | It **can**: `aio console project create -n <name> -t "<title>"` (name **< 20 chars**), or press `+` at the init "Select a Project" prompt |
| `Project name length must be less than 20` | `-n` too long | Shorten the name (the title can be long) |
| `aio console workspace create --name Stage` → "Workspace Stage already exists" | `aio console project create` **already auto-provisions** a `Production` **and** a `Stage` workspace — you don't need to create the first one | Check with `aio console workspace list --projectId <id> --json` before creating; only add a workspace beyond the two that already exist |

> An AI assistant *may* drive login for you: start `aio login` in the background, open the printed URL in a browser for **you** to finish SSO by hand, then detect completion. Only scripting the credential entry itself is off-limits.

> **This "drive it yourself" default extends well past login.** Registering a BYO extension in Extension Manager, toggling it on, and placing it in a Layout Template's Main Menu (`workfront-local-testing`) are all ordinary UI clicks once a session is authenticated — an agent with Playwright/browser MCP available should drive that navigation itself rather than asking the human to click through Setup menus and dialogs. The only steps that genuinely need the human are the ones no tool can complete on someone's behalf: SSO/MFA credential entry, and informed consent to a legal agreement (e.g. accepting Developer Terms of Use — get the human to click "Accept" themselves after you've navigated to the exact screen, don't click it for them). A fresh Playwright browser starts **logged out**, even if `aio` is already authenticated in a terminal session — those are separate credential stores.

## Scaffold — `appbuilder-workfront`, `workfront-ui-extension`

| Symptom | Cause | Fix |
|---|---|---|
| **No Main Menu button after scaffolding** | `aio app init -y` (or skipping "Add a custom button to Main Menu Item") generates **no** menu item — no `mainMenu`, no view, no `App.js` route, no `icons.js`, empty `extensionId` | Answer that prompt during init, or hand-add: `icons.js` (exports `icon1`/`icon2`), the `mainMenu` block, a `<Route>`, and the view component |
| Want a non-interactive scaffold | — | `aio app init <dir> -o <org> -p <project> -w <ws> -t @adobe/workfront-ui-ext-tpl -y` |
| `aio app use -w Stage` → "Incomplete .aio configuration. Cannot select a new Workspace in same Project" | `-w` switches workspace *within* an already-imported project; a **fresh** folder (no `.aio`) has nothing to switch within | First bind uses the **global** context: `aio console project select <id>` → `aio console workspace select <id>` → `aio app use -g --no-input`. (Or `aio app use <downloaded-config>.json`.) `--no-input` = `--no-service-sync` + `--merge`. |

## Deploy — `appbuilder-workfront`, `workfront-actions`

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid or missing property "runtime"` (also fires on `__secured_<action>`) | The action manifest has no runtime kind | Add `runtime: nodejs:20` to **every** action |
| Deploy conflicts / `.env` seems locked | `aio app dev` is running (it locks `.env`) | Stop the dev server before `aio app deploy` |
| After editing `ext.config.yaml`: `require-adobe-auth`/`final` ignored, `apiKey` value corrupted | `annotations:` got appended to the last `inputs:` line (wrong indent) — it's swallowed into the apiKey value and `require-adobe-auth`/`final` then parse as **inputs**, not annotations | Put `annotations:` on its **own line**, indented as a sibling of `inputs:`/`function:`/`runtime:`; keep `require-adobe-auth`/`final` nested under it. Validate with a quick `aio app build`. |

## Registration & the Main Menu — `workfront-ui-extension`, `workfront-local-testing`

| Symptom | Cause | Fix |
|---|---|---|
| **Item shows in the layout-template picker but NOT in the live Main Menu** | `id: extensionId` isn't **under `methods`**, or `extensionId` is `''` — Workfront can't identify the guest, so it calls `getItems` but drops the item | Set a non-empty `extensionId` in `Constants.js` **and keep `id: extensionId` inside `methods`**. ⭐ Check this **before** blaming the environment — it's the usual cause. |
| The view opens but **spins forever** / `attach()` never resolves | Opened via a raw URL (no Workfront host to hand off `sharedContext`), or the `id` problem above | Open via the **menu button** (not a deep link); fix the `id`; give `attach()` a timeout so it fails with a message instead of hanging |
| Data never loads; token/host empty in the action | Wrong `sharedContext` keys | Token = `sharedContext.get('auth').imsToken`; host = `get('hostname')` — **not** a top-level `imsToken`/`instanceUrl` |
| Console shows `getItems` called **and** `…/jumpseat/…/configuration 503` / "multiple done events", but the item still won't render | The Workfront **environment** (shell/nav) is unhealthy — *only* after you've ruled out the `id` cause above | Retry later, or use a healthy instance |
| Extension is registered **and** Enabled in Extension Manager, but still doesn't show up in the Main Menu | Enabling a BYO extension only makes it *available* — it still has to be **placed** in a layout template's Main Menu | Setup → Interface → Layout Templates → open the template assigned to your user (prefer your **own** personal template over a shared one) → **Set Main Menu** → find your app's tile (`+` = not yet added, click to toggle) → Done → **Save and close** (see `workfront-local-testing`) |

## Actions & the Planning API — `workfront-actions`

> **The Planning endpoints and response shapes in this table are known-good snapshots — confirm them against the live Workfront MCP** (the source of truth for Planning v2 resources) before relying on them. If the Workfront MCP isn't connected, tell the user to connect it first.

| Symptom | Cause | Fix |
|---|---|---|
| `401 "Org Id undefined is not in the list of user org Ids"` | The SPA sent an **empty** `x-gw-ims-org-id`; Fetch coerces `undefined` to the string `"undefined"`, which is forwarded as the org id | Read the org from `sharedContext.get('auth').imsOrgID` (capital ID) and pass it; only set the header when a real value exists; the action rejects `"undefined"`/empty |
| `cannot validate token` / 401 before your code runs | `require-adobe-auth: true` but no valid IMS token + `x-gw-ims-org-id` header was sent | Send valid headers, or set `require-adobe-auth: false` when the downstream API does its own authorization |
| Action can't read a secret/API key once deployed | Reading `process.env` at runtime (empty when deployed) | Flow `.env → action inputs → params`; read from `params` |
| Where do I get the IMS org id? | It's in `sharedContext` under a **capital-ID** key | `sharedContext.get('auth').imsOrgID` (not `imsOrgId`/`imsOrg`). It's *not* in the IMS token, and a `currentUser` fetch from the SPA is CORS-blocked. |
| Planning data won't load / `404` / response shape looks wrong | You called the **classic** Public API (`/attask/api/v21.0`) for **Planning** data | Planning is a **separate** API: `https://{host}/maestro/api/v2/…` (resources: `workspaces`, `record-types`, `records`, `views`) — target **v2**. Workspaces/record-types are **cursor-paged**; record search is **page-based** (`page`/`size`). Confirmed: `GET /workspaces?limit=50&cursor=` → `{content,cursor}`, `GET /workspaces/{id}`. |
| Planning returns `401`/`403` even with a bearer token | Planning is **OAuth2** — `apiKey`/`sessionID`/`/login` are **not supported**; or the org header is empty | Forward the user's IMS **Bearer** token + a non-empty `x-gw-ims-org-id`. If still 401/403, set `x-api-key` from `$SERVICE_API_KEY` (Stage workspace credential client id). |
| Action crashes at runtime with a missing `@typespec/*` module | `require('@adobe/aio-sdk')` pulls a broken transitive dep | Don't use aio-sdk in actions; use plain `console` + global `fetch` (Node 20). |
| Which env/host am I even building against? | Assumed instead of asked | **Always ask the customer for environment (stage/prod) + host first.** Thread the host into `https://{host}/maestro/api/v2` and set `AIO_CLI_ENV=stage` (+ logout/login) for stage. |
| A long/large request from the SPA **times out** (~60 s) | The `actionWebInvoke` path is a web action, bound by the **60 s cap** (limits table: `appbuilder-action-scaffolder`) | Page/chunk Workfront **search** + **bulk** work across calls (`workfront-actions`); check `aio app logs`. If the activation is *fast*, suspect **CDN/static load, cold start, or downstream API** — not the action budget |

## Testing & distribution — `workfront-local-testing`, `appbuilder-workfront`

| You want to… | Use | Notes |
|---|---|---|
| Preview a **local** build in Workfront | `extensionOverride` localStorage = `https://localhost:<port>` | **Local dev only** — accept the localhost cert; disable the Chrome 142+ Local Network Access flag. **Don't use `extensionOverride` for a *deployed* build** — register that via BYO (next row). |
| Use a **deployed** app **without publishing** | Extension Manager → **Bring Your Own extension** (Extension Url = deployed `index.html`, + name, description, email), **then add its Main Menu item to a layout template** | **Enable the toggle** (defaults *Disabled*). The item only renders where a **layout template** places it — add it and apply the template to the user/team. No approval needed. |
| Make it available **org-wide** | **Publish** — submit + approve from the **Production** workspace | Gated approval step |

| Symptom | Cause | Fix |
|---|---|---|
| Registered a BYO extension but nothing appears | It defaults to **Disabled** | Toggle it on under *Installed Extensions* |
| `…/custom-applications/<app>/<app>` URL is blank / spins forever | You repeated the app id as the **second** path segment — that's not a menu route, so it loads the background **registration frame** | The deployed app's real URL is `…/workfront/custom-applications/<extensionId>/<menuRoute>` (2nd segment = the menu item's `#/route`, **not** the app id) — that's where the menu button lands; assemble it per `workfront-local-testing` |
| Need to hand over the **deployed app's link** after `aio app deploy` | `deploy` prints the CDN URL but not the shell link | Build `…/#/@<org>/so:<instance>/workfront/custom-applications/<extensionId>/<menuRoute>`: copy `@<org>`/`so:<instance>` from a Workfront page the user's on, take `<extensionId>`/`<menuRoute>` from the app — full recipe in `workfront-local-testing` |

## The two-halves security model — don't break it (`appbuilder-workfront`, `workfront-actions`)

- Auth comes from `sharedContext`; the browser never holds credentials, and you never build a custom login.
- **Data** goes through Runtime actions (`actionWebInvoke`) — never a direct SPA→Workfront call (it's CORS-blocked anyway). Auth + org come from `sharedContext` (`auth.imsToken`, `auth.imsOrgID`), not a WF call.
- Actions are **CommonJS**, return `{ data, error }`, get secrets via **inputs** (not `process.env`), and declare a `runtime` kind.
- `require-adobe-auth` is a per-action choice (off by default) — on when the action is the security boundary, off when the downstream API authorizes.
