# Admin Menu (`commerce/backend-ui/2`)

Adds a single custom entry to the Commerce Admin menu. The entry opens an iframe into the app's web UI (`web-src`).
Declared under `adminUi.menu` — a single object, **not an array**. There is no server handler.

## Config (`app.commerce.config.ts`)

```ts
import { MENU_SALES } from "@adobe/aio-commerce-sdk/admin-ui/menu";

adminUi: {
  menu: {
    id: "my_app_dashboard",               // required; letters, digits, / : _ only
    label: "My Dashboard",                 // required, non-empty — menu label
    description: "Custom dashboard.",       // required, non-empty
    parentMenu: MENU_SALES,                 // optional; a known Commerce menu (see below)
    pageTitle: "Dashboard",                 // optional; the page heading
    sandboxPermissions: ["allow-popups"],   // optional
  },
}
```

### Constraints

| Field                | Constraint                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Required; matches `^[A-Za-z0-9_/:]+$` — no hyphens or spaces                                                                        |
| `label`              | Required, non-empty                                                                                                                 |
| `description`        | Required, non-empty                                                                                                                 |
| `parentMenu`         | Optional; one of the `COMMERCE_MENUS` constants                                                                                     |
| `pageTitle`          | Optional, non-empty                                                                                                                 |
| `sandboxPermissions` | Optional; `allow-downloads` / `allow-modals` / `allow-popups`                                                                       |
| `aclProtected`       | Optional boolean; when `true`, Commerce generates a per-app ACL resource for the menu so admins can grant/deny menu access per role |

## Parent menu constants

Import from `@adobe/aio-commerce-sdk/admin-ui/menu`. Use the named constant rather than the raw string so a typo is a compile error:

| Constant         | Menu      |
| ---------------- | --------- |
| `MENU_SALES`     | Sales     |
| `MENU_CATALOG`   | Catalog   |
| `MENU_CUSTOMERS` | Customers |
| `MENU_MARKETING` | Marketing |
| `MENU_CONTENT`   | Content   |
| `MENU_REPORTS`   | Reports   |
| `MENU_STORES`    | Stores    |
| `MENU_SYSTEM`    | System    |

`COMMERCE_MENUS` is a readonly tuple of all eight; `isCommerceMenu(id)` narrows a string to a known menu ID.

## Rendering

**The menu has no `path` — it always opens the app's index route.** The menu page _is_ the index route (`src/pages/main-page.jsx`, registered as `{ index: true }` in `src/app.jsx`). Unlike view mass actions and view buttons, there is no per-entry route to scaffold for the menu; it reuses the index page every app already has.

That frontend is scaffolded automatically by init/generate (if it doesn't already exist; `index.html`, `src/app.jsx`, `src/pages/main-page.jsx`, `src/components/welcome.jsx`) — the generated `src/app.jsx` mounts the iframe app with `createExtensionApp` from `@adobe/aio-commerce-lib-admin-ui/web`:

```jsx
import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "#app.commerce.config";
import { MainPage } from "#web/pages/main-page.jsx";

createExtensionApp({
  metadata: { extensionId: config.metadata.id },
  routes: [{ index: true, element: <MainPage /> }],
});
```

The menu page renders as the index route — edit `src/pages/main-page.jsx` or add `{ path, element }` routes for more pages. Because there is no runtime action, no Admin UI handler builders are needed for the menu — only the `/admin-ui/menu` constants for `parentMenu`.
