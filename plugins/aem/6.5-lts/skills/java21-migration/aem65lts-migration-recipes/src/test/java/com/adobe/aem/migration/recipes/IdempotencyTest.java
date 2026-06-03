package com.adobe.aem.migration.recipes;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.openrewrite.java.JavaParser;
import org.openrewrite.test.RecipeSpec;
import org.openrewrite.test.RewriteTest;
import org.openrewrite.test.TypeValidation;

import static org.openrewrite.java.Assertions.java;
import static org.openrewrite.maven.Assertions.pomXml;

/**
 * Idempotency contract for the four AEM 6.5 LTS custom OpenRewrite recipes.
 *
 * <p>For each recipe, the post-migration output is fed back as the input and the
 * recipe is asserted to produce no further changes. This guarantees:
 *
 * <ul>
 *   <li>A second {@code aem-migrate full-migrate} run against an already-migrated
 *       project leaves the working tree clean ({@code git diff --quiet}).</li>
 *   <li>{@code --dryRun} on a migrated project surfaces an empty diff — the
 *       reviewer-facing contract of the CLI.</li>
 *   <li>Visitor logic is not relying on the order in which the maven-model AST
 *       elements are visited; running twice cannot oscillate the output.</li>
 * </ul>
 *
 * <p>OpenRewrite's {@code rewriteRun} call with a single source string and no
 * after-text asserts that the recipe produces no change for that input — exactly
 * the idempotency invariant.
 */
class IdempotencyTest {

    @Nested
    @DisplayName("ChangeFilevaultEmbeddedArtifact")
    class ChangeFilevaultEmbeddedArtifactIdempotency implements RewriteTest {

        @Override
        public void defaults(RecipeSpec spec) {
            spec.recipe(new ChangeFilevaultEmbeddedArtifact(
                    "com.icfolson.aem*",
                    "aem-groovy-console*",
                    "be.orbinson.aem",
                    null));
        }

        @Test
        @DisplayName("post-migration POM is left untouched on re-run")
        void postMigrationPomIsLeftUntouched() {
            rewriteRun(
                    pomXml(
                            "<project>\n"
                            + "  <modelVersion>4.0.0</modelVersion>\n"
                            + "  <groupId>com.example</groupId>\n"
                            + "  <artifactId>test-content</artifactId>\n"
                            + "  <version>1.0.0</version>\n"
                            + "  <packaging>content-package</packaging>\n"
                            + "  <build>\n"
                            + "    <plugins>\n"
                            + "      <plugin>\n"
                            + "        <groupId>org.apache.jackrabbit</groupId>\n"
                            + "        <artifactId>filevault-package-maven-plugin</artifactId>\n"
                            + "        <configuration>\n"
                            + "          <embeddeds>\n"
                            + "            <embedded>\n"
                            + "              <groupId>be.orbinson.aem</groupId>\n"
                            + "              <artifactId>aem-groovy-console-bundle</artifactId>\n"
                            + "              <target>/apps/install</target>\n"
                            + "            </embedded>\n"
                            + "          </embeddeds>\n"
                            + "        </configuration>\n"
                            + "      </plugin>\n"
                            + "    </plugins>\n"
                            + "  </build>\n"
                            + "</project>\n"
                    )
            );
        }
    }

    @Nested
    @DisplayName("RemoveBndPluginInstruction")
    class RemoveBndPluginInstructionIdempotency implements RewriteTest {

        @Override
        public void defaults(RecipeSpec spec) {
            spec.recipe(new RemoveBndPluginInstruction("SCRDescriptorBndPlugin"));
        }

        @Test
        @DisplayName("POM without the matching <_plugin> is left untouched")
        void pomWithoutMatchingPluginIsLeftUntouched() {
            rewriteRun(
                    pomXml(
                            "<project>\n"
                            + "  <modelVersion>4.0.0</modelVersion>\n"
                            + "  <groupId>com.example</groupId>\n"
                            + "  <artifactId>test-bundle</artifactId>\n"
                            + "  <version>1.0.0</version>\n"
                            + "  <packaging>bundle</packaging>\n"
                            + "  <build>\n"
                            + "    <plugins>\n"
                            + "      <plugin>\n"
                            + "        <groupId>org.apache.felix</groupId>\n"
                            + "        <artifactId>maven-bundle-plugin</artifactId>\n"
                            + "        <configuration>\n"
                            + "          <instructions>\n"
                            + "            <Bundle-SymbolicName>com.example.bundle</Bundle-SymbolicName>\n"
                            + "          </instructions>\n"
                            + "        </configuration>\n"
                            + "      </plugin>\n"
                            + "    </plugins>\n"
                            + "  </build>\n"
                            + "</project>\n"
                    )
            );
        }
    }

    @Nested
    @DisplayName("RevertJakartaInAemSource")
    class RevertJakartaInAemSourceIdempotency implements RewriteTest {

        @Override
        public void defaults(RecipeSpec spec) {
            spec.recipe(new RevertJakartaInAemSource())
                    .parser(JavaParser.fromJavaVersion()
                            .classpath("jakarta.inject-api", "jakarta.annotation-api"))
                    .typeValidationOptions(TypeValidation.none());
        }

        @Test
        @DisplayName("AEM file already on javax is left untouched")
        void aemFileAlreadyOnJavaxIsLeftUntouched() {
            rewriteRun(
                    java(
                            "package com.example;\n"
                            + "\n"
                            + "import org.apache.sling.api.SlingHttpServletRequest;\n"
                            + "\n"
                            + "import javax.annotation.PostConstruct;\n"
                            + "import javax.inject.Inject;\n"
                            + "\n"
                            + "public class MyModel {\n"
                            + "    @Inject\n"
                            + "    private SlingHttpServletRequest request;\n"
                            + "\n"
                            + "    @PostConstruct\n"
                            + "    protected void activate() {\n"
                            + "    }\n"
                            + "}\n"
                    )
            );
        }

        @Test
        @DisplayName("non-AEM file with jakarta imports is left untouched")
        void nonAemFileWithJakartaIsLeftUntouched() {
            rewriteRun(
                    java(
                            "package com.example;\n"
                            + "\n"
                            + "import jakarta.inject.Inject;\n"
                            + "\n"
                            + "public class PlainService {\n"
                            + "    @Inject\n"
                            + "    private String value;\n"
                            + "}\n"
                    )
            );
        }
    }

    @Nested
    @DisplayName("DetectUnsupportedPackages")
    class DetectUnsupportedPackagesIdempotency implements RewriteTest {

        @Override
        public void defaults(RecipeSpec spec) {
            spec.recipe(new DetectUnsupportedPackages())
                    .typeValidationOptions(TypeValidation.none());
        }

        @Test
        @DisplayName("scanner leaves benign sources untouched")
        void scannerLeavesBenignSourcesUntouched() {
            // DetectUnsupportedPackages is a read-only scanner that attaches
            // OpenRewrite SearchResult markers to offending imports. Markers are
            // ephemeral by design — they surface in the analyze report and never
            // persist to the working tree — so the meaningful idempotency
            // contract for this recipe is that a clean source file produces no
            // markers. Marker placement on offending sources is covered by
            // DetectUnsupportedPackagesTest.
            rewriteRun(
                    java(
                            "package com.example;\n"
                            + "\n"
                            + "import org.apache.sling.api.SlingHttpServletRequest;\n"
                            + "\n"
                            + "public class PlainConsumer {\n"
                            + "    private SlingHttpServletRequest request;\n"
                            + "}\n"
                    )
            );
        }
    }
}
