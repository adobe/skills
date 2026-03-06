# Capability Coverage Map (Cloud, Core-7)

This file maps dispatcher MCP capability requirements to the current **skill + core-7 MCP** execution model.

## Tool Coverage Mapping

| Tool/Capability | Scope | Core-7 skill pattern |
|---|---|---|
| `generate` | Rule/config snippets (filter/cache/farm/rewrite/vhost/headers/CI/env) | `config-authoring` + `config-patterns.md` + `reference-snippets.md` + `config-scenario-playbooks.md`, then `validate` + `lint` + `sdk` |
| `simulate` | Invalidation/rewrite/pattern/request-flow checks | Runtime evidence path: `trace_request` + `inspect_cache` + `tail_logs`; static reasoning via URL decomposition + filter-order analysis |
| `rewrite_rules` | Rewrite templates/validation/simulation | Apache validation with `validate({"config":"<vhost/rewrite block>","type":"httpd","config_type":"vhost"})` + redirect-chain tracing with `trace_request` + rules from config patterns |
| `troubleshoot` | Cache, hit-ratio, invalidation, vanity, escalation diagnostics | `incident-response` + `incident-scenario-playbooks.md` + `symptom-hypothesis-matrix.md` + runtime/static checks |
| `explain` | Directive and behavior explanations | `technical-advisory` + `concepts.md` + `public-docs-index.md` + citation rules |
| `get_knowledge` | Topic knowledge retrieval | Curated references directly in skill `references/` + explicit citation policy |
| Incident/workflow orchestration | Structured remediation flows | Skill-specific output contracts + scenario playbooks + rollback templates |

## Prompt Intent Coverage

Prompt intent coverage is explicit across the dispatcher skills.

| Prompt id | Current skill owner | Primary reference |
|---|---|---|
| `setup-new-site` | `config-authoring` | `config-scenario-playbooks.md` (Playbook A) |
| `setup-permission-sensitive-caching` | `config-authoring` | `config-scenario-playbooks.md` (Playbook G) |
| `setup-headless-api` | `config-authoring` | `config-scenario-playbooks.md` (Playbook B/H) |
| `setup-multi-site` | `config-authoring` | `config-scenario-playbooks.md` (Playbook C) |
| `setup-sdi-caching` | `config-authoring` | `config-scenario-playbooks.md` (Playbook I) |
| `write-filter-rules` | `config-authoring` | `config-patterns.md` + Playbook B |
| `write-rewrite-rules` | `config-authoring` | `config-patterns.md` + Playbook F |
| `configure-cache-strategy` | `config-authoring` | `config-scenario-playbooks.md` (Playbook D) |
| `configure-flush-invalidation` | `config-authoring` | `config-scenario-playbooks.md` (Playbook D) |
| `configure-vanity-urls` | `config-authoring` | `config-scenario-playbooks.md` (Playbook F) |
| `configure-cors` | `config-authoring` | `config-scenario-playbooks.md` (Playbook H) |
| `full-config-audit` | `security-hardening` + `performance-tuning` | security/performance scenario playbooks |
| `test-url-flow` | `technical-advisory` or runtime/perf/security skills | `test-case-catalog.md` + `trace_request` evidence |
| `validate-before-deploy` | `config-authoring` | `validation-playbook.md` + Playbook J |
| `debug-cache-miss` | `incident-response` | `incident-scenario-playbooks.md` (Playbook 2) |
| `debug-502-errors` | `incident-response` | `incident-scenario-playbooks.md` (Playbook 1) |
| `debug-redirect-loop` | `incident-response` | `incident-scenario-playbooks.md` (Playbook 5) |
| `debug-url-blocked` | `incident-response` | `incident-scenario-playbooks.md` (Playbook 3) |
| `debug-slow-responses` | `incident-response` + perf skill | `incident-scenario-playbooks.md` (Playbook 4) |
| `incident-response` | `incident-response` | `runtime-investigation-checklist.md` + incident report template |
| `optimize-cache-hit-ratio` | `performance-tuning` | `performance-scenario-playbooks.md` (Playbook 1) |
| `optimize-invalidation` | `performance-tuning` | `performance-scenario-playbooks.md` (Playbook 2) |
| `optimize-static-assets` | `performance-tuning` | `performance-scenario-playbooks.md` (Playbook 4) |
| `security-audit` | `security-hardening` | `security-scenario-playbooks.md` (Playbook 1/3) |
| `harden-for-production` | `security-hardening` + `config-authoring` | `security-scenario-playbooks.md` + config playbooks |
| `analyze-dispatcher-logs` | `incident-response` | `incident-scenario-playbooks.md` (Playbook 8) |
| `explain-dispatcher-flow` | `technical-advisory` | `request-router.md` + `concepts.md` |
| `compare-configs` | `config-authoring` | `validation-playbook.md` + `sdk(diff-baseline)` guidance |
| `fix-sdk-validation` | `incident-response` + `config-authoring` | `incident-scenario-playbooks.md` (Playbook 6) + validation playbook |
| `setup-ci-pipeline` | `config-authoring` | `config-scenario-playbooks.md` (Playbook J) |

## Resource Coverage Mapping

| MCP resource area | Current coverage |
|---|---|
| `resources/documentation.py` | `public-docs-index.md` + `concepts.md` + citation rules |
| `resources/examples.py` | `reference-snippets.md` + config/perf/security/incident scenario playbooks |
| `prompts/templates.py` | Skill-level workflows + scenario playbooks + this coverage map |

## Execution Model

The dispatcher skills use a deterministic model:

1. fixed MCP runtime/validation primitives (core-7)
2. explicit skill workflows and output contracts
3. citation and rollback discipline

This keeps behavior auditable and open-source friendly.
