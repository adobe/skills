---
name: appbuilder-workfront
description: "Use when orienting, onboarding, or planning before a concrete task — the entry point for building a customized Workfront UI on Adobe App Builder. Reach for this whenever the user is: brand new to Workfront UI extensions and asking where to start or what the process looks like; describing a Workfront customization idea and asking how to build it; asking for the end-to-end roadmap (set up → scaffold → build → test → deploy → publish); or asking how the React/Spectrum SPA, the serverless Runtime actions, and the Workfront extension points fit together. This umbrella routes each stage to its skill: workfront-ui-extension (front-end SPA + extension points), workfront-actions (Runtime actions + Workfront Public API v21), workfront-local-testing (previewing a build inside Workfront); machine setup and aio app init live in appbuilder-project-init. Skip it and go straight to the matching sub-skill when the user already has one specific task."
license: Apache-2.0
---

# Workfront UI extensions on App Builder

A customized Workfront UI, built as an **App Builder** app. It has two halves:

- a **front end** — the screens the user sees. Built with React/Spectrum (Adobe's UI toolkit); in App Builder terms it's the **SPA** ("single-page app"). → `workfront-ui-extension`
- a **back end** — small functions that run in Adobe's cloud (**Runtime actions**; "serverless" = you write the function, Adobe runs it, no server to manage). They hold the credentials and call the Workfront / Planning / Adobe APIs. → `workfront-actions`

The front end plugs into Workfront at fixed spots called **extension points**: a **Main Menu** button, an item in an object's **left panel**, or a **widget** embedded inside a custom form.

## End-to-end flow → which skill

| Step | What you do | Skill |
|------|-------------|-------|
| 0–1. Set up + create project | Node 20, install `@adobe/aio-cli`, `aio login`, pick IMS org, stage vs prod, **create the project** (Developer Console or `aio console project create`) | `appbuilder-project-init` |
| 2. Scaffold | `aio app init` with template **`@adobe/workfront-ui-ext-tpl`**; pick extension points | `appbuilder-project-init` + this skill's `references/commands.md` |
| 3. Build front end | Extension points (Main Menu, `secondaryNav`, widgets), routing, shared context, `actionWebInvoke` | `workfront-ui-extension` |
| 4. Build back end | Action anatomy, config, auth, inputs; call Workfront (Public API v21) / Planning / services | `workfront-actions` |
| 5. Run + test in Workfront | `aio app dev`, then `extensionOverride` (local build) or **Extension Manager / BYO** (deployed app, no publish) | `workfront-local-testing` |
| 6. Deploy | `aio app deploy` | `references/commands.md` |
| 7. Publish (org-wide) | Submit for approval from the **Production** workspace; make sure Production has every API/service your actions need. Not required for BYO/override testing. | — (see below) |

> **Publishing** makes the app available to everyone in the IMS org without an `extensionOverride`. Deploy from the **Production** workspace (`aio app deploy`), then submit for approval in the Developer Console / App Builder distribution UI (guide: `https://developer.adobe.com/uix/docs/guides/publication/`). To use a deployed app in one org **without** approval, register its URL in Workfront's **Extension Manager (Bring Your Own extension)** instead — see `workfront-local-testing`. After deploy, the app's **direct link** is the Experience Cloud shell URL `…/workfront/custom-applications/<extensionId>/<menuRoute>` (not the bare CDN) — build and hand it over per `workfront-local-testing`.

> **Hit a wall?** A symptom → cause → fix table of the real gotchas (Node/`aio` errors, the Main Menu `id` trap, `401 Org Id undefined`, BYO testing, and more) is in [`references/troubleshooting.md`](references/troubleshooting.md). The full `aio` command catalog is in [`references/commands.md`](references/commands.md).

## Plain-language glossary

| Term | In plain words |
|------|----------------|
| SPA / front end | The app screens the user sees inside Workfront. |
| Runtime action / "serverless" | A small function in Adobe's cloud that does the real work (fetching/saving data) and keeps credentials off the user's browser. |
| Extension point | A spot where your app appears in Workfront: the Main Menu, an object's left panel, or a custom-form widget. |
| Shared context | Info Workfront hands the app automatically — who's signed in, which object they're on, the instance URL. |
| `actionWebInvoke` | How the front end calls a back-end action. |
| IMS org | Your Adobe organization (identity / login). |
| Developer Console / workspace | Adobe's web admin where the project and its Production / Stage environments live. |
| Layout template | The Workfront admin setting that decides where an app actually shows up for users. |

## Invariants for the whole family

- **Auth comes from `sharedContext`** (`imsToken`, hostname) — Workfront hands the app the signed-in user and instance, so **never build a custom login**.
- **The browser never calls Workfront/Adobe APIs directly** — always through a Runtime action via `actionWebInvoke`, so login tokens stay on the server. (The IMS org id is already in `sharedContext` at `auth.imsOrgID` — no WF call needed.)
- Actions are **CommonJS** (`exports.main`; not ESM); secrets/inputs flow `.env` → action `inputs` → `params`, and are **never** read from `process.env` at runtime.
- Node **20**. The default environment is **prod** (live); targeting **stage** (test) needs `AIO_CLI_ENV=stage` plus a re-login.
- Workfront Public API is **v21.0**; custom `DE:` fields need `{field}_Mod=notblank` on search/count.
