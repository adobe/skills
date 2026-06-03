package com.adobe.aem.migration.recipes;

import org.junit.jupiter.api.Test;
import org.openrewrite.test.RecipeSpec;
import org.openrewrite.test.RewriteTest;

import static org.openrewrite.maven.Assertions.pomXml;

class RemoveBndPluginInstructionTest implements RewriteTest {

    @Override
    public void defaults(RecipeSpec spec) {
        spec.recipe(new RemoveBndPluginInstruction("SCRDescriptorBndPlugin"));
    }

    @Test
    void removesScrDescriptorBndPluginInstruction() {
        rewriteRun(
                pomXml(
                        "<project>\n"
                        + "  <modelVersion>4.0.0</modelVersion>\n"
                        + "  <groupId>com.example</groupId>\n"
                        + "  <artifactId>test-bundle</artifactId>\n"
                        + "  <version>1.0.0</version>\n"
                        + "  <build>\n"
                        + "    <plugins>\n"
                        + "      <plugin>\n"
                        + "        <groupId>org.apache.felix</groupId>\n"
                        + "        <artifactId>maven-bundle-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <instructions>\n"
                        + "            <Bundle-SymbolicName>com.example.bundle</Bundle-SymbolicName>\n"
                        + "            <_plugin>org.apache.felix.scrplugin.bnd.SCRDescriptorBndPlugin</_plugin>\n"
                        + "          </instructions>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n",
                        "<project>\n"
                        + "  <modelVersion>4.0.0</modelVersion>\n"
                        + "  <groupId>com.example</groupId>\n"
                        + "  <artifactId>test-bundle</artifactId>\n"
                        + "  <version>1.0.0</version>\n"
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

    @Test
    void leavesOtherInstructionsAlone() {
        // Bundle-SymbolicName and Import-Package should survive — only _plugin matching pattern is removed
        rewriteRun(
                pomXml(
                        "<project>\n"
                        + "  <modelVersion>4.0.0</modelVersion>\n"
                        + "  <groupId>com.example</groupId>\n"
                        + "  <artifactId>test-bundle</artifactId>\n"
                        + "  <version>1.0.0</version>\n"
                        + "  <build>\n"
                        + "    <plugins>\n"
                        + "      <plugin>\n"
                        + "        <groupId>org.apache.felix</groupId>\n"
                        + "        <artifactId>maven-bundle-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <instructions>\n"
                        + "            <Bundle-SymbolicName>com.example.bundle</Bundle-SymbolicName>\n"
                        + "            <Import-Package>*</Import-Package>\n"
                        + "          </instructions>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n"
                )
        );
    }

    @Test
    void onlyRemovesInsideMavenBundlePlugin() {
        // Same <_plugin> content inside a different plugin must not be touched
        rewriteRun(
                pomXml(
                        "<project>\n"
                        + "  <modelVersion>4.0.0</modelVersion>\n"
                        + "  <groupId>com.example</groupId>\n"
                        + "  <artifactId>test-bundle</artifactId>\n"
                        + "  <version>1.0.0</version>\n"
                        + "  <build>\n"
                        + "    <plugins>\n"
                        + "      <plugin>\n"
                        + "        <groupId>org.apache.maven.plugins</groupId>\n"
                        + "        <artifactId>some-other-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <instructions>\n"
                        + "            <_plugin>org.apache.felix.scrplugin.bnd.SCRDescriptorBndPlugin</_plugin>\n"
                        + "          </instructions>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n"
                )
        );
    }

    @Test
    void handlesMultiplePluginsWithInstructions() {
        // maven-bundle-plugin has the matching _plugin instruction; another plugin has a different _plugin — only the matching one is removed
        rewriteRun(
                pomXml(
                        "<project>\n"
                        + "  <modelVersion>4.0.0</modelVersion>\n"
                        + "  <groupId>com.example</groupId>\n"
                        + "  <artifactId>test-bundle</artifactId>\n"
                        + "  <version>1.0.0</version>\n"
                        + "  <build>\n"
                        + "    <plugins>\n"
                        + "      <plugin>\n"
                        + "        <groupId>org.apache.felix</groupId>\n"
                        + "        <artifactId>maven-bundle-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <instructions>\n"
                        + "            <Bundle-SymbolicName>com.example.bundle</Bundle-SymbolicName>\n"
                        + "            <_plugin>org.apache.felix.scrplugin.bnd.SCRDescriptorBndPlugin</_plugin>\n"
                        + "          </instructions>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "      <plugin>\n"
                        + "        <groupId>org.apache.maven.plugins</groupId>\n"
                        + "        <artifactId>another-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <instructions>\n"
                        + "            <_plugin>some.other.Plugin</_plugin>\n"
                        + "          </instructions>\n"
                        + "        </configuration>\n"
                        + "      </plugin>\n"
                        + "    </plugins>\n"
                        + "  </build>\n"
                        + "</project>\n",
                        "<project>\n"
                        + "  <modelVersion>4.0.0</modelVersion>\n"
                        + "  <groupId>com.example</groupId>\n"
                        + "  <artifactId>test-bundle</artifactId>\n"
                        + "  <version>1.0.0</version>\n"
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
                        + "      <plugin>\n"
                        + "        <groupId>org.apache.maven.plugins</groupId>\n"
                        + "        <artifactId>another-plugin</artifactId>\n"
                        + "        <configuration>\n"
                        + "          <instructions>\n"
                        + "            <_plugin>some.other.Plugin</_plugin>\n"
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
