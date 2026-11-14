# Recipe — outbound HTTP calls without a timeout

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Input contract

Per invocation, a deduplicated list of findings — each a client-construction site the analyzer flagged:

```json
{
  "findings": [
    {
      "pattern": "outbound-call-timeouts",
      "file": "core/src/main/java/com/example/core/http/BadHttpService.java",
      "line": 9,
      "snippet": "HttpClients.createDefault()"
    }
  ]
}
```

Sources:

1. **User-named** — the user names the Java file(s) directly.
2. **Discover** — the file/line list is the output of the **Discovery** scan in [`SKILL.md`](SKILL.md).

The per-library recipe and skip policy apply identically in both sources. The `line` + `snippet`
locate the construction; remediation edits the surrounding builder/configuration, which may span more
lines than the snippet.

## Default values (applied)

This is a **mechanical** fix: apply these fixed defaults directly — no value judgment, no developer
input up front. The developer tightens them in diff review if a specific upstream's SLA is stricter
(smaller is safer). Source: the CSO outage dataset (`no_timeouts_in_outbound`) and Adobe's
HTTP-timeout code-quality rule.

| Timeout | Meaning | Default to apply |
|---|---|---|
| connect | TCP/TLS connection establishment | **3 s** |
| read / socket | wait between bytes once connected | **8 s** |
| connection-request (Apache only) | wait to lease a connection from the pool | **2 s** |

Never apply `0` — in Apache 4.x `0` means *infinite*, which is the bug.

## Per-library remediation

**Pick the template deterministically from the construction site's imports** — no guessing:

| Import package on the construction site | Template |
|---|---|
| `org.apache.http.*` | Apache HttpClient 4.x |
| `org.apache.hc.*` | Apache HttpClient 5.x |
| `okhttp3.*` | OkHttp |
| `java.net.http.*` | JDK `HttpClient` |

Reuse any `RequestConfig`/builder already present in the file rather than introducing a second one.

### Apache HttpClient 4.x (`org.apache.http`)

Set timeouts on a `RequestConfig` and attach it as the client's default:

```java
RequestConfig config = RequestConfig.custom()
        .setConnectTimeout(3000)              // ms — TCP connect
        .setSocketTimeout(8000)               // ms — read
        .setConnectionRequestTimeout(2000)    // ms — pool checkout
        .build();
CloseableHttpClient client = HttpClientBuilder.create()
        .setDefaultRequestConfig(config)
        .build();
```

`HttpClients.createDefault()` has no hook for config — replace it with the `HttpClientBuilder.create()…build()`
form above. Imports to add: `org.apache.http.client.config.RequestConfig`,
`org.apache.http.impl.client.HttpClientBuilder` (drop `HttpClients` import if now unused).

### Apache HttpClient 5.x (`org.apache.hc`)

5.x deprecates `setSocketTimeout`/`setConnectTimeout(int)` in favour of `Timeout` and renames the
read knob to `setResponseTimeout`:

```java
RequestConfig config = RequestConfig.custom()
        .setConnectTimeout(Timeout.ofSeconds(3))
        .setResponseTimeout(Timeout.ofSeconds(8))
        .setConnectionRequestTimeout(Timeout.ofSeconds(2))
        .build();
CloseableHttpClient client = HttpClientBuilder.create()
        .setDefaultRequestConfig(config)
        .build();
```

Import `org.apache.hc.client5.http.config.RequestConfig` and `org.apache.hc.core5.util.Timeout`.

### OkHttp

Set the timeouts on the builder (Duration overloads, OkHttp 3.12+):

```java
OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(3))
        .readTimeout(Duration.ofSeconds(8))
        .writeTimeout(Duration.ofSeconds(8))
        .callTimeout(Duration.ofSeconds(15))   // optional overall ceiling
        .build();
```

If the code uses `new OkHttpClient()` (no builder), switch to `new OkHttpClient.Builder()…build()`.
Import `java.time.Duration`.

### JDK `java.net.http.HttpClient`

The JDK splits the timeout: the **connect** timeout is on the client, the **read** timeout is
per-request (`HttpRequest.timeout`). The analyzer emits a finding for **each** site, so the two are
fixed independently — match the template to the finding's `snippet`:

- **Client** (`snippet` names `HttpClient`) — add `connectTimeout`; `HttpClient.newHttpClient()` takes
  no config, so switch to the builder:

  ```java
  HttpClient client = HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(3))
          .build();
  ```

- **Request** (`snippet` names `HttpRequest.newBuilder`) — insert `.timeout(...)` into the chain,
  right after `newBuilder(...)`:

  ```java
  HttpRequest request = HttpRequest.newBuilder(uri)
          .timeout(Duration.ofSeconds(8))        // read timeout — per request
          .GET()
          .build();
  ```

Import `java.time.Duration`.

## Skip-file policy

Skip a finding (record it as `skipped` with the reason, never silently drop) when:

- **Timeout supplied elsewhere** — the client receives a `RequestConfig` / configured builder from an
  injected field, constructor parameter, or a shared factory (e.g. an AEM `HttpClientBuilderFactory`
  or a project `HttpClientFactory`). Reason: `timeout-configured-externally: <file>:<line> client built from shared/injected config`.
- **Test code** — path under `src/test/`. Reason: `test-scope: <file>:<line> outbound client in test code`.
- **Framework-managed client** — the client is obtained from an OSGi service / factory rather than
  constructed here, so the construction marker matched a wrapper. Reason: `framework-managed: <file>:<line>`.
- **Ambiguous construction** — the snippet does not correspond to a clear builder/factory site the
  templates above cover (e.g. a custom subclass). Reason: `ambiguous-construction: <file>:<line>`.

For partial cases — a per-request timeout exists but the client has no connect timeout (or vice
versa) — do **not** skip: add the missing half per the per-library template.

## Per-file edit procedure

For each finding (grouped by file):

1. Read the file. Locate the construction at `line` (the `snippet` is the outermost chain link).
2. Identify the library from imports/snippet; pick the matching template.
3. If a skip condition applies, record the skip and move on — do not partially edit.
4. Otherwise rewrite the construction surgically: introduce/extend the timeout configuration,
   switching a config-less factory call (`createDefault()` / `newHttpClient()` / `new OkHttpClient()`)
   to the builder form when needed. Preserve surrounding formatting and comments.
5. Update imports — add only what the edit uses; drop a factory import only if now unused.
6. Write the file back.

After all files are processed, continue the Verify & summarize step in [`../references/runbook.md`](../references/runbook.md).

## Before / after example

**Before** (`core/src/main/java/com/example/core/http/BadHttpService.java`):

```java
package com.example.core.http;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;

public class BadHttpService {
    public String fetch() throws Exception {
        CloseableHttpClient client = HttpClients.createDefault();
        return client.execute(null, response -> "ok");
    }
}
```

**After:**

```java
package com.example.core.http;

import org.apache.http.client.config.RequestConfig;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;

public class BadHttpService {
    public String fetch() throws Exception {
        RequestConfig config = RequestConfig.custom()
                .setConnectTimeout(3000)
                .setSocketTimeout(8000)
                .setConnectionRequestTimeout(2000)
                .build();
        CloseableHttpClient client = HttpClientBuilder.create()
                .setDefaultRequestConfig(config)
                .build();
        return client.execute(null, response -> "ok");
    }
}
```

What changed:

- `HttpClients.createDefault()` → `HttpClientBuilder.create().setDefaultRequestConfig(config).build()` (the factory call had no config hook).
- A `RequestConfig` with connect/socket/connection-request timeouts added in the same method.
- `HttpClients` import replaced by `HttpClientBuilder` + `RequestConfig`.

## Editing strategy

Surgical text-level edit, not a reformatter — preserve the developer's formatting, comments, and
import order. Concretely:

1. Insert the timeout configuration (a `RequestConfig`/`Duration`-based block) immediately before the
   construction, at the construction's indentation.
2. Replace only the construction expression that the finding points at — leave the assignment target,
   the rest of the method, and unrelated statements untouched.
3. Edit imports **one line at a time** — add each new `import …;` as its own line and remove an unused
   factory import by its exact full line. Do **not** anchor on a multi-line import block: files
   interleave unrelated imports (e.g. `Logger`), so a block anchor is not unique and the edit fails.
   Placement follows the file's existing ordering convention best-effort, but correctness never depends
   on imports being grouped or contiguous.

If the construction does not cleanly match one of the per-library templates (custom wrapper,
unexpected builder shape), trigger the `ambiguous-construction` skip rather than guessing.

## Verify

Beyond `mvn compile`, a fixed client fails fast instead of hanging: in logs, a slow upstream now
surfaces as a prompt `SocketTimeoutException` / `Read timed out` (or `HttpConnectTimeoutException` for
the JDK client) rather than threads stuck in `SocketInputStream.read` and a climbing Jetty
request-thread count.
