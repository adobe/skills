import { defineConfig } from "@adobe/aio-commerce-lib-app/config";

export default defineConfig({
  eventing: {
    // Commerce-native events emitted by Adobe Commerce
    commerce: [
      {
        events: [
          {
            description: "Triggered when a customer places an order.", // max 255 chars
            // fields to extract from the event payload; empty array = full payload
            fields: [{ name: "order_id" }, { name: "customer_email" }],
            label: "Order Placed", // max 100 chars
            name: "plugin.order_placed", // plugin.<segments> or observer.<segments>; [a-z_]+ per segment; max 180 chars
            // rules: [ // optional: filter when the action fires
            //   { field: "order_total", operator: "greaterThan", value: "100" },
            // ],
            // env: ["saas"], // optional: scope to Commerce environments ("paas" | "saas"); omitted = all
            runtimeActions: ["my-package/handle-order-placed"], // <package>/<action>
          },
        ],
        provider: {
          description: "Handles native Commerce events for this app.", // max 255 chars
          label: "Commerce Events Provider", // max 100 chars
          // key: "my-provider-key", // optional: alphanumeric + hyphens, max 50 chars
        },
      },
    ],
    // Events from third-party systems
    external: [
      {
        events: [
          {
            description: "Triggered when inventory changes in the ERP system.", // max 255 chars
            label: "Inventory Updated", // max 100 chars
            name: "erp.inventory_updated", // [\w\-_.]+ pattern; max 180 chars
            // env: ["paas"], // optional: scope to Commerce environments ("paas" | "saas"); omitted = all
            runtimeActions: ["my-package/handle-inventory-updated"], // <package>/<action>
          },
        ],
        provider: {
          description: "Handles events from external systems.", // max 255 chars
          label: "External Events Provider", // max 100 chars
        },
      },
    ],
  },
  metadata: {
    description: "A Commerce app built with aio-commerce-sdk.", // max 255 chars
    displayName: "My Commerce App", // shown in App Management UI, max 50 chars
    id: "my-commerce-app", // alphanumeric + hyphens only, max 100 chars
    version: "1.0.0", // Major.Minor.Patch only, no pre-release identifiers
  },
});
