> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Cross-Boundary Router (Branch E)

This is **phase 5 (JUDGMENT + CROSS-BOUNDARY)** of the flow in [context.md](context.md): once the tool has converted the config and phase 4 has verified it, route each remaining concern to the owner that already knows how to resolve it instead of reimplementing it here.

## Router

| Concern | Owner | Where |
|---|---|---|
| Cloud Manager variables | migration **Branch A** | run `scripts/dispatcher-crossboundary.js`; hand the `cmVars` artifact to Branch A ([../../SKILL.md](../../SKILL.md) → Branch A / [osgi-cfg-json-cloud-manager.md](../osgi-cfg-json-cloud-manager.md)); `secretLike` entries get Branch A's secret handling |
| Immutable/default **freshness & drift** | `dispatcher` skill | [config-authoring](../../../dispatcher/config-authoring/SKILL.md) → `sdk(action="diff-baseline")`, `sdk(action="check-files")`; [validation-playbook.md](../../../dispatcher/config-authoring/references/config-authoring/validation-playbook.md) §6 managed defaults |
| **Security headers / edge / CDN split** | `dispatcher` skill | [security-hardening](../../../dispatcher/security-hardening/SKILL.md) (headers) and [performance-tuning](../../../dispatcher/performance-tuning/SKILL.md) (cache/edge) |
| **Config validation & quality** | `dispatcher` skill | [config-authoring](../../../dispatcher/config-authoring/SKILL.md) → `validate` / `lint` (already routed by [validation.md](validation.md)) |

**Why delegate.** The `dispatcher` skill owns these via the core-7 MCP tools for cloud configs; Branch E contributes the conversion delta + CM handoff and hands off the rest.

## See also

- [context.md](context.md) — the 6-phase flow this doc is phase 5 of, and the mode taxonomy.
- [config-generation.md](config-generation.md) — phase 2; the `config.yaml` contract the tool is driven with.
- [output-verification.md](output-verification.md) — phase 4; the verification gate that must clear before this routing pass runs.
- [validation.md](validation.md) — phase 6; already delegates config validation/quality to the `dispatcher` skill.
- [current-sdk-conventions.md](current-sdk-conventions.md) — the target end-state conventions these owners resolve against.
