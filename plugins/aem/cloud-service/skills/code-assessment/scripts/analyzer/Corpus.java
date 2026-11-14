package analyzer;

import java.nio.file.Path;
import java.util.List;

public final class Corpus {
    public final Path root;
    public final List<JavaUnit> java;
    public final List<PomUnit> poms;
    public final List<OsgiUnit> osgi;
    public final boolean allowAll;   // run flag: --all disables detector allowlists
    public Corpus(Path root, List<JavaUnit> java, List<PomUnit> poms, List<OsgiUnit> osgi, boolean allowAll) {
        this.root = root; this.java = java; this.poms = poms; this.osgi = osgi; this.allowAll = allowAll;
    }
}
