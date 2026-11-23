---
name: app-builder-create-app
description: Use when a developer wants to create a new Adobe App Builder app or UI extension — phrases like "create an App Builder app", "build an app that shows … inside Experience Cloud", "new App Builder project", "scaffold an App Builder app", "create an AEM extension", "add a button to the Content Fragment console", "Assets View panel/extension", "Universal Editor extension", "Experience Hub widget", "Workfront extension". Picks the right template for where the app should appear, creates the App Builder project (Stage and Production workspaces) after confirmation, builds the requested UI and actions, and runs it locally with a link to try it in the target product. Owns App Builder project creation; never uses the connector's create_project for App Builder.
license: Apache-2.0
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).

# Create an App Builder app

Turn "what should it do and where should it appear" into a working app running locally inside the target Adobe product. The developer answers one set of questions and gives one confirmation. Nothing is deployed.

`<skill-dir>` below is the folder containing this SKILL.md. Run scripts as `node "<skill-dir>/scripts/<name>.mjs"`. Run `aio` commands in the app folder once it exists.

## Step 0 — Report skill context

Call `report_skill_context` once with `skill_name: "app-builder-create-app"` and `skill_version: "1.0.0"`. Call it again if you return here from `app-builder-setup`.

## Step 1 — Readiness gate (silent when OK)

1. No shell on the developer's **own computer**? Say this needs a desktop or terminal assistant (see `app-builder-setup` Step 1), and stop. A shell in a hosted sandbox isn't enough: the app must live on the developer's machine, and the CLI sign-in happens in their browser.
2. If `app-builder-setup` already completed in this conversation, skip items 3 and 4 and reuse its org. Otherwise run `aio --version`. If `aio` is missing or older than 11.1.0, hand off to the `app-builder-setup` skill.
3. Org: call `get_organisations` (pick automatically if there's one). Tell the developer *"Checking the CLI sign-in. If a browser tab opens, sign in with the same Adobe account."* Then run `aio console org list --json` and check that the org's `id` is listed. If it isn't listed or the command fails, hand off to `app-builder-setup`. The cause is a different account or environment, or an org without App Builder.
4. Developer Terms: call `get_projects` with the org and `filterBy: "all"` (keep the result for Step 3; don't list it). If it returns the Developer Terms message instead of projects, run the Terms flow from `app-builder-setup` Step 5: show the Terms link and call `accept_developer_terms` only after the developer explicitly agrees. `aio app init` fails without the Terms, so stop if they don't agree.

## Step 2 — One interview

Ask everything missing in **one** message, with suggested defaults. Skip what the developer already said.

1. **What should the app do?** The pages or panels, the data they show, and what happens on a click.
2. **Where should it appear?** Show the numbered `label`s from `scripts/templates.json`. The default is Experience Cloud Shell. Map product words yourself:
   - Content Fragment list → `cf-admin`; acting on **selected** fragments → `cf-admin-selected`; fragment editor → `cf-editor`.
   - Assets → `assets-browse` (selected assets), `assets-details` (one asset's side panel), or `assets-view` (both).
   - Editing site pages → `universal-editor`; AEM home dashboard → `experience-hub`; Workfront → `workfront`.
3. **App name.** Don't ask for it. Use a name the developer gave, otherwise derive one from the purpose (see the naming rules in `references/common-rules.md`). From it, derive the project name (letters and digits only, starts with a letter, 3–20 characters, e.g. `TeamProjects`). Also derive the folder: a new or empty folder, lowercase letters, digits and dashes, no spaces (e.g. `team-projects`). For Experience Hub, the folder name also becomes the widget's id and web address, so choose it carefully. The names appear in the Step 3 confirmation.
4. **New or existing project?** The default is a new App Builder project. For an existing one, list the org's projects with `type` `jaeger` (never show that word) by title.
5. **Values needed for the preview link**, depending on the surface's `needs` in `templates.json`. They can be added later:
   - `aemAuthorHost`: the AEM author host, for example `author-p123-e456.adobeaemcloud.com`.
   - `orgShortName`: the part after `#/@` in their experience.adobe.com address.
   - `aemSitesPageUrl`: a page URL to open in Universal Editor.
   - `workfrontUrl`: the Workfront address.

If there's no real data source yet, plan clearly labelled sample data (see `references/app-patterns.md`). If the app will **change** product content (for example tagging fragments), say that local testing works on real content, and suggest a development environment or test content.

## Step 3 — One confirmation

1. Project name: compare it case-insensitively with the names from Step 1.4.
   - If an App Builder project with that name was created earlier in this conversation (for example by a failed attempt), reuse it by **id**.
   - If another project already has it, offer that project as an option or propose a suffixed name. `aio app init` silently reuses a project with the same name.
   - Existing project: use its **id**. Its Stage workspace may already host another app, which a later deploy would replace. Offer a separate workspace named after the app (for example `TeamProjects`), passed as `--workspace`. `aio app init` creates it with its own Runtime space. Default to the new workspace when you can't tell whether Stage is in use.
2. The folder must not exist or must be empty (the script checks this too).
3. Ask once, in plain words: *"I'll create the App Builder project **TeamProjects** in **<org>**, with a Stage workspace for testing and a Production workspace for real users, each with its own space on Adobe's serverless platform. Then I'll generate a <surface> app in `./team-projects` and run it on your machine. Nothing is deployed. This takes 2–5 minutes. OK?"* For an existing project, say *"I'll use the existing project … and its workspace …"* instead.

## Step 4 — Create the project and generate the app

1. `aio app init` changes the CLI's selected org, project and workspace. First run `node "<skill-dir>/scripts/lib/cli-config.mjs"` and record `selection.orgCode`, `selection.projectId` and `selection.workspaceId`, so the selection can be restored later. A `null` value means nothing was selected at that level. If `ok` is false, stop and report `configError`; do not inspect raw CLI configuration as a fallback.
2. Run `node "<skill-dir>/scripts/init-command.mjs" --surface <key> --name "<App name>" --dir <folder> --org <org code> --project <name or id>`. Add `--workspace <name>` for a separate workspace in an existing project (default `Stage`). Add `--with-action` when the app needs backend logic and the surface's `actions` value is `optional`. If it returns `ok: false`, fix the input and retry.
3. Run the returned `command` with a 10-minute timeout. Expect 2–4 minutes, mostly npm installs.
   - If `answerWithBlankLines` is true (Experience Hub), the template asks one question late in the run. Feed blank lines so its default is accepted: `yes '' | <command>`.
   - A single piped newline is not enough: stdin closes before the question appears, and the run aborts with "User force closed the prompt".
   - Without `yes` (for example in Windows PowerShell), ask the developer to run the command in their own terminal and press Enter at "Project name".
4. On failure, show the relevant error line, without secrets.
   - Call `get_projects` to see whether the project now exists, and tell the developer.
   - Terms error: go back to Step 1.4. Org not found or sign-in error: `app-builder-setup`. Access or entitlement error: explain using the admin table in the `app-builder-setup` skill's `references/concepts.md`.
   - `Name '<workspace>' already in use` while creating a workspace: retry once with a different workspace name.
   - To retry, ask before deleting the partly generated folder (only that folder). Re-running reuses the project, so pass its **id** (Step 3.1). If the developer won't retry, tell them the empty project stays in Developer Console and can be reused later or deleted there.
5. Run `node "<skill-dir>/scripts/fixup.mjs" --surface <key> --dir <folder>`. It applies known template fixes, makes sure `.env`, `.aio` and `logs/` are git-ignored, and lists `todo` items and `notes`. Do the todo items and follow the notes. Ignore rules do not protect files already tracked by Git; if any of these are tracked, stop and help the developer remove them from tracking without deleting their local copies.

## Step 5 — Build what was asked

Follow `references/app-patterns.md`. Read the generated files first, keep the bootstrap and registration code, and implement the requested pages, dialogs, panels and actions. Then run `aio app build` in the app folder. Fix reported errors, up to 3 rounds. If it still fails, explain what's left.

## Step 6 — Run it locally and give the link

1. Tell the developer first: *"The first run opens a browser tab asking you to accept a local development certificate. Please accept it within 20 seconds."*
2. In the app folder, start the dev server **in the background**, sending its output to a private log file. Its output can contain request parameters and tokens.
   - macOS/Linux: `mkdir -p logs && aio app dev > logs/aio-dev.log 2>&1`
   - PowerShell: `New-Item -ItemType Directory -Force logs | Out-Null; aio app dev *> logs/aio-dev.log`

   Keep the process handle. If your client can't keep background processes, ask the developer to run `aio app dev` in their own terminal and tell you when it says it's ready.
3. Check progress only with `node "<skill-dir>/scripts/dev-log.mjs"`, never by reading the log yourself. It prints `ready`, `localUrl`, `actionUrls`, recent `errors`, `suppressed` and the last lines, all redacted. Run it about every 5 seconds until `ready` is true (usually under 30 seconds). Port 9080 isn't guaranteed; use `localUrl`.
   - Stop checking when the dev server process has exited, when `errors` shows that it failed to start (for example a build error or a port already in use), or after 2 minutes. Then stop the dev server if it's still running, explain the redacted `errors` and last lines in plain words, and offer the `app-builder-troubleshoot` skill.
   - If `suppressed` is true, the log contained a long value that looked like a secret, so everything after it is hidden, including later URLs and errors (`localUrl` can be `null` even when `ready` is true). Tell the developer, and ask them to open `logs/aio-dev.log` themselves for the local URL or the error, without pasting it into the chat.
4. Give the try-it link for the surface from `references/surfaces.md`, with the placeholders filled in. If the developer lacks access to the product, give the standalone local URL and say what can be checked there.
5. Leave the server running while they test. Stop exactly that process when they're done or before deploying.

## Step 7 — Explain what happened

- **What I did:** one bullet per command or change, with why, for example `aio app init` (created the project and generated the app), the fix-ups applied, `aio app build`, and `aio app dev` (runs the app on your machine; nothing uploaded).
- **What was created:** the project and its Stage and Production workspaces in Developer Console, and the local folder. Show a short tree of the folder (UI, actions, `ext.config.yaml`, extension point) with one line per item. Mention any `notes` from `fixup.mjs`. If the `quiet-logging` fix-up ran, say why: generated code logged every request parameter and the user's sign-in token.
- **CLI selection changed:** `aio app init` also switches the CLI's selected org, project and workspace (`aio where`) to the new app's. Mention it. If the developer wants their previous selection back, restore the hierarchy recorded in Step 4.1, starting with `aio console org select <selection.orgCode>`, then `aio console project select <selection.projectId>` if a project was selected, then `aio console workspace select <selection.workspaceId>` if a workspace was selected. Do not run these commands with `null` values or restore a child without its parent selection. If nothing was selected before, there is nothing to restore. The app folder's own link (`.aio`) isn't affected.
- **Next step:** *"When you're happy with it, say 'deploy to Stage'."* If something fails at runtime, the `app-builder-troubleshoot` skill can help.

## Rules

- Create App Builder projects only with `aio app init`, after the Step 3 confirmation. Don't use the connector's `create_project` for App Builder apps: the CLI also sets up the Stage workspace and Runtime that the app needs.
- Don't deploy. Don't use `aio app run`, which deploys actions to Runtime, or the interactive `aio app add …` commands.
- Never read, print or commit `.env`, `.aio` or `logs/aio-dev.log`. Read the dev log only through `dev-log.mjs`.
- Ask for nothing you can look up, and show names rather than IDs.
- If unsure about a product API or UI extension detail, call `search_adobe_docs` before guessing.
