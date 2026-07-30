// Full annotated custom installation step for a Commerce App Management app,
// backed by App Builder Database Storage (@adobe/aio-lib-db).
//
// What it does:
//   - install:   creates the "held_orders" collection and a UNIQUE index on order_id
//   - uninstall: tear down your database state here; leave empty to preserve data across reinstalls
//
// Why a custom installation step (vs. ad-hoc setup on first request):
//   It runs exactly once when the app is installed from the Commerce Admin,
//   and the uninstall handler lets the app clean up after itself.
//
// Author the install script as an ES module with `export default` — never
// `module.exports`. The installation action loads each step via
// `import * as step from "<script>"` and reads `step.default`, so the script
// must default-export the defineCustomInstallationStep(...) result. The `script`
// path must end in .js; if you author in TypeScript, compile it and keep the
// emitted .js an ES module.
//
// Wiring (in app.commerce.config.ts) — the script path is the COMPILED .js:
//   installation: {
//     customInstallationSteps: [
//       {
//         script: "./scripts/setup-database.js",
//         name: "Set up held-orders collection",
//         description: "Creates the held_orders collection and a unique index on order_id",
//       },
//     ],
//   }
//
// Two easy mistakes this file avoids:
//   1. Resolve the IMS auth params from context.params — NOT config. config is the
//      app configuration and carries no credentials; context.params carries the
//      injected IMS credentials (AIO_COMMERCE_AUTH_IMS_*) read by
//      @adobe/aio-commerce-lib-auth.
//   2. createIndex is called ON A COLLECTION OBJECT, not with a collection-name string.

import { defineCustomInstallationStep } from "@adobe/aio-commerce-lib-app/management";
import {
  getImsAuthProvider,
  resolveImsAuthParams,
} from "@adobe/aio-commerce-lib-auth";
import { init as initDb } from "@adobe/aio-lib-db";

const COLLECTION = "held_orders";

// Open a DB client using the credentials on context.params. The caller is
// responsible for closing it (see the finally blocks below).
async function openClient(context: { params: Record<string, unknown> }) {
  // include-ims-credentials makes the AIO_COMMERCE_AUTH_IMS_* credentials available
  // on context.params; resolve them and mint a raw access token string.
  const authProvider = getImsAuthProvider(resolveImsAuthParams(context.params));
  const token = await authProvider.getAccessToken();
  const db = await initDb({
    // region MUST match the manifest database.region. Omit to use AIO_DB_REGION.
    region: (context.params.DB_REGION as string) || "amer", // "amer" | "apac" | "emea" | "aus"
    token,
  });
  return db.connect();
}

export default defineCustomInstallationStep({
  install: async (config, context) => {
    const { logger } = context;
    logger.info(`Setting up storage for ${config.metadata.displayName}...`);

    let client: Awaited<ReturnType<typeof openClient>> | undefined;
    try {
      client = await openClient(context);

      // Get the collection OBJECT first (created on first write if absent),
      // then create the index on it — never pass a collection-name string.
      const orders = client.collection(COLLECTION);
      await orders.createIndex({ order_id: 1 }, { unique: true });

      logger.info(`Created "${COLLECTION}" with a unique index on order_id`);
      return { collection: COLLECTION, status: "success" };
    } catch (error) {
      if (error instanceof Error && error.name === "DbError") {
        logger.error("Database error during install", error.message);
      }
      throw error; // re-throw so the installation step fails loudly
    } finally {
      if (client) {
        await client
          .close()
          .catch((e: Error) =>
            logger.warn("Failed to close DB client", e.message),
          );
      }
    }
  },

  uninstall: async (_config, _context) => {
    // Tear down your database state here.
    // Leave empty to preserve data across reinstalls.
  },
});
