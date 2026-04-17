# AEM Content Fragment API Reference

Use this reference when an App Builder action needs to read, create, update, or delete AEM Content Fragments. AEM as a Cloud Service exposes **four** API surfaces for Content Fragments. Pick the right one from the decision table below, then follow the corresponding section for auth, request shape, and action code.

## API Surface Decision Table

| Need | API | Endpoint Pattern | Auth | Format |
| --- | --- | --- | --- | --- |
| Read CFs optimized for delivery / CDN | Content Fragment Delivery OpenAPI | https://delivery-<env>.adobeaemcloud.com/adobe/sites/cf/fragments | API key (x-api-key) | JSON (flat, delivery-optimized) |
| CRUD operations on Author | Content Fragment Management OpenAPI | https://author-<env>.adobeaemcloud.com/adobe/sites/cf/fragments | IMS bearer token | JSON (OpenAPI 3.x) |
| Read CFs via GraphQL (persisted queries) | AEM GraphQL (Persisted Queries) | https://author-<env>.adobeaemcloud.com/graphql/execute.json/{endpoint}/{query} | IMS bearer token | GraphQL JSON |
| ⚠️ DEPRECATED — legacy SIREN format | Assets HTTP API /api/assets/ | https://author-<env>.adobeaemcloud.com/api/assets/{path}.json | IMS bearer token | SIREN/JSON |

> Rule of thumb: Use Delivery API for published read-only content. Use Management API for author-side CRUD. Use GraphQL persisted queries for structured reads with field selection. Avoid Assets HTTP API for new work.

## IMS Token Extraction (All APIs)

Every App Builder action that calls AEM on behalf of a user receives the IMS token through the Experience Cloud Shell. Extract it once at the top of the action:

```javascript
function getToken(params) {
  const auth = params.__ow_headers?.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth
}
```

For service-to-service (S2S) calls — cron actions, event handlers, background jobs, or action sequences where no user is logged in — use `@adobe/aio-lib-ims` to generate a token from OAuth Server-to-Server credentials:

```javascript
const { context, getToken } = require('@adobe/aio-lib-ims')

async function getS2SToken(params) {
  await context.set('s2s', {
    client_id: params.IMS_CLIENT_ID,
    client_secrets: [params.IMS_CLIENT_SECRET],
    scopes: params.IMS_SCOPES,
    ims_org_id: params.IMS_ORG_ID
  })
  const { access_token } = await getToken('s2s')
  return access_token
}
```

**Complete S2S action example — calling the Management API without user context:**

```javascript
const fetch = require('node-fetch')
const { context, getToken } = require('@adobe/aio-lib-ims')

async function main(params) {
  // Obtain an S2S token from OAuth Server-to-Server credentials
  await context.set('s2s', {
    client_id: params.IMS_CLIENT_ID,
    client_secrets: [params.IMS_CLIENT_SECRET],
    scopes: params.IMS_SCOPES,
    ims_org_id: params.IMS_ORG_ID
  })
  const { access_token } = await getToken('s2s')

  const host = params.AEM_HOST
  const res = await fetch(`${host}/adobe/sites/cf/fragments`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'x-api-key': params.AEM_API_KEY,
      Accept: 'application/json'
    }
  })

  if (!res.ok) return { statusCode: res.status, body: { error: await res.text() } }
  return { statusCode: 200, body: await res.json() }
}
exports.main = main
```

**Manifest inputs for S2S credentials:**

```yaml
actions:
  s2s-action:
    function: actions/s2s-action/index.js
    web: 'no'
    runtime: nodejs:20
    inputs:
      LOG_LEVEL: info
      AEM_HOST: $AEM_HOST
      AEM_API_KEY: $AEM_API_KEY
      IMS_CLIENT_ID: $IMS_CLIENT_ID
      IMS_CLIENT_SECRET: $IMS_CLIENT_SECRET
      IMS_SCOPES: $IMS_SCOPES
      IMS_ORG_ID: $IMS_ORG_ID
```

> When to use each auth pattern:User token passthrough (params.__ow_headers.authorization): The action is called from a UI where a user is logged in (SPA, UI Extension). The token represents that user's identity and permissions.S2S token (getToken() via @adobe/aio-lib-ims): The action runs without user context — cron/scheduled actions, event handlers, background jobs, action sequences. The token represents the application's service credentials configured in Adobe Developer Console.

## 1. Content Fragment Delivery OpenAPI

**When to use:** Deliver published Content Fragments to front-end apps, SPAs, or mobile clients. Responses are CDN-cacheable and optimized for read performance. This API targets the **Delivery tier** (`delivery-<env>`), not the Author tier.

**Auth:** API key header (`x-api-key`). No IMS bearer token required for published content.

**Base URL:** `https://delivery-<env>.adobeaemcloud.com`

**Key endpoints:**

| Operation | Method | Path |
| --- | --- | --- |
| List fragments | GET | /adobe/sites/cf/fragments?references=* |
| Get fragment by path | GET | /adobe/sites/cf/fragments?path={cfPath} |
| Get fragment by ID | GET | /adobe/sites/cf/fragments/{fragmentId} |

**Action code — list published fragments:**

```javascript
const fetch = require('node-fetch')

async function main(params) {
  const host = params.AEM_DELIVERY_HOST // e.g. https://delivery-p12345-e67890.adobeaemcloud.com
  const url = `${host}/adobe/sites/cf/fragments?references=*`

  const res = await fetch(url, {
    headers: {
      'x-api-key': params.AEM_API_KEY,
      Accept: 'application/json'
    }
  })

  if (!res.ok) return { statusCode: res.status, body: { error: await res.text() } }
  return { statusCode: 200, body: await res.json() }
}
exports.main = main
```

**Pagination:** Responses include `offset` and `limit` query params. Default page size is 20. Follow `next` links in the response to page through large result sets.

## 2. Content Fragment Management OpenAPI

**When to use:** Create, read, update, and delete Content Fragments on the **Author** tier. This is the modern replacement for Assets HTTP API CRUD operations on Content Fragments.

**Auth:** IMS bearer token (`Authorization: Bearer <token>`) + API key (`x-api-key`).

**Base URL:** `https://author-<env>.adobeaemcloud.com`

**Key endpoints:**

| Operation | Method | Path |
| --- | --- | --- |
| List fragments | GET | /adobe/sites/cf/fragments |
| Get fragment | GET | /adobe/sites/cf/fragments/{id} |
| Create fragment | POST | /adobe/sites/cf/fragments |
| Update fragment (full) | PUT | /adobe/sites/cf/fragments/{id} |
| Update fragment (partial) | PATCH | /adobe/sites/cf/fragments/{id} |
| Delete fragment | DELETE | /adobe/sites/cf/fragments/{id} |
| Publish fragment | POST | /adobe/sites/cf/fragments/{id}/publish |

**Action code — create a Content Fragment:**

```javascript
const fetch = require('node-fetch')

async function main(params) {
  const token = getToken(params)
  const host = params.AEM_HOST // e.g. https://author-p12345-e67890.adobeaemcloud.com

  const res = await fetch(`${host}/adobe/sites/cf/fragments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': params.AEM_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: params.title,
      description: params.description || '',
      model: { path: params.modelPath },   // e.g. /conf/mysite/settings/dam/cfm/models/article
      parent: { path: params.parentPath },  // e.g. /content/dam/mysite/articles
      fields: params.fields || []
    })
  })

  if (!res.ok) return { statusCode: res.status, body: { error: await res.text() } }
  return { statusCode: 201, body: await res.json() }
}

function getToken(params) {
  const auth = params.__ow_headers?.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth
}
exports.main = main
```

**Rate limits:** Subject to AEM as a Cloud Service rate limiting. Implement exponential backoff on 429 responses.

## 3. AEM GraphQL (Persisted Queries)

**When to use:** Read Content Fragments with precise field selection using pre-registered GraphQL queries. Persisted queries are cached at the Dispatcher/CDN layer and are the recommended read pattern when you need structured, filtered data.

**Auth:** IMS bearer token for Author tier. Published persisted queries on Publish tier may use API key or be open depending on Dispatcher config.

**Base URL:** `https://author-<env>.adobeaemcloud.com` (Author) or `https://publish-<env>.adobeaemcloud.com` (Publish)

**Endpoint:** `GET /graphql/execute.json/{configurationName}/{queryName}`

Query variables are passed as URL-encoded `;` separated params: `/graphql/execute.json/mysite/articles;locale=en;limit=10`

**Creating persisted queries:** Persisted queries are created via the AEM GraphQL IDE or the API:

```bash
# Register a persisted query
curl -X PUT \
  "https://author-<env>.adobeaemcloud.com/graphql/persist.json/<config>/<queryName>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "query": "{ articleList { items { _path title } } }" }'
```

**Action code example — execute a persisted query:**

```javascript
const fetch = require('node-fetch')

async function main(params) {
  const token = getToken(params)
  const host = params.AEM_HOST // e.g. https://author-p12345-e67890.adobeaemcloud.com
  const queryPath = params.queryPath || 'my-project/articles' // <config>/<queryName>

  const url = `${host}/graphql/execute.json/${queryPath}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  })

  if (!res.ok) return { statusCode: res.status, body: { error: await res.text() } }
  return { statusCode: 200, body: await res.json() }
}

function getToken(params) {
  const auth = params.__ow_headers?.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth
}
exports.main = main
```

**Important:** Direct (non-persisted) GraphQL queries (`/content/graphql/global/endpoint.json`) work but bypass CDN caching and may face stricter rate limits. Always prefer persisted queries for production reads.

## 4. Assets HTTP API (`/api/assets/`) — ⚠️ DEPRECATED

> ⚠️ DEPRECATION WARNING: The Assets HTTP API for Content Fragments is deprecated as of AEM as a Cloud Service 2024.x releases. Do not use this API for new development. Use the Content Fragment Management OpenAPI (Section 2) for CRUD operations and the Delivery API (Section 1) or GraphQL (Section 3) for reads. Existing integrations should migrate to the Management OpenAPI. See Adobe deprecation notice.

**When to use:** Only for maintaining existing integrations that have not yet migrated. Returns Content Fragments in SIREN entity format, which is verbose and non-standard.

**Auth:** IMS bearer token (`Authorization: Bearer <token>`).

**Base URL:** `https://author-<env>.adobeaemcloud.com`

**Key endpoints:**

| Operation | Method | Path |
| --- | --- | --- |
| List folder contents | GET | /api/assets/{folderPath}.json |
| Get CF metadata | GET | /api/assets/{cfPath}.json |
| Create CF | POST | /api/assets/{parentPath}/* |
| Update CF | PUT | /api/assets/{cfPath} |
| Delete CF | DELETE | /api/assets/{cfPath} |

**Action code — list assets (legacy):**

```javascript
const fetch = require('node-fetch')

async function main(params) {
  const token = getToken(params)
  const host = params.AEM_HOST
  const folderPath = (params.folderPath || '/content/dam').replace(/^\/+|\/+$/g, '')

  const res = await fetch(`${host}/api/assets/${folderPath}.json`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  })

  if (!res.ok) return { statusCode: res.status, body: { error: await res.text() } }

  const data = await res.json()
  // SIREN format: entities array contains child assets/folders
  const items = (data.entities || []).map(e => ({
    name: e.properties?.name,
    path: e.properties?.['jcr:path'],
    type: e.class?.[0],
    title: e.properties?.['jcr:title'] || e.properties?.name
  }))

  return { statusCode: 200, body: { items, total: items.length } }
}

function getToken(params) {
  const auth = params.__ow_headers?.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth
}
exports.main = main
```

**Migration path:** Replace `/api/assets/` calls with the equivalent Management OpenAPI endpoint. The Management OpenAPI uses standard JSON instead of SIREN, supports OpenAPI 3.x tooling, and receives ongoing improvements.

## Error Handling Best Practices

All AEM APIs return standard HTTP status codes. Handle these consistently in your actions:

```javascript
async function callAemApi(url, options) {
  const res = await fetch(url, options)

  if (res.status === 401) {
    return { statusCode: 401, body: { error: 'AEM authentication failed — check IMS token or API key' } }
  }
  if (res.status === 403) {
    return { statusCode: 403, body: { error: 'Insufficient permissions for the requested AEM resource' } }
  }
  if (res.status === 404) {
    return { statusCode: 404, body: { error: 'AEM resource not found — verify path and environment' } }
  }
  if (res.status === 429) {
    // Rate limited — caller should retry with exponential backoff
    const retryAfter = res.headers.get('Retry-After') || '5'
    return { statusCode: 429, body: { error: 'Rate limited by AEM', retryAfterSeconds: parseInt(retryAfter, 10) } }
  }
  if (!res.ok) {
    const errorText = await res.text()
    return { statusCode: res.status, body: { error: `AEM API error: ${res.status}`, details: errorText } }
  }

  return null // success — caller processes the response
}
```

## Manifest Configuration

When calling AEM APIs from App Builder actions, configure the action with the required inputs:

```yaml
application:
  runtimeManifest:
    packages:
      aem:
        license: Apache-2.0
        actions:
          manage-fragments:
            function: actions/manage-fragments/index.js
            web: 'yes'
            runtime: nodejs:20
            inputs:
              LOG_LEVEL: info
              AEM_HOST: $AEM_HOST
              AEM_API_KEY: $AEM_API_KEY
              AEM_DELIVERY_HOST: $AEM_DELIVERY_HOST
            annotations:
              require-adobe-auth: true
              final: true
```

Set environment variables in `.env`:

```
AEM_HOST=https://author-p12345-e67890.adobeaemcloud.com
AEM_API_KEY=your-api-key-from-developer-console
AEM_DELIVERY_HOST=https://delivery-p12345-e67890.adobeaemcloud.com
```

## Official Documentation

- [Content Fragment Delivery OpenAPI](https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/sites/) — Delivery tier API reference
- [Content Fragment Management OpenAPI](https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/sites/) — Author tier CRUD API reference
- [AEM GraphQL API](https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/headless/graphql-api/content-fragments.html) — GraphQL and persisted queries guide
- [Assets HTTP API (deprecated)](https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/assets/admin/mac-api-assets.html) — Legacy Assets API reference
- [AEM Reference Materials](https://developer.adobe.com/experience-manager/reference-materials/) — Complete API index