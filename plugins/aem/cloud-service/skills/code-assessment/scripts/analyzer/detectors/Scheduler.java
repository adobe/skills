package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.util.Annotations;
import analyzer.util.Types;
import com.sun.source.tree.AnnotationTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.TreePathScanner;

import java.util.List;

public final class Scheduler implements Detector {
    static final String SCHEDULER_FQN = "org.apache.sling.commons.scheduler.Scheduler";
    static final String JOB_FQN       = "org.apache.sling.commons.scheduler.Job";
    static final String RUNNABLE_FQN  = "java.lang.Runnable";
    static final String COMPONENT_FQN = "org.osgi.service.component.annotations.Component";

    // OSGi DS property keys that identify a class as a Sling Scheduler component.
    static final String[] SCHEDULER_PROPERTIES = {
        "scheduler.expression", "scheduler.name", "scheduler.period"
    };

    public String pattern() { return "scheduler"; }
    public boolean needsPoms() { return false; }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            // Class-level signals: a class that implements the legacy Job interface, or the
            // OSGi-property scheduler pattern (Runnable + @Component with a scheduler.* property).
            final boolean[] classLevelMatch = {false};
            new TreePathScanner<Void, Void>() {
                public Void visitClass(ClassTree cls, Void p) {
                    if (implementsLegacyJob(cls, u) || isOsgiPropertyScheduler(cls, u)) {
                        out.add(new Finding(pattern(), u.rel, u.lineOf(cls), Types.classHeader(u, cls)));
                        classLevelMatch[0] = true;
                    }
                    return super.visitClass(cls, p);
                }
            }.scan(u.cu, null);

            // File-level signal: the Scheduler API is imported but no class implements a scheduler
            // interface (programmatic use via @Reference Scheduler). Attribute one finding to the
            // file's primary type rather than flagging every class in the file.
            if (!classLevelMatch[0] && Types.importsType(u, SCHEDULER_FQN)) {
                ClassTree primary = Types.primaryType(u.cu);
                if (primary != null) {
                    out.add(new Finding(pattern(), u.rel, u.lineOf(primary), Types.classHeader(u, primary)));
                }
            }
        }
    }

    // Direct `implements` clause only (parse-level, no type hierarchy): a class reaching Job via an
    // abstract base or an interface that extends it is missed.
    static boolean implementsLegacyJob(ClassTree cls, JavaUnit u) {
        for (Tree iface : cls.getImplementsClause()) {
            if (Types.resolvesTo(iface.toString(), JOB_FQN, u)) return true;
        }
        return false;
    }

    // implements Runnable + an import-aware OSGi @Component whose source declares a scheduler.* property.
    // Soft spots (both rare, kept safe by the import-aware @Component gate): a property whose value is
    // a constant (property = SchedulerConstants.EXPRESSION) won't contain the literal and is missed;
    // an unrelated property string that happens to contain "scheduler.name" would false-match.
    static boolean isOsgiPropertyScheduler(ClassTree cls, JavaUnit u) {
        boolean implementsRunnable = false;
        for (Tree iface : cls.getImplementsClause()) {
            if (Types.resolvesTo(iface.toString(), RUNNABLE_FQN, u)) { implementsRunnable = true; break; }
        }
        if (!implementsRunnable) return false;
        if (!Annotations.hasAnnotation(cls.getModifiers(), "Component", COMPONENT_FQN, u)) return false;
        for (AnnotationTree a : cls.getModifiers().getAnnotations()) {
            if (!Annotations.simpleName(a.getAnnotationType().toString()).equals("Component")) continue;
            String src = a.toString();
            for (String key : SCHEDULER_PROPERTIES) {
                if (src.contains(key)) return true;
            }
        }
        return false;
    }
}
