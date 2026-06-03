package com.adobe.aem.migration.recipes;

import lombok.EqualsAndHashCode;
import lombok.Value;
import org.openrewrite.*;
import org.openrewrite.java.JavaIsoVisitor;
import org.openrewrite.java.tree.J;
import org.openrewrite.marker.SearchResult;

import java.util.Arrays;
import java.util.List;

@Value
@EqualsAndHashCode(callSuper = false)
public class DetectUnsupportedPackages extends Recipe {

    private static final List<String> UNSUPPORTED_PACKAGES = Arrays.asList(
            "com.adobe.cq.commerce.",
            "com.adobe.cq.social.",
            "com.adobe.granite.social.",
            "com.adobe.cq.screens.",
            "com.adobe.cq.sample.we.retail.",
            "com.day.cq.dam.pim.",
            "com.day.cq.dam.rating.",
            "com.adobe.cq.searchpromote.",
            "com.adobe.cq.mcm.campaign."
    );

    private static final List<String> REMOVED_BUNDLE_PACKAGES = Arrays.asList(
            "com.google.common.",
            "com.github.benmanes.caffeine.",
            "org.eclipse.jetty.",
            "org.apache.commons.collections."
    );

    @Override
    public String getDisplayName() {
        return "Detect unsupported and removed bundle packages";
    }

    @Override
    public String getDescription() {
        return "Scans Java source files for imports from packages that are unsupported in " +
               "AEM 6.5 LTS or from bundles that have been removed from the runtime. " +
               "Unsupported packages block migration; removed bundle packages require remediation.";
    }

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        return new JavaIsoVisitor<ExecutionContext>() {
            @Override
            public J.Import visitImport(J.Import import_, ExecutionContext ctx) {
                String fqn = import_.getTypeName();

                for (String pkg : UNSUPPORTED_PACKAGES) {
                    if (fqn.startsWith(pkg)) {
                        return SearchResult.found(import_,
                                "BLOCKER: Unsupported package '" + pkg + "' — migration cannot proceed");
                    }
                }

                for (String pkg : REMOVED_BUNDLE_PACKAGES) {
                    if (fqn.startsWith(pkg) && !fqn.startsWith("org.apache.commons.collections4.")) {
                        return SearchResult.found(import_,
                                "WARNING: Removed bundle package '" + pkg + "' — requires remediation");
                    }
                }

                return import_;
            }
        };
    }
}
