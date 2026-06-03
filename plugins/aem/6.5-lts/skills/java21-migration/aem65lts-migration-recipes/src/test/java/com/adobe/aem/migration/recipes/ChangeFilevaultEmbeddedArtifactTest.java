package com.adobe.aem.migration.recipes;

import org.junit.jupiter.api.Test;
import org.openrewrite.test.RecipeSpec;
import org.openrewrite.test.RewriteTest;

import static org.openrewrite.maven.Assertions.pomXml;

class ChangeFilevaultEmbeddedArtifactTest implements RewriteTest {

    @Override
    public void defaults(RecipeSpec spec) {
        spec.recipe(new ChangeFilevaultEmbeddedArtifact(
                "com.icfolson.aem*",
                "aem-groovy-console*",
                "be.orbinson.aem",
                null
        ));
    }

    @Test
    void migratesGroovyConsoleEmbeddedGroupId() {
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
                        + "              <groupId>com.icfolson.aem.groovy.console</groupId>\n"
                        + "              <artifactId>aem-groovy-console-bundle</artifactId>\n"
                        + "              <target>/apps/install</target>\n"
                        + "            </embedded>\n"
                        + "          </embeddeds>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n",
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

    @Test
    void doesNotMigrateNonMatchingArtifact() {
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
                        + "              <groupId>com.icfolson.aem.groovy.console</groupId>\n"
                        + "              <artifactId>some-other-bundle</artifactId>\n"
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

    @Test
    void doesNotMigrateOtherPlugins() {
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
                        + "        <groupId>org.apache.maven.plugins</groupId>\n"
                        + "        <artifactId>maven-jar-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <embeddeds>\n"
                        + "            <embedded>\n"
                        + "              <groupId>com.icfolson.aem.groovy.console</groupId>\n"
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

    @Test
    void migratesOnlyMatchingEmbeddedInMixedList() {
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
                        + "              <groupId>com.icfolson.aem.groovy.console</groupId>\n"
                        + "              <artifactId>aem-groovy-console-bundle</artifactId>\n"
                        + "              <target>/apps/install</target>\n"
                        + "            </embedded>\n"
                        + "            <embedded>\n"
                        + "              <groupId>com.example.other</groupId>\n"
                        + "              <artifactId>other-bundle</artifactId>\n"
                        + "              <target>/apps/install</target>\n"
                        + "            </embedded>\n"
                        + "          </embeddeds>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n",
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
                        + "            <embedded>\n"
                        + "              <groupId>com.example.other</groupId>\n"
                        + "              <artifactId>other-bundle</artifactId>\n"
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

    @Test
    void preservesOtherChildElements() {
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
                        + "              <groupId>com.icfolson.aem.groovy.console</groupId>\n"
                        + "              <artifactId>aem-groovy-console-bundle</artifactId>\n"
                        + "              <target>/apps/groovyconsole/install</target>\n"
                        + "              <filter>true</filter>\n"
                        + "            </embedded>\n"
                        + "          </embeddeds>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n",
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
                        + "              <target>/apps/groovyconsole/install</target>\n"
                        + "              <filter>true</filter>\n"
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
