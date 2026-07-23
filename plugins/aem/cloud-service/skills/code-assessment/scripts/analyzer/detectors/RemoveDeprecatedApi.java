package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import com.sun.source.tree.ImportTree;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Detects Java imports of packages the AEM Analyser Maven Plugin has flagged as
 * deprecated in the target project.
 *
 * <p>Rules are <b>loaded dynamically</b> from a TSV cache produced by the
 * preflight step ({@code remove-deprecated-api/scripts/detect.sh}). Each cache
 * row is {@code <package>\t<hint>\t<for_removal_date>}. If the cache is
 * missing (preflight not run, or offline), the detector emits a single warning
 * and no findings — the recipe steps direct the user to run detect.sh first.
 *
 * <p>Lookup order for the cache path:
 * <ol>
 *   <li>{@code AEM_DEPRECATED_API_RULES} environment variable</li>
 *   <li>{@code $TMPDIR/aem-code-assessment/deprecated-api-rules.tsv}</li>
 *   <li>{@code /tmp/aem-code-assessment/deprecated-api-rules.tsv} (when TMPDIR unset)</li>
 * </ol>
 *
 * <p>Only past-due deprecations reach the cache — detect.sh filters by the
 * plugin's log output, and {@code for-removal} dates in the future are dropped
 * by the plugin itself. As a defence-in-depth, the detector also skips rules
 * whose {@code for_removal} is after today.
 */
public final class RemoveDeprecatedApi implements Detector {

    public String pattern() { return "remove-deprecated-api"; }
    public boolean needsPoms() { return false; }
    public boolean needsOsgi() { return false; }

    static final class Rule {
        final String hint;
        final String forRemoval; // ISO-8601 date, may be empty
        Rule(String hint, String forRemoval) { this.hint = hint; this.forRemoval = forRemoval; }
    }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        Path cachePath = resolveCachePath();
        Map<String, Rule> rules;
        try {
            rules = loadRules(cachePath);
        } catch (IOException ioe) {
            warnings.add("deprecated-api-rules-read-error: " + cachePath + " — " + ioe.getClass().getSimpleName());
            return;
        }
        if (rules == null) {
            warnings.add("deprecated-api-rules-missing: expected TSV at " + cachePath
                + " — run remove-deprecated-api/scripts/detect.sh preflight first");
            return;
        }
        if (rules.isEmpty()) {
            // Preflight ran and reported no past-due deprecations — nothing to flag.
            return;
        }

        LocalDate today = LocalDate.now();

        for (JavaUnit u : c.java) {
            for (ImportTree imp : u.cu.getImports()) {
                String q = imp.getQualifiedIdentifier().toString();
                Rule matched = longestPrefixMatch(q, rules);
                if (matched == null) continue;
                if (!isPastDue(matched.forRemoval, today) && !c.allowAll) continue;
                out.add(new Finding(pattern(), u.rel, u.lineOf(imp), q, matched.hint));
            }
        }
    }

    /** Longest-prefix match of a fully-qualified import against the rule keys. */
    private static Rule longestPrefixMatch(String fqn, Map<String, Rule> rules) {
        String[] parts = fqn.split("\\.");
        for (int i = parts.length; i > 0; i--) {
            StringBuilder sb = new StringBuilder(parts[0]);
            for (int j = 1; j < i; j++) sb.append('.').append(parts[j]);
            Rule r = rules.get(sb.toString());
            if (r != null) return r;
        }
        return null;
    }

    private static boolean isPastDue(String iso, LocalDate today) {
        if (iso == null || iso.isEmpty()) return true; // empty = already enforced
        try { return !LocalDate.parse(iso).isAfter(today); }
        catch (DateTimeParseException ex) { return true; } // unparseable → treat as active
    }

    /** Resolve the rules-cache path in preference order (env → TMPDIR → /tmp). */
    private static Path resolveCachePath() {
        String override = System.getenv("AEM_DEPRECATED_API_RULES");
        if (override != null && !override.isEmpty()) return Paths.get(override);
        String tmp = System.getenv("TMPDIR");
        if (tmp == null || tmp.isEmpty()) tmp = "/tmp";
        return Paths.get(tmp, "aem-code-assessment", "deprecated-api-rules.tsv");
    }

    /**
     * Read the TSV rule cache. Returns {@code null} if the file does not exist;
     * an empty map if the file exists but contains no rules (preflight found no
     * past-due deprecations).
     */
    private static Map<String, Rule> loadRules(Path cachePath) throws IOException {
        if (!Files.exists(cachePath)) return null;
        Map<String, Rule> out = new LinkedHashMap<>();
        try (BufferedReader br = Files.newBufferedReader(cachePath, StandardCharsets.UTF_8)) {
            String line;
            while ((line = br.readLine()) != null) {
                if (line.isEmpty() || line.startsWith("#")) continue;
                String[] parts = line.split("\t", -1);
                if (parts.length < 1) continue;
                String pkg = parts[0].trim();
                if (pkg.isEmpty()) continue;
                String hint = parts.length > 1 ? parts[1] : "";
                String forRemoval = parts.length > 2 ? parts[2].trim() : "";
                out.put(pkg, new Rule(hint, forRemoval));
            }
        }
        return out;
    }
}
