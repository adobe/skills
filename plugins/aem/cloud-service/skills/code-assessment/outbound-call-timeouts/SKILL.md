---
name: outbound-call-timeouts
description: "[BETA] AEM Cloud Service expert skill — add explicit connect/read/socket timeouts to outbound HTTP clients constructed without one (Apache HttpClient 4.x/5.x, OkHttp, JDK java.net.http.HttpClient), including the JDK per-request read timeout on HttpRequest. Use for \"add HTTP timeouts\", \"this external/outbound call has no timeout\", or a scan that flags a timeout-less client. Highest-frequency CSO outage cause: a client on default (effectively infinite) timeouts holds request threads on a slow upstream until the Jetty pool saturates and the site goes down. The analyzer locates timeout-less construction sites; mechanical per-library remediation applies CSO-backed default timeouts (recipe.md). This skill is in beta. Verify all outputs before applying them to production projects."
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# Outbound HTTP calls without a timeout — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

An HTTP client built without an explicit timeout inherits effectively-infinite connect/read defaults. When an upstream slows or hangs, every request thread blocks on that call; on AEM CS the shared Jetty request-thread pool saturates and the whole instance stops serving — this is the single highest-frequency cause in the CSO outage dataset. The fix sets a connect timeout **and** a read/socket timeout (and, for Apache, a connection-request timeout) so a stuck upstream fails fast instead of taking the instance down.

## Classification — confirm this pattern applies

- An HTTP client is **constructed** in application code — Apache `HttpClients.createDefault()` / `HttpClientBuilder.create()…build()`, OkHttp `new OkHttpClient()` / `…newBuilder()…build()`, or JDK `HttpClient.newHttpClient()` / `HttpClient.newBuilder()…build()` — with no timeout configured in the same scope.
- The user asks to "add HTTP/outbound/external-call timeouts", or a scan flagged `outbound-call-timeouts`.
- **Not** this pattern: a client that already sets a timeout (any of `RequestConfig`, `setConnectTimeout`, `connectTimeout`, `Timeout.of…`, `Duration.of…` in scope); per-request timeouts only is a partial case the recipe handles.

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern outbound-call-timeouts
```

**Match criteria (what the detector flags):**

- **Client construction** — text containing a known client type (`HttpClientBuilder`, `HttpClients`, `OkHttpClient`, `HttpClient`) **and** a construction marker (`.createDefault`, `.newBuilder`, `.newHttpClient`, `.build(`, `new HttpClientBuilder`, `new OkHttpClient`), emitted at the outermost fluent-chain link. **Suppressed** when the enclosing method (or, for a field initializer, the enclosing class) contains any client timeout token (`setConnectTimeout`, `setSocketTimeout`, `setConnectionRequestTimeout`, `setResponseTimeout`, `connectTimeout`, `readTimeout`, `writeTimeout`, `callTimeout`, `RequestConfig`, `Timeout.of`, `Duration.of`).
- **JDK request builder** — a `HttpRequest.newBuilder()…build()` chain (gated to `java.net.http.HttpRequest` by import/FQN so other libraries' `HttpRequest` is not matched). **Suppressed** when the chain itself sets `.timeout(...)`. This is the per-request read timeout the JDK has no client-level setter for.

Parse-level only — no type resolution, so matching is textual.

**Conservative posture (intentional false negatives).** If a timeout is configured *anywhere* in the enclosing scope the site is skipped, even if it is the wrong knob — the detector prefers missing a real issue to flagging a safe client. The residual false-positive case (a client whose timeout is supplied from a *different* method — an injected `RequestConfig` or a shared `HttpClientFactory`) is caught at remediation by the recipe's skip policy, not at detection.

## Resolution contract

**self-evident** — fixed default timeouts are applied; the developer supplies nothing up front (they review the resulting diff). Defaults: **connect 3 s, read/socket 8 s, Apache connection-request 2 s** — bounded against the infinite-hang outage and CSO-aligned; tighten in review if the upstream's SLA is stricter. The library and edit template are picked deterministically from the construction site's import package (`org.apache.http` → Apache 4.x, `org.apache.hc` → Apache 5.x, `okhttp3` → OkHttp, `java.net.http` → JDK). All are fully mechanical — for the JDK client the connect timeout goes on the client, and JDK `HttpRequest.newBuilder()…build()` chains are detected and fixed separately with a per-request `.timeout(...)`. Cases that cannot be completed deterministically (non-standard construction shapes) are skipped with a reason, never guessed.

## Review checklist

- [ ] The timeout is applied to the **flagged** client construction, not a different client in the file
- [ ] **Both** a connect timeout and a read/socket timeout are set (connect-only still hangs on a slow response body)
- [ ] Apache: also set `connectionRequestTimeout` (pool-checkout) — a saturated connection pool otherwise blocks regardless of socket timeout
- [ ] Correct API for the library version — Apache 4.x `RequestConfig.setSocketTimeout(int ms)` vs 5.x `Timeout` / `setResponseTimeout`; OkHttp `Duration` overloads; JDK `connectTimeout(Duration)` + per-request `.timeout(Duration)`
- [ ] No value left at `0` / infinite; values are seconds-scale, not minutes
- [ ] Clients that already receive a timeout from a shared factory or injected config are **skipped with a reason**, not double-configured
- [ ] Surgical edit — no reformatting, imports added only as needed

## Recipe

Read [`recipe.md`](recipe.md) in full before editing: input contract, locator, per-library remediation (Apache 4.x/5.x, OkHttp, JDK `java.net.http`), recommended values, skip policy, before/after, editing strategy.

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff and the suggested commit message.
