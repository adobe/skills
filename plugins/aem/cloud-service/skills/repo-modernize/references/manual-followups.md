# Manual follow-ups

**Agent:** These are things the skill deliberately **detects and reports** rather than transforms —
either because the fix requires human/semantic judgment, or because the right owner is a different tool
entirely. Surface every item below as a finding in the Stage 8 report with a clear next action; never
silently skip them, and never attempt to auto-resolve them in `refactor_poms.py` or elsewhere. This list is
scoped by `references/transform-rules.md` — read that first for what *is* transformed automatically.

## 1. Felix `maven-bundle-plugin` / `maven-scr-plugin` → BND

The archetype-56 template's bundle module builds with the modern `biz.aQute.bnd:bnd-maven-plugin` +
`biz.aQute.bnd:bnd-baseline-maven-plugin` (verified in `template_archetype_56/core/pom.xml`). Legacy AEM
projects commonly still use the older Felix tandem, `org.apache.felix:maven-scr-plugin` +
`org.apache.felix:maven-bundle-plugin`.

The POM-merge step copies plugin elements from the customer's bundle pom into the modernized one — it does
**not** know these two plugin pairs are mutually-exclusive alternatives for the same job (turning
`@Component`/OSGi annotations + manifest headers into a working bundle jar). Left alone, the merge produces
a pom with **both** plugin pairs configured, which is at best redundant and at worst produces conflicting
bundle manifests.

**Fixture:** `core/pom.xml` (and `bundle2/pom.xml`) declare exactly this legacy pair, with real
`Import-Package`, `Sling-Model-Packages`, and `Sling-Namespaces` instructions inside `maven-bundle-plugin`'s
`<instructions>` block. This will trigger the merge on this fixture. (`Export-Package` is a real
instruction elsewhere in this fixture — `docx4j11-dependencies` declares it — just not in `core`/`bundle2`.)

**Action:** flag the module. A human needs to port the Felix `<instructions>` content (`Import-Package`,
`Export-Package`, `Sling-Model-Packages`, `Sling-Namespaces`, `Embed-Dependency`, etc.) into the archetype's
`bnd-maven-plugin` `<bnd>` block, then remove the legacy `maven-scr-plugin`/`maven-bundle-plugin` entries
that the merge carried over. Do not attempt this rewrite mechanically — bnd and the Felix SCR/bundle-plugin
instruction dialects are not a 1:1 syntax mapping.

**Implemented (Phase 2):** `scripts/refactor_poms.py`'s `refactor_bundle_pom` detects this pair
automatically (matched by artifactId alone: `maven-scr-plugin`/`maven-bundle-plugin`, walked across the
whole pom including any `<profile>`) and raises finding `RM-902` (HIGH) instead of touching the
plugins — see `references/transform-rules.md` §11–§12. The plugins are left exactly as-is; nothing here
is auto-removed or auto-ported. Stage 8 of the skill's workflow (`SKILL.md`) surfaces `RM-902` as the
hand-off to a human / the `code-assessment` skill.

## 2. Third-party JARs — local `repository/` scaffold, not an automatic fetch

For every dependency flagged `RM-101` (see `transform-rules.md` §8), the skill scaffolds a local Maven
repository under `repository/` in the reactor root and adds a
`<repository id="project.local" url="file:${maven.multiModuleProjectDirectory}/repository"/>` to the parent
pom — but it does **not** download, copy, or `mvn install` the actual jar into that folder. The build will
fail to resolve the artifact until a human puts it there (or decides the dependency should really come from
a normal remote repository instead).

**Fixture — two distinct cases:**
- **`mbassador`** (`net.engio:mbassador:1.3.2`): declared as a direct dependency **and** a direct
  `<embedded>` in the legacy `all/pom.xml`. This is exactly what `RM-101` is designed to catch, and both
  the dependency and the embed carry into the modernized `all` (§7 of `transform-rules.md`). Action: obtain
  `mbassador-1.3.2.jar` and place it under `repository/`, *or* confirm it's really resolvable from a normal
  repo (it is published on Maven Central) and drop the local-repo scaffold in favor of a normal dependency.
- **`docx4j11-dependencies`**: this whole module has **no `src/` directory** — it exists purely to
  `Embed-Dependency` a pile of third-party jars (`com.thedeanda:lorem`, `net.arnx:wmf2svg`,
  `org.apache.httpcomponents:httpclient`/`httpcore`, `org.docx4j.org.apache:xalan-serializer`,
  `org.antlr:stringtemplate`, `org.docx4j:docx4j-ImportXHTML`/`xhtmlrenderer`,
  `org.eclipse.birt.runtime.3_7_1:com.lowagie.text`) into one OSGi wrapper bundle. Because it has no `src/`,
  it is classified as a **wrapper bundle**, which falls through into "miscellaneous modules" rather than
  "bundle" — it's copied and re-parented verbatim, but it is **outside** the `RM-101` scan scope (bundles +
  `ui.apps` + `all`). None of its embedded third-party jars get flagged automatically. Action: manually
  review every miscellaneous/wrapper module's dependencies for third-party jars the automated scan can't
  see — `docx4j11-dependencies` is exactly this case, and needs the same `repository/` treatment as
  `mbassador` even though no `RM-101` finding will point at it.

## 3. Dispatcher — detect and report only

Dispatcher configuration conversion (AMS/on-prem `httpd.conf`-flavored config → the AEM as a Cloud Service
Dispatcher SDK layout) is **out of scope** for this skill. If a `dispatcher/` module is present, report its
location and move on — do not edit its contents.

**Fixture:** `dispatcher/src/conf.d/rewrites/wknd_rewrite.rules`,
`dispatcher/src/conf.d/enabled_vhosts/wknd_publish.vhost`,
`dispatcher/src/conf.d/available_vhosts/wknd_publish.vhost` are present and untouched by this skill.

**Action:** no hand-off target is formally wired from this skill today. If the customer needs the
dispatcher config itself converted/validated for Cloud Service, that's a job for the AEM Dispatcher domain
skill (`aem-cloud-service:dispatcher`) as a separate, explicit step — not something `repo-modernize` triggers
automatically.

## 4. Oak index definitions — detect and report, hand off to `index-converter`

Index definitions under `/oak:index` are mechanically routed like any other immutable content (§1 of
`transform-rules.md` — top-level folder `_oak_index` → `ui.apps`), and their filter roots correctly drive
`allowIndexDefinitions` on `ui.apps.structure` (§4). What this skill does **not** do is evaluate whether the
index *definitions themselves* are Cloud-Service-compatible (Oak index conversion — property types, sizing,
Lucene vs. elastic, etc., is its own, separate concern with its own tool, `index-converter`, per the
skill's design spec).

**Fixture:** `oak-indexes/src/main/content/jcr_root/_oak_index/` with filter roots
`/oak:index/damAssetLucene` and `/oak:index/wkndId` — these move correctly, but their index *definitions*
are only detected and reported, never inspected for correctness.

**Action:** report the presence and location of moved index definitions; hand off the actual
definition-level review/conversion to `index-converter`. Do not attempt to validate or rewrite index
definition content in this skill.

See also §7 below — a THIRD `oak:QueryIndexDefinition` node in the same fixture directory
(`wkndTerminationDate`) has no filter root at all, which is a distinct, more acute problem than
"unreviewed index definition correctness": it makes the modernized `ui.apps` package fail to build.

## 7. `oak:index` filter/content coverage gap — detect and hand off, never auto-add the filter root

**What it is.** A source content package's `_oak_index/.content.xml` can define more
`oak:QueryIndexDefinition` nodes than its own `filter.xml` declares `/oak:index/<name>` filter roots
for. `split_filters` (`transform-rules.md` §2) faithfully **copies** a source package's declared filter
roots — it does not enumerate the content that will land under them — so an uncovered index node
survives the mechanical restructuring unchanged and lands, still uncovered, in the modernized `ui.apps`
(index content is immutable, always routed there — §1).

**Fixture:** `oak-indexes/src/main/content/jcr_root/_oak_index/.content.xml` defines THREE
`oak:QueryIndexDefinition` nodes — `damAssetLucene`, `wkndId`, `wkndTerminationDate` — but
`oak-indexes/src/main/content/META-INF/vault/filter.xml` declares filter roots for only the first two.
`wkndTerminationDate` has no filter root anywhere in the legacy project.

**Why FileVault surfaces this and the legacy plugin never did.** The legacy `content-package-maven-plugin`
never validated that every piece of packaged content is covered by a filter root. The archetype's
`org.apache.jackrabbit:filevault-package-maven-plugin` runs FileVault's `jackrabbit-filter` validator by
default, which DOES enforce this — reproduced against the real wknd fixture once the modernized `ui.apps`
package actually builds:
```
[ERROR] ValidationViolation: Node '/oak:index/wkndTerminationDate' is not contained in any of the filter
rules @ src/main/content/jcr_root/_oak_index/.content.xml, line 235, column 25, validator:
jackrabbit-filter, JCR node path: /oak:index/wkndTerminationDate
[ERROR] Failed to execute goal org.apache.jackrabbit:filevault-package-maven-plugin:1.4.0:validate-files
(default-validate-files) on project aem-guides-wknd.ui.apps: Found 1 violation(s) (with severity=ERROR).
```

**RULING (authoritative — do not relitigate):** this is a **pre-existing customer-data inconsistency**,
not a tool transform gap. The reference CAM tool copies filters verbatim too
(`cam-repo-modernizer-analysis.md:174`) — it would propagate the identical gap. Inventing the missing
filter root would be a content-deployment decision this skill must not make on the developer's behalf.
So the skill **detects and reports only** — see `RM-905` (`transform-rules.md` §12, raised by
`inspect_project.py`'s `find_oak_index_filter_gaps`) — and never auto-adds the filter root anywhere in
the pipeline (`split_content.py`'s `split_filters` keeps copying source filter roots verbatim, exactly
as it does for every other filter root).

**Two valid resolutions** (both require human/content judgment, not a mechanical rewrite):
1. Add the missing filter root to the source `filter.xml` (e.g. `<filter root="/oak:index/
   wkndTerminationDate"/>`) — the usual fix, if the index definition is actually meant to ship.
2. Remove the stray `oak:QueryIndexDefinition` node from `_oak_index/.content.xml` — if the index was
   abandoned/superseded and should never have shipped.

**AEMaaCS custom-index naming caveat.** Cloud Service convention names customer-authored index overrides
`<indexName>-custom-<N>` (e.g. `damAssetLucene-custom-2`) so they survive OOTB index upgrades. When
resolving this finding, review whether `wkndTerminationDate` (a wholly custom index, not an OOTB override)
needs renaming under that convention, or whether it is fine as-is (custom-index naming is really about
not colliding with product-shipped index names on upgrade, which only matters for indexes that OVERRIDE
an OOTB one, like `damAssetLucene`).

**Action:** `RM-905` is a HIGH finding, surfaced in Stage 8's report (`SKILL.md`) as a hand-off to a human
/ the `code-assessment` skill, parallel to `RM-902` (Felix→BND) and the legacy-core compile break (§6).
The tool flags it but does not auto-resolve it, matching CAM's own copy-filters-verbatim contract.

## 5. Version-drift review after POM merges

The merge step (bundle POM dependency/plugin/profile merging into the modernized bundle poms) de-dups on
**`groupId`+`artifactId` only** — version is excluded from the equality key. When both the source and
destination declare a version for the same `groupId:artifactId`, the higher one (compared via Maven's
`ComparableVersion`, not string/lexical order) wins; if only one side declares a version, the existing
(destination/archetype) value is kept. This is a deliberate, sensible default — it is **not** in the bugs
list (§9 of `transform-rules.md`) — but "higher version wins" is a syntactic rule, not a semantic one: it
has no idea whether the winning version is actually API-compatible with the code that was written against
the losing one.

**Where this bites hardest:** the archetype pins its own dependency versions (e.g. `aem.sdk.api`,
`core.wcm.components.version`, `aemanalyser.version` in the parent's `<properties>`/`<dependencyManagement>`)
independently of whatever the legacy project's bundles assumed. A merge can silently move a bundle onto a
materially different version of a shared dependency than the one it was last built and tested against.

**Action:** after POM refactoring, diff every dependency version that changed as a result of the merge
(not just ones a build error surfaces) and have a human confirm the winning version is actually intended —
don't rely solely on `mvn compile` succeeding, since a version bump can be behaviorally incompatible without
being a compile error.

## 6. Java breakage from the `uber-jar` → `aem-sdk-api` swap — hand off to `code-assessment`

Dropping `com.adobe.aem:uber-jar` and relying on the archetype's pre-seeded `aem-sdk-api` (§6 of
`transform-rules.md`) is a **pinned-version swap**, not an API-compatible one: `uber-jar` had no fixed
relationship to any particular Cloud SDK release, and the archetype's `aem-sdk-api` is pinned to whatever
version ships with the current archetype. Code written against `uber-jar` APIs can fail to compile against
that pinned `aem-sdk-api` surface — removed/renamed classes, changed method signatures, deprecated-and-removed
APIs.

**Fixture:** `core/pom.xml` depends on `com.adobe.aem:uber-jar` directly; this is dropped, and
`template_archetype_56/core/pom.xml`'s bare `aem-sdk-api` dependency (inheriting `scope=provided` and
`version=${aem.sdk.api}` from the parent's `<dependencyManagement>`) takes its place.

**Action:** this skill's job ends at making the swap and reporting that it happened. Any resulting compile
failures are Java-code-level fixes, not repository-structure fixes — hand off to `code-assessment` for
triage and resolution rather than attempting to patch call sites here.

**Implemented (Phase 2): this is exactly what Stage 7's `verify.py` is built to distinguish from a real
Phase-2 failure.** After the structural gate passes, `verify.py --mvn` runs `mvn` and parses the log: if
the *only* problem is a Java compile failure attributable to a specific module (`COMPILATION ERROR` in
the log, with a module name recovered from Maven's own `on project X: Compilation failure` / `-rf :X` /
reactor-summary `FAILURE` / last `Building X` line) and there are **no** aem-analyser `ERROR`-level
findings, `verify.py` exits `0` and prints a verdict naming that module as a `code-assessment` hand-off —
the restructuring itself is treated as correct. This is the expected outcome on a legacy project like the
`aem-guides-wknd-legacy` fixture, where `core` depends directly on `com.adobe.aem:uber-jar` (§6 of
`transform-rules.md`) and is expected not to compile cleanly against the archetype's pinned
`aem-sdk-api` without code changes. It is **not** treated as a `repo-modernize` failure. Only a genuine
aem-analyser `ERROR`-level finding (exit `3`) is — see `SKILL.md` Stage 7.

## Phase-2.5 backlog (not yet fixed — tracked here so it isn't lost)

- **MINOR-2 — reactor `<configuration>` indentation non-idempotency in `ensure_plugin`'s ADD vs. UPSERT
  paths.** `pom_engine.ensure_plugin` shapes a freshly-inserted `<plugin>`'s `<configuration>` block
  differently on the ADD path (a brand-new `<plugin>`, indentation cloned via `pretty_insert`) than on
  the UPSERT path (an existing `<plugin>` whose `<configuration>` is replaced in place) — running the
  same refactor a second time on its own output does not reproduce byte-identical indentation, even
  though both outputs are content-identical, valid POM XML that builds correctly. Documented and
  accepted as-is for Phase 2 (no functional impact); left as a Phase-2.5 cleanup rather than risking a
  load-bearing `pom_engine`/`ensure_plugin` change under this wave's low-risk-minors scope.
