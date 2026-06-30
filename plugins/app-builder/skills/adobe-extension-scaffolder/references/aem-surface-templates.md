# AEM Surface Templates (CF Console, CF Editor, Universal Editor, Assets View)

These four surfaces all use **`@adobe/uix-guest`** and share the **same project skeleton** as Content Hub. Reuse [`file-templates.md`](file-templates.md) for every shared file — `package.json`, `index.html`, `index.js`, `index.css`, `Constants.js`, `App.js`, `actions/utils.js`, `actions/generic/index.js`, `hooks/post-deploy.js`, `README.md`, `AGENTS.md`, `.eslintrc.js` — swapping only:

- the directory `aem-assets-contenthub-1` → `surfaceConfig.extDir`
- the package name in `ext.config.yaml` → matches `extDir`
- the extension point in `app.config.yaml` → `surfaceConfig.extensionPointId`
- the `register()` `methods` object → the surface-specific block below

Placeholders: `{{EXTENSION_NAME}}`, `{{DISPLAY_NAME}}`, `{{EXTENSION_DESCRIPTION}}`, `{{EXTENSION_DIR}}` (= `surfaceConfig.extDir`), `{{EXTENSION_POINT}}` (= `surfaceConfig.extensionPointId`).

> **Auth on AEM surfaces differs from Content Hub.** These surfaces expose auth through `guestConnection.sharedContext`, not `host.auth`:
> ```js
> const ctx = guestConnection.sharedContext;
> const aemHost  = ctx.get('aemHost');        // e.g. author-p12345-e67890.adobeaemcloud.com
> const imsOrg   = ctx.get('auth').imsOrg;
> const imsToken = ctx.get('auth').imsToken;   // Bearer token for AEM API calls
> const apiKey   = ctx.get('auth').apiKey;
> ```

---

## Shared `app.config.yaml` (all AEM surfaces)

```yaml
extensions:
  {{EXTENSION_POINT}}:
    $include: src/{{EXTENSION_DIR}}/ext.config.yaml
```

## Shared `ext.config.yaml` (all AEM surfaces)

Same as Content Hub but with the package key renamed to `{{EXTENSION_DIR}}`:

```yaml
$schema: https://unpkg.com/@adobe/aio-schemas@latest/schemas/aio.schema.json
actions: actions
web: web-src
runtimeManifest:
  packages:
    {{EXTENSION_DIR}}:
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
  post-deploy: hooks/post-deploy.js
```

## § CF Console — `aem/cf-console-admin/1`

`ExtensionRegistration.js` — include only the namespace blocks the user selected in Step 2.

```js
import React from 'react';
import { Text } from '@adobe/react-spectrum';
import { register } from '@adobe/uix-guest';
import { extensionId } from './Constants';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      methods: {
        // ── actionBar: buttons shown when fragments are selected ──────────────
        actionBar: {
          getButtons() {
            return [
              {
                id: '{{EXTENSION_NAME}}-action',
                label: '{{DISPLAY_NAME}}',
                icon: 'Export',                 // React Spectrum workflow icon name
                onClick(selections) {
                  // selections = array of selected fragment objects
                  guestConnection.host.modal.showUrl({
                    title: '{{DISPLAY_NAME}}',
                    url: '/index.html#/modal',   // must match a <Route> in App.js
                    width: 600,
                    height: 'auto',
                  });
                },
              },
            ];
          },
        },

        // ── headerMenu: buttons always visible in the console header ──────────
        headerMenu: {
          getButtons() {
            return [
              {
                id: '{{EXTENSION_NAME}}-header',
                label: '{{DISPLAY_NAME}}',
                icon: 'Import',
                variant: 'action',              // cta | primary | secondary | negative | action
                onClick() {
                  guestConnection.host.modal.showUrl({
                    title: '{{DISPLAY_NAME}}',
                    url: '/index.html#/modal',
                  });
                },
              },
            ];
          },
        },

        // ── contentFragmentGrid: custom column in the fragment list ───────────
        contentFragmentGrid: {
          getColumns() {
            return [
              {
                id: '{{EXTENSION_NAME}}-col',
                label: '{{DISPLAY_NAME}}',
                render: async (fragments) =>
                  fragments.reduce((acc, f) => {
                    acc[f.id] = f.status || 'Draft';
                    return acc;
                  }, {}),
              },
            ];
          },
        },
      },
    });
  };

  init().catch(console.error);
  return <Text>IFrame for integration with Host (CF Console)...</Text>;
}

export default ExtensionRegistration;
```

**Selections programmatically:** `await guestConnection.host.fragmentSelections.getSelections()`.

---

## § CF Editor — `aem/cf-editor/1`

```js
import React from 'react';
import { Text } from '@adobe/react-spectrum';
import { register } from '@adobe/uix-guest';
import { extensionId } from './Constants';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      methods: {
        // ── headerMenu: context-aware — can read the open fragment ────────────
        headerMenu: {
          getButtons() {
            return [
              {
                id: '{{EXTENSION_NAME}}-validate',
                label: '{{DISPLAY_NAME}}',
                icon: 'CheckmarkCircle',
                async onClick() {
                  const fragment = await guestConnection.host.contentFragment.getContentFragment();
                  console.log('fragment path:', fragment.path, 'fields:', fragment.fields);
                  guestConnection.host.toaster.display({ variant: 'positive', message: 'Validated' });
                },
              },
            ];
          },
        },

        // ── rte: custom RTE toolbar buttons & badges (deprecated API, works today) ──
        rte: {
          getCustomButtons: () => [
            {
              id: '{{EXTENSION_NAME}}-insert',
              tooltip: '{{DISPLAY_NAME}}',
              icon: 'Info',
              onClick: (state) => [
                // state = { html, text, selectedHtml, selectedText }
                { type: 'replaceContent', value: state.html + '<p class="note">Inserted by {{DISPLAY_NAME}}.</p>' },
              ],
            },
          ],
          getBadges: () => [
            { id: '{{EXTENSION_NAME}}-var', prefix: '{{', suffix: '}}', backgroundColor: '#D6F1FF', textColor: '#54719B' },
          ],
        },
      },
    });
  };

  init().catch(console.error);
  return <Text>IFrame for integration with Host (CF Editor)...</Text>;
}

export default ExtensionRegistration;
```

> The `rte` API (custom buttons, badges, core-button control) is deprecated and will be replaced when AEM adopts a new RTE engine. It works today; plan for migration.

---

## § Universal Editor — `aem/universal-editor/1`

```js
import React from 'react';
import { Text } from '@adobe/react-spectrum';
import { register } from '@adobe/uix-guest';
import { extensionId } from './Constants';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      methods: {
        headerMenu: {
          getButtons() {
            return [
              {
                id: '{{EXTENSION_NAME}}-preview',
                label: '{{DISPLAY_NAME}}',
                icon: 'Preview',
                onClick() {
                  guestConnection.host.modal.showUrl({
                    title: '{{DISPLAY_NAME}}',
                    url: '/index.html#/panel',
                    fullscreen: true,
                  });
                },
              },
            ];
          },
        },
      },
    });
  };

  init().catch(console.error);
  return <Text>IFrame for integration with Host (Universal Editor)...</Text>;
}

export default ExtensionRegistration;
```

**Properties-rail panel:** render a separate page that reconnects with `attach()`:

```js
// src/{{EXTENSION_DIR}}/web-src/src/components/Panel.js
import React from 'react';
import { attach } from '@adobe/uix-guest';
import { extensionId } from './Constants';
// In useEffect: const guestConnection = await attach({ id: extensionId });
// Read context via guestConnection.sharedContext; render Spectrum UI.
```

---

## § Assets View — `aem/assets/1`

> **Prerequisite:** AEM Assets Ultimate license. If the org lacks it, the extension won't load — surface this to the user.

```js
import React from 'react';
import { Text } from '@adobe/react-spectrum';
import { register } from '@adobe/uix-guest';
import { extensionId } from './Constants';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      methods: {
        actionBar: {
          getButtons() {
            return [
              {
                id: '{{EXTENSION_NAME}}-action',
                label: '{{DISPLAY_NAME}}',
                icon: 'Edit',
                onClick(selections) {
                  guestConnection.host.modal.showUrl({
                    title: '{{DISPLAY_NAME}}',
                    url: '/index.html#/modal',
                  });
                },
              },
            ];
          },
        },
        headerMenu: {
          getButtons() {
            return [
              {
                id: '{{EXTENSION_NAME}}-header',
                label: '{{DISPLAY_NAME}}',
                icon: 'Settings',
                onClick() {
                  guestConnection.host.modal.showUrl({ title: '{{DISPLAY_NAME}}', url: '/index.html#/modal' });
                },
              },
            ];
          },
        },
      },
    });
  };

  init().catch(console.error);
  return <Text>IFrame for integration with Host (Assets View)...</Text>;
}

export default ExtensionRegistration;
```

The Assets View extension surface is newer and evolving — see [`../appbuilder-ui-scaffolder/references/aem-extensions.md`](../../appbuilder-ui-scaffolder/references/aem-extensions.md) and the [Assets View docs](https://developer.adobe.com/uix/docs/services/aem-assets-view/) for the latest extension points.

> **Modal pages and host utilities** (toaster, progressCircle, modal.showUrl) are covered in [`../appbuilder-ui-scaffolder/references/aem-extensions.md`](../../appbuilder-ui-scaffolder/references/aem-extensions.md) § Modal Dialogs and § Host Utilities — read that file for patterns; only the scaffold files above are surface-specific.

## Quick reference

| Surface | Extension Point | Namespaces | Key host APIs |
| --- | --- | --- | --- |
| CF Console | `aem/cf-console-admin/1` | `actionBar`, `headerMenu`, `contentFragmentGrid` | `fragmentSelections`, `modal`, `toaster`, `progressCircle` |
| CF Editor | `aem/cf-editor/1` | `headerMenu`, `rte` | `contentFragment`, `modal`, `toaster` |
| Universal Editor | `aem/universal-editor/1` | `headerMenu`, properties panel | `modal` |
| Assets View | `aem/assets/1` | `actionBar`, `headerMenu` | `modal` |
