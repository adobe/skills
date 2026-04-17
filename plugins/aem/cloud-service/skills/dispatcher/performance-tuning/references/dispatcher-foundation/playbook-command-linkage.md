# Playbook To MCP Command Linkage (Cloud Dispatcher)

Use this file after selecting a playbook. It turns the playbook choice into a deterministic MCP command chain with expected evidence.

## Config Authoring Playbooks

| Playbook | Use when | MCP command chain | Minimum tests |
|---|---|---|---|
| Playbook A: New Site Baseline | new public site or initial site rollout | `validate(dispatcher)` -> `validate(httpd)` -> `lint` -> `sdk(check-files)` -> `sdk(diff-baseline)` -> `trace_request` | `FILT-002`, `RW-001`, `MODE-001` |
| Playbook B: Headless/API Enablement | API exposure, selectors, method rules | `validate(dispatcher)` -> `validate(httpd)` -> `lint(deep)` -> `sdk(check-files)` -> `trace_request` | `FILT-003`, `FILT-004`, `RW-003` |
| Playbook C: Multi-Site / Multi-Host Routing | host routing or virtual host changes | `validate(httpd)` -> `validate(dispatcher)` -> `lint` -> `sdk(check-files)` -> `trace_request` | `RW-001`, `HDR-002`, `MODE-004` |
| Playbook D: Cache Invalidation Tuning | `statfileslevel`, invalidate, grace/TTL work | `validate(dispatcher)` -> `lint(deep)` -> `sdk(check-files)` -> `inspect_cache` -> `trace_request` | `CACHE-003`, `CACHE-004`, `MODE-001` |
| Playbook E: Security Hardening Change | security-driven config edit | `validate(dispatcher)` -> `lint(strict)` -> `sdk(check-files)` -> `trace_request` | `FILT-001`, `FILT-004`, `MODE-001` |
| Playbook F: Vanity URL + Redirect Hygiene | vanity or redirect chain changes | `validate(httpd)` -> `lint` -> `trace_request` | `RW-001`, `RW-002`, `RW-003` |
| Playbook G: Permission-Sensitive Caching | `/auth_checker`, auth-aware cache logic | **Prereq:** Create auth-check servlet at `/bin/permissioncheck` and allowlist on publish. Then: `validate(dispatcher)` -> `lint(deep)` -> `sdk(check-files)` -> `trace_request` -> `inspect_cache` | `HDR-001`, `CACHE-002`, `CACHE-005` |
| Playbook H: CORS and Preflight for APIs | cross-origin API behavior | `validate(httpd)` -> `validate(dispatcher)` -> `lint` -> `trace_request` -> `tail_logs` | `FILT-003`, `HDR-002` |
| Playbook I: GraphQL Persisted Query Caching | persisted-query rewrite/caching | `validate(httpd)` -> `validate(dispatcher)` -> `lint(deep)` -> `trace_request` -> `inspect_cache` | `RW-006`, `CACHE-001`, `CACHE-002` |
| Playbook J: SDI/SSI Component Caching | fragment caching patterns | `validate(dispatcher)` -> `lint` -> `inspect_cache` -> `trace_request` | `CACHE-001`, `CACHE-002` |
| Playbook K: CI/Pre-Deploy Validation Gate | release readiness | `validate(dispatcher)` -> `validate(httpd)` when needed -> `lint(strict)` -> `sdk(check-files)` -> `sdk(diff-baseline)` | `MODE-001`, `MODE-003` |
| Playbook L: Probe-Safe Rewrite And Redirect Changes | probe-safe rewrites and canonical redirects | `validate(httpd)` -> `lint` -> `trace_request` | `RW-001`, `RW-004`, `RW-005` |
| Playbook M: Validator Compatibility Hardening | include graph, alias, or topology issues | `validate(dispatcher)` -> `validate(httpd)` -> `sdk(check-files)` -> `sdk(diff-baseline)` | `MODE-001`, `MODE-002`, `MODE-003` |
| Playbook N: Client Header Forwarding Or Host Contract Changes | `/clientheaders` or host/protocol forwarding | `validate(dispatcher)` -> `lint` -> `sdk(check-files)` -> `trace_request` | `HDR-001`, `HDR-002`, `MODE-001` |
| Playbook O: Managed Default Compatibility Review | wrapper drift, missing defaults, feature breakage risk | `validate(dispatcher)` -> `sdk(check-files)` -> `sdk(diff-baseline)` -> `trace_request` for affected feature | `MODE-002`, `MODE-003`, feature-specific test |

## Incident Response Playbooks

| Playbook | Use when | MCP command chain | Minimum tests |
|---|---|---|---|
| Playbook 1: 5xx Spike | 5xx surge, backend failure suspicion | `monitor_metrics` -> `tail_logs` -> `trace_request` -> `inspect_cache` -> `validate` -> `lint` | `INC-001`, `INC-002`, `INC-003` |
| Playbook 2: Cache Miss Regression | unexpected cache misses | `inspect_cache` -> `trace_request` -> `tail_logs` -> `monitor_metrics` -> `validate` | `CACHE-001`, `CACHE-002`, `INC-004` |
| Playbook 3: Sudden 403/Blocked URL | legitimate URL denied | `trace_request` -> `tail_logs` -> `validate` -> `lint(deep)` | `FILT-002`, `FILT-004`, `INC-003` |
| Playbook 4: Latency Regression | rising tail latency | `monitor_metrics` -> `trace_request` -> `tail_logs` -> `inspect_cache` -> `lint` | `INC-001`, `INC-003`, `CACHE-004` |
| Playbook 5: Redirect Loop or Multi-Hop Redirect | loop or excessive redirect count | `trace_request` -> `tail_logs` -> `validate(httpd)` -> `lint` | `RW-001`, `RW-002`, `RW-003` |
| Playbook 10: Probe Or Readiness Endpoint Regression | readiness path broken | `trace_request` -> `tail_logs` -> `validate(httpd)` -> `lint` | `RW-004`, `RW-005` |

## Security Playbooks

| Playbook | Use when | MCP command chain | Minimum tests |
|---|---|---|---|
| Playbook 1: Baseline Hardening Audit | broad security audit | `validate(dispatcher)` -> `validate(httpd)` when needed -> `lint(strict)` -> `sdk(check-files)` -> `trace_request` | `FILT-001`, `FILT-004`, `MODE-001` |
| Playbook 2: URL Blocklist Verification | sensitive-path exposure concern | `trace_request` -> `validate(dispatcher)` -> `lint(deep)` | `FILT-001`, `FILT-004` |
| Playbook 3: Pre-Release Security Gate | security gate before release | `validate(dispatcher)` -> `lint(strict)` -> `sdk(check-files)` -> `sdk(diff-baseline)` -> `trace_request` | `MODE-001`, `MODE-003`, selected exposure tests |
| Playbook 4: Method and Selector Abuse Defense | method/selector abuse hardening | `validate(dispatcher)` -> `lint(deep)` -> `trace_request` | `FILT-003`, `FILT-004` |
| Playbook 5: Security Header Regression Audit | header regression checks | `validate(httpd)` -> `lint` -> `trace_request` -> `tail_logs` | `HDR-002` |
| Playbook 6: Flush/Invalidation Exposure Review | flush endpoint exposure | `validate(dispatcher)` -> `lint(deep)` -> `trace_request` | `FILT-001`, `CACHE-003` |
| Playbook 7: Probe And Health Endpoint Safety Review | probe-safe hardening | `validate(httpd)` -> `lint` -> `trace_request` | `RW-004`, `MODE-004` |

## Performance Playbooks

| Playbook | Use when | MCP command chain | Minimum tests |
|---|---|---|---|
| Playbook 1: Improve Cache Hit Ratio | low hit ratio or high miss rate | `monitor_metrics` -> `inspect_cache` -> `trace_request` -> `validate` -> `lint` | `CACHE-001`, `CACHE-004` |
| Playbook 2: Invalidation Blast-Radius Reduction | invalidation too broad | `inspect_cache` -> `validate(dispatcher)` -> `lint(deep)` -> `monitor_metrics` | `CACHE-003`, `CACHE-004` |
| Playbook 3: Rewrite/Redirect Latency Cleanup | rewrite overhead or redirect chains | `trace_request` -> `validate(httpd)` -> `lint` -> `monitor_metrics` | `RW-001`, `RW-002`, `INC-001` |
| Playbook 4: Static Asset Delivery Optimization | asset cache and delivery tuning | `inspect_cache` -> `trace_request` -> `validate(dispatcher)` -> `lint` | `CACHE-001`, `CACHE-004` |
| Playbook 5: Query-Parameter Cache Fragmentation Cleanup | query noise hurting cache reuse | `inspect_cache` -> `trace_request` -> `validate(dispatcher)` -> `lint` | `CACHE-001`, `CACHE-002` |
| Playbook 6: Tail-Latency Hotspot Mitigation | long-tail request outliers | `monitor_metrics` -> `trace_request` -> `tail_logs` -> `inspect_cache` -> `lint` | `INC-001`, `INC-003`, `CACHE-004` |
| Playbook 7: Persisted Query Cache Enablement | GraphQL cache enablement and validation | `validate(httpd)` -> `validate(dispatcher)` -> `trace_request` -> `inspect_cache` -> `monitor_metrics` | `RW-006`, `CACHE-001`, `CACHE-004` |

## Command Usage Notes

- Use `validate(dispatcher)` as shorthand for a dispatcher-targeted `validate(...)` call with the relevant merged config section.
- Use `validate(httpd)` as shorthand for an Apache/vhost-targeted `validate(...)` call with the relevant vhost or rewrite block.
- Use `lint(strict)` for release-gate or security-gate reviews; use `lint(deep)` when rule ordering or cache policy nuance matters.
- If runtime prerequisites are missing, run the available static commands, report the gap, and leave the runtime tests open.
