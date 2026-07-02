---
name: adobe-extension-scaffolder
description: >-
  End-to-end scaffold, develop, and deploy Adobe App Builder UI extensions for
  ANY supported surface — Content Hub (asset details panels, asset card actions,
  selection bar / bulk actions), Content Fragment Console, Content Fragment
  Editor, Universal Editor, Assets View, and Experience Cloud Shell SPAs.
  Handles the complete customer journey from zero: asks which surface, asks
  clarifying questions via MCQ options, bootstraps the Adobe Developer Console
  project and workspace, writes all scaffold files for the chosen surface,
  installs dependencies, builds, starts the local dev server, opens the
  certificate page, gates the test URL behind cert acceptance, and opens the
  target surface automatically. The shared Console/login/build/deploy core is
  identical across every surface; only Step 0 (surface choice), Step 10
  (scaffold), Step 16 (open URL), and Step 18 (customization) vary. Use whenever
  the user mentions a Content Hub extension, a Content Hub card action, a Content
  Hub bulk action, a Content Hub selection bar extension, an AEM UI extension
  (CF Console, CF Editor, Universal Editor, Assets View), an ExC Shell app,
  aem/assets/contenthub/1, or asks generically to "create an extension" / "build
  an Adobe extension" / "make an App Builder extension" without naming a surface
  — in that case it FIRST asks which surface (Step 0). Never just print a test
  URL — always open it via Bash after cert is accepted.
metadata:
  category: app-builder
license: Apache-2.0
compatibility: Requires aio CLI (`npm install -g @adobe/aio-cli`), Node.js 18+, npm.
allowed-tools: Bash(aio:*) Bash(npm:*) Bash(node:*) Bash(npx:*) Bash(mkdir:*) Bash(ls:*) Bash(grep:*) Bash(cat:*) Bash(sleep:*) Bash(open:*) Bash(lsof:*) Bash(kill:*) Read Write Edit
---
# Adobe App Builder Extension Skill (multi-surface)

Drives the complete lifecycle for an Adobe App Builder UI extension — from one prompt to a running, open browser tab — for **any** supported surface. Uses `AskUserQuestion` for every user decision. Never prints a test URL without opening it. Never asks the user to type anything.

> **Why this skill is generic.** ~80% of the work (login, token validation, org/project/workspace setup, npm install, `aio app use`, build, dev server, cert page, deploy) is **identical for every surface**. Only four things vary per surface: which surface to build (Step 0), the scaffold files (Step 10), the URL to open (Step 16), and the follow-up customization map (Step 18). All four are driven by a single **Surface Config** entry, so adding a new surface in the future means adding one config row + one template section — not rewriting the workflow. See [Adding a New Surface](#adding-a-new-surface).

---

## Surface Config (the heart of the generic design)

Step 0 picks a surface and loads its config into a `surfaceConfig` object. Every downstream step reads from it instead of hardcoding Content Hub values.

| `surfaceKey` | Surface | `extensionPointId` | `extDir` (`src/…`) | SDK | Templates | Available namespaces (Step 2) |
| --- | --- | --- | --- | --- | --- | --- |
| `content-hub` | Content Hub | `aem/assets/contenthub/1` | `aem-assets-contenthub-1` | `@adobe/uix-guest` | [`file-templates.md`](references/file-templates.md) | `assetDetails` (tab panels), `card` (per-asset card buttons), `selectionBar` (bulk action bar) |
| `cf-console` | Content Fragment Console | `aem/cf-console-admin/1` | `aem-cf-console-admin-1` | `@adobe/uix-guest` | [`aem-surface-templates.md` § CF Console](references/aem-surface-templates.md) | `actionBar`, `headerMenu`, `contentFragmentGrid` |
| `cf-editor` | Content Fragment Editor | `aem/cf-editor/1` | `aem-cf-editor-1` | `@adobe/uix-guest` | [`aem-surface-templates.md` § CF Editor](references/aem-surface-templates.md) | `headerMenu`, `rte` |
| `universal-editor` | Universal Editor | `aem/universal-editor/1` | `aem-universal-editor-1` | `@adobe/uix-guest` | [`aem-surface-templates.md` § Universal Editor](references/aem-surface-templates.md) | `headerMenu`, properties rail panel |
| `assets-view` | Assets View (Assets Ultimate license) | `aem/assets/1` | `aem-assets-1` | `@adobe/uix-guest` | [`aem-surface-templates.md` § Assets View](references/aem-surface-templates.md) | `actionBar`, `headerMenu` |
| `exc-shell` | Experience Cloud Shell SPA | `dx/excshell/1` | `dx-excshell-1` | `@adobe/exc-app` | [`excshell-templates.md`](references/excshell-templates.md) | n/a (standalone SPA, no extension points) |

**Open URLs (used in Step 16), keyed by `surfaceKey`:**

| `surfaceKey` | Local dev open URL |
| --- | --- |
| `content-hub` | `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/` |
| `cf-console` | `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080` → then navigate to **Content Fragments** |
| `cf-editor` | `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080` → open a fragment in the **CF Editor** |
| `universal-editor` | `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080` → open the **Universal Editor** |
| `assets-view` | `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080` → navigate to **Assets** |
| `exc-shell` | `https://localhost:9080` (the cert page IS the running SPA) — to embed in the shell, use `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080` |

The AEM extension surfaces (CF Console / Editor / UE / Assets View) all load through the **same `?ext=` extension tester base** — they differ only in which AEM app you navigate to after the shell opens. Only Content Hub has a stable deep-link hash (`#/assets/contenthub/`). Do not fabricate deep-link hashes for the other surfaces — open the tester base and tell the user where to navigate.

---

## What the skill does vs what the customer does

| Skill (automatic) | Customer (3 moments only) |
| --- | --- |
| Ask which surface + all questions via MCQ — no typing | Accept self-signed cert at `https://localhost:9080` (once per browser session) |
| CLI install check, login detection, org/project/workspace setup | Navigate to the target surface in the shell (AEM surfaces only) |
| Generate all scaffold files for the chosen surface | Approve in Extension Manager (Production deployments only) |
| npm install → aio app use → aio app build → aio app run | |
| Open cert page automatically after dev server starts | |
| Ask "Done?" then open the target surface automatically | |
| Ask about deployment via MCQ | |

---

## Interaction Rules (how to ask, decline, and resume)

These rules govern every user-facing moment in the workflow. They keep the flow moving and make sure the user is never left guessing what a choice means or what to do after declining.

**1. Always use `AskUserQuestion` for choices.** Every time a user needs to make a decision, use the `AskUserQuestion` tool with MCQ options. **Never print a numbered list and ask the user to type a number or name.** The user should never type anything except when they select "Other" in a question.

**2. Every option must state what it does — never bare "Yes"/"No".** A user should be able to pick an option without inferring its meaning. Always give each option a `label` that names the action *and* a `description` that spells out the consequence. Write `label: "Yes — install the aio CLI now"` / `description: "Runs npm install -g @adobe/aio-cli, ~30s"`, not `label: "Yes"`. The "No"/decline option must say what happens instead (e.g. "No — I'll install it myself; I'll print the command and pause").

**3. Declining must never dead-end — always give a next step.** Whenever the user picks the "No"/decline/"I'll do it myself" option in any question, do NOT just stop. Respond with: (a) a one-line confirmation of what was skipped, (b) the exact command or manual action they need to perform, and (c) how to resume — tell them to type **`continue`** (or re-run the skill) once they've done it, and state which step you'll pick up from. Example after declining the dev-server auto-start: *"No problem — start it yourself with `cd <path> && PORT=9080 aio app run`, then type `continue` and I'll open the cert page (Step 15)."* Never leave the user at a prompt with no idea what to do next.

**4. Scaffolding is fully automatic — no confirmation, no per-file questions, no permission prompts.** At Step 10, immediately write every scaffold file back-to-back without asking. Do NOT ask "Ready to scaffold?", "Should I create this file?", "OK to write this file?", or any variant — and do not pause to ask permission before each individual `Write`/`Bash mkdir` call. Just say "Scaffolding project files to `<outputPath>`..." once, then write everything in one continuous pass. The only questions in the whole flow are genuine decisions (surface, name, extension points, workspace, output dir, install/login/deploy) — file writes are not one of them.

**5. If the flow is interrupted mid-run, tell the user how to pick up.** If you stop partway (an error, the user steps away, the session breaks), end your message with a short resume hint: what completed, what's pending, and that typing **`continue`** resumes from the next step. State the step number so it's unambiguous (e.g. *"Stopped after npm install. Type `continue` to resume from Step 12 (wire to workspace)."*).

**6. When a command is denied at the permission prompt, never silently halt.** Claude Code shows its own permission dialog before running a Bash command — "1. Yes / 2. Yes, and don't ask again / 3. No". This dialog is the *harness*, not our `AskUserQuestion` MCQ, so we can't change its buttons or add text to it. What we control is the response **after** the user picks **No (3)**: the tool call comes back denied. When that happens, do NOT just stop. Reply with (a) which command was blocked and what step it belongs to, (b) why it's needed (e.g. "this creates the project folders — the scaffold can't continue without them"), and (c) how to proceed: either approve it (and that picking **2. Yes, and don't ask again** avoids future prompts for similar commands) or run it themselves and type **`continue`**. Tip for the user: the scaffold runs many routine `mkdir`/`npm`/`aio` commands, so choosing **2. Yes, and don't ask again** early makes the rest of the run prompt-free.

---

## Full Workflow

### Step 0 — Identify the target surface (run FIRST, before Step 1)

Do NOT assume every "create an extension" request means Content Hub. Decide based on the request:

- **The request explicitly names a surface** (e.g. "Content Hub panel", "CF Console action bar", "Universal Editor header button", "ExC Shell app", or an extension point ID like `aem/cf-console-admin/1`) → set `surfaceConfig` from the matching row in [Surface Config](#surface-config-the-heart-of-the-generic-design) and skip straight to Step 1.
- **The request is generic** ("create an extension", "build an Adobe/App Builder extension", "I want to extend Adobe", no surface named) → you MUST ask which surface first. Use `AskUserQuestion` with exactly 3 options — this covers all 6 surfaces across two questions with no "Other" path needed:

**Question 1 — surface family:**
```
question: "What kind of Adobe App Builder extension do you want to build?"
options:
  - label: "Content Hub panel"
    description: "Add a tab panel to the Asset Details dialog in Content Hub — aem/assets/contenthub/1."
  - label: "AEM UI Extension"
    description: "Customize an AEM surface — Content Fragment Console, CF Editor, Universal Editor, or Assets View."
  - label: "Experience Cloud Shell app"
    description: "A standalone App Builder SPA inside the Experience Cloud Shell — dx/excshell/1."
```

- If **Content Hub** → `surfaceKey = content-hub`, continue to Step 1.
- If **Experience Cloud Shell** → `surfaceKey = exc-shell`, continue to Step 1.
- If **AEM UI Extension** → ask **Question 2** immediately:

**Question 2 — which AEM surface (all 4 fit, no "Other" needed):**
```
question: "Which AEM surface are you extending?"
options:
  - label: "Content Fragment Console"
    description: "Action bar buttons, header menu, or custom grid columns — aem/cf-console-admin/1."
  - label: "Content Fragment Editor"
    description: "Header menu buttons or RTE toolbar customizations — aem/cf-editor/1."
  - label: "Universal Editor"
    description: "Header menu buttons or a properties-rail panel — aem/universal-editor/1."
  - label: "Assets View"
    description: "Action bar / header menu buttons — aem/assets/1 (requires Assets Ultimate license)."
```

**After the answer:** look up the chosen surface in the [Surface Config](#surface-config-the-heart-of-the-generic-design) table and store the whole row as `surfaceConfig` (`surfaceKey`, `extensionPointId`, `extDir`, `sdk`, templates ref, open URL, available namespaces). **Every downstream step reads from `surfaceConfig` — there are no hardcoded Content Hub paths past this point.** Then continue to Step 1.

---

### Step 1 — Extension Name

Use the `AskUserQuestion` tool. Tailor the suggested names to `surfaceConfig.surfaceKey`:

- `content-hub`: `asset-metadata-panel`, `asset-card-actions`, `asset-bulk-export`
- `cf-console` / `cf-editor`: `cf-export-action`, `cf-validate-button`, `cf-status-column`
- `universal-editor`: `ue-preview-button`, `ue-properties-panel`
- `assets-view`: `assets-bulk-action`, `assets-header-menu`
- `exc-shell`: `my-dashboard-app`, `reporting-spa`

```
question: "What should we name your extension?"
options:
  - label: "<surface-appropriate suggestion 1>"
  - label: "<surface-appropriate suggestion 2>"
  - label: "<surface-appropriate suggestion 3>"
```

The user can also select "Other" to type their own kebab-case name. Store the result as `extensionName`.

Validate: must be kebab-case (lowercase letters and hyphens only). If the user types something invalid (e.g. `My Extension`), suggest the corrected form (`my-extension`) and use `AskUserQuestion` again:

```
question: "\"My Extension\" needs to be kebab-case. Use \"my-extension\"?"
options:
  - label: "Yes, use \"my-extension\""
  - label: "Let me type a different name"
```

---

### Step 2 — Choose extension point(s) within the surface

**Auto-select rule:** If the user's original prompt already names a specific namespace / extension point, do NOT ask — auto-select it and skip to Step 3. Examples:
- "Add buttons to asset cards" / "card action" / "asset card" → auto-select `namespaces = ["card"]`
- "Add a panel to asset details" / "tab panel" / "asset details panel" → auto-select `namespaces = ["assetDetails"]`
- "Add a bulk action" / "selection bar" / "bulk action bar" → auto-select `namespaces = ["selectionBar"]`
- "Content Hub extension with card and bulk actions" → auto-select `namespaces = ["card", "selectionBar"]`

Only ask the multiSelect question below when the prompt is **generic** (e.g. "create a Content Hub extension" with no namespace hint).

What you ask depends on `surfaceConfig.surfaceKey`:

- **`content-hub`** — three namespaces are available. Use `AskUserQuestion` with `multiSelect: true`:
  ```
  question: "Which Content Hub extension points should I wire up?" (multiSelect: true)
  options:
    - label: "Asset Details panel"
      description: "Add custom tab panels to the Asset Details Dialog side rail — assetDetails namespace"
    - label: "Asset card action"
      description: "Add buttons to asset card menus and to collection tiles on the Collections grid — card namespace. getActionButtons receives actionContext (context: assets|collection|collections|share). onActionClick receives (resourceType, buttonId, resourceId, actionContext)."
    - label: "Selection bar (bulk action)"
      description: "Add buttons to the bulk-action bar shown when assets are selected — selectionBar namespace. getActionButtons receives actionContext with source + selection. onActionClick receives (buttonId, assetIds[])."
  ```
  Store the selected namespace keys as `namespaces` (e.g. `["assetDetails", "card"]`). At least one must be selected. The `card` and `selectionBar` namespaces open a modal on click — their `onActionClick` methods call `guestConnection.host.modal.openDialog()`, which requires using `let guestConnection` (not `const`) so the closure can reference it after `register()` resolves.

- **`cf-console`** — ask which extension point(s) to wire (multiSelect):
  ```
  question: "Which CF Console extension points should I wire up?" (multiSelect: true)
  options:
    - label: "Action bar button"   description: "Appears when fragments are selected — actionBar"
    - label: "Header menu button"  description: "Always visible in the console header — headerMenu"
    - label: "Custom grid column"  description: "Adds a column to the fragment list — contentFragmentGrid"
  ```
- **`cf-editor`** — multiSelect over `headerMenu` (header buttons) and `rte` (RTE toolbar buttons / badges).
- **`universal-editor`** — multiSelect over `headerMenu` and a properties-rail panel.
- **`assets-view`** — multiSelect over `actionBar` and `headerMenu`. Note the Assets Ultimate license requirement.
- **`exc-shell`** — **skip this step entirely.** An ExC Shell app has no extension points; set `namespaces = []` and continue.

Store the selected namespace keys as `namespaces` — Step 10 uses them to decide which methods blocks / template sections to include.

---

### Step 3 — Workspace

Use the `AskUserQuestion` tool:

```
question: "Which workspace should this extension use?"
options:
  - label: "Stage"
    description: "For development and testing — recommended to start here"
  - label: "Production"
    description: "For final release"
```

Store `workspace` as the selected value.

---

### Step 4 — Output Directory

Use the `AskUserQuestion` tool:

```
question: "Where should the project be created?"
options:
  - label: "~/Desktop/<extensionName>"
    description: "Create on your Desktop (recommended)"
  - label: "~/Documents/<extensionName>"
    description: "Create in your Documents folder"
```

Resolve the final `outputPath` to an absolute path, e.g. `$HOME/Desktop/<extensionName>`.

---

### Step 5 — Check aio CLI Installed

```bash
aio --version 2>/dev/null
```

- **Installed:** Continue immediately.
- **Not installed:** Use `AskUserQuestion`:

```
question: "The Adobe I/O CLI (aio) is not installed. Should I install it for you?"
options:
  - label: "Yes — install it now"
    description: "Runs npm install -g @adobe/aio-cli (~30s), then continues automatically"
  - label: "No — I'll install it myself"
    description: "I'll print the install command and pause; type 'continue' once it's installed"
```

If "Yes":
```bash
npm install -g @adobe/aio-cli
```

If "No": print `npm install -g @adobe/aio-cli`, tell the user to run it, and that typing `continue` resumes from Step 5 (login check). Do not proceed until the CLI is present.

---

### Step 6 — Check Login AND Validate the Token

**`aio where` is NOT a sufficient login check.** A token can show fully logged-in in `aio where` (Org/Project/Workspace all populated) and an unexpired local `expiry`, yet still be **rejected server-side** by the Console API with:

```
401 - Unauthorized ({"title":"ErrInvalidOauthToken","status":401,"error_code":401013,"message":"Oauth token is not valid"})
```

This is the #1 cause of "401 on everything" — a **stale token**, NOT a restricted org. No env-flag trick (`CI`, `unset`, `aio where`) can fix an invalid token. The ONLY fix is a fresh `aio login --force`. So this step does two checks: context presence, then a real token-validity probe.

**6a — Context check (fast, no browser):**

```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio where 2>/dev/null
```

**If output is empty or contains "not logged":** Run `aio login` in a subshell with CI/AIO_CLI_NO_TTY completely **unset** — `env VAR=` only sets to empty string but the variable still exists; must use `unset`:

```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login'
```

The browser opens automatically. Wait up to 3 minutes for the command to exit 0. Do NOT ask permission — just run it.

**6b — Token-validity probe (the critical addition):** Even if `aio where` showed a context, make ONE real Console API call to prove the token works server-side:

```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console org list --json 2>&1 | head -c 400
```

- **If it returns a JSON array of orgs:** Token is valid. Cache this org list (reuse it in Step 7 — don't call `org list` twice). Continue.
- **If the output contains `401`, `Unauthorized`, `ErrInvalidOauthToken`, or `Oauth token is not valid`:** The token is stale. Refresh it **without asking permission** — the user already authorized the flow by running the skill:

  ```bash
  bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'
  ```

  `--force` discards the stale token and forces a fresh browser OAuth. Wait up to 3 minutes for exit 0, then re-run the `aio console org list --json` probe to confirm it now returns orgs. After this, **every** downstream `aio console` call (org/project/workspace list, create, select) will succeed — there is no need for any "Console API is restricted" fallback.

**Critical:** Never run `aio login`/`aio login --force` with `CI`, `AIO_CLI_NO_TTY`, or `TERM=dumb` in the environment — those flags suppress the browser and the login silently fails.

---

### Step 7 — Resolve Org

After Step 6, the token is proven valid and you already have the org list cached from the 6b probe. **Do NOT skip `aio console org list` or invent a "restricted org" fallback** — with a valid token it always returns the real orgs.

Use the cached org list from Step 6b (or re-run if you didn't cache it):
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console org list --json 2>/dev/null
```

- **One org:** Auto-select, no user interaction:
  ```bash
  CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console org select <orgId>
  ```
  Store `activeOrgId`.
- **Multiple orgs:** Use `AskUserQuestion` (label = org name, description = orgId). Mark the org matching the `aio where` context with "← currently selected". After selection: `aio console org select <orgId>`. Store `activeOrgId`.
- **Zero orgs:** This only happens with a broken token — re-run `bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'`, then retry org list.

---

### Step 8 — Resolve Project

Now that the org context is established (either from `aio where` or explicit select in Step 7), list projects **within that org**. This call does NOT need `aio console org list` to have succeeded first — the org is already in the aio context:

```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project list --json 2>/dev/null
```

This returns the real list of all projects for the current org from Developer Console — not hardcoded, not from `aio where`.

**If the list is empty (zero projects):** Auto-create without asking:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project create -n <alphanumericName> --json 2>/dev/null
```
Select it. Store `activeProjectId`, `activeProjectName`. Set `isNewProject = true`. Continue to Step 9.

**If projects exist:** Always use `AskUserQuestion` — never auto-select without user approval. Show the full real list from Console API. Mark the project matching `existingProject` (from `aio where`) with "← currently active":

```
question: "Which project should I use?"
options: (one per project from Console API, label = project name, description = "projectId: <id>"; mark currently active)
         + { label: "Create a new project", description: "I'll create a fresh App Builder project for you" }
```

**If user picks an existing project:**
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project select <projectId>
```
Store `activeProjectId`, `activeProjectName`. Set `isNewProject = false`.

**If user picks "Create a new project":** Ask for a name:
```
question: "What should the new project be named? (alphanumeric only, no hyphens)"
options:
  - label: "<extensionName with hyphens stripped>"
    description: "Derived from your extension name"
  - label: "appbuilderext"
    description: "Generic name"
```
Create it:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project create -n <alphanumericName> --json 2>/dev/null
```
Select using the `id` from JSON output:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project select <projectId>
```
Store `activeProjectId`, `activeProjectName`. Set `isNewProject = true`.

If `aio console project create` exits non-zero with "already exists": list projects, select the matching one, set `isNewProject = false`.

**If `aio console project list` returns 401 here:** This should not happen after Step 6 — it means the token went stale mid-flow. Do NOT treat it as a restricted org and do NOT fall back to the `aio where` project name. Re-run the token refresh and retry the listing:
```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console project list --json 2>/dev/null
```

---

### Step 9 — Select Workspace + I/O Runtime note

After Step 6 the token is valid, so the Console API works — use the normal path below. (There is no "Console API restricted" path; a 401 at any point means a stale token → `aio login --force` and retry, never a fallback to `aio where` config.)

Select the workspace by name:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console workspace select <workspace>
```

**Note on I/O Runtime (do NOT run `aio console workspace service add`):** That subcommand **does not exist** in current aio CLI (11.1.2+) — it errors `Command console:ws:service not found`. It also isn't needed: `aio console project create` makes an **App Builder** project, and every App Builder workspace gets an I/O Runtime namespace automatically (pattern `<orgId>-<project>-<workspace>`, e.g. `274796-myext-stage`). `aio app use` (Step 12) downloads those `AIO_RUNTIME_NAMESPACE`/`AIO_RUNTIME_AUTH` creds into `.env`. So skip any service-add here. **The #1 reason `.env` comes back empty is a STALE TOKEN (the same 401 issue as Step 6), NOT a missing entitlement** — if Step 6's token probe passed, `aio app use` will populate `.env` fine.

If `isNewProject = false` (existing project): check if the chosen workspace exists and create if missing:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console workspace list --projectName <projectName> --json 2>/dev/null
```
If `<workspace>` not in list:
```bash
CI=true AIO_CLI_NO_TTY=true NO_COLOR=1 aio console workspace create --projectName <projectName> --name <workspace> --json 2>/dev/null
```

---

### Step 10 — Scaffold Project Files (surface-specific)

**Non-interactive — write all files directly, no questions, no per-file permission prompts.** Say "Scaffolding project files to `<outputPath>`..." then immediately create directories and write every scaffold file, one after another, with no pause in between. Do not ask for permission before writing each file, do not explain permissions, and do not ask anything — the user already authorized this by running the skill.

Create directories:

```bash
mkdir -p <outputPath>/src/<surfaceConfig.extDir>/web-src/src/components
mkdir -p <outputPath>/src/<surfaceConfig.extDir>/actions/generic
mkdir -p <outputPath>/hooks
```

Read [`references/file-templates.md`](references/file-templates.md) and write **all scaffold files** by substituting placeholders (`{{EXTENSION_NAME}}`, `{{DISPLAY_NAME}}`, `{{EXTENSION_DESCRIPTION}}`, `{{EXTENSION_DIR}}`, `{{EXTENSION_POINT}}`):

- `package.json`
- `app.config.yaml`
- `src/<extDir>/ext.config.yaml`
- `extension-manifest.json`
- `.eslintrc.js`
- `hooks/post-deploy.js`
- `src/<extDir>/web-src/index.html`
- `src/<extDir>/web-src/src/index.js`
- `src/<extDir>/web-src/src/index.css`
- `src/<extDir>/web-src/src/config.json`
- `src/<extDir>/web-src/src/components/Constants.js`
- `src/<extDir>/actions/utils.js`
- `src/<extDir>/actions/generic/index.js`
- `src/<extDir>/web-src/src/components/App.js`
- `src/<extDir>/web-src/src/components/ExtensionRegistration.js`
- Any namespace-specific components (e.g. `TabPanel.js` for `assetDetails`, `CardActionModal.js` for `card`, `SelectionBarModal.js` for `selectionBar`) — include only for the namespaces selected in Step 2

For non-Content-Hub AEM surfaces, also read [`references/aem-surface-templates.md`](references/aem-surface-templates.md) for the surface-specific `ext.config.yaml`. For ExC Shell, read [`references/excshell-templates.md`](references/excshell-templates.md) for the full SPA skeleton (different SDK).

---

### Step 11 — npm install

```bash
cd <outputPath>
npm install
```

If E401 (registry auth failure):
```bash
npm install --registry https://registry.npmjs.org
```

---

### Step 12 — Wire to Workspace (`aio app use`)

**Must run in a subshell with CI/AIO_CLI_NO_TTY completely unset.** Without this, credential download is silently skipped and `.env` stays empty → 401 on build/deploy:

```bash
cd <outputPath>
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use -w <workspace> --overwrite --no-input'
```

If that exits non-zero (the `.aio` config already has org/project context, so no extra flags needed):
```bash
cd <outputPath>
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w <workspace> --overwrite'
```

**Check `.env` validity:**

```bash
node -e "
const fs = require('fs');
try {
  const c = fs.readFileSync('<outputPath>/.env', 'utf8');
  const ok = /AIO_RUNTIME_NAMESPACE=\S+/.test(c) && /AIO_RUNTIME_AUTH=\S+/.test(c);
  console.log(ok ? 'VALID' : 'INVALID');
} catch(e) { console.log('INVALID'); }
"
```

**If `INVALID`:** Almost always a **stale token** — the credential download in `aio app use` failed silently. Do NOT conclude the org lacks Runtime, and do NOT run `aio console workspace service add` (it doesn't exist). Fix it:

```bash
bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'
cd <outputPath>
bash -c 'unset CI AIO_CLI_NO_TTY TERM; printf "y\ny\ny\ny\n" | aio app use -w <workspace> --overwrite' 2>/dev/null
```

Re-run the `isEnvValid` check. Only if `.env` is STILL empty after a confirmed-fresh-token `aio app use` is the workspace genuinely without a Runtime namespace — rare; in that case the UI still works and only actions are unavailable.

**If `VALID`:** Store `envValid = true`.

> **ExC Shell note:** An ExC Shell SPA with no backend actions doesn't strictly need a Runtime namespace to render. An `INVALID` `.env` is non-blocking for `exc-shell` if the app has no actions — the SPA still serves. Only block on it if the app calls web actions.

---

### Step 13 — Build

```bash
cd <outputPath>
aio app build
```

If this fails with a config validation error:
```bash
aio app build --no-config-validation
```
Fix the YAML issue then rebuild without the flag.

If build fails for other reasons: read the error, fix it (usually a missing package or malformed template), then rebuild.

---

### Step 14 — Start Dev Server

Check if port 9080 is free:

```bash
lsof -ti:9080
```

If a PID is returned, kill it automatically — the user already authorized the full workflow by running the skill, so there is no need to ask permission to free the port:

```bash
kill <pid> 2>/dev/null; sleep 2
```

If the port is still in use after `kill`, use `kill -9 <pid>`. Only if that also fails, tell the user to free port 9080 manually and stop.

**Do NOT ask "should I start the dev server?" after freeing the port.** Freeing the port and starting the server are one continuous action — once the port is clear, start the server immediately in the same step. The user already authorized the full workflow by running the skill (see [Interaction Rule 4](#interaction-rules-how-to-ask-decline-and-resume) and [[feedback_no_redundant_confirmations]]). The only question in this step is the failure case below (server never came up).

Start the dev server in background. **Set `PORT=9080` explicitly.** Redirect output to a log and poll for the localhost URL:

```bash
cd <outputPath>
PORT=9080 aio app run > /tmp/aio-run-<extensionName>.log 2>&1 &
AIO_PID=$!

for i in $(seq 1 60); do
  grep -qE "https?://localhost:[0-9]+" /tmp/aio-run-<extensionName>.log 2>/dev/null && break
  sleep 2
done

cat /tmp/aio-run-<extensionName>.log
echo "PID: $AIO_PID"
```

**If `localhost:9080` appears in log:** Dev server is up. Proceed to Step 15.

**If loop ends without the URL (120 seconds elapsed):** Use `AskUserQuestion`:

```
question: "The dev server didn't start automatically. Should I try starting it again?"
options:
  - label: "Yes — rebuild and retry the dev server"
    description: "Re-runs aio app build, then tries PORT=9080 aio app run again"
  - label: "No — I'll start it manually"
    description: "I'll print the command and pause; type 'continue' once localhost:9080 is up"
```

If "Yes": re-run `aio app build` then retry the dev server loop.
If "No": print `cd <outputPath> && PORT=9080 aio app run`, tell the user to run it, and that once the page loads they should type `continue` to resume from Step 15 (open cert page). Do not just stop without this hint.

---

### Step 15 — Open Cert Page (after dev server URL confirmed)

Open the cert page **only after** the dev server URL appears in the log:

```bash
open "https://localhost:9080"
```

*(On Linux use `xdg-open`, on Windows use `start ""`)*

Then use `AskUserQuestion`:

```
question: "I opened https://localhost:9080 in your browser. Accept the self-signed certificate there (click Advanced → Proceed to localhost, or type 'thisisunsafe'). The page will then show instructions to return here."
options:
  - label: "Done — open the extension"
    description: "Cert accepted; open the target surface now (Step 16)"
  - label: "Reopen the cert page"
    description: "Open https://localhost:9080 again so I can accept the cert"
```

> The browser page (localhost:9080) now shows a clear "Return to Claude Code" message after cert acceptance — that's what guides the user back. Keep the Claude Code question short; don't repeat the return instruction here.

If "Reopen the cert page":
```bash
open "https://localhost:9080"
```
Ask the same question again.

---

### Step 16 — Open the Target Surface Automatically (surface-specific)

Only after the user confirms "Done", open the surface via Bash — **never just print the URL**. Use the open URL for `surfaceConfig.surfaceKey` from the [Open URLs table](#surface-config-the-heart-of-the-generic-design):

```bash
open "<surfaceConfig.openUrl>"
```

- **`content-hub`** — opens directly to the panel:
  ```bash
  open "https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/"
  ```
- **`cf-console` / `cf-editor` / `universal-editor` / `assets-view`** — open the extension tester base, then tell the user where to navigate (these surfaces have no stable deep-link hash):
  ```bash
  open "https://experience.adobe.com/?devMode=true&ext=https://localhost:9080"
  ```
  Then say, e.g.: *"Navigate to **Content Fragments** — your action bar button appears when you select a fragment."*
- **`exc-shell`** — the SPA is already running at `https://localhost:9080` (the cert page). Confirm it loaded; to embed it in the shell, open `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080`.

**Rules (Content Hub specifics):**
- **No `&repo=`** — the scaffold sets `allowedRepos = []` so any repo works for local dev.
- **No `/index.html`** after `localhost:9080` — that is only for deployed (CDN) URLs.
- **Do not print and ask the user to click** — run `open` via Bash.

---

### Step 17 — Ask About Deployment

The workspace was already chosen in Step 3 — do NOT ask again which workspace to deploy to. Just ask whether to deploy now or later:

```
question: "Extension is running locally on <workspace>. Deploy it now?"
options:
  - label: "Yes — deploy to <workspace> now"
    description: "Runs aio app deploy, then opens the deployed CDN test URL automatically"
  - label: "Not now — keep running locally"
    description: "Stays on localhost:9080; type 'continue' or 'deploy' later to deploy from Step 17"
```

If "Yes": run the deploy flow below immediately — do not wait for the user to do anything.

If "Not now": confirm the extension is still running locally and tell the user it can be deployed anytime by typing `deploy` (resumes at Step 17). Don't end the conversation with a bare "okay".

**Deploy flow:**

```bash
cd <outputPath>

# Deploy — capture full output (workspace is already wired from Step 12)
aio app deploy 2>&1 | tee /tmp/aio-deploy-<extensionName>.log
```

After `aio app deploy` completes, **always** parse the CDN base domain from the log regardless of exit code, build the test URL, and **open it in the same command**. The deployed URL is built from the surface's open URL with the local `ext=https://localhost:9080` replaced by `ext=<baseDomain>/index.html`:

```bash
node -e "
const fs = require('fs');
const log = fs.readFileSync('/tmp/aio-deploy-<extensionName>.log', 'utf8');
const m = log.match(/(https:\/\/[a-z0-9-]+\.adobeio-static\.net)/i);
if (m) { console.log(m[1]); } else { process.exit(1); }
" | { read BASE; echo "Opening: $BASE";
  # For content-hub, append the deep-link hash. For other AEM surfaces, open the tester base and navigate.
  open "https://experience.adobe.com/?devMode=true&ext=${BASE}/index.html#/assets/contenthub/"; }
```

> For surfaces other than `content-hub`, drop the `#/assets/contenthub/` hash — open `https://experience.adobe.com/?devMode=true&ext=${BASE}/index.html` and tell the user where to navigate. For `exc-shell`, the deployed SPA URL printed by `aio app deploy` is the app itself.

**CRITICAL:** the deployed CDN test URL MUST be opened via `open`, never just printed. Only after the `open` has actually run may you print the link in the summary for reference.

**Partial failure is still a success:** If web assets deployed but actions failed (org has no I/O Runtime, or 401 on action deploy), the extension UI still works. Open the CDN URL, note that actions are unavailable in this org — do not treat it as a blocking error.

If the workspace from Step 3 is Production: after opening the deployed URL, use `AskUserQuestion`:
```
question: "Extension deployed to Production! To make it visible to all users without the ext= parameter, approve it in Extension Manager."
options:
  - label: "Open Extension Manager"
  - label: "I'll approve it later"
```
If "Open Extension Manager": `open "https://experience.adobe.com/aem/extension-manager"`

**Switching workspaces at deploy time:** Only switch if the user *explicitly* asks to deploy to a different workspace than the one chosen in Step 3. In that case, run `aio app use <config.json> --overwrite --no-input` with the new workspace config before deploying. Otherwise, use the workspace already wired in Step 12.

**After Step 17 completes (whether deployed or kept local), ALWAYS print the "Where to edit" file map below.** Do not wait for a follow-up request — show it unconditionally, every run, every session. Keep it simple: just tell the customer which file to open for each kind of change.

The output must look exactly like this (filter rows to only the namespaces selected in Step 2 — omit rows for namespaces that were not chosen):

```
## Where to edit your extension

All UI files are under `src/<extDir>/web-src/src/components/`

| What you want to change | File to edit |
|---|---|
| Which panels / buttons appear, their title, icon, or label | `ExtensionRegistration.js` |
| Asset Details panel content (tab UI) | `TabPanel.js` |          ← only if assetDetails selected
| Card action modal content | `CardActionModal.js` |              ← only if card selected
| Selection bar (bulk action) modal content | `SelectionBarModal.js` |  ← only if selectionBar selected
| Server-side logic / AEM API calls | `actions/generic/index.js` |
```

Then add one line: *"Let me know what you'd like to build and I'll make the changes."*

---

### Step 18 — Customization (follow-up requests)

After printing the file map, respond to follow-up customization requests without asking — just act. Files live under `src/<surfaceConfig.extDir>/`. Full API reference per surface:

**Content Hub (`content-hub`):**

| Request | File | Action |
| --- | --- | --- |
| Change panel title / icon | `ExtensionRegistration.js` | Edit `title`, `tooltip`, `icon` in `assetDetails.getTabPanels()` |
| Add a second panel | `ExtensionRegistration.js` + `App.js` + new component | Read `references/file-templates.md` § Adding a Second Panel |
| Build the panel UI | `TabPanel.js` | React Spectrum components from `references/file-templates.md` § TabPanel |
| Change card button label / icon | `ExtensionRegistration.js` | Edit `label`, `icon` in `card.getActionButtons(actionContext)` |
| Show card buttons only on certain surfaces | `ExtensionRegistration.js` | In `card.getActionButtons(actionContext)`, check `actionContext.context` (`'assets'`, `'collection'`, `'collections'`, `'share'`) and return `[]` to hide, or the full array to show. `'collections'` = collection tile on the Collections grid. |
| Handle card button click | `ExtensionRegistration.js` + `CardActionModal.js` | Edit `card.onActionClick(resourceType, buttonId, resourceId, actionContext)` → `resourceType` is `'asset'` (asset cards) or `'collection'` (collection tiles). Calls `guestConnection.host.modal.openDialog({ title, contentUrl: '/#card-action-modal?resourceId=...&resourceType=...', type: 'modal', size: 'M' })`. **Single object — NO `{ id }`, NO `payload`** (the two-arg form silently times out). Pass data via the `contentUrl` query; read it in the modal with `new URLSearchParams(window.location.hash.split('?')[1])`. Close with `guestConnection.host.modal.closeDialog()`. |
| Change selection bar button label / icon | `ExtensionRegistration.js` | Edit `label`, `icon` in `selectionBar.getActionButtons(actionContext)` |
| Show buttons only in certain views | `ExtensionRegistration.js` | In `selectionBar.getActionButtons(actionContext)`, check `actionContext.context` (`'assets'`, `'collections'`, `'collection'`, `'share'`) and return `[]` to hide, or the full array to show. |
| Handle bulk action click | `ExtensionRegistration.js` + `SelectionBarModal.js` | Edit `selectionBar.onActionClick` → receives `(buttonId, assetIds[])`. Same modal pattern as card. |
| Call an AEM API | `actions/generic/index.js` + panel/modal component | Uncomment the fetch blocks; pass `accessToken` from `guestConnection.host.auth.getIMSInfo()` |
| Show a toast | any component | `guestConnection.host.toast.display({ variant, message })` — variants: `neutral`, `positive`, `negative`, `info` |
| Get IMS auth | any component | `guestConnection.host.auth.getIMSInfo()` → `{ imsOrg, imsOrgName, accessToken }` · `guestConnection.host.auth.getApiKey()` → string |
| Get AEM host URL | any component | `guestConnection.host.discovery.getAemHost()` → `https://<repoId>/` |

**AEM surfaces (`cf-console`, `cf-editor`, `universal-editor`, `assets-view`):**

| Request | File | Action |
| --- | --- | --- |
| Add/change a button | `ExtensionRegistration.js` | Edit the relevant `getButtons()` in the `actionBar`/`headerMenu` block — see `references/aem-surface-templates.md` |
| Add a modal | `App.js` + new modal page | Add a route + `host.modal.showUrl({ url: '/index.html#/my-modal' })`; close with `attach()` + `host.modal.close()` |
| Add a grid column (CF Console) | `ExtensionRegistration.js` | Add to `contentFragmentGrid.getColumns()` |
| RTE button/badge (CF Editor) | `ExtensionRegistration.js` | Add to `rte.getCustomButtons()` / `rte.getBadges()` |
| Read auth/context | any page | `guestConnection.sharedContext.get('auth')` → `{ imsOrg, imsToken, apiKey }` |
| Show a toast | any page | `guestConnection.host.toaster.display({ variant, message })` |

**ExC Shell (`exc-shell`):**

| Request | File | Action |
| --- | --- | --- |
| Build the app UI | `App.js` / components | React Spectrum inside the `<Provider>` — see `references/excshell-templates.md` |
| Read shell auth | `App.js` | From `runtime.ready({ onReady })` context: `{ imsOrg, imsToken, imsProfile, locale }` |
| Call a backend action | components + `actions/generic/index.js` | `fetch(actionUrl, { headers: { Authorization: 'Bearer ' + imsToken, 'x-gw-ims-org-id': imsOrg } })` |

After UI changes, the dev server hot-reloads. After action changes, run `aio app build` in the project directory.

---

## Adding a New Surface

This is the payoff of the generic design. To support a brand-new App Builder surface in the future, **you do not touch the workflow (Steps 1–9, 11–15, 17)** — you only:

1. **Add one row to the [Surface Config](#surface-config-the-heart-of-the-generic-design) table** — `surfaceKey`, `extensionPointId`, `extDir`, `sdk`, templates ref, and available namespaces.
2. **Add one row to the Open URLs table** — the `experience.adobe.com` URL (or other host URL) to open in Step 16.
3. **Add an option to the Step 0 question** so users can pick it.
4. **Add a template section** — if the surface uses `@adobe/uix-guest` and shares the standard skeleton, add a section to [`references/aem-surface-templates.md`](references/aem-surface-templates.md) with just its `ext.config.yaml` + `methods` block. If it uses a different SDK/skeleton (like ExC Shell), add a dedicated reference file.
5. **Add a Step 2 question branch** (which namespaces/extension points it offers) and a **Step 18 customization sub-table**.

Everything else — login, token validation, org/project/workspace, install, build, dev server, cert, deploy — is reused unchanged because it reads from `surfaceConfig`.

**Rule of thumb:** if a new surface uses `register()` from `@adobe/uix-guest`, it's ~90% reuse (skeleton + workflow), and you only author its `methods` object. If it uses a different SDK, you author a new skeleton but still reuse the entire Console/build/deploy workflow.

---

## Failure Recovery

| Symptom | Action |
| --- | --- |
| `aio where` shows "not logged" | Automatically run `bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login'` — never ask permission, browser opens, wait for exit 0 |
| `aio console *` returns 401 / `ErrInvalidOauthToken` / `Oauth token is not valid` (even though `aio where` shows logged-in) | **Stale token, NOT a restricted org.** Run `bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio login --force'`, then retry. Never fall back to `aio where` config values. |
| `aio console project create` → "already exists" | List projects, select matching one, continue |
| `aio console workspace create` → "already exists" | Skip, continue |
| `aio app use` exits non-zero | Fallback: `bash -c 'unset CI AIO_CLI_NO_TTY TERM; aio app use -w <workspace> --overwrite --no-input'` |
| `.env` missing `AIO_RUNTIME_NAMESPACE` | Usually a STALE TOKEN — run `aio login --force` then re-run `aio app use -w <ws> --overwrite`. Do NOT run `workspace service add` (doesn't exist) or assume missing entitlement. For `exc-shell` with no actions, non-blocking. |
| `npm install` → E401 | `npm install --registry https://registry.npmjs.org` |
| `aio app build` → validation error | `aio app build --no-config-validation`; fix YAML; rebuild without flag |
| `aio app run` log never shows `localhost:9080` | Re-run `aio app build`; check `node -v` ≥ 18; check `cat /tmp/aio-run-<name>.log` for errors |
| Panel/app blank in browser | Cert not accepted — run `open https://localhost:9080` and use `AskUserQuestion` again |
| Extension not visible (AEM surfaces) | Confirm you navigated to the correct AEM app; check `ext=https://localhost:9080` and `devMode=true` are in the URL; check the extension point ID in `ext.config.yaml` matches `surfaceConfig.extensionPointId` |
| Content Hub panel not visible | Check `allowedRepos` is empty; check URL uses `#/assets/contenthub/`; check `devMode=true` |
| ExC Shell stuck on spinner | `runtime.done()` was not called (or called too late) — call it at the `register` level, not after data fetch — see `references/excshell-templates.md` |
| Deploy: CDN URL not found in log | Check `cat /tmp/aio-deploy-<name>.log`; look for any `.adobeio-static.net` URL manually |

---

## Quality Checklist

- [ ] `surfaceConfig` was set in Step 0 and every path/URL downstream reads from it (no hardcoded Content Hub values for non-CH surfaces)
- [ ] `app.config.yaml` uses `surfaceConfig.extensionPointId`
- [ ] Source directory is `src/<surfaceConfig.extDir>/`
- [ ] For `uix-guest` surfaces: `ExtensionRegistration.js` imports `register`, secondary pages import `attach`, both use the same `extensionId` from `Constants.js`
- [ ] For `exc-shell`: `App.js` imports `register` from `@adobe/exc-app` and calls `runtime.done()` at register level
- [ ] `npm install` succeeded (Step 11)
- [ ] `aio app use` ran in a subshell with `unset CI AIO_CLI_NO_TTY TERM` (Step 12)
- [ ] `.env` has `AIO_RUNTIME_NAMESPACE` and `AIO_RUNTIME_AUTH` (or non-blocking for actionless `exc-shell`)
- [ ] `aio app build` succeeded (Step 13)
- [ ] `PORT=9080 aio app run` is running and log shows `localhost:9080` (Step 14)
- [ ] Cert page opened via `open` **after** dev server URL confirmed
- [ ] Target surface opened via `open` (Bash), not just printed as text

---

## Chaining

- Chains FROM `appbuilder-project-init` for complex multi-workspace Console setups
- Works alongside `appbuilder-action-scaffolder` for production-grade action patterns
- Works alongside `appbuilder-ui-scaffolder` for advanced React Spectrum UI patterns and deeper per-surface host-API reference
- Chains TO `appbuilder-cicd-pipeline` for GitHub Actions deployment automation
- Chains TO `appbuilder-e2e-testing` for Playwright tests

---

## References

- [`references/file-templates.md`](references/file-templates.md) — Content Hub scaffold templates + the shared uix-guest skeleton reused by all AEM surfaces
- [`references/aem-surface-templates.md`](references/aem-surface-templates.md) — Per-surface `ext.config.yaml` + `ExtensionRegistration.js` methods blocks for CF Console, CF Editor, Universal Editor, Assets View
- [`references/excshell-templates.md`](references/excshell-templates.md) — Experience Cloud Shell SPA skeleton (`@adobe/exc-app`, `dx/excshell/1`)
- [`references/deployment.md`](references/deployment.md) — Stage and Production deployment, Extension Manager approval
- [`references/debugging.md`](references/debugging.md) — Troubleshooting for build, runtime, and surface integration failures
