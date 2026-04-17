# AEM UI Extension Patterns

Patterns for building AEM UI Extensions using `@adobe/uix-guest`. These extensions customize AEM surfaces (Content Fragment Console, Content Fragment Editor, Universal Editor, Assets View) and run as App Builder apps inside iframes.

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
