package com.adobe.aem.migration.cli.commands;

import com.adobe.aem.migration.cli.report.VerificationReport;
import com.adobe.aem.migration.cli.report.VerificationReport.CheckResult;
import com.adobe.aem.migration.cli.report.VerificationReport.Issue;
import com.adobe.aem.migration.cli.report.VerificationReport.Status;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.stream.Stream;

/**
 * Post-migration verification. Walks the project tree and runs a fixed
 * set of checks ({@code cloudmanager-version}, {@code compiler-settings},
 * {@code jakarta-in-aem}, {@code temp-workarounds},
 * {@code uberjar-classifier}, {@code unsupported-packages}). Every check
 * has a stable ID so CI consumers can match on the JSON output.
 *
 * <p>Default output is a human-readable summary on stdout. {@code --json}
 * swaps that for the machine-readable contract documented on
 * {@link VerificationReport}.
 */
@CommandLine.Command(name = "verify",
                     description = "Verify migration was applied correctly")
public class VerifyCommand implements Callable<Integer> {

    @CommandLine.Option(names = {"--repository-path", "-r"},
                        description = "Path to the AEM Maven project", required = true)
    private File repositoryPath;

    @CommandLine.Option(names = {"--json"},
                        description = "Emit a machine-readable JSON report on stdout instead of the human summary")
    private boolean json;

    @CommandLine.Option(names = {"--skip-git"},
                        description = "Skip the trailing git-diff summary (useful in CI containers without git)")
    private boolean skipGit;

    @Override
    public Integer call() throws Exception {
        VerificationReport report = new VerificationReport(repositoryPath.getAbsolutePath());

        report.addResult(checkCloudManagerVersion());
        report.addResult(checkCompilerSettings());
        report.addResult(checkJakartaImports());
        report.addResult(checkTempWorkarounds());
        report.addResult(checkUberJarClassifier());
        report.addResult(checkUnsupportedPackages());

        if (json) {
            System.out.println(report.toJson());
        } else {
            System.out.println(report.toHumanReadable());
            if (!skipGit) {
                printGitDiffStat();
            }
        }
        return report.exitCode();
    }

    private CheckResult checkCloudManagerVersion() throws IOException {
        Path cmFile = repositoryPath.toPath().resolve(".cloudmanager/java-version");
        if (!Files.exists(cmFile)) {
            return new CheckResult(
                    "cloudmanager-version",
                    ".cloudmanager/java-version = 21",
                    Status.FAIL,
                    one(".cloudmanager/java-version", "file is missing"));
        }
        String version = new String(Files.readAllBytes(cmFile)).trim();
        if ("21".equals(version)) {
            return passing("cloudmanager-version", ".cloudmanager/java-version = 21");
        }
        return new CheckResult(
                "cloudmanager-version",
                ".cloudmanager/java-version = 21",
                Status.FAIL,
                one(".cloudmanager/java-version", "found '" + version + "', expected '21'"));
    }

    private CheckResult checkCompilerSettings() throws IOException {
        List<Issue> issues = new ArrayList<>();
        try (Stream<Path> poms = walkPoms()) {
            for (Path pom : (Iterable<Path>) poms::iterator) {
                String content = new String(Files.readAllBytes(pom));
                String rel = repositoryPath.toPath().relativize(pom).toString();
                for (String tag : new String[]{
                        "<source>8</source>", "<source>11</source>", "<source>1.8</source>",
                        "<target>8</target>", "<target>11</target>", "<target>1.8</target>"}) {
                    if (content.contains(tag)) {
                        issues.add(new Issue(rel, "still contains " + tag));
                    }
                }
            }
        }
        return verdict("compiler-settings", "Compiler source/target/release = 21", issues);
    }

    private CheckResult checkJakartaImports() throws IOException {
        List<Issue> issues = new ArrayList<>();
        String[] aemPrefixes = {"com.adobe.", "org.apache.sling.", "com.day.cq."};
        try (Stream<Path> javaFiles = walkJava()) {
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
                    issues.add(new Issue(
                            repositoryPath.toPath().relativize(jf).toString(),
                            "AEM source file imports jakarta.*"));
                }
            }
        }
        return verdict("jakarta-in-aem", "No accidental jakarta imports in AEM code", issues);
    }

    private CheckResult checkTempWorkarounds() throws IOException {
        List<Issue> issues = new ArrayList<>();
        try (Stream<Path> files = Files.walk(repositoryPath.toPath())
                .filter(p -> !p.toString().contains("/target/"))
                .filter(p -> !p.toString().contains("/.git/"))
                .filter(Files::isRegularFile)) {
            for (Path f : (Iterable<Path>) files::iterator) {
                try {
                    String content = new String(Files.readAllBytes(f));
                    if (content.contains("MIGRATION_TEMP_START") || content.contains("MIGRATION_TEMP_END")) {
                        issues.add(new Issue(
                                repositoryPath.toPath().relativize(f).toString(),
                                "contains MIGRATION_TEMP_* marker"));
                    }
                } catch (IOException ignored) {
                    // skip binary files
                }
            }
        }
        return verdict("temp-workarounds", "No MIGRATION_TEMP markers remaining", issues);
    }

    private CheckResult checkUberJarClassifier() throws IOException {
        List<Issue> issues = new ArrayList<>();
        try (Stream<Path> poms = walkPoms()) {
            for (Path pom : (Iterable<Path>) poms::iterator) {
                String content = new String(Files.readAllBytes(pom));
                if (content.contains("uber-jar") && !content.contains("<classifier>apis</classifier>")) {
                    issues.add(new Issue(
                            repositoryPath.toPath().relativize(pom).toString(),
                            "uber-jar declared without <classifier>apis</classifier>"));
                }
            }
        }
        return verdict("uberjar-classifier", "uber-jar has 'apis' classifier", issues);
    }

    private CheckResult checkUnsupportedPackages() throws IOException {
        List<Issue> issues = new ArrayList<>();
        String[] badPackages = {
                "com.adobe.cq.commerce.", "com.adobe.cq.social.",
                "com.adobe.granite.social.", "com.adobe.cq.screens."};
        try (Stream<Path> javaFiles = walkJava()) {
            for (Path jf : (Iterable<Path>) javaFiles::iterator) {
                String content = new String(Files.readAllBytes(jf));
                for (String pkg : badPackages) {
                    if (content.contains("import " + pkg)) {
                        issues.add(new Issue(
                                repositoryPath.toPath().relativize(jf).toString(),
                                "imports unsupported package " + pkg + "*"));
                        break;
                    }
                }
            }
        }
        return verdict("unsupported-packages", "No unsupported package imports", issues);
    }

    private void printGitDiffStat() throws IOException, InterruptedException {
        System.out.println();
        System.out.println("[INFO] Git diff summary:");
        ProcessBuilder pb = new ProcessBuilder("git", "diff", "--stat");
        pb.directory(repositoryPath);
        pb.redirectErrorStream(true);
        Process proc = pb.start();
        try (InputStream is = proc.getInputStream()) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            System.out.println(baos.toString("UTF-8"));
        }
        proc.waitFor();
    }

    private Stream<Path> walkPoms() throws IOException {
        return Files.walk(repositoryPath.toPath())
                .filter(p -> p.getFileName().toString().equals("pom.xml"))
                .filter(p -> !p.toString().contains("/target/"));
    }

    private Stream<Path> walkJava() throws IOException {
        return Files.walk(repositoryPath.toPath())
                .filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !p.toString().contains("/target/"));
    }

    private static CheckResult passing(String id, String title) {
        return new CheckResult(id, title, Status.PASS, new ArrayList<>());
    }

    private static CheckResult verdict(String id, String title, List<Issue> issues) {
        return new CheckResult(id, title, issues.isEmpty() ? Status.PASS : Status.FAIL, issues);
    }

    private static List<Issue> one(String file, String detail) {
        List<Issue> list = new ArrayList<>(1);
        list.add(new Issue(file, detail));
        return list;
    }
}
