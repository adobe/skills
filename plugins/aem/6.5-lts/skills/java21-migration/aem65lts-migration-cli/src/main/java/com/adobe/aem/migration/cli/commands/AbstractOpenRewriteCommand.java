package com.adobe.aem.migration.cli.commands;

import com.adobe.aem.migration.openrewrite.OpenRewriteRunner;
import picocli.CommandLine;

import java.io.File;
import java.util.concurrent.Callable;

public abstract class AbstractOpenRewriteCommand implements Callable<Integer> {

    @CommandLine.Option(names = {"--repository-path", "-r"},
                        description = "Path to the AEM Maven project", required = true)
    protected File repositoryPath;

    @CommandLine.Option(names = {"--javaHome", "-j"},
                        description = "Path to JDK installation to use for the build")
    protected String javaHome;

    @CommandLine.Option(names = {"--dryRun", "-d"},
                        description = "Run in dry-run mode (no changes applied)")
    protected boolean dryRun;

    protected abstract String getActiveRecipes();
    protected abstract String getRecipeArtifactCoordinates();
    protected String getConfigLocation() { return null; }

    @Override
    public Integer call() throws Exception {
        validateRepositoryPath();

        System.out.println("[aem-migrate] Running: " + getCommandName());
        System.out.println("[aem-migrate] Repository: " + repositoryPath.getAbsolutePath());
        System.out.println("[aem-migrate] JDK: " + (javaHome != null ? javaHome : "system default"));
        System.out.println("[aem-migrate] Dry run: " + dryRun);

        OpenRewriteRunner runner = new OpenRewriteRunner(repositoryPath, javaHome);

        int exitCode = runner.runRecipe(
            getActiveRecipes(),
            getConfigLocation(),
            getRecipeArtifactCoordinates(),
            dryRun
        );

        if (exitCode == 0) {
            System.out.println("[aem-migrate] " + getCommandName() + " completed successfully.");
        } else {
            System.err.println("[aem-migrate] " + getCommandName() + " failed with exit code: " + exitCode);
        }

        return exitCode;
    }

    protected abstract String getCommandName();

    protected void validateRepositoryPath() {
        if (!repositoryPath.exists() || !repositoryPath.isDirectory()) {
            throw new IllegalArgumentException("Repository path does not exist: " + repositoryPath);
        }
        File pomFile = new File(repositoryPath, "pom.xml");
        if (!pomFile.exists()) {
            throw new IllegalArgumentException("No pom.xml found at: " + repositoryPath);
        }
    }
}
