import { defineConfig } from "@adobe/aio-commerce-lib-app/config";

export default defineConfig({
  metadata: {
    description: "A Commerce app built with aio-commerce-sdk.", // max 255 chars
    displayName: "My Commerce App", // shown in App Management UI, max 50 chars
    id: "my-commerce-app", // alphanumeric + hyphens only, max 100 chars
    version: "1.0.0", // Major.Minor.Patch only, no pre-release identifiers
  },
  webhooks: [
    // Entry type 1: handler is a runtime action in this app
    {
      category: "validation", // optional: "validation" | "append" | "modification"
      description: "Validates product data before saving.", // required, non-empty
      label: "Validate Product Save", // required, non-empty
      // env: ["paas"],                  // optional: scope to Commerce environments ("paas" | "saas"); omitted = all
      runtimeAction: "my-package/validate-product", // <package>/<action>; mutually exclusive with webhook.url
      webhook: {
        batch_name: "my_app", // [a-zA-Z0-9_]+ only — no hyphens or dots
        hook_name: "validate_product_save", // [a-zA-Z0-9_]+ only — no hyphens or dots
        method: "POST", // HTTP method
        webhook_method: "plugin.magento.catalog_product.save", // Commerce operation to intercept
        webhook_type: "before", // "before" or "after"
        // timeout: 5000,                  // optional: max ms to wait (positive integer)
        // soft_timeout: 3000,             // optional: soft limit before warning
        // required: true,                 // optional: if true, Commerce aborts if hook fails
        // priority: 100,                  // optional: execution order within batch
        // fields: [{ name: "sku" }, { name: "price" }], // optional: restrict payload fields
        // rules: [{ field: "type_id", operator: "equal", value: "simple" }], // optional: conditional trigger
        // headers: [{ name: "X-Api-Key", value: "secret" }], // optional: custom headers
      },
    },
    // Entry type 2: handler is an external URL
    {
      category: "append", // optional: "validation" | "append" | "modification"
      description: "Appends tax calculation from external service.", // required, non-empty
      label: "Append Tax Data", // required, non-empty
      webhook: {
        batch_name: "my_app",
        hook_name: "append_tax",
        method: "POST",
        url: "https://tax-service.example.com/webhook", // must be absolute URL; mutually exclusive with runtimeAction
        webhook_method: "plugin.magento.sales_order.place",
        webhook_type: "before",
      },
    },
  ],
});
