package com.adobe.aem.migration.recipes;

import org.junit.jupiter.api.Test;
import org.openrewrite.java.JavaParser;
import org.openrewrite.test.RecipeSpec;
import org.openrewrite.test.RewriteTest;
import org.openrewrite.test.TypeValidation;

import static org.openrewrite.java.Assertions.java;

class RevertJakartaInAemSourceTest implements RewriteTest {

    @Override
    public void defaults(RecipeSpec spec) {
        spec.recipe(new RevertJakartaInAemSource())
                .parser(JavaParser.fromJavaVersion()
                        .classpath("jakarta.inject-api", "jakarta.annotation-api"))
                .typeValidationOptions(TypeValidation.none());
    }

    @Test
    void revertsJakartaInjectInAemFile() {
        // File has org.apache.sling import (AEM) AND jakarta.inject.Inject → must revert inject.
        // OpenRewrite separates import groups from different packages with a blank line.
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "\n"
                        + "import org.apache.sling.api.SlingHttpServletRequest;\n"
                        + "import jakarta.inject.Inject;\n"
                        + "\n"
                        + "public class MyComponent {\n"
                        + "    @Inject\n"
                        + "    private SlingHttpServletRequest request;\n"
                        + "}\n",
                        "package com.example;\n"
                        + "\n"
                        + "import org.apache.sling.api.SlingHttpServletRequest;\n"
                        + "\n"
                        + "import javax.inject.Inject;\n"
                        + "\n"
                        + "public class MyComponent {\n"
                        + "    @Inject\n"
                        + "    private SlingHttpServletRequest request;\n"
                        + "}\n"
                )
        );
    }

    @Test
    void revertsJakartaAnnotationInAemFile() {
        // jakarta.annotation.PostConstruct → javax.annotation.PostConstruct in AEM file.
        // OpenRewrite separates com.adobe and javax import groups with a blank line.
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "\n"
                        + "import com.adobe.cq.wcm.core.components.models.Component;\n"
                        + "import jakarta.annotation.PostConstruct;\n"
                        + "\n"
                        + "public class MyModel implements Component {\n"
                        + "    @PostConstruct\n"
                        + "    protected void init() {\n"
                        + "    }\n"
                        + "}\n",
                        "package com.example;\n"
                        + "\n"
                        + "import com.adobe.cq.wcm.core.components.models.Component;\n"
                        + "\n"
                        + "import javax.annotation.PostConstruct;\n"
                        + "\n"
                        + "public class MyModel implements Component {\n"
                        + "    @PostConstruct\n"
                        + "    protected void init() {\n"
                        + "    }\n"
                        + "}\n"
                )
        );
    }

    @Test
    void doesNotTouchNonAemFile() {
        // No AEM/Sling imports — recipe should leave this file alone entirely
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

    @Test
    void revertsMultipleJakartaImports() {
        // AEM file with several jakarta imports — all should be reverted.
        // OpenRewrite separates org.apache.sling and javax import groups with a blank line.
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "\n"
                        + "import org.apache.sling.models.annotations.Model;\n"
                        + "import jakarta.annotation.PostConstruct;\n"
                        + "import jakarta.inject.Inject;\n"
                        + "\n"
                        + "public class MyModel {\n"
                        + "    @Inject\n"
                        + "    private String value;\n"
                        + "\n"
                        + "    @PostConstruct\n"
                        + "    protected void activate() {\n"
                        + "    }\n"
                        + "}\n",
                        "package com.example;\n"
                        + "\n"
                        + "import org.apache.sling.models.annotations.Model;\n"
                        + "\n"
                        + "import javax.annotation.PostConstruct;\n"
                        + "import javax.inject.Inject;\n"
                        + "\n"
                        + "public class MyModel {\n"
                        + "    @Inject\n"
                        + "    private String value;\n"
                        + "\n"
                        + "    @PostConstruct\n"
                        + "    protected void activate() {\n"
                        + "    }\n"
                        + "}\n"
                )
        );
    }
}
