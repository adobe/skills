# Invoice View Buttons (`commerce/backend-ui/2`)

Declare invoice detail-page buttons under `adminUi.invoice.viewButtons`.
Use the same common fields and validation as [order view buttons](order-view-buttons.md).
Invoice `view` buttons also accept an optional non-empty `title` for the iframe page.

```ts
adminUi: {
  invoice: {
    viewButtons: [
      {
        id: "invoice-details",
        label: "Invoice details",
        type: "view",
        path: "#/invoice-details",
        title: "Custom invoice details",
        sandboxPermissions: ["allow-modals"],
      },
      {
        id: "send-invoice",
        label: "Send invoice",
        type: "worker",
        runtimeAction: "invoice/send",
        timeout: 15,
        confirm: { message: "Send this invoice?" },
        notifications: {
          success: "Invoice sent successfully.",
          error: "Unable to send the invoice.",
        },
      },
    ],
  },
}
```

## Worker handlers

Import `parseInvoiceViewButtonRequest`, `okInvoiceViewButtonResponse`,
`invoiceViewButtonErrorResponse`, and `getInvoiceViewButtonAclResourceId` from
`@adobe/aio-commerce-sdk/admin-ui/invoice-view-buttons`.

The parser validates the invoice button request; use its `invoiceId` and `id`
fields. Success returns an empty body. Errors return a message and HTTP status.
ACL-protected buttons use the invoice-specific ACL helper, not the order helper.

## Iframe pages

Add a route matching `path` in `web-src`. Import `useInvoiceViewButtonContext`
and `useHostConnection` from `@adobe/aio-commerce-lib-admin-ui/web`.
Handle each hook's error before accessing `data.invoiceId` or host actions.
Use `actions.close()` on success or `actions.closeWithError()` on failure.

Regenerate with `generate all` to register invoice worker operations and scaffold
web assets when an invoice view button requires them.
