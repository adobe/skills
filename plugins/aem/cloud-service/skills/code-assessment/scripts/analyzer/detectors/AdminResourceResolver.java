package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.OsgiUnit;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.TreePathScanner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * admin-resource-resolver — code that opens an administrative resource resolver, which AEM as a
 * Cloud Service does not allow, and service-user mappings that map a subservice to the admin user.
 *
 * Parse-level only, no type resolution. Flagged:
 *  - calls to getAdministrativeResourceResolver(...) and loginAdministrative(...), whatever the receiver;
 *  - ResourceProvider.AUTH_ADMIN (simple or fully qualified), and a bare AUTH_ADMIN when the file
 *    static-imports it, by name or by wildcard from a ResourceProvider;
 *  - a line of a ServiceUserMapperImpl configuration (.cfg.json, .config, .cfg; the plain
 *    ServiceUserMapperImpl and its .amended-* / ~ factory variants) that maps to the user "admin"
 *    or sets user.default to "admin".
 *
 * Not covered: XML sling:OsgiConfig files (the analyzer does not collect them), a mapping whose
 * user is built by a placeholder, and a project constant that is itself named ResourceProvider.
 */
public final class AdminResourceResolver implements Detector {

    public String pattern() { return "admin-resource-resolver"; }
    public boolean needsPoms() { return false; }
    public boolean needsOsgi() { return true; }

    private static final Set<String> ADMIN_CALLS = new HashSet<>(java.util.Arrays.asList(
        "getAdministrativeResourceResolver", "loginAdministrative"));
    private static final String AUTH_ADMIN = "AUTH_ADMIN";
    private static final String RESOURCE_PROVIDER = "ResourceProvider";
    private static final String SLING_PREFIX = "org.apache.sling.";

    private static final String MAPPER_PID = "org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl";
    // "bundle:sub=admin" in JSON, "bundle:sub\=admin" in .config, with an optional [principal] bracket.
    private static final Pattern ADMIN_MAPPING = Pattern.compile("\\\\?=\\s*\\[?\\s*admin\\s*(?:[\\],\"']|$)");
    private static final Pattern ADMIN_DEFAULT_USER = Pattern.compile(
        "^\\s*[\"']?user\\.default[\"']?\\s*[:=]\\s*[\"']?admin[\"']?\\s*(?:,|$)");

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) detectJava(u, out);
        for (OsgiUnit o : c.osgi) detectMapping(o, out, warnings);
    }

    private void detectJava(JavaUnit u, List<Finding> out) {
        boolean staticAuthAdmin = importsAuthAdmin(u);
        Set<Long> seen = new HashSet<>();
        new TreePathScanner<Void, Void>() {
            public Void visitImport(ImportTree t, Void p) { return null; }

            public Void visitMethodInvocation(MethodInvocationTree t, Void p) {
                if (ADMIN_CALLS.contains(methodName(t.getMethodSelect()))) emit(t);
                return super.visitMethodInvocation(t, p);
            }

            public Void visitMemberSelect(MemberSelectTree t, Void p) {
                if (t.getIdentifier().contentEquals(AUTH_ADMIN) && isResourceProvider(t.getExpression(), u)) emit(t);
                return super.visitMemberSelect(t, p);
            }

            public Void visitIdentifier(IdentifierTree t, Void p) {
                if (staticAuthAdmin && t.getName().contentEquals(AUTH_ADMIN)) emit(t);
                return super.visitIdentifier(t, p);
            }

            private void emit(Tree t) {
                long line = u.lineOf(t);
                if (seen.add(line)) out.add(new Finding(pattern(), u.rel, line, u.snippetOf(t)));
            }
        }.scan(u.cu, null);
    }

    private static String methodName(ExpressionTree select) {
        if (select instanceof MemberSelectTree) return ((MemberSelectTree) select).getIdentifier().toString();
        if (select instanceof IdentifierTree) return ((IdentifierTree) select).getName().toString();
        return "";
    }

    // The receiver of AUTH_ADMIN names ResourceProvider: simple name not imported from elsewhere, or a qualified name.
    private static boolean isResourceProvider(ExpressionTree expr, JavaUnit u) {
        if (expr instanceof IdentifierTree) {
            if (!((IdentifierTree) expr).getName().contentEquals(RESOURCE_PROVIDER)) return false;
            String fqn = u.imports.get(RESOURCE_PROVIDER);
            return fqn == null || fqn.startsWith(SLING_PREFIX);
        }
        String s = expr.toString();
        return s.startsWith(SLING_PREFIX) && s.endsWith("." + RESOURCE_PROVIDER);
    }

    // import static ...ResourceProvider.AUTH_ADMIN; or import static ...ResourceProvider.*;
    private static boolean importsAuthAdmin(JavaUnit u) {
        String single = u.imports.get(AUTH_ADMIN);
        if (single != null && single.startsWith(SLING_PREFIX) && single.endsWith("." + RESOURCE_PROVIDER + "." + AUTH_ADMIN)) return true;
        for (String w : u.wildcards) {
            if (w.startsWith(SLING_PREFIX) && w.endsWith("." + RESOURCE_PROVIDER)) return true;
        }
        return false;
    }

    private void detectMapping(OsgiUnit o, List<Finding> out, List<String> warnings) {
        if (!o.pid.startsWith(MAPPER_PID)) return;
        List<String> lines;
        try {
            lines = Files.readAllLines(o.path, StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException ex) {
            warnings.add("parse-skip: " + o.rel + " — " + ex.getClass().getSimpleName());
            return;
        }
        boolean inBlockComment = false;
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            String trimmed = line.trim();
            if (inBlockComment) {
                inBlockComment = !trimmed.contains("*/");
                continue;
            }
            if (trimmed.startsWith("/*")) {
                inBlockComment = !trimmed.contains("*/");
                continue;
            }
            if (trimmed.startsWith("#") || trimmed.startsWith("!") || trimmed.startsWith("//")) continue;
            if (ADMIN_MAPPING.matcher(line).find() || ADMIN_DEFAULT_USER.matcher(line).find()) {
                out.add(new Finding(pattern(), o.rel, i + 1, trimmed));
            }
        }
    }
}
