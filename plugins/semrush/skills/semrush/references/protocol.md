# Semrush MCP v2: auth, transport, errors

Observed against `https://mcp.semrush.com/v2/mcp` on 2026-09-21.

## OAuth

The endpoint is an OAuth-protected MCP resource. Resource metadata is served per
resource path:

```
GET https://mcp.semrush.com/.well-known/oauth-protected-resource/v2/mcp
{"resource":"https://mcp.semrush.com/v2/mcp",
 "authorization_servers":["https://oauth.semrush.com"],
 "bearer_methods_supported":["body"],
 "scopes_supported":["mcp.access"]}
```

**The bare well-known path still advertises v1.** A request to
`/.well-known/oauth-protected-resource` with no resource suffix returns
`"resource":"https://mcp.semrush.com/v1/mcp"`. A client that probes the root path
learns about the legacy endpoint. Append the resource path.

Authorization server metadata:

```
GET https://mcp.semrush.com/.well-known/oauth-authorization-server
{"issuer":"https://api.semrush.com/apis/v4/auth/v1/oauth/access_token",
 "authorization_endpoint":"https://api.semrush.com/apis/v4/auth/v0/oauth2/auth",
 "registration_endpoint":"https://api.semrush.com/apis/v4-raw/auth/v1/oauth2/register",
 "token_endpoint":"https://api.semrush.com/apis/v4-raw/auth/v1/oauth2/access_token",
 "revocation_endpoint":"https://api.semrush.com/apis/v4/auth/v1/oauth2/revoke",
 "grant_types_supported":["authorization_code","refresh_token"],
 "token_endpoint_auth_methods_supported":["none"],
 "code_challenge_methods_supported":["plain","S256"],
 "scopes_supported":["mcp.access"]}
```

Dynamic client registration is open — no pre-shared client id. Public client
(`token_endpoint_auth_method: none`), so use PKCE. The granted scope comes back
widened to `mcp.access offline offline_access`, which is what makes refresh tokens
work. One access token works against both v1 and v2; the scope is not
version-specific.

The metadata names `https://oauth.semrush.com` as the authorization server while
every actual endpoint is on `api.semrush.com`. Follow the endpoint URLs, not the
issuer host.

### The redirect-URI allowlist

Registration succeeds only for redirect URIs Semrush accepts. Verified by posting
three registrations:

| redirect_uri | Result |
|---|---|
| `http://localhost:53682/callback` | registered, client_id issued |
| `https://claude.ai/api/mcp/auth_callback` | registered, client_id issued |
| `https://example.invalid/cb` | `{"code":400,"message":"redirect URI https://example.invalid/cb is not allowed","retryable":false}` |

An agent whose OAuth callback lives on its own vendor domain is refused at the
registration step, before a consent screen appears. A loopback redirect on
`http://localhost:<port>` is the portable option. Whether the allowlist covers any
other host was not determined; only the three above were tried.

An unauthenticated `tools/list` returns a bare `401 Unauthorized` with no
`WWW-Authenticate` header, so a client that relies on the challenge header to
discover resource metadata has to fall back to the well-known paths — and must
append the resource path to avoid being pointed at v1.

## Raw HTTP, for an agent with no MCP client

The endpoint speaks streamable HTTP JSON-RPC and answered without a session id in
these tests. `initialize` first, then `tools/call`:

```
POST https://mcp.semrush.com/v2/mcp
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-06-18

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"execute_report",
  "arguments":{"report":"domain_rank","params":{"target":"example.com","database":"us"}}}}
```

The envelope arrives as a JSON string in `result.content[0].text`, and also as a
parsed object in `result.structuredContent`. Registering the server properly with
your agent is better; this is the escape hatch when registration is blocked.

`initialize` reports `serverInfo: {"name":"mcp","version":"v2"}` and returns
instructions that state the three-step flow, the bare-report-name rule, the `us`
database default, a suggested `display_limit` of 30 to 50, and the full error field
list reproduced below.

## The error catalogue

The server documents its own error contract in the `initialize` instructions:

| Field | Meaning |
|---|---|
| `code` | stable category: `validation_failed`, `no_subscription`, `no_api_units`, `rate_limit`, `internal` |
| `message` | what happened, in plain language; relay it concisely |
| `retryable` | `true` — retry with a corrected request; `false` — do not retry until the cause is resolved |
| `hint` | what to change before retrying |
| `url` | page the user, not the agent, should visit; show it verbatim |
| `trace_id` | identifier to quote to Semrush support |

Fields other than `code` and `message` appear only when applicable. Only
`validation_failed` was observed carrying a `hint`.

### Two delivery channels

**`validation_failed` arrives as a successful tool call** whose text content is the
error object. Observed cases:

```
params={domain:"example.com", database:"us"} on domain_rank
{"code":"validation_failed","message":"parameter 'target' is required",
 "retryable":true,"hint":"Fix the invalid parameters and retry. Use
 get_report_schema to check parameter requirements and constraints.",
 "trace_id":"dba3db395ec403ee1f1a95bcff139acd"}

database="zz"
{"code":"validation_failed","message":"parameter 'database' must be one of: us uk
 ca ru de fr es it br au … ch-ext","retryable":true,"hint":"…"}

display_date="20260815"
{"code":"validation_failed","message":"parameter 'display_date' must be a valid
 date","retryable":true,"hint":"…"}

export_columns with two bad entries on toppages
{"code":"validation_failed","message":"parameter 'export_columns[2]' must be one
 of: target device_type country display_date page traffic_share … ai_search;
 parameter 'export_columns[3]' must be one of: …","retryable":true,"hint":"…"}
```

The out-of-range messages enumerate every accepted value and name the offending
array index, which is faster than re-fetching the schema.

**Everything else arrives as a JSON-RPC protocol error**, code `-32603`, whose
`message` is a JSON string:

```
unknown report name
{"code":"internal","message":"unknown report","retryable":false,"trace_id":"…"}

target not in the queried database
{"code":"internal","message":"get domain_rank: ERROR 50 :: NOTHING FOUND\nNo data
 found for this request. Verify your parameters are correct. If parameters are
 valid, try a different date range or target.\nnot found",
 "retryable":false,"trace_id":"…"}

project id that does not exist
{"code":"internal","message":"get campaign info project 999999999: site audit API
 error 0: campaign not found\ncampaign not found","retryable":false,"trace_id":"…"}
```

All three are labelled `internal` and `retryable: false`, including the two that
are really "you asked for something that is not there". An agent that reads only
`code` will report a server fault for a missing domain. Read `message`.

`no_subscription`, `no_api_units` and `rate_limit` are documented by the server but
were not triggered here, so their delivery channel is unverified.

## Cost is reported per call

Successful responses carry `metadata.usage.api_units`. Discovery and
`get_report_schema` responses have no `metadata` block at all, which is consistent
with them being free of charge but does not prove it. There is no report that
returns a remaining unit balance, so track spend by accumulating the field.

## The legacy REST API is a separate entitlement

Semrush also has a key-authenticated REST API at `api.semrush.com`, unrelated to
the MCP server and not covered by its access grant. With a deliberately invalid
key:

```
GET https://api.semrush.com/?type=domain_ranks&key=notarealkey&domain=example.com&database=us
ERROR 120 :: WRONG KEY - ID PAIR

GET https://www.semrush.com/users/countapiunits.html?key=notarealkey
{"errors":[{"field":"key","message":"invalid api key: notarealkey"}]}
```

So `ERROR 120` is a REST-key failure by construction. An account can have working
MCP access over OAuth while its REST key returns 120 and its balance endpoint
returns 0; that combination was observed on the account used here. Debugging MCP
by poking at REST keys leads nowhere.
