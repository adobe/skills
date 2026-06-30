package analyzer;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.Trees;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticListener;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

public final class Analyze {
    static final Set<String> SKIP_DIRS = new HashSet<>(Arrays.asList(
        "target", "build", "dist", "node_modules", ".git", ".idea", ".vscode", ".autofix"));

    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            System.err.println("usage: Analyze <root> [--pattern <slug>] [--files a,b]");
            System.exit(2);
        }
        if (args[0].equals("--list-patterns")) {
            for (Detector d : Registry.all()) System.out.println(d.pattern());
            return;
        }
        if (ToolProvider.getSystemJavaCompiler() == null) {
            System.err.println("error: JDK required (no system Java compiler found)");
            System.exit(3);
        }
        Path root = Paths.get(args[0]).toAbsolutePath().normalize();
        String only = null; List<String> fileList = null;
        boolean allowAll = false;
        for (int i = 1; i < args.length; i++) {
            if (args[i].equals("--pattern") && i + 1 < args.length) only = args[++i];
            else if (args[i].equals("--files") && i + 1 < args.length) fileList = Arrays.asList(args[++i].split(","));
            else if (args[i].equals("--all")) allowAll = true;
        }
        final String onlyF = only;
        List<Detector> dets = Registry.all().stream()
            .filter(d -> onlyF == null || d.pattern().equals(onlyF))
            .collect(Collectors.toList());

        List<String> warnings = new ArrayList<>();
        boolean unknownPattern = onlyF != null && dets.isEmpty();
        if (unknownPattern) warnings.add("unknown-pattern: " + onlyF);

        List<Path> javaFiles = new ArrayList<>(), pomFiles = new ArrayList<>(), osgiFiles = new ArrayList<>();
        if (fileList != null) {
            for (String f : fileList) {
                Path p = root.resolve(f.trim()).normalize();
                if (!p.startsWith(root)) { warnings.add("outside-workspace: " + f.trim()); continue; }
                String n = p.getFileName().toString();
                if (n.endsWith(".java")) javaFiles.add(p);
                else if (n.equals("pom.xml")) pomFiles.add(p);
                else if (isOsgiConfig(n)) osgiFiles.add(p);
            }
        } else {
            collect(root, javaFiles, pomFiles, osgiFiles);
        }

        boolean anyJava = dets.stream().anyMatch(Detector::needsJava);
        boolean anyPoms = dets.stream().anyMatch(Detector::needsPoms);
        boolean anyOsgi = dets.stream().anyMatch(Detector::needsOsgi);
        List<JavaUnit> javaUnits = anyJava ? parseJava(root, javaFiles, warnings) : new ArrayList<>();
        List<PomUnit> pomUnits = anyPoms ? parsePoms(root, pomFiles, warnings) : new ArrayList<>();
        List<OsgiUnit> osgiUnits = anyOsgi ? parseOsgi(root, osgiFiles, warnings) : new ArrayList<>();
        Corpus corpus = new Corpus(root, javaUnits, pomUnits, osgiUnits, allowAll);

        List<Finding> out = new ArrayList<>();
        for (Detector d : dets) {
            try { d.detect(corpus, out, warnings); }
            catch (Exception ex) { warnings.add("detector-error: " + d.pattern() + " — " + ex.getClass().getSimpleName()); }
        }
        out.sort(Comparator.comparing((Finding f) -> f.file).thenComparingLong(f -> f.line).thenComparing(f -> f.pattern));
        String json = toJson(out, warnings);
        System.out.println(json);
        writeDump(root, json);
        if (unknownPattern) System.exit(4);
    }

    static void writeDump(Path root, String json) {
        try {
            Path dir = root.resolve(".autofix");
            Files.createDirectories(dir);
            Path gi = dir.resolve(".gitignore");
            if (!Files.exists(gi)) Files.write(gi, "*\n".getBytes(StandardCharsets.UTF_8));
            Files.write(dir.resolve("analyzer-output.json"), json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            System.err.println("warn: could not write .autofix/analyzer-output.json — " + ex.getClass().getSimpleName());
        }
    }

    static boolean isOsgiConfig(String name) {
        return name.endsWith(".cfg") || name.endsWith(".cfg.json") || name.endsWith(".config");
    }

    static void collect(Path root, List<Path> javaFiles, List<Path> poms, List<Path> osgiFiles) throws java.io.IOException {
        if (!Files.exists(root)) return;
        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes a) {
                return SKIP_DIRS.contains(dir.getFileName().toString())
                    ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
            }
            public FileVisitResult visitFile(Path f, BasicFileAttributes a) {
                String n = f.getFileName().toString();
                if (n.endsWith(".java")) javaFiles.add(f);
                else if (n.equals("pom.xml")) poms.add(f);
                else if (isOsgiConfig(n)) osgiFiles.add(f);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    static List<OsgiUnit> parseOsgi(Path root, List<Path> files, List<String> warnings) {
        List<OsgiUnit> units = new ArrayList<>();
        for (Path f : files) {
            String rel = safeRel(root, f);
            String pid = OsgiUnit.pidFromFilename(f.getFileName().toString());
            units.add(new OsgiUnit(f, rel, pid));
        }
        return units;
    }

    static String safeRel(Path root, Path p) {
        try { return root.relativize(p).toString(); } catch (Exception e) { return p.toString(); }
    }

    static List<JavaUnit> parseJava(Path root, List<Path> files, List<String> warnings) {
        List<JavaUnit> units = new ArrayList<>();
        for (Path f : files) if (!Files.exists(f)) warnings.add("parse-skip: " + safeRel(root, f) + " — not found");
        List<File> existing = files.stream().filter(Files::exists).map(Path::toFile).collect(Collectors.toList());
        if (existing.isEmpty()) return units;
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        StandardJavaFileManager fm = compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8);
        Set<String> errored = new HashSet<>();
        DiagnosticListener<JavaFileObject> dl = diag -> {
            if (diag.getKind() == Diagnostic.Kind.ERROR && diag.getSource() != null)
                errored.add(diag.getSource().getName());
        };
        try {
            Iterable<? extends JavaFileObject> objs = fm.getJavaFileObjectsFromFiles(existing);
            JavacTask task = (JavacTask) compiler.getTask(null, fm, dl, Collections.emptyList(), null, objs);
            Trees trees = Trees.instance(task);
            List<CompilationUnitTree> cus = new ArrayList<>();
            for (CompilationUnitTree cu : task.parse()) cus.add(cu);
            for (CompilationUnitTree cu : cus) {
                Path p = Paths.get(cu.getSourceFile().toUri());
                String rel = safeRel(root, p);
                if (errored.contains(cu.getSourceFile().getName())) {
                    warnings.add("parse-skip: " + rel + " — syntax error");
                    continue;
                }
                try {
                    String src = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
                    units.add(new JavaUnit(p, rel, src, cu, trees));
                } catch (Exception ex) {
                    warnings.add("parse-skip: " + rel + " — " + ex.getClass().getSimpleName());
                }
            }
        } catch (Exception ex) {
            warnings.add("parse-error: " + ex.getClass().getSimpleName());
        }
        return units;
    }

    static List<PomUnit> parsePoms(Path root, List<Path> files, List<String> warnings) {
        List<PomUnit> units = new ArrayList<>();
        for (Path pom : files) {
            String rel = safeRel(root, pom);
            try { units.add(PomUnit.parse(pom, rel)); }
            catch (Exception ex) { warnings.add("parse-skip: " + rel + " — " + ex.getClass().getSimpleName()); }
        }
        return units;
    }

    static String toJson(List<Finding> findings, List<String> warnings) {
        StringBuilder b = new StringBuilder("{\"findings\":[");
        for (int i = 0; i < findings.size(); i++) {
            Finding f = findings.get(i);
            if (i > 0) b.append(",");
            b.append("{\"pattern\":").append(q(f.pattern))
             .append(",\"file\":").append(q(f.file))
             .append(",\"line\":").append(f.line)
             .append(",\"snippet\":").append(q(f.snippet)).append("}");
        }
        b.append("],\"warnings\":[");
        for (int i = 0; i < warnings.size(); i++) { if (i > 0) b.append(","); b.append(q(warnings.get(i))); }
        return b.append("]}").toString();
    }

    static String q(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n");  break;
                case '\r': b.append("\\r");  break;
                case '\t': b.append("\\t");  break;
                default:   if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append("\"").toString();
    }
}
