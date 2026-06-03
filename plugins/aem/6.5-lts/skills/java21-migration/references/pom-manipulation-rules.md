# POM Manipulation Rules

The migration tool applies targeted POM transformations that stock OpenRewrite
recipes do not cover. All transformations are implemented as **AST-based
[OpenRewrite](https://docs.openrewrite.org/) recipes**, not text-substitution scripts. This means:

- Original POM formatting, comments, and indentation are preserved by construction
- Transformations are idempotent (re-running produces the same result)
- Edits are deterministic (no LLM, no regex fragility)

Custom recipes are defined in the `aem65lts-migration-recipes` Maven module and
invoked from the composite recipe `aem.lts.migration.UpgradeMavenPluginConfigurations`
inside `65LTSUpgrade.yaml`.

## Custom Recipes

### `ChangeFilevaultEmbeddedArtifact`

Updates `<embedded>` artefact coordinates inside the
`filevault-package-maven-plugin` configuration. Targets the Groovy Console
artefact whose project moved to the `be.orbinson.aem` groupId.

| Option | Required | Example | Purpose |
|--------|----------|---------|---------|
| `oldGroupId` | yes | `com.icfolson.aem*` | Glob pattern matching the current groupId |
| `oldArtifactId` | yes | `aem-groovy-console*` | Glob pattern matching the current artifactId |
| `newGroupId` | yes | `be.orbinson.aem` | Replacement groupId |
| `newArtifactId` | no | `aem-groovy-console` | Replacement artifactId (omit to keep original) |

The visitor walks each `<plugin>` element, verifies its `<artifactId>` is
`filevault-package-maven-plugin`, then navigates `configuration > embeddeds >
embedded` and applies `ChangeTagValueVisitor` for each matched child tag.

### `RemoveBndPluginInstruction`

Removes `<_plugin>` instruction elements from `maven-bundle-plugin`
configuration that match a text pattern. Used to remove `SCRDescriptorBndPlugin`
which is incompatible with Java 21 and BND 6.x.

| Option | Required | Example |
|--------|----------|---------|
| `instructionPattern` | yes | `SCRDescriptorBndPlugin` |

The visitor walks each `<_plugin>` tag, verifies it sits inside a
`maven-bundle-plugin > configuration > instructions` ancestor chain, then
schedules `RemoveContentVisitor` if the tag content matches the pattern.

### `RevertJakartaInAemSource`

Java source-code safeguard. AEM 6.5 LTS uses the `javax` namespace; `jakarta`
annotations compile but fail silently at runtime (e.g. `@PostConstruct` methods
are never called). If any upstream recipe inadvertently introduces a jakarta
import, this recipe restores the javax equivalent.

Detection rule: a file is treated as AEM source if it imports any of
`com.adobe.*`, `org.apache.sling.*`, `com.day.cq.*`, `org.apache.jackrabbit.*`,
or `org.apache.felix.*`.

Reverted mappings:

| Jakarta import | Javax replacement |
|----------------|-------------------|
| `jakarta.annotation.*` | `javax.annotation.*` |
| `jakarta.inject.*` | `javax.inject.*` |
| `jakarta.servlet.*` | `javax.servlet.*` |
| `jakarta.jcr.*` | `javax.jcr.*` |
| `jakarta.json.*` | `javax.json.*` |

This recipe is included in `UpgradeMavenPluginConfigurations` as a safeguard
and is also enforced by the `aem-migrate verify` command.

### `DetectUnsupportedPackages`

Read-only scanning recipe used by `aem-migrate analyze`. Marks each import
finding with an OpenRewrite `SearchResult` so the analyser can report blockers
and warnings without modifying source code.

**BLOCKER patterns** (migration cannot proceed):

| Pattern | Reason |
|---------|--------|
| `com.adobe.cq.commerce.*` | AEM Commerce — requires separate migration |
| `com.adobe.cq.social.*` | AEM Communities — removed |
| `com.adobe.granite.social.*` | Granite Social framework — removed |
| `com.adobe.cq.screens.*` | AEM Screens — separate migration path |
| `com.adobe.cq.sample.we.retail.*` | Sample code — should be removed before migration |
| `com.day.cq.dam.pim.*` | DAM PIM — deprecated |
| `com.day.cq.dam.rating.*` | DAM rating — deprecated |
| `com.adobe.cq.searchpromote.*` | Search & Promote — discontinued |
| `com.adobe.cq.mcm.campaign.*` | MCM Campaign — discontinued |

**WARNING patterns** (migration can proceed but remediation needed):

| Pattern | Reason | Remediation |
|---------|--------|-------------|
| `com.google.common.*` | Guava removed from AEM 6.5 LTS runtime | See `removed-bundles-remediation.md` |
| `com.github.benmanes.caffeine.*` | Caffeine not deployed | Embed or refactor |
| `org.eclipse.jetty.*` | Jetty not exported | Use Servlet API abstractions |
| `org.apache.commons.collections.*` (not `.collections4.*`) | Commons Collections 3 deprecated | Migrate to Collections 4 |

## Why Custom Recipes Instead of Text Manipulation?

Earlier prototypes used text-substitution scripts to manipulate POM files.
That approach has well-known failure modes. See [Maven plugin development documentation](https://maven.apache.org/plugin-developers/index.html) and [OpenRewrite visitor API docs](https://docs.openrewrite.org/concepts-explanations/visitors) for background on the AST approach:

- **Formatting drift**: text substitution must guess at whitespace
- **Ordering assumptions**: `<groupId>` may appear before or after `<artifactId>`
- **Property indirection**: a `<version>` may be a literal or `${prop.name}`
- **Profile scoping**: the same plugin may appear in multiple `<profile>` blocks
- **Comments and CDATA**: regex matches inside comments cause false positives
- **Re-run safety**: text substitution is not idempotent in the general case

OpenRewrite recipes solve all of these by operating on the parsed XML LST
(Lossless Semantic Tree), so transformations are structurally aware while
formatting is preserved.

---

## References

- [OpenRewrite documentation](https://docs.openrewrite.org/)
- [OpenRewrite visitor API](https://docs.openrewrite.org/concepts-explanations/visitors)
- [rewrite-migrate-java recipes](https://docs.openrewrite.org/recipes/java/migrate)
- [Maven plugin development guide](https://maven.apache.org/plugin-developers/index.html)
- [Upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
