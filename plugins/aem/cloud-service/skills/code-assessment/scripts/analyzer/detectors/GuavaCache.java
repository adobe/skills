package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import com.sun.source.tree.ImportTree;

import java.util.List;

/**
 * guava-cache — a bundle importing {@code com.google.common.cache.*} (Guava's in-process cache
 * API). On AEM as a Cloud Service the supported in-process cache library is Caffeine
 * ({@code com.github.benmanes.caffeine.cache.*}); Guava cache is flagged because Guava is shrinking
 * in the CS uber-jar and relying on {@code com.google.common.cache} from a third-party classloader
 * is unstable. The remediation is a near-1:1 swap (pom dependency + imports + a few API call sites).
 *
 * <p>Parse-level and import-anchored: it flags each {@code import com.google.common.cache.…}
 * (explicit type or the package wildcard {@code .*}). Other Guava packages
 * ({@code com.google.common.collect} / {@code .base} / …) are out of scope, and look-alike cache
 * classes from other packages (e.g. {@code io.micrometer…cache.GuavaCacheMetrics}) are not matched
 * because the prefix is exact — avoiding the known BPA false positive.
 */
public final class GuavaCache implements Detector {

    public String pattern() { return "guava-cache"; }
    public boolean needsPoms() { return false; }   // Java-only detector (import-anchored)

    private static final String GUAVA_CACHE_PKG = "com.google.common.cache.";

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            for (ImportTree imp : u.cu.getImports()) {
                String q = imp.getQualifiedIdentifier().toString();
                if (q.startsWith(GUAVA_CACHE_PKG)) {
                    out.add(new Finding(pattern(), u.rel, u.lineOf(imp), u.snippetOf(imp)));
                }
            }
        }
    }
}
