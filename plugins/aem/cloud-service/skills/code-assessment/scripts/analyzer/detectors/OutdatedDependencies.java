package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.PomUnit;
import analyzer.util.Poms;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class OutdatedDependencies implements Detector {
    public String pattern() { return "outdated-dependencies"; }
    public boolean needsJava() { return false; }   // pom-only detector

    // Allowlist — add "groupId:artifactId", or "groupId:prefix*" for a family. analyze.sh recompiles on edit.
    static final String[] ALLOWLIST = {
        "com.adobe.aem:aem-sdk-api",
        "org.mockito:*",
    };
    static boolean allowed(String groupId, String artifactId) {
        String coord = (groupId != null ? groupId : "") + ":" + artifactId;
        for (String e : ALLOWLIST) {
            if (e.endsWith("*")) { if (coord.startsWith(e.substring(0, e.length() - 1))) return true; }
            else if (coord.equals(e)) return true;
        }
        return false;
    }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (PomUnit pom : c.poms) {
            Map<String, Integer> cursor = new HashMap<>();
            NodeList deps = pom.doc.getElementsByTagName("dependency");
            for (int i = 0; i < deps.getLength(); i++) {
                Element d = (Element) deps.item(i);
                if (Poms.underAny(d, "build", "plugin", "pluginManagement", "reporting")) continue;
                String g = Poms.childText(d, "groupId");
                String a = Poms.childText(d, "artifactId");
                String v = Poms.childText(d, "version");
                if (a == null || v == null) continue;             // version-less (inherited)
                if (Poms.isReactorVersion(v)) continue;           // intra-reactor self-ref
                if (!c.allowAll && !allowed(g, a)) continue; // allowlist scope (bypass with --all)
                long ln = Poms.findLine(pom.lines, "<artifactId>" + a + "</artifactId>", cursor);
                String coord = (g != null ? g : "?") + ":" + a + "@" + v;
                if (ln < 0) warnings.add("line-unresolved: " + coord + " in " + pom.rel);
                out.add(new Finding(pattern(), pom.rel, ln, coord));
            }
        }
    }
}
