package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.util.Types;
import com.sun.source.tree.ClassTree;

import java.util.List;

public final class Replication implements Detector {
    static final String CQ_REPLICATOR_FQN = "com.day.cq.replication.Replicator";
    static final String SLING_REPL_PKG    = "org.apache.sling.replication";

    public String pattern() { return "replication"; }
    public boolean needsPoms() { return false; }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            boolean usesLegacy = Types.importsType(u, CQ_REPLICATOR_FQN)
                              || u.imports.values().stream().anyMatch(i -> i.startsWith(SLING_REPL_PKG + "."))
                              || u.wildcards.stream().anyMatch(w -> w.equals(SLING_REPL_PKG) || w.startsWith(SLING_REPL_PKG + "."));
            if (!usesLegacy) continue;
            // File-level signal — emit one finding attributed to the file's primary type
            // (deterministic), not the first class the scanner happens to visit.
            ClassTree primary = Types.primaryType(u.cu);
            if (primary != null) {
                out.add(new Finding(pattern(), u.rel, u.lineOf(primary), Types.classHeader(u, primary)));
            }
        }
    }
}
