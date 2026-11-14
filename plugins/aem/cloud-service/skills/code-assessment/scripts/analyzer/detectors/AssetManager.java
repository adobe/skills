package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.util.Types;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.util.TreePathScanner;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class AssetManager implements Detector {
    static final String ASSET_MANAGER_FQN = "com.day.cq.dam.api.AssetManager";

    // AEMaaCS-incompatible AssetManager methods + the createAsset path that should move to Direct Binary Access.
    static final Set<String> LEGACY_METHODS = new HashSet<>(Arrays.asList(
        "createAssetForBinary",
        "getAssetForBinary",
        "removeAssetForBinary",
        "createAsset"
    ));

    public String pattern() { return "asset-manager"; }
    public boolean needsPoms() { return false; }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            if (!Types.importsType(u, ASSET_MANAGER_FQN)) continue;
            // Heuristic: gate on the file importing AssetManager, then match calls by method name.
            // Parse-level only (no symbol table), so the receiver type is not verified — a call to
            // an unrelated object's createAsset(...) in a file that also imports AssetManager would
            // match. Accepted as a known limitation; the import gate keeps false positives rare.
            // Granularity: this detector emits ONE finding per matching call site (each legacy call
            // is individually actionable), unlike the class/file-level detectors that emit one per
            // type. A class with three legacy calls yields three findings.
            new TreePathScanner<Void, Void>() {
                public Void visitMethodInvocation(MethodInvocationTree mit, Void p) {
                    if (mit.getMethodSelect() instanceof MemberSelectTree) {
                        MemberSelectTree mst = (MemberSelectTree) mit.getMethodSelect();
                        String name = mst.getIdentifier().toString();
                        if (LEGACY_METHODS.contains(name)) {
                            out.add(new Finding(pattern(), u.rel, u.lineOf(mit), u.snippetOf(mit)));
                        }
                    }
                    return super.visitMethodInvocation(mit, p);
                }
            }.scan(u.cu, null);
        }
    }
}
