---
name: app-builder-setup
description: Use when a developer wants to get ready for Adobe App Builder development or fix their App Builder tooling — phrases like "set up my machine for App Builder", "help me get started with App Builder", "get ready for App Builder development", "install the aio CLI", "update aio", "aio login", "aio isn't working", "sign in the Adobe CLI", "which org is my CLI using", "accept the developer terms for App Builder". Checks Node.js, the Adobe I/O CLI and its sign-in without changing anything, fixes what it can with consent, selects the same org as the connector, and gets the Adobe Developer Terms accepted with the developer's explicit agreement. Other App Builder skills hand off here when the machine isn't ready.
license: Apache-2.0
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).

# Get ready for App Builder development

Check the developer's machine, CLI sign-in and Adobe org, fix what can be fixed with one approval, and explain the result in plain words. Nothing changes without consent.

`<skill-dir>` below is the folder containing this SKILL.md (your client shows it when the skill loads). Run scripts as `node "<skill-dir>/scripts/<name>.mjs"`.

## Step 0 — Report skill context

Call `report_skill_context` once with `skill_name: "app-builder-setup"` and `skill_version: "1.0.0"`. If another App Builder skill sent you here, that skill re-reports its own context when it resumes.

## Step 1 — No shell on the developer's own computer?

These skills run the Adobe I/O CLI on the developer's machine: that's where the app's code lives and where the CLI sign-in opens a browser. Having *a* shell isn't enough. A hosted sandbox shell (for example the code-execution tool of a web or desktop chat app, or a remote container the developer doesn't use) has its own files and no access to their CLI sign-in. If you can't run commands on the developer's own computer, or you can't tell, ask once: *"Am I running on your own computer, in the folder you work in?"*

If not, say so in one sentence and recommend a desktop or terminal assistant (Claude Code, GitHub Copilot CLI or VS Code agent mode, Cursor, Codex). Then do what the connector can do on its own:
1. Call `get_organisations`. With one org, use it without asking, and say which org you're using. With more than one, show a numbered list of org names and ask which org to use. Add an org's ID only when two orgs share a name.
2. Steps 5 and 6, with that org.
3. Give a short "On your machine, run" list:
   - Node.js 20 or newer (https://nodejs.org)
   - `npm install -g @adobe/aio-cli`
   - `aio login`
   - `aio console org select <org code>`, with the chosen org's `code` from `get_organisations`
4. Give the Step 7 summary, and stop.

## Step 2 — Check, without changing anything

1. Run `node "<skill-dir>/scripts/readiness.mjs"`. It prints JSON with only version numbers, the CLI environment, the selected org, project and workspace (names and ids) and whether the CLI sign-in is still valid (from its expiry time). It never prints tokens. If `node` itself isn't found, treat Node.js as missing.
2. At the same time, call `get_organisations`. The org question can then go in the same message as the fixes.
3. Assume the connector uses Adobe's **production** environment. It's **stage** only when the connector's URL is a stage one (for example `https://adp-connector-stg.adobe.io/mcp`). For a local or custom connector URL (for example `http://localhost:8080/mcp`), ask the developer which Adobe environment that connector is configured for (its `ADP_ENV`). Never decide this from the developer's wording: "Stage" almost always means the project's **Stage workspace**, which is part of production.

Show one status table. Use ✅ / ❌ / ⚠️ and one short note per row. A `null` value means "can't check until the CLI is installed". If `configError` is set, the CLI's settings couldn't be read, so sign-in and environment are unknown (⚠️): run the script once more, and if it persists, signing in again (Step 3.3) usually repairs them.

| Check | Ready when |
|---|---|
| Node.js | `node.ok` (version 20 or newer) |
| Adobe I/O CLI | `aio.installed` and `aio.ok` (11.1.0 or newer). `updateAvailable` is a ⚠️ and an optional fix |
| CLI sign-in | `signedIn` is true |
| Environment | `cliEnv` (`prod` or `stage`) matches the connector's environment |
| Org, Developer Terms, App Builder access | Filled in by Steps 4–6 |

## Step 3 — Fix with one approval

**Node.js too old or missing comes first.** Don't install Node yourself and don't ask for approval yet. Explain how to install it: the LTS installer from https://nodejs.org, or `nvm install --lts` when `nvm` is true. Then wait.
- When the developer says it's done, re-run the readiness script. If it still shows the old version, ask them to restart the assistant or terminal so the new Node is found.

Then list every remaining fix in **one** message. If there's more than one org, include the numbered org list and default to `selection.orgId` when it's in the list. Ask once: *"Shall I do these now? And which org should I use?"* Run only the approved items, in this order:

1. **Install or update the CLI.** Run `npm install -g @adobe/aio-cli` (1–3 minutes, so use a long timeout). On a permission error (`EACCES`), explain that the global npm folder needs a Node version manager such as nvm or a user-owned npm prefix. Never use `sudo` unless the developer asks for it.
2. **Wrong environment.** Run `aio logout` first, because the sign-in belongs to the old environment. Then run `aio config set cli.env prod` (or `stage`).
3. **Sign in** (when `signedIn` isn't true, or after step 2). First explain: *"A browser tab opens for the Adobe sign-in. This signs in the CLI on your machine. It's separate from the connector's sign-in, so use the same Adobe account. If no tab opens within 30 seconds, tell me."* Then run `node "<skill-dir>/scripts/login.mjs"` with a timeout longer than 5 minutes. It runs `aio login` with both stdout and stderr discarded and returns only success or a generic failure. Re-run the readiness script afterwards; a successful login command alone does not verify the selected org or environment.

## Step 4 — Select the org (the same as the connector's)

1. With one org from `get_organisations`, use it without asking, and say which org you're using. Otherwise use the org the developer picked in Step 3.
2. Run `aio console org list --json` and look for the chosen org's `id`. The CLI lists only orgs that can use App Builder. If the org is missing:
   - If any **other** org from `get_organisations` is in the CLI list, it's the same account and environment. The org doesn't have App Builder. Explain who can enable it, using the admin table in `references/concepts.md`, and offer an org that is listed.
   - If the CLI list shares no org with the connector, the CLI is signed in with a different Adobe account or environment. Offer to fix the environment (Step 3.2) or sign in again with the right account (`aio logout`, then Step 3.3).
3. If `selection.orgId` already equals the org's `id`, skip this. Otherwise run `aio console org select <org code>`, using the `code` from `get_organisations`. This also clears the CLI's selected project and workspace, which is expected.

## Step 5 — Adobe Developer Terms of Use

Call `get_projects` with the org and `filterBy: "all"`. The connector checks the Terms first: when they aren't accepted, or have been updated, it returns a message about the Developer Terms instead of projects.
- **Projects returned:** the Terms are accepted. Say nothing about them, and keep the list for Step 6 without showing it.
- **Terms message:** ask once: *"Adobe needs you to accept the Developer Terms of Use for <org name> before you can create App Builder projects. Please review them: https://www.adobe.com/go/developer-terms. Do you agree? (yes / no)"*
  - Only after an explicit yes, call `accept_developer_terms` with the org, then call `get_projects` again.
  - Anything other than an explicit yes: don't accept. Explain that App Builder projects can't be created without the Terms, and stop.
  - If accepting fails or the Terms message comes back, give the Developer Console link (https://developer.adobe.com/console) so they can accept there, and continue once they say it's done.

One acceptance covers the connector, Developer Console and the CLI.

## Step 6 — App Builder access (what you can and can't confirm)

Skip this if Step 4.2 found that the org lacks App Builder. Otherwise use the Step 5 project list:
- If any project's `type` is `jaeger` (App Builder's internal name; never show it), report *"Your org already has App Builder projects, so App Builder is likely enabled."*
- Otherwise report *"App Builder access is confirmed when your first project is created."*

This is never proof that the developer can create projects. If a later step fails because of access, use the admin table in `references/concepts.md` to say who can fix it and what to ask for.

## Step 7 — Summary

Show the final status table, including the Org, Developer Terms and App Builder access rows. Then:
- **What I did:** one bullet per change, each with the command or tool and why. For example: "`npm install -g @adobe/aio-cli`: installed the CLI that creates and deploys App Builder apps." "`aio config set cli.env prod`: pointed the CLI at Adobe's production systems, like the connector." Put all the read-only checks in one bullet.
- **Next step:** one line, for example *"Ready. Say 'create an App Builder app' to build your first app."*

Explain a term from `references/concepts.md` the first time it appears (CLI, org, Developer Terms). Don't repeat explanations.

## Rules

- Never print or read aloud `.env`, `.aio` or tokens. For assistant-run commands, use only these no-argument helpers for sensitive operations; do not retry the underlying CLI commands directly, even on failure:
  - `node "<skill-dir>/scripts/lib/cli-config.mjs"` returns only compact environment, sign-in status and selected org/project/workspace metadata. Prefer it when broader configuration details are not needed.
  - `node "<skill-dir>/scripts/config.mjs"` replaces `aio config list` and returns environment, sign-in status, selected org/project/workspace metadata, and allowlisted details from the `console`, `project` and `workspace` nodes when present: names and ids, project descriptions, action URLs, API metadata, event registration metadata, and credential id/name/type only. Unknown fields are omitted at every level, and text values are redacted; `ims`, `aio-dev`, runtime credentials and other top-level configuration are omitted. `readiness.mjs` uses the same implementation but keeps its compact status output.
  - `node "<skill-dir>/scripts/runtime-properties.mjs"` replaces `aio rt property get` (including its aliases) and returns namespace, API host/version, CLI version, and API build version/number. Build information requires a separate network lookup with a 5-second timeout; unavailable build fields return `null` with a warning while local properties remain visible. It never requests auth, certificate or private-key properties.
  - `node "<skill-dir>/scripts/login.mjs"` replaces token-returning sign-in (`aio login` / `aio auth login`; do not substitute `aio app login`). Both output streams are discarded.
- These helpers suppress raw CLI errors too. If a helper fails repeatedly, ask the developer to check the command in their own terminal without pasting credentials or raw configuration into chat.
- The standalone `scripts/lib/cli-config.mjs` snapshot retains its no-argument contract and fixed 60-second command timeout / 64 MiB capture limit; it reads bounded configuration metadata, not bulk lookup results. Metadata validation (256-character compact selection strings) and the 60-second token-validity margin also stay fixed so flags cannot make malformed metadata look valid or nearly expired credentials look ready.
- Install, update, sign in or change the environment only after the approval in Step 3. Selecting the org needs the developer's pick, unless there's only one org.
- Show names, not raw IDs, except where an ID is the only way to tell two orgs apart.
- If a command fails for a reason not covered here, call `search_adobe_docs` with the exact error text before guessing.
- This skill doesn't create projects or apps. It hands off to `app-builder-create-app`.
