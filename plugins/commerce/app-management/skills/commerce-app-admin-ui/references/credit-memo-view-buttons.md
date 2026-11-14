# Credit Memo View Buttons (`commerce/backend-ui/2`)

Declare credit memo detail-page buttons under `adminUi.creditMemo.viewButtons`.
Use the same common fields and validation as [order view buttons](order-view-buttons.md).
Credit memo `view` buttons also accept an optional non-empty `title` for the iframe page.

```ts
adminUi: {
  creditMemo: {
    viewButtons: [
      {
        id: "credit-memo-details",
        label: "Credit memo details",
        type: "view",
        path: "#/creditmemo",
        title: "Custom credit memo details",
        sandboxPermissions: ["allow-modals"],
      },
      {
        id: "refund-offline",
        label: "Refund Offline",
        type: "worker",
        runtimeAction: "creditmemo/refund-offline",
        timeout: 15,
        confirm: { message: "Refund this credit memo offline?" },
        notifications: {
          success: "Credit memo refunded successfully.",
          error: "Unable to refund the credit memo.",
        },
      },
    ],
  },
}
```

## Worker handlers

Import `parseCreditMemoViewButtonRequest`, `okCreditMemoViewButtonResponse`,
`creditMemoViewButtonErrorResponse`, and `getCreditMemoViewButtonAclResourceId` from
`@adobe/aio-commerce-sdk/admin-ui/credit-memo-view-buttons`.

The parser validates the credit memo button request; use its `creditMemoId` and `id`
fields. Success returns an empty body. Errors return a message and HTTP status.
ACL-protected buttons use the credit memo-specific ACL helper, not the order helper.

## Iframe pages

Add a route matching `path` in `web-src`. Import `useCreditMemoViewButtonContext`
and `useHostConnection` from `@adobe/aio-commerce-lib-admin-ui/web`.
Handle each hook's error before accessing `data.creditMemoId` or host actions.
Use `actions.close()` on success or `actions.closeWithError()` on failure.

Regenerate with `generate all` to register credit memo worker operations and scaffold
web assets when a credit memo view button requires them.
