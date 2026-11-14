# Building & shipping Workfront App Builder extensions with these skills

A practical guide to **driving an AI agent** (Claude Code, Cursor, etc.) with the `app-builder`
plugin to go from nothing to a live Workfront UI extension: **set up the `aio` CLI → build a brand-new
project (or migrate existing code) → deploy to App Builder infrastructure → publish**.

This doc is for the person *using* the skills in their harness. It explains where to start, how to
phrase the conversation, what the AI will ask you, and what to watch for. The skills themselves are the
source of truth for *how* each step is done — this is the map that connects them.

> **New here? You don't write code, and you don't read the skills.** You describe what you want in plain
> English and the AI follows the expert instructions behind the scenes. First-time setup is a one-time
> ~10 minutes. Not comfortable in a terminal? Paste any command below **to the AI** and say *"run this for
> me"* — it'll run it and explain what happened. A **"skill"** is just a checklist of expert know-how for
> one job; once installed, the AI reaches for the right one automatically — you never have to pick.

---

## 1. What you're building (mental model)

A Workfront extension is an **App Builder app** with two halves:

- **Front end** — a React/Spectrum single-page app (SPA) embedded into Workfront at **extension points**
  (a Main Menu button, an object's left panel, or a custom-form widget).
- **Back end** — **Runtime actions** (serverless functions on Adobe I/O Runtime) that hold credentials and
  call Workfront / Planning / Adobe APIs. **The browser never calls those APIs directly.**

Keep this two-halves picture in mind — most of the "what should I ask the AI" and "what to watch for"
below follows from it.

---

## 2. Prerequisites (have these before you start)

The AI can install tooling and create the Console project for you, but it **cannot** grant you access.
Make sure you have:

- **App Builder access with the Developer role.** Your Adobe admin must grant you the **Developer** role in
  the **Admin Console** (`https://adminconsole.adobe.com` → Users → Developers) and an **App Builder
  license**, scoped to the org/**environment** (stage or prod) you're targeting — this is what unlocks the
  Developer Console so the project can be created. Without it, setup stalls: an empty org list, or a missing
  *"Create project from template"* option (see §12). Not sure if you have it? Ask your Adobe admin.
- An **IMS-enabled Workfront** account on that environment.
- A decision on **which environment** (stage vs prod) and **which Workfront instance/host** you're targeting.
- **Node 20** available (the AI will walk you through installing it via `nvm` if not).
- **git** installed, and ideally a **remote repo** (GitHub/GitLab) ready for your project — see §6.

If any of these are missing the AI will hit a wall it can't pass (e.g. an empty org list, or a "create
project from template" option that isn't there) — see §12 (When you get stuck).

---

## 3. Get the skills and connect them to your harness

These skills are open-source in the **[`adobe/skills`](https://github.com/adobe/skills)** repo. Most
harnesses fetch them for you (below); you only need a **local clone** for the Cursor install, or to browse
or develop the skills yourself:

```
git clone https://github.com/adobe/skills.git
```

Install the plugin once; after that the skills **activate automatically** based on what you ask — you do
not load them by hand.

**Claude Code** (fetches from GitHub — no clone needed):
```
/plugin marketplace add adobe/skills
/plugin install app-builder@adobe-skills
```
Confirm with `/plugin` → **Installed → app-builder** — you should see **10 skills** (`appbuilder-*` plus
the `appbuilder-workfront` umbrella and its `workfront-*` sub-skills). For local development against a
checkout, point the marketplace at the clone instead: `/plugin marketplace add /path/to/skills`, then
`/plugin marketplace update adobe-skills` + `/reload-plugins` after edits.

**Cursor** (needs the clone above):
```
mkdir -p ~/.cursor/plugins/local/app-builder
cp -R plugins/app-builder/. ~/.cursor/plugins/local/app-builder/
# Cursor: Cmd+Shift+P → Developer: Reload Window
```

**Other harnesses:** `npx skills add adobe/skills --all`, or `gh upskill adobe/skills --all`.

**How activation works:** describe your task in plain language and the matching skill's instructions load
into the turn. You don't have to name skills — but you *can* ("help me set up the aio CLI") to steer. The
skills also cross-reference each other, so the agent hands off between them as your task moves from setup
to build to deploy.

**Check it worked.** In a fresh session, ask *"Which Workfront App Builder skills do you have?"* — you
should see `appbuilder-workfront` plus the `workfront-*` and `appbuilder-*` skills listed. Don't see them?
Reopen the app (or run `/reload-plugins`) and ask again.

---

## 4. The start point

- **New to this, or not sure which step you're on?** Start at the **umbrella**. Just say what you want to
  build; the `appbuilder-workfront` skill maps the whole journey and routes each stage to the right
  sub-skill. This is the recommended entry point.
- **You already know the step?** Go straight at it — e.g. "how do I return errors from a Workfront action"
  triggers `workfront-actions` directly.

You don't invoke skills by path or filename — you describe intent. The messages in **Example prompts**
(below) are good openers.

---

## 5. The journey (which skill owns each stage)

| Stage | What happens | Skill |
|-------|--------------|-------|
| **0. Orient** | Map the journey, decide the path | `appbuilder-workfront` (umbrella) |
| **1. Set up + create project** | Node 20, install `@adobe/aio-cli`, `aio login`, pick IMS org, stage vs prod, create the Console project/workspace | `appbuilder-project-init` |
| **2a. Scaffold (new)** | `aio app init` with template `@adobe/workfront-ui-ext-tpl`, pick extension points | `appbuilder-project-init` (+ command catalog in `appbuilder-workfront`) |
| **2b. Migrate (existing)** | Scaffold the target, then port/adapt existing code into it | `appbuilder-project-init` + the build skills below |
| **3. Build front end** | Extension points, routing, shared context, `actionWebInvoke` | `workfront-ui-extension` (generic Spectrum patterns: `appbuilder-ui-scaffolder`) |
| **4. Build back end** | Action anatomy, `{data,error}`, IMS passthrough, Workfront Public API v21 | `workfront-actions` (generic templates/SDKs: `appbuilder-action-scaffolder`) |
| **5. Test in Workfront** | `aio app dev`, then `extensionOverride` (local) or Extension Manager BYO (deployed) | `workfront-local-testing` |
| **6. Unit / E2E tests** | Jest / Playwright | `appbuilder-testing` / `appbuilder-e2e-testing` |
| **7. Deploy** | `aio app deploy` → actions to Runtime, SPA to CDN | `appbuilder-workfront` (commands) / `appbuilder-project-init` |
| **8. CI/CD** | GitHub Actions / Azure DevOps / GitLab pipelines | `appbuilder-cicd-pipeline` |
| **9. Publish org-wide** | Submit for approval from the **Production** workspace | `appbuilder-workfront` (umbrella) |

---

## 6. Keep your project under version control

You'll **build and maintain your extension by talking to these skills** — but the skills operate on files
on your machine, so treat your project like any other codebase: put it in **git** and push it to a
**remote** (GitHub, GitLab, Adobe's internal GitLab, …) so you never lose work and can review exactly what
the agent changed.

Do this right after scaffolding (Path A step 3, or once you've ported the first pieces in Path B):

```bash
cd my-workfront-ext
git init
git add -A && git commit -m "chore: scaffold Workfront extension"
git remote add origin <your-remote-url>
git push -u origin main
```

Then iterate in **small commits** — a commit per working change makes it easy to see, review, and undo
what the AI did. This is your safety net: the skills edit files in place, so version control is how you
avoid losing code.

**Never commit secrets.** The scaffold gitignores them, but confirm `.env`, `console.json`, and `.aio` are
in `.gitignore` — they hold Runtime credentials and IMS tokens. (`.env` is also locked while `aio app dev`
runs.)

**This also unlocks CI/CD.** Once the code is on a remote, `appbuilder-cicd-pipeline` can generate a
GitHub Actions / Azure DevOps / GitLab pipeline that builds and deploys on push (stage → prod), using an
**OAuth Server-to-Server** credential instead of interactive login — *"set up a CI/CD pipeline to deploy my
App Builder app on push."*

> This is **your project's** repo — separate from the `adobe/skills` repo the skills come from. You never
> fork or push to `adobe/skills` to *use* the skills; you keep your own extension in your own remote.

---

## 7. Path A — a brand-new project

1. **Orient / set expectations.** *"I want to build a Workfront UI extension on App Builder — walk me
   through the whole process."* → the umbrella lays out the steps and confirms your target env/instance.
2. **Set up + create the project.** *"Set up my machine and create the App Builder project."* → installs
   Node 20 / `aio`, logs you in, selects the IMS org, and creates the Console project + workspace.
3. **Scaffold**, then **put it in git and push** (§6). *"Scaffold the extension with a Main Menu button and
   a left-panel item on Projects."* → runs `aio app init` with `@adobe/workfront-ui-ext-tpl`.
4. **Build the front end**, then **the actions** (see Example prompts below).
5. **Run + test in Workfront** with `extensionOverride`.
6. **Deploy**, then **publish** when ready.

---

## 8. Path B — migrate existing code

There is no separate "migration" skill — you **scaffold the target structure and adapt your code into it**
using the same build skills. Two common cases:

- **You already have an App Builder project** (maybe an older or non-Workfront one): tell the AI so it
  points the CLI at your workspace (`aio app use`), aligns the config/template, and helps you re-register
  the pieces as Workfront extension points. *"I have an existing App Builder app — help me turn it into a
  Workfront extension."*
- **You have code that isn't App Builder yet** (a standalone React tool, scripts, API calls): scaffold a
  fresh Workfront extension, then move the **UI into the SPA** (`workfront-ui-extension`) and the
  **server-side logic into Runtime actions** (`workfront-actions`) — this is where most of the adapting
  happens, because actions must be **CommonJS**, return `{data,error}`, and read secrets from `params`
  (not `process.env`), and the browser must stop calling external APIs directly.

**Commit before you start migrating** (import the old code into git first), so every adaptation the AI
makes is a reviewable diff. Migration prompts: *"Port this Express handler into a Workfront Runtime
action"*, *"Move this fetch call out of my React component into an action and call it with
actionWebInvoke"*, *"My old code reads `process.env.API_KEY` — how do I wire that as an action input?"*

**Watch for:** ES-module → CommonJS conversion, direct browser API calls that must move server-side,
hardcoded hostnames/tokens, and Node-version drift. The AI will flag these, but knowing them speeds things up.

---

## 9. Example prompts (copy, adapt)

**Setup**
- "What Node version do I need and how do I install and log in to the aio CLI?"
- "Switch my CLI to the stage environment."
- "Right after installing `aio`, every command exits with `ERR_REQUIRE_ESM` — fix it."

**Scaffold**
- "Create the App Builder project and scaffold a Workfront extension with a Main Menu button."
- "Which `aio app init` template should I use for a Workfront extension?" *(answer: `@adobe/workfront-ui-ext-tpl`)*

**Front end**
- "Register a left-panel item that only shows on Project pages."
- "My Main Menu item registers but never renders — what's wrong?" *(the `extensionId` / `methods` trap)*
- "Read the current user and IMS token and pass them to my action."
- "Embed my app as a custom-form widget with a fixed height."

**Back end / Workfront API**
- "How should my action return success vs failure to the SPA?"
- "Bulk-update 500 Workfront tasks and filter a search on a custom DE field."
- "Should I enable `require-adobe-auth` on this action?"

**Test / deploy / publish**
- "My local extension isn't showing in Workfront even though `aio app dev` is running."
- "Test my deployed stage app in Workfront without publishing it."
- "Deploy the app, then walk me through publishing it org-wide."
- "Set up a CI/CD pipeline to deploy my App Builder app on push."

---

## 10. Questions the AI will ask you (have answers ready)

Because these decisions can't be guessed safely, expect to be asked:

- **Environment & instance:** stage or prod? which Workfront host/instance URL? *(sets `AIO_CLI_ENV`, which
  Console you use, and the API host your actions call — the wrong choice wastes the whole setup.)*
- **IMS org:** which Adobe organization? *(wrong-org is the most common setup mistake.)*
- **Console state:** do a project + workspace already exist, or should it create them?
- **Extension points:** Main Menu button? a left-panel item on which object type(s) — Project / Task /
  Issue / Portfolio / Program? a custom-form widget?
- **APIs / services:** which services do your actions need, and do any require a **product profile**?
- **New vs migrate:** brand-new, or adapting existing code?
- **Feature intent:** labels, which object types, what the action should do.

Answer concretely (real org id, host, object types). If you don't know, say so — the AI will suggest a
sensible default and state the assumption.

---

## 11. What to pay attention to (the invariants that bite)

You don't need to memorize these — the skills enforce them and the AI flags problems as they come up.
They're listed so you *recognize* them if they do:

- **The browser never calls Workfront/Adobe APIs directly.** All data goes through a Runtime action via
  `actionWebInvoke`, so tokens stay server-side. A `fetch('…/attask/api/…')` in the SPA is wrong (and
  CORS-blocked anyway).
- **Auth comes from the shared context** (`imsToken`, hostname, `auth.imsOrgID`) — never build a custom
  login. Note the casing: `imsOrgID` (capital ID). An empty value becomes the string `"undefined"` →
  `401 Org Id undefined`.
- **Actions are CommonJS** (`exports.main`), return **`{ data, error }`**, and read secrets from **`params`**
  — inputs flow `.env → config inputs → params`, **never `process.env`** at runtime (it's empty once deployed).
- **Node 20.** Default environment is **prod**; stage needs `AIO_CLI_ENV=stage` **plus a logout/login**.
- **Main Menu not rendering?** `extensionId` must be non-empty *and* `id: extensionId` must stay **inside
  `methods`** — otherwise it registers but silently never shows.
- **Workfront Public API is v21.0.** Custom `DE:` fields need `{field}_Mod=notblank`; bulk `PUT ?updates=[…]`
  must be **chunked** for the ~8 KB URL limit.
- **Workfront Planning work needs the Workfront MCP connected.** If your extension reads or writes **Planning**
  (workspaces, record types, records), the AI gets Planning's API details and data **only** from the
  **Workfront MCP** — so it must be connected in your harness. If it isn't, the AI will stop and ask you to
  connect it rather than guessing endpoints. (This applies to Planning only; the v21 Public API above does not
  need it.)
- **Local testing:** set `extensionOverride` in the Workfront tab's Local Storage, accept the localhost cert,
  and (Chrome 142+) disable `chrome://flags/#local-network-access-check`.
- **`require-adobe-auth` is per-action and off by default** — turn it on only when the action is the security
  boundary.
- **Publishing** is org-wide and needs approval; submit from the **Production** workspace, and make sure
  Production has every API/service your actions use. To share a build in one org *without* approval, use
  **Extension Manager → Bring Your Own extension** instead.
- **The deployed app's direct link** is the Experience Cloud shell URL
  `…/#/@<org>/so:<instance>/workfront/custom-applications/<extensionId>/<menuRoute>` — *not* the bare CDN.
  After `aio app deploy`, hand it over: copy `@<org>`/`so:<instance>` from a Workfront page you're on, and
  take `<extensionId>`/`<menuRoute>` from the app (recipe in `workfront-local-testing`).
- **Actions are time-boxed:** the `actionWebInvoke` path is a web action bound by the **60 s cap** — chunk
  large search/bulk work across calls. A user-facing timeout might be the action budget, or a CDN / cold
  start / downstream issue (full limits in `appbuilder-action-scaffolder`).
- **Never hardcode** the Workfront hostname, instance URL, or Runtime action URLs — they come from the
  shared context / injected config.
- **Never commit secrets** — keep `.env`, `console.json`, `.aio` gitignored (§6).

---

## 12. When you get stuck

- **Symptom → cause → fix** for the whole journey: `skills/appbuilder-workfront/references/troubleshooting.md`.
- **`aio` command catalog:** `skills/appbuilder-workfront/references/commands.md`.
- Setup/init failures (ERR_REQUIRE_ESM, empty org list, `451 accept developer terms`, template issues):
  the Troubleshooting section of `appbuilder-project-init`.

Start the conversation at the **`appbuilder-workfront`** umbrella and let it route you — that's the shortest
path from "I have an idea" to "it's live in Workfront."
