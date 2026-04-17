# AEM Cloud Service Dispatcher Skills

This package contains dispatcher-focused skills for AEM as a Cloud Service.

In this package, "Dispatcher" means the Adobe Dispatcher Apache HTTP Server module plus its HTTPD and dispatcher configuration. It does not mean an AEM OSGi bundle.

## Scope

Use these skills for:

- dispatcher and HTTPD configuration design
- filter, cache, rewrite, vhost, header, and farm changes
- cloud-specific topology, validator, and immutable-file guardrail reviews
- runtime incident triage
- performance tuning
- security hardening

## Skill Map

- `workflow-orchestrator/` for end-to-end work that spans design, changes, validation, and follow-up
- `config-authoring/` for concrete config changes
- `technical-advisory/` for conceptual guidance, explanation, and citation-backed recommendations
- `incident-response/` for runtime failures and regressions
- `performance-tuning/` for cache, latency, and throughput work
- `security-hardening/` for exposure review and production hardening

## Shared Foundation

Cross-cutting references are packaged directly inside each skill under `references/dispatcher-foundation/`.

That directory contains repo-layout guidance, verification matrices, rollback templates, test catalogs, public-doc indexes, and cloud guardrails used across multiple skills. It is intentionally not limited to technical-advisory content.

- [`local-sdk-execution.md`](./config-authoring/references/dispatcher-foundation/local-sdk-execution.md) explains the shipped local Dispatcher SDK launchers, hot-reload flow, and runtime environment variables used for cloud-side local verification.




## How To Start

For broad or first-time requests, start with:

- `workflow-orchestrator/references/dispatcher-foundation/quick-start-execution-path.md`
- `workflow-orchestrator/SKILL.md`

For targeted work, start with the specialist skill that matches the request.
