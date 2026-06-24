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

// Detects legacy event sources that migrate to the lightweight EventHandler + JobConsumer split.
// Matches the BPA BpaSubtypeConfig taxonomy: both javax.jcr.observation.EventListener and
// org.osgi.service.event.EventHandler map to this pattern. Fine-grained routing (a resource-topic
// EventHandler or a content-observing JCR listener belongs in resource-change-listener) is handled
// downstream by the guide's cross-links, mirroring BPA's class-level detection granularity.
// Limitation: matches a direct `implements` clause only (parse-level, no type hierarchy) — a class
// that reaches the interface via an abstract base or a project interface that extends it is missed.
public final class EventMigration implements Detector {
    static final String OSGI_EVENT_HANDLER_FQN = "org.osgi.service.event.EventHandler";
    static final String JCR_EVENT_LISTENER_FQN = "javax.jcr.observation.EventListener";

    public String pattern() { return "event-migration"; }
    public boolean needsPoms() { return false; }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            new TreePathScanner<Void, Void>() {
                public Void visitClass(ClassTree cls, Void p) {
                    for (Tree iface : cls.getImplementsClause()) {
                        String name = iface.toString();
                        if (Types.resolvesTo(name, OSGI_EVENT_HANDLER_FQN, u)
                                || Types.resolvesTo(name, JCR_EVENT_LISTENER_FQN, u)) {
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
