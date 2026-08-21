package analyzer.util;

import analyzer.JavaUnit;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.Tree;

import javax.lang.model.element.Modifier;

public final class Types {
    private Types() {}

    public static boolean resolvesTo(String written, String fqn, JavaUnit u) {
        if (written == null) return false;
        int dot = fqn.lastIndexOf('.');
        String targetPkg = dot < 0 ? "" : fqn.substring(0, dot);
        String targetSimple = Annotations.simpleName(fqn);
        String writtenSimple = Annotations.simpleName(written);
        if (!writtenSimple.equals(targetSimple)) return false;
        if (written.contains(".")) return written.equals(fqn);
        String imp = u.imports.get(writtenSimple);
        if (imp != null) return imp.equals(fqn);
        for (String w : u.wildcards) if ((w + "." + writtenSimple).equals(fqn)) return true;
        // java.lang is auto-imported. A same-package type whose simple name collides with a
        // java.lang type and is used without an explicit import would also resolve true here —
        // accepted given how rare that is and that the analyzer is parse-level (no symbol table).
        if ("java.lang".equals(targetPkg)) return true;
        return u.pkg.equals(targetPkg);
    }

    public static String classHeader(JavaUnit u, ClassTree cls) {
        String s = u.snippetOf(cls);
        int brace = s.indexOf('{');
        return brace > 0 ? s.substring(0, brace).trim() : s;
    }

    public static boolean importsType(JavaUnit u, String fqn) {
        String simple = Annotations.simpleName(fqn);
        int dot = fqn.lastIndexOf('.');
        String pkg = dot < 0 ? "" : fqn.substring(0, dot);
        String imp = u.imports.get(simple);
        if (imp != null && imp.equals(fqn)) return true;
        for (String w : u.wildcards) if (w.equals(pkg)) return true;
        return false;
    }

    // The representative top-level type for a file: the public one if present, else the first.
    // Used by file-level (import/package-based) detectors to emit a single deterministic finding
    // instead of one per class. Returns null for a file with no top-level type declaration.
    public static ClassTree primaryType(CompilationUnitTree cu) {
        ClassTree first = null;
        for (Tree t : cu.getTypeDecls()) {
            if (t instanceof ClassTree) {
                ClassTree ct = (ClassTree) t;
                if (first == null) first = ct;
                if (ct.getModifiers().getFlags().contains(Modifier.PUBLIC)) return ct;
            }
        }
        return first;
    }
}
