package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Callable;
import java.util.stream.Stream;

@CommandLine.Command(name = "analyze",
                     description = "Analyze project for migration blockers and warnings")
public class AnalyzeCommand implements Callable<Integer> {

    @CommandLine.Option(names = {"--repository-path", "-r"},
                        description = "Path to the AEM Maven project", required = true)
    private File repositoryPath;

    private static final String[] UNSUPPORTED_PACKAGES = {
        "com.adobe.cq.commerce.", "com.adobe.cq.social.", "com.adobe.granite.social.",
        "com.adobe.cq.screens.", "com.adobe.cq.sample.we.retail.",
        "com.day.cq.dam.pim.", "com.day.cq.dam.rating.",
        "com.adobe.cq.searchpromote.", "com.adobe.cq.mcm.campaign."
    };

    private static final String[] REMOVED_BUNDLE_PACKAGES = {
        "com.google.common.", "com.github.benmanes.caffeine.",
        "org.eclipse.jetty."
    };

    @Override
    public Integer call() throws Exception {
        System.out.println("=== AEM 6.5 LTS Pre-Migration Analysis ===");
        System.out.println("Repository: " + repositoryPath.getAbsolutePath());
        System.out.println();

        if (!repositoryPath.exists() || !new File(repositoryPath, "pom.xml").exists()) {
            System.err.println("[FAIL] Invalid project: no pom.xml found.");
            return 2;
        }

        // Detect Java version
        System.out.println("[1/4] Detecting current Java version...");
        String javaVersion = detectJavaVersion();
        System.out.println("       Detected: Java " + javaVersion);

        // Scan for unsupported packages
        System.out.println("[2/4] Scanning for unsupported packages...");
        int blockers = scanForPackages(UNSUPPORTED_PACKAGES, "BLOCKER", true);

        // Scan for removed bundles
        System.out.println("[3/4] Scanning for removed bundle dependencies...");
        int warnings = scanForPackages(REMOVED_BUNDLE_PACKAGES, "WARNING", false);

        // Check project structure
        System.out.println("[4/4] Validating project structure...");
        boolean hasGit = new File(repositoryPath, ".git").exists();
        boolean hasCM = new File(repositoryPath, ".cloudmanager").exists();
        System.out.println("       Git repository: " + (hasGit ? "yes" : "no"));
        System.out.println("       CloudManager config: " + (hasCM ? "yes" : "no"));

        // Summary
        System.out.println();
        System.out.println("=== Analysis Summary ===");
        System.out.println("Source Java version: " + javaVersion);
        System.out.println("Blockers found: " + blockers);
        System.out.println("Warnings found: " + warnings);

        if (blockers > 0) {
            System.err.println();
            System.err.println("[HARD STOP] Migration cannot proceed — unsupported packages detected.");
            return 2;
        } else if (warnings > 0) {
            System.out.println();
            System.out.println("[READY WITH WARNINGS] Migration can proceed but manual remediation needed.");
            return 1;
        } else {
            System.out.println();
            System.out.println("[READY] Project is ready for migration.");
            return 0;
        }
    }

    private String detectJavaVersion() throws IOException {
        // Check .cloudmanager/java-version first
        Path cmFile = repositoryPath.toPath().resolve(".cloudmanager/java-version");
        if (Files.exists(cmFile)) {
            String version = new String(Files.readAllBytes(cmFile)).trim();
            if (!version.isEmpty()) return version;
        }

        // Check pom.xml for maven.compiler.source property
        Path pomPath = repositoryPath.toPath().resolve("pom.xml");
        String pomContent = new String(Files.readAllBytes(pomPath));

        // Simple XML scanning for common patterns
        String[] patterns = {"maven.compiler.source", "maven.compiler.release"};
        for (String prop : patterns) {
            int idx = pomContent.indexOf("<" + prop + ">");
            if (idx >= 0) {
                int start = idx + prop.length() + 2;
                int end = pomContent.indexOf("</" + prop + ">", start);
                if (end > start) {
                    return pomContent.substring(start, end).trim();
                }
            }
        }

        // Check maven-compiler-plugin configuration
        if (pomContent.contains("<source>") && pomContent.contains("maven-compiler-plugin")) {
            int pluginIdx = pomContent.indexOf("maven-compiler-plugin");
            int sourceIdx = pomContent.indexOf("<source>", pluginIdx);
            if (sourceIdx >= 0) {
                int start = sourceIdx + 8;
                int end = pomContent.indexOf("</source>", start);
                if (end > start) {
                    String val = pomContent.substring(start, end).trim();
                    if (!val.startsWith("$")) return val;
                }
            }
        }

        return "8"; // Default assumption
    }

    private int scanForPackages(String[] packages, String severity, boolean isBlocker) throws IOException {
        int count = 0;
        Stream<Path> javaFiles = Files.walk(repositoryPath.toPath())
                .filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !p.toString().contains("/target/"));
        try {
            for (Path javaFile : (Iterable<Path>) javaFiles::iterator) {
                String content = new String(Files.readAllBytes(javaFile));
                for (String pkg : packages) {
                    if (content.contains("import " + pkg)) {
                        String relativePath = repositoryPath.toPath().relativize(javaFile).toString();
                        System.out.println("  [" + severity + "] " + relativePath + " imports " + pkg + "*");
                        count++;
                    }
                }
            }
        } finally {
            javaFiles.close();
        }

        if (count == 0) {
            System.out.println("       None found.");
        }
        return count;
    }
}
