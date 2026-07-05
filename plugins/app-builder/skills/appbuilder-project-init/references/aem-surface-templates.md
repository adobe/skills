# AEM Surface Templates (CF Console, CF Editor, Universal Editor, Assets View)

These four surfaces all use **`@adobe/uix-guest`** and share the **same project skeleton** as Content Hub. Reuse [`file-templates.md`](file-templates.md) for every shared file — `package.json`, `index.html`, `index.js`, `index.css`, `actions/utils.js`, `actions/generic/index.js`, `hooks/post-deploy.js`, `README.md`, `AGENTS.md`, `.eslintrc.js` — swapping only:

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

Real ext.config.yaml files do **not** contain a `$schema` field. The hook key is `post-app-deploy` (not `post-deploy`), and the path uses `./` prefix. The `actions: actions` line is only needed when the extension has backend actions.

```yaml
operations:
  view:
    - type: web
      impl: index.html
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
hooks:
  post-app-deploy: ./hooks/post-deploy.js
```

> If the extension has no backend actions, omit `actions: actions` and the entire `runtimeManifest` block.

## Shared `app-metadata.json`

Real AEM extension samples ship an `app-metadata.json` at `src/app-metadata.json` that declares which extension point(s) the app registers for. It is imported and passed as `metadata` to `register()`.

**`src/app-metadata.json`:**
```json
{
    "extensions": [
        {
            "extensionPoint": "{{EXTENSION_POINT}}"
        }
    ]
}
```

**Usage in `ExtensionRegistration.js`:**
```js
import metadata from '../../../../app-metadata.json';

const guestConnection = await register({
  id: extensionId,
  metadata,
  methods: { ... }
});
```

> The `metadata` field was absent from the earlier template but is present in all real sample projects (cf-console-action-bar-button-sample, cf-console-header-menu-button-sample, cf-editor-rte-toolbar-button-sample, universal-editor-richtext-draft, universal-editor-task-management). Include it.

---

## § CF Console — `aem/cf-console-admin/1`

Extension dir: `aem-cf-console-admin-1`

### `Constants.js`

```js
// {{EXTENSION_NAME}} - Constants.js
module.exports = {
  extensionId: '{{EXTENSION_NAME}}'
}
```

### `ExtensionRegistration.js`

Include only the namespace blocks the user selected. Real samples show `actionBar`, `headerMenu`, and `contentFragmentGrid`.

```js
// {{EXTENSION_NAME}} - ExtensionRegistration.js

import { generatePath } from "react-router";
import { Text } from "@adobe/react-spectrum";
import { register } from "@adobe/uix-guest";
import { extensionId } from "./Constants";
import metadata from '../../../../app-metadata.json';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      metadata,
      methods: {
        // ── actionBar: buttons shown when one or more fragments are selected ──
        actionBar: {
          getButtons() {
            return [
              // YOUR ACTION BAR BUTTONS CODE SHOULD BE HERE
              {
                'id': '{{EXTENSION_NAME}}-action-button',
                'label': '{{DISPLAY_NAME}}',
                'icon': 'PublishCheck',
                onClick(selections) {
                  // selections is an array; each item has a .fragmentId property
                  const selectionIds = selections.map(selection => selection.fragmentId);
                  const modalURL = "/index.html#" + generatePath(
                    "/content-fragment/:selection/{{EXTENSION_NAME}}-modal",
                    {
                      selection: encodeURIComponent(selectionIds.join('|'))
                    }
                  );
                  console.log("Modal URL: ", modalURL);

                  guestConnection.host.modal.showUrl({
                    title: "{{DISPLAY_NAME}}",
                    url: modalURL,
                    fullscreen: true,
                  });
                },
              },
            ];
          },
        },

        // ── headerMenu: buttons always visible in the console header ─────────
        headerMenu: {
          getButtons() {
            return [
              // YOUR HEADER BUTTONS CODE SHOULD BE HERE
              {
                'id': '{{EXTENSION_NAME}}-header-button',
                'label': '{{DISPLAY_NAME}}',
                'icon': 'OpenIn',
                // Optional: variant — 'cta' | 'primary' | 'secondary' | 'negative' | 'action'
                variant: 'secondary',
                // Optional: subItems for a dropdown menu
                // subItems: [
                //   {
                //     id: '{{EXTENSION_NAME}}-sub-item',
                //     label: 'Sub Item',
                //     icon: 'Cloud',
                //     onClick: () => { ... },
                //   },
                // ],
                onClick() {
                  const modalURL = "/index.html#/{{EXTENSION_NAME}}-header-button-modal";
                  console.log("Modal URL: ", modalURL);

                  guestConnection.host.modal.showUrl({
                    title: "{{DISPLAY_NAME}}",
                    url: modalURL,
                    height: "360px",
                    width: "550px",
                  });
                },
              },
            ];
          },
        },

        // ── contentFragmentGrid: custom column in the fragment list ──────────
        contentFragmentGrid: {
          getColumns() {
            return [
              {
                id: "{{EXTENSION_NAME}}-extended-column",
                label: "{{DISPLAY_NAME}}",
                allowsResizing: true, // optional, by default "false"
                minWidth: 350,        // optional, no default value
                showDivider: true,    // optional, by default "false"
                render: async function (fragments) {
                  return fragments.reduce((accumulator, fragment) => {
                    accumulator[fragment.id] = 'Extended Column Value';
                    return accumulator;
                  }, {})
                },
              },
            ];
          }
        }
      },
    });
  };
  init().catch(console.error);

  return <Text>IFrame for integration with Host (AEM)...</Text>
}

export default ExtensionRegistration;
```

> **Selections:** Each selection object has a `.fragmentId` property (not `.id`). The action-bar-button-sample uses `selections.map(selection => selection.fragmentId)`.

> **`modal.showUrl()` dimensions:** Pass height/width as strings with units (`"360px"`, `"550px"`) or use `fullscreen: true`. Do not pass bare numbers.

> **`headerMenu` subItems:** A button can expose a dropdown by adding a `subItems` array. Each sub-item has the same shape as a top-level button (`id`, `label`, `icon`, `onClick`).

### `App.js`

```js
// {{EXTENSION_NAME}} - App.js

import React from "react";
import ErrorBoundary from "react-error-boundary";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import ExtensionRegistration from "./ExtensionRegistration";
import ActionButtonModal from "./ActionButtonModal";
import HeaderButtonModal from "./HeaderButtonModal";

function App() {
  return (
    <Router>
      <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
        <Routes>
          <Route index element={<ExtensionRegistration />} />
          <Route
            exact path="index.html"
            element={<ExtensionRegistration />}
          />
          <Route
            exact path="content-fragment/:selection/{{EXTENSION_NAME}}-modal"
            element={<ActionButtonModal />}
          />
          <Route
            exact path="{{EXTENSION_NAME}}-header-button-modal"
            element={<HeaderButtonModal />}
          />
          {/* YOUR CUSTOM ROUTES SHOULD BE HERE */}
        </Routes>
      </ErrorBoundary>
    </Router>
  )

  // error handler on UI rendering failure
  function onError(e, componentStack) {}

  // component to show if UI fails rendering
  function fallbackComponent({ componentStack, error }) {
    return (
      <React.Fragment>
        <h1 style={{ textAlign: "center", marginTop: "20px" }}>
          Phly, phly... Something went wrong :(
        </h1>
        <pre>{componentStack + "\n" + error.message}</pre>
      </React.Fragment>
    )
  }
}

export default App
```

> **Modal close:** In a modal page component, reconnect with `attach()` and call `guestConnection.host.modal.close()` to dismiss the dialog.

---

## § CF Editor — `aem/cf-editor/1`

Extension dir: `aem-cf-editor-1`

### `Constants.js`

```js
// {{EXTENSION_NAME}} - Constants.js
module.exports = {
  extensionId: '{{EXTENSION_NAME}}'
}
```

### `ExtensionRegistration.js`

Real `cf-editor-all-points` shows `headerMenu`, `rte` (with `getWidgets`, `getBadges`, `getCustomButtons`, `getColors`), `field`, and `rightPanel` namespaces.

```js
// {{EXTENSION_NAME}} - ExtensionRegistration.js

import { Text } from "@adobe/react-spectrum";
import { register } from "@adobe/uix-guest";
import { extensionId } from "./Constants";
import metadata from '../../../../app-metadata.json';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      metadata,
      methods: {
        // ── headerMenu: context-aware — can read the open fragment ──────────
        headerMenu: {
          getButtons() {
            return [
              // @todo YOUR HEADER BUTTONS DECLARATION SHOULD BE HERE
              {
                id: '{{EXTENSION_NAME}}-header-button',
                label: '{{DISPLAY_NAME}}',
                icon: 'OpenIn',
                onClick() {
                  const modalURL = "/index.html#/{{EXTENSION_NAME}}-header-button-modal";
                  console.log("Modal URL: ", modalURL);

                  guestConnection.host.modal.showUrl({
                    title: "{{DISPLAY_NAME}}",
                    url: modalURL,
                  });
                },
              },
            ];
          },
        },

        // ── rte: Rich Text Editor extensions ─────────────────────────────────
        rte: {
           getWidgets: () => ([
             // @todo YOUR RTE WIDGETS DECLARATION SHOULD BE HERE
             {
               id: "{{EXTENSION_NAME}}-widget",
               label: "{{DISPLAY_NAME}} Widget",
               url: "/index.html#/{{EXTENSION_NAME}}-widget",
             },
           ]),

           getBadges: () => ([
             // @todo YOUR RTE BADGES DECLARATION SHOULD BE HERE
             {
               id: "{{EXTENSION_NAME}}-badge",
               prefix: "{{",
               suffix: "}}",
               backgroundColor: "#D6F1FF",
               textColor: "#54719B",
             },
           ]),

          getCustomButtons: () => ([
             // @todo YOUR RTE TOOLBAR BUTTONS DECLARATION SHOULD BE HERE
             {
               id: "{{EXTENSION_NAME}}-rte-button",
               tooltip: "{{DISPLAY_NAME}}",
               icon: 'Plug',
               onClick: (state) => {
                 // state = { html, text, selectedHtml, selectedText }
                 return [{
                   type: "replaceContent",
                   value: state.html + "<p>Inserted by {{DISPLAY_NAME}}</p>"
                 }];
               },
             },
          ]),

          getColors() {
            return {
              allowedColors: [
                "FFCC00", "Yellow",
                "0000CC", "Blue",
                "FF0000", "Red",
                "00FF00", "Green",
              ],
              isAllowedCustomColors: true,
            };
          },
        },

        // ── field: custom field renderers ─────────────────────────────────────
        field: {
          getDefinitions: () => {
            return [
              // @todo YOUR CUSTOM FIELD DEFINITIONS SHOULD BE HERE
              // fieldNameExp is a regex matched against the CF model field name
              {
                fieldNameExp: '^{{EXTENSION_NAME}}_field$',
                url: '/#/{{EXTENSION_NAME}}-field',
              },
            ];
          },
        },

        // ── rightPanel: side rails in the editor ─────────────────────────────
        rightPanel: {
          addRails() {
            return [
              {
                extension: extensionId,
                id: "{{EXTENSION_NAME}}-rail",
                header: "{{DISPLAY_NAME}}",
                url: '/index.html#/rail/1',
                icon: 'Export',
              }
            ];
          },
        },

      }
    });
  };
  init().catch(console.error);

  return <Text>IFrame for integration with Host (AEM)...</Text>;
}

export default ExtensionRegistration;
```

> The `rte` API (custom buttons, badges, widgets, colors) may be replaced when AEM adopts a new RTE engine. It works today; plan for migration.

### `App.js`

```js
// {{EXTENSION_NAME}} - App.js

import React from "react";
import ErrorBoundary from "react-error-boundary";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import ExtensionRegistration from "./ExtensionRegistration";
import HeaderButtonModal from "./HeaderButtonModal";
import RteWidget from "./RteWidget";
import CustomField from "./CustomField";
import RailContent from "./RailContent";

function App() {
    return (
        <Router>
            <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
                <Routes>
                    <Route index element={<ExtensionRegistration/>}/>
                    <Route
                        exact path="index.html"
                        element={<ExtensionRegistration/>}
                    />
                    <Route
                        exact path="{{EXTENSION_NAME}}-header-button-modal"
                        element={<HeaderButtonModal/>}
                    />
                    <Route
                        exact path="{{EXTENSION_NAME}}-widget"
                        element={<RteWidget/>}
                    />
                    <Route
                        exact path="{{EXTENSION_NAME}}-field"
                        element={<CustomField/>}
                    />
                    <Route
                        exact path="rail/:railId"
                        element={<RailContent/>}
                    />
                    {/* YOUR CUSTOM ROUTES SHOULD BE HERE */}
                </Routes>
            </ErrorBoundary>
        </Router>
    )

    // error handler on UI rendering failure
    function onError(e, componentStack) {
    }

    // component to show if UI fails rendering
    function fallbackComponent({componentStack, error}) {
        return (
            <React.Fragment>
                <h1 style={{textAlign: "center", marginTop: "20px"}}>
                    Phly, phly... Something went wrong :(
                </h1>
                <pre>{componentStack + "\n" + error.message}</pre>
            </React.Fragment>
        );
    }
}

export default App;
```

---

## § Universal Editor — `universal-editor/ui/1`

> **Extension point is `universal-editor/ui/1`**, not `aem/universal-editor/1`. The old name is incorrect — all real project files (`app.config.yaml`, `app-metadata.json`) use `universal-editor/ui/1`.

Extension dir: `universal-editor-ui-1`

### `ExtensionRegistration.js`

Real UE examples show two main patterns: `canvas.getRenderers()` (for custom field/component renderers in the canvas) and `rightPanel.addRails()` (for side panel rails). The product-picker example uses `canvas`; the richtext-draft and task-management examples use `rightPanel`.

```js
// {{EXTENSION_NAME}} - ExtensionRegistration.js

import { Text } from "@adobe/react-spectrum";
import { register } from "@adobe/uix-guest";
import { extensionId } from "./Constants";
import metadata from '../../../../app-metadata.json';

function ExtensionRegistration() {
  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      metadata,
      debug: true,
      methods: {
        // ── canvas: custom component/field renderers in the editor canvas ─────
        // Use this when you need to render a custom picker or UI inside a field.
        canvas: {
          getRenderers() {
            // guestConnection.configuration holds extension config from App Builder
            const dataType = guestConnection.configuration?.["component-type"] || "{{EXTENSION_NAME}}";

            return [
              {
                extension: extensionId,
                dataType: dataType,
                url: '/index.html#/{{EXTENSION_NAME}}-field',
              },
            ];
          },
        },

        // ── rightPanel: side rails in the Universal Editor ────────────────────
        // Use this to add a side panel rail alongside the page being edited.
        rightPanel: {
          addRails() {
            return [
              {
                extension: extensionId,
                id: "{{EXTENSION_NAME}}-rail",
                header: "{{DISPLAY_NAME}}",
                url: `/index.html#/{{EXTENSION_NAME}}-rail`,
                hotkey: "w",
                icon: "Draft",
              }
            ];
          }
        },
      },
    });
  };
  init().catch(console.error);

  return <Text>IFrame for integration with Host (AEM)...</Text>;
}

export default ExtensionRegistration;
```

> Use `canvas.getRenderers()` OR `rightPanel.addRails()` depending on the extension's purpose — include only what is needed.

> `guestConnection.configuration` provides the extension's App Builder configuration at runtime (e.g. environment-specific URLs, feature flags). Access it after `register()` resolves.

### `App.js`

```js
// {{EXTENSION_NAME}} - App.js

import React from "react";
import ErrorBoundary from "react-error-boundary";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import ExtensionRegistration from "./ExtensionRegistration";
import ExtensionField from "./ExtensionField";
import RailContent from "./RailContent";

function App() {
  return (
    <Router>
      <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
        <Routes>
          <Route index element={<ExtensionRegistration />} />
          <Route
            exact path="index.html"
            element={<ExtensionRegistration />}
          />
          <Route
            exact path="{{EXTENSION_NAME}}-field"
            element={<ExtensionField />}
          />
          <Route
            exact path="{{EXTENSION_NAME}}-rail"
            element={<RailContent />}
          />
          {/* YOUR CUSTOM ROUTES SHOULD BE HERE */}
        </Routes>
      </ErrorBoundary>
    </Router>
  );

  // error handler on UI rendering failure
  function onError(e, componentStack) {}

  // component to show if UI fails rendering
  function fallbackComponent({ componentStack, error }) {
    return (
      <React.Fragment>
        <h1 style={{ textAlign: "center", marginTop: "20px" }}>
          Phly, phly... Something went wrong :(
        </h1>
        <pre>{componentStack + "\n" + error.message}</pre>
      </React.Fragment>
    );
  }
}

export default App;
```

---

## § Assets View — `aem/assets/1`

> **No verified example available.** No real example exists in the `aem-uix-examples` repository for this surface. The pattern is similar to CF Console but uses `aem/assets/1` as the extension point and `aem-assets-1` as the extension dir. Verify all namespaces and API shapes against the [official Adobe UIX Assets View docs](https://developer.adobe.com/uix/docs/services/aem-assets-view/) before using.

> **Prerequisite:** AEM Assets Ultimate license. If the org lacks it, the extension won't load.

Extension point: `aem/assets/1`
Extension dir: `aem-assets-1`

Use this `app.config.yaml`:
```yaml
extensions:
  aem/assets/1:
    $include: src/aem-assets-1/ext.config.yaml
```

No code template is provided here — generate code only after verifying the current namespace API against the official documentation.

---

## Quick reference

| Surface | Extension Point | extDir | Namespaces (real examples) | Key host APIs |
| --- | --- | --- | --- | --- |
| CF Console | `aem/cf-console-admin/1` | `aem-cf-console-admin-1` | `actionBar`, `headerMenu` (+ `subItems`), `contentFragmentGrid` | `modal.showUrl()`, `modal.close()` |
| CF Editor | `aem/cf-editor/1` | `aem-cf-editor-1` | `headerMenu`, `rte` (`getWidgets`, `getBadges`, `getCustomButtons`, `getColors`), `field`, `rightPanel` | `modal.showUrl()`, `toaster`, `contentFragment` |
| Universal Editor | `universal-editor/ui/1` | `universal-editor-ui-1` | `canvas.getRenderers()`, `rightPanel.addRails()` | `guestConnection.configuration` |
| Assets View | `aem/assets/1` | `aem-assets-1` | Not verified — see Adobe docs | Not verified |

> **Modal pages and host utilities** (toaster, progressCircle, modal.showUrl) are covered in [`../appbuilder-ui-scaffolder/references/aem-extensions.md`](../../appbuilder-ui-scaffolder/references/aem-extensions.md) § Modal Dialogs and § Host Utilities — read that file for patterns; only the scaffold files above are surface-specific.
