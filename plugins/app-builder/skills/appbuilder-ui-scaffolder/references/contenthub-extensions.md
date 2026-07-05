# Content Hub UI Extension Patterns

API patterns and Host API reference for customizing Content Hub UI extensions using `@adobe/uix-guest`. These extensions run as App Builder apps inside iframes and can extend **four** Content Hub surfaces from a single `register()` call:

- **Asset Details Dialog** (`assetDetails` namespace) — custom tab panels in the side rail.
- **Asset card actions** (`card` namespace) — buttons on asset cards (Assets grid, inside a collection, link share) **and** on collection tiles in the Collections grid. The extension differentiates surfaces via `actionContext.context`.
- **Selection bar / bulk actions** (`selectionBar` namespace) — buttons in the multi-select action bar.
- **Add Assets wizard** (`addAssets` namespace) — inject panels before/after the upload step, gate uploads, and react to upload completion.

> **Scaffolding:** To create a new Content Hub extension from scratch, use the `appbuilder-project-init` skill (Extension Scaffolding Mode) — it handles the full workflow (Developer Console, file generation, build, dev server) and already wires all three namespaces. This file is a pattern reference for customizing and extending an already-scaffolded project.

**Extension point:** `aem/assets/contenthub/1` (unified — all four Content Hub surfaces via method namespaces in one `register()` call)

---

## Core Registration Pattern

Every Content Hub extension starts with `register()` from `@adobe/uix-guest`. This establishes the two-way communication channel between the extension (guest) and Content Hub (host).

```js
import { register } from '@adobe/uix-guest';

// `let` (not `const`): card/selectionBar onActionClick handlers reference the
// connection AFTER register() resolves, to open a modal via host.modal.openDialog().
let guestConnection;

guestConnection = await register({
  id: 'my.company.extension-name',  // unique ID — use reverse-domain format
  methods: {
    // Declare which surfaces to extend via namespaces — opt into any combination:
    assetDetails: {
      getTabPanels() { ... }         // tab panels in the Asset Details Dialog
    },
    card: {
      getActionButtons(actionContext) { ... }     // buttons on asset cards + collection tiles
      async onActionClick(resourceType, buttonId, resourceId, actionContext) { ... }
    },
    selectionBar: {
      getActionButtons(actionContext) { ... }     // buttons in the bulk-action bar
      async onActionClick(buttonId, assetIds) { ... }
    },
    addAssets: {
      getPanels() { ... }                         // wizard panels before/after the Upload step
      async beforeUpload(ctx) { ... }             // gate or enrich metadata before upload starts
      async onUploadComplete(ctx) { ... }         // react after upload finishes
    },
  },
});
```

The single extension point `aem/assets/contenthub/1` covers all four Content Hub surfaces. One `register()` call handles every namespace the extension opts into.

**Currently available namespaces:** `assetDetails`, `card`, `selectionBar`, and `addAssets` — all four are live in the host. The `card` namespace covers both asset cards (Assets grid, inside a collection, link share) **and** collection tiles on the Collections grid — the host passes the surface in `actionContext.context` so a single implementation handles all of them. Card and selection-bar actions are gated by the `EXTENSIBILITY_AEM_CONTENTHUB` feature flag (`ASSETS-66401_extensibility_aem_contenthub`); when the flag is off the host returns no extension buttons/panels for those surfaces, but `assetDetails` panels still render. The host invokes each namespace's methods from `useExtensionTabPanelsAssetDetails` / `useExtensionCardActions` (exports both `useExtensionAssetCardActions` and `useExtensionCollectionCardActions`) / `useExtensionBulkActionBar` / `useExtensionAddAssetsPanels` + `useExtensionAddAssetsHooks` (Content Hub repo, `src/utils/hooks/extensibility/`). There is no separate `collections` namespace — collection tiles reuse `card`.

### `register()` vs `attach()`

- **`register()`** — Used on the extension entry page. Declares capabilities. Returns a connection. Call once on load.
- **`attach()`** — Used on secondary pages (panel content inside an iframe). Reconnects without re-declaring capabilities.

```js
// In a tab panel page rendered inside the Content Hub iframe
import { attach } from '@adobe/uix-guest';

const guestConnection = await attach({
  id: 'my.company.extension-name',  // must exactly match the id in register()
});
```

**Critical:** Both `register()` and `attach()` must use the same `id`. Export it from `Constants.js` and import it in both files.

---

## Extension Point Configuration

### `app.config.yaml`

```yaml
extensions:
  aem/assets/contenthub/1:
    $include: src/aem-assets-contenthub-1/ext.config.yaml
```

### Project Structure

```
app.config.yaml                               ← declares aem/assets/contenthub/1
src/aem-assets-contenthub-1/
  ext.config.yaml                             ← runtime manifest + action definitions
  web-src/src/components/
    Constants.js                              ← extensionId (shared)
    ExtensionRegistration.js                  ← register() call (all namespaces)
    App.js                                    ← React routing
    TabPanel.js                               ← assetDetails panel UI (uses attach())
    CardActionModal.js                        ← card namespace modal (uses attach())
    SelectionBarModal.js                      ← selectionBar namespace modal (uses attach())
    AddAssetsPanel.js                         ← addAssets wizard panel UI (uses attach())
  actions/
    generic/index.js                          ← web action (AEM API calls)
    utils.js                                  ← shared utilities
```

> Only scaffold the component for the namespaces you use — `TabPanel.js` for `assetDetails`, `CardActionModal.js` for `card`, `SelectionBarModal.js` for `selectionBar`, `AddAssetsPanel.js` for `addAssets`.

---

## Asset Details Extension (`assetDetails` namespace)

The `assetDetails` namespace adds custom tab panels to the Asset Details Dialog side rail. Content Hub manages panel toggling, deep-linking, and header rendering — the extension only provides the panel content via an iframe.

### Registering Tab Panels

```js
methods: {
  assetDetails: {
    getTabPanels() {
      return [
        {
          id: 'my-panel',              // unique within this extension
          title: 'My Panel',          // panel header (rendered by Content Hub)
          tooltip: 'My Panel',        // side-rail icon tooltip
          icon: 'Extension',          // React-Spectrum workflow icon name
          contentUrl: '/#tab-panel',  // hash route in this guest app
        },
      ];
    },
  },
}
```

**Panel descriptor properties:**

| Property | Type | Description |
| --- | --- | --- |
| `id` | string | Unique panel ID within this extension |
| `title` | string | Panel header (Content Hub renders this) |
| `tooltip` | string | Tooltip on the side-rail icon |
| `icon` | string | React-Spectrum workflow icon name |
| `contentUrl` | string | Hash route (e.g. `/#tab-panel`) — must match an `<Route>` in `App.js` |

### Restricting to Specific Repos

```js
const allowedRepos = [
  'delivery-p12345-e167890.adobeaemcloud.com',
];

function shouldSkipRegistration(repo) {
  return allowedRepos.length > 0 && !allowedRepos.includes(repo);
}
```

Empty `allowedRepos` = loads for any repo (safe for development).

---

## Asset Card Actions (`card` namespace)

The `card` namespace adds action buttons to asset cards (the overflow / hover menu on each card in the Assets grid, inside a collection, or the link-share view) **and** to collection tiles on the Collections grid (the tile's ⋯ menu). The host passes the current surface in `actionContext`, so one implementation serves every card surface. The host renders each button and, on click, calls back into the extension.

### Registering card buttons

```js
methods: {
  card: {
    // Host calls getActionButtons(actionContext) with context about the current surface.
    // actionContext.context: 'assets' | 'collection' | 'collections' | 'share'
    //   'assets'      — Assets browse grid (asset card)
    //   'collection'  — assets inside a collection (asset card)
    //   'share'       — link-share view (asset card)
    //   'collections' — collection tile on the Collections grid
    getActionButtons(actionContext) {
      // Vary buttons by actionContext.context, or ignore it to show the same set everywhere.
      return [
        {
          id: 'my-card-action',     // unique within this extension
          label: 'Edit Metadata',   // button label (card uses `label`, NOT `title`)
          icon: 'Edit',             // React-Spectrum workflow icon name
        },
      ];
    },
    // Host calls this on click, passing (resourceType, buttonId, resourceId, actionContext).
    async onActionClick(resourceType, buttonId, resourceId, actionContext) {
      // resourceType:  'asset' (asset cards) | 'collection' (collection tiles)
      // buttonId:      the `id` from getActionButtons()
      // resourceId:    the asset or collection URN string
      // actionContext: { context } — same surface values as above
      // openDialog takes a SINGLE config object — NO { id } first arg, NO payload field.
      // Pass data to the modal via the contentUrl query string.
      await guestConnection.host.modal.openDialog({
        title: 'Edit Metadata',
        contentUrl: `/#card-action-modal?resourceId=${encodeURIComponent(resourceId)}&resourceType=${encodeURIComponent(resourceType)}`,  // route in App.js + query
        type: 'modal',
        size: 'M',
      });
    },
  },
}
```

**Button descriptor (card):** only `id`, `label`, and `icon` are read by the host — `title`/`tooltip`/`variant` are ignored for card buttons.

**`getActionButtons(actionContext)`** — the host passes `{ context }` (the source surface). Use it to conditionally show/hide buttons per surface, or ignore it to always show the same set.

**`onActionClick(resourceType, buttonId, resourceId, actionContext)`** — exact argument order the host uses. It's optional (the host guards with `?.`): omit it for a no-op button, but you need it to open a modal. Because it fires *after* `register()` resolves, declare the connection with `let guestConnection` so the handler can reference it.

> Host proof: `extension.apis.card.onActionClick?.(ResourceType.ASSET, btn.id, assetId, {context: source})` (asset cards) and `extension.apis.card.onActionClick?.(ResourceType.COLLECTION, btn.id, collectionId, {context: 'collections'})` (collection tiles) in `useExtensionCardActions.ts`.

---

## Selection Bar / Bulk Actions (`selectionBar` namespace)

The `selectionBar` namespace adds buttons to the bulk-action bar shown when one or more assets are selected. Unlike `card`, the host passes an **action context** to `getActionButtons`, telling the extension which view the bar is in and what's selected.

### Registering selection-bar buttons

```js
methods: {
  selectionBar: {
    // Host calls getActionButtons(actionContext) with context about the current view + selection.
    // actionContext shape:
    //   { context: 'assets'|'collections'|'collection'|'share',
    //     resourceSelection: { resources: [{id: string}, ...] } }
    //
    // context values:
    //   'assets'      — browse grid
    //   'collections' — collections list
    //   'collection'  — inside a single collection
    //   'share'       — link share view
    getActionButtons(actionContext) {
      // Optional: filter buttons by source view
      // if (actionContext.context === 'share') return [];  // hide in link-share view
      return [
        {
          id: 'my-bulk-action',
          label: 'Bulk Export',     // selectionBar uses `label`, NOT `title`
          icon: 'Download',         // React-Spectrum workflow icon name
        },
      ];
    },
    // Host calls this on click, passing (buttonId, assetIds[]).
    async onActionClick(buttonId, assetIds) {
      // buttonId:  the `id` from getActionButtons()
      // assetIds:  string[] — URNs of every currently selected asset
      // Single config object — NO { id }, NO payload. Pass assetIds via the contentUrl query.
      const ids = encodeURIComponent(JSON.stringify(assetIds || []));
      await guestConnection.host.modal.openDialog({
        title: `Bulk Export (${assetIds.length})`,
        contentUrl: `/#selection-bar-modal?assetIds=${ids}`,  // route in App.js + query
        type: 'modal',
        size: 'M',
      });
    },
  },
}
```

**Button descriptor (selectionBar):** same as card — `id`, `label`, `icon`.

**`getActionButtons(actionContext)`** — unlike `card.getActionButtons()` (no args), selectionBar receives context about the source view and current selection. Use it to conditionally show/hide buttons, or ignore the parameter to always show.

**`onActionClick(buttonId, assetIds)`** — note this signature differs from `card`: **no `resourceType`**, and the second arg is an **array** of asset IDs. Like card, it's optional and fires after `register()` resolves (use `let guestConnection`).

**Button ID prefixing:** The host renders each selection-bar extension button with a prefixed id (`ext:<extensionId>:<btn.id>`) to avoid collisions with native action bar items. This is host-internal — your extension code uses the original `btn.id` as returned from `getActionButtons`. The `onActionClick` handler also receives the original `btn.id`, not the prefixed form.

> Host proof: `extension.apis.selectionBar.getActionButtons(actionContext)` and `extension.apis.selectionBar.onActionClick(btn.id, assetIds)` in `useExtensionBulkActionBar.ts`.

---

## Add Assets Wizard (`addAssets` namespace)

The `addAssets` namespace integrates with the "Add Assets" (hydration) flow. Extensions can:

1. **Inject wizard panels** (`getPanels()`) — rendered as full-dialog steps before (`'pre'`) or after (`'post'`) the native Upload step.
2. **Gate or enrich uploads** (`beforeUpload(ctx)`) — called before the file upload starts; can block the upload or inject/merge metadata.
3. **React to upload completion** (`onUploadComplete(ctx)`) — fires after the upload finishes (parallel, fire-and-forget).

### Registering add-assets methods

```js
methods: {
  addAssets: {
    getPanels() {
      return [
        {
          id: 'my-pre-step',          // unique within this extension
          title: 'Select Campaign',   // dialog heading
          position: 'pre',            // 'pre' | 'post' — before or after the Upload step
          contentUrl: '/#pre-step',   // hash route in App.js
        },
        {
          id: 'my-post-step',
          title: 'Tag Assets',
          position: 'post',
          contentUrl: '/#post-step',
        },
      ];
    },

    // Called before upload starts. Return { proceed: false } to block, or
    // { proceed: true, metadata: {...} } to inject/merge metadata.
    async beforeUpload({ files, metadata, uploadPath }) {
      const extra = { 'xdm:campaignName': 'Q3 Launch' };
      return { proceed: true, metadata: { ...metadata, ...extra } };
    },

    // Called after all files finish uploading. Return value is ignored.
    async onUploadComplete({ files, metadata, uploadPath }) {
      // e.g. post to a webhook, update a campaign tracker
    },
  },
}
```

### Panel descriptor (`getPanels`)

| Property | Type | Description |
| --- | --- | --- |
| `id` | string | Unique panel ID within this extension |
| `title` | string | Dialog heading for this wizard step |
| `position` | `'pre' \| 'post'` | `'pre'` = shown before the Upload step; `'post'` = after |
| `contentUrl` | string | Hash route rendered in a `GuestUIFrame` (must match a `<Route>` in `App.js`) |

### Wizard step order

```
[pre panels in order] → [Upload / hydration step] → [post panels in order]
```

A `pre` panel blocks the **Next** button by default. To unblock it, the panel's iframe sends a `postMessage`:

```js
// Inside the GuestUIFrame iframe of a 'pre' panel:
window.parent.postMessage(
  { type: 'addAssets:setReadyToAdvance', panelId: 'my-pre-step', ready: true },
  '*'
);
```

`post` panels default to ready (no signal required — informational or fire-and-forget).

### `beforeUpload` return contract

```ts
// Input ctx:
{ files: File[], metadata: Record<string, unknown>, uploadPath: string }

// Return:
{ proceed: boolean; metadata: Record<string, unknown>; message?: string }
```

- `proceed: false` → upload blocked; show `message` to the user.
- `proceed: true` → merge `metadata` (returned metadata is spread onto the existing form metadata).
- Multiple extensions: any single `false` blocks the upload; all `metadata` objects are merged (last-writer-wins per key).

### `onUploadComplete` context

```ts
{ files: { name: string; size: number; type: string }[], metadata: Record<string, unknown>, uploadPath: string }
```

All registered handlers run in parallel (`Promise.allSettled`). Individual failures are logged but do not block the wizard.

### Add Assets panel component

The wizard panel renders inside a `GuestUIFrame`. Use `attach()` to reconnect if you need Host APIs (auth, toast, etc.).

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

export default function AddAssetsPanel() {
  const [guestConnection, setGuestConnection] = useState(null);

  useEffect(() => {
    (async () => {
      const connection = await attach({ id: extensionId });
      setGuestConnection(connection);
    })();
  }, []);

  const markReady = () => {
    window.parent.postMessage(
      { type: 'addAssets:setReadyToAdvance', panelId: 'my-pre-step', ready: true },
      '*'
    );
  };

  // Render your form / UI.
  // Call markReady() when the user has completed this step.
}
```

> Host proof: `useExtensionAddAssetsPanels` (panels, `getPanels`) and `useExtensionAddAssetsHooks` (`beforeUpload`, `onUploadComplete`) in `src/utils/hooks/extensibility/` (Content Hub repo). Wired into `AddAssetsWizardDialog.tsx`.

---

## Opening a Modal for an Action (`modal` namespace)

Card and selection-bar actions have no panel of their own — they open a modal dialog whose content is another route in the same guest app. The `modal` Host API is available to all four Content Hub surfaces.

**Signature:** from the guest's perspective, `openDialog` is called with a **single config object** — `openDialog({ title, contentUrl, type?, size?, payload? })`. You never pass `{ id }` yourself; the UIX host auto-injects the extension id as the first argument on its side of the proxy. Data can reach the modal page two ways: via the `payload` field (retrieved with `modal.getPayload()`) or via a query string on `contentUrl` — pick whichever is more convenient.

```js
// From an onActionClick handler (register page):
await guestConnection.host.modal.openDialog({
  title: 'Dialog title',
  contentUrl: `/#card-action-modal?resourceId=${encodeURIComponent(resourceId)}&resourceType=${encodeURIComponent(resourceType)}`,  // hash route + query data
  type: 'modal',                      // optional: 'modal' | 'fullscreen'
  size: 'M',                          // optional: 'S' | 'M' | 'L'
  // payload: { resourceId, resourceType },  // alternative to the query string — read with modal.getPayload()
});
```

Inside the modal page (a route rendered in its own iframe), read the data and reconnect with `attach()`:

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

// Query-string approach (simplest — no extra round trip):
const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
const resourceId = params.get('resourceId');
const resourceType = params.get('resourceType'); // 'asset' | 'collection'

const connection = await attach({ id: extensionId });
// Payload approach (alternative to the query string):
// const { resourceId, resourceType } = await connection.host.modal.getPayload();
// ... render UI, run the action ...
await connection.host.modal.closeDialog();                 // dismiss the dialog
```

| Method | Signature | Purpose |
| --- | --- | --- |
| `modal.openDialog` | `({ title, contentUrl, type?, size?, payload? })` | Open a dialog rendering `contentUrl`. Single object from the guest's side — the host auto-injects `{ id }`. |
| `modal.getPayload` | `() => unknown` | Returns the `payload` passed to `openDialog()`. Call from the modal page after `attach()`. |
| `modal.closeDialog` | `() => void` | Close the current dialog (call from the modal page after `attach()`) |

---

## React Routing (`App.js`)

Extensions use hash routing. Every panel has its own route; `contentUrl` in `getTabPanels()` must match a `<Route path>`.

```js
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import ExtensionRegistration from './ExtensionRegistration';
import TabPanel from './TabPanel';                   // assetDetails
import CardActionModal from './CardActionModal';      // card
import SelectionBarModal from './SelectionBarModal';  // selectionBar
import AddAssetsPanel from './AddAssetsPanel';        // addAssets

<Router>
  <Routes>
    <Route index element={<ExtensionRegistration />} />
    <Route path="index.html" element={<ExtensionRegistration />} />
    <Route path="tab-panel" element={<TabPanel />} />                  {/* assetDetails contentUrl */}
    <Route path="card-action-modal" element={<CardActionModal />} />    {/* card modal contentUrl */}
    <Route path="selection-bar-modal" element={<SelectionBarModal />} />{/* selectionBar modal contentUrl */}
    <Route path="pre-step" element={<AddAssetsPanel />} />              {/* addAssets pre-panel contentUrl */}
    <Route path="post-step" element={<AddAssetsPanel />} />             {/* addAssets post-panel contentUrl */}
    {/* One route per panel/modal — each contentUrl maps to a route here */}
  </Routes>
</Router>
```

Keep only the routes for the namespaces you use. Each `contentUrl` in a `getTabPanels()` / `openDialog()` / `getPanels()` call must match a `<Route path>` here.

---

## Tab Panel Component

The panel renders inside Content Hub's iframe. Use `attach()` to reconnect and access Host APIs.

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

export default function TabPanel() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [asset, setAsset] = useState(null);

  useEffect(() => {
    (async () => {
      const connection = await attach({ id: extensionId });
      setGuestConnection(connection);

      // getCurrentAsset() returns the asset id as a plain string (e.g. "urn:aaid:aem:...").
      const assetId = await connection.host.assetDetails.getCurrentAsset();
      setAsset({ id: assetId });
    })();
  }, []);

  // Render UI with React Spectrum components...
}
```

---

## Modal Component (card / selectionBar)

The modal page is just another `attach()`-based component, distinguished by reading its data **from the URL query or from `modal.getPayload()`**, whichever `openDialog()` used. Same shape for `CardActionModal.js` and `SelectionBarModal.js` — only the fields differ (`resourceId` + `resourceType` for card, `assetIds` JSON for selectionBar).

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

export default function CardActionModal() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      // Query-string approach — read what onActionClick put in the contentUrl query.
      // (Alternative: `await connection.host.modal.getPayload()` if openDialog() used `payload`.)
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      setData({
        resourceId: params.get('resourceId'),
        resourceType: params.get('resourceType'), // 'asset' | 'collection'
      });
      // (selectionBar: const ids = JSON.parse(params.get('assetIds') || '[]'))
      const connection = await attach({ id: extensionId });  // only needed for closeDialog()
      setGuestConnection(connection);
    })();
  }, []);

  // Render UI with data.resourceId + data.resourceType (card) / data.assetIds (selectionBar),
  // then close with: guestConnection.host.modal.closeDialog()
}
```

---

## Host APIs

All APIs are available via `guestConnection.host`. Both `register()` and `attach()` return the same connection object. All invocations are asynchronous and return a Promise.

### Authentication (`auth` namespace)

```js
const { imsOrg, imsOrgName, accessToken } = await guestConnection.host.auth.getIMSInfo();
const apiKey = await guestConnection.host.auth.getApiKey();
// Never hardcode apiKey — always get it via this method
```

### Discovery (`discovery` namespace)

```js
const aemHost = await guestConnection.host.discovery.getAemHost();
// e.g. "author-p12345-e67890.adobeaemcloud.com"
// Use in web actions for AEM Assets Author API calls
```

### Toast (`toast` namespace)

```js
guestConnection.host.toast.display({ variant: 'positive', message: 'Saved!' });
// variant: 'neutral' | 'positive' | 'info' | 'negative'
```

### i18n (`i18n` namespace)

```js
const { locale } = await guestConnection.host.i18n.getLocalizationInfo();
// e.g. "en-US"
```

### Modal (`modal` namespace)

Available on all three surfaces. Used by `card`/`selectionBar` to open a dialog, and by any modal page to read its data and close:

```js
guestConnection.host.modal.openDialog({ title, contentUrl, type, size, payload });  // single object — host auto-injects { id }
// inside the modal page, read data either from the URL query...
const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
// ...or via the payload, if openDialog() set one:
const payload = await guestConnection.host.modal.getPayload();
guestConnection.host.modal.closeDialog();
```

### Asset Details (`assetDetails` namespace)

Only available when registered under the `assetDetails` namespace:

```js
const assetId = await guestConnection.host.assetDetails.getCurrentAsset();
// Returns the asset id as a plain string (e.g. "urn:aaid:aem:...").
// Wrap if needed: const asset = { id: assetId };
// Pass assetId (or asset.id) to a web action to call AEM Assets Author API
```

---

## Calling Web Actions from a Panel

Never call AEM APIs directly from the browser (CORS blocks them). Route all AEM API calls through web actions.

```js
// In TabPanel.js
const { accessToken, imsOrg } = await guestConnection.host.auth.getIMSInfo();
const apiKey = await guestConnection.host.auth.getApiKey();
const aemHost = await guestConnection.host.discovery.getAemHost();
const currentAsset = await guestConnection.host.assetDetails.getCurrentAsset();
const actionUrl = actions['aem-assets-contenthub-1/generic'];  // from config.json

const response = await fetch(actionUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Include these when action has require-adobe-auth: true:
    // 'Authorization': `Bearer ${accessToken}`,
    // 'x-gw-ims-org-id': imsOrg,
  },
  body: JSON.stringify({ assetId: currentAsset.id, aemHost, apiKey, imsOrg }),
});
const data = await response.json();
```

**In the web action (`actions/generic/index.js`):**

```js
async function main(params) {
  const { assetId, aemHost, apiKey, imsOrg } = params;
  const token = params.__ow_headers?.authorization?.substring(7); // when require-adobe-auth: true

  const response = await fetch(`https://${aemHost}/adobe/assets/${assetId}/metadata`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Api-Key': apiKey,
      'x-gw-ims-org-id': imsOrg,
    },
  });
  const data = await response.json();
  return { statusCode: 200, body: { metadata: data.value ?? data } };
}
```

---

## Local Development

### Run the dev server

```bash
aio app build
aio app run
```

### Test URL

```
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/
```

| Parameter | Purpose |
| --- | --- |
| `devMode=true` | Enables developer mode |
| `ext=https://localhost:9080` | Loads local extension |

No `&repo=` needed — the scaffold sets `allowedRepos = []`, so any repo works for local dev (see `appbuilder-project-init` SKILL.md Extension Scaffolding Mode Step 16).

**Self-signed cert (first time only):** Navigate to `https://localhost:9080` and click "Proceed to localhost (unsafe)". The extension panel will be blank until the cert is trusted.

---

## Common Gotchas

1. **Wrong extension point ID** — Use `aem/assets/contenthub/1`. The deprecated ID `aem/contenthub/assets/details/1` still works during the transition period but should not be used in new projects.

2. **`attach()` ID mismatch** — The `id` in `attach()` must exactly match the `id` in `register()`. Both should import `extensionId` from `Constants.js`.

3. **Panel blank (cert not trusted)** — Navigate to `https://localhost:9080` and accept the cert before loading the Content Hub URL.

4. **`getCurrentAsset()` returns a STRING** — `host.assetDetails.getCurrentAsset()` returns the asset id as a plain string (e.g. `"urn:aaid:aem:..."`), NOT `{ id }`. Use it directly or wrap: `const asset = { id: assetId }`. (Assets View is a different surface — it uses `host.details.getCurrentResourceInfo()` with a different shape. Do not mix them.)

5. **`const guestConnection` breaks card/selectionBar** — Their `onActionClick` handlers fire *after* `register()` resolves and must reference the connection to call `host.modal.openDialog()`. Declare it `let guestConnection;` and assign inside `register()`, or the handler closes over `undefined`.

5a. **`openDialog` signature — single object from the guest's side** — Content Hub's `host.modal.openDialog` is called as **one** config object: `openDialog({ title, contentUrl, type, size, payload })`. Never pass `{ id }` yourself — the UIX host auto-injects the extension id as the first argument on its side of the proxy; passing it explicitly makes the host receive a malformed request, and the call retries every 500ms until it fails with `... timed out after 10000ms` and `[object Object] doesn't exist` (a `host.toast.display` in the same handler still works, which makes it look like the connection is fine). Data can reach the modal page via `payload` (read with `host.modal.getPayload()` after `attach()`) or via a `contentUrl` query string (`/#card-action-modal?resourceId=...&resourceType=...`, read with `new URLSearchParams(window.location.hash.split('?')[1])`) — both are supported, pick one. Close with `host.modal.closeDialog()`. (Note: this is the **opposite** of the other AEM surfaces — CF Console/Editor/UE/Assets View use `host.modal.showUrl({ title, url })` + `close()`. Content Hub uses `openDialog`/`closeDialog`. Don't cross them.)

6. **`card` vs `selectionBar` signatures differ** — Both `getActionButtons(actionContext)` receive a context, but the shapes differ: card gets `{ context }` only, while selectionBar gets `{ context, resourceSelection }`. On click, card `onActionClick(resourceType, buttonId, resourceId, actionContext)` gets a single resource + its type (`'asset'` or `'collection'`); selectionBar `onActionClick(buttonId, assetIds)` gets no resource type and `assetIds` is an array. Don't copy one signature for the other.

7. **Card/selectionBar buttons use `label`, not `title`** — only `id`, `label`, `icon` are read for those two. (`assetDetails` panels use `title`/`tooltip`.) A button with only `title` set renders blank.

8. **Card/selectionBar buttons missing entirely** — they're gated by the `EXTENSIBILITY_AEM_CONTENTHUB` feature flag. If the flag is off in the environment, the host returns no extension buttons for those surfaces (asset-details panels still show).

9. **CORS on AEM API calls** — Never fetch AEM APIs from the browser. Use web actions (I/O Runtime server-side).

10. **`config.json` action URL** — This file is overwritten by `aio app run` (localhost). Never edit manually.

11. **`addAssets` pre-panel `Next` stays disabled forever** — `pre` panels block Next by default; the panel must send `window.parent.postMessage({ type: 'addAssets:setReadyToAdvance', panelId: '<id>', ready: true }, '*')` when complete. `post` panels are pre-unblocked and don't need this.

12. **`beforeUpload` return shape** — must return `{ proceed, metadata }`. Returning `undefined` or omitting `metadata` results in lost metadata. Return `{ proceed: true, metadata: ctx.metadata }` if you make no changes (spread ctx.metadata to pass it through). Returning `{ proceed: false }` without a `message` shows no user-facing reason — always include `message`.

13. **`addAssets` wizard panels vs `card`/`selectionBar` modals** — wizard panels use `postMessage` for readiness signalling (no `guestConnection.host.modal`). Do not call `host.modal.openDialog` from a wizard panel — it opens a nested dialog, which breaks the wizard flow.

---

## Quick Reference

**Extension point:** `aem/assets/contenthub/1`
**Source directory:** `src/aem-assets-contenthub-1/`

| Surface | Namespace | Key method(s) | Click / lifecycle handler |
| --- | --- | --- | --- |
| Asset Details Dialog | `assetDetails` | `getTabPanels()` | — (renders `contentUrl` in a tab) |
| Asset cards (Assets/Collection/Share) | `card` | `getActionButtons(actionContext)` | `onActionClick(resourceType, buttonId, resourceId, actionContext)` — `resourceType='asset'` |
| Collection tiles (Collections grid) | `card` | `getActionButtons(actionContext)` | `onActionClick(resourceType, buttonId, resourceId, actionContext)` — `resourceType='collection'`, `context='collections'` |
| Selection bar (bulk) | `selectionBar` | `getActionButtons(actionContext)` | `onActionClick(buttonId, assetIds[])` |
| Add Assets wizard | `addAssets` | `getPanels()` | `beforeUpload(ctx)` / `onUploadComplete(ctx)` |

**Button/panel descriptor fields:**

| Namespace | `get…()` returns array of |
| --- | --- |
| `assetDetails` | `{ id, title, tooltip, icon, contentUrl }` |
| `card` | `{ id, label, icon }` |
| `selectionBar` | `{ id, label, icon }` |
| `addAssets` | `{ id, title, position: 'pre'\|'post', contentUrl }` |

**Host API summary:**

| Namespace | Method | Returns |
| --- | --- | --- |
| `auth` | `getIMSInfo()` | `{ imsOrg, imsOrgName, accessToken }` |
| `auth` | `getApiKey()` | API key string |
| `discovery` | `getAemHost()` | AEM author URL |
| `toast` | `display({ variant, message })` | void |
| `i18n` | `getLocalizationInfo()` | `{ locale }` |
| `modal` | `openDialog({ title, contentUrl, type?, size? })` | void — single object, NO `{ id }`, NO `payload`; pass data via the `contentUrl` query |
| `modal` | `closeDialog()` | void |
| `assetDetails` | `getCurrentAsset()` | string asset ID — normalize to `{ id }` in your component |

**Toast variants:** `neutral` | `positive` | `info` | `negative`
