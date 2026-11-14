package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.util.Types;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.TreePathScanner;

import java.util.List;

// Detects usage of the modern ResourceChangeListener API (BPA subtype
// org.apache.sling.api.resource.observation.ResourceChangeListener) so the listener
// can be reviewed for the CS-required lightweight + JobConsumer pattern.
// Legacy javax.jcr.observation.EventListener migration is handled by the EventMigration
// detector, matching the BPA BpaSubtypeConfig taxonomy.
// Limitation: matches a direct `implements` clause only (parse-level, no type hierarchy) — a class
// that reaches the interface via an abstract base or a project interface that extends it is missed.
public final class ResourceChangeListener implements Detector {
    static final String RCL_FQN          = "org.apache.sling.api.resource.observation.ResourceChangeListener";
    static final String EXTERNAL_RCL_FQN = "org.apache.sling.api.resource.observation.ExternalResourceChangeListener";

    public String pattern() { return "resource-change-listener"; }
    public boolean needsPoms() { return false; }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            new TreePathScanner<Void, Void>() {
                public Void visitClass(ClassTree cls, Void p) {
                    for (Tree iface : cls.getImplementsClause()) {
                        String name = iface.toString();
                        if (Types.resolvesTo(name, RCL_FQN, u)
                                || Types.resolvesTo(name, EXTERNAL_RCL_FQN, u)) {
                            out.add(new Finding(pattern(), u.rel, u.lineOf(cls), Types.classHeader(u, cls)));
                            break;
                        }
                    }
                    return super.visitClass(cls, p);
                }
            }.scan(u.cu, null);
        }
    }
}
