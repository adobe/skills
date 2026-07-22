// Full annotated reference for a Commerce app runtime action backed by
// App Builder Database Storage (@adobe/aio-lib-db).
//
// Lifecycle (identical for web actions and event/webhook handlers):
//   resolveImsAuthParams -> getAccessToken -> init -> connect -> use collection -> ALWAYS close.
//
// Registration requirements (in src/commerce-extensibility-1/ext.config.yaml):
//   - include-ims-credentials: true   (REQUIRED — provides the IMS token below)
//   - web: "yes" for an HTTP-invokable web action; "no" for an event/webhook handler
//   - the "App Builder Data Services" API must be added to the project in the
//     Adobe Developer Console (every workspace that uses the database)
//   - the workspace database must be provisioned: declaratively via the
//     app.config.yaml database block on `aio app deploy` (CLI `aio app db
//     provision --region <r>` is the local-dev fallback)

import {
  getImsAuthProvider,
  resolveImsAuthParams,
} from "@adobe/aio-commerce-lib-auth";
import { buildErrorResponse, ok } from "@adobe/aio-commerce-lib-core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";
import { init as initDb } from "@adobe/aio-lib-db";

// The connected client returned by db.connect().
type DbClient = Awaited<
  ReturnType<Awaited<ReturnType<typeof initDb>>["connect"]>
>;

export async function main(params: Record<string, unknown>) {
  const logger = AioLogger("commerce-app-storage", {
    level: (params.LOG_LEVEL as string) || "info",
  });

  // Web actions receive input directly on params; event/webhook handlers
  // receive the payload on params.data instead:
  //   const data = params.data as Record<string, unknown>;
  let client: DbClient | undefined;

  try {
    // 1. Resolve the AIO_COMMERCE_AUTH_IMS_* params injected because
    //    include-ims-credentials is true, then mint a raw access token string.
    const authProvider = getImsAuthProvider(resolveImsAuthParams(params));
    const token = await authProvider.getAccessToken();

    // 2. Initialize. region MUST match the manifest database.region.
    //    Omit it to use AIO_DB_REGION or the "amer" default.
    const db = await initDb({
      region: (params.DB_REGION as string) || "amer", // "amer" | "apac" | "emea" | "aus"
      token,
    });

    // 3. Connect — opens a session that must be closed (see finally).
    client = await db.connect();

    // 4. Select a collection (created on first write if absent).
    const records = client.collection("records");

    // --- CRUD reference ---------------------------------------------------

    // Insert one
    const inserted = await records.insertOne({
      createdAt: new Date().toISOString(),
      name: "Jane Smith",
    });

    // Insert many
    await records.insertMany([{ name: "Alice" }, { name: "Bob" }]);

    // Find one
    const one = await records.findOne({ name: "Jane Smith" });

    // Find many — returns a cursor. Iterate to bound memory.
    for await (const doc of records
      .find({ active: true })
      .project({ _id: 0, name: 1 })) {
      logger.info("record", doc);
    }
    // ...or load all at once (only for small result sets):
    // const all = await records.find({}).toArray();

    // Update one (use $set / other operators)
    await records.updateOne({ name: "Jane Smith" }, { $set: { active: true } });

    // Update many
    await records.updateMany(
      { active: { $exists: false } },
      { $set: { active: false } },
    );

    // Find and update, returning the updated document
    await records.findOneAndUpdate(
      { name: "Jane Smith" },
      { $set: { lastSeen: new Date() } },
      { returnDocument: "after" },
    );

    // Delete one / many
    await records.deleteOne({ name: "Bob" });
    await records.deleteMany({ active: false });

    // Look up a document by its _id supplied as a string:
    //   import { ObjectId } from "bson";
    //   await records.findOne({ _id: new ObjectId(idString) });

    return ok({ body: { inserted, one } });
  } catch (error) {
    // Database errors surface with name === "DbError".
    const dbError = error as {
      name?: string;
      message?: string;
      statusCode?: number;
    };
    if (dbError.name === "DbError") {
      logger.error("Database error", dbError.message);
    } else {
      logger.error("Unexpected error", error);
    }
    return buildErrorResponse(dbError.statusCode ?? 500, {
      body: { message: dbError.message ?? "Unexpected error" },
    });
  } finally {
    // 5. ALWAYS close — leaked connections exhaust resources.
    if (client) {
      await client
        .close()
        .catch((e: Error) =>
          logger.warn("Failed to close DB client", e.message),
        );
    }
  }
}
