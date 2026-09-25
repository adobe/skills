package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.util.TreePathScanner;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * tuning-oak-query-indexes — flags JCR/QueryBuilder query CONSTRUCTION sites so the runbook can
 * check each query is served by an index and, when it is not, propose the property/Lucene
 * index-definition change.
 *
 * Parse-level only (no type resolution): it matches on the written method names that build a query —
 * <ul>
 *   <li>any invocation named {@code createQuery} — covers JCR {@code QueryManager.createQuery(...)}
 *       and AEM QueryBuilder {@code builder.createQuery(...)};</li>
 *   <li>a {@code create} invocation whose receiver's trailing simple name is {@code PredicateGroup}
 *       (i.e. {@code PredicateGroup.create(...)}).</li>
 * </ul>
 * One finding per distinct source line (a line may match more than once when calls are chained). The
 * detector locates queries; it does not judge coverage — that needs the index definition(s), supplied
 * to the expert skill (resolution contract: user-supplied; deferred whole-pattern if none is given).
 */
public final class OakQueryIndexCoverage implements Detector {

    public String pattern() { return "tuning-oak-query-indexes"; }
    public boolean needsPoms() { return false; }   // Java-only detector

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            Set<Long> seen = new HashSet<>();
            new TreePathScanner<Void, Void>() {
                public Void visitMethodInvocation(MethodInvocationTree t, Void p) {
                    if (isQueryConstruction(t)) {
                        long line = u.lineOf(t);
                        if (seen.add(line)) out.add(new Finding(pattern(), u.rel, line, u.snippetOf(t)));
                    }
                    return super.visitMethodInvocation(t, p);
                }
            }.scan(u.cu, null);
        }
    }

    private static boolean isQueryConstruction(MethodInvocationTree t) {
        ExpressionTree select = t.getMethodSelect();
        // createQuery(...) — bare or receiver.createQuery(...)
        if (select instanceof IdentifierTree) {
            return "createQuery".equals(((IdentifierTree) select).getName().toString());
        }
        if (select instanceof MemberSelectTree) {
            MemberSelectTree mst = (MemberSelectTree) select;
            String name = mst.getIdentifier().toString();
            if ("createQuery".equals(name)) return true;
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
