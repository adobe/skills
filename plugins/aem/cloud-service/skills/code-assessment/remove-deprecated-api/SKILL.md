---
name: remove-deprecated-api
description: |
  [BETA] AEM Cloud Service expert skill — migrate deprecated and removed Java imports, Maven
  dependencies, and unmodifiable OSGi configs to comply with AEM as a Cloud Service enforcement
  policies. Use when auditing deprecated APIs, fixing Cloud Manager pipeline failures due to
  deprecated API usage ("api-regions-check", "Import-Package" violations), or proactively
  modernizing AEM projects before enforcement deadlines. Covers log4j migration, commons-lang /
  commons-collections v2→v3 upgrades, Guava removal, import replacements (org.eclipse.jetty,
  com.mongodb, ch.qos.logback, com.drew, etc.), Maven dependency cleanup, and removal of
  unmodifiable OSGi PID configurations.
  This skill is in beta. Verify all outputs before applying them to production projects.
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# Remove Deprecated API — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

AEM as a Cloud Service enforces a list of deprecated and removed Java packages, Maven artifacts,
and OSGi PID configurations via the Build Analyzer Maven Plugin. Code that imports
these packages, declares the removed dependencies, or ships the unmodifiable PIDs fails Cloud
Manager code-quality pipelines. This pattern scans the workspace for all three violation
categories and remediates them with direct LLM-applied edits using the replacement mappings in
`recipe.md`, followed by an AI-assisted build-error fix loop for anything that needs compilation
fixes after the import/dep changes.

## Classification — confirm this pattern applies

- A `*.java` file importing a package in the deprecated/removed API list (e.g. `org.apache.log4j`,
  `com.google.common`, `org.apache.commons.lang`, `org.eclipse.jetty`, `ch.qos.logback`, etc.)
- A `pom.xml` declaring a Maven dependency on a deprecated artifact (e.g. `logback`, `log4j`,
  `guava`, `mongo-java-driver`, `abdera`)
- An OSGi config file (`.cfg`, `.cfg.json`, `.config`) declaring a PID that AEM CS
  marks as unmodifiable (e.g. `org.apache.sling.commons.log.LogManager`)
- Cloud Manager code-quality pipeline failures citing `api-regions-check`, `Import-Package`,
  or `bundle-unversioned-packages` violations for these APIs

Only APIs whose enforcement deadline is ≤ today are in scope — future-deadline APIs are detected
but skipped.

## Discovery

Run the bundled analyzer from the repo root:

```bash
bash plugins/aem/cloud-service/skills/code-assessment/scripts/analyze.sh <root> --pattern remove-deprecated-api
```

The detector checks Java import statements against deprecated package prefixes, Maven `<dependency>` entries against deprecated coordinates, and OSGi config filenames (`.cfg`, `.cfg.json`, `.config`) against the unmodifiable PID list. Only rules whose enforcement deadline has already passed are active; future-deadline rules are silently skipped.

**Java imports (already-enforced, always active):**
```
import org.apache.sling.commons.auth
import org.eclipse.jetty.
import com.mongodb.
import org.apache.abdera.
import org.apache.felix.http.whiteboard
import ch.qos.logback.
import org.slf4j.spi.
import org.slf4j.event.
import org.apache.log4j.
import com.google.common.
import org.apache.cocoon.xml.
import org.apache.felix.webconsole.
import com.drew.
import org.apache.jackrabbit.oak.plugins.memory
```

**Maven dependencies (already-enforced):**
```
logback   log4j   guava   mongo-java-driver   abdera
```

**OSGi config PIDs (already unmodifiable):**
```
org.apache.sling.commons.log.LogManager
org.apache.sling.jcr.davex.impl.servlets.SlingDavExServlet
com.adobe.granite.toggle.impl.dev.DynamicToggleProviderImpl
org.apache.http.proxyconfigurator
com.day.cq.auth.impl.cug.CugSupportImpl
com.day.cq.jcrclustersupport.ClusterStartLevelController
```

Additional import prefixes and Maven artifacts become active once their enforcement date passes;
see the **Enforcement scope** section in [`recipe.md`](recipe.md) for the date-gated groups.

Scope: workspace roots only. Exclude `code-assessment/` skill files.

## Resolution contract

**`self-evident`** — all replacement mappings are embedded in `recipe.md` Step 3 tables. No user-supplied target versions or replacements are required.

**Manual-only items** (cannot be auto-fixed; document in report, do not attempt edits):
- `org.apache.felix.webconsole.*` references — webconsole is unavailable on Cloud Service; requires
  rethinking the admin/debug approach entirely.
- Guava usage that goes beyond simple `Lists.newArrayList()` / `ImmutableList.of()` (caching,
  event bus, complex data structures) — replacement requires design decisions.

## Review checklist

- [ ] Enforcement scope determined (get today's date; only fix APIs with deadline ≤ today)
- [ ] Analyzer scan complete; findings cover all three categories (imports, deps, OSGi)
- [ ] Initial build passed before any transformations (`mvn compile`)
- [ ] Step 3 edits applied: import rewrites, dependency changes, OSGi config deletions
- [ ] Post-edit build checked; compilation errors routed to AI-fix phase
- [ ] Each AI-assisted fix marked with `// Fixed by AEM Modernizer AI` above the change
- [ ] Final build passes (`mvn compile`)
- [ ] Build Analyzer Maven Plugin run (`aemanalyser-maven-plugin`) to catch OSGi wiring issues
- [ ] Manual-action items (webconsole, deep Guava) documented in the report
- [ ] No future-deadline APIs modified or removed

## Troubleshooting fingerprints

| Symptom | Likely cause | Action |
|---|---|---|
| `Import-Package not satisfied` from Build Analyzer | Deprecated import removed but no replacement provided | Check the import mapping table in `recipe.md` Step 3; verify the replacement package is on the bundle's classpath |
| Build error after editing an XSS API import | Replacement class has a different method signature | AI-fix phase — see `Common Fix Patterns` in `recipe.md` |
| Unresolved symbol after replacing a commons-lang import | v2 → v3 method name changed | AI-fix phase — see commons-lang fix patterns in `recipe.md` |
| `aemanalyser-maven-plugin` not in pom.xml | Plugin not yet wired into the project | Add permanently per `recipe.md` Step 6b |

## Recipe pointer

Read [`recipe.md`](recipe.md) fully before applying. The recipe covers the input contract,
per-category locators and replacement mappings, skip / unlocatable reasons, common AI-fix patterns,
before/after examples, and the complete multi-step execution procedure (initial build → LLM edits →
post-edit build → AI-fix loop → final build → Build Analyzer → report).
