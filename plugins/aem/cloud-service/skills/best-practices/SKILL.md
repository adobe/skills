---
name: best-practices
description: AEM as a Cloud Service Java/OSGi best practices, guardrails, and legacy-to-cloud pattern transformations. Use for Cloud Service–correct bundles, deprecated APIs, schedulers, ResourceChangeListener, replication, Replicator, JCR observation (javax.jcr.observation.EventListener), OSGi Event Admin (org.osgi.service.event.EventHandler), DAM AssetManager, BPA-style fixes, HTL (Sightly) Cloud SDK lint warnings (data-sly-test redundant constant value comparison), or any time you need the detailed pattern reference modules under this skill.
license: Apache-2.0
---

# AEM as a Cloud Service — Best Practices

Platform guidance for **AEM as a Cloud Service**: **Java/OSGi** (what to use, what to avoid, how to refactor legacy patterns) and **HTL** (component `.html` templates, Cloud SDK HTL lint).

This skill is a **router**: each major migration pattern lives in its own **expert skill subdirectory** (`scheduler/`, `resource-change-listener/`, `replication/`, `event-migration/`, `asset-manager/`) — each one is a self-contained expert skill covering migration, greenfield, review, troubleshooting, common pitfalls, and modern alternatives. Smaller cross-cutting reference modules (SCR→DS, resolver/logging, HTL lint, prerequisites hub) still live under `references/`.

The skill ships with the **`aem-cloud-service`** plugin. Use it **without** the **migration** skill for greenfield or maintenance work that only needs the pattern guidance. Use **migration** when you need BPA/CAM orchestration on top.

**Quick pick:** Open the **Pattern Reference Modules** table below → jump to the matching skill (`<pattern>/SKILL.md`) or reference (`references/<file>.md`) → read it fully before editing. For Java baseline concerns (Felix SCR, resolvers, logging), check the **Java / OSGi baseline** links first when those appear in the same change set.

## When to Use This Skill

Use this skill when you need to:

- Apply **AEM as a Cloud Service** constraints to **Java/OSGi** code (new or existing)
- Refactor **legacy Java patterns** into supported APIs (same modules migration uses)
- Follow **consistent rules** across schedulers, replication, **JCR observation listeners** (`eventListener`), **OSGi event handlers** (`eventHandler`), and DAM assets
- Fix **HTL (Sightly)** issues from the **AEM Cloud SDK build**, especially `data-sly-test: redundant constant value comparison`
- Read **step-by-step transformation** and validation checklists for a specific pattern

For **BPA/CAM orchestration** (collections, CSV, MCP project selection), use the **`migration`** skill (`skills/aem/cloud-service/skills/migration/`).

## Pattern Reference Modules

The five major patterns have **dedicated expert skill subdirectories** with end-to-end coverage (migration, greenfield, review checklist, troubleshooting, common pitfalls, modern alternatives, expert guidance). Smaller cross-cutting concerns are reference modules under `references/`.

| Pattern / topic | BPA Pattern ID | Skill / module | Status |
|-----------------|----------------|----------------|--------|
| Scheduler | `scheduler` | [`scheduler/SKILL.md`](scheduler/SKILL.md) | Expert skill |
| Resource Change Listener | `resourceChangeListener` | [`resource-change-listener/SKILL.md`](resource-change-listener/SKILL.md) | Expert skill |
| Replication | `replication` | [`replication/SKILL.md`](replication/SKILL.md) | Expert skill |
| Event listener (JCR observation) | `eventListener` | [`event-migration/SKILL.md`](event-migration/SKILL.md) | Expert skill |
| Event handler (OSGi Event Admin) | `eventHandler` | [`event-migration/SKILL.md`](event-migration/SKILL.md) | Expert skill |
| Asset Manager | `assetApi` | [`asset-manager/SKILL.md`](asset-manager/SKILL.md) | Expert skill |
| Felix SCR → OSGi DS | — | [`references/scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md) | Reference module |
| ResourceResolver + SLF4J | — | [`references/resource-resolver-logging.md`](references/resource-resolver-logging.md) | Reference module |
| HTL: `data-sly-test` redundant constant | — (HTL lint) | [`references/data-sly-test-redundant-constant.md`](references/data-sly-test-redundant-constant.md) | Reference module |
| *(Prerequisites hub)* | — | [`references/aem-cloud-service-pattern-prerequisites.md`](references/aem-cloud-service-pattern-prerequisites.md) | Reference module |

**Event listener vs event handler (not the same):** **`eventListener`** is **JCR observation** — the JCR API for repository change callbacks (`javax.jcr.observation.EventListener`, `onEvent`). **`eventHandler`** is **OSGi Event Admin** — whiteboard-style OSGi events (`org.osgi.service.event.EventHandler`, `handleEvent`). Both migrate via the [`event-migration/SKILL.md`](event-migration/SKILL.md) expert skill (covers JCR `EventListener` migration as Path A and OSGi `EventHandler` migration as Path B). **`resourceChangeListener`** is separate: Sling **`ResourceChangeListener`**, expert skill at [`resource-change-listener/SKILL.md`](resource-change-listener/SKILL.md).

**Before changing code for a pattern:** read the expert skill (or reference module) for that pattern in full. Each expert skill contains classification criteria, complete before/after examples, ordered transformation steps, greenfield templates, composition examples with other expert skills, review checklists, troubleshooting fingerprints, common pitfalls, modern alternatives, and expert guidance on AEMaaCS-specific concerns.

## Java / OSGi baseline (same skill; no separate installables)

SCR→DS and `ResourceResolver`/logging are **reference modules** under `references/` — not separate skills. Read them when relevant **instead of** re-embedding the same steps inside each pattern file.

- **Hub:** [`references/aem-cloud-service-pattern-prerequisites.md`](references/aem-cloud-service-pattern-prerequisites.md)
- **Modules:** [`references/scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md), [`references/resource-resolver-logging.md`](references/resource-resolver-logging.md)

## Critical Rules (All Patterns)

**These rules apply to every pattern module. Violation means incorrect migration or unsafe Cloud Service code.**

- **READ THE PATTERN MODULE FIRST** — never transform code without reading the module
- **READ** [`scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md) and [`resource-resolver-logging.md`](references/resource-resolver-logging.md) when SCR, `ResourceResolver`, or logging are in scope (pattern modules link via the [prerequisites hub](references/aem-cloud-service-pattern-prerequisites.md); do not duplicate long guides inline)
- **DO** preserve environment-specific guards (e.g. `isAuthor()` run mode checks)
- **DO NOT** change business logic inside methods (Java) or **logical show/hide intent** (HTL) unless the module explicitly allows it
- **DO NOT** rename classes unless the pattern module explicitly says to
- **DO NOT** invent values — extract from existing code
- **DO NOT** edit files outside the scope agreed with the user (e.g. only BPA targets or paths they named)
- **DO** keep **searches, discovery, and edits** for the customer's AEM sources inside the **IDE workspace root(s)** currently open; **DO NOT** grep or walk directories outside that boundary to find Java unless the user explicitly points there

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
| **HTL:** build warning `data-sly-test: redundant constant value comparison`, or `.html` under `ui.apps` / `jcr_root` with bad `data-sly-test` | read `references/data-sly-test-redundant-constant.md` |

If multiple patterns match, ask which to fix first.

## Relationship to Migration and Code-Assessment

The **`migration`** skill defines **one-pattern-per-session** workflow, BPA/CAM/MCP flows, and user messaging. It **delegates** all detailed transformation steps to this skill's expert skill subdirectories (`<pattern>/SKILL.md`) and reference modules (`references/<file>.md`). It uses a **`{best-practices}`** repo-root path alias to this folder (see its `SKILL.md`). Keep platform truth here; keep orchestration there.

The **`code-assessment`** skill (when present) is the second orchestrator entry point: it tries Health Assessment (HA) findings via MCP first, and falls back to this skill's expert subdirectories when HA has no detector coverage for a named pattern. Both orchestrators invoke the same expert skills — the difference is the discovery path (BPA/CAM for `migration`, HA/MCP for `code-assessment`).
