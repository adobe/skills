---
name: aem-best-practices
description: AEM as a Cloud Service Java/OSGi best practices, guardrails, and legacy-to-cloud pattern transformations. Use for Cloud Service–correct bundles, deprecated APIs, schedulers, ResourceChangeListener, replication, Replicator, JCR observation (javax.jcr.observation.EventListener), OSGi Event Admin (org.osgi.service.event.EventHandler), DAM AssetManager, BPA-style fixes, or any time you need the detailed pattern reference modules under this skill.
---

# AEM as a Cloud Service — Best Practices

Platform guidance for **AEM as a Cloud Service** backend code: what to use, what to avoid, and **how to refactor** known legacy patterns into Cloud-compatible implementations.

This skill holds the **pattern transformation modules** (`references/*.md`). It is intended to be **installable on its own** so Cloud Service guidance is not locked behind a migration-only package.

**Quick pick:** Open the **Pattern Reference Modules** table below → jump to the matching `references/<file>.md` → read it fully before editing Java. For Felix SCR, resolvers, or logging, use **Java / OSGi baseline** links in this file first when those appear in the same change set.

## When to Use This Skill

Use this skill when you need to:

- Apply **AEM as a Cloud Service** constraints to Java/OSGi code (new or existing)
- Refactor **legacy patterns** into supported APIs (same modules migration uses)
- Follow **consistent rules** across schedulers, replication, **JCR observation listeners** (`eventListener`), **OSGi event handlers** (`eventHandler`), and DAM assets
- Read **step-by-step transformation** and validation checklists for a specific pattern

For **BPA/CAM orchestration** (collections, CSV, MCP project selection), use **`aem-migration`** (`skills/aem/cloud-service/skills/migration/`).

## Pattern Reference Modules

Each supported pattern has a dedicated module under `references/` relative to this `SKILL.md`.

| Pattern / topic | BPA Pattern ID | Module file | Status |
|-----------------|----------------|-------------|--------|
| Scheduler | `scheduler` | `references/scheduler.md` | Ready |
| Resource Change Listener | `resourceChangeListener` | `references/resource-change-listener.md` | Ready |
| Replication | `replication` | `references/replication.md` | Ready |
| Event listener (JCR observation) | `eventListener` | `references/event-migration.md` | Ready |
| Event handler (OSGi Event Admin) | `eventHandler` | `references/event-migration.md` | Ready |
| Asset Manager | `assetApi` | `references/asset-manager.md` | Ready |
| Felix SCR → OSGi DS | — | `references/scr-to-osgi-ds.md` | Ready |
| ResourceResolver + SLF4J | — | `references/resource-resolver-logging.md` | Ready |
| *(Prerequisites hub)* | — | `references/aem-cloud-service-pattern-prerequisites.md` | — |

**Event listener vs event handler (not the same):** **`eventListener`** is **JCR observation** — the JCR API for repository change callbacks (`javax.jcr.observation.EventListener`, `onEvent`). **`eventHandler`** is **OSGi Event Admin** — whiteboard-style OSGi events (`org.osgi.service.event.EventHandler`, `handleEvent`). Both migrate via **`references/event-migration.md`** (Path A vs Path B). **`resourceChangeListener`** is separate: Sling **`ResourceChangeListener`**, module **`references/resource-change-listener.md`**.

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
- **DO** keep **searches, discovery, and edits** for the customer’s AEM sources inside the **IDE workspace root(s)** currently open; **DO NOT** grep or walk directories outside that boundary to find Java unless the user explicitly points there

## Manual Pattern Hints (Classification)

When no BPA list exists, scan imports and types to pick a module:

| Look for | Pattern |
|----------|---------|
| `org.apache.sling.commons.scheduler.Scheduler` or `scheduler.schedule(` with `Runnable` | `scheduler` |
| `implements ResourceChangeListener` | `resourceChangeListener` |
| `com.day.cq.replication.Replicator` or `org.apache.sling.replication.*` | `replication` |
| **JCR observation:** `javax.jcr.observation.EventListener`, `onEvent(EventIterator)`, `javax.jcr.observation.*` | `eventListener` |
| **OSGi Event Admin:** `org.osgi.service.event.EventHandler`, substantive `handleEvent` (resolver/session/node work) | `eventHandler` |
| `com.day.cq.dam.api.AssetManager` create/remove asset APIs | `assetApi` |
| `org.apache.felix.scr.annotations` | read `references/scr-to-osgi-ds.md` (often combined with a BPA pattern) |
| `getAdministrativeResourceResolver`, `System.out` / `printStackTrace` | read `references/resource-resolver-logging.md` |

If multiple patterns match, ask which to fix first.

## Relationship to Migration

The **`aem-migration`** skill defines **one-pattern-per-session** workflow, BPA/CAM/MCP flows, and user messaging. It **delegates** all detailed transformation steps to this skill’s `references/` modules. It uses a **`{best-practices}`** repo-root path alias to this folder (see its `SKILL.md`). Keep platform truth here; keep orchestration there.
