# Content Hub Extension Scaffolding — Full Workflow

Complete step-by-step workflow for scaffolding a **Content Hub** App Builder extension (`aem/assets/contenthub/1`) from scratch: Console setup, namespace selection, file generation, npm install, build, dev server, cert acceptance, and deploy.

Read this file when `appbuilder-project-init` is asked to create/scaffold a Content Hub extension.

> **When to use this:** the user wants to create a NEW Content Hub extension — tab panels in Asset Details, card/collection-tile action buttons, bulk-action-bar buttons, or Add Assets wizard panels. This drives the whole lifecycle from one prompt to a running, open browser tab. If the user already has a scaffolded project and only wants to customize the UI, use `appbuilder-ui-scaffolder` (§ Content Hub in `references/aem-extensions.md`) instead.

**Fixed facts for this surface** (used by every step below):

| | Value |
| --- | --- |
| Extension point | `aem/assets/contenthub/1` |
| Source dir | `src/aem-assets-contenthub-1/` |
| SDK | `@adobe/uix-guest` |
| Templates | [`references/contenthub-templates.md`](contenthub-templates.md) |
| Namespaces | `assetDetails` (tab panels), `card` (asset-card + collection-tile buttons), `selectionBar` (bulk-action bar), `addAssets` (wizard panels + `beforeUpload`/`onUploadComplete` hooks) |
| Local dev open URL | `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/` |

Use `AskUserQuestion` for every user decision. Never print a test URL without opening it. Never ask the user to type anything (except when they choose "Other").

---

## Interaction Rules (how to ask, decline, and resume)

**1. Always use `AskUserQuestion` for choices.** Never print a numbered list and ask the user to type a number. The only typing the user does is selecting "Other".

**2. Every option states what it does — never bare "Yes"/"No".** Give each option a `label` naming the action and a `description` spelling out the consequence (e.g. `label: "Yes — install the aio CLI now"`, `description: "Runs npm install -g @adobe/aio-cli, ~30s"`). The decline option must say what happens instead.

**3. Declining must never dead-end.** When the user declines, reply with (a) a one-line confirmation of what was skipped, (b) the exact command/action to run, and (c) how to resume — tell them to type **`continue`** and which step you'll pick up from.

**4. ALL file writes are fully automatic — no confirmation, ever.** Every `Write`/`Edit`/`Bash mkdir` in this flow is silent and automatic. Do NOT ask "Ready to scaffold?", "Should I create this file?", or announce each file. Just write them all. The only `AskUserQuestion` calls are genuine decisions (name, namespaces, workspace, output dir, install/login/deploy).

**5. If interrupted mid-run, tell the user how to resume.** End with what completed, what's pending, and that typing **`continue`** resumes from the next step (state the step number).

**6. When a Bash command is denied at the permission prompt, never silently halt.** Reply with which command was blocked, why it's needed, and that they can approve it (picking "Yes, and don't ask again" avoids future prompts for routine `mkdir`/`npm`/`aio` commands) or run it themselves and type **`continue`**.

---

## Full Workflow

### Step 1 — Extension Name

Use `AskUserQuestion`. Suggest Content Hub-appropriate names:

```
question: "What should we name your extension?"
options:
  - label: "asset-metadata-panel"
  - label: "asset-card-actions"
  - label: "asset-bulk-export"
```

The user can select "Other" to type their own kebab-case name. Store as `extensionName`. Validate kebab-case (lowercase letters + hyphens only); if invalid (e.g. `My Extension`), suggest the corrected form (`my-extension`) via another `AskUserQuestion`.

### Step 2 — Choose Content Hub namespace(s)

**Auto-select rule:** if the prompt already names a namespace, do NOT ask — auto-select and skip to Step 3:
- "asset card" / "card action" / "buttons on cards" → `["card"]`
- "asset details panel" / "tab panel in asset details" → `["assetDetails"]`
- "bulk action" / "selection bar" → `["selectionBar"]`
- "Add Assets wizard" / "before upload hook" / "hydration panel" → `["addAssets"]`
- "card and bulk actions" → `["card", "selectionBar"]`

**Only ask when the prompt is generic** ("create a Content Hub extension" with no namespace hint). Use `AskUserQuestion` with `multiSelect: true`:

```
question: "Which Content Hub surfaces do you want to extend?" (multiSelect: true)
options:
  - label: "Asset Details panel"
    description: "Custom tab panels in the Asset Details Dialog side rail — assetDetails namespace"
  - label: "Asset card / collection tile action"
    description: "Buttons on asset card menus (Assets grid, inside a collection, link share) and on collection tiles — card namespace. onActionClick(resourceType, buttonId, resourceId, actionContext)."
  - label: "Selection bar (bulk action)"
    description: "Buttons in the bulk-action bar shown when assets are selected — selectionBar namespace. onActionClick(buttonId, assetIds[])."
  - label: "Add Assets wizard"
    description: "Panels before/after the Upload step, gate/enrich metadata (beforeUpload), react after upload (onUploadComplete) — addAssets namespace."
```

Store the selected keys as `namespaces` (at least one). Notes: `card`/`selectionBar` open a modal on click via `host.modal.openDialog()`, so `ExtensionRegistration.js` uses `let guestConnection` (not `const`). `addAssets` panels use `postMessage` for step readiness — never call `openDialog` from a wizard panel. Step 10 uses `namespaces` to decide which component files to write.

### Step 3 — Workspace

```
question: "Which workspace should this extension use?"
options:
  - label: "Stage"      description: "For development and testing — recommended to start here"
  - label: "Production" description: "For final release"
```

Store as `workspace`.

### Step 4 — Output Directory

```
question: "Where should the project be created?"
options:
  - label: "~/Desktop/<extensionName>"   description: "Create on your Desktop (recommended)"
  - label: "~/Documents/<extensionName>" description: "Create in your Documents folder"
```

Resolve `outputPath` to an absolute path (e.g. `$HOME/Desktop/<extensionName>`).

### Step 5 — Check aio CLI Installed

```bash
aio --version 2>/dev/null
```

- **Installed:** continue.
- **Not installed:** `AskUserQuestion` — "Yes — install it now" (`npm install -g @adobe/aio-cli`) or "No — I'll install it myself" (print the command, pause, resume on `continue`).

### Step 6 — Check Login AND Validate the Token

`aio where` alone is NOT sufficient — a token can look logged-in yet be rejected server-side with `401 ... ErrInvalidOauthToken`. This is the #1 cause of "401 on everything" — a **stale token**, not a restricted org. The only fix is `aio login --force`.

**6a — Context check (fast, no browser):**
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio where 2>/dev/null
```
If empty or "not logged": run login in a subshell with the flags **unset** (`env VAR=` is not enough — must `unset`):
```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login'
```
The browser opens; wait up to 3 minutes for exit 0. Do NOT ask permission.

**6b — Token-validity probe:** even if context looked fine, make one real Console API call:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console org list --json 2>&1 | head -c 400
```
- Returns a JSON array of orgs → token valid. Cache the org list for Step 7.
- Contains `401`/`Unauthorized`/`ErrInvalidOauthToken` → stale token. Refresh **without asking** (the user authorized the flow by running the skill):
  ```bash
  bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'
  ```
  Wait for exit 0, re-run the probe to confirm it returns orgs.

**Critical:** never run `aio login`/`login --force` with `CI`, `AIO_CLI_NO_TTY`, or `TERM=dumb` set — those suppress the browser and login silently fails.

### Step 7 — Resolve Org

Use the cached org list from 6b (or re-run `aio console org list --json`).
- **One org:** auto-select `aio console org select <orgId>`, store `activeOrgId`.
- **Multiple:** `AskUserQuestion` (label = org name, description = orgId; mark the current one). Then `aio console org select <orgId>`.
- **Zero:** broken token — `aio login --force`, retry.

### Step 8 — Resolve Project

```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project list --json 2>/dev/null
```
- **Empty:** auto-create `aio console project create -n <alphanumericName> --json`, select it, `isNewProject = true`.
- **Projects exist:** always `AskUserQuestion` (one option per project + "Create a new project"). Never auto-select an existing project. On select: `aio console project select <projectId>`. On create: ask for an alphanumeric name (no hyphens), create, select.
- If `create` errors "already exists": list, select the match.
- If `project list` returns 401 here: stale token mid-flow — `aio login --force`, retry (never fall back to `aio where` values).

Store `activeProjectId`, `activeProjectName`, `isNewProject`.

### Step 9 — Select Workspace + I/O Runtime note

```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console workspace select <workspace>
```
**Do NOT run `aio console workspace service add`** — that subcommand does not exist in current aio CLI and isn't needed: every App Builder workspace gets an I/O Runtime namespace automatically, and `aio app use` (Step 12) downloads the creds into `.env`. The #1 reason `.env` comes back empty is a stale token, not a missing entitlement.

If `isNewProject = false`, create the workspace if missing:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console workspace list --projectName <projectName> --json 2>/dev/null
# if <workspace> not present:
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console workspace create --projectName <projectName> --name <workspace> --json 2>/dev/null
```

### Step 10 — Scaffold Project Files

**FULLY AUTOMATIC — start writing immediately, zero questions.** Say "Scaffolding project files to `<outputPath>`..." then `mkdir` + `Write` every file in one uninterrupted sequence.

```bash
mkdir -p <outputPath>/src/aem-assets-contenthub-1/web-src/src/components
mkdir -p <outputPath>/src/aem-assets-contenthub-1/actions/generic
mkdir -p <outputPath>/hooks
```

Read [`references/contenthub-templates.md`](contenthub-templates.md) and write all scaffold files, substituting `{{EXTENSION_NAME}}`, `{{DISPLAY_NAME}}`, `{{EXTENSION_DESCRIPTION}}`:

- `package.json`, `app.config.yaml`, `src/aem-assets-contenthub-1/ext.config.yaml`, `extension-manifest.json`, `.eslintrc.js`, `hooks/post-deploy.js`
- `src/aem-assets-contenthub-1/web-src/index.html`, `web-src/src/index.js`, `index.css`, `config.json`
- `web-src/src/components/Constants.js`, `App.js`, `ExtensionRegistration.js`
- `src/aem-assets-contenthub-1/actions/utils.js`, `actions/generic/index.js`
- Namespace components — write **only** for namespaces selected in Step 2: `TabPanel.js` (assetDetails), `CardActionModal.js` (card), `SelectionBarModal.js` (selectionBar), `AddAssetsPanel.js` (addAssets)

Keep `App.js` routes and the `ExtensionRegistration.js` `methods` object limited to the selected namespaces.

### Step 11 — npm install

```bash
cd <outputPath>
npm install
```
If E401 (registry auth): `npm install --registry https://registry.npmjs.org`.

### Step 12 — Wire to Workspace (`aio app use`)

**Must run in a subshell with CI/AIO_CLI_NO_TTY unset**, or credential download is silently skipped and `.env` stays empty → 401 on build/deploy:
```bash
cd <outputPath>
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use -w <workspace> --overwrite --no-input'
```
If non-zero:
```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w <workspace> --overwrite'
```
Check `.env`:
```bash
node -e "const fs=require('fs');try{const c=fs.readFileSync('<outputPath>/.env','utf8');console.log(/AIO_RUNTIME_NAMESPACE=\S+/.test(c)&&/AIO_RUNTIME_AUTH=\S+/.test(c)?'VALID':'INVALID')}catch(e){console.log('INVALID')}"
```
**If INVALID:** almost always a stale token — `aio login --force`, then re-run `aio app use`. Do NOT run `workspace service add`. Only if `.env` is still empty after a confirmed-fresh token is the workspace genuinely without Runtime (rare; UI still works, only actions unavailable).

### Step 13 — Build

```bash
cd <outputPath>
aio app build
```
If a config validation error: `aio app build --no-config-validation`, fix the YAML, rebuild without the flag.

### Step 14 — Start Dev Server

Free port 9080 if taken (the user authorized the flow — don't ask):
```bash
lsof -ti:9080   # if a PID: kill <pid> 2>/dev/null; sleep 2   (kill -9 if still held)
```
Start in background with `PORT=9080` explicitly, poll the log for the localhost URL:
```bash
cd <outputPath>
PORT=9080 aio app run > /tmp/aio-run-<extensionName>.log 2>&1 &
for i in $(seq 1 60); do grep -qE "https?://localhost:[0-9]+" /tmp/aio-run-<extensionName>.log 2>/dev/null && break; sleep 2; done
cat /tmp/aio-run-<extensionName>.log
```
- URL appears → proceed to Step 15.
- 120s with no URL → `AskUserQuestion`: "Yes — rebuild and retry" (re-run build then the run loop) or "No — I'll start it manually" (print `cd <outputPath> && PORT=9080 aio app run`, resume on `continue` from Step 15).

### Step 15 — Open Cert Page (after dev server URL confirmed)

```bash
open "https://localhost:9080"   # xdg-open on Linux, start "" on Windows
```
Then `AskUserQuestion`: "Done — open the extension" (proceed to Step 16) or "Reopen the cert page" (re-`open` and ask again). The panel stays blank until the self-signed cert is accepted (Advanced → Proceed to localhost, or type `thisisunsafe`).

### Step 16 — Open Content Hub Automatically

Only after "Done" — open via Bash, **never just print the URL**:
```bash
open "https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/"
```
Rules: **no `&repo=`** (the scaffold sets `allowedRepos = []`, so any repo works for local dev); **no `/index.html`** after `localhost:9080` (that's only for deployed CDN URLs).

### Step 17 — Ask About Deployment

The workspace was chosen in Step 3 — don't ask again. Just:
```
question: "Extension is running locally on <workspace>. Deploy it now?"
options:
  - label: "Yes — deploy to <workspace> now"   description: "Runs aio app deploy, then opens the deployed CDN test URL automatically"
  - label: "Not now — keep running locally"    description: "Stays on localhost:9080; type 'deploy' later to deploy from Step 17"
```
If "Yes": run the manual first-deploy now. In brief:
```bash
cd <outputPath>
aio app deploy 2>&1 | tee /tmp/aio-deploy-<extensionName>.log
```
Parse the `*.adobeio-static.net` CDN base from the log (regardless of exit code) and **open** the deployed test URL — never just print it:
```bash
open "https://experience.adobe.com/?devMode=true&ext=<CDN_BASE>/index.html#/assets/contenthub/"
```
**Partial failure is still success:** if web assets deployed but actions failed (no Runtime / 401), the UI still works — open the CDN URL and note actions are unavailable; don't treat it as blocking. If `workspace` is Production, after opening offer `AskUserQuestion` to open Extension Manager (`https://experience.adobe.com/aem/extension-manager`) for approval.

For the full deployment story — Stage → Production promotion, CDN URL parsing, Extension Manager approval, re-deploy after code changes, and automated CI/CD pipelines — hand off to the **`appbuilder-cicd-pipeline`** skill (see its `references/contenthub-deploy.md`).

**After Step 17 (deployed or local), ALWAYS print the "Where to edit" map** — filter rows to the namespaces selected in Step 2:

```
## Where to edit your extension
All UI files are under `src/aem-assets-contenthub-1/web-src/src/components/`

| What you want to change | File to edit |
|---|---|
| Which panels / buttons appear, their title, icon, or label | `ExtensionRegistration.js` |
| Asset Details panel content            | `TabPanel.js`          ← only if assetDetails selected |
| Card action modal content              | `CardActionModal.js`   ← only if card selected |
| Selection bar (bulk action) content    | `SelectionBarModal.js` ← only if selectionBar selected |
| Add Assets wizard panel content        | `AddAssetsPanel.js`    ← only if addAssets selected |
| Server-side logic / AEM API calls      | `actions/generic/index.js` |
```

Then: *"Let me know what you'd like to build and I'll make the changes."* (chains to `appbuilder-ui-scaffolder`).

---

## Failure Recovery

| Symptom | Action |
| --- | --- |
| `aio where` shows "not logged" | `bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login'` — don't ask, browser opens, wait for exit 0 |
| `aio console *` returns 401 / `ErrInvalidOauthToken` (even though `aio where` looks logged-in) | **Stale token, NOT a restricted org.** `aio login --force`, retry. Never fall back to `aio where` values. |
| `aio console project create` → "already exists" | List projects, select the match, continue |
| `aio console workspace create` → "already exists" | Skip, continue |
| `aio app use` exits non-zero | `bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use -w <workspace> --overwrite --no-input'` |
| `.env` missing `AIO_RUNTIME_NAMESPACE` | Usually a stale token — `aio login --force` then re-run `aio app use`. Do NOT run `workspace service add`. |
| `npm install` → E401 | `npm install --registry https://registry.npmjs.org` |
| `aio app build` → validation error | `aio app build --no-config-validation`; fix YAML; rebuild without flag |
| `aio app run` log never shows `localhost:9080` | Re-run `aio app build`; check `node -v` ≥ 18; read `/tmp/aio-run-<name>.log` |
| Panel blank in browser | Cert not accepted — `open https://localhost:9080` and ask again |
| Content Hub panel not visible | Check `allowedRepos` is empty; URL uses `#/assets/contenthub/`; `devMode=true` present; card/selectionBar require the `EXTENSIBILITY_AEM_CONTENTHUB` flag |
| Deploy: CDN URL not found in log | `cat /tmp/aio-deploy-<name>.log`; look for any `.adobeio-static.net` URL |

---

## Quality Checklist

- [ ] `app.config.yaml` uses `aem/assets/contenthub/1`
- [ ] Source directory is `src/aem-assets-contenthub-1/`
- [ ] `ExtensionRegistration.js` imports `register`, secondary pages import `attach`, both use the same `extensionId` from `Constants.js`
- [ ] `ExtensionRegistration.js` uses `let guestConnection` if `card` or `selectionBar` is selected
- [ ] Only the selected namespaces' components and routes exist
- [ ] `npm install` succeeded (Step 11)
- [ ] `aio app use` ran in a subshell with `unset CI AIO_CLI_NO_TTY TERM` (Step 12)
- [ ] `.env` has `AIO_RUNTIME_NAMESPACE` and `AIO_RUNTIME_AUTH`
- [ ] `aio app build` succeeded (Step 13)
- [ ] `PORT=9080 aio app run` is running and the log shows `localhost:9080` (Step 14)
- [ ] Cert page opened via `open` **after** the dev server URL was confirmed (Step 15)
- [ ] Content Hub opened via `open` (Bash), not just printed (Step 16)
