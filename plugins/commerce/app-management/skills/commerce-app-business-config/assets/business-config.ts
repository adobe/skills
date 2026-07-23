import { defineConfig } from "@adobe/aio-commerce-lib-app/config";

export default defineConfig({
  businessConfig: {
    schema: [
      // Single-select list — merchant picks one value from a fixed set
      {
        default: "fedex", // required for single; must exactly match one of the option values
        description: "Select the active shipping provider.", // optional; shown as help text
        label: "Shipping Provider", // optional; shown as field label in Admin
        name: "shipping_provider", // required, non-empty; used as config key at runtime
        options: [
          // required for list fields; each option needs both label and value
          { label: "FedEx", value: "fedex" },
          { label: "UPS", value: "ups" },
          { label: "DHL", value: "dhl" },
        ],
        selectionMode: "single", // "single" or "multiple"
        type: "list",
      },
      // Multi-select list — merchant picks one or more values
      {
        default: ["cc", "paypal"], // optional array; defaults to []; each must match an option value
        label: "Enabled Payment Methods",
        name: "enabled_payment_methods",
        options: [
          { label: "Credit Card", value: "cc" },
          { label: "PayPal", value: "paypal" },
          { label: "Apple Pay", value: "apple_pay" },
        ],
        selectionMode: "multiple",
        type: "list",
      },
      // Text — free-form string input
      {
        default: "", // optional string; defaults to ""
        description: "Internal identifier for this store.",
        label: "Store Code",
        name: "store_code",
        type: "text",
      },
      // Password — masked input for secrets; shown as *** in Admin
      {
        default: "", // must be "" — non-empty defaults are rejected to prevent secrets in config
        description: "Secret key for the external service.",
        label: "API Key",
        name: "api_key",
        type: "password",
      },
      // Email — validated email address input
      {
        default: "", // "" or a fully valid email address (e.g. "admin@example.com")
        label: "Notification Email",
        name: "notification_email",
        type: "email",
      },
      // URL — validated absolute URL input
      {
        default: "", // "" or a fully valid absolute URL (e.g. "https://service.example.com/hook")
        label: "Webhook Endpoint",
        name: "webhook_endpoint",
        type: "url",
      },
      // Tel — phone number input
      {
        default: "", // "" or matches /^\+?[0-9\s\-()]+$/ (e.g. "+1 (800) 555-0100")
        label: "Support Phone",
        name: "support_phone",
        type: "tel",
      },
      // Boolean — toggle switch
      {
        default: false, // optional boolean; defaults to false
        label: "Enable Debug Mode",
        name: "debug_mode",
        type: "boolean",
      },
      // Dynamic list — options resolved at runtime via a factory.
      // Use when option values depend on merchant-specific data (e.g. payment
      // methods enabled in the merchant's Commerce store). Any credentials the
      // factory uses must be declared as `inputs` for the action that resolves
      // the schema in that action's `ext.config.yaml`.
      {
        // Required for single-select; optional for "multiple" (defaults to []).
        default: (resolvedOptions) => resolvedOptions[0].value,
        label: "Default Payment Method",
        name: "default_payment_method",
        // Receives the action's runtime params; may be sync or async.
        // Example: `await fetchPaymentMethods(params.PAYMENT_API_KEY)` then
        // map each entry to `{ label, value }`.
        options: () => [{ label: "Credit Card", value: "cc" }],
        selectionMode: "single",
        type: "dynamicList",
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
