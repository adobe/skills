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
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;

import javax.lang.model.element.Modifier;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * request-controlled-security-bypass — security code that reads a cookie, header or request
 * parameter whose name says test automation, debug, bypass or skip. The usual shape is a login
 * servlet that skips its captcha check when a "qa-automation" cookie is present: anyone who sets
 * the cookie skips the check, in production too.
 *
 * Parse-level only. A finding needs both:
 *  - a request read by a suspicious name: getCookie / getHeader(s) / getIntHeader / getDateHeader /
 *    getParameter(Values) / getRequestParameter(s) with that name, a lookup on getParameterMap() /
 *    getRequestParameterMap(), or a cookie-name comparison ("name".equals(cookie.getName()));
 *    the name is an inline literal or a same-file final String constant;
 *  - security context: the enclosing method's source, or the header (annotations, name, extends,
 *    implements) of an enclosing class, names captcha, authentication, authorization, login,
 *    password, credentials, CSRF, rate limiting, throttling or permissions.
 *
 * The finding names the cookie, header or parameter in its hint and never carries the value it
 * is compared against. Files under src/test/ are skipped: a test that sets the cookie is not a
 * bypass. Not covered: a helper in an unrelated class, constants from another compilation unit,
 * names built at runtime, a switch on the cookie name.
 */
public final class RequestControlledSecurityBypass implements Detector {

    public String pattern() { return "request-controlled-security-bypass"; }
    public boolean needsPoms() { return false; }   // Java-only detector

    // Request accessors whose first argument is a name, and what that name is.
    private static final Map<String, String> ACCESSORS = new HashMap<>();
    static {
        ACCESSORS.put("getCookie", "cookie");
        for (String m : new String[] {"getHeader", "getHeaders", "getIntHeader", "getDateHeader"}) ACCESSORS.put(m, "header");
        for (String m : new String[] {"getParameter", "getParameterValues", "getRequestParameter", "getRequestParameters"}) ACCESSORS.put(m, "parameter");
    }

    // Lookups on a parameter map: request.getParameterMap().get("skip") and the Sling equivalent.
    private static final Set<String> MAP_LOOKUPS = new HashSet<>(Arrays.asList("get", "containsKey", "getValue", "getValues"));
    private static final Pattern PARAMETER_MAP = Pattern.compile("\\.(getParameterMap|getRequestParameterMap)\\(\\s*\\)$");

    // Words of a name (split on punctuation and camelCase) that mark a test, debug or bypass switch.
    // Whole words only, so "latest" or "contest" do not match "test".
    private static final Set<String> SUSPECT_WORDS = new HashSet<>(Arrays.asList(
        "automation", "automated", "autotest", "test", "tests", "testing", "tester", "qa", "e2e",
        "selenium", "cypress", "playwright", "debug", "debugging", "bypass", "skip", "disable",
        "disabled", "nocaptcha", "backdoor", "mock"));

    // Security context, matched on lowercased source. "authoriz" and "authenticat" rather than "auth",
    // which would match every "author" in AEM code.
    private static final Pattern SECURITY_CONTEXT = Pattern.compile(
        "captcha|authenticat|authoriz|login|logon|sign[-_]?in|password|passwd|credential|csrf|xsrf"
        + "|rate[-_]?limit|throttl|permission|privilege|two[-_]?factor|2fa|access[-_]?control|brute[-_]?force|lockout");

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            if (isTestSource(u.rel)) continue;
            Map<String, String> constants = stringConstants(u.cu);   // NAME -> "value", same file
            boolean mentionsCookies = u.source.contains("Cookie");
            Set<Long> seen = new HashSet<>();
            new TreePathScanner<Void, Void>() {
                public Void visitMethodInvocation(MethodInvocationTree t, Void p) {
                    String[] read = requestRead(t, constants, mentionsCookies);   // {kind, name} or null
                    if (read != null && inSecurityContext(getCurrentPath(), u)) {
                        long line = u.lineOf(t);
                        if (seen.add(line)) {
                            out.add(new Finding(pattern(), u.rel, line, u.snippetOf(t), read[0] + " \"" + read[1] + "\""));
                        }
                    }
                    return super.visitMethodInvocation(t, p);
                }
            }.scan(u.cu, null);
        }
    }

    // {kind, name} when t reads a cookie, header or parameter by a suspicious name, else null.
    private static String[] requestRead(MethodInvocationTree t, Map<String, String> constants, boolean mentionsCookies) {
        String method = methodName(t);
        List<? extends ExpressionTree> args = t.getArguments();

        String kind = ACCESSORS.get(method);
        if (kind != null && !args.isEmpty()) {
            String name = suspectName(args.get(0), constants);
            return name == null ? null : new String[] {kind, name};
        }

        if (MAP_LOOKUPS.contains(method) && args.size() == 1 && receiverMatches(t, PARAMETER_MAP)) {
            String name = suspectName(args.get(0), constants);
            return name == null ? null : new String[] {"parameter", name};
        }

        // "name".equals(cookie.getName()) or cookie.getName().equals("name"), in a file that uses cookies.
        if (mentionsCookies && ("equals".equals(method) || "equalsIgnoreCase".equals(method)) && args.size() == 1) {
            ExpressionTree receiver = receiver(t);
            ExpressionTree other = null;
            if (isGetNameCall(args.get(0))) other = receiver;
            else if (isGetNameCall(receiver)) other = args.get(0);
            if (other == null) return null;
            String name = suspectName(other, constants);
            return name == null ? null : new String[] {"cookie", name};
        }
        return null;
    }

    // The name an expression stands for when it is suspicious: a literal, or a same-file constant
    // whose identifier or value is suspicious. Null otherwise.
    private static String suspectName(ExpressionTree e, Map<String, String> constants) {
        String literal = stringLiteral(e);
        if (literal != null) return isSuspect(literal) ? literal : null;
        String id = identifierName(e);
        if (id == null || !constants.containsKey(id)) return null;
        String value = constants.get(id);
        return isSuspect(value) || isSuspect(id) ? value : null;
    }

    static boolean isSuspect(String name) {
        String spaced = name.replaceAll("([a-z0-9])([A-Z])", "$1 $2");
        for (String word : spaced.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (SUSPECT_WORDS.contains(word)) return true;
        }
        return false;
    }

    // The enclosing method's source, or the header of any enclosing class, names a security control.
    private static boolean inSecurityContext(TreePath path, JavaUnit u) {
        boolean methodChecked = false;
        for (TreePath cur = path; cur != null; cur = cur.getParentPath()) {
            Tree leaf = cur.getLeaf();
            if (!methodChecked && leaf instanceof MethodTree) {
                methodChecked = true;
                if (isSecurity(u.snippetOf(leaf))) return true;
            }
            if (leaf instanceof ClassTree && isSecurity(classHeader((ClassTree) leaf))) return true;
        }
        return false;
    }

    private static boolean isSecurity(String text) {
        return SECURITY_CONTEXT.matcher(text.toLowerCase(Locale.ROOT)).find();
    }

    private static String classHeader(ClassTree cls) {
        StringBuilder b = new StringBuilder();
        b.append(cls.getModifiers()).append(' ').append(cls.getSimpleName());
        if (cls.getExtendsClause() != null) b.append(' ').append(cls.getExtendsClause());
        for (Tree i : cls.getImplementsClause()) b.append(' ').append(i);
        return b.toString();
    }

    private static Map<String, String> stringConstants(CompilationUnitTree cu) {
        Map<String, String> constants = new HashMap<>();
        new TreePathScanner<Void, Void>() {
            public Void visitVariable(VariableTree v, Void p) {
                Tree parent = getCurrentPath().getParentPath().getLeaf();
                if (parent instanceof ClassTree
                        && v.getModifiers().getFlags().contains(Modifier.FINAL)
                        && v.getInitializer() != null) {
                    String value = stringLiteral(v.getInitializer());
                    if (value != null) constants.put(v.getName().toString(), value);
                }
                return super.visitVariable(v, p);
            }
        }.scan(cu, null);
        return constants;
    }

    private static boolean isTestSource(String rel) {
        String path = "/" + rel.replace('\\', '/');
        return path.contains("/src/test/");
    }

    private static boolean isGetNameCall(ExpressionTree e) {
        return e instanceof MethodInvocationTree
            && "getName".equals(methodName((MethodInvocationTree) e))
            && ((MethodInvocationTree) e).getArguments().isEmpty();
    }

    private static boolean receiverMatches(MethodInvocationTree t, Pattern p) {
        ExpressionTree r = receiver(t);
        return r != null && p.matcher(r.toString()).find();
    }

    private static ExpressionTree receiver(MethodInvocationTree t) {
        ExpressionTree select = t.getMethodSelect();
        return select instanceof MemberSelectTree ? ((MemberSelectTree) select).getExpression() : null;
    }

    private static String methodName(MethodInvocationTree t) {
        ExpressionTree select = t.getMethodSelect();
        if (select instanceof MemberSelectTree) return ((MemberSelectTree) select).getIdentifier().toString();
        if (select instanceof IdentifierTree) return ((IdentifierTree) select).getName().toString();
        return "";
    }

    private static String identifierName(ExpressionTree e) {
        if (e instanceof IdentifierTree) return ((IdentifierTree) e).getName().toString();
        if (e instanceof MemberSelectTree) return ((MemberSelectTree) e).getIdentifier().toString();
        return null;
    }

    private static String stringLiteral(ExpressionTree e) {
        if (e instanceof LiteralTree) {
            Object v = ((LiteralTree) e).getValue();
            if (v instanceof String) return (String) v;
        }
        return null;
    }
}
