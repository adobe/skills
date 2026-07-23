# remove-deprecated-api

Migrates AEM projects away from deprecated and removed APIs to comply with AEM as a
Cloud Service enforcement requirements. **Detection is two-phase and dynamic**: a
preflight step runs the AEM Analyser Maven Plugin against the project and writes a
rules cache; the shared code-assessment analyzer then consumes that cache. No
hardcoded rule tables — the deprecation set is refreshed on every run.

## How it works

| Phase | What happens |
|---|---|
| Preflight | `scripts/detect.sh` upgrades or injects `aemanalyser-maven-plugin` (latest release) in the project's root `pom.xml`, runs `mvn verify`, and parses `Usage of deprecated ... found : <pkg> : <hint>` lines from the log. Writes a rules TSV to `$AEM_DEPRECATED_API_RULES` (or the default `$TMPDIR/aem-code-assessment/deprecated-api-rules.tsv`). Restores `pom.xml` on exit. |
| Analyzer | `scripts/analyze.sh` runs the shared Java analyzer. `RemoveDeprecatedApi` reads the rules TSV and matches every rule against `import` statements in the workspace's Java corpus, emitting findings in the standard shape with a `hint` field carrying the analyser's deprecation message. |
| Fix | The recipe parses each finding's `hint` for a successor phrase (*"Please use X instead"*, *"X should be used"*, …); when the hint names no successor, it consults Adobe Experience League. Successors are verified on the module's classpath before any edit. |
| Verify | The preflight is re-run at the end — a clean analyser log confirms every past-due deprecation was fixed. |

Because the rule set is fetched fresh on every preflight, there is nothing to
maintain and nothing to drift. Future-dated deprecations are picked up automatically
on subsequent runs after their removal date passes.

## Structure

```
remove-deprecated-api/
├── SKILL.md             ← skill entry point and description
├── README.md            ← this file
├── recipe.md            ← step-by-step execution procedure
└── scripts/
    └── detect.sh        ← preflight: plugin runner + log parser + rules TSV writer
```

The Java detector itself lives with the shared analyzer at
`../scripts/analyzer/detectors/RemoveDeprecatedApi.java`.

## Requirements

- Apache Maven 3.x or newer with a supported JVM (for the preflight; other patterns
  in code-assessment only need a JDK).
