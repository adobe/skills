# App code patterns (verified against the generated templates)

Read the generated files before changing anything. Keep the generated bootstrap and registration code, the extension folder name and the extension `id`. Change the components and actions they point to.

## Layout

```
app.config.yaml                  # lists extensions: <extension point> → $include src/<ext-folder>/ext.config.yaml
src/<ext-folder>/
  ext.config.yaml                # web-src + actions + runtimeManifest (action definitions)
  actions/<action>/index.js      # backend actions (Node.js, run on I/O Runtime)
  web-src/src/                   # React Spectrum UI
    index.js                     # bootstrap; don't rewrite
    components/                  # your UI; ExtensionRegistration.js registers the extension (UIX surfaces)
    config.json                  # action URLs, generated at build or run time; never edit by hand
    utils.js                     # actionWebInvoke helper
.env, .aio                       # credentials and project link; never read, print or commit
```

## Bootstrap and registration

- **Experience Cloud Shell** (`web-src/src/index.js`): `import Runtime, { init } from '@adobe/exc-app'`, then `init(bootstrapInExcShell)`, `const runtime = Runtime()`, and `runtime.on('ready', ({ imsOrg, imsToken, imsProfile }) => { runtime.done(); … })`. **`register()` and `runtime.ready()` don't exist in `@adobe/exc-app`.** Never add them. The app receives `ims = { org, token, profile }` as props.
- **AEM, Universal Editor and Workfront extensions** (`components/ExtensionRegistration.js`): `register({ id: extensionId, methods: { … } })` from `@adobe/uix-guest`. Dialogs, panels and rails connect with `const guestConnection = await attach({ id: extensionId })`.
  - Read the user's token from `guestConnection.sharedContext`. The AEM Content Fragments console uses `sharedContext.get('auth')` → `{ imsToken, … }` and `sharedContext.get('aemHost')`. Universal Editor uses `sharedContext.get('token')`. For other surfaces, look up the keys with `search_adobe_docs` (for example *"UI extension sharedContext auth <product>"*) instead of guessing.
  - Close a dialog with `guestConnection.host.modal.close()` (Content Fragments) or `guestConnection.host.modal.closeDialog()` (Assets View).
- **Acting on selected items** (Content Fragments action bar, Assets View action bar): the button's `onClick(selections)` receives the selected items, but the generated code passes only `selections[0].id` in the dialog route. To work on every selected item, pass all ids. For example, change the route to `/<id>-modal?ids=${encodeURIComponent(selections.map((s) => s.id).join(','))}` and read them in the dialog with `new URLSearchParams(useLocation().search).get('ids')`.

## Calling an action from the UI

```js
import allActions from '../config.json'
import actionWebInvoke from '../utils'

const headers = { authorization: `Bearer ${token}`, 'x-gw-ims-org-id': imsOrg }
const result = await actionWebInvoke(allActions['<ext-folder>/<action>'], headers, { /* params */ })
```

- Keys are `"<package>/<action>"`, and the package is the extension folder name, for example `dx-excshell-1/generic` or `aem-cf-console-admin-1/generic`. The exception is Experience Hub, whose actions are declared in `app.config.yaml` under a package named after the project folder, for example `team-hub/generic`. `aio app build` also writes bare names (`generic`), but `aio app dev` doesn't, so always use the `<package>/<action>` form.
- The Experience Cloud Shell `utils.js` throws on a non-2xx response. The extension templates' `utils.js` returns the error body instead, so check `result.error`.

## Adding or changing an action

`aio app add action` asks questions interactively, so edit the files directly:

1. Create `src/<ext-folder>/actions/<name>/index.js`. Copy the structure of the generated `generic` action: `Core.Logger`, input checks with `checkMissingRequestInputs`, `errorResponse` for failures, and return `{ statusCode, body }`.
2. Declare it in `src/<ext-folder>/ext.config.yaml` under `runtimeManifest.packages.<ext-folder>.actions`:

```yaml
<name>:
  function: actions/<name>/index.js
  web: 'yes'
  runtime: nodejs:22
  inputs:
    LOG_LEVEL: info
  annotations:
    require-adobe-auth: true
    final: true
```

- `require-adobe-auth: true` means only signed-in Adobe users of the org can call the action, and the UI must send `authorization` and `x-gw-ims-org-id`. `aio app dev` only checks that those headers are present; it logs `401 Unauthorized`, and the reason is in the response body. A deployed action also validates the token, and when deployed it becomes two entries: `<package>/<action>` (the sign-in check) and `<package>/__secured_<action>` (your code).
- The generated `generic` action requires an `Authorization` header and calls an example endpoint: the I/O Runtime API URL in Experience Cloud Shell apps, or `params.API_ENDPOINT` (empty in `.env`) in the AEM templates. Replace its body with the real logic.
- Secrets go in `.env` (for example `MY_SERVICE_KEY=…`, which the developer adds themselves) and are mapped as `inputs: { MY_SERVICE_KEY: $MY_SERVICE_KEY }`. Never hard-code or print them, and don't log `params` wholesale: inputs from `.env` are part of it. Keep `LOG_LEVEL: info`; the templates' `debug` level logs every parameter.
- Web actions must finish within 60 seconds. Set a lower limit per action with `limits: { timeout: <ms> }`. When an action throws or runs out of time, a web call returns `400 {"error":"Response is not valid 'message/http'."}`, and the cause is in the action's activation (see the troubleshoot skill).

## Data sources

If the developer's request names data the app can't reach yet (for example *"my team's projects"* with no API decided), build the UI against clearly labelled sample data returned by an action. Say so in the summary. Connecting a real Adobe API is a separate, later step.

## Validate

Run `aio app build` after changes. Fix the errors it reports, then run the app locally.
