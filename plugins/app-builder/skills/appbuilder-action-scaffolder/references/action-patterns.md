# Action Patterns Reference

Use these patterns when scaffolding Adobe App Builder actions. Unless noted otherwise, the manifest snippets below assume a standalone `app.config.yaml` shape under `application.runtimeManifest`. For extension-based apps, move the same `runtimeManifest` block into `src/<extension>/ext.config.yaml`.

> Guardrail: do not use a root-level runtimeManifest in app.config.yaml; the App Builder CLI ignores that form.

### Core Action Patterns

## Pattern 1: CRUD REST API

**When to use:** Expose a thin Adobe App Builder web action that proxies CRUD operations to an existing REST backend while adding App Builder auth, logging, and parameter validation.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      api:
        license: Apache-2.0
        actions:
          crud-api:
            function: actions/crud-api/index.js
            web: 'yes'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              BACKEND_URL: $BACKEND_URL
              API_TOKEN: $API_TOKEN
            annotations:
              require-adobe-auth: false
              final: true
```

**Code example:**

```javascript
const { Core } = require('@adobe/aio-sdk')
const fetch = require('node-fetch')

async function main(params) {
  const logger = Core.Logger('crud-api', { level: params.LOG_LEVEL || 'info' })
  const method = (params.__ow_method || 'get').toUpperCase()
  const path = params.__ow_path || ''
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${params.API_TOKEN}` }

  const { __ow_method, __ow_headers, __ow_path, __ow_body, ...payload } = params
  const options = { method, headers }
  if (['POST', 'PUT', 'PATCH'].includes(method)) options.body = JSON.stringify(payload)

  logger.info('proxying request', { method, path })
  const response = await fetch(`${params.BACKEND_URL}${path}`, options)
  const text = await response.text()

  return {
    statusCode: response.status,
    headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    body: text ? JSON.parse(text) : {}
  }
}

exports.main = main
```

**Key considerations:**

- Map `params.__ow_method` and `params.__ow_path` explicitly; web actions do not infer upstream REST routing for you.
- Only forward trusted headers and credentials to the upstream API.
- Normalize non-JSON upstream responses before returning them to callers.
- Keep the action thin; move complex business logic to the backend service being proxied.

## Pattern 2: Scheduled / Cron Action (via Alarm trigger)

**When to use:** Run recurring background work such as syncs, cleanup jobs, polling, digest generation, or cache warming without an external scheduler.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      scheduled:
        license: Apache-2.0
        actions:
          cleanup:
            function: actions/cleanup/index.js
            web: 'no'
            runtime: nodejs:20
            limits:
              timeout: 300000
            inputs:
              LOG_LEVEL: info
            annotations:
              require-adobe-auth: false
        triggers:
          every-hour:
            feed: /whisk.system/alarms/interval
            inputs:
              minutes: 60
        rules:
          run-cleanup:
            trigger: every-hour
            action: cleanup
```

**Code example:**

```javascript
async function main(params) {
  const executedAt = new Date().toISOString()
  console.log('scheduled execution started', { executedAt })

  // Run periodic work here (cleanup, sync, reconciliation, journaling poll, etc.)
  const deletedRecords = await deleteExpiredRecords()

  return {
    statusCode: 200,
    body: {
      ok: true,
      executedAt,
      deletedRecords
    }
  }
}

async function deleteExpiredRecords() {
  return 42
}

exports.main = main
```

**Key considerations:**

- Use non-web actions for cron jobs so you can raise timeout limits beyond the web-action cap.
- Make the job idempotent; triggers can be retried and schedules can overlap under failure conditions.
- Emit structured logs with timestamps so missed or delayed runs are easy to investigate.
- If the job can overlap, add a lock in State or your datastore before doing destructive work.

## Pattern 3: Multi-step Processing with State SDK

**When to use:** Track long-running or multi-phase jobs, publish progress, and expose resumable status to clients without holding a single HTTP request open.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      jobs:
        license: Apache-2.0
        actions:
          process-job:
            function: actions/process-job/index.js
            web: 'no'
            runtime: nodejs:20
            limits:
              timeout: 300000
            inputs:
              LOG_LEVEL: info
            annotations:
              require-adobe-auth: false
          job-status:
            function: actions/job-status/index.js
            web: 'yes'
            runtime: nodejs:20
            annotations:
              require-adobe-auth: false
              final: true
```

**Code example:**

```javascript
const { Core, State } = require('@adobe/aio-sdk')

async function main(params) {
  const logger = Core.Logger('processor', { level: params.LOG_LEVEL || 'info' })
  const state = await State.init()
  const jobId = params.jobId

  await state.put(jobId, JSON.stringify({ status: 'processing', progress: 0 }), { ttl: 3600 })
  logger.info('job started', { jobId })

  const data = await fetchData(params)
  await state.put(jobId, JSON.stringify({ status: 'processing', progress: 50 }), { ttl: 3600 })

  const result = await processData(data)
  await state.put(jobId, JSON.stringify({ status: 'complete', progress: 100, result }), { ttl: 3600 })

  return { statusCode: 200, body: { jobId, status: 'complete' } }
}

async function fetchData(params) { return { input: params.input } }
async function processData(data) { return { processed: true, data } }

exports.main = main
```

**Key considerations:**

- Treat State as ephemeral job tracking, not a system-of-record database.
- Always set a TTL so abandoned jobs do not accumulate forever.
- Use a separate status web action to poll progress instead of keeping clients waiting.
- Write progress after each durable checkpoint so retries can resume safely.

> **Testing:** Use `aio app run` (not `aio app dev`) for this pattern. The State SDK requires a Runtime environment and will fail when running locally with `aio app dev`.

## Pattern 4: File Upload Handler (raw web action)

**When to use:** Accept binary or multipart uploads directly in a web action, especially when you need access to the raw request body instead of JSON-decoded params.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      uploads:
        license: Apache-2.0
        actions:
          upload:
            function: actions/upload/index.js
            web: 'raw'
            runtime: nodejs:20
            limits:
              timeout: 60000
              memorySize: 256
            annotations:
              require-adobe-auth: false
              final: true
```

**Code example:**

```javascript
async function main(params) {
  const headers = Object.fromEntries(
    Object.entries(params.__ow_headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  )
  const contentType = headers['content-type'] || ''
  const body = Buffer.from(params.__ow_body || '', 'base64')

  if (!contentType.startsWith('multipart/form-data')) {
    return { statusCode: 400, body: { error: 'Expected multipart/form-data upload' } }
  }

  // Parse the multipart payload here or stream it onward to storage.
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, size: body.length, contentType })
  }
}

exports.main = main
```

**Key considerations:**

- `web: 'raw'` delivers the request body in `params.__ow_body` as base64; decode it yourself.
- Enforce size, content-type, and filename validation before buffering large uploads in memory.
- Return a string body for raw actions when you need exact control over the HTTP response.
- Prefer direct-to-storage upload URLs when clients may send large files.

## Pattern 5: Adobe API Call with IMS Token

**When to use:** Call Adobe APIs on behalf of the currently signed-in user from a web action that receives an IMS bearer token from Experience Cloud Shell or another trusted caller.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      adobe-api:
        license: Apache-2.0
        actions:
          list-assets:
            function: actions/list-assets/index.js
            web: 'yes'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              API_KEY: $API_KEY
              ORG_ID: $ORG_ID
            annotations:
              require-adobe-auth: true
              final: true
```

**Code example:**

```javascript
const { Core } = require('@adobe/aio-sdk')
const fetch = require('node-fetch')

async function main(params) {
  const logger = Core.Logger('adobe-api', { level: params.LOG_LEVEL || 'info' })
  const token = params.__ow_headers?.authorization?.replace('Bearer ', '')

  if (!token) {
    return { statusCode: 401, body: { error: 'Missing authorization token' } }
  }

  logger.info('calling Adobe API')
  const response = await fetch('https://platform.adobe.io/data/core/example-endpoint', {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': params.API_KEY,
      'x-gw-ims-org-id': params.ORG_ID
    }
  })

  return {
    statusCode: response.status,
    headers: { 'Content-Type': 'application/json' },
    body: await response.json()
  }
}

exports.main = main
```

**Key considerations:**

- `require-adobe-auth: true` protects the action and makes user-context calls easier from Adobe surfaces.
- **Two-layer auth warning:** This pattern has two independent auth layers — the `require-adobe-auth: true` manifest annotation (gateway-level) and the `params.__ow_headers?.authorization` check in code. Disabling one does not disable the other. During local development, set `require-adobe-auth: false` in the manifest *and* stub or skip the code-level token check; otherwise you will get 401 errors that persist across redeploy cycles. See the "Common Auth Issues" section in `runtime-reference.md` for a full debugging guide.
- Validate the caller and requested scope before proxying a powerful Adobe API token.
- For service-to-service access, prefer `include-ims-credentials: true` plus token generation instead of reusing a user token.
- Log endpoint names and request IDs, not raw tokens or sensitive payloads.

## Pattern 6: Database CRUD Action

**When to use:** Persist application records in the App Builder workspace database using `@adobe/aio-lib-db` for MongoDB-compatible document storage, filtering, and aggregation.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    database:
      auto-provision: true
      region: amer
    packages:
      data:
        license: Apache-2.0
        actions:
          orders-db:
            function: actions/orders-db/index.js
            web: 'yes'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              AIO_DB_REGION: amer
            annotations:
              include-ims-credentials: true
              require-adobe-auth: false
              final: true
```

**Code example:**

```javascript
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient
const dbLib = require('@adobe/aio-lib-db')

async function getOrdersCollection(params) {
  const token = await generateAccessToken(params)
  const db = await dbLib.init({ token: token.access_token, region: params.AIO_DB_REGION })

  const collections = await db.listCollections({}, { nameOnly: true }).toArray()
  if (!collections.find(collection => collection.name === 'orders')) {
    await db.createCollection('orders', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['orderId', 'status', 'createdAt'],
          properties: {
            orderId: { bsonType: 'string' },
            status: { enum: ['pending', 'processing', 'complete', 'failed'] },
            createdAt: { bsonType: 'date' }
          }
        }
      }
    })
  }

  const orders = db.collection('orders')

  await orders.createIndex({ orderId: 1 }, { unique: true })
  await orders.createIndex({ status: 1, createdAt: -1 })
  return orders
}

async function main(params) {
  const orders = await getOrdersCollection(params)

  switch (params.operation) {
    case 'insertOne':
      return { statusCode: 201, body: await orders.insertOne({ ...params.document, createdAt: new Date() }) }
    case 'findOne':
      return { statusCode: 200, body: await orders.findOne(params.filter || { orderId: params.orderId }) }
    case 'find':
      return { statusCode: 200, body: await orders.find(params.filter || {}).sort({ createdAt: -1 }).limit(50).toArray() }
    case 'updateOne':
      return { statusCode: 200, body: await orders.updateOne(params.filter, { $set: params.update, $currentDate: { updatedAt: true } }) }
    case 'deleteOne':
      return { statusCode: 200, body: await orders.deleteOne(params.filter || { orderId: params.orderId }) }
    case 'aggregate':
      return { statusCode: 200, body: await orders.aggregate(params.pipeline || []).toArray() }
    default:
      return { statusCode: 400, body: { error: 'Unsupported operation' } }
  }
}

exports.main = main
```

**Key considerations:**

- Provision the workspace database before first use with `aio app db provision` or declarative `runtimeManifest.database.auto-provision`.
- `@adobe/aio-lib-db` uses MongoDB-compatible query syntax, so operators like `$set`, `$group`, and aggregation pipelines feel familiar.
- Create indexes deliberately for high-cardinality filters and sort patterns; otherwise queries degrade quickly as collections grow.
- Add schema validation when creating collections so invalid documents are rejected early.
- Budget for the workspace database quota (25 GB) and design archival/cleanup workflows accordingly.
- **Post-generation validation**: Verify the action exports `main` correctly (`exports.main = main`) and the manifest `function` path resolves to the actual action file. Run `aio app build` to confirm the action is discovered and bundled without errors.

## Pattern 7: Event Webhook Receiver

**When to use:** Receive Adobe I/O Events deliveries in a Runtime action, validate the webhook challenge/signature, route by event type, and acknowledge successful processing quickly.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      events:
        license: Apache-2.0
        actions:
          receive-events:
            function: actions/receive-events/index.js
            web: 'no'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              ORG_ID: $ORG_ID
              CLIENT_ID: $CLIENT_ID
              WEBHOOK_RECIPIENT_CLIENT_ID: $WEBHOOK_RECIPIENT_CLIENT_ID
            annotations:
              include-ims-credentials: true
              require-adobe-auth: false
  events:
    registrations:
      order-events:
        description: Receive Adobe I/O Events deliveries in Runtime
        events_of_interest:
          - provider_id: $PROVIDER_ID
            event_code: com.example.order.created
        runtime_action: events/receive-events
```

**Code example:**

```javascript
const { State } = require('@adobe/aio-sdk')
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient
const eventsSdk = require('@adobe/aio-lib-events')

async function main(params) {
  if ((params.__ow_method || '').toLowerCase() === 'get' && params.challenge) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: params.challenge }
  }

  const headers = Object.fromEntries(Object.entries(params.__ow_headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const contentType = (headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType && !['application/json', 'application/cloudevents+json'].includes(contentType)) {
    return { statusCode: 415, body: { error: 'Expected application/json or application/cloudevents+json' } }
  }

  const payload = params.__ow_body
    ? JSON.parse(Buffer.from(params.__ow_body, 'base64').toString('utf8'))
    : (params.body || params)
  const token = await generateAccessToken(params)
  const state = await State.init()
  const client = await eventsSdk.init(params.ORG_ID, params.CLIENT_ID, token.access_token)

  const valid = client.verifyDigitalSignatureForEvent(payload, params.WEBHOOK_RECIPIENT_CLIENT_ID, {
    digiSignature1: headers['x-adobe-digital-signature1'] || headers['x-adobe-digital-signature'],
    digiSignature2: headers['x-adobe-digital-signature2'],
    publicKeyPath1: headers['x-adobe-public-key1-path'],
    publicKeyPath2: headers['x-adobe-public-key2-path']
  })
  if (!valid) return { statusCode: 401, body: { error: 'Invalid Adobe event signature' } }

  for (const event of payload.events || [payload]) {
    const eventId = event.eventid || event.id || event.event?.id
    if (eventId && await state.get(`event:${eventId}`)) continue

    switch (event.type) {
      case 'com.example.order.created':
        await handleOrderCreated(event)
        break
      default:
        console.log('unhandled event type', event.type)
    }

    if (eventId) await state.put(`event:${eventId}`, 'processed', { ttl: 86400 })
  }

  return { statusCode: 200, body: { ok: true } }
}

async function handleOrderCreated(event) { console.log('processed', event.id) }

exports.main = main
```

**Key considerations:**

- Handle the initial challenge request by echoing the `challenge` query value exactly.
- Return `200` quickly after successful processing so Adobe does not retry an already-handled delivery.
- Keep processing idempotent because webhook deliveries can be retried.
- Accept both `application/json` and `application/cloudevents+json`; Adobe I/O Events can use either depending on the event source and delivery version.
- Read the event identifier flexibly (`eventid`, `id`, or `event.id`) because Adobe I/O Events payload fields vary across event types and versions. Legacy field names `event_id` and `recipient_client_id` are deprecated and will be removed end of 2026.
- Validate the digital signature using the Adobe-provided signature and public-key headers before trusting the payload.
- Push slow downstream work to another action or queue if webhook latency approaches the timeout window.

> **Testing:** Use `aio app run` (not `aio app dev`) if your webhook handler uses the State SDK for deduplication. The State SDK requires a Runtime environment and will fail when running locally with `aio app dev`. If you remove the State-based dedup logic, `aio app dev` works for basic webhook testing.

## Pattern 8: Custom Event Provider

**When to use:** Publish your own domain events from App Builder so other applications can subscribe to them through Adobe I/O Events.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      providers:
        license: Apache-2.0
        actions:
          publish-order-event:
            function: actions/publish-order-event/index.js
            web: 'yes'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              ORG_ID: $ORG_ID
              CLIENT_ID: $CLIENT_ID
              CONSUMER_ORG_ID: $CONSUMER_ORG_ID
              PROJECT_ID: $PROJECT_ID
              WORKSPACE_ID: $WORKSPACE_ID
              PROVIDER_ID: $PROVIDER_ID
            annotations:
              include-ims-credentials: true
              require-adobe-auth: false
              final: true
```

**Code example:**

```javascript
const crypto = require('crypto')
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient
const eventsSdk = require('@adobe/aio-lib-events')

async function main(params) {
  const token = await generateAccessToken(params)
  const client = await eventsSdk.init(params.ORG_ID, params.CLIENT_ID, token.access_token)

  if (params.bootstrap === true) {
    const provider = await client.createProvider(params.CONSUMER_ORG_ID, params.PROJECT_ID, params.WORKSPACE_ID, {
      label: 'Order Service Events',
      description: 'Custom events emitted by the order service'
    })

    await client.createEventMetadataForProvider(
      params.CONSUMER_ORG_ID,
      params.PROJECT_ID,
      params.WORKSPACE_ID,
      provider.id,
      {
        label: 'Order created',
        description: 'Raised after an order is persisted',
        event_code: 'com.example.order.created'
      }
    )

    return { statusCode: 201, body: { providerId: provider.id } }
  }

  const cloudEvent = {
    id: crypto.randomUUID(),
    source: 'urn:appbuilder:order-service',
    specversion: '1.0',
    type: 'com.example.order.created',
    datacontenttype: 'application/json',
    time: new Date().toISOString(),
    data: { orderId: params.orderId, total: params.total, currency: params.currency }
  }

  await client.publishEvent(cloudEvent)
  return { statusCode: 202, body: { published: true, eventId: cloudEvent.id, type: cloudEvent.type } }
}

exports.main = main
```

**Key considerations:**

- Register the provider in Adobe Developer Console first; publishing fails if the provider/event metadata is not in place.
- Define stable event types and payload contracts up front because subscribers will depend on them.
- `publishEvent()` is fire-and-forget from your action’s perspective; log IDs so you can trace outbound events later.
- Emit CloudEvents 1.0-compatible payloads with a stable `source`, `type`, and JSON `data` shape.
- Keep bootstrap/provider-management flows separate from high-volume publish endpoints when possible.

## Pattern 9: Journaling Event Consumer

**When to use:** Poll the Adobe I/O Events Journaling API on a schedule to get durable, replayable event delivery with better surge protection than direct webhooks.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      journal:
        license: Apache-2.0
        actions:
          poll-journal:
            function: actions/poll-journal/index.js
            web: 'no'
            runtime: nodejs:20
            limits:
              timeout: 300000
            inputs:
              LOG_LEVEL: info
              ORG_ID: $ORG_ID
              CLIENT_ID: $CLIENT_ID
              JOURNAL_URL: $JOURNAL_URL
            annotations:
              include-ims-credentials: true
              require-adobe-auth: false
        triggers:
          every-five-minutes:
            feed: /whisk.system/alarms/interval
            inputs:
              minutes: 5
        rules:
          run-journal-poller:
            trigger: every-five-minutes
            action: poll-journal
```

**Code example:**

```javascript
const { State } = require('@adobe/aio-sdk')
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient
const eventsSdk = require('@adobe/aio-lib-events')

async function main(params) {
  const state = await State.init()
  const token = await generateAccessToken(params)
  const client = await eventsSdk.init(params.ORG_ID, params.CLIENT_ID, token.access_token)

  const cursorRecord = await state.get('journal:cursor')
  const journalUrl = cursorRecord?.value || params.JOURNAL_URL
  const response = await client.getEventsFromJournal(journalUrl, { limit: 50 })

  for (const event of response.events || []) {
    await processEventIdempotently(event)
  }

  const nextUrl = response.links?.next || journalUrl
  await state.put('journal:cursor', nextUrl)

  return {
    statusCode: 200,
    body: {
      processed: (response.events || []).length,
      nextUrl
    }
  }
}

async function processEventIdempotently(event) {
  console.log('processing journal event', event.id)
}

exports.main = main
```

**Key considerations:**

- This pattern combines Alarms + Events SDK + State SDK: the alarm wakes the action, the Events SDK reads the journal, and State stores the cursor.
- Only advance the saved cursor after the current batch is processed successfully.
- Keep processing idempotent because journal consumers can replay previously seen events during recovery.
- Journaling is usually a better fit than webhooks when you need back-pressure handling or want to absorb event surges safely.
- Process pages sequentially, but do not assume Adobe I/O Events guarantees global chronological ordering across all emitted events.

> **Testing:** Use `aio app run` (not `aio app dev`) for this pattern. The State SDK (used for cursor tracking) requires a Runtime environment and will fail when running locally with `aio app dev`.

### Advanced Patterns

## Pattern 10: Large Payload Response (302 Redirect)

**When to use:** Return payloads that would exceed the 1 MB web-action response limit by writing them to the Files SDK and redirecting the caller to a presigned download URL.

**Manifest configuration:**

```yaml
application:
  runtimeManifest:
    packages:
      exports:
        license: Apache-2.0
        actions:
          download-report:
            function: actions/download-report/index.js
            web: 'yes'
            runtime: nodejs:20
            annotations:
              require-adobe-auth: false
              final: true
          cleanup-temporary-files:
            function: actions/cleanup-temporary-files/index.js
            web: 'no'
            runtime: nodejs:20
        triggers:
          cleanup-every-hour:
            feed: /whisk.system/alarms/interval
            inputs:
              minutes: 60
        rules:
          run-cleanup:
            trigger: cleanup-every-hour
            action: cleanup-temporary-files
```

**Code example:**

```javascript
const crypto = require('crypto')
const { Files } = require('@adobe/aio-sdk')

async function main(params) {
  const report = buildLargeReport(params)
  const serialized = JSON.stringify(report)

  if (Buffer.byteLength(serialized, 'utf8') < 900000) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: report }
  }

  const files = await Files.init()
  const filePath = `tmp/reports/${Date.now()}-${crypto.randomUUID()}.json`
  await files.write(filePath, serialized)

  const location = await files.generatePresignURL(filePath, { expiryInSeconds: 900 })
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
    body: ''
  }
}

function buildLargeReport(params) {
  return { filters: params.filters || {}, items: new Array(50000).fill({ ok: true }) }
}

exports.main = main
```

**Key considerations:**

- Web actions have a practical 1 MB response limit; redirecting to Files storage avoids that cap for arbitrarily large payloads.
- The Files SDK method name is `generatePresignURL()`.
- The client must follow redirects and be able to download from the returned URL.
- Use short-lived URLs and a scheduled cleanup action that deletes files older than your intended TTL.
- Prefer timestamped paths like `tmp/reports/<epoch>-<id>.json` so cleanup actions can calculate expiration without extra metadata.

> **Testing:** Use `aio app run` (not `aio app dev`) for this pattern. The Files SDK requires a Runtime environment and will fail when running locally with `aio app dev`.

## Pattern 11: Action Sequence / Composition

**When to use:** Chain multiple actions into a declarative pipeline where each step’s output becomes the next step’s input.

**Manifest configuration (preferred for deployed Runtime):**

```yaml
application:
  runtimeManifest:
    packages:
      order-pipeline:
        license: Apache-2.0
        actions:
          validate-order:
            function: actions/validate-order/index.js
            runtime: nodejs:20
          store-order:
            function: actions/store-order/index.js
            runtime: nodejs:20
        sequences:
          process-order:
            actions: validate-order, store-order
            web: true
            annotations:
              require-adobe-auth: false
              final: true
```

**Code example (sequence steps):**

```javascript
// actions/validate-order/index.js
exports.main = async params => {
  if (!params.orderId) throw new Error('orderId is required')
  return {
    ...params,
    validatedAt: new Date().toISOString(),
    status: 'validated'
  }
}

// actions/store-order/index.js
exports.main = async params => {
  return {
    ok: true,
    orderId: params.orderId,
    validatedAt: params.validatedAt,
    storedAt: new Date().toISOString()
  }
}
```

**Fallback for local testing (**`aio app dev`**):** In our Eval 10 local-dev run, the generated web sequence URL was advertised but still returned HTTP 404. Adobe documents sequence support in `aio app dev`, but in practice local sequence routing can still be unreliable. If the sequence endpoint is not routable locally, keep the same step actions and temporarily switch to in-action orchestration for smoke tests.

```yaml
application:
  runtimeManifest:
    packages:
      order-pipeline:
        license: Apache-2.0
        actions:
          process-order:
            function: actions/process-order/index.js
            web: 'yes'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              NEXT_ACTION_URL: $STORE_ORDER_URL
          store-order:
            function: actions/store-order/index.js
            web: 'yes'
            runtime: nodejs:20
```

```javascript
// actions/process-order/index.js
exports.main = async params => {
  if (!params.orderId) throw new Error('orderId is required')
  const payload = { ...params, validatedAt: new Date().toISOString(), status: 'validated' }
  const response = await fetch(params.NEXT_ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return response.json()
}
```

**Key considerations:**

- Each action in the sequence is a separate activation and billed/executed independently.
- Errors stop the sequence immediately and propagate back to the caller.
- Total latency is cumulative because each step waits for the previous one to finish.
- Each step named in `sequences.<name>.actions` must also exist as a separately declared action in the same package (or be referenced by full action path).
- If `aio app dev` advertises a sequence URL but local requests return 404, verify the individual actions first and use in-action orchestration as the local fallback.
- Use sequences when the flow is linear; prefer in-action orchestration or a conductor action for branching, retries, local smoke tests, or shared error handling.
- Keep step outputs small and JSON-serializable so handoff between actions stays predictable.

> **Testing:** Use `aio app run` (not `aio app dev`) for this pattern. Local sequence routing is unreliable with `aio app dev` (sequence endpoints may return 404). Deploy to Runtime with `aio app run` for reliable sequence testing.

## Pattern 12: Asset Compute Worker

**When to use:** Build a custom AEM Asset Compute worker that produces renditions during asset processing in AEM as a Cloud Service.

**Manifest configuration:**

```yaml
extensions:
  dx/asset-compute/worker/1:
    $include: src/dx-asset-compute-worker-1/ext.config.yaml
```

```yaml
# src/dx-asset-compute-worker-1/ext.config.yaml
operations:
  workerProcess:
    - type: action
      impl: dx-asset-compute-worker-1/worker
hooks:
  post-app-run: adobe-asset-compute asset-compute:devtool
  test: adobe-asset-compute asset-compute:test-worker
actions: actions
runtimeManifest:
  packages:
    dx-asset-compute-worker-1:
      license: Apache-2.0
      actions:
        worker:
          function: actions/worker/index.js
          web: 'yes'
          runtime: nodejs:22
          limits:
            concurrency: 10
          annotations:
            require-adobe-auth: false
```

**Code example:**

```javascript
'use strict'

const { worker, SourceCorruptError } = require('@adobe/asset-compute-sdk')
const fs = require('fs').promises

exports.main = worker(async (source, rendition, params) => {
  const stats = await fs.stat(source.path)
  if (stats.size === 0) throw new SourceCorruptError('source file is empty')

  // Source and rendition are local temp files managed by the Asset Compute SDK.
  await fs.copyFile(source.path, rendition.path)
  console.log('rendition created', { name: rendition.name, instructions: rendition.instructions, params })
})
```

**Key considerations:**

- This uses `@adobe/asset-compute-sdk`, not the normal Runtime action helper stack.
- Asset Compute workers are for AEM as a Cloud Service; they are not a general-purpose action pattern.
- Implement the worker callback (`worker(async (source, rendition, params) => ...)`) instead of the standard `exports.main = async params => ...` action shape.
- Test locally with the Asset Compute devtool/test framework before wiring the worker into an AEM Processing Profile.
- Treat source and rendition paths as temporary local files; the SDK handles download/upload around your worker code.

> **Testing:** Use `aio app run` or `aio app test` for this pattern. Asset Compute workers require the Runtime environment and the Asset Compute devtool/test framework.