---
name: remove-deprecated-api
description: |
  [BETA] AEM Cloud Service expert skill — migrate deprecated and removed Java APIs to
  comply with AEM as a Cloud Service enforcement policies. Detection is **plugin-driven,
  not table-driven**: the skill runs the AEM Analyser Maven Plugin
  (`com.adobe.aem:aemanalyser-maven-plugin`) at its latest published version against the
  project and parses the `region-deprecated-api` output — the same data Cloud Manager's
  pipeline uses. Each finding carries the plugin's own deprecation hint (typically a
  successor package parsed from the analyser message), which drives the fix. Use when
  auditing deprecated APIs, fixing Cloud Manager pipeline failures citing
  `region-deprecated-api` / `api-regions-check` / `Import-Package not satisfied`, or
  proactively modernizing AEM projects before enforcement deadlines.
  This skill is in beta. Verify all outputs before applying them to production projects.
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# Remove Deprecated API — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow
> [`../references/runbook.md`](../references/runbook.md) for the outer flow (preflight →
> plan → apply → verify, run log). This skill supplies the plugin-driven detection and
> the hint-driven fix recipe the runbook applies.

## Overview

Adobe curates the list of deprecated / removed AEM APIs inside the AEM SDK's
`api-regions` metadata; Cloud Manager's `region-deprecated-api` analyser task consumes
that JSON at build time. The **AEM Analyser Maven Plugin**
(`com.adobe.aem:aemanalyser-maven-plugin`) runs the same task locally against the
project's built bundles. This skill uses the plugin as its detection engine — no
curated tables, no static lists, no drift.

For each deprecated package the plugin reports, its log line contains a **hint**: the
`deprecated.msg` field from the SDK metadata, which typically names a successor
package (e.g. *"Please use `org.apache.sling.xss` instead"*). Fixes are derived from
that hint at plan time. When the hint names no successor, the recipe consults the
Adobe **Experience League** API-removal guidance as a documented fallback.

## Network requirement (documented exception)

This pattern is the code-assessment skill's one documented **network-required** pattern:
Maven Central is needed to resolve the plugin (and, transitively, the AEM SDK feature
data the plugin reads); Experience League is used as a fallback source for successor
guidance. If the environment is offline, `detect.sh` fails with a clear message and the
pattern is skipped in the report. All other patterns remain local-only.

## Classification — confirm this pattern applies

- Any `*.java`, `pom.xml`, or OSGi config file the AEM Analyser Maven Plugin reports
  under `region-deprecated-api` (i.e. any `Usage of deprecated ... found` log line
  produced by `mvn verify` against the project).
- Cloud Manager code-quality pipeline failures citing `region-deprecated-api`,
  `api-regions-check`, `Import-Package not satisfied`, or `bundle-unversioned-packages`
  violations.

The plugin only reports **past-due** deprecations by default (entries whose
`for-removal` date has already elapsed). Future-dated deprecations are not touched;
re-running the skill after each removal date passes picks them up automatically — the
list is live.

## Discovery — two-phase

The detector lives in the shared Java analyzer (`scripts/analyzer/detectors/RemoveDeprecatedApi.java`),
same shape as every other pattern's detector — but its rules are **loaded at run time**
from a preflight-produced cache, not hardcoded.

### Phase 1 — preflight (populates the rules cache)

```bash
bash plugins/aem/cloud-service/skills/code-assessment/remove-deprecated-api/scripts/detect.sh <project-root>
```

`detect.sh`:

1. Resolves the latest `com.adobe.aem:aemanalyser-maven-plugin` release from Maven
   Central (`maven-metadata.xml`); can be pinned with `--pin-plugin <version>`.
2. If the project's root `pom.xml` already declares the plugin, upgrades its
   `<version>` in place; otherwise injects a **temporary** `<extensions>true</extensions>`
   plugin block into `<build><plugins>`.
3. Runs `mvn verify` with skips that do not suppress the analyser. Log path:
   `/tmp/aem-analyser.log` (override with `--log <path>`).
4. Parses `Usage of deprecated package found : <pkg> : <hint> Deprecated since <since> For removal : <date>`
   and `Usage of deprecated library found : <lib>, package(s) : <start>...<end> : <hint>` lines.
5. **Writes the rules cache TSV** — `<package>\t<hint>\t<for_removal>` per line — at
   `$AEM_DEPRECATED_API_RULES` (env override) or
   `$TMPDIR/aem-code-assessment/deprecated-api-rules.tsv` (default).
6. **Leaves the plugin wired in.** Both branches persist on disk: an in-place
   `<version>` bump on an already-declared plugin, and a fresh `<plugin>` block when
   the plugin was missing — the analyser is genuinely useful to keep wired in for CI
   and for the final-verification re-run in Step 7 of the recipe. Mid-edit failures
   fall back to a byte-for-byte pre-image restore via the EXIT trap.
7. Emits a JSON summary on stdout (findings + meta) for callers that don't chain
   through `analyze.sh`.

### Phase 2 — analyzer (consumes the cache, emits findings)

```bash
bash plugins/aem/cloud-service/skills/code-assessment/scripts/analyze.sh <workspace-root>
```

The Java `RemoveDeprecatedApi` detector reads the rules TSV, matches each rule's
package against every `import` in the corpus (longest-prefix match), applies today's
past-due gating as a defence-in-depth, and emits findings in the standard
`{pattern,file,line,snippet}` shape with an added `hint` field carrying the analyser
message.

**Findings shape** — the standard runbook shape plus an optional `hint`:

```json
{
  "findings": [
    {
      "pattern": "remove-deprecated-api",
      "file": "core/src/main/java/com/example/MyService.java",
      "line": 5,
      "snippet": "org.apache.log4j.Logger",
      "hint": "The log4j 1.x libraries are deprecated. Please use org.slf4j instead."
    }
  ],
  "warnings": []
}
```

**If the cache is missing** — `detect.sh` was not run, or was run offline and failed —
the detector emits a single warning:

```
deprecated-api-rules-missing: expected TSV at <path> — run remove-deprecated-api/scripts/detect.sh preflight first
```

and produces no findings for this pattern. Other detectors continue unaffected.

Scope: workspace roots only. Exclude `code-assessment/` skill files.

## Resolution contract

**`hint-driven`** — every fix derives from the analyser's `hint` field for that finding.
The recipe (`recipe.md` Step 3) parses the hint for a successor-package phrase
(*"Please use X instead"*, *"Use X instead"*, *"X should be used"*) and applies the
edit. When the hint names no successor, the recipe falls back to Adobe Experience
League's API-removal guidance page via `WebFetch`.

**Verification** — before applying, the successor must be resolvable on the project's
classpath. If it is not, either add the required Maven dependency (with user consent)
or record the finding as manual-action-required.

**Manual-only items** (cannot be auto-fixed; document in report, do not attempt edits):

- Deep integration cases where hint says "not supported in AEM as a Cloud Service"
  with no successor named on Experience League (e.g. `org.apache.felix.webconsole`,
  parts of `com.drew`).
- Guava usage beyond simple `Lists.newArrayList()` / `ImmutableList.of()` — caching,
  event bus, complex data structures — where replacement requires design decisions.
- Reflection or dynamic loading against the deprecated type — the scanner cannot see
  it and the fix is not mechanical.

## Review checklist

- [ ] Latest `aemanalyser-maven-plugin` resolved from Maven Central
- [ ] Initial build passed before any transformations (`mvn compile`)
- [ ] Analyser log parsed; findings carry a non-empty `hint` where the SDK provides one
- [ ] Each finding's successor package (from hint or Experience League) verified on the
      classpath before applying
- [ ] Step 3 edits applied surgically (imports rewritten, deps updated, OSGi configs
      deleted where the plugin reports them as unmodifiable)
- [ ] Post-edit build checked; residual compilation errors routed to AI-fix phase
- [ ] Each AI-assisted fix marked with `// Fixed by AEM Modernizer AI` above the change
- [ ] Final build passes (`mvn verify`) with the plugin still enabled — analyser now
      reports zero past-due deprecations
- [ ] Manual-action items documented in the report

## Troubleshooting fingerprints

| Symptom | Likely cause | Action |
|---|---|---|
| `detect.sh` fails at plugin resolution step | No network to Maven Central | Re-run once network is available, or pass `--pin-plugin <version>` with a cached local version |
| `mvn verify` fails before the analyser runs | Baseline compile failure | Fix the baseline build first (per runbook), then re-run detection |
| Hint is empty for a finding | SDK deprecation message is descriptive only, or the finding came from `library` grouping without a msg | Consult Experience League for the successor; if still absent, record as manual-only |
| `Import-Package not satisfied` on rerun | Successor package not on the module's classpath | Add the required Maven dependency (with user consent) or pick a JDK stdlib alternative |
| Analyser reports a package with no `import` match in-workspace | Deprecated API pulled in transitively by a third-party bundle | Cannot fix in customer code; report as third-party dependency upgrade needed |

## Recipe pointer

Read [`recipe.md`](recipe.md) fully before applying. The recipe covers the plugin
setup + preflight scan, the hint parsing rules, the Experience League fallback flow,
the AI-fix loop for compilation errors introduced by rewrites, and the report format.
