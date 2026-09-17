# Grid Columns (`commerce/backend-ui/2`)

Adds custom columns to the order, product, or customer grid in Commerce Admin.
Grid columns are **worker-only**: Commerce calls a runtime action to fetch the cell values for the rows currently visible in the grid.

## Config (`app.commerce.config.ts`)

Declared under `adminUi.<entity>.gridColumns` where `<entity>` is `order`, `product`, or `customer`. One `gridColumns` object per entity.

```ts
adminUi: {
  order: {
    gridColumns: {
      label: "Fulfillment data",                    // required, non-empty
      description: "Warehouse fulfillment status.",  // required, non-empty
      runtimeAction: "my-app/order-grid",            // required; <package>/<action>
      columns: [                                     // required; at least one
        { id: "fulfillment_status", label: "Fulfillment", type: "string",  align: "left"  },
        { id: "risk_score",         label: "Risk",        type: "integer", align: "right" },
      ],
    },
  },
}
```

### Constraints

| Field                    | Constraint                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `label`                  | Required, non-empty                                                                                                                 |
| `description`            | Required, non-empty                                                                                                                 |
| `runtimeAction`          | Required; `<package>/<action>`; resolves to a worker action you declare                                                             |
| `columns`                | Required array; at least one entry                                                                                                  |
| `columns[].id`           | Required, non-empty; the key the handler returns for each row                                                                       |
| `columns[].label`        | Required, non-empty; column header shown in Admin                                                                                   |
| `columns[].type`         | Required; one of `boolean`, `date`, `datetime`, `float`, `integer`, `string`                                                        |
| `columns[].align`        | Required; one of `left`, `center`, `right`                                                                                          |
| `columns[].aclProtected` | Optional boolean; when `true`, Commerce generates a per-app nested ACL resource for the column so admins can grant/deny it per role |

## Handler wire contract

Import from `@adobe/aio-commerce-sdk/admin-ui/grid-columns`.

Commerce POSTs `{ requestId, gridType, ids }`:

- `gridType` — `"order" | "product" | "customer"`
- `ids` — `string[]`, the entity IDs of the visible rows

Builders:

- `parseGridRequest(params)` → `{ requestId, gridType, ids }`; throws `CommerceSdkValidationError` on malformed input.
- `okGridResponse(data, defaults?)` → success envelope. `data` is keyed by entity id; each value is an object keyed by column id. The optional `defaults` bag is serialized as the `"*"` key and applied to ids missing from `data` and to cells whose value does not match the declared column `type`.
- `errorGridResponse(statusCode, errorMessage)` → non-2xx HTTP response. Commerce uses the status code to distinguish success from failure. Body shape: `{ message }`.

```typescript
import {
  parseGridRequest,
  okGridResponse,
  errorGridResponse,
} from "@adobe/aio-commerce-sdk/admin-ui/grid-columns";
import type { RuntimeActionParams } from "@adobe/aio-commerce-sdk/core/params";

export async function main(params: RuntimeActionParams) {
  const { gridType, ids } = parseGridRequest(params);
  try {
    const byId = await fetchFulfillment(gridType, ids);
    return okGridResponse(
      byId, // { "000000001": { fulfillment_status: "shipped", risk_score: 12 }, ... }
      { fulfillment_status: "unknown", risk_score: 0 }, // optional defaults ("*")
    );
  } catch (error) {
    return errorGridResponse(
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
```

The keys inside each row object must match the `id` values declared in `columns`, or those cells render empty (or take the `defaults` value).
