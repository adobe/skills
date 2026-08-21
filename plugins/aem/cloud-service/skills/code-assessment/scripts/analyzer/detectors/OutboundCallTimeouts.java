package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * outbound-call-timeouts — HTTP client constructed without an explicit connect/read/socket timeout.
 *
 * Highest-frequency CSO outage pattern: a timeout-less client inherits effectively-infinite defaults,
 * so a slow upstream holds request threads until the Jetty pool saturates and the site goes down.
 *
 * Parse-level only (no type resolution): the detector matches construction sites textually —
 * a known client type fragment + a construction marker — then suppresses the finding when the
 * enclosing method (or class, for field initializers) sets any timeout knob. Conservative by
 * design: it would rather miss a client whose timeout is configured elsewhere than flag a safe one.
 */
public final class OutboundCallTimeouts implements Detector {

    public String pattern() { return "outbound-call-timeouts"; }
    public boolean needsPoms() { return false; }   // Java-only detector

    // Type names of an HTTP client we cover, matched as whole words (\b…\b) — covers Apache
    // HttpClient 4.x (org.apache.http) and 5.x (org.apache.hc), both exposing HttpClients /
    // HttpClientBuilder, plus OkHttp and JDK java.net.http.HttpClient. Word-boundary matching is
    // deliberate: a bare substring "HttpClient" otherwise matches identifiers like
    // `mockCloseableHttpClient` (e.g. a Mockito `.build()` stub), producing false positives (CA-12).
    private static final java.util.regex.Pattern CLIENT_TYPE = java.util.regex.Pattern.compile(
        "\\b(HttpClientBuilder|HttpClients|OkHttpClient|HttpClient)\\b");

    // A candidate must look like client *creation*, not just any mention of the type.
    private static final String[] CREATION_MARKERS = {
        ".createDefault", ".newBuilder", ".newHttpClient", ".build(",
        "new HttpClientBuilder", "new OkHttpClient"
    };

    // If any of these appears anywhere in the enclosing scope, a timeout is being configured —
    // suppress (conservative). Covers Apache 4.x/5.x, OkHttp, and java.net.http knobs.
    private static final String[] TIMEOUT_TOKENS = {
        "setConnectTimeout", "setSocketTimeout", "setConnectionRequestTimeout", "setResponseTimeout",
        "connectTimeout", "readTimeout", "writeTimeout", "callTimeout",
        "RequestConfig", "Timeout.of", "Duration.of"
    };

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            Set<Long> seen = new HashSet<>();
            new TreePathScanner<Void, Void>() {
                public Void visitMethodInvocation(MethodInvocationTree t, Void p) {
                    consider(t, u, out, seen, getCurrentPath());
                    return super.visitMethodInvocation(t, p);
                }
                public Void visitNewClass(NewClassTree t, Void p) {
                    consider(t, u, out, seen, getCurrentPath());
                    return super.visitNewClass(t, p);
                }
            }.scan(u.cu, null);
        }
    }

    private void consider(Tree node, JavaUnit u, List<Finding> out, Set<Long> seen, TreePath path) {
        // Only the outermost link of a fluent chain — inner receivers are part of the same
        // construction and are represented by the outer call.
        if (isReceiverOfEnclosingCall(path)) return;
        String text = u.snippetOf(node);

        // JDK java.net.http: the read timeout is per-request (HttpRequest.Builder.timeout), not on
        // the client — so the request builder is its own target. Flag a complete
        // HttpRequest.newBuilder()…build() chain that sets no .timeout(…). The chain is
        // self-contained, so suppression is chain-level (not enclosing-scope). Gated to the JDK
        // build() call so an enclosing client.send(request) that merely takes the chain as an
        // argument is not matched.
        if (isBuildCall(node) && isJdkRequestBuilder(text, u)) {
            if (!text.contains(".timeout(")) emit(node, u, out, seen, text);
            return;
        }

        // Client construction (Apache HttpClient 4.x/5.x, OkHttp, JDK HttpClient): flag when no
        // timeout knob appears anywhere in the enclosing scope.
        if (!CLIENT_TYPE.matcher(text).find()) return;
        if (!containsAny(text, CREATION_MARKERS)) return;
        if (containsAny(enclosingScopeText(path, u), TIMEOUT_TOKENS)) return;   // timeout set in scope
        emit(node, u, out, seen, text);
    }

    private void emit(Tree node, JavaUnit u, List<Finding> out, Set<Long> seen, String text) {
        long line = u.lineOf(node);
        if (seen.add(line)) out.add(new Finding(pattern(), u.rel, line, text));
    }

    // True when `node` is a `…build()` method invocation (terminal builder call). Used to anchor a
    // request finding at the build, not at an enclosing send(...) that takes the chain as an arg.
    private static boolean isBuildCall(Tree node) {
        if (!(node instanceof MethodInvocationTree)) return false;
        ExpressionTree select = ((MethodInvocationTree) node).getMethodSelect();
        return select instanceof MemberSelectTree
            && ((MemberSelectTree) select).getIdentifier().contentEquals("build");
    }

    // A java.net.http.HttpRequest builder chain, gated to the JDK type. `HttpRequest.newBuilder` is
    // JDK-specific; the import / FQN gate excludes other libraries' HttpRequest (e.g. Apache 5.x).
    private static boolean isJdkRequestBuilder(String text, JavaUnit u) {
        if (!text.contains("HttpRequest") || !text.contains(".newBuilder")) return false;
        return "java.net.http.HttpRequest".equals(u.imports.get("HttpRequest"))
            || u.wildcards.contains("java.net.http")
            || text.contains("java.net.http.HttpRequest");
    }

    // True when `node` is the receiver expression of an enclosing method invocation
    // (the `recv` in `recv.method(...)`), i.e. an inner link of a fluent chain.
    private static boolean isReceiverOfEnclosingCall(TreePath path) {
        TreePath parentPath = path.getParentPath();
        if (parentPath == null || !(parentPath.getLeaf() instanceof MemberSelectTree)) return false;
        MemberSelectTree sel = (MemberSelectTree) parentPath.getLeaf();
        if (sel.getExpression() != path.getLeaf()) return false;
        TreePath grandPath = parentPath.getParentPath();
        return grandPath != null && grandPath.getLeaf() instanceof MethodInvocationTree;
    }

    // Source text of the enclosing method, or the enclosing class for field initializers.
    private static String enclosingScopeText(TreePath path, JavaUnit u) {
        Tree method = null, cls = null;
        for (TreePath cur = path; cur != null; cur = cur.getParentPath()) {
            Tree leaf = cur.getLeaf();
            if (method == null && leaf instanceof MethodTree) method = leaf;
            if (leaf instanceof ClassTree) { cls = leaf; break; }
        }
        Tree scope = method != null ? method : cls;
        return scope != null ? u.snippetOf(scope) : "";
    }

    private static boolean containsAny(String haystack, String[] needles) {
        for (String n : needles) if (haystack.contains(n)) return true;
        return false;
    }
}
