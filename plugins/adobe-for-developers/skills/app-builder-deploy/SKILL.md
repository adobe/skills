---
name: app-builder-deploy
description: Use when a developer wants to deploy an Adobe App Builder app or extension — phrases like "deploy my app", "deploy to Stage", "deploy to Production", "ship this to Production", "push my App Builder app live", "release my extension", "my deploy failed", "why was my deploy skipped", "publish my app to the org". Runs a read-only check and summary first, confirms the target (Production needs an explicit yes and the same Adobe APIs as Stage), deploys with the aio CLI, reports what really happened (including skipped deploys of published apps), and explains Stage vs Production and deploy vs publish.
license: Apache-2.0
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).

# Deploy an App Builder app

Deploy the app in the current folder to Stage or Production safely, and report what actually happened. One confirmation per deploy. Production needs the word "Production" in that confirmation.

`<skill-dir>` below is the folder containing this SKILL.md. Run scripts as `node "<skill-dir>/scripts/<name>.mjs"` from the **app folder** (the one with `app.config.yaml`).

## Step 0 — Report skill context

Call `report_skill_context` once with `skill_name: "app-builder-deploy"` and `skill_version: "1.0.0"`.

## Step 1 — Read-only check

1. No shell on the developer's **own computer**? Explain that deploying runs from the machine that holds the app's code and CLI sign-in, so it needs a desktop or terminal assistant there, then stop. A shell in a hosted sandbox doesn't count.
2. Run `node "<skill-dir>/scripts/app-context.mjs"`. It prints the org, project and workspace the folder is linked to, plus each extension's actions (with their Node.js `runtime`) and whether it has a UI. Secrets are never included. If it returns `ok: false`:
   - **The CLI wasn't found:** hand off to `app-builder-setup`, then call `report_skill_context` again.
   - **Not linked:** offer the `app-builder-create-app` skill, or explain how to link the folder to an existing project.
   - **`aio app info` failed:** with consent, run `aio app build` to show the configuration error.
3. Confirm the link with the connector: `get_projects` for `org.id` (`filterBy: "all"`) must include `project.id`. If it returns the Developer Terms message instead of projects, follow the Terms rule below first. A mismatch means the folder belongs to a project in another org or environment. Explain this and stop.
4. **Check the action runtimes.** Any action with a runtime older than `nodejs:20` (for example `nodejs:16`) will be rejected. Offer to change it to `nodejs:22` in `src/<extension folder>/ext.config.yaml` before deploying.

Describe extensions in plain words: `dx/excshell/1` is the Experience Cloud Shell app; `aem/cf-console-admin/1` the Content Fragments console; `aem/cf-editor/1` the Content Fragment editor; `aem/assets/*` Assets View; `aem/launchpad/1` Experience Hub; `universal-editor/ui/1` Universal Editor; `workfront/ui/1` Workfront; `application` a standalone app. Show actions by their names without the package prefix.

## Step 2 — Choose and check the target

- The default target is the workspace the folder is linked to (normally Stage). The developer can name another one.
- Resolve workspace ids with `list_workspaces` (org id, project id). If the target isn't in the list, stop. Never let the CLI create a workspace.
- **Production only:** Production must have the **same** Adobe APIs as Stage. For Stage and Production, call `get_credentials`, then `get_credential_services` for every credential. Compare the two sets of `sdkCode`s in both directions.
  - If any call fails, stop and say the check couldn't complete.
  - **Missing in Production** (Stage has it): list them by name and explain that the app would fail in Production when calling them. Offer the `dev-console-subscribe-api` skill to add them to the Production workspace.
  - **Extra in Production** (Stage lacks it): list them by name. Explain that Stage then doesn't test what Production runs. Offer to add them to Stage with the `dev-console-subscribe-api` skill, or to remove them from Production with the `dev-console-unsubscribe-api` skill.
  - Repeat the check after any change. Don't deploy to Production until the two sets are equal.
  - This compares APIs, not product profiles. Mention that profiles are set per workspace too.
- **Production and a standalone app** (`application`, no extensions): the CLI doesn't check whether a standalone app is published, so a deploy replaces what users see right away. Say so.

## Step 3 — Summary and one confirmation

Summarize in plain words and ask once:
- **Stage:** *"This will deploy **<project title>** to **Stage**: <n> actions (<names>) and the <extension> UI. They're uploaded to Adobe and replace the current Stage version. Deploy now?"*
- **Production:** *"This will deploy **<project title>** to **Production**, which real users of <org> can reach once the app is approved. Reply 'deploy to Production' to continue."* Proceed only on an unambiguous Production confirmation.

This consent covers the deploy and one retry after an agreed fix (Step 6), on the same target.

## Step 4 — Prepare

- If you started `aio app dev` in this conversation, stop that exact process first.
- **Guarded workspace switch** (only if the target differs from the linked workspace):
  1. Run `aio app use -w <target workspace id> --no-input < /dev/null` (PowerShell: `$null | aio app use -w <id> --no-input`).
  2. If the id isn't found, the CLI asks "Do you wish to create a new workspace?". With no input it aborts (exit code 130) and creates nothing. Report this and stop. Never pass a workspace name.
  3. Re-run `app-context.mjs` and check that `workspace.id` equals the target id. If it doesn't, stop and report.
  4. Run `aio app clean`. The CLI keeps one local record of the action code it last uploaded from this computer, shared by all workspaces, in the `dist` folder. Without this, unchanged actions are skipped in the new workspace. A real test showed the secured action's web entry point missing (404) while the CLI still printed "Successful deployment". `clean` deletes only local build output.
- **Shared workspace:** if others (a teammate, CI or another computer) may also deploy to this workspace, as is usual for Production, run `aio app clean` too. That local record only knows this computer's uploads, so without it the deploy can skip actions someone else has since replaced, leaving their code live. If you can't tell, ask in the Step 3 confirmation.

## Step 5 — Deploy

Note the time first (`node -e "console.log(Date.now())"`), then run `aio app deploy 2>&1` in the app folder with a 15-minute timeout (usually under a minute), and capture the output. The skip and hook messages go to stderr, so both streams are needed.
- Use `aio app deploy -a <action>` (one action, faster) only when the developer asks, and only on Stage. It skips the published-app check and the extension registration. Afterwards, judge only that action in the Step 6 check: other actions listed as `missing` or `stale` were not part of this deploy. Retry with the same `-a`, and ask before running a full deploy.
- Never add `--force-deploy`, `--force-publish` or `--force-events`, and never run `aio app undeploy`, on your own initiative. The only exception is the published-app override below.

## Step 6 — Report the real outcome

Classify the output. Don't rely on the exit code:

| Output | Report |
|---|---|
| `deployment will be skipped` | **Skipped:** the Production app is published, so nothing was updated. |
| `skipped by hook` | **Partial:** name the part that was skipped. |
| Non-zero exit or an error | **Failed:** nothing new is live for the part that failed. Use `references/deploy-failures.md`, offer the fix, and retry once after consent. |
| `Successful deployment` and none of the above | **Deployed**, once `verify-actions.mjs` passes (below). `Deployed <n> action(s)` may count fewer actions than the app has, and `No actions deployed` means the code was unchanged since the last upload from this computer. Both are fine if the check passes. |
| Anything else | **Unconfirmed:** say so and show the last relevant lines. |

For a deployed app, verify and share:
- **Actions:** run `node "<skill-dir>/scripts/verify-actions.mjs"`. It checks that every action of the app exists in the linked workspace, including a secured action's two entries. After `aio app clean` in Step 4 (a workspace switch or a shared workspace, where every action uploads again), add `--since <time noted before the deploy>`. This compares a local clock with Runtime's server timestamps: `stale` means freshness is **Unconfirmed**, not proof that the deploy left old code live.
  - Operational limits are configurable with `--max-pages 40` (per package), `--page-size 50`, `--command-timeout-seconds 60` and `--max-output-mb 64` (MiB per captured CLI stream). These are the defaults; each takes a positive whole number. Timeout and buffer settings also apply while reading app configuration. Page size stays within Runtime's documented 1–50 range, numeric conversions must remain safe, and the buffer cannot exceed Node's string-size limit.
  - Reaching the page budget returns `ok: false` with `verified: false`, never a partial inventory reported as missing actions. Increase `--max-pages` to read more; do not treat an incomplete inventory as deployment failure.
  - `missing` not empty: run `aio app clean`, deploy once more (with the same `-a` after a one-action deploy), and verify again. Report **Partial** if anything is still missing.
  - `stale` not empty: report **Unconfirmed** and explain `freshnessWarning`. Check that the local clock is synchronized before concluding the code is old. Don't clean or redeploy solely because of this comparison, and don't widen the time threshold to make it pass: doing so could accept genuinely stale code.
  - `unknownUpdate` not empty: the CLI didn't report when those actions were last updated, so freshness can't be confirmed. Report them as **Unconfirmed**.
  - `ok: false` with an `error` (the check itself couldn't run): report the deploy as **Unconfirmed**, not as deployed.
  - `uiOnly: true`: the app has no actions, and the UI link below is the check.
- **UI link:** the line after `To view your deployed application:`. For Experience Cloud Shell apps, also the link after `in the Experience Cloud shell:`. For AEM extensions, use the Extension Manager preview link after `follow the URL:`, and ignore the Experience Cloud Shell link that the CLI prints for every app.
- **Action links:** the lines under `web actions:` in the deploy output, or `aio app get-url --json`. A secured action answers `401` when opened directly in a browser; that is expected.

**Skipped (published app):** recommend the normal path. An org admin retracts the app in Adobe Exchange, which makes it unavailable to the org until it's approved again. Then deploy and submit it for approval again. Offer to deploy to Stage meanwhile.
- If the developer still asks to force it, explain that `aio app deploy --force-deploy` replaces the approved live app for every user in the org, without a new review.
- Require a new reply containing "force deploy to Production". Then use only `--force-deploy`, never `--force-publish` or `--force-events`.

**After any Production attempt** (deployed, skipped, partial or failed), switch the folder back to Stage with the guarded switch. Later local runs and deploys then won't touch Production. Tell the developer you did it.

## Step 7 — Explain

- **What I did:** one bullet per change (deploy, workspace switch, clean, file edits), each with the command and why.
- **Stage vs Production:** Stage is for testing and Production is for real users. Each has its own URLs, credentials and APIs.
- **Deploy vs publish:** deploying uploads the app. The CLI's own "publish" step only registers the extension in that workspace. To make a Production app available to everyone in the org, submit it for approval in Adobe Developer Console (project → Production → Submit for approval). An org admin then approves it in Adobe Exchange. That step stays manual.
- **Rollback:** check out the previous version of the code and deploy again.
- **Next step:** try the link. If something fails at runtime, say "troubleshoot my app".

## Rules

- Never print or read aloud `.env`, `.aio` or tokens. Use `app-context.mjs` for project details.
- No deploy without the Step 3 confirmation. Production needs an explicit "Production" in it.
- Show names, not raw IDs, in the conversation.
- **Developer Terms:** if a connector tool returns the Developer Terms message instead of data, run the Terms flow from `app-builder-setup` Step 5 (show the Terms link, and call `accept_developer_terms` only after the developer explicitly agrees), then retry the call. Never read that message as an empty list or a mismatch. If they don't agree, stop.
- If an error isn't covered, call `search_adobe_docs` with the exact error text before guessing.
