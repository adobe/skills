# Return View Buttons (`commerce/backend-ui/2`)

Declare return (RMA) detail-page buttons under `adminUi.rma.viewButtons`. Use the same common fields and validation as [order view buttons](order-view-buttons.md). Return `view` buttons also accept an optional non-empty `title` for the iframe page. Returns support `viewButtons` only — no `gridColumns` or `massActions`.

```ts
adminUi: {
  rma: {
    viewButtons: [
      {
        id: "return-details",
        label: "Return details",
        type: "view",
        path: "#/return",
        title: "Custom return details",
        sandboxPermissions: ["allow-modals"],
      },
      {
        id: "custom-return-flow",
        label: "Custom Return Flow",
        type: "worker",
        runtimeAction: "rma/custom-flow",
        timeout: 15,
        confirm: { message: "Run the custom return flow?" },
        notifications: {
          success: "Custom return flow completed.",
          error: "Unable to run the custom return flow.",
        },
      },
    ],
  },
}
```

## Worker handlers

Import `parseRmaViewButtonRequest`, `okRmaViewButtonResponse`, `rmaViewButtonErrorResponse`, and `getRmaViewButtonAclResourceId` from `@adobe/aio-commerce-sdk/admin-ui/rma-view-buttons`.

Commerce POSTs `{ rmaId, buttonId }` with the request ID in the `X-Request-ID` header; the parser normalizes this to `{ requestId, id, rmaId }`. Use its `rmaId` and `id` fields. Success returns an empty body. Errors return a message and HTTP status. ACL-protected buttons use the return-specific ACL helper, not the order helper.

## Iframe pages

Add a route matching `path` in `web-src`. Import `useRmaViewButtonContext` and `useHostConnection` from `@adobe/aio-commerce-lib-admin-ui/web`. Handle each hook's error before accessing `data.rmaId` or host actions. Use `actions.close()` on success or `actions.closeWithError()` on failure.

Regenerate with `generate all` to register return worker operations and scaffold web assets when a return view button requires them.
