package com.adobe.aem.migration.recipes;

import lombok.EqualsAndHashCode;
import lombok.Value;
import org.openrewrite.*;
import org.openrewrite.java.JavaIsoVisitor;
import org.openrewrite.java.ChangeType;
import org.openrewrite.java.tree.J;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Value
@EqualsAndHashCode(callSuper = false)
public class RevertJakartaInAemSource extends Recipe {

    private static final List<String> AEM_PACKAGE_PREFIXES = Arrays.asList(
            "com.adobe.", "org.apache.sling.", "com.day.cq.",
            "org.apache.jackrabbit.", "org.apache.felix."
    );

    private static final List<String[]> JAKARTA_TO_JAVAX_MAPPINGS = Arrays.asList(
            new String[]{"jakarta.annotation", "javax.annotation"},
            new String[]{"jakarta.inject", "javax.inject"},
            new String[]{"jakarta.servlet", "javax.servlet"},
            new String[]{"jakarta.jcr", "javax.jcr"},
            new String[]{"jakarta.json", "javax.json"}
    );

    @Override
    public String getDisplayName() {
        return "Revert jakarta imports to javax in AEM source files";
    }

    @Override
    public String getDescription() {
        return "AEM 6.5 LTS uses the javax namespace. This recipe detects Java files that " +
               "import AEM/Sling packages and reverts any jakarta imports back to javax. " +
               "Jakarta annotations compile but fail silently at runtime (e.g., @PostConstruct " +
               "methods are never called).";
    }

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        return new JavaIsoVisitor<ExecutionContext>() {
            @Override
            public J.CompilationUnit visitCompilationUnit(J.CompilationUnit cu, ExecutionContext ctx) {
                // Check if this is an AEM source file (has AEM/Sling imports)
                boolean isAemSource = cu.getImports().stream()
                        .anyMatch(imp -> {
                            String fqn = imp.getTypeName();
                            return AEM_PACKAGE_PREFIXES.stream().anyMatch(fqn::startsWith);
                        });

                if (!isAemSource) {
                    return cu;
                }

                // Check if there are any jakarta imports to revert
                Set<String> jakartaImports = cu.getImports().stream()
                        .map(J.Import::getTypeName)
                        .filter(fqn -> fqn.startsWith("jakarta."))
                        .collect(Collectors.toSet());

                if (jakartaImports.isEmpty()) {
                    return cu;
                }

                // Schedule ChangeType recipes for each jakarta->javax mapping
                for (String jakartaImport : jakartaImports) {
                    for (String[] mapping : JAKARTA_TO_JAVAX_MAPPINGS) {
                        if (jakartaImport.startsWith(mapping[0])) {
                            String javaxEquivalent = jakartaImport.replace(mapping[0], mapping[1]);
                            doAfterVisit(new ChangeType(jakartaImport, javaxEquivalent, true).getVisitor());
                            break;
                        }
                    }
                }

                return cu;
            }
        };
    }
}
