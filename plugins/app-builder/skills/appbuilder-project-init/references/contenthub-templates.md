# Content Hub Extension File Templates

Complete templates for every Content Hub extension scaffold file. Before writing, substitute:
- `{{EXTENSION_NAME}}` → kebab-case name (e.g. `my-asset-viewer`)
- `{{DISPLAY_NAME}}` → Title Case name (e.g. `My Asset Viewer`)
- `{{EXTENSION_DESCRIPTION}}` → one-sentence description

Extension point used throughout: `aem/assets/contenthub/1`
Source directory: `src/aem-assets-contenthub-1/`

> Only write the namespace components you need — `PanelAssetDetailsExtensionTab.js` (assetDetails), `CardActionModal.js` (card), `SelectionBarModal.js` (selectionBar). The shared skeleton (`package.json`, `index.html`, `index.js`, `index.css`, `Constants.js`, `App.js`, `actions/*`, `hooks/post-deploy.js`, `.eslintrc.js`) is always written.


---

## `package.json`

```json
{
  "name": "{{EXTENSION_NAME}}",
  "version": "1.0.0",
  "description": "{{EXTENSION_DESCRIPTION}}",
  "author": "",
  "license": "Apache-2.0",
  "scripts": {
    "test": "jest --passWithNoTests --testPathIgnorePatterns web-src",
    "dev": "aio app run",
    "build": "aio app build",
    "deploy": "aio app deploy",
    "undeploy": "aio app undeploy"
  },
  "dependencies": {
    "@adobe/aio-sdk": "^5.0.0",
    "@adobe/uix-guest": "0.10.5",
    "@adobe/react-spectrum": "^3.0.0",
    "chalk": "^4.0.0",
    "js-yaml": "^4.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0",
    "react-error-boundary": "^4.0.0"
  },
  "devDependencies": {
    "@adobe/eslint-config-aio-lib-config": "^3.0.0",
    "eslint": "^8.0.0",
    "jest": "^29.0.0"
  },
  "engines": {
    "node": "^18 || ^20"
  }
}
```

---

## `app.config.yaml`

```yaml
extensions:
  aem/assets/contenthub/1:
    $include: src/aem-assets-contenthub-1/ext.config.yaml
```

**Critical (Content Hub):** Use `aem/assets/contenthub/1` — not the deprecated `aem/contenthub/assets/details/1`. If the user's existing project has the old extension point ID, update both this file and the directory name.

---

## `src/aem-assets-contenthub-1/ext.config.yaml`

```yaml
$schema: https://unpkg.com/@adobe/aio-schemas@latest/schemas/aio.schema.json
actions: actions
web: web-src
runtimeManifest:
  packages:
    aem-assets-contenthub-1:
      license: Apache-2.0
      actions:
        generic:
          function: actions/generic/index.js
          web: 'yes'
          runtime: 'nodejs:18'
          inputs:
            LOG_LEVEL: debug
          annotations:
            require-adobe-auth: false
            final: true
operations:
  view:
    - type: web
      impl: index.html
hooks:
  post-app-deploy: ./hooks/post-deploy.js
```

---

## `extension-manifest.json`

```json
{
  "name": "{{EXTENSION_NAME}}",
  "id": "aem-assets-contenthub-1",
  "description": "{{EXTENSION_DESCRIPTION}}",
  "version": "1.0.0",
  "engines": {
    "aio-cli": ">=10.0.0"
  },
  "keywords": ["contenthub", "assets", "extension", "uix"],
  "author": "",
  "license": "Apache-2.0",
  "extensionPoints": ["aem/assets/contenthub/1"]
}
```

---

## `.eslintrc.js`

```js
module.exports = {
  root: true,
  extends: ['@adobe/eslint-config-aio-lib-config'],
  env: {
    node: true,
    es2020: true,
    browser: true
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  }
};
```

---

## `AGENTS.md`

```markdown
# {{DISPLAY_NAME}} — Agent Guidelines

## Extension Point

`aem/assets/contenthub/1` — Content Hub extensibility.

## Active Namespaces

- `assetDetails` — tab panels in the Asset Details Dialog side rail
- `card` — action buttons on asset cards (Assets grid, collection, link share) and on collection tiles in the Collections grid
- `selectionBar` — bulk action buttons in the selection bar (multi-select)

(Remove entries for namespaces not wired in ExtensionRegistration.js)

## Project Structure

- `src/aem-assets-contenthub-1/web-src/` — React SPA (Spectrum UI, UIX Guest)
- `src/aem-assets-contenthub-1/actions/` — Adobe I/O Runtime web actions
- `app.config.yaml` — declares `aem/assets/contenthub/1` extension point
- `src/aem-assets-contenthub-1/ext.config.yaml` — runtime manifest

## Building & Running

Use `aio` CLI commands (not npm scripts directly):
- `aio app build` — build and deploy actions to I/O Runtime, compile web-src
- `aio app run` — start local dev server at https://localhost:9080
- `aio app deploy` — full deployment to Stage/Production

## Local Test URL

```
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/
```

First time: accept the self-signed cert at https://localhost:9080.

## Key Files to Customize

- `ExtensionRegistration.js` — declares all namespaces. Uses `let guestConnection` so `onActionClick` can call `host.modal.openDialog()` after `register()` resolves.
- `PanelAssetDetailsExtensionTab.js` — panel UI for `assetDetails` namespace (rendered in iframe)
- `CardActionModal.js` — modal UI for `card` namespace; reads its data from the `contentUrl` query (`URLSearchParams`), NOT `getPayload()`
- `SelectionBarModal.js` — modal UI for `selectionBar` namespace; reads `assetIds[]` from the `contentUrl` query (`URLSearchParams` + `JSON.parse`), NOT `getPayload()`
- `actions/generic/index.js` — server-side logic for AEM API calls

## Host APIs (via `guestConnection.host` in any attached page)

- `auth.getIMSInfo()` → `{ imsOrg, imsOrgName, accessToken }`
- `auth.getApiKey()` → API key string  ← note: `getApiKey`, not `getAPIKey`
- `discovery.getAemHost()` → `https://<repoId>/`
- `toast.display({ variant, message })` → show toast; variants: `neutral`, `positive`, `negative`, `info`
- `i18n.getLocalizationInfo()` → `{ locale }`
- `modal.openDialog({ title, contentUrl, type?, size?, payload? })` → open modal dialog. **Single config object from the guest's side** — the UIX host auto-injects `{ id }`; never pass it yourself. Pass data to the modal either via the `contentUrl` query string (e.g. `/#card-action-modal?resourceId=...&resourceType=...`) or via `payload`.
- `modal.getPayload()` → returns the `payload` passed to `openDialog()`. Call from the modal page after `attach()`.
- `modal.closeDialog()` → close the current modal (call from the modal page after `attach()`)

## assetDetails: getCurrentAsset()

`assetDetails.getCurrentAsset()` returns the asset id as a plain **STRING** (e.g. `"urn:aaid:aem:..."`), NOT an object. Use it directly or wrap: `const asset = { id: assetId }`.

## card: getActionButtons receives actionContext

The host calls `getActionButtons(actionContext)` with:
- `actionContext.context`: `'assets'` | `'collection'` | `'collections'` | `'share'` — the source view.
  `assets`, `collection`, and `share` are asset-card surfaces; `collections` is a collection tile
  on the Collections grid. Use it to vary buttons per surface, or ignore it to show the same set.

The same `card` namespace serves both asset cards and collection tiles — distinguish them via
`actionContext.context` (and `resourceType` on click).

## card: onActionClick signature

Called by the host as `onActionClick(resourceType, buttonId, resourceId, actionContext)`:
- `resourceType`: `'asset'` (asset cards) or `'collection'` (collection tiles)
- `buttonId`: the `id` from `getActionButtons()`
- `resourceId`: the asset or collection URN string
- `actionContext`: `{ context }` — same surface values as above

## selectionBar: getActionButtons receives actionContext

The host calls `selectionBar.getActionButtons(actionContext)` with:
- `actionContext.context`: `'assets'` | `'collections'` | `'collection'` | `'share'` — the source view
- `actionContext.resourceSelection.resources`: `[{id: string}, ...]` — the current selection

Use this to conditionally show/hide buttons depending on where the bar appears, or ignore it.

## selectionBar: onActionClick signature

Called by the host as `onActionClick(buttonId, assetIds)`:
- `buttonId`: the `id` from `getActionButtons()`
- `assetIds`: `string[]` — array of selected asset URNs

Note: the host prefixes the rendered button id as `ext:<extensionId>:<btn.id>` to avoid collisions with native actions. Your extension code uses the original `btn.id` — the prefix is host-internal only.
```

---

## `hooks/post-deploy.js`

```js
const chalk = require('chalk');
const fs = require('fs');
const yaml = require('js-yaml');

module.exports = (config) => {
  try {
    const yamlFile = fs.readFileSync(`${config.root}/app.config.yaml`, 'utf8');
    const yamlData = yaml.load(yamlFile);
    const { extensions } = yamlData;
    const extension = Object.keys(extensions)[0];
    const previewData = {
      extensionPoint: extension,
      url: config.project.workspace.app_url,
    };
    const base64EncodedData = Buffer.from(JSON.stringify(previewData)).toString('base64');
    console.log(chalk.magenta(chalk.bold('For a developer preview of your UI extension in the Content Hub environment, follow the URL:')));
    const env = process.env.AIO_CLI_ENV === 'stage' ? '-stage' : '';
    console.log(chalk.magenta(chalk.bold(`  -> https://experience${env}.adobe.com/aem/extension-manager/preview/${base64EncodedData}`)));
  } catch (_) {
    // Non-fatal: just skip the preview URL
  }
};
```

---

## `src/aem-assets-contenthub-1/web-src/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{EXTENSION_NAME}}</title>
</head>
<body>
<noscript>You need to enable JavaScript to run this app.</noscript>
<div id="root"></div>
<script src="./src/index.js" async type="module"></script>
</body>
</html>
```

---

## `src/aem-assets-contenthub-1/web-src/src/index.js`

```js
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App.js';
import './index.css';

const root = createRoot(document.getElementById('root'));
root.render(<App />);
```

---

## `src/aem-assets-contenthub-1/web-src/src/index.css`

```css
html, body {
  margin: 0;
}
```

---

## `src/aem-assets-contenthub-1/web-src/src/config.json`

```json
{
  "aem-assets-contenthub-1/generic": "https://localhost:9080/api/v1/web/aem-assets-contenthub-1/generic"
}
```

This file is overwritten by `aio app run` (localhost URL) and `aio app deploy` (cloud URL). Do not edit manually.

---

## `src/aem-assets-contenthub-1/web-src/src/components/Constants.js`

```js
export const extensionId = 'sample-extension';
```

The `extensionId` **must** be identical in `register()` (ExtensionRegistration.js) and `attach()` (PanelAssetDetailsExtensionTab.js). Both import from this file.

---

## `src/aem-assets-contenthub-1/web-src/src/components/App.js`

Include only the imports and routes for the namespaces selected in Step 2. Remove unused imports/routes.

```js
import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import ExtensionRegistration from './ExtensionRegistration';
import PanelAssetDetailsExtensionTab from './PanelAssetDetailsExtensionTab';  // assetDetails namespace — remove if not selected
import CardActionModal from './CardActionModal';       // card namespace — remove if not selected
import SelectionBarModal from './SelectionBarModal';  // selectionBar namespace — remove if not selected

function App() {
  return (
    <Router>
      <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
        <Routes>
          <Route index element={<ExtensionRegistration />} />
          <Route path="index.html" element={<ExtensionRegistration />} />
          {/* assetDetails namespace — remove if not selected */}
          <Route path="asset-details-extension-tab" element={<PanelAssetDetailsExtensionTab />} />
          {/* card namespace — remove if not selected */}
          <Route path="card-action-modal" element={<CardActionModal />} />
          {/* selectionBar namespace — remove if not selected */}
          <Route path="selection-bar-modal" element={<SelectionBarModal />} />
        </Routes>
      </ErrorBoundary>
    </Router>
  );

  function onError(e, componentStack) {
    console.error('Extension error:', e, componentStack);
  }

  function fallbackComponent({ componentStack, error }) {
    return (
      <React.Fragment>
        <h1 style={{ textAlign: 'center', marginTop: '20px' }}>Extension rendering error</h1>
        <pre>{componentStack + '\n' + error.message}</pre>
      </React.Fragment>
    );
  }
}

export default App;
```

**Adding more panels:** Add a new `<Route path="my-second-panel" element={<MySecondPanel />} />` here, and a matching `contentUrl: '/#my-second-panel'` entry in `ExtensionRegistration.js`.

---

## `src/aem-assets-contenthub-1/web-src/src/components/ExtensionRegistration.js`

Contains all three Content Hub namespaces. **When scaffolding, include only the namespace blocks the user selected in Step 2.** Each block is clearly marked — remove unused ones. `card` and `selectionBar` require `let guestConnection` (not `const`) because `onActionClick` is called after `register()` resolves.

```js
import React from 'react';
import { Text, View } from '@adobe/react-spectrum';
import { register } from '@adobe/uix-guest';
import { extensionId } from './Constants';

// Restrict extension to specific repos.
// Format: 'delivery-pXXX-eYYY.adobeaemcloud.com'
// Empty array = allow any repo (safe for development; populate before deploying to Production).
const allowedRepos = [
  // 'delivery-p12345-e167890.adobeaemcloud.com',
];

function getRepo() {
  return new URLSearchParams(window.location.search).get('repo');
}

function shouldSkipRegistration(repo) {
  return allowedRepos.length > 0 && !allowedRepos.includes(repo);
}

function ExtensionRegistration() {
  const repo = getRepo();

  if (shouldSkipRegistration(repo)) {
    return <Text>IFrame for integration with Host (Content Hub), Skipped registration as repo is not allowed</Text>;
  }

  const init = async () => {
    // `let` (not `const`) so card/selectionBar onActionClick handlers can close over it after register() resolves.
    let guestConnection = await register({
      id: extensionId,
      methods: {

        // ── ASSET DETAILS NAMESPACE ──────────────────────────────────────────
        // Tab panels in the Asset Details Dialog side rail.
        // Remove this block if assetDetails was not selected.
        assetDetails: {
          getTabPanels() {
            return [
              {
                id: '{{EXTENSION_NAME}}-panel',
                title: '{{DISPLAY_NAME}}',
                tooltip: '{{DISPLAY_NAME}}',
                icon: 'Extension',          // React-Spectrum workflow icon name
                contentUrl: '/#asset-details-extension-tab',  // must match a <Route path> in App.js
              },
            ];
          },
        },

        // ── ASSET CARD NAMESPACE ─────────────────────────────────────────────
        // Buttons on individual asset card menus (3-dot / overlay) AND on collection
        // tiles in the Collections grid (the tile's ⋯ menu). Remove this block if card
        // was not selected.
        // getActionButtons receives an actionContext from the host:
        //   { context: 'assets'|'collection'|'collections'|'share' }
        //   'assets' (browse grid), 'collection' (assets inside a collection),
        //   'share' (link share view) are asset-card surfaces;
        //   'collections' is a collection tile on the Collections grid.
        // onActionClick is called with (resourceType, buttonId, resourceId, actionContext)
        //   resourceType: 'asset' (asset cards) | 'collection' (collection tiles)
        card: {
          getActionButtons(actionContext) {
            // Vary buttons by actionContext.context, or ignore it to show the same set.
            return [
              {
                id: '{{EXTENSION_NAME}}-card-action',
                label: '{{DISPLAY_NAME}}',
                icon: 'Edit',               // React-Spectrum workflow icon name
              },
            ];
          },
          async onActionClick(resourceType, buttonId, resourceId, actionContext) {
            // openDialog takes a SINGLE config object — NO { id } first arg, NO payload field.
            // Pass data to the modal via the contentUrl query string (read it there with URLSearchParams).
            await guestConnection.host.modal.openDialog({
              title: '{{DISPLAY_NAME}}',
              contentUrl: `/#card-action-modal?resourceId=${encodeURIComponent(resourceId)}&resourceType=${encodeURIComponent(resourceType)}`,  // route in App.js + query data
              type: 'modal',
              size: 'M',
            });
          },
        },

        // ── SELECTION BAR NAMESPACE ──────────────────────────────────────────
        // Bulk action buttons in the selection bar (shown when assets are selected).
        // Remove this block if selectionBar was not selected.
        //
        // getActionButtons receives an actionContext from the host:
        //   { context: 'assets'|'collections'|'collection'|'share',
        //     resourceSelection: { resources: [{id: string}, ...] } }
        // Use it to conditionally show/hide buttons per source, or ignore it to always show.
        //
        // onActionClick is called by the host with (buttonId, assetIds[])
        selectionBar: {
          getActionButtons(actionContext) {
            // actionContext.context tells you where the selection bar is shown:
            //   'assets' (browse grid), 'collections' (collections list),
            //   'collection' (inside a collection), 'share' (link share view).
            // actionContext.resourceSelection.resources is the current selection as [{id}, ...].
            return [
              {
                id: '{{EXTENSION_NAME}}-bulk-action',
                label: '{{DISPLAY_NAME}}',
                icon: 'Download',           // React-Spectrum workflow icon name
              },
            ];
          },
          async onActionClick(buttonId, assetIds) {
            // Single config object — NO { id }, NO payload. Pass assetIds via the contentUrl query.
            const ids = encodeURIComponent(JSON.stringify(assetIds || []));
            await guestConnection.host.modal.openDialog({
              title: `{{DISPLAY_NAME}} (${assetIds.length} asset${assetIds.length !== 1 ? 's' : ''})`,
              contentUrl: `/#selection-bar-modal?assetIds=${ids}`,  // route in App.js + query data
              type: 'modal',
              size: 'M',
            });
          },
        },

      },
    });
  };

  init().catch(console.error);
  return (
    <View padding="size-400" UNSAFE_style={{ fontFamily: 'sans-serif', textAlign: 'center', marginTop: '80px' }}>
      <Text UNSAFE_style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>✅</Text>
      <Text UNSAFE_style={{ fontSize: '20px', fontWeight: 'bold', display: 'block', marginBottom: '12px' }}>
        Certificate accepted!
      </Text>
      <Text UNSAFE_style={{ fontSize: '15px', color: '#555', display: 'block' }}>
        Return to <strong>Claude Code</strong> in your terminal and click{' '}
        <strong>&quot;Done — open the extension&quot;</strong> to continue.
      </Text>
    </View>
  );
}

export default ExtensionRegistration;
```

---

## `src/aem-assets-contenthub-1/web-src/src/components/PanelAssetDetailsExtensionTab.js`

This is the panel content rendered inside Content Hub's iframe. All Host API calls go through `guestConnection.host`.

```js
import React, { useState, useEffect } from 'react';
import { attach } from '@adobe/uix-guest';
import {
  Provider,
  defaultTheme,
  View,
  Heading,
  Text,
  Button,
  ProgressCircle,
  Divider,
} from '@adobe/react-spectrum';
import { extensionId } from './Constants';
import actions from '../config.json';

export default function PanelAssetDetailsExtensionTab() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionResponse, setActionResponse] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Reconnect to the registered extension.
        // extensionId must match the id used in register() — both come from Constants.js.
        const connection = await attach({ id: extensionId });
        setGuestConnection(connection);

        // getCurrentAsset() returns the asset id as a plain string (e.g. "urn:aaid:aem:...").
        // Note: this is Content Hub's API. Assets View uses a different method.
        const assetId = await connection.host.assetDetails.getCurrentAsset();
        setAsset({ id: assetId });

        // ── Call a web action with the asset ID ────────────────────────────
        // Uncomment and customize for AEM API calls:
        //
        // const { accessToken, imsOrg } = await connection.host.auth.getIMSInfo();
        // const apiKey = await connection.host.auth.getApiKey();
        // const aemHost = await connection.host.discovery.getAemHost();
        // const actionUrl = actions['aem-assets-contenthub-1/generic'];
        //
        // const response = await fetch(actionUrl, {
        //   method: 'POST',
        //   headers: {
        //     'Content-Type': 'application/json',
        //     // Add these when action has require-adobe-auth: true:
        //     // 'Authorization': `Bearer ${accessToken}`,
        //     // 'x-gw-ims-org-id': imsOrg,
        //   },
        //   body: JSON.stringify({ assetId: currentAsset.id, aemHost, apiKey, imsOrg }),
        // });
        // const data = await response.json();
        // setActionResponse(data);

      } catch (err) {
        console.error('Panel initialization error:', err);
        setError('Failed to initialize panel: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function displayToast(variant, message) {
    if (guestConnection) {
      guestConnection.host.toast.display({ variant, message });
    }
  }

  if (loading) {
    return (
      <Provider theme={defaultTheme}>
        <View padding="size-400" height="100vh">
          <View UNSAFE_style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <ProgressCircle aria-label="Loading..." isIndeterminate />
          </View>
        </View>
      </Provider>
    );
  }

  return (
    <Provider theme={defaultTheme}>
      <View padding="size-400">
        <Heading level={3}>{{DISPLAY_NAME}}</Heading>

        <Divider marginY="size-200" />

        {error && (
          <View marginBottom="size-200" backgroundColor="negative" padding="size-100" borderRadius="regular">
            <Text>{error}</Text>
          </View>
        )}

        {asset && (
          <View marginBottom="size-200">
            <Text><strong>Asset ID:</strong></Text>
            <View marginTop="size-100" padding="size-100" backgroundColor="gray-100" borderRadius="regular">
              <Text UNSAFE_style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                {asset.id}
              </Text>
            </View>
          </View>
        )}

        {actionResponse && (
          <View marginBottom="size-200">
            <Divider marginY="size-200" />
            <Text><strong>Action Response:</strong></Text>
            <View marginTop="size-100" padding="size-100" backgroundColor="gray-100" borderRadius="regular"
              UNSAFE_style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
              <Text>{JSON.stringify(actionResponse, null, 2)}</Text>
            </View>
          </View>
        )}

        <Button
          variant="accent"
          marginTop="size-300"
          onPress={() => displayToast('positive', 'Action from {{DISPLAY_NAME}} panel!')}
        >
          Show Toast
        </Button>
      </View>
    </Provider>
  );
}
```

---

## `src/aem-assets-contenthub-1/web-src/src/components/CardActionModal.js`

Modal opened when a card action button is clicked. Reads the data passed via the `contentUrl` query string (the simpler alternative to `openDialog()`'s `payload`/`getPayload()` — either works), and uses `attach()` only so it can call `closeDialog()`. Only scaffold this file if `card` was selected in Step 2.

```js
import React, { useState, useEffect } from 'react';
import { attach } from '@adobe/uix-guest';
import {
  Provider,
  defaultTheme,
  View,
  Text,
  Button,
  ProgressCircle,
} from '@adobe/react-spectrum';
import { extensionId } from './Constants';

export default function CardActionModal() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    (async () => {
      // Read data from the modal URL query (alternative: openDialog()'s payload + host.modal.getPayload()).
      // contentUrl was `/#card-action-modal?resourceId=...&resourceType=...`.
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      setPayload({ resourceId: params.get('resourceId'), resourceType: params.get('resourceType') });
      // attach() is only needed so the Close button can call host.modal.closeDialog().
      const connection = await attach({ id: extensionId });
      setGuestConnection(connection);
    })();
  }, []);

  if (!payload) {
    return (
      <Provider theme={defaultTheme}>
        <View padding="size-400" height="100vh">
          <View UNSAFE_style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <ProgressCircle aria-label="Loading..." isIndeterminate />
          </View>
        </View>
      </Provider>
    );
  }

  return (
    <Provider theme={defaultTheme}>
      <View padding="size-300">
        <View marginBottom="size-200">
          <Text UNSAFE_style={{ display: 'block', fontSize: '12px', color: '#6e6e6e', marginBottom: '4px' }}>
            Resource Type
          </Text>
          <Text UNSAFE_style={{ display: 'block' }}>{payload.resourceType}</Text>
        </View>

        <View marginBottom="size-300">
          <Text UNSAFE_style={{ display: 'block', fontSize: '12px', color: '#6e6e6e', marginBottom: '4px' }}>
            Resource ID
          </Text>
          <View padding="size-100" backgroundColor="gray-100" borderRadius="regular">
            <Text UNSAFE_style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all', display: 'block' }}>
              {payload.resourceId}
            </Text>
          </View>
        </View>

        {/* Add your custom UI here */}

        <Button
          variant="accent"
          onPress={() => guestConnection?.host.modal.closeDialog()}
        >
          Close
        </Button>
      </View>
    </Provider>
  );
}
```

---

## `src/aem-assets-contenthub-1/web-src/src/components/SelectionBarModal.js`

Modal opened when a selection bar (bulk action) button is clicked. Reads `assetIds[]` from the `contentUrl` query (the simpler alternative to `openDialog()`'s `payload`/`getPayload()` — either works). Only scaffold this file if `selectionBar` was selected in Step 2.

```js
import React, { useState, useEffect } from 'react';
import { attach } from '@adobe/uix-guest';
import {
  Provider,
  defaultTheme,
  View,
  Text,
  Button,
  ProgressCircle,
  ListView,
  Item,
} from '@adobe/react-spectrum';
import { extensionId } from './Constants';

export default function SelectionBarModal() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    (async () => {
      // Read assetIds from the modal URL query (alternative: openDialog()'s payload + host.modal.getPayload()).
      // contentUrl was `/#selection-bar-modal?assetIds=<json>`.
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const raw = params.get('assetIds');
      setPayload({ assetIds: raw ? JSON.parse(raw) : [] });
      // attach() is only needed so the Close button can call host.modal.closeDialog().
      const connection = await attach({ id: extensionId });
      setGuestConnection(connection);
    })();
  }, []);

  if (!payload) {
    return (
      <Provider theme={defaultTheme}>
        <View padding="size-400" height="100vh">
          <View UNSAFE_style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <ProgressCircle aria-label="Loading..." isIndeterminate />
          </View>
        </View>
      </Provider>
    );
  }

  return (
    <Provider theme={defaultTheme}>
      <View padding="size-300">
        <View marginBottom="size-200">
          <Text UNSAFE_style={{ display: 'block', fontSize: '12px', color: '#6e6e6e', marginBottom: '4px' }}>
            {payload.assetIds.length} asset{payload.assetIds.length !== 1 ? 's' : ''} selected
          </Text>
        </View>

        <View marginBottom="size-300" maxHeight="size-3000" overflow="auto">
          <ListView aria-label="Selected assets" items={payload.assetIds.map(id => ({ id }))}>
            {item => (
              <Item key={item.id}>
                <Text UNSAFE_style={{ fontFamily: 'monospace', fontSize: '12px' }}>{item.id}</Text>
              </Item>
            )}
          </ListView>
        </View>

        {/* Add your bulk-action logic here */}

        <Button
          variant="accent"
          onPress={() => guestConnection?.host.modal.closeDialog()}
        >
          Close
        </Button>
      </View>
    </Provider>
  );
}
```

---

## `src/aem-assets-contenthub-1/actions/utils.js`

```js
function errorResponse(statusCode, message) {
  return { statusCode, body: { error: message } };
}

function getBearerToken(params) {
  const authHeader = params.__ow_headers?.authorization || params.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  throw new Error('Missing or invalid authorization header');
}

function checkMissingRequestInputs(params, requiredParams) {
  const missing = requiredParams.filter(param => !params[param]);
  if (missing.length > 0) {
    return `Missing required parameters: ${missing.join(', ')}`;
  }
  return null;
}

module.exports = { errorResponse, getBearerToken, checkMissingRequestInputs };
```

---

## `src/aem-assets-contenthub-1/actions/generic/index.js`

The web action called by the panel. Customize with real AEM API logic.

```js
const { errorResponse, getBearerToken, checkMissingRequestInputs } = require('../utils');

/**
 * Generic Web Action — {{DISPLAY_NAME}}
 *
 * Called from PanelAssetDetailsExtensionTab.js with the current asset ID.
 * Customize this to call AEM Assets Author API.
 *
 * Params passed from the panel:
 *   assetId  — asset urn from host.assetDetails.getCurrentAsset()
 *   aemHost  — AEM author URL from host.discovery.getAemHost()
 *   apiKey   — from host.auth.getApiKey() (never hardcode)
 *   imsOrg   — from host.auth.getIMSInfo()
 *
 * To call authenticated AEM APIs:
 *   1. Set require-adobe-auth: true in ext.config.yaml
 *   2. Send Authorization header from the panel
 *   3. Uncomment the fetch block below
 */
async function main(params) {
  console.log('{{EXTENSION_NAME}} action called', JSON.stringify({ assetId: params.assetId }, null, 2));

  try {
    // Uncomment for authenticated AEM API calls:
    // const token = getBearerToken(params);
    // const { assetId, aemHost, apiKey, imsOrg } = params;
    //
    // const response = await fetch(`https://${aemHost}/adobe/assets/${assetId}/metadata`, {
    //   headers: {
    //     'Authorization': `Bearer ${token}`,
    //     'X-Api-Key': apiKey,           // always from frontend — never hardcode
    //     'x-gw-ims-org-id': imsOrg,
    //     'Content-Type': 'application/json',
    //   },
    // });
    // const data = await response.json();
    // const metadata = data.value ?? data;
    // return { statusCode: 200, body: { metadata } };

    return {
      statusCode: 200,
      body: {
        message: 'Action executed successfully',
        extension: '{{EXTENSION_NAME}}',
        timestamp: new Date().toISOString(),
        assetId: params.assetId || null,
      },
    };

  } catch (error) {
    console.error('Action error:', error);
    return errorResponse(500, `Action failed: ${error.message}`);
  }
}

exports.main = main;
```

---

## `README.md`

```markdown
# {{DISPLAY_NAME}}

Content Hub UI extension for the `aem/assets/contenthub/1` extension point.

## Extension Point

`aem/assets/contenthub/1` — adds custom tab panels to the Asset Details Dialog.

## Project Structure

```
src/aem-assets-contenthub-1/
  web-src/src/components/
    ExtensionRegistration.js  — registers tab panels with Content Hub
    PanelAssetDetailsExtensionTab.js — custom panel UI (rendered in iframe)
    App.js                    — React routing
    Constants.js              — extensionId (shared between register + attach)
  actions/
    generic/index.js          — I/O Runtime web action (AEM API calls)
    utils.js                  — shared action utilities
  ext.config.yaml             — runtime manifest + action definitions
app.config.yaml               — declares aem/assets/contenthub/1 extension point
```

## Development

```bash
npm install
aio app build
aio app run
```

Test URL:
```
https://experience.adobe.com/?devMode=true&ext=https://localhost:9080#/assets/contenthub/
```

No `&repo=` needed for local dev — the scaffold sets `allowedRepos = []`, so any repo (or none) works.

> First time only: accept the self-signed cert at https://localhost:9080 before loading the test URL.

## Allowed Repos

Before deploying to Production, update `allowedRepos` in `ExtensionRegistration.js` with your delivery repo IDs — this restricts which AEM repos may load the extension:

```js
const allowedRepos = ['delivery-p12345-e167890.adobeaemcloud.com'];
```

## Deploy

**Stage:** `aio app use -w Stage && aio app deploy`

**Production:** `aio app use -w Production && aio app deploy`

Approve in [Extension Manager](https://experience.adobe.com/aem/extension-manager) after deploying to Production.
```

---

## Adding a Second Panel

When the user wants a second tab panel, make these changes:

### In `ExtensionRegistration.js` — add to the `getTabPanels()` array:

```js
getTabPanels() {
  return [
    {
      id: '{{EXTENSION_NAME}}-panel',
      title: '{{DISPLAY_NAME}}',
      tooltip: '{{DISPLAY_NAME}}',
      icon: 'Extension',
      contentUrl: '/#asset-details-extension-tab',
    },
    {
      id: '{{EXTENSION_NAME}}-second-panel',
      title: 'Second Panel',
      tooltip: 'Second Panel',
      icon: 'Info',
      contentUrl: '/#second-panel',    // must match the route added in App.js
    },
  ];
},
```

### In `App.js` — add a route:

```js
import SecondPanel from './SecondPanel';   // create this component

<Route path="second-panel" element={<SecondPanel />} />
```

### Create `SecondPanel.js` — copy the `PanelAssetDetailsExtensionTab.js` template, rename the component and customize the UI.
