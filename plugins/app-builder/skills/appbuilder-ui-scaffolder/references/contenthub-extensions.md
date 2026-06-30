# Content Hub UI Extension Patterns

API patterns and Host API reference for customizing Content Hub UI extensions using `@adobe/uix-guest`. These extensions run as App Builder apps inside iframes and can extend **three** Content Hub surfaces from a single `register()` call:

- **Asset Details Dialog** (`assetDetails` namespace) — custom tab panels in the side rail.
- **Asset card actions** (`card` namespace) — buttons on asset cards (Assets grid, inside a collection, link share) and on collection tiles in the Collections grid.
- **Selection bar / bulk actions** (`selectionBar` namespace) — buttons in the multi-select action bar.

> **Scaffolding:** To create a new Content Hub extension from scratch, use the `adobe-extension-scaffolder` skill — it handles the full workflow (Developer Console, file generation, build, dev server) and already wires all three namespaces. This file is a pattern reference for customizing and extending an already-scaffolded project.

**Extension point:** `aem/assets/contenthub/1` (unified — all three Content Hub surfaces via method namespaces in one `register()` call)

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
  },
});
```

The single extension point `aem/assets/contenthub/1` covers all three Content Hub surfaces. One `register()` call handles every namespace the extension opts into.

**Currently available namespaces:** `assetDetails`, `card`, and `selectionBar` — all three are live in the host. The `card` namespace covers both asset cards (Assets grid, inside a collection, link share) **and** collection tiles on the Collections grid — the host passes the surface in `actionContext.context` so a single implementation handles all of them. Card and selection-bar actions are gated by the `EXTENSIBILITY_AEM_CONTENTHUB` feature flag (`ASSETS-66401_extensibility_aem_contenthub`); when the flag is off the host returns no extension buttons for those surfaces, but `assetDetails` panels still render. The host invokes each namespace's methods from `useExtensionTabPanelsAssetDetails` / `useExtensionCardActions` (exports both `useExtensionAssetCardActions` and `useExtensionCollectionCardActions`) / `useExtensionBulkActionBar` (Content Hub repo, `src/utils/hooks/extensibility/`). There is no separate `collections` namespace — collection tiles reuse `card`.

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
  actions/
    generic/index.js                          ← web action (AEM API calls)
    utils.js                                  ← shared utilities
```

> Only scaffold the component for the namespaces you use — `TabPanel.js` for `assetDetails`, `CardActionModal.js` for `card`, `SelectionBarModal.js` for `selectionBar`.

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

## Opening a Modal for an Action (`modal` namespace)

Card and selection-bar actions have no panel of their own — they open a modal dialog whose content is another route in the same guest app. The `modal` Host API is available to all three Content Hub surfaces.

**Critical signature:** `openDialog` takes a **single config object** — NOT `({ id }, {...})`. There is **no `{ id }` argument and no `payload` field**. Passing the two-argument form makes the host receive a malformed request and the call retries until it times out (`... timed out after 10000ms`, then `[object Object] doesn't exist`). Pass data to the modal through the `contentUrl` **query string** instead.

```js
// From an onActionClick handler (register page):
await guestConnection.host.modal.openDialog({
  title: 'Dialog title',
  contentUrl: `/#card-action-modal?resourceId=${encodeURIComponent(resourceId)}&resourceType=${encodeURIComponent(resourceType)}`,  // hash route + query data
  type: 'modal',                      // optional: 'modal' | 'fullscreen'
  size: 'M',                          // optional: 'S' | 'M' | 'L'
});
```

Inside the modal page (a route rendered in its own iframe), read the data from the URL query and reconnect with `attach()` only so you can close:

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

// Data comes from the contentUrl query — there is NO getPayload().
const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
const resourceId = params.get('resourceId');
const resourceType = params.get('resourceType'); // 'asset' | 'collection'

const connection = await attach({ id: extensionId });
// ... render UI, run the action ...
await connection.host.modal.closeDialog();                 // dismiss the dialog
```

| Method | Signature | Purpose |
| --- | --- | --- |
| `modal.openDialog` | `({ title, contentUrl, type?, size? })` | Open a dialog rendering `contentUrl`. Single object — no `{ id }`, no `payload`. |
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

<Router>
  <Routes>
    <Route index element={<ExtensionRegistration />} />
    <Route path="index.html" element={<ExtensionRegistration />} />
    <Route path="tab-panel" element={<TabPanel />} />                  {/* assetDetails contentUrl */}
    <Route path="card-action-modal" element={<CardActionModal />} />    {/* card modal contentUrl */}
    <Route path="selection-bar-modal" element={<SelectionBarModal />} />{/* selectionBar modal contentUrl */}
    {/* One route per panel/modal — each contentUrl maps to a route here */}
  </Routes>
</Router>
```

Keep only the routes for the namespaces you use. Each `contentUrl` in a `getTabPanels()` / `openDialog()` call must match a `<Route path>` here.

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

      // Get the current asset.
      // getCurrentAsset() returns a plain STRING id (e.g. "urn:aaid:aem:..."), NOT { id }.
      // Normalize so asset.id always works regardless of future API shape changes.
      const raw = await connection.host.assetDetails.getCurrentAsset();
      const currentAsset = typeof raw === 'string' ? { id: raw } : raw;
      setAsset(currentAsset);
    })();
  }, []);

  // Render UI with React Spectrum components...
}
```

---

## Modal Component (card / selectionBar)

The modal page is just another `attach()`-based component, distinguished by reading its data **from the URL query** (there is no `getPayload()`). Same shape for `CardActionModal.js` and `SelectionBarModal.js` — only the query fields differ (`resourceId` + `resourceType` for card, `assetIds` JSON for selectionBar).

```js
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';

export default function CardActionModal() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      // openDialog has no payload channel — read what onActionClick put in the contentUrl query.
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      setData({
        resourceId: params.get('resourceId'),
        resourceType: params.get('resourceType'), // 'asset' | 'collection'
      });
      // (selectionBar: const ids = JSON.parse(decodeURIComponent(params.get('assetIds') || '[]')))
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

Available on all three surfaces. Used by `card`/`selectionBar` to open a dialog, and by any modal page to read its payload and close:

```js
guestConnection.host.modal.openDialog({ title, contentUrl, type, size });  // single object — no { id }, no payload
// inside the modal page, read data from the URL query (no getPayload):
const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
guestConnection.host.modal.closeDialog();
```

### Asset Details (`assetDetails` namespace)

Only available when registered under the `assetDetails` namespace:

```js
const assetId = await guestConnection.host.assetDetails.getCurrentAsset();
// Returns the asset id as a plain STRING (e.g. "urn:aaid:aem:..."), NOT { id }.
// Normalize in your component: const asset = typeof assetId === 'string' ? { id: assetId } : assetId;
// Pass asset.id to a web action to call AEM Assets Author API
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
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080&repo=delivery-p12345-e123456.adobeaemcloud.com#/assets/contenthub/
```

| Parameter | Purpose |
| --- | --- |
| `devMode=true` | Enables developer mode |
| `ext=https://localhost:9080` | Loads local extension |
| `repo=<delivery-repo>` | Identifies the AEM environment; must match `allowedRepos` |

**Self-signed cert (first time only):** Navigate to `https://localhost:9080` and click "Proceed to localhost (unsafe)". The extension panel will be blank until the cert is trusted.

---

## Common Gotchas

1. **Wrong extension point ID** — Use `aem/assets/contenthub/1`. The deprecated ID `aem/contenthub/assets/details/1` still works during the transition period but should not be used in new projects.

2. **`attach()` ID mismatch** — The `id` in `attach()` must exactly match the `id` in `register()`. Both should import `extensionId` from `Constants.js`.

3. **Panel blank (cert not trusted)** — Navigate to `https://localhost:9080` and accept the cert before loading the Content Hub URL.

4. **`getCurrentAsset()` returns a STRING** — `host.assetDetails.getCurrentAsset()` returns the asset id as a plain string (e.g. `"urn:aaid:aem:..."`), NOT `{ id }`. Normalize: `const asset = typeof raw === 'string' ? { id: raw } : raw`. (Assets View is a different surface — it uses `host.details.getCurrentResourceInfo()` with a different shape. Do not mix them.)

5. **`const guestConnection` breaks card/selectionBar** — Their `onActionClick` handlers fire *after* `register()` resolves and must reference the connection to call `host.modal.openDialog()`. Declare it `let guestConnection;` and assign inside `register()`, or the handler closes over `undefined`.

5a. **`openDialog` signature — single object, no `{ id }`, no `payload`** — Content Hub's `host.modal.openDialog` takes **one** config object: `openDialog({ title, contentUrl, type, size })`. It is NOT `openDialog({ id }, {...})`, and there is **no `payload` field** and **no `getPayload()`**. The two-argument form makes the host receive a malformed request; the uix-guest client then retries the call every 500ms until it fails with `... timed out after 10000ms` and `[object Object] doesn't exist` — and no dialog ever appears (a `host.toast.display` in the same handler still works, which makes it look like the connection is fine). Pass data to the modal via the `contentUrl` query string (`/#card-action-modal?resourceId=...&resourceType=...`) and read it in the modal page with `new URLSearchParams(window.location.hash.split('?')[1])`. Close with `host.modal.closeDialog()`. (Note: this is the **opposite** of the other AEM surfaces — CF Console/Editor/UE/Assets View use `host.modal.showUrl({ title, url })` + `close()`. Content Hub uses `openDialog`/`closeDialog`. Don't cross them.)

6. **`card` vs `selectionBar` signatures differ** — Both `getActionButtons(actionContext)` receive a context, but the shapes differ: card gets `{ context }` only, while selectionBar gets `{ context, resourceSelection }`. On click, card `onActionClick(resourceType, buttonId, resourceId, actionContext)` gets a single resource + its type (`'asset'` or `'collection'`); selectionBar `onActionClick(buttonId, assetIds)` gets no resource type and `assetIds` is an array. Don't copy one signature for the other.

7. **Card/selectionBar buttons use `label`, not `title`** — only `id`, `label`, `icon` are read for those two. (`assetDetails` panels use `title`/`tooltip`.) A button with only `title` set renders blank.

8. **Card/selectionBar buttons missing entirely** — they're gated by the `EXTENSIBILITY_AEM_CONTENTHUB` feature flag. If the flag is off in the environment, the host returns no extension buttons for those surfaces (asset-details panels still show).

9. **CORS on AEM API calls** — Never fetch AEM APIs from the browser. Use web actions (I/O Runtime server-side).

10. **`config.json` action URL** — This file is overwritten by `aio app run` (localhost). Never edit manually.

---

## Quick Reference

**Extension point:** `aem/assets/contenthub/1`
**Source directory:** `src/aem-assets-contenthub-1/`

| Surface | Namespace | Key method(s) | Click handler |
| --- | --- | --- | --- |
| Asset Details Dialog | `assetDetails` | `getTabPanels()` | — (renders `contentUrl` in a tab) |
| Asset card + collection tile | `card` | `getActionButtons(actionContext)` | `onActionClick(resourceType, buttonId, resourceId, actionContext)` |
| Selection bar (bulk) | `selectionBar` | `getActionButtons(actionContext)` | `onActionClick(buttonId, assetIds[])` |

**Button/panel descriptor fields:**

| Namespace | `get…()` returns array of |
| --- | --- |
| `assetDetails` | `{ id, title, tooltip, icon, contentUrl }` |
| `card` | `{ id, label, icon }` |
| `selectionBar` | `{ id, label, icon }` |

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
