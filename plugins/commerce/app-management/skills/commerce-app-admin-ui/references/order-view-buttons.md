# Order View Buttons (`commerce/backend-ui/2`)

Adds a button to the order view (detail) page in Commerce Admin.
Declared under `adminUi.order.viewButtons` (an array). **Only the `order` entity supports view buttons.** Two variants, discriminated by `type`:

- **`worker`** — Commerce POSTs to a runtime action when the button is clicked (no UI).
- **`view`** — Commerce opens an iframe into the app's `web-src` at `path`, with `orderId` as a query parameter.

## Config (`app.commerce.config.ts`)

```ts
adminUi: {
  order: {
    viewButtons: [
      // worker — runs server-side
      {
        type: "worker",
        id: "sync-inventory",
        label: "Sync inventory",
        description: "Push this order to the warehouse.",
        runtimeAction: "my-app/sync-inventory",
        level: 0,      // optional: -1, 0, or 1 (placement/grouping)
        sortOrder: 10, // optional
        timeout: 15,   // optional, seconds
        confirm: { message: "Sync this order now?" },                  // optional
        notifications: { success: "Synced.", error: "Sync failed." },  // optional
      },
      // view — opens an iframe page
      {
        type: "view",
        id: "edit-shipping",
        label: "Edit shipping",
        path: "#/edit-shipping",              // route into web-src
        level: 0,
        sortOrder: 20,
        sandboxPermissions: ["allow-modals"], // optional
      },
    ],
  },
}
```

### Constraints

| Field                | Applies to | Constraint                                                                                                                          |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `type`               | both       | `"worker"` or `"view"` (strict object per variant)                                                                                  |
| `id`                 | both       | Required, non-empty                                                                                                                 |
| `label`              | both       | Required, non-empty                                                                                                                 |
| `description`        | both       | Optional, non-empty                                                                                                                 |
| `level`              | both       | Optional; one of `-1`, `0`, `1`                                                                                                     |
| `sortOrder`          | both       | Optional positive number                                                                                                            |
| `confirm`            | both       | Optional `{ title?, message? }`                                                                                                     |
| `notifications`      | both       | Optional `{ success?, error? }`                                                                                                     |
| `aclProtected`       | both       | Optional boolean; when `true`, Commerce generates a per-app nested ACL resource for the button so admins can grant/deny it per role |
| `runtimeAction`      | worker     | Required; `<package>/<action>`                                                                                                      |
| `timeout`            | worker     | Optional positive number (seconds)                                                                                                  |
| `path`               | view       | Required; route into `web-src`                                                                                                      |
| `sandboxPermissions` | view       | Optional; `allow-downloads` / `allow-modals` / `allow-popups`                                                                       |

## Worker handler wire contract

Import from `@adobe/aio-commerce-sdk/admin-ui/order-view-buttons`.

Commerce POSTs `{ requestId, id, orderId }` — `id` identifies which button was clicked (useful when one handler serves several). The HTTP status code conveys success vs. failure.

- `parseOrderViewButtonRequest(params)` → `{ requestId, id, orderId }`; throws `CommerceSdkValidationError` on malformed input.
- `okOrderViewButtonResponse()` → success; empty `{}` body.
- `orderViewButtonErrorResponse(statusCode, message)` → error; `{ message }` body.

```typescript
import {
  parseOrderViewButtonRequest,
  okOrderViewButtonResponse,
  orderViewButtonErrorResponse,
} from "@adobe/aio-commerce-sdk/admin-ui/order-view-buttons";

import type { RuntimeActionParams } from "@adobe/aio-commerce-sdk/core/params";

export async function main(params: RuntimeActionParams) {
  const { id, orderId } = parseOrderViewButtonRequest(params);
  try {
    await sync(orderId);
    return okOrderViewButtonResponse();
  } catch (error) {
    return orderViewButtonErrorResponse(
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
```

## View variant (iframe)

No server handler. Commerce opens the iframe at `path` into the app's generated `web-src` (add a matching `{ path, element }` route in `src/app.jsx`). Inside the route component, read the order with `useOrderViewButtonContext` and signal completion with `useHostConnection`, both from `@adobe/aio-commerce-lib-admin-ui/web`:

```jsx
import {
  useHostConnection,
  useOrderViewButtonContext,
} from "@adobe/aio-commerce-lib-admin-ui/web";

function EditShippingPage() {
  const { data, error: contextError } = useOrderViewButtonContext();
  const { actions, error: hostError } = useHostConnection();
  if (contextError) throw contextError;
  if (hostError) throw hostError;

  const { orderId } = data; // the order the button was clicked on
  // ...do the work, then await actions.close() on success
  // or actions.closeWithError() on failure
}
```

On `actions.close()` / `actions.closeWithError()`, Commerce closes the frame, redirects back to the order view page, and renders the configured notification. `useOrderViewButtonContext` returns an error when the frame is not running as an order view-button extension point within Commerce. The example throws hook errors during render so the SDK's error boundary replaces the extension content with its fallback UI. To keep the page mounted, render custom recovery or degraded UI instead. Either throw or handle each error before reading `data.orderId` or calling the host actions.
