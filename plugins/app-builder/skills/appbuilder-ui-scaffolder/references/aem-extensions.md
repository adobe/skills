# AEM UI Extension Patterns

Patterns for building AEM UI Extensions using `@adobe/uix-guest`. These extensions customize AEM surfaces (Content Fragment Console, Content Fragment Editor, Universal Editor, Assets View, Content Hub) and run as App Builder apps inside iframes.

**Key difference from `@adobe/exc-app`:** ExC Shell apps use `register()` from `@adobe/exc-app` with `runtime.done()`. AEM extensions use `register()` from `@adobe/uix-guest` with a `methods` object that declares extension points. The two are completely separate APIs.

## Core Registration Pattern

Every AEM extension starts with `register()` from `@adobe/uix-guest`. This establishes a two-way communication channel between your extension (guest) and the AEM surface (host).

```js
import { register } from "@adobe/uix-guest";

const guestConnection = await register({
  id: "my.company.extension-name",  // unique ID, use reverse-domain
  methods: {
    // Declare extension points here — each key is a namespace
    // e.g. actionBar, headerMenu, contentFragmentGrid, rte
  },
});
```

### `register()` vs `attach()`

- **`register()`** — Used on the extension's entry page. Declares capabilities (extension points) and returns a connection object. Call once on load.
- **`attach()`** — Used on secondary pages (e.g., modal content). Reconnects to an already-registered extension. Does NOT declare capabilities.

```js
// In a modal page loaded by the extension
import { attach } from "@adobe/uix-guest";

const guestConnection = await attach({
  id: "my.company.extension-name"  // must match the id used in register()
});
// Now use guestConnection.host.modal.close(), guestConnection.sharedContext, etc.
```

### Shared Context (Authentication)

All AEM surfaces expose `sharedContext` on the connection object for auth and environment info:

```js
const context = guestConnection.sharedContext;
const aemHost = context.get("aemHost");       // e.g. "author-p12345-e67890.adobeaemcloud.com"
const imsOrg = context.get("auth").imsOrg;    // IMS org ID
const imsToken = context.get("auth").imsToken; // Bearer token for AEM API calls
const apiKey = context.get("auth").apiKey;      // API key for Adobe services
const locale = context.get("locale");           // User's locale
const theme = context.get("theme");             // "light" or "dark"
```

Use `imsToken` and `aemHost` to make authenticated AEM API calls from your extension.

### Extension Point Configuration (`ext.config.yaml`)

Each extension declares which AEM surface it targets in `ext.config.yaml`:

```yaml
operations:
  view:
    - type: web
      impl: index.html
extensions:
  aem/cf-console-admin/1:    # Content Fragment Console
    - type: web
      impl: index.html
```

Extension point identifiers:
- `aem/cf-console-admin/1` — Content Fragment Console
- `aem/cf-editor/1` — Content Fragment Editor
- `aem/universal-editor/1` — Universal Editor
- `aem/assets/1` — Assets View (requires Assets Ultimate license)
- `aem/assets/contenthub/1` — Content Hub (unified — asset details, card, selection bar, and add-assets surfaces via one `register()` call)

---

## Content Fragment Console Extensions (`aem/cf-console-admin/1`)

The CF Console lists and manages content fragments. Extensions can add action bar buttons (for selected fragments), header menu buttons (global actions), and custom grid columns.

### Action Bar (`actionBar` namespace)

Buttons appear when the user selects one or more content fragments. The `onClick` callback receives the selected fragments.

```js
const guestConnection = await register({
  id: "my.company.cf-console-ext",
  methods: {
    actionBar: {
      getButtons() {
        return [
          {
            id: "my.company.export-btn",
            label: "Export",
            icon: "Export",           // React Spectrum workflow icon name
            onClick: (selections) => {
              // selections = array of selected fragment objects
              console.log("Selected fragments:", selections);
              // Open a modal for custom UI:
              guestConnection.host.modal.showUrl({
                title: "Export Fragments",
                url: "/index.html#/export-modal",
              });
            },
          },
        ];
      },
    },
  },
});
```

**Button API:** `{ id, label, icon?, variant?, subItems?, onClick(selections) }`
- `subItems` creates a dropdown menu; each sub-item has `{ id, label, icon?, onClick(selections) }`

**Getting selections programmatically:**
```js
const selections = await guestConnection.host.fragmentSelections.getSelections();
```

### Header Menu (`headerMenu` namespace)

Buttons always visible in the console header, independent of selection.

```js
methods: {
  headerMenu: {
    getButtons() {
      return [
        {
          id: "my.company.import-btn",
          label: "Bulk Import",
          icon: "Import",
          onClick: () => {
            guestConnection.host.modal.showUrl({
              title: "Bulk Import",
              url: "/index.html#/import-modal",
            });
          },
        },
      ];
    },
  },
}
```

**Button API:** `{ id, label, icon?, variant?, subItems?, onClick() }`
`variant` options: `cta`, `primary`, `secondary`, `negative`, `action`

### Grid Columns (`contentFragmentGrid` namespace)

Add custom columns to the fragment list view.

```js
methods: {
  contentFragmentGrid: {
    getColumns() {
      return [
        {
          id: "my.company.status-col",
          label: "Workflow Status",
          render: async (fragments) => {
            // Return { [fragment.id]: "rendered string" }
            return fragments.reduce((acc, fragment) => {
              acc[fragment.id] = fragment.status || "Draft";
              return acc;
            }, {});
          },
        },
      ];
    },
  },
}
```

**Column API:** `{ id, label, render(fragments), align?, allowsResizing?, width?, minWidth?, maxWidth? }`

### Modal Dialogs (available in all surfaces)

Open a modal from any extension point. The modal loads another page from your extension in an iframe.

```js
// From the extension's register page — open a modal
guestConnection.host.modal.showUrl({
  title: "My Extension Modal",
  url: "/index.html#/my-modal",  // relative to extension origin
  width: 600,
  height: "auto",               // auto-sizes to content
  fullscreen: false,
  isDismissable: true,
});
```

```js
// Inside the modal page — close it
import { attach } from "@adobe/uix-guest";
const guestConnection = await attach({ id: "my.company.cf-console-ext" });
guestConnection.host.modal.close();
```

**Modal API:** `{ url, title, width?, height?, fullscreen?, isDismissable?, loading? }`

### Host Utilities

```js
// Progress circle — blocks UI with spinner
guestConnection.host.progressCircle.start();
guestConnection.host.progressCircle.stop();

// Toast notifications
guestConnection.host.toaster.display({
  variant: "positive",  // "neutral" | "info" | "negative" | "positive"
  message: "Operation completed!",
  timeout: 5000,        // optional, ms
});
```

---

## Content Fragment Editor Extensions (`aem/cf-editor/1`)

The CF Editor is the authoring UI for individual content fragments. Extensions can add header menu buttons, customize the Rich Text Editor (RTE), and extend the properties rail.

### Header Menu (`headerMenu` namespace)

Same API as CF Console header menu, but context-aware — you can access the current fragment:

```js
const guestConnection = await register({
  id: "my.company.cf-editor-ext",
  methods: {
    headerMenu: {
      async getButtons() {
        return [
          {
            id: "my.company.validate-btn",
            label: "Validate",
            icon: "CheckmarkCircle",
            onClick: async () => {
              // Access the current content fragment
              const fragment = await guestConnection.host.contentFragment.getContentFragment();
              console.log("Fragment path:", fragment.path);
              console.log("Fragment fields:", fragment.fields);
            },
          },
        ];
      },
    },
  },
});
```

### Rich Text Editor — Custom Toolbar Buttons (`rte` namespace)

> **Note:** The RTE toolbar API is deprecated and will be replaced when AEM adopts a new RTE engine. It works today but plan for migration.

Add custom buttons to the RTE toolbar. The `onClick` callback receives the current editor state and returns instructions to modify content.

```js
methods: {
  rte: {
    getCustomButtons: () => [
      {
        id: "my.company.insert-disclaimer",
        tooltip: "Insert disclaimer",
        icon: "Info",
        onClick: (state) => {
          // state = { html, text, selectedHtml, selectedText }
          return [
            {
              type: "replaceContent",
              value: state.html + '<p class="disclaimer">Legal disclaimer text.</p>',
            },
          ];
        },
      },
    ],
  },
}
```

**Custom button API:** `{ id, tooltip, icon?, text?, onClick(state): Instruction[] }`

**Editor state:** `{ html, text, selectedHtml, selectedText }`

**Instructions:** `[{ type: "replaceContent", value: "new HTML" }]`

### Rich Text Editor — Badges (`rte` namespace)

> **Note:** Also deprecated with the RTE toolbar API.

Badges are non-editable inline blocks in the RTE, defined by prefix/suffix delimiters:

```js
methods: {
  rte: {
    getBadges: () => [
      {
        id: "my.company.variable",
        prefix: "{{",
        suffix: "}}",
        backgroundColor: "#D6F1FF",
        textColor: "#54719B",
      },
    ],
  },
}
```

Text like `{{variableName}}` renders as a styled badge in the editor.

### Rich Text Editor — Standard Button Control

Show or hide built-in RTE buttons:

```js
methods: {
  rte: {
    getCoreButtons: () => [
      { id: "h4", toolbarGroup: 3 },  // add H4 button to group 3
    ],
    removeButtons: () => [
      { id: "redo" },
      { id: "undo" },
    ],
  },
}
```

Common button IDs: `bold`, `italic`, `underline`, `strikethrough`, `h1`–`h6`, `bullist`, `numlist`, `link`, `unlink`, `table`, `code`, `blockquote`, `forecolor`, `backcolor`, `alignleft`, `aligncenter`, `alignright`

---

## Universal Editor Extensions (`aem/universal-editor/1`)

The Universal Editor is a visual editor for any content source. Extensions can add header menu buttons and custom properties rail panels.

### Header Menu (`headerMenu` namespace)

Same button API as CF Console/Editor:

```js
const guestConnection = await register({
  id: "my.company.ue-ext",
  methods: {
    headerMenu: {
      getButtons() {
        return [
          {
            id: "my.company.preview-btn",
            label: "Preview",
            icon: "Preview",
            onClick: () => {
              guestConnection.host.modal.showUrl({
                title: "Content Preview",
                url: "/index.html#/preview",
                fullscreen: true,
              });
            },
          },
        ];
      },
    },
  },
});
```

### Properties Rail Panels

Extend the right-side properties panel with custom panels. Use `attach()` in a separate page rendered inside the panel iframe:

```js
// Panel page (e.g., /index.html#/properties-panel)
import { attach } from "@adobe/uix-guest";

const guestConnection = await attach({
  id: "my.company.ue-ext",
});
// Access editor context via guestConnection.sharedContext
// Render your panel UI with React Spectrum components
```

Register the panel in `ext.config.yaml`:

```yaml
extensions:
  aem/universal-editor/1:
    - type: web
      impl: index.html
```

---

## Assets View Extensions (`aem/assets/1`)

> **Prerequisite:** Requires AEM Assets Ultimate license.

The Assets View supports custom side panels and action bar extensions. The registration pattern follows the same `@adobe/uix-guest` `register()` API.

```js
const guestConnection = await register({
  id: "my.company.assets-ext",
  methods: {
    // Extension points follow the same patterns:
    // actionBar, headerMenu for buttons
    // Custom panels rendered via modal or iframe
  },
});
```

Refer to [Assets View extension docs](https://developer.adobe.com/uix/docs/services/aem-assets-view/) for the latest available extension points, as this surface is newer and evolving.

---

## Content Hub Extensions (`aem/assets/contenthub/1`)

Content Hub is a single extension point that spans **four** surfaces, each opted into via a method namespace in one `register()` call:

- **Asset Details Dialog** (`assetDetails`) — custom tab panels in the side rail.
- **Asset card actions** (`card`) — buttons on asset cards (Assets grid, inside a collection, link-share) **and** on collection tiles in the Collections grid; the surface is passed in `actionContext.context`.
- **Selection bar / bulk actions** (`selectionBar`) — buttons in the multi-select action bar.
- **Add Assets wizard** (`addAssets`) — inject panels before/after the upload step, gate uploads, react to upload completion.

> Use the deprecated ID `aem/contenthub/assets/details/1` only for older projects mid-transition; new projects use `aem/assets/contenthub/1`.

**Auth is different from the other AEM surfaces:** Content Hub does *not* use `sharedContext`. Get auth and environment from the `host` namespaces instead (`host.auth.getIMSInfo()`, `host.discovery.getAemHost()` — see Host APIs below).

### Registration (all four namespaces)

```js
import { register } from '@adobe/uix-guest';

// `let` (not `const`): card/selectionBar onActionClick handlers reference the
// connection AFTER register() resolves, to open a modal via host.modal.openDialog().
let guestConnection;

guestConnection = await register({
  id: 'my.company.extension-name',   // reverse-domain; must match attach() calls
  methods: {
    assetDetails: {
      getTabPanels() { /* tab panels in the Asset Details Dialog */ },
    },
    card: {
      getActionButtons(actionContext) { /* buttons on asset cards + collection tiles */ },
      async onActionClick(resourceType, buttonId, resourceId, actionContext) { /* … */ },
    },
    selectionBar: {
      getActionButtons(actionContext) { /* buttons in the bulk-action bar */ },
      async onActionClick(buttonId, assetIds) { /* … */ },
    },
    addAssets: {
      getPanels() { /* wizard panels before/after the Upload step */ },
      async beforeUpload(ctx) { /* gate or enrich metadata before upload */ },
      async onUploadComplete(ctx) { /* react after upload finishes */ },
    },
  },
});
```

Opt into any combination — only implement the namespaces you use, and scaffold one component per namespace (`TabPanel.js` for `assetDetails`, `CardActionModal.js` for `card`, `SelectionBarModal.js` for `selectionBar`, `AddAssetsPanel.js` for `addAssets`). `card` and `selectionBar` are gated by the `EXTENSIBILITY_AEM_CONTENTHUB` feature flag; when it is off the host renders no buttons for those surfaces, but `assetDetails` panels still render.

`app.config.yaml` includes the unified extension point once:

```yaml
extensions:
  aem/assets/contenthub/1:
    $include: src/aem-assets-contenthub-1/ext.config.yaml
```

### Asset Details (`assetDetails`)

Adds tab panels to the Asset Details Dialog side rail. Content Hub manages toggling, deep-linking, and header rendering — the extension only provides the panel content via a hash route.

```js
assetDetails: {
  getTabPanels() {
    return [
      {
        id: 'my-panel',              // unique within this extension
        title: 'My Panel',           // panel header (Content Hub renders it)
        tooltip: 'My Panel',         // side-rail icon tooltip
        icon: 'Extension',           // React-Spectrum workflow icon name
        contentUrl: '/#tab-panel',   // hash route — must match a <Route> in App.js
      },
    ];
  },
}
```

Restrict to specific repos with an allow-list; leave it empty to load for any repo (safe for local dev):

```js
const allowedRepos = ['delivery-p12345-e167890.adobeaemcloud.com'];
const shouldSkipRegistration = (repo) => allowedRepos.length > 0 && !allowedRepos.includes(repo);
```

### Asset Card Actions (`card`)

Buttons on asset cards (Assets grid / inside a collection / link-share) and on collection tiles. One implementation serves every card surface — the host passes the surface in `actionContext.context`.

```js
card: {
  // actionContext.context: 'assets' | 'collection' | 'share' (asset cards) | 'collections' (collection tiles)
  getActionButtons(actionContext) {
    return [
      { id: 'my-card-action', label: 'Edit Metadata', icon: 'Edit' },  // card uses `label`, NOT `title`
    ];
  },
  // Exact arg order the host uses. Optional (host guards with ?.) — needed to open a modal.
  async onActionClick(resourceType, buttonId, resourceId, actionContext) {
    // resourceType: 'asset' (cards) | 'collection' (tiles); resourceId: the URN string
    await guestConnection.host.modal.openDialog({
      title: 'Edit Metadata',
      contentUrl: `/#card-action-modal?resourceId=${encodeURIComponent(resourceId)}&resourceType=${resourceType}`,
      type: 'modal',
      size: 'M',
    });
  },
}
```

Only `id`, `label`, `icon` are read for card buttons. Because `onActionClick` fires *after* `register()` resolves, declare `let guestConnection` so the handler can reference it.

### Selection Bar / Bulk Actions (`selectionBar`)

Buttons in the bulk-action bar shown when one or more assets are selected. The signature **differs from `card`**: no `resourceType`, and the click handler receives an **array** of asset IDs.

```js
selectionBar: {
  // actionContext: { context: 'assets'|'collections'|'collection'|'share',
  //                  resourceSelection: { resources: [{ id }, …] } }
  getActionButtons(actionContext) {
    return [
      { id: 'my-bulk-action', label: 'Bulk Export', icon: 'Download' },  // uses `label`, NOT `title`
    ];
  },
  async onActionClick(buttonId, assetIds) {   // assetIds: string[] of selected URNs
    const ids = encodeURIComponent(JSON.stringify(assetIds || []));
    await guestConnection.host.modal.openDialog({
      title: `Bulk Export (${assetIds.length})`,
      contentUrl: `/#selection-bar-modal?assetIds=${ids}`,
      type: 'modal',
      size: 'M',
    });
  },
}
```

The host prefixes selection-bar button ids internally (`ext:<extensionId>:<btn.id>`); your code always uses the original `btn.id` — that's what `onActionClick` receives too.

### Add Assets Wizard (`addAssets`)

Integrates with the "Add Assets" (hydration) flow: inject wizard steps, gate/enrich uploads, and react to completion.

```js
addAssets: {
  getPanels() {
    return [
      { id: 'my-pre-step',  title: 'Select Campaign', position: 'pre',  contentUrl: '/#pre-step' },
      { id: 'my-post-step', title: 'Tag Assets',       position: 'post', contentUrl: '/#post-step' },
    ];
  },
  // Return { proceed:false, message } to block, or { proceed:true, metadata } to merge metadata.
  async beforeUpload({ files, metadata, uploadPath }) {
    return { proceed: true, metadata: { ...metadata, 'xdm:campaignName': 'Q3 Launch' } };
  },
  // Fires after all files upload (parallel, fire-and-forget). Return value ignored.
  async onUploadComplete({ files, metadata, uploadPath }) { /* e.g. post to a webhook */ },
}
```

Step order: `[pre panels] → [Upload step] → [post panels]`. A `pre` panel blocks **Next** by default; its iframe must signal readiness via `postMessage` (there is no `host.modal` in a wizard panel):

```js
window.parent.postMessage(
  { type: 'addAssets:setReadyToAdvance', panelId: 'my-pre-step', ready: true },
  '*'
);
```

`post` panels default to ready. For `beforeUpload`, multiple extensions merge (last-writer-wins per key) and any single `{ proceed: false }` blocks the upload.

### Opening a Modal (`modal`)

Card and selection-bar actions have no panel of their own — they open a modal whose content is another hash route in the same guest app. **Content Hub's `openDialog` takes a single config object** — you never pass `{ id }` (the UIX host auto-injects the extension id on its side). This is the **opposite** of the other AEM surfaces, which use `host.modal.showUrl({ title, url })` + `close()`. Don't cross them.

```js
// From an onActionClick handler:
await guestConnection.host.modal.openDialog({
  title: 'Dialog title',
  contentUrl: '/#card-action-modal?resourceId=…',  // pass data via query string…
  type: 'modal',                                   // 'modal' | 'fullscreen'
  size: 'M',                                       // 'S' | 'M' | 'L'
  // payload: { … },                               // …or via payload, read with modal.getPayload()
});
```

Inside the modal page (its own iframe route), read the data and reconnect with `attach()`:

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
const resourceId = params.get('resourceId');       // or: const { resourceId } = await connection.host.modal.getPayload();
const connection = await attach({ id: extensionId });
await connection.host.modal.closeDialog();          // dismiss
```

### React Routing (`App.js`)

Hash routing — every panel/modal `contentUrl` must match a `<Route path>`. Keep only the routes for the namespaces you use.

```js
import { HashRouter as Router, Routes, Route } from 'react-router-dom';

<Router>
  <Routes>
    <Route index element={<ExtensionRegistration />} />
    <Route path="index.html" element={<ExtensionRegistration />} />
    <Route path="tab-panel" element={<TabPanel />} />                    {/* assetDetails */}
    <Route path="card-action-modal" element={<CardActionModal />} />      {/* card modal */}
    <Route path="selection-bar-modal" element={<SelectionBarModal />} />  {/* selectionBar modal */}
    <Route path="pre-step" element={<AddAssetsPanel />} />                {/* addAssets */}
    <Route path="post-step" element={<AddAssetsPanel />} />
  </Routes>
</Router>
```

### Host APIs

All via `guestConnection.host` (from either `register()` or `attach()`); every call returns a Promise.

```js
const { imsOrg, imsOrgName, accessToken } = await guestConnection.host.auth.getIMSInfo();
const apiKey  = await guestConnection.host.auth.getApiKey();          // never hardcode
const aemHost = await guestConnection.host.discovery.getAemHost();    // "author-p12345-e67890.adobeaemcloud.com"
guestConnection.host.toast.display({ variant: 'positive', message: 'Saved!' });  // neutral|positive|info|negative
const { locale } = await guestConnection.host.i18n.getLocalizationInfo();
const assetId = await guestConnection.host.assetDetails.getCurrentAsset();  // plain STRING (e.g. "urn:aaid:aem:…")
```

### Calling Web Actions from a Panel

Never call AEM APIs from the browser (CORS blocks them) — route through an App Builder web action:

```js
// In TabPanel.js
const { accessToken, imsOrg } = await guestConnection.host.auth.getIMSInfo();
const apiKey  = await guestConnection.host.auth.getApiKey();
const aemHost = await guestConnection.host.discovery.getAemHost();
const assetId = await guestConnection.host.assetDetails.getCurrentAsset();

const response = await fetch(actions['aem-assets-contenthub-1/generic'], {  // URL from config.json
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ assetId, aemHost, apiKey, imsOrg }),
});
```

The web action (`actions/generic/index.js`) makes the authenticated AEM Assets Author API call server-side and returns the result. See the `appbuilder-action-scaffolder` skill for the action itself.

### Local Development

```bash
aio app build && aio app run
```

Test URL: `https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/`

First run only: navigate to `https://localhost:9080` and accept the self-signed cert, or the panel stays blank. No `&repo=` needed when `allowedRepos = []`.

### Common Gotchas (Content Hub)

1. **`openDialog` is a single object** — passing `{ id }` yourself makes the host retry every 500ms until it times out (`… timed out after 10000ms`, `[object Object] doesn't exist`) while `host.toast` still works, masking the cause. Never pass `{ id }`.
2. **`const guestConnection` breaks card/selectionBar** — their `onActionClick` fires after `register()` resolves; use `let` or the handler closes over `undefined`.
3. **`getCurrentAsset()` returns a STRING**, not `{ id }`. (Assets View's `host.details.getCurrentResourceInfo()` is a different shape — don't mix.)
4. **Card/selectionBar buttons use `label`, not `title`** — a button with only `title` renders blank. (`assetDetails` panels use `title`/`tooltip`.)
5. **`card` vs `selectionBar` signatures differ** — card `onActionClick(resourceType, buttonId, resourceId, actionContext)` (single resource); selectionBar `onActionClick(buttonId, assetIds)` (array, no resourceType).
6. **Buttons missing entirely** — `card`/`selectionBar` are gated by the `EXTENSIBILITY_AEM_CONTENTHUB` flag; asset-details panels still show when it's off.
7. **`beforeUpload` must return `{ proceed, metadata }`** — omitting `metadata` loses it; pass `{ proceed: true, metadata: ctx.metadata }` for a no-op, and always include `message` when blocking.
8. **`attach()` id must match `register()` id** — export `extensionId` from `Constants.js` and import it in both.

---

## Extension Testing & Development

### Local Development

Run extensions locally with the AIO CLI:

```bash
aio app dev
# Starts local dev server and registers extension with AEM
# Extension loads in the target AEM surface via URL parameter
```

### AEM Extension Tester

Test extensions without deploying by loading them in the AEM surface with a URL parameter:

```
https://experience.adobe.com/?ext=https://localhost:9080
```

Or use the Extension Manager at:
```
https://experience.adobe.com/aem/extension-manager
```

### `ext.config.yaml` Configuration

```yaml
# Minimal extension configuration
operations:
  view:
    - type: web
      impl: index.html
extensions:
  aem/cf-console-admin/1:   # target surface
    - type: web
      impl: index.html
```

Multiple surfaces can be targeted from a single extension:

```yaml
extensions:
  aem/cf-console-admin/1:
    - type: web
      impl: index.html
  aem/cf-editor/1:
    - type: web
      impl: index.html
```

### Common Gotchas

1. **Modal origin restriction** — Modal URLs must share the same origin as the extension. Use relative paths (`/index.html#/modal`) or hash routing.
2. **Extension ID consistency** — The `id` in `register()` and `attach()` must match exactly, or `attach()` will fail to reconnect.
3. **Progress circle cleanup** — Always call `progressCircle.stop()` when done. Multiple extensions can start the spinner; it won't stop until ALL call `stop()`.
4. **RTE deprecation** — The RTE toolbar/badges/widgets API is deprecated. It works today but plan for the replacement API.
5. **`sharedContext` vs ExC Shell context** — AEM extensions get auth via `guestConnection.sharedContext.get("auth")`, NOT via `@adobe/exc-app` `runtime.ready()`. Don't mix the two patterns.
6. **Assets View license** — Assets View extensions require AEM Assets Ultimate. Check license before building.

---

## Quick Reference Table

| Surface | Extension Point ID | Key Namespaces | Host APIs |
| --- | --- | --- | --- |
| CF Console | `aem/cf-console-admin/1` | `actionBar`, `headerMenu`, `contentFragmentGrid` | `fragmentSelections`, `modal`, `toaster`, `progressCircle` |
| CF Editor | `aem/cf-editor/1` | `headerMenu`, `rte` | `contentFragment`, `modal`, `toaster` |
| Universal Editor | `aem/universal-editor/1` | `headerMenu` | `modal` |
| Assets View | `aem/assets/1` | `actionBar`, `headerMenu` | `modal` |
| Content Hub | `aem/assets/contenthub/1` | `assetDetails`, `card`, `selectionBar`, `addAssets` | `auth`, `discovery`, `toast`, `i18n`, `modal` (`openDialog`/`closeDialog`), `assetDetails` |
