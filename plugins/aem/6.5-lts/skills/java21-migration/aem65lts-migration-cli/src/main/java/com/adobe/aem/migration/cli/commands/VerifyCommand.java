package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Callable;
import java.util.stream.Stream;

@CommandLine.Command(name = "verify",
                     description = "Verify migration was applied correctly")
public class VerifyCommand implements Callable<Integer> {

    @CommandLine.Option(names = {"--repository-path", "-r"},
                        description = "Path to the AEM Maven project", required = true)
    private File repositoryPath;

    private int issues = 0;

    @Override
    public Integer call() throws Exception {
        System.out.println("=== AEM 6.5 LTS Post-Migration Verification ===");
        System.out.println();

        checkCloudManagerVersion();
        checkCompilerSettings();
        checkJakartaImports();
        checkTempWorkarounds();
        checkUberJarClassifier();
        checkUnsupportedPackages();
        reportGitDiffStats();

        System.out.println();
        if (issues == 0) {
            System.out.println("=== PASS === All verification checks passed.");
            return 0;
        } else {
            System.out.println("=== " + issues + " issue(s) found === Review items above.");
            return 1;
        }
    }

    private void checkCloudManagerVersion() throws IOException {
        System.out.print("[CHECK] .cloudmanager/java-version = 21 ... ");
        Path cmFile = repositoryPath.toPath().resolve(".cloudmanager/java-version");
        if (!Files.exists(cmFile)) {
            System.out.println("FAIL (file missing)");
            issues++;
            return;
        }
        String version = new String(Files.readAllBytes(cmFile)).trim();
        if ("21".equals(version)) {
            System.out.println("PASS");
        } else {
            System.out.println("FAIL (found: " + version + ")");
            issues++;
        }
    }

    private void checkCompilerSettings() throws IOException {
        System.out.print("[CHECK] Compiler source/target/release = 21 ... ");
        int pomIssues = 0;
        Stream<Path> poms = Files.walk(repositoryPath.toPath())
                .filter(p -> p.getFileName().toString().equals("pom.xml"))
                .filter(p -> !p.toString().contains("/target/"));
        try {
            for (Path pom : (Iterable<Path>) poms::iterator) {
                String content = new String(Files.readAllBytes(pom));
                if (content.contains("<source>8</source>") || content.contains("<source>11</source>") ||
                    content.contains("<source>1.8</source>") || content.contains("<target>8</target>") ||
                    content.contains("<target>11</target>") || content.contains("<target>1.8</target>")) {
                    String rel = repositoryPath.toPath().relativize(pom).toString();
                    System.out.println("\n         FAIL: " + rel + " has old compiler settings");
                    pomIssues++;
                }
            }
        } finally {
            poms.close();
        }
        if (pomIssues == 0) {
            System.out.println("PASS");
        } else {
            issues += pomIssues;
        }
    }

    private void checkJakartaImports() throws IOException {
        System.out.print("[CHECK] No accidental jakarta imports in AEM code ... ");
        int jakartaCount = 0;
        String[] aemPrefixes = {"com.adobe.", "org.apache.sling.", "com.day.cq."};

        Stream<Path> javaFiles = Files.walk(repositoryPath.toPath())
                .filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !p.toString().contains("/target/"));
        try {
            for (Path jf : (Iterable<Path>) javaFiles::iterator) {
                String content = new String(Files.readAllBytes(jf));
                boolean isAem = false;
                for (String prefix : aemPrefixes) {
                    if (content.contains("import " + prefix)) {
                        isAem = true;
                        break;
                    }
                }
                if (isAem && content.contains("import jakarta.")) {
                    String rel = repositoryPath.toPath().relativize(jf).toString();
                    System.out.println("\n         FAIL: " + rel + " has jakarta imports in AEM source");
                    jakartaCount++;
                }
            }
        } finally {
            javaFiles.close();
        }
        if (jakartaCount == 0) {
            System.out.println("PASS");
        } else {
            issues += jakartaCount;
        }
    }

    private void checkTempWorkarounds() throws IOException {
        System.out.print("[CHECK] No MIGRATION_TEMP markers remaining ... ");
        int markerCount = 0;
        Stream<Path> files = Files.walk(repositoryPath.toPath())
                .filter(p -> !p.toString().contains("/target/") && !p.toString().contains("/.git/"))
                .filter(Files::isRegularFile);
        try {
            for (Path f : (Iterable<Path>) files::iterator) {
                try {
                    String content = new String(Files.readAllBytes(f));
                    if (content.contains("MIGRATION_TEMP_START") || content.contains("MIGRATION_TEMP_END")) {
                        String rel = repositoryPath.toPath().relativize(f).toString();
                        System.out.println("\n         FAIL: " + rel + " has temp markers");
                        markerCount++;
                    }
                } catch (IOException e) {
                    // Skip binary files
                }
            }
        } finally {
            files.close();
        }
        if (markerCount == 0) {
            System.out.println("PASS");
        } else {
            issues += markerCount;
        }
    }

    private void checkUberJarClassifier() throws IOException {
        System.out.print("[CHECK] uber-jar has 'apis' classifier ... ");
        int pomIssues = 0;
        Stream<Path> poms = Files.walk(repositoryPath.toPath())
                .filter(p -> p.getFileName().toString().equals("pom.xml"))
                .filter(p -> !p.toString().contains("/target/"));
        try {
            for (Path pom : (Iterable<Path>) poms::iterator) {
                String content = new String(Files.readAllBytes(pom));
                if (content.contains("uber-jar") && !content.contains("<classifier>apis</classifier>")) {
                    String rel = repositoryPath.toPath().relativize(pom).toString();
                    System.out.println("\n         FAIL: " + rel + " has uber-jar without apis classifier");
                    pomIssues++;
                }
            }
        } finally {
            poms.close();
        }
        if (pomIssues == 0) {
            System.out.println("PASS");
        } else {
            issues += pomIssues;
        }
    }

    private void checkUnsupportedPackages() throws IOException {
        System.out.print("[CHECK] No unsupported package imports ... ");
        String[] badPackages = {"com.adobe.cq.commerce.", "com.adobe.cq.social.",
                "com.adobe.granite.social.", "com.adobe.cq.screens."};
        int count = 0;
        Stream<Path> javaFiles = Files.walk(repositoryPath.toPath())
                .filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !p.toString().contains("/target/"));
        try {
            for (Path jf : (Iterable<Path>) javaFiles::iterator) {
                String content = new String(Files.readAllBytes(jf));
                for (String pkg : badPackages) {
                    if (content.contains("import " + pkg)) {
                        count++;
                        break;
                    }
                }
            }
        } finally {
            javaFiles.close();
        }
        if (count == 0) {
            System.out.println("PASS");
        } else {
            System.out.println("FAIL (" + count + " files with unsupported imports)");
            issues += count;
        }
    }

    private void reportGitDiffStats() throws IOException, InterruptedException {
        System.out.println();
        System.out.println("[INFO] Git diff summary:");
        ProcessBuilder pb = new ProcessBuilder("git", "diff", "--stat");
        pb.directory(repositoryPath);
        pb.redirectErrorStream(true);
        Process proc = pb.start();
        InputStream is = proc.getInputStream();
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            baos.write(buf, 0, n);
        }
        String output = baos.toString();
        proc.waitFor();
        System.out.println(output);
    }
}
