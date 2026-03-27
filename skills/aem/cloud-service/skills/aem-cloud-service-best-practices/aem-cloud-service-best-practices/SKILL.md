---
name: aem-cloud-service-best-practices
description: AEM as a Cloud Service Java/OSGi best practices, guardrails, and legacy-to-cloud pattern transformations. Use for Cloud Service–correct bundles, deprecated APIs, schedulers, ResourceChangeListener, replication, Replicator, JCR EventListener, OSGi EventHandler, DAM AssetManager, BPA-style fixes, or any time you need the detailed pattern reference modules under this skill.
---

# AEM as a Cloud Service — Best Practices

Platform guidance for **AEM as a Cloud Service** backend code: what to use, what to avoid, and **how to refactor** known legacy patterns into Cloud-compatible implementations.

This skill holds the **pattern transformation modules** (`references/*.md`). It is intended to be **installable on its own** so Cloud Service guidance is not locked behind a migration-only package.

## When to Use This Skill

Use this skill when you need to:

- Apply **AEM as a Cloud Service** constraints to Java/OSGi code (new or existing)
- Refactor **legacy patterns** into supported APIs (same modules migration uses)
- Follow **consistent rules** across schedulers, replication, JCR observation, OSGi events, and DAM assets
- Read **step-by-step transformation** and validation checklists for a specific pattern

For **BPA/CAM orchestration** (collections, CSV, MCP project selection), use the sibling plugin: `aem-cloud-service-migration` at `skills/aem/cloud-service/skills/migration/`.

## Pattern Reference Modules

Each supported pattern has a dedicated module under `references/` relative to this `SKILL.md`.

| Pattern / topic | BPA Pattern ID | Module file | Status |
|-----------------|----------------|-------------|--------|
| Scheduler | `scheduler` | `references/scheduler.md` | Ready |
| Resource Change Listener | `resourceChangeListener` | `references/resource-change-listener.md` | Ready |
| Replication | `replication` | `references/replication.md` | Ready |
| Event Listener | `eventListener` | `references/event-migration.md` | Ready |
| Event Handler | `eventHandler` | `references/event-migration.md` | Ready |
| Asset Manager | `assetApi` | `references/asset-manager.md` | Ready |
| Felix SCR → OSGi DS | — | `references/scr-to-osgi-ds.md` | Ready |
| ResourceResolver + SLF4J | — | `references/resource-resolver-logging.md` | Ready |
| *(Prerequisites hub)* | — | `references/aem-cloud-service-pattern-prerequisites.md` | — |

**Before changing code for a pattern:** read the module for that pattern in full. Modules include classification criteria, ordered transformation steps, and validation checklists.

## Java / OSGi baseline (same skill; no separate installables)

SCR→DS and `ResourceResolver`/logging are **reference modules** under `references/` — not separate skills. Read them when relevant **instead of** re-embedding the same steps inside each pattern file.

- **Hub:** [`references/aem-cloud-service-pattern-prerequisites.md`](references/aem-cloud-service-pattern-prerequisites.md)
- **Modules:** [`references/scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md), [`references/resource-resolver-logging.md`](references/resource-resolver-logging.md)

## Critical Rules (All Patterns)

**These rules apply to every pattern module. Violation means incorrect migration or unsafe Cloud Service code.**

- **READ THE PATTERN MODULE FIRST** — never transform code without reading the module
- **READ** [`scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md) and [`resource-resolver-logging.md`](references/resource-resolver-logging.md) when SCR, `ResourceResolver`, or logging are in scope (pattern modules link via the [prerequisites hub](references/aem-cloud-service-pattern-prerequisites.md); do not duplicate long guides inline)
- **DO** preserve environment-specific guards (e.g. `isAuthor()` run mode checks)
- **DO NOT** change business logic inside methods
- **DO NOT** rename classes unless the pattern module explicitly says to
- **DO NOT** invent values — extract from existing code
- **DO NOT** edit files outside the scope agreed with the user (e.g. only BPA targets or paths they named)

## Manual Pattern Hints (Classification)

When no BPA list exists, scan imports and types to pick a module:

| Look for | Pattern |
|----------|---------|
| `org.apache.sling.commons.scheduler.Scheduler` or `scheduler.schedule(` with `Runnable` | `scheduler` |
| `implements ResourceChangeListener` | `resourceChangeListener` |
| `com.day.cq.replication.Replicator` or `org.apache.sling.replication.*` | `replication` |
| `implements EventListener` with `javax.jcr.observation.*` and `onEvent(EventIterator)` | `eventListener` |
| `implements EventHandler` with substantive `handleEvent` (resolver/session/node work) | `eventHandler` |
| `com.day.cq.dam.api.AssetManager` create/remove asset APIs | `assetApi` |
| `org.apache.felix.scr.annotations` | read `references/scr-to-osgi-ds.md` (often combined with a BPA pattern) |
| `getAdministrativeResourceResolver`, `System.out` / `printStackTrace` | read `references/resource-resolver-logging.md` |

If multiple patterns match, ask which to fix first.

## Relationship to Migration

The **migration** skill (`aem-cloud-service-migration`) defines **one-pattern-per-session** workflow, BPA/CAM/MCP flows, and user messaging. It **delegates** all detailed transformation steps to this skill’s `references/` modules. Keep platform truth here; keep orchestration there.
