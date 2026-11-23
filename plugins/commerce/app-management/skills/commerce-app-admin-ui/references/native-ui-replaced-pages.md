# Native UI Form Replacements (`commerce/backend-ui/2`)

Replaces a supported native Commerce Admin form with an app page. Declare replacements under `adminUi.nativeUi.replacedPages`. Each page renders as an iframe from the app's `web-src`; it does not need a server handler.

```ts
adminUi: {
  nativeUi: {
    replacedPages: [
      {
        target: "order.create",
        path: "#/create-order",
        title: "Create Order (App)",
        sandboxPermissions: ["allow-modals"],
      },
    ],
  },
}
```

### Supported target

| Target          | Native form   |
| --------------- | ------------- |
| `order.create`  | Create order  |
| `return.create` | Create return |

Other targets are rejected during app-config validation. The Commerce instance must have an Admin UI SDK
version whose native form catalog includes the chosen target. Return creation passes any available
`order_id` and `customer_id` to the app route. A native target can be replaced by only one app at a time.

| Field                | Constraint                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `target`             | Required; one of the targets listed above                                                                        |
| `path`               | Required, non-empty; exact route string to register in the app's web source                                      |
| `title`              | Required, non-empty                                                                                              |
| `sandboxPermissions` | Optional, non-empty array with no duplicates; each value is `allow-downloads`, `allow-modals`, or `allow-popups` |

The app build automatically adds the Admin UI `view` operation and web source when at least one replaced page is configured. Add a matching frontend route for the configured `path`, following Step 3 of the [Admin UI skill](../SKILL.md#step-3--register-the-extension-point). Use `useCustomerContext` and `useStoreContext` from `@adobe/aio-commerce-lib-admin-ui/web` to read `customerId` and `storeId` independently. Commerce may omit either value; each hook returns an error when its identifier is missing, null, or not a string or finite number, and guarantees a string identifier on success. Numeric host values are converted to strings; existing strings retain leading zeros.
