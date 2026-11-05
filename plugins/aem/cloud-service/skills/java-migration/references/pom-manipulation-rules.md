# POM manipulation rules

The standard-library helpers follow declared modules (including profile modules)
inside the selected project, not every POM on disk. They reject DTDs/entities,
malformed XML, unresolved/compound properties used by affected settings, escaping
module paths, and changed-on-disk inputs. All deterministic edits are planned
before any POM is written.

XML byte-offset edits preserve untouched bytes, namespace prefixes, comments,
CDATA, escaping, whitespace, configuration and nested dependency versions. New
elements inherit the parent namespace prefix. No XML pretty-printer rewrites the
document. A second helper run must be byte-identical.

Compiler source/target/release settings and conventional compiler properties are
updated across root, module and profile POMs. Property-backed settings are resolved
through local parent POMs, then localized to literal target values rather than
mutating shared arbitrary properties. Inspect the diff: preserving every original
property indirection is not promised. Unrelated consumers retain their values.

Plugin updates match full coordinates and **direct** plugin version children in
build/pluginManagement, never descendant `version` tags. Existing higher numeric
versions remain. Non-release version expressions require review, not guessing.
Surefire/Failsafe argLine, JaCoCo late evaluation, test includes/excludes,
execution configuration, nested dependencies and append semantics remain intact.
No automatic experimental Byte Buddy flag or bnd JavaSE override is added.

The [plugin config](../configs/plugin-configuration-25.json) pins candidate minimums.
[Dependency rules](../configs/dependency-migration.json) match exact coordinates,
including declared plugin dependencies; unrelated dependencies remain unchanged.
[Classifier rules](../configs/dependency-classifier-migration.json) remove only
the listed legacy JDK classifier from a matching Sling mock artifact/version whose
unclassified publication was checked. Unverified versions stop for manual review;
a resolution failure never falls back to another artifact or skips tests.

FileVault upgrades only declared `org.apache.jackrabbit:filevault-package-maven-plugin`
versions to at least 1.4.0. It preserves package properties, embeds, filters,
validator settings and failure gates. This is a candidate tooling update, not proof
that a package/analyser/runtime supports Java 25. Do not delete custom metadata or
disable validators to get a green build.

Standalone helper usage (only after approval) is
`python3 <installed-skill>/scripts/migrate_plugins.py <project> --target 25`;
`migrate_dependency_versions.py` and `migrate_filevault.py` use the same arguments.
These are transformation primitives, **not** substitutes for the runner's
preflight, approval, JDK, baseline and platform gates.
