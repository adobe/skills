import { defineConfig } from "@adobe/aio-commerce-lib-app/config";

export default defineConfig({
  metadata: {
    description: "A Commerce app built with aio-commerce-sdk.", // max 255 chars
    displayName: "My Commerce App", // shown in App Management UI, max 50 chars
    id: "my-commerce-app", // alphanumeric + hyphens only, max 100 chars
    version: "1.0.0", // Major.Minor.Patch only, no pre-release identifiers
  },
});
