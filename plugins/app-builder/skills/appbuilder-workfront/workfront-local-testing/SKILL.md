---
name: workfront-local-testing
description: "Use when making Workfront load your locally running App Builder extension, or when a local extension that worked before has stopped appearing. Reach for this whenever the user is: trying to preview their local build inside Workfront before deploying; setting `extensionOverride` in localStorage but Workfront still shows the published version; seeing buttons, widgets, or left-panel items not appear in Workfront even though `aio app dev` is running; hitting a cert warning on localhost that blocks Workfront from loading the extension; seeing a local extension silently break after a Chrome update (Chrome 142+ blocks localhost connections); asking what value to set `extensionOverride` to and exactly where to set it in the browser; asking whether a custom-form widget should appear in the field picker; or wondering if Workfront admin rights are needed to see locally-loaded extension points. Separate from `appbuilder-workfront` (the umbrella) and `appbuilder-project-init` (scaffolding / dev server)."
license: Apache-2.0
---

# Test a local extension inside Workfront

After `aio app dev` (command catalog in `appbuilder-workfront` → `references/commands.md`) you have a localhost URL. This makes Workfront load your **local** app instead of (or alongside) published ones — no deploy required.

## 1. extensionOverride (the key step)

In the browser, on your Workfront tab (`*.workfront.com` or `*.workfront.adobe.com`):
DevTools → **Application → Local Storage** → add an entry:

- key: `extensionOverride`
- value: your dev URL, e.g. `https://localhost:9080`

Take the exact URL/port from the `aio app dev` output. Reload the layout-template page — your extension's buttons/widgets appear.

> For **custom-form widgets**, the widget picker lists locally-active apps when the override is set (surfaced as `extensionoverride=TRUE`).

## Deployed app, no publish? Extension Manager (Bring Your Own)

`extensionOverride` points Workfront at a **local** (`localhost`) build. To use a **deployed** app (its CDN URL) in an org **without** the prod publish + approval process, register it in **Extension Manager**:

Workfront → **Extension Manager** — always give the user the direct link (pick the org in the switcher if `@<org>` differs):
- Stage: `https://experience-stage.adobe.com/#/@<org>/workfront/extension-manager`
- Prod: `https://experience.adobe.com/#/@<org>/workfront/extension-manager`

(If the org has more than one Workfront instance, the shell scopes the link with a `so:<instance>` segment before `/workfront/` — `…/@<org>/so:<instance>/workfront/extension-manager`. If the link lands on the wrong instance, copy `@<org>`/`so:<instance>` verbatim from a Workfront page you're already on.)

→ **Bring Your Own extension**, then fill in (always list these fields):

- **Extension Url** — the deployed app's `index.html`, e.g. `https://<namespace>.dev.runtime.adobe.io/index.html`
- **Extension Name**, **Description**, **Support Email**

**Save**, then **toggle it on** under *Installed Extensions* — it defaults to **Disabled**. No cert / Chrome-flag hassle (it's a real HTTPS CDN URL) and no approval. Then place it via a layout template (below).

Three tiers, least → most permanent: `extensionOverride` (local build) → **Extension Manager / BYO** (deployed app, one org, no approval) → **publish** (org-wide, needs approval; see `appbuilder-workfront`).

## Open the deployed app — the direct link

Once the app is deployed **and** registered in that instance (BYO-enabled above, or published), the Main Menu button opens a real, shareable Experience Cloud URL. After `aio app deploy`, **hand the user this link** so they can open the app directly:

```
https://experience{-stage}.adobe.com/#/@<org>/so:<instance>/workfront/custom-applications/<extensionId>/<menuRoute>
```

e.g. `https://experience-stage.adobe.com/#/@workfrontaidevarm/so:ai-dev-arm-Dev/workfront/custom-applications/combined-timeline-view/combined-timeline`

| Segment | Source |
|---|---|
| `experience-stage` / `experience` | stage vs prod — the env you deployed to (`AIO_CLI_ENV=stage` → `experience-stage`) |
| `@<org>` | org handle (e.g. `@workfrontaidevarm`) — **copy from a Workfront page the user already has open**; don't derive it from the org name |
| `so:<instance>` | selects the Workfront instance (e.g. `so:ai-dev-arm-Dev`) — copy verbatim from that same URL (the segment right after `@<org>`) |
| `<extensionId>` | the registration `id` — the non-empty `extensionId` in `Constants.js` (the `id` passed to `register()`) |
| `<menuRoute>` | the Main Menu item's route — the `#/` fragment of its `getItems()` `url` (`…#/combined-timeline` → `combined-timeline`); matches the `<Route path>` in `App.js` |

`aio app deploy` prints the CDN URL but **not** `@<org>` or `so:<instance>` — those are tenant/env facts. Reliable recipe: you already know `<extensionId>` and `<menuRoute>` from the code you built; take the whole prefix **up to and including `/workfront/`** from a live Workfront page (or the Extension Manager link above) and append `custom-applications/<extensionId>/<menuRoute>`.

Two traps: the **bare CDN** `…/index.html#/<menuRoute>` renders with no Workfront host → no `sharedContext`; and the second path segment must be the **real menu route** — reusing the app id there (`…/<extensionId>/<extensionId>`) loads the background registration frame, not the view.

## 2. Accept the dev certificate

If you haven't already, open `https://localhost:<port>` directly → *Advanced → Proceed to localhost (unsafe)*. Workfront can't load your app until the self-signed cert is trusted.

## 3. Chrome 142+ Local Network Access

Chrome 142+ blocks a public origin from reaching localhost and will **silently** break the override. Disable the check:
`chrome://flags/#local-network-access-check` → **Disabled** → Relaunch.

## 4. Make the app visible

Extension points only render where a layout template places them. **Toggling a BYO extension to Enabled is not enough by itself** — until it's placed in a layout template's Main Menu (or an object's left panel), it's registered but invisible to every user, including you.

Concrete click path for Main Menu placement (Workfront web UI):

1. **Setup** (Main Menu → Setup, bottom of the menu) → **Interface** (expand it in the left sidebar) → **Layout Templates**.
2. Pick the template actually assigned to **your** user — don't blindly edit a shared/`Default template`, since that affects every user assigned to it; a personally-named template (or checking the layout template's **Assignments** panel) is the safer target for testing.
3. Open it → click **Set Main Menu** (top-right, under "Main Menu").
4. Find your app's tile in the grid — **greyed out with a `+` icon means it's not yet placed**; click it to toggle it active (it turns blue with a `-` icon, next to the other already-placed custom apps).
5. **Done** (closes the Main Menu dialog) → **Save and close** (top of the layout template editor) — the dialog's Done alone does not persist the change.
6. Reload the Workfront tab and open **Main Menu** — the item now appears alongside the native items.

### Do this yourself via Playwright/browser MCP — don't ask the human to click through it

Everything above (Extension Manager registration, the Enabled toggle, the entire Layout Template → Set Main Menu flow) is ordinary UI navigation once a session is authenticated — an agent with browser automation (Playwright MCP) should drive it directly instead of asking the user to do the clicking. The only steps that genuinely require the human are the ones no tool can do on someone's behalf: completing Adobe SSO/MFA (entering a password or approving an MFA prompt), and giving informed consent to a legal agreement (e.g. accepting Developer Terms of Use — read the actual terms before clicking "Accept" on someone's behalf, or better, have the human click it after you've navigated them to the exact screen). A fresh Playwright browser session starts **logged out** — get the human to sign in once in that session, then keep driving every subsequent screen (Extension Manager, Setup, Layout Templates, dialogs, toggles) yourself. Don't default to "please open X and click Y" for steps that are just navigation; that's the point of having browser automation available.

## Not showing up? Checklist

- Is `aio app dev` still running, and is the exact `https://localhost:<port>` in `extensionOverride`?
- Cert accepted? Chrome LNA flag disabled (Chrome 142+)?
- Are you on the **right Workfront domain's** Local Storage?
- Registered via **Extension Manager (BYO)** instead? It defaults to **Disabled** — toggle it **on** under *Installed Extensions*.
- Does a layout template that includes your app actually apply to you?
- Do the `id`/`url` in `ExtensionRegistration` match a real route in `App.js`? (see `workfront-ui-extension`)
- Is `extensionId` **non-empty**, and is `id: extensionId` kept **under `methods`** in `register()`? An empty `extensionId`, or dropping `id` from `methods`, makes the item register but silently not render (see `workfront-ui-extension`). This is the usual cause — before blaming the environment, check this.
- **Registers but still missing from the *live* menu** (it shows in the layout-template picker, and the console shows the host calling `getItems`)? Suspect the **Workfront environment**, not your code — a shell error like `…/jumpseat/api/…/configuration 503` or "Detected multiple done events" breaks nav rendering. Reload later or try a healthy instance.
- `extensionOverride` is only for **unpublished** apps. For the item to appear in the live menu **without** an override, the app must be **published** (submit + approve from Production — see `appbuilder-workfront`).
