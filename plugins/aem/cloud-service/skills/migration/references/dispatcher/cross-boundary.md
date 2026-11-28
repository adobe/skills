# Dispatcher Conversion — Cross-Boundary Router (Branch E)

This is **phase 5 (JUDGMENT + CROSS-BOUNDARY)** of the flow in [context.md](context.md): once the tool has converted the config and phase 4 has verified it, route each remaining concern to the owner that already knows how to resolve it instead of reimplementing it here.

## Router

| Concern | Owner | Where |
|---|---|---|
| Cloud Manager variables | migration **Branch A** | run `scripts/dispatcher-crossboundary.js`; hand the `cmVars` artifact to Branch A ([../../SKILL.md](../../SKILL.md) → Branch A / [osgi-cfg-json-cloud-manager.md](../osgi-cfg-json-cloud-manager.md)); `secretLike` entries get Branch A's secret handling |
| Immutable/default **freshness & drift** | `aem-cloud-service-dispatcher` skill | [config-authoring](../../../aem-cloud-service-dispatcher/references/config-authoring/GUIDE.md) → `sdk(action="diff-baseline")`, `sdk(action="check-files")`; [validation-playbook.md](../../../aem-cloud-service-dispatcher/references/config-authoring/references/config-authoring/validation-playbook.md) §6 managed defaults |
| **Filter/ACL security posture** (deny-by-default, no allow-all, sensitive-path denies) | `aem-cloud-service-dispatcher` skill | [security-hardening](../../../aem-cloud-service-dispatcher/references/security-hardening/GUIDE.md) → `security-baseline-checklist.md` + `sensitive-paths-catalog.md`; run `lint(strict)`. **Required** after conversion — `filter-acl-loss` (phase 4) is a rule-count gate, not a posture check, so a preserved-but-insecure policy still needs this pass. |
| **Security headers / edge / CDN split** | `aem-cloud-service-dispatcher` skill | [security-hardening](../../../aem-cloud-service-dispatcher/references/security-hardening/GUIDE.md) (headers) and [performance-tuning](../../../aem-cloud-service-dispatcher/references/performance-tuning/GUIDE.md) (cache/edge) |
| **Config validation & quality** | `aem-cloud-service-dispatcher` skill | [config-authoring](../../../aem-cloud-service-dispatcher/references/config-authoring/GUIDE.md) → `validate` / `lint` (already routed by [validation.md](validation.md)) |

**Why delegate.** The `aem-cloud-service-dispatcher` skill owns these via the core-7 MCP tools for cloud configs; Branch E contributes the conversion delta + CM handoff and hands off the rest.

## See also

- [context.md](context.md) — the 6-phase flow this doc is phase 5 of, and the mode taxonomy.
- [config-generation.md](config-generation.md) — phase 2; the `config.yaml` contract the tool is driven with.
- [output-verification.md](output-verification.md) — phase 4; the verification gate that must clear before this routing pass runs.
- [validation.md](validation.md) — phase 6; already delegates config validation/quality to the `aem-cloud-service-dispatcher` skill.
- [current-sdk-conventions.md](current-sdk-conventions.md) — the target end-state conventions these owners resolve against.
