# Prerequisites and platform boundary

Use a disposable, clean Git checkout of an **AEM as a Cloud Service Maven project**
with a declared `com.adobe.aem:aem-sdk-api` dependency. Legacy AEM/AMS, Gradle,
non-AEM Java, Kotlin migrations, and platform/API namespace conversion are outside
the initial scope. The helper stops on unresolved compiler versions; inspect the
effective POM when an external parent, profile, Maven toolchain, or CLI property
controls compilation. Do not infer the effective compiler solely from a POM scan.

Required: Python 3.10+, Git, Maven (use the project's supported Maven version),
the source JDK, a JDK 17+ OpenRewrite runtime, and repository access. Use only
approved Maven repositories and existing user settings; never copy credentials
into fixtures, logs, commands, or reports. Maven projects/plugins execute code:
review the project and `.mvn/` configuration before approving execution.

The runner verifies `java -version` and requires both `bin/java` and `bin/javac`.
Configure homes with `--source-jdk`, `--target-jdk`, `--rewrite-jdk`, or
`JAVA8_HOME`, `JAVA11_HOME`, `JAVA17_HOME`, `JAVA21_HOME`, `JAVA25_HOME` (also
`JDK<version>_HOME`). Discovery also checks `JAVA_HOME`, resolved PATH Java,
macOS `/usr/libexec/java_home`, or Linux `/usr/lib/jvm` and `/usr/java`.
It does not scan the home directory. Windows discovery is not implemented.

Missing source JDK is a hard stop, even if a newer JDK could compile the project.
If JDK 25 is absent, source/recipe/POM edits may still be evaluated with a verified
parsing runtime, but target builds and Mockito are skipped. Do not substitute a
different JDK and label target validation passed. Verify the Java and Maven
versions in the per-stage logs; inspect toolchains separately.

## Adobe support gate (checked 2026-11-05)

[Cloud Manager build environment](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/create-application-project/build-environment-details)
documents `.cloudmanager/java-version` values **17 or 21**, says any other value
is ignored, and describes Java 25 runtime rollout as upcoming. The page documents
Java 21 SDK support, not a supported Java 25 end-to-end migration.

Consequently target 25 is **evaluation-only**. The `--evaluation` acknowledgement
is required even for preflight. The generated `25` selector is only a proposed
evaluation artifact; do not submit it to a pipeline under the assumption it selects
Java 25. Recheck the official documentation before any release decision.

SDK, analyser, bundle resolution, component activation, and runtime requests must
be validated on an explicitly supported platform before production claims.
The runner does not modify bnd execution-environment requirements, choose an SDK
version, or force Byte Buddy experimental mode. No local or pipeline success can
replace those checks. Obtain separate user approval before any deployment or
credentialed external validation.

## External tooling licenses

The skill contains original wrappers, not redistributed upstream recipe bodies.
The downloaded `rewrite-migrate-java:3.40.0` and
`rewrite-testing-frameworks:3.40.0` POMs declare the
[Moderne Source Available License](https://docs.moderne.io/licensing/moderne-source-available-license).
Review applicability and obtain the user's acceptance before execution.
`rewrite-maven-plugin:6.45.0` declares Apache-2.0. This skill's Apache-2.0 license
does not grant additional rights in separately downloaded tools or recipes.
