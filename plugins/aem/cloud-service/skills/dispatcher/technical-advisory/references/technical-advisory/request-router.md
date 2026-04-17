# Dispatcher Request Router

Use this router to select the primary dispatcher skill consistently.

## Routing Rules

| User Intent | Primary Skill | Secondary Skill |
|---|---|---|
| Create/update/refactor dispatcher/httpd config | `config-authoring` | `technical-advisory` |
| Investigate incident, outage, cache miss/hit anomaly, 4xx/5xx spike | `incident-response` | `config-authoring` |
| Compare or migrate between deployment modes | `technical-advisory` | the matching `technical-advisory` skill from the other dispatcher variant when a side-by-side comparison is required |
| Optimize performance, improve cache hit ratio, capacity planning | `performance-tuning` | `incident-response` |
| Security audit, hardening, compliance check, penetration test prep | `security-hardening` | `config-authoring` |
| Ask conceptual, best-practice, policy, or docs-backed questions | `technical-advisory` | one of the above based on follow-up action |

## Intent Cues

Use simple cue words to route quickly:

- Config authoring cues: "add filter", "rewrite", "cache rule", "vhost change"
- Feature-path cues: "GraphQL persisted query", "Commerce", "frontend-static", "Dynamic Media", "auth_checker", "vanity", "clientheaders", "forwarded host", "x-forwarded-proto", "header forwarding"
- Filter: last matching rule wins; for targeted deny, add rule after broader allow.
- URL semantics cues: "selector", "selectors", "suffix", "extension", "URL decomposition"
- Incident cues: "spike", "outage", "stale", "403/404/5xx", "cache miss", "probe failed", "health check", "systemready"
- Migration cues: "migration", "dual mode", "compatibility", "cross-mode behavior"
- Performance cues: "optimize", "faster", "cache hit ratio", "load test", "capacity"
- Security cues: "audit", "harden", "security check", "penetration test", "compliance"
- Advisory cues: "why", "best practice", "what should we do", "doc reference"

## Ambiguous Requests

If intent is mixed:

1. Start with `technical-advisory` to frame scope and assumptions.
2. Hand off to execution skill:
   - config changes -> `config-authoring`
   - live issue triage -> `incident-response`
   - migration/dual-mode work -> `technical-advisory` with a mode delta checklist; compare against the matching `technical-advisory` skill in the other dispatcher variant when needed
   - performance tuning/capacity work -> `performance-tuning`
   - security hardening/audit work -> `security-hardening`
   - environment-sensitive or cloud-runtime path question -> `technical-advisory` first, then `config-authoring` or `incident-response`

## Handoff Payload

When handing off from advisory to an execution skill, include:

- selected mode (`cloud`)
- objective and acceptance criteria
- required test IDs from [test-case-catalog.md](../dispatcher-foundation/test-case-catalog.md)
- required checks from `mode-specific-verification-matrix.md`
- key citations used to justify the approach

## Completion Rule

A request is complete only when:

1. advisory content is source-backed (`public-docs-index.md`)
2. execution recommendations include MCP verification steps
3. risk and rollback expectations are explicit
