# Migration Warnings

Reference file for manual-intervention warnings. Read the relevant section and
present its content to the developer when the corresponding condition is detected.

---

## OpenWhisk Triggers

These scheduled triggers have no direct equivalent in App Management.
Manual replacement options (choose one per trigger):

Option A — AIO Events recurring event (recommended for Commerce-integrated workflows):
Use Adobe I/O Events scheduler to emit a recurring custom event that your
consumer action subscribes to. See:
https://developer.adobe.com/events/docs/guides/using/scheduling/

Option B — Adobe Commerce Scheduled Jobs (Cron):
If the trigger action calls back into Commerce, implement the logic as a
Commerce module cron job (Magento\Cron\Model\Config\Backend\Cron).
This keeps scheduling within Commerce without external dependencies.

Option C — External cron + REST API invocation:
Use any external scheduler (GitHub Actions schedule, AWS EventBridge, cron server)
to POST to the App Builder action's web URL on a schedule:
curl -X POST https://<runtime-ns>.adobeioruntime.net/api/v1/web/<ns>/<pkg>/<action> \
-H "Authorization: Bearer $AIO_TOKEN"

Note: AIO runtime actions must be web-accessible (web: 'yes') and authenticated
to be invoked this way.

---

## API Gateway

These synchronous HTTP REST endpoints have no direct equivalent in App Management.
Manual migration options:

Option A — Adobe API Mesh (recommended for REST/GraphQL proxying):
Replace API Gateway routes with Adobe API Mesh resolvers.
Mesh handles routing, auth, and rate limiting natively.
See: https://developer.adobe.com/graphql-mesh-gateway/

Option B — Web action with direct URL invocation:
Convert the action to a standard web action (web: 'yes') and invoke it
directly via its App Builder runtime URL. You lose the API Gateway path
mapping but retain the action logic.

Option C — Commerce API Mesh + REST route:
For Commerce-facing REST endpoints, implement as a Commerce module plugin
that exposes a REST endpoint in the Commerce API surface.

Each `apis:` block in the runtime manifest corresponds to one route that
needs manual re-implementation before the migrated app can fully replace
the original.

---

## Sequences

Action sequences (chained action calls) have no equivalent in App Management.
Each sequence must be manually refactored: inline all chained action logic
into a single action function, or use explicit function calls within one action.
