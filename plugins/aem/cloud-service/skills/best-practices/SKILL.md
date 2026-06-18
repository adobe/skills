---
name: best-practices
description: AEM as a Cloud Service Java/OSGi best practices, guardrails, and legacy-to-cloud pattern transformations. Includes pattern-specific guides for the five major migration patterns (scheduler, resource-change-listener, replication, event-migration, asset-manager) plus shared guides for SCR→DS, ResourceResolver/SLF4J, HTL data-sly-test lint, and prerequisites. Use for Cloud Service–correct bundles, deprecated APIs, schedulers, ResourceChangeListener, replication, Replicator, JCR observation (javax.jcr.observation.EventListener), OSGi Event Admin (org.osgi.service.event.EventHandler), DAM AssetManager, BPA-style fixes, or HTL (Sightly) Cloud SDK lint warnings (data-sly-test redundant constant value comparison).
license: Apache-2.0
---

# AEM as a Cloud Service — Best Practices

Platform guidance for **AEM as a Cloud Service**: **Java/OSGi** (what to use, what to avoid, how to refactor legacy patterns) and **HTL** (component `.html` templates, Cloud SDK HTL lint).

Each major migration pattern has its own **pattern guide** (`scheduler/`, `resource-change-listener/`, `replication/`, `event-migration/`, `asset-manager/`) covering migration, greenfield, review, troubleshooting, common pitfalls, and modern alternatives. Shared topics used across patterns (SCR→DS, resolver/logging, HTL lint, prerequisites hub) live as references under `references/`.

The skill ships with the **`aem-cloud-service`** plugin. Use it **without** the **migration** skill for greenfield or maintenance work that only needs the pattern guidance. Use **migration** when you also need BPA/CAM-driven discovery and a one-pattern-per-session workflow on top.

**Quick pick:** Open the **Pattern Guides** table below → jump to the matching pattern guide (`<pattern>/SKILL.md`) or reference (`references/<file>.md`) → read it fully before editing. For Java baseline concerns (Felix SCR, resolvers, logging), check the **Java / OSGi baseline** links first when those appear in the same change set.

## When to Use This Skill

Use this skill when you need to:

- Apply **AEM as a Cloud Service** constraints to **Java/OSGi** code (new or existing)
- Refactor **legacy Java patterns** into supported APIs (same pattern guides and references the migration skill uses)
- Follow **consistent rules** across schedulers, replication, **JCR observation listeners** (`eventListener`), **OSGi event handlers** (`eventHandler`), and DAM assets
- Fix **HTL (Sightly)** issues from the **AEM Cloud SDK build**, especially `data-sly-test: redundant constant value comparison`
- Read **step-by-step transformation** and validation checklists for a specific pattern

For **BPA/CAM-driven discovery** (collections, CSV, MCP project selection), use the **`migration`** skill (`skills/aem/cloud-service/skills/migration/`).

## Pattern Guides

The five major patterns each have a **dedicated pattern guide** with end-to-end coverage (migration, greenfield, review checklist, troubleshooting, common pitfalls, modern alternatives, and AEMaaCS-specific guidance). Shared topics used across patterns are references under `references/`.

| Pattern / topic | BPA Pattern ID | Guide | Kind |
|-----------------|----------------|-------|------|
| Scheduler | `scheduler` | [`scheduler/SKILL.md`](scheduler/SKILL.md) | Pattern guide |
| Resource Change Listener | `resourceChangeListener` | [`resource-change-listener/SKILL.md`](resource-change-listener/SKILL.md) | Pattern guide |
| Replication | `replication` | [`replication/SKILL.md`](replication/SKILL.md) | Pattern guide |
| Event listener (JCR observation) | `eventListener` | [`event-migration/SKILL.md`](event-migration/SKILL.md) | Pattern guide |
| Event handler (OSGi Event Admin) | `eventHandler` | [`event-migration/SKILL.md`](event-migration/SKILL.md) | Pattern guide |
| Asset Manager | `assetApi` | [`asset-manager/SKILL.md`](asset-manager/SKILL.md) | Pattern guide |
| Felix SCR → OSGi DS | — | [`references/scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md) | Reference |
| ResourceResolver + SLF4J | — | [`references/resource-resolver-logging.md`](references/resource-resolver-logging.md) | Reference |
| HTL: `data-sly-test` redundant constant | — (HTL lint) | [`references/data-sly-test-redundant-constant.md`](references/data-sly-test-redundant-constant.md) | Reference |
| *(Prerequisites hub)* | — | [`references/aem-cloud-service-pattern-prerequisites.md`](references/aem-cloud-service-pattern-prerequisites.md) | Reference |

**Event listener vs event handler (not the same):** **`eventListener`** is **JCR observation** — the JCR API for repository change callbacks (`javax.jcr.observation.EventListener`, `onEvent`). **`eventHandler`** is **OSGi Event Admin** — whiteboard-style OSGi events (`org.osgi.service.event.EventHandler`, `handleEvent`). Both migrate via the [`event-migration/SKILL.md`](event-migration/SKILL.md) pattern guide (covers JCR `EventListener` migration as Path A and OSGi `EventHandler` migration as Path B). **`resourceChangeListener`** is separate: Sling **`ResourceChangeListener`**, guide at [`resource-change-listener/SKILL.md`](resource-change-listener/SKILL.md).

**Before changing code for a pattern:** read the relevant pattern guide (or shared reference) in full. Each pattern guide contains classification criteria, complete before/after examples, ordered transformation steps, greenfield templates, composition examples with other patterns, review checklists, troubleshooting fingerprints, common pitfalls, modern alternatives, and guidance on AEMaaCS-specific concerns.

## Java / OSGi baseline (same skill; no separate installables)

SCR→DS and `ResourceResolver`/logging are **shared references** under `references/` — not separate skills. Read them when relevant **instead of** re-embedding the same steps inside each pattern file.

- **Hub:** [`references/aem-cloud-service-pattern-prerequisites.md`](references/aem-cloud-service-pattern-prerequisites.md)
- **Modules:** [`references/scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md), [`references/resource-resolver-logging.md`](references/resource-resolver-logging.md)

## Critical Rules (All Patterns)

**These rules apply to every pattern guide and reference. Violation means incorrect migration or unsafe Cloud Service code.**

- **READ THE RELEVANT PATTERN GUIDE OR REFERENCE FIRST** — never transform code without reading the relevant file in full
- **READ** [`scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md) and [`resource-resolver-logging.md`](references/resource-resolver-logging.md) when SCR, `ResourceResolver`, or logging are in scope (pattern guides and references link via the [prerequisites hub](references/aem-cloud-service-pattern-prerequisites.md); do not duplicate long guides inline)
- **DO** preserve environment-specific guards (e.g. `isAuthor()` run mode checks)
- **DO NOT** change business logic inside methods (Java) or **logical show/hide intent** (HTL) unless the pattern guide or reference explicitly allows it
- **DO NOT** rename classes unless the pattern guide or reference explicitly says to
- **DO NOT** invent values — extract from existing code
- **DO NOT** edit files outside the scope agreed with the user (e.g. only BPA targets or paths they named)
- **DO** keep **searches, discovery, and edits** for the customer's AEM sources inside the **IDE workspace root(s)** currently open; **DO NOT** grep or walk directories outside that boundary to find Java unless the user explicitly points there

## Manual Pattern Hints (Classification)

When no BPA list exists, scan imports and types to pick the pattern guide or reference:

| Look for | Pattern → Guide |
|----------|-----------------|
| `org.apache.sling.commons.scheduler.Scheduler` or `scheduler.schedule(` with `Runnable` | `scheduler` → [`scheduler/SKILL.md`](scheduler/SKILL.md) |
| `implements ResourceChangeListener` | `resourceChangeListener` → [`resource-change-listener/SKILL.md`](resource-change-listener/SKILL.md) |
| `com.day.cq.replication.Replicator` or `org.apache.sling.replication.*` | `replication` → [`replication/SKILL.md`](replication/SKILL.md) |
| **JCR observation:** `javax.jcr.observation.EventListener`, `onEvent(EventIterator)`, `javax.jcr.observation.*` | `eventListener` → [`event-migration/SKILL.md`](event-migration/SKILL.md) |
| **OSGi Event Admin:** `org.osgi.service.event.EventHandler`, substantive `handleEvent` (resolver/session/node work) | `eventHandler` → [`event-migration/SKILL.md`](event-migration/SKILL.md) |
| `com.day.cq.dam.api.AssetManager` create/remove asset APIs | `assetApi` → [`asset-manager/SKILL.md`](asset-manager/SKILL.md) |
| `org.apache.felix.scr.annotations` | [`references/scr-to-osgi-ds.md`](references/scr-to-osgi-ds.md) (often combined with one of the patterns above) |
| `getAdministrativeResourceResolver`, `System.out` / `printStackTrace` | [`references/resource-resolver-logging.md`](references/resource-resolver-logging.md) |
| **HTL:** build warning `data-sly-test: redundant constant value comparison`, or `.html` under `ui.apps` / `jcr_root` with bad `data-sly-test` | [`references/data-sly-test-redundant-constant.md`](references/data-sly-test-redundant-constant.md) |

If multiple patterns match, ask which to fix first.

## Relationship to Migration

The **`migration`** skill drives the **one-pattern-per-session** workflow, BPA/CAM/MCP discovery, and user messaging. It **points to** this skill's pattern guides (`<pattern>/SKILL.md`) and references (`references/<file>.md`) for all detailed transformation steps. It uses a **`{best-practices}`** repo-root path alias to this folder (see its `SKILL.md`). Keep platform truth here; keep the workflow there.
