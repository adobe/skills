package analyzer;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.Trees;
import analyzer.util.Annotations;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

public final class JavaUnit {
    public final Path path;
    public final String rel;
    public final String source;
    public final CompilationUnitTree cu;
    public final SourcePositions sp;
    public final Map<String, String> imports = new HashMap<>(); // simple -> fqn
    public final java.util.List<String> wildcards = new java.util.ArrayList<>(); // wildcard pkg prefixes
    public final String pkg; // this file's package, or "" if none

    public JavaUnit(Path path, String rel, String source, CompilationUnitTree cu, Trees trees) {
        this.path = path; this.rel = rel; this.source = source; this.cu = cu;
        this.sp = trees.getSourcePositions();
        this.pkg = cu.getPackageName() == null ? "" : cu.getPackageName().toString();
        for (ImportTree imp : cu.getImports()) {
            String q = imp.getQualifiedIdentifier().toString();
            if (q.endsWith(".*")) wildcards.add(q.substring(0, q.length() - 2));
            else imports.put(Annotations.simpleName(q), q);
        }
    }

    public long lineOf(Tree t) {
        long pos = sp.getStartPosition(cu, t);
        return pos < 0 ? -1 : cu.getLineMap().getLineNumber(pos);
    }

    public String snippetOf(Tree t) {
        long s = sp.getStartPosition(cu, t), e = sp.getEndPosition(cu, t);
        if (s >= 0 && e > s && e <= source.length()) return source.substring((int) s, (int) e).trim();
        return t.toString().trim();
    }
}
