package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.util.Annotations;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.TreePathScanner;

import java.util.List;

public final class InjectInSlingModel implements Detector {
    static final String MODEL_FQN          = "org.apache.sling.models.annotations.Model";
    static final String INJECT_FQN         = "javax.inject.Inject";
    static final String JAKARTA_INJECT_FQN = "jakarta.inject.Inject";

    public String pattern() { return "inject-in-sling-model"; }
    public boolean needsPoms() { return false; }   // Java-only detector

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            new TreePathScanner<Void, Void>() {
                public Void visitClass(ClassTree cls, Void p) {
                    if (Annotations.hasAnnotation(cls.getModifiers(), "Model", MODEL_FQN, u)) {
                        for (Tree m : cls.getMembers()) {
                            if (m instanceof VariableTree) {
                                VariableTree f = (VariableTree) m;
                                if (Annotations.hasAnnotation(f.getModifiers(), "Inject", INJECT_FQN, u)
                                        || Annotations.hasAnnotation(f.getModifiers(), "Inject", JAKARTA_INJECT_FQN, u)) {
                                    out.add(new Finding(pattern(), u.rel, u.lineOf(f), u.snippetOf(f)));
                                }
                            }
                        }
                    }
                    return super.visitClass(cls, p);
                }
            }.scan(u.cu, null);
        }
    }
}
