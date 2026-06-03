package com.adobe.aem.migration.recipes;

import org.junit.jupiter.api.Test;
import org.openrewrite.test.RecipeSpec;
import org.openrewrite.test.RewriteTest;
import org.openrewrite.test.TypeValidation;

import static org.openrewrite.java.Assertions.java;

class DetectUnsupportedPackagesTest implements RewriteTest {

    @Override
    public void defaults(RecipeSpec spec) {
        spec.recipe(new DetectUnsupportedPackages())
                .typeValidationOptions(TypeValidation.none());
    }

    @Test
    void detectsCommercePackage() {
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "import com.adobe.cq.commerce.api.Product;\n"
                        + "public class Foo {}\n",
                        "package com.example;\n"
                        + "/*~~(BLOCKER: Unsupported package 'com.adobe.cq.commerce.' — migration cannot proceed)~~>*/import com.adobe.cq.commerce.api.Product;\n"
                        + "public class Foo {}\n"
                )
        );
    }

    @Test
    void detectsGuavaPackage() {
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "import com.google.common.collect.ImmutableList;\n"
                        + "public class Foo {}\n",
                        "package com.example;\n"
                        + "/*~~(WARNING: Removed bundle package 'com.google.common.' — requires remediation)~~>*/import com.google.common.collect.ImmutableList;\n"
                        + "public class Foo {}\n"
                )
        );
    }

    @Test
    void doesNotMarkCollections4() {
        // org.apache.commons.collections4 is explicitly excluded from the guard — no finding
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "import org.apache.commons.collections4.CollectionUtils;\n"
                        + "public class Foo {}\n"
                )
        );
    }

    @Test
    void doesNotMarkUnrelatedImports() {
        // slf4j imports are unrelated to any unsupported package — no finding
        rewriteRun(
                java(
                        "package com.example;\n"
                        + "import org.slf4j.Logger;\n"
                        + "import org.slf4j.LoggerFactory;\n"
                        + "public class Foo {}\n"
                )
        );
    }
}
