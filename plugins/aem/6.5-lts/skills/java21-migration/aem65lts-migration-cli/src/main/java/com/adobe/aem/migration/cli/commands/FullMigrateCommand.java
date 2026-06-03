package com.adobe.aem.migration.cli.commands;

import com.adobe.aem.migration.openrewrite.OpenRewriteRunner;
import picocli.CommandLine;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Callable;

@CommandLine.Command(name = "full-migrate",
                     description = "Run complete AEM 6.5 LTS migration (all steps)")
public class FullMigrateCommand implements Callable<Integer> {

    @CommandLine.Option(names = {"--repository-path", "-r"},
                        description = "Path to the AEM Maven project", required = true)
    private File repositoryPath;

    @CommandLine.Option(names = {"--javaHome", "-j"},
                        description = "Path to JDK 21 installation")
    private String javaHome;

    @CommandLine.Option(names = {"--java11Home"},
                        description = "Path to JDK 11 installation (used for OpenRewrite code migration)")
    private String java11Home;

    @CommandLine.Option(names = {"--sourceJavaHome"},
                        description = "Path to source JDK (8 or 11) for initial build verification")
    private String sourceJavaHome;

    @CommandLine.Option(names = {"--dryRun", "-d"},
                        description = "Run in dry-run mode")
    private boolean dryRun;

    @CommandLine.Option(names = {"--skip-tests"},
                        description = "Skip running test upgrade (Mockito migration)",
                        defaultValue = "false")
    private boolean skipTests;

    private static final String REWRITE_MIGRATE_JAVA = "org.openrewrite.recipe:rewrite-migrate-java:3.9.0";
    private static final String REWRITE_TESTING = "org.openrewrite.recipe:rewrite-testing-frameworks:3.9.0";
    private static final String CUSTOM_RECIPES = "com.adobe.aem:aem65lts-migration-recipes:1.0-SNAPSHOT";

    @Override
    public Integer call() throws Exception {
        System.out.println("=== AEM 6.5 LTS Full Migration ===");
        System.out.println("Repository: " + repositoryPath.getAbsolutePath());
        System.out.println();

        // Step 1: Validate project structure
        System.out.println("[Step 1/8] Validating project structure...");
        if (!validateProject()) return 1;

        // Step 2: Initial build with source JDK
        if (sourceJavaHome != null) {
            System.out.println("[Step 2/8] Running baseline build with source JDK...");
            OpenRewriteRunner baselineRunner = new OpenRewriteRunner(repositoryPath, sourceJavaHome);
            int buildResult = baselineRunner.runBuild(true);
            if (buildResult != 0) {
                System.err.println("[FAIL] Baseline build failed. Fix compilation errors before migration.");
                return 1;
            }
            System.out.println("[OK] Baseline build succeeded.");
        } else {
            System.out.println("[Step 2/8] Skipping baseline build (no --sourceJavaHome specified).");
        }

        // Step 3: Apply Java code modernization (use JDK 11 for OpenRewrite)
        String orJavaHome = java11Home != null ? java11Home : javaHome;
        System.out.println("[Step 3/8] Applying Java code modernization recipes...");
        OpenRewriteRunner codeRunner = new OpenRewriteRunner(repositoryPath, orJavaHome);
        int codeResult = codeRunner.runRecipe(
                "aem.lts.migration.UpgradeToAEM65LTS",
                null,
                REWRITE_MIGRATE_JAVA + "," + CUSTOM_RECIPES,
                dryRun
        );
        if (codeResult != 0) {
            System.err.println("[WARN] Java code migration had issues (exit code: " + codeResult + ").");
            System.err.println("       Continuing — build step will surface remaining errors.");
        } else {
            System.out.println("[OK] Java code modernization applied.");
        }

        // Step 4: Apply plugin version upgrades
        System.out.println("[Step 4/8] Upgrading Maven build plugins...");
        int pluginResult = codeRunner.runRecipe(
                "aem.lts.migration.UpgradePluginVersions",
                null,
                CUSTOM_RECIPES,
                dryRun
        );
        reportStepResult("Plugin upgrades", pluginResult);

        // Step 5: Apply dependency version upgrades + UberJar migration
        System.out.println("[Step 5/8] Upgrading dependencies and UberJar...");
        int depResult = codeRunner.runRecipe(
                "aem.lts.migration.UpgradeCommonLibraries,aem.lts.migration.UpdateUberJarVersion",
                null,
                CUSTOM_RECIPES,
                dryRun
        );
        reportStepResult("Dependency upgrades", depResult);

        // Step 6: Set .cloudmanager/java-version
        System.out.println("[Step 6/8] Setting CloudManager Java version...");
        setCloudManagerJavaVersion();

        // Step 7: Intermediate build with JDK 21
        if (!dryRun) {
            System.out.println("[Step 7/8] Running intermediate build with JDK 21...");
            OpenRewriteRunner buildRunner = new OpenRewriteRunner(repositoryPath, javaHome);
            int intermediateResult = buildRunner.runBuild(true);
            if (intermediateResult != 0) {
                System.err.println("[WARN] Intermediate build failed. AI-assisted fixing may be needed.");
            } else {
                System.out.println("[OK] Intermediate build succeeded with JDK 21.");
            }
        }

        // Step 8: Apply Mockito/test framework migration
        if (!skipTests) {
            System.out.println("[Step 8/8] Applying test framework migration (Mockito)...");
            OpenRewriteRunner testRunner = new OpenRewriteRunner(repositoryPath, javaHome);
            int testResult = testRunner.runRecipe(
                    "aem.lts.migration.UpgradeTestingFrameworks",
                    null,
                    REWRITE_TESTING,
                    dryRun
            );
            if (testResult != 0) {
                System.out.println("[INFO] Test framework migration had issues. This is non-fatal.");
            } else {
                System.out.println("[OK] Test framework migration applied.");
            }
        } else {
            System.out.println("[Step 8/8] Skipping test framework migration (--skip-tests).");
        }

        System.out.println();
        System.out.println("=== Migration Complete ===");
        if (dryRun) {
            System.out.println("This was a DRY RUN — no files were modified.");
        } else {
            System.out.println("Review changes with: git diff");
            System.out.println("Run verification: aem-migrate verify -r " + repositoryPath.getAbsolutePath());
        }
        return 0;
    }

    private boolean validateProject() {
        if (!repositoryPath.exists() || !repositoryPath.isDirectory()) {
            System.err.println("[FAIL] Repository path does not exist: " + repositoryPath);
            return false;
        }
        if (!new File(repositoryPath, "pom.xml").exists()) {
            System.err.println("[FAIL] No pom.xml found at: " + repositoryPath);
            return false;
        }
        if (!new File(repositoryPath, ".git").exists()) {
            System.err.println("[WARN] No .git directory — cannot track changes.");
        }
        System.out.println("[OK] Project structure valid.");
        return true;
    }

    private void setCloudManagerJavaVersion() throws IOException {
        if (dryRun) {
            System.out.println("[DRY RUN] Would set .cloudmanager/java-version to 21");
            return;
        }
        Path cmDir = repositoryPath.toPath().resolve(".cloudmanager");
        Files.createDirectories(cmDir);
        Files.write(cmDir.resolve("java-version"), "21\n".getBytes());
        System.out.println("[OK] .cloudmanager/java-version set to 21.");
    }

    private void reportStepResult(String stepName, int exitCode) {
        if (exitCode == 0) {
            System.out.println("[OK] " + stepName + " applied.");
        } else {
            System.out.println("[WARN] " + stepName + " had issues (exit code: " + exitCode + ").");
        }
    }
}
