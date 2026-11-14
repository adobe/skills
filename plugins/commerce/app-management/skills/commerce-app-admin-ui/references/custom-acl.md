# Custom ACL Resources (`commerce/backend-ui/2`)

Declares standalone ACL resources that are **not** bound to any Admin UI element. Declared under `adminUi.acl` — an array of named resources. There is no server handler, no runtime action, and no iframe.

Unlike `aclProtected` (which attaches a resource to a specific menu/column/button and lets Commerce enforce it server-side), custom ACL resources are **app-checked**: Commerce only renders them in the Admin User Roles tree so a merchant can grant or deny them per role, and reports their grant state. Your app reads that state at runtime and decides what to hide or block (an app-internal element, a branch in a runtime action, a feature flag).

## Config (`app.commerce.config.ts`)

```ts
adminUi: {
  acl: [
    // A group: one level of children, granted or denied together.
    { id: "reports", label: "Reports", children: [
      { id: "export", label: "Export" },
      { id: "view", label: "View" },
    ]},
    // A top-level leaf: no children.
    { id: "approve_refunds", label: "Approve Refunds" },
  ],
}
```

### Constraints

| Field         | Constraint                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`          | Required; matches `^[a-z0-9_]+$` (lowercase, digits, `_`). Must be unique among entries at the same level. |
| `label`       | Required; 3–50 characters. This is the only text shown in the User Roles tree.                             |
| `children`    | Optional array of leaf resources (`{ id, label }`). When present it must have at least one entry.          |
| nesting       | Exactly one level: a child is a leaf and cannot have its own `children` (grandchildren are rejected).      |
| `description` | Not supported. The User Roles tree renders only a node's title, so there is nowhere to show a description. |

## User Roles tree

Custom resources render under a per-app **Permissions** node, alongside the app's other Admin UI items:

```
Apps permissions
  My App
    Permissions
      Reports
        Export
        View
      Approve Refunds
```

Granting **Permissions** covers every custom resource; granting **Reports** covers Export and View together; granting a leaf covers only that resource.

## Checking a resource at runtime

Derive the resource id with `getCustomAclResourceId` and check it with the permission client — both from `@adobe/aio-commerce-sdk/admin-ui/api`. The id it produces matches the one Commerce generates, so the check stays in sync with what the merchant granted.

```ts
import {
  getCustomAclResourceId,
  getAdminUiPermissionClient,
} from "@adobe/aio-commerce-sdk/admin-ui/api";

const client = getAdminUiPermissionClient({ httpClient, appId: "my-app" });

// A leaf inside a group: pass the group id and the child id.
const canExport = await client.check(
  getCustomAclResourceId("my-app", "reports", "export"),
);

// A top-level leaf (or a whole group node): pass just the resource id.
const canRefund = await client.check(
  getCustomAclResourceId("my-app", "approve_refunds"),
);

if (canExport) {
  // show the export button / allow the action
}
```

`getCustomAclResourceId(appId, resourceId, childId?)` is a pure string function — no network call. Omit `childId` for a top-level resource or to check a group node (granting the group grants its children).

## No build wiring

Custom ACL resources need no runtime action and no `web-src` view, so they add nothing to `ext.config.yaml` — declaring them in `adminUi.acl` and running init/generate is all that is required for Commerce to receive them.
