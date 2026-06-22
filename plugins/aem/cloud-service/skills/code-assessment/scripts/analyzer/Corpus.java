package analyzer;

import java.nio.file.Path;
import java.util.List;

public final class Corpus {
    public final Path root;
    public final List<JavaUnit> java;
    public final List<PomUnit> poms;
    public final boolean allowAll;   // run flag: --all disables detector allowlists
    public Corpus(Path root, List<JavaUnit> java, List<PomUnit> poms, boolean allowAll) {
        this.root = root; this.java = java; this.poms = poms; this.allowAll = allowAll;
    }
}
