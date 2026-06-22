package analyzer.util;

import com.sun.source.tree.AnnotationTree;
import com.sun.source.tree.ModifiersTree;
import analyzer.JavaUnit;

public final class Annotations {
    private Annotations() {}

    public static String simpleName(String fqn) {
        int i = fqn.lastIndexOf('.');
        return i < 0 ? fqn : fqn.substring(i + 1);
    }

    public static boolean hasAnnotation(ModifiersTree mods, String simple, String fqn, JavaUnit u) {
        int dot = fqn.lastIndexOf('.');
        String targetPkg = dot < 0 ? "" : fqn.substring(0, dot);
        for (AnnotationTree a : mods.getAnnotations()) {
            String written = a.getAnnotationType().toString();
            if (!simpleName(written).equals(simple)) continue;
            if (written.contains(".")) return written.equals(fqn);          // fully-qualified in source
            String imp = u.imports.get(simple);
            if (imp != null) return imp.equals(fqn);                        // explicit import
            for (String w : u.wildcards) if ((w + "." + simple).equals(fqn)) return true; // wildcard package
            return u.pkg.equals(targetPkg);                                 // same package as target only
        }
        return false;
    }
}
