package com.adobe.aem.migration.cli.commands;

import com.adobe.aem.migration.cli.report.AnalysisReport;
import com.adobe.aem.migration.cli.report.AnalysisReport.Finding;
import com.adobe.aem.migration.cli.report.AnalysisReport.Severity;
import picocli.CommandLine;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.stream.Stream;

/**
 * Pre-migration scan. Walks the project tree and produces a structured
 * {@link AnalysisReport} listing every blocker (Tier 0 in
 * {@code references/build-fix-constraints.md}) and every warning the
 * downstream migration phases will need to address.
 *
 * <p>The exit code follows the standard CI convention:
 *
 * <ul>
 *   <li>{@code 0} — ready, no blockers, no warnings.</li>
 *   <li>{@code 1} — ready with warnings (e.g. removed-bundle imports the
 *       agent must remediate manually).</li>
 *   <li>{@code 2} — blocked, migration cannot proceed.</li>
 * </ul>
 *
 * <p>By default the command emits a human-readable summary on stdout. The
 * {@code --json} option swaps that for a single-line JSON document on
 * stdout suitable for CI ingestion. The schema is documented in
 * {@link AnalysisReport}.
 */
@CommandLine.Command(name = "analyze",
                     description = "Analyze project for migration blockers and warnings")
public class AnalyzeCommand implements Callable<Integer> {

    @CommandLine.Option(names = {"--repository-path", "-r"},
                        description = "Path to the AEM Maven project", required = true)
    private File repositoryPath;

    @CommandLine.Option(names = {"--json"},
                        description = "Emit a machine-readable JSON report on stdout instead of the human summary")
    private boolean json;

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
        AnalysisReport report = new AnalysisReport(repositoryPath.getAbsolutePath());

        if (!repositoryPath.exists() || !new File(repositoryPath, "pom.xml").exists()) {
            report.fatal("Invalid project: no pom.xml at " + repositoryPath.getAbsolutePath());
            emit(report);
            return 2;
        }

        report.detectedJavaVersion(detectJavaVersion());
        report.findings(collectFindings(UNSUPPORTED_PACKAGES, Severity.BLOCKER));
        report.findings(collectFindings(REMOVED_BUNDLE_PACKAGES, Severity.WARNING));
        report.hasGit(new File(repositoryPath, ".git").exists());
        report.hasCloudManagerConfig(new File(repositoryPath, ".cloudmanager").exists());

        emit(report);
        return report.exitCode();
    }

    private void emit(AnalysisReport report) {
        if (json) {
            System.out.println(report.toJson());
        } else {
            System.out.println(report.toHumanReadable());
        }
    }

    private List<Finding> collectFindings(String[] packagePrefixes, Severity severity) throws IOException {
        List<Finding> findings = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(repositoryPath.toPath())) {
            for (Path javaFile : (Iterable<Path>) walk
                    .filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> !p.toString().contains("/target/"))::iterator) {
                String content = new String(Files.readAllBytes(javaFile));
                String[] lines = content.split("\n", -1);
                for (int i = 0; i < lines.length; i++) {
                    String line = lines[i];
                    if (!line.trim().startsWith("import ")) {
                        continue;
                    }
                    for (String pkg : packagePrefixes) {
                        if (line.contains("import " + pkg)) {
                            findings.add(new Finding(
                                    severity,
                                    pkg,
                                    repositoryPath.toPath().relativize(javaFile).toString(),
                                    i + 1));
                            break;
                        }
                    }
                }
            }
        }
        return findings;
    }

    private String detectJavaVersion() throws IOException {
        Path cmFile = repositoryPath.toPath().resolve(".cloudmanager/java-version");
        if (Files.exists(cmFile)) {
            String version = new String(Files.readAllBytes(cmFile)).trim();
            if (!version.isEmpty()) {
                return version;
            }
        }

        Path pomPath = repositoryPath.toPath().resolve("pom.xml");
        String pomContent = new String(Files.readAllBytes(pomPath));

        for (String prop : new String[]{"maven.compiler.source", "maven.compiler.release"}) {
            int idx = pomContent.indexOf("<" + prop + ">");
            if (idx >= 0) {
                int start = idx + prop.length() + 2;
                int end = pomContent.indexOf("</" + prop + ">", start);
                if (end > start) {
                    return pomContent.substring(start, end).trim();
                }
            }
        }

        if (pomContent.contains("<source>") && pomContent.contains("maven-compiler-plugin")) {
            int pluginIdx = pomContent.indexOf("maven-compiler-plugin");
            int sourceIdx = pomContent.indexOf("<source>", pluginIdx);
            if (sourceIdx >= 0) {
                int start = sourceIdx + 8;
                int end = pomContent.indexOf("</source>", start);
                if (end > start) {
                    String val = pomContent.substring(start, end).trim();
                    if (!val.startsWith("$")) {
                        return val;
                    }
                }
            }
        }

        return "unknown";
    }
}
