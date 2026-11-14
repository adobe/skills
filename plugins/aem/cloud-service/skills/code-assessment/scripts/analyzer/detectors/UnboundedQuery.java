package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.UnaryTree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.TreePathScanner;

import javax.lang.model.element.Modifier;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * unbounded-query — a query declared explicitly unbounded, which loads the whole result set into
 * heap. Top CSO co-occurrence is OOM: a `p.limit=-1` QueryBuilder predicate (or `setLimit(-1)`)
 * traversed in a loop fills the heap and takes the instance down.
 *
 * Parse-level only and deliberately narrow: it flags the two *explicit* unbounded markers —
 * `…put("p.limit", "-1")` (QueryBuilder predicate map) and `…setLimit(-1)` (JCR/Query) — whether the
 * `-1` is written inline or referenced through a same-file `final` constant (e.g.
 * `UNLIMITED_RESULT = "-1"`). It does not infer a *missing* limit, parse raw SQL2/XPath strings, or
 * resolve constants defined in another compilation unit; those need analysis beyond a literal match
 * and would cost false positives.
 */
public final class UnboundedQuery implements Detector {

    public String pattern() { return "unbounded-query"; }
    public boolean needsPoms() { return false; }   // Java-only detector

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            // Same-file `final` fields whose value is the unbounded marker, so a marker referenced
            // through a constant is caught — not only inline literals.
            Set<String> strNegOne = new HashSet<>();   // final String X = "-1"
            Set<String> intNegOne = new HashSet<>();   // final int X = -1
            collectNegativeOneConstants(u.cu, strNegOne, intNegOne);

            Set<Long> seen = new HashSet<>();
            new TreePathScanner<Void, Void>() {
                public Void visitMethodInvocation(MethodInvocationTree t, Void p) {
                    if (isUnboundedMarker(t, strNegOne, intNegOne)) {
                        long line = u.lineOf(t);
                        if (seen.add(line)) out.add(new Finding(pattern(), u.rel, line, u.snippetOf(t)));
                    }
                    return super.visitMethodInvocation(t, p);
                }
            }.scan(u.cu, null);
        }
    }

    private static void collectNegativeOneConstants(CompilationUnitTree cu, Set<String> str, Set<String> ints) {
        new TreePathScanner<Void, Void>() {
            public Void visitVariable(VariableTree v, Void p) {
                Tree parent = getCurrentPath().getParentPath().getLeaf();
                if (parent instanceof ClassTree                                   // a field, not a local
                        && v.getModifiers().getFlags().contains(Modifier.FINAL)   // a constant
                        && v.getInitializer() != null) {
                    if ("-1".equals(stringLiteral(v.getInitializer()))) str.add(v.getName().toString());
                    else if (isNegativeOne(v.getInitializer())) ints.add(v.getName().toString());
                }
                return super.visitVariable(v, p);
            }
        }.scan(cu, null);
    }

    private static boolean isUnboundedMarker(MethodInvocationTree t, Set<String> strNegOne, Set<String> intNegOne) {
        String name = methodName(t);
        List<? extends ExpressionTree> args = t.getArguments();
        // QueryBuilder predicate map: put("p.limit", "-1" | UNBOUNDED_CONST)
        if ("put".equals(name) && args.size() == 2) {
            if (!"p.limit".equals(stringLiteral(args.get(0)))) return false;
            ExpressionTree val = args.get(1);
            return "-1".equals(stringLiteral(val)) || strNegOne.contains(identifierName(val));
        }
        // JCR / Query: setLimit(-1 | NO_LIMIT)
        if ("setLimit".equals(name) && args.size() == 1) {
            ExpressionTree val = args.get(0);
            return isNegativeOne(val) || intNegOne.contains(identifierName(val));
        }
        return false;
    }

    private static String methodName(MethodInvocationTree t) {
        ExpressionTree select = t.getMethodSelect();
        if (select instanceof MemberSelectTree) return ((MemberSelectTree) select).getIdentifier().toString();
        if (select instanceof IdentifierTree) return ((IdentifierTree) select).getName().toString();
        return "";
    }

    // Trailing simple name of `X` or `Owner.X`, else null (so literals don't match a constant set).
    private static String identifierName(ExpressionTree e) {
        if (e instanceof IdentifierTree) return ((IdentifierTree) e).getName().toString();
        if (e instanceof MemberSelectTree) return ((MemberSelectTree) e).getIdentifier().toString();
        return null;
    }

    // The String value of a string-literal expression, or null if it is not one.
    private static String stringLiteral(ExpressionTree e) {
        if (e instanceof LiteralTree) {
            Object v = ((LiteralTree) e).getValue();
            if (v instanceof String) return (String) v;
        }
        return null;
    }

    // -1 as written in source: the unary-minus of integer 1, or (rarely) a literal whose value is -1.
    private static boolean isNegativeOne(ExpressionTree e) {
        if (e instanceof UnaryTree && e.getKind() == Tree.Kind.UNARY_MINUS) {
            ExpressionTree operand = ((UnaryTree) e).getExpression();
            return operand instanceof LiteralTree && isOne(((LiteralTree) operand).getValue());
        }
        if (e instanceof LiteralTree) {
            Object v = ((LiteralTree) e).getValue();
            return v instanceof Number && ((Number) v).longValue() == -1L;
        }
        return false;
    }

    private static boolean isOne(Object v) {
        return v instanceof Number && ((Number) v).longValue() == 1L;
    }
}
