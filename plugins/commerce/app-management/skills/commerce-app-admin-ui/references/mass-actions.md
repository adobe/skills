# Mass Actions (`commerce/backend-ui/2`)

Adds a bulk action to the order, product, or customer grid, applied to the records the user selects.
Declared under `adminUi.<entity>.massActions` (an array). Two variants, discriminated by `type`:

- **`worker`** — Commerce calls a runtime action with the selected ids (server-side processing).
- **`view`** — Commerce opens an iframe into the app's `web-src` at `path`; the selection is available through the Commerce shared context.

## Config (`app.commerce.config.ts`)

```ts
adminUi: {
  customer: {
    massActions: [
      // worker — server-side bulk processing
      {
        type: "worker",
        id: "archive-customers",
        label: "Archive",
        description: "Archive the selected customers.",
        runtimeAction: "my-app/archive-customers",
        timeout: 60,         // optional, seconds
        selectionLimit: 500, // optional, max selectable records
        confirm: { title: "Archive?", message: "This archives the selected customers." }, // optional
        notifications: { success: "Customers archived.", error: "Archive failed." },        // optional
      },
      // view — iframe UI that receives the selection
      {
        type: "view",
        id: "export-customers",
        label: "Export",
        path: "#/export-customers",              // route into web-src
        sandboxPermissions: ["allow-downloads"], // optional
        selectionLimit: 100,                     // optional
      },
    ],
  },
}
```

### Constraints

| Field                | Applies to | Constraint                                                                                                                          |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `type`               | both       | `"worker"` or `"view"` (strict — keys from the other variant are rejected)                                                          |
| `id`                 | both       | Required, non-empty                                                                                                                 |
| `label`              | both       | Required, non-empty                                                                                                                 |
| `description`        | both       | Optional, non-empty                                                                                                                 |
| `title`              | both       | Optional page title                                                                                                                 |
| `confirm`            | both       | Optional `{ title?, message? }`                                                                                                     |
| `notifications`      | both       | Optional `{ success?, error? }`                                                                                                     |
| `selectionLimit`     | both       | Optional positive number — max selectable records                                                                                   |
| `aclProtected`       | both       | Optional boolean; when `true`, Commerce generates a per-app nested ACL resource for the action so admins can grant/deny it per role |
| `runtimeAction`      | worker     | Required; `<package>/<action>`                                                                                                      |
| `timeout`            | worker     | Optional positive number (seconds)                                                                                                  |
| `path`               | view       | Required; route into `web-src`                                                                                                      |
| `sandboxPermissions` | view       | Optional; `allow-downloads` / `allow-modals` / `allow-popups`                                                                       |

Available on `order`, `product`, and `customer`.

## Worker handler wire contract

Import from `@adobe/aio-commerce-sdk/admin-ui/mass-actions`.

Commerce POSTs `{ requestId, gridType, selectedIds }` (`selectedIds` is non-empty). The HTTP status code conveys success vs. failure.

- `parseMassActionRequest(params)` → `{ requestId, gridType, selectedIds }`; throws `CommerceSdkValidationError` on malformed input.
- `okMassActionResponse(body?)` → HTTP 200; optional body for logging.
- `massActionErrorResponse(statusCode, message)` → non-2xx; body is `{ message }`. Commerce surfaces `notifications.error`.

```typescript
import {
  parseMassActionRequest,
  okMassActionResponse,
  massActionErrorResponse,
} from "@adobe/aio-commerce-sdk/admin-ui/mass-actions";
import type { RuntimeActionParams } from "@adobe/aio-commerce-sdk/core/params";

export async function main(params: RuntimeActionParams) {
  const { gridType, selectedIds } = parseMassActionRequest(params);
  try {
    const archived = await archive(gridType, selectedIds);
    return okMassActionResponse({ archived });
  } catch (error) {
    return massActionErrorResponse(
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
```

## View variant (iframe)

No server handler. Commerce opens the iframe at `path` into the app's generated `web-src` (add a matching `{ path, element }` route in `src/app.jsx`). Read the user's selection inside the route component with `useMassActionContext` from `@adobe/aio-commerce-lib-admin-ui/web`; when done, close the frame with `useHostConnection`:

```jsx
import {
  useHostConnection,
  useMassActionContext,
} from "@adobe/aio-commerce-lib-admin-ui/web";

function ExportCustomersPage() {
  const { data, error: contextError } = useMassActionContext();
  const { actions, error: hostError } = useHostConnection();
  if (contextError) throw contextError;
  if (hostError) throw hostError;

  const { selectedIds } = data; // non-empty string[] — the selected record ids
  // ...render the UI, then await actions.close() on success
  // or actions.closeWithError() on failure
}
```

`useMassActionContext` returns an error if the frame is not running as a mass-action extension point within Commerce, or if `selectedIds` is missing, empty, or contains a non-string row ID. `useHostConnection` similarly returns an error when host frame actions are unavailable. The example throws these errors during render so the SDK's error boundary replaces the extension content with its fallback UI. To keep the page mounted, render custom recovery or degraded UI instead. Either throw or handle each error before reading `data.selectedIds` or calling `actions.close()` or `actions.closeWithError()`.
