# DA + EDS platform reference

The shared platform foundations: where content lives, how to read and write
it, and how it gets published. Everything in `media.md` and `html-content.md`
ultimately reads or writes through the surfaces described here.

Every factual claim is tagged `[verified]` (read from code or observed
empirically) or `[assumed]` (inferred from documentation without direct
verification).

---

## 1. Storage model

Adobe Document Authoring (DA) is the content management backend for Adobe
Edge Delivery Services (EDS). Both surfaces share the same `{org}/{repo}`
namespace, where `{repo}` corresponds to a GitHub repository and `{org}` to
a GitHub organization or user.

Four hostnames surface DA content:

| Host | Purpose | Auth |
|---|---|---|
| `https://admin.da.live/source/{org}/{repo}/<path>` | DA Source API — read/write content and binaries | Bearer IMS token |
| `https://content.da.live/{org}/{repo}/<path>` | Raw DA delivery — returns the binary or HTML exactly as uploaded | None for public types |
| `https://{branch}--{repo}--{owner}.aem.page/<path>` | Preview render via the EDS pipeline | None |
| `https://{branch}--{repo}--{owner}.aem.live/<path>` | Production render via the EDS pipeline | None |

[verified] from `da-admin` source (`src/routes/source.js`) and `aem.live` docs.

A separate Admin API at `https://admin.hlx.page/{action}/{org}/{repo}/{branch}/<path>`
controls document lifecycle (preview / publish). See §6.

## 2. DA Source API contract

The Source API at `https://admin.da.live/source/{org}/{repo}/<path>` is the
only mechanism that's scriptable for both HTML content and binaries.

### Endpoints

| Verb | Pattern | Notes |
|---|---|---|
| `GET` | `/source/{org}/{repo}/{path}.html` | Read source HTML. `[verified]` |
| `POST` / `PUT` | `/source/{org}/{repo}/{path}.html` | Create or update HTML. Both verbs route to the same handler. `[verified]` from `da-admin` `src/helpers/source.js`. |
| `DELETE` | `/source/{org}/{repo}/{path}.html` | Remove. `[verified]` |
| `PUT` | `/source/{org}/{repo}/<path-to-binary>` | Image / video / asset upload. `[verified]` |
| `GET` | `/list/{org}/{repo}/{path}` | List directory contents. `[verified]` |
| `POST` | `/versionsource/{org}/{repo}/{path}` | Create a named version. `[verified]` |

### Request format

**Required headers:**

| Header | Value |
|---|---|
| `Authorization` | `Bearer <IMS_TOKEN>` |
| `Content-Type` | `multipart/form-data; boundary=…` (set automatically by HTTP clients using `FormData`) |

**Body shape:** `multipart/form-data` with a single field named **`data`**
carrying the content blob. The field name is required — `file`, `image`, etc.
silently return 200 OK with no file written. `[verified]` 2026-05-18.

**Content-Type on the blob:** `text/html` for documents, `application/json`
for sheets, `image/*` / `video/*` / `application/pdf` for binaries. The admin
reads this from the blob's type, not from the outer multipart header.
`[verified]` from `da-admin` `src/storage/object/put.js`.

### Response shape (success)

`201 Created` (new object) or `200 OK` (update), JSON body:

```json
{
  "source": {
    "editUrl":    "https://da.live/edit#/{org}/{repo}/{path}",
    "contentUrl": "https://content.da.live/{org}/{repo}/{path}"
  },
  "aem": {
    "previewUrl": "https://main--{repo}--{owner}.aem.page/{path}",
    "liveUrl":    "https://main--{repo}--{owner}.aem.live/{path}"
  }
}
```

`[verified]` 2026-05-18 via curl PUT.

### Response shape (auth failure)

`401 Unauthorized` with an empty body. No helpful error message. `[verified]`.
Always pre-flight token expiry — see §3.

### Minimal Node example

```javascript
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

async function putToDA({ absPath, daPath, mime, token, org, repo }) {
  const buf  = readFileSync(absPath);
  const blob = new Blob([buf], { type: mime });
  const form = new FormData();
  form.append('data', blob, basename(absPath));        // field name MUST be "data"
  const url = `https://admin.da.live/source/${org}/${repo}/${daPath}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`PUT ${url} → ${res.status}`);
  return res.json();
}
```

### curl equivalent

```bash
curl -X PUT \
  -H "Authorization: Bearer $DA_TOKEN" \
  -F "data=@./hero.png" \
  "https://admin.da.live/source/$ORG/$REPO/media/hero.png"
```

With curl's `-F` shorthand, the multipart boundary and field name are set
correctly. Use the literal field name `data`.

## 3. IMS authentication and token handling

All DA Source API and Admin API calls use the same Adobe IMS access token.

### Acquisition

The first-time / interactive path:

```bash
npx -y @adobe/aem-cli content clone --path /<subpath>
```

Opens a browser for IMS sign-in. The resulting token is cached at
`.hlx/.da-token.json` (per project, must be gitignored). `[verified]`

### Token file shape

```json
{
  "access_token": "eyJ...",
  "expires_at": 1778494729459
}
```

`expires_at` is Unix milliseconds. `[verified]`

### Pre-flight expiry check

The token expires silently — subsequent requests return 401 with an empty
body. Always check before a long-running upload run. Substitute the cache
path in use (`~/.aem/da-token.json` for da-auth, `.hlx/.da-token.json` for
`@adobe/aem-cli`):

```javascript
const tok = JSON.parse(readFileSync('.hlx/.da-token.json', 'utf8'));
const expMs = typeof tok.expires_at === 'number'
  ? tok.expires_at
  : JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64').toString()).exp * 1000;

if (expMs <= Date.now()) {
  throw new Error(`DA token expired at ${new Date(expMs).toISOString()}. Re-auth required.`);
}
if (expMs - Date.now() < 5 * 60 * 1000) {
  console.warn(`DA token expires in ${Math.floor((expMs - Date.now()) / 60_000)} minutes`);
}
```

### Permission scope

The token is bearer-scoped to the IMS user. There is no per-asset ACL — a
bearer can read/write everything in the `{org}/{repo}` it has access to.
`[verified]`

## 4. Retry policy for transient failures

Production scripts should retry on `429` and `5xx` responses. DA's Source
endpoint is generally robust, but the upstream `admin.hlx.page` endpoints
occasionally return transient errors under load.

| Behavior | Value |
|---|---|
| Max attempts | 3 |
| Backoff | Exponential (1s / 2s / 4s) |
| Honor `Retry-After` header | Yes |
| Retry on status | `429`, `500`, `502`, `503`, `504`, network errors (`ECONNRESET`, `ETIMEDOUT`) |
| Do NOT retry on | All other 4xx — they represent semantic failures the caller needs to see (`401` token, `413` payload, `415` unsupported media, `400` malformed) |

`[assumed]` from the policy in `aem-import-helper` and community practice.
`[verified]` for DA-specific 401-empty-body behavior on token expiry.

## 5. Path constraints

| Rule | Value |
|---|---|
| Character set | Lowercase `a–z`, digits `0–9`, dash `-` |
| Max path length | 900 characters |
| Extension on documents | `.html` in DA storage; delivered without extension |
| Extension on binaries | Required at upload (drives MIME sniffing) |
| Traversal | `..` not allowed; relative paths don't resolve against an authoritative root |

`[verified]` from `aem.live/docs/limits`.

DA's Source API will accept a PUT to `/Media/Hero Image.PNG`, but the resulting
path may not be canonically reachable. Validate paths against the rules
before uploading.

### Path normalizer

Reference implementation (not extracted from `da-admin` source). `[assumed]`

```javascript
function normalizeDAPath(name) {
  return name
    .toLowerCase()
    .replace(/[_\s]+/g, '-')                   // spaces, underscores → dash
    .replace(/[^a-z0-9\-./]/g, '')             // strip everything else
    .replace(/-+/g, '-')                        // collapse multiple dashes
    .replace(/-(\.)/g, '$1')                    // dash before . (extension) → strip
    .replace(/^-|-$/g, '');                     // trim leading/trailing dashes
}
```

## 6. Preview and publish — required step, separate from upload

Uploading via the Source API only stages drafts. The page does **not** appear
at `aem.page` or `aem.live` URLs until preview (makes `aem.page` work) and
publish (makes `aem.live` work) are explicitly triggered.

```bash
TOKEN="${DA_TOKEN:?invoke the da-auth skill to obtain a DA admin token}"

curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/{org}/{repo}/{branch}/{path}"

curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/live/{org}/{repo}/{branch}/{path}"
```

`[verified]` 2026-05-18.

**Important:**
- `{path}` matches the DA-stored content path **without** the `.html`
  extension. Index pages can use a trailing `/`.
- `{branch}` matches the GitHub branch the EDS deploy is tied to. The
  previewed page is reachable at
  `https://{branch}--{repo}--{owner}.aem.page/{path}`.
- Binaries do **not** need preview/publish — they're delivered directly from
  `content.da.live` once uploaded. Only documents that reference them need
  the lifecycle calls.

## 7. `aem content` CLI — git-style workflow

```bash
aem content clone --path /        # auth via browser, pulls into ./content/
aem content add <files>           # stage
aem content commit -m "..."       # local commit
aem content push [--force]        # upload to DA
aem content status                # show added/modified/deleted
aem content diff                  # diff local vs remote
aem content merge                 # sync
```

Auth token cached at `.hlx/.da-token.json` (gitignored). The CLI can be read
directly to authorize PUTs:

```bash
TOKEN=$(jq -r .access_token .hlx/.da-token.json)
```

### Known limitation: binaries

`aem content push` does **not** reliably upload binary files. The command was
designed for HTML; it reports success but the binary often doesn't land.
`[verified]` empirically.

Verify with `curl -sI <expected-url>`; if the upload didn't happen, fall back
to the Source API (§2) directly. Treat the CLI as HTML-only and use the
Source API for binaries until this is fixed upstream.

### Known limitation: pre-upload HTML normalization

The CLI applies pre-upload normalization that **strips EDS-specific
decorations** before sending — notably `<span class="icon icon-X">` icon
markers and similar markup that the EDS pipeline (not the editor) reads.
`[verified]` `DA-BLOCK-FORMAT.md` line 361-363.

For byte-faithful upload of pre-shaped EDS HTML (e.g. content produced
by `excat` / migration pipelines that already emit decorated blocks),
POST directly to `admin.da.live/source/...` with
`Content-Type: text/html` rather than going through the CLI:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html" \
  --data-binary @./page.html \
  "https://admin.da.live/source/{org}/{repo}/path/to/page.html"
```

The CLI is fine for prose-heavy content where decorations are absent
(authored docs, plain-text migrations). It's lossy for decorated EDS
HTML.

## 8. Rate limits

| Limit | Value | Source |
|---|---|---|
| Rate limit | 200 req/sec per IP per hostname | `aem.live/docs/limits` `[verified]` |
| Concurrent uploads (recommended) | ≤ 50 | `aem-import-helper` default `[verified]` |
| Pages per site | 1,000,000 | `aem.live/docs/limits` `[verified]` |
| Files per Code Bus reference | 500 | `aem.live/docs/limits` `[verified]` |
| Response payload (compressed) | 6 MB | `aem.live/docs/limits` `[verified]` |

For DA Source uploads, the per-IP rate limit applies — high-concurrency
upload scripts (>200 concurrent PUTs from a single IP) will see 429s and need
backoff per §4.

## 9. URL reference card

| Pattern | Purpose | Auth |
|---|---|---|
| `https://admin.da.live/source/{org}/{repo}/<path>` | DA Source API — PUT/GET/DELETE content and binaries | Bearer IMS token |
| `https://admin.da.live/list/{org}/{repo}/<path>` | List directory | Bearer IMS token |
| `https://admin.da.live/versionsource/{org}/{repo}/<path>` | Create a named version | Bearer IMS token |
| `https://admin.hlx.page/preview/{org}/{repo}/{branch}/<path>` | Trigger preview for a document | Bearer IMS token |
| `https://admin.hlx.page/live/{org}/{repo}/{branch}/<path>` | Trigger publish for a document | Bearer IMS token |
| `https://content.da.live/{org}/{repo}/<path>` | Raw DA delivery — returns bytes as uploaded | None for image / public types |
| `https://da.live/edit#/{org}/{repo}/<path>` | DA web editor for a document | Sign-in required |
| `https://{branch}--{repo}--{owner}.aem.page/<path>` | Preview deploy from a branch (post-`preview`) | None |
| `https://{branch}--{repo}--{owner}.aem.live/<path>` | Live deploy from a branch (post-`live`) | None |

For media-specific patterns (`/media`, dot-folders, AEM Assets) see
[media.md](./media.md).
