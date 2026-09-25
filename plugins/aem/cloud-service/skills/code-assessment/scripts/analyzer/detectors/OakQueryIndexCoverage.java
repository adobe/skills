package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.util.TreePathScanner;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * tuning-oak-query-indexes — flags JCR/Sling/QueryBuilder query CONSTRUCTION sites so the runbook can
 * check each query is served by an index and, when it is not, propose the property/Lucene
 * index-definition change.
 *
 * Parse-level only (no type resolution): it matches on the written names of the Java APIs that build
 * or run a repository query. This mirrors the anchors the (now-folded) extracting-jcr-queries
 * Technique-1 API-surface pass used, so moving detection from grep to code keeps the same capture:
 * <ul>
 *   <li>{@code createQuery(...)} — JCR {@code QueryManager.createQuery(...)} and AEM QueryBuilder
 *       {@code builder.createQuery(...)};</li>
 *   <li>{@code getQueryManager(...)} — the JCR query entry point ({@code Workspace.getQueryManager()});</li>
 *   <li>{@code findResources(...)} / {@code queryResources(...)} — the Sling
 *       {@code ResourceResolver} query APIs, which run a real indexed repository query;</li>
 *   <li>{@code PredicateGroup.create(...)} and {@code new PredicateGroup(...)} — QueryBuilder
 *       predicate-group construction.</li>
 * </ul>
 * One finding per distinct source line (a line may match more than once when calls are chained). The
 * detector locates queries; it does not judge coverage — that needs the index definition(s), supplied
 * to the expert skill (resolution contract: user-supplied; deferred whole-pattern if none is given).
 *
 * Non-Java queries (XPath/SQL2 in JSP/HTL/config, stored dam:query / Smart-Collection predicate
 * strings, query-string form) and queries hidden behind a non-JCR wrapper method are out of a
 * parse-level Java detector's reach by design — see the extracting-jcr-queries guide's Technique 2
 * and wrapper-tracing for the manual fallback.
 */
public final class OakQueryIndexCoverage implements Detector {

    // Method names that build or run a repository query, matched by written name (no type resolution).
    private static final Set<String> QUERY_METHODS = new HashSet<>(Arrays.asList(
            "createQuery",        // JCR QueryManager + QueryBuilder
            "getQueryManager",    // JCR query entry point
            "findResources",      // Sling ResourceResolver
            "queryResources"      // Sling ResourceResolver
    ));

    public String pattern() { return "tuning-oak-query-indexes"; }
    public boolean needsPoms() { return false; }   // Java-only detector

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            Set<Long> seen = new HashSet<>();
            new TreePathScanner<Void, Void>() {
                public Void visitMethodInvocation(MethodInvocationTree t, Void p) {
                    if (isQueryConstruction(t)) emit(u, t, out, seen);
                    return super.visitMethodInvocation(t, p);
                }
                public Void visitNewClass(NewClassTree t, Void p) {
                    // new PredicateGroup(...)
                    if ("PredicateGroup".equals(trailingName(t.getIdentifier()))) emit(u, t, out, seen);
                    return super.visitNewClass(t, p);
                }
            }.scan(u.cu, null);
        }
    }

    private void emit(JavaUnit u, com.sun.source.tree.Tree t, List<Finding> out, Set<Long> seen) {
        long line = u.lineOf(t);
        if (seen.add(line)) out.add(new Finding(pattern(), u.rel, line, u.snippetOf(t)));
    }

    private static boolean isQueryConstruction(MethodInvocationTree t) {
        ExpressionTree select = t.getMethodSelect();
        if (select instanceof IdentifierTree) {
            return QUERY_METHODS.contains(((IdentifierTree) select).getName().toString());
        }
        if (select instanceof MemberSelectTree) {
            MemberSelectTree mst = (MemberSelectTree) select;
            String name = mst.getIdentifier().toString();
            if (QUERY_METHODS.contains(name)) return true;
            // PredicateGroup.create(...)
            if ("create".equals(name)) {
                return "PredicateGroup".equals(trailingName(mst.getExpression()));
            }
        }
        return false;
    }

    // Trailing simple name of `X` or `Owner.X`, else null.
    private static String trailingName(ExpressionTree e) {
        if (e instanceof IdentifierTree) return ((IdentifierTree) e).getName().toString();
        if (e instanceof MemberSelectTree) return ((MemberSelectTree) e).getIdentifier().toString();
        return null;
    }
}
