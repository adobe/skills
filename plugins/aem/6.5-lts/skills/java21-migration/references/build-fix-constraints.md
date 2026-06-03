# Build Fix Constraints

Rules the agent MUST follow when fixing a build error that surfaces during a
migration phase. The rules are layered by severity. Higher tiers are
absolute; lower tiers are practices the fix is expected to respect.

The tiers are explicit so reviewers can reason about an agent fix at a
glance: a Tier 0 violation is unrecoverable, a Tier 1 violation is a bug, a
Tier 2 violation is a style regression. The same content is greppable —
`grep -n "^### T" references/build-fix-constraints.md` lists every rule.

---

## Tier 0 — STOP

A Tier 0 hit means the migration cannot complete and the agent must
terminate with a clear report. Do not attempt workarounds, alternatives,
or partial fixes.

### T0.1  Unsupported AEM packages

If any error references one of the following packages, terminate immediately.
These products are not part of the AEM 6.5 LTS surface area and there is no
in-scope remediation.

| Package prefix | Product |
|---|---|
| `com.adobe.cq.commerce.*` | AEM Commerce |
| `com.adobe.cq.social.*` | AEM Communities |
| `com.adobe.granite.social.*` | Granite Social |
| `com.adobe.cq.screens.*` | AEM Screens |
| `com.adobe.cq.sample.we.retail.*` | We.Retail samples |
| `com.day.cq.dam.pim.*` | DAM PIM |
| `com.day.cq.dam.rating.*` | DAM Rating |
| `com.adobe.cq.searchpromote.*` | Search & Promote |
| `com.adobe.cq.mcm.campaign.*` | MCM Campaign |

Termination report template (verbatim, to make downstream parsing reliable):

```
TERMINATE: project depends on unsupported AEM package <pkg> in <file>:<line>.
Migration cannot proceed.
```

Do not add these packages to `pom.xml`. Do not search for replacement
artefacts. Do not comment out the importing class.

### T0.2  Customer-specific dependency cannot be resolved (initial build only)

If the initial build (source JDK, before any recipe runs) fails because a
non-public artefact (private groupId, internal Nexus) cannot be resolved,
terminate. Manual settings.xml triage is out of scope for the agent.

```
TERMINATE: initial build cannot resolve customer-specific artefact <coords>.
Resolve Maven settings before retrying.
```

### T0.3  Public dependency auth failure (initial build only)

`401`/`403` from Maven Central while the requested artefact actually exists
indicates a credential or proxy problem on the host. Terminate.

### T0.4  Infrastructure failure

`Connection refused`, `Unknown host`, or any I/O error that does not name a
specific artefact. Terminate — the agent has no signal to act on.

---

## Tier 1 — Invariants

A Tier 1 hit means the agent's proposed fix would break the migration
contract. The fix is rejected and a new fix is attempted on the next
iteration. Tier 1 violations are bugs in the agent's reasoning, not
acceptable trade-offs.

### T1.1  `javax` stays `javax`

AEM 6.5 LTS exports the `javax.*` namespace. Swapping to `jakarta.*`
compiles successfully but produces a silent runtime no-op — for example, a
`@PostConstruct` callback on a `jakarta.annotation.PostConstruct` method is
never invoked because AEM's Sling Models processor only recognises the
`javax.annotation.PostConstruct` variant.

Forbidden transformations:

- `import javax.*` → `import jakarta.*` in any Java source.
- `<groupId>javax.*</groupId>` → `<groupId>jakarta.*</groupId>` in any POM.
- Replacing `javax.*` annotation processor coordinates in `bnd` or
  `maven-bundle-plugin` configuration.

Affected packages include but are not limited to: `javax.xml.bind`,
`javax.annotation`, `javax.inject`, `javax.servlet`, `javax.ws.rs`,
`javax.persistence`, `javax.mail`, `javax.activation`.

When an upstream OpenRewrite recipe inadvertently introduces a
`jakarta.*` import, the bundled `RevertJakartaInAemSource` custom recipe
will revert it on the next phase. If a manual fix must be applied first,
add the correct `javax.*` dependency to the POM rather than touching the
import.

### T1.2  Enforcer `requireJavaVersion` floor monotonicity

The Maven Enforcer `requireJavaVersion` rule is a build-time gate, not a
runtime constraint. The floor must increase monotonically along the path
`1.8 → 11 → 21`. Lowering the floor is never the correct fix.

| Symptom | Correct fix |
|---|---|
| Build fails on `requireJavaVersion=11` while running JDK 8 | Re-run that phase with `--javaHome $JAVA11_HOME`. |
| Build fails on `requireJavaVersion=21` while running JDK 11 | Re-run that phase with `--javaHome $JAVA21_HOME`. |
| `requireJavaVersion=8` in a migrated module | Raise to `11` or `21`. Do not leave at `8`. |

Also rewrite the rule's `<message>` text to match the new floor — leaving a
`Java 8 required` message attached to a `version=11` rule is a Tier 2
violation.

### T1.3  Removed and non-exported bundles

The packages below are NOT exported by the AEM 6.5 LTS OSGi runtime.
Adding them with `<scope>provided</scope>` (or expecting them from
`uber-jar`) produces a deploy-time resolution failure:

```
osgi.wiring.package; ... Cannot be resolved
```

| Package | Status | Remediation |
|---|---|---|
| `com.google.common.*` (Guava) | Bundle removed | Refactor to JDK collections or embed Guava 33.x |
| `com.github.benmanes.caffeine.*` | Not deployed | Embed Caffeine 2.9.3 (NOT 3.x — needs Java 11 JDK module path) |
| `org.eclipse.jetty.*` | Private inside `org.apache.felix.http.jetty` | Embed `org.apache.felix.http.jetty` 5.1.26 |
| `org.apache.commons.collections.*` (3.x) | Removed | Migrate to `commons-collections4` |

For "embed" remediation, the bundle manifest must explicitly exclude the
embedded package from `Import-Package`:

```xml
<Embed-Dependency>caffeine;inline=true</Embed-Dependency>
<Embed-Transitive>true</Embed-Transitive>
<Import-Package>!com.github.benmanes.caffeine.*,*</Import-Package>
```

Detailed recipes live in `references/removed-bundles-remediation.md`.

### T1.4  POM formatting must be preserved by construction

Every POM transformation in this skill runs through an OpenRewrite recipe.
Text-substitution edits to POMs by the agent are a Tier 1 violation
because they break formatting in ways that subsequent recipe runs cannot
re-normalise — the diff becomes unreviewable.

If the agent reaches a point where no OpenRewrite recipe applies and a POM
edit is mandatory, prefer adding a `<!-- aem-lts-migration: ai-fix -->`
marker on a fresh well-indented block over modifying an existing one.

---

## Tier 2 — Practices

Tier 2 rules describe the shape a correct fix should take. A Tier 2
violation is not rejected automatically but the resulting commit will
look messy in review and the fix counts as low quality.

### T2.1  POM indentation matches surrounding context

When inserting or replacing XML in a POM, count the leading whitespace
of the surrounding context and reuse it exactly. Default 2-space
indentation is the wrong choice for files that use 4-space indentation,
even if it compiles.

### T2.2  JDK selection is a runtime override only

If a phase fails because the wrong JDK is selected, re-invoke the CLI
with `--javaHome` pointing at the correct JDK. Never modify
`<source>`, `<release>`, `<requireJavaVersion>`, or `.cloudmanager/java-version`
to bypass the failure. The selection is per-process and must not be
persisted to the project.

### T2.3  Temporary workarounds are tagged

If a fix is intentionally temporary (for example, a Maven Central
fallback added to make an intermediate build pass while a private
artefact is missing), wrap the change in:

```xml
<!-- MIGRATION_TEMP_START -->
<!-- aem-lts-migration: ai-fix -->
<!-- ... -->
<!-- MIGRATION_TEMP_END -->
```

The `verify` command counts and reports `MIGRATION_TEMP_*` markers. A
non-zero count blocks promotion past the verify step until the
workaround is removed or made permanent.

### T2.4  Change attribution marker is mandatory

Every agent-authored fix carries `// aem-lts-migration: ai-fix` (or the
`<!-- ... -->` variant for XML, `# ...` for shell/YAML). The marker is
deliberately a single kebab-cased token so a `grep -rn
"aem-lts-migration: ai-fix"` over the working tree is a complete audit
trail. The `verify` command counts these and includes the count in its
final report; a non-zero count signals manual intervention occurred.

---

## Tier 3 — Iteration Rules

### T3.1  What the agent CAN fix

- Compilation errors caused by Java API changes between 8/11 and 21.
- Missing imports for relocated JDK classes.
- Replacement of removed JDK APIs with current equivalents.
- Adding a missing dependency to a POM, with `// aem-lts-migration: ai-fix`.
- Tightening type inference where the Java 21 compiler refuses inferred types
  the older compiler accepted.

### T3.2  What the agent MUST NOT modify

- `README.md`, `LICENSE`, `NOTICE`.
- `.gitignore`, `Dockerfile`, `docker-compose.yml`, CI workflow files.
- `settings.xml`, `toolchains.xml` outside of `MIGRATION_TEMP_*` markers.
- Build/deploy shell scripts, infrastructure-as-code.
- Test data files.
- Application business logic.
- Component/template files under `ui.apps` or `ui.content`.
- Sling/OSGi configuration files unless directly required for compilation.

### T3.3  Iteration budget

Each build phase has a budget of 3 fix-and-rerun attempts. The exact
cycle:

1. Run the build command.
2. If exit code = 0 → phase complete; advance.
3. Otherwise, parse the compiler/Maven output.
4. Check Tier 0 conditions — terminate if any hit.
5. Identify the first failing module; resolve its root cause first.
6. Apply the minimal fix that compiles the failing file.
7. Re-run the build.
8. Repeat from step 2, up to 3 total attempts.
9. If still failing after the third attempt, write a phase-failure
   report and stop.

The retry budget is per-phase, not per-error. Three fixes in one phase
that each shift the failure point are still three attempts; the budget
does not regenerate.
