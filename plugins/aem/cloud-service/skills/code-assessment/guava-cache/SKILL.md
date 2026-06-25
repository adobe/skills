---
name: guava-cache
description: AEM Cloud Service expert skill for the Guava cache → Caffeine swap. Covers bundles importing com.google.common.cache.* (Cache, CacheBuilder, LoadingCache, CacheLoader, RemovalListener). Classification, the near-1:1 Caffeine API mapping, pom dependency swap, import + call-site edits (getUnchecked→get, Callable→Function, RemovalNotification→3-arg), review checklist, and test generation. Routes detail to recipe.md.
license: Apache-2.0
---

# Guava cache → Caffeine — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

On AEM as a Cloud Service the supported in-process cache library is **Caffeine** (`com.github.benmanes.caffeine.cache.*`). Bundles importing `com.google.common.cache.*` are flagged because Guava is shrinking in the CS uber-jar and relying on Guava's cache from a third-party classloader is unstable. Caffeine is the recommended successor (same author as Guava cache) and its API is intentionally near-identical, so the swap is mechanical with a few well-known call-site renames.

## Classification — confirm this pattern applies

A file is in scope when it imports `com.google.common.cache.*` — `Cache`, `CacheBuilder`, `LoadingCache`, `CacheLoader`, `RemovalListener`, or `RemovalNotification`.

1. **Bundle uses Guava cache** (import + real usage) → apply the full recipe: **C1 (pom)** + **C2 (imports)** + **C3 (builder / API call sites)**.
2. **Leftover import, no real usage** → just remove the dead `com.google.common.cache.*` import; no Caffeine dependency needed.
3. **Cache plus unrelated Guava utilities** (`com.google.common.collect.*`, `com.google.common.base.*`) → only the cache portion is in scope; leave other Guava usages alone unless the user asks. Keep the `guava` dependency if other code still imports `com.google.common.*`.

**Not in scope (no false positive):** look-alike cache classes from other packages — e.g. `io.micrometer.core.instrument.binder.cache.GuavaCacheMetrics` — are not `com.google.common.cache.*` and are not flagged.

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern guava-cache
```

**Match criteria (what the detector flags):** each `import com.google.common.cache.…` (explicit type or the package wildcard `.*`) in a parsed Java file, emitted with the import line and snippet. The match is an exact package-prefix on the import — Java-only, parse-level, import-anchored; no classpath or type resolution.

## Resolution contract

**self-evident** — the Guava → Caffeine API mapping is fixed (see [recipe.md](recipe.md)); no user input is required to plan the edit. The only judgment is the Caffeine version: pin it to the AEM CS SDK BOM (default `3.1.8`).

## Review checklist

- [ ] No `import com.google.common.cache.*` remains in changed files.
- [ ] No `CacheBuilder.newBuilder()` remains; all builders use `Caffeine.newBuilder()`.
- [ ] No `LoadingCache.getUnchecked(...)` remains; replaced with `.get(...)`.
- [ ] No `cache.get(key, Callable)` remains; the `Callable` is a `Function` (lambda).
- [ ] `RemovalListener` callbacks use the `(key, value, cause)` signature, not `RemovalNotification`.
- [ ] `Caffeine` is on the bundle's `pom.xml` with `<scope>provided</scope>`, version pinned to the AEM CS SDK BOM.
- [ ] `mvn clean install` passes; **aemanalyser** reports no `com.google.common.cache` API leaks.
- [ ] Guava dependency kept only if non-cache `com.google.common.*` usage remains.

## Common pitfalls

- **Embedding Caffeine** — use `<scope>provided</scope>`; Caffeine is supplied by the CS runtime, never embed it in the bundle.
- **Removing Guava too eagerly** — if other code still imports `com.google.common.collect/base`, keep the dependency and add Caffeine alongside.
- **`getUnchecked` left in place** — Caffeine has no `getUnchecked`; `LoadingCache.get(key)` already throws unchecked.
- **`Callable` vs `Function`** — `cache.get(key, …)` takes a `Function<K,V>` in Caffeine, not a `Callable<V>`.

## Recipe

Read [recipe.md](recipe.md) in full before editing: input contract, the C1/C2/C3 edits, the API mapping table, unlocatable / skip reasons, before/after examples, and test generation.

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff and the suggested commit message.
