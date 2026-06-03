package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

@CommandLine.Command(name = "upgrade-dependencies",
                     description = "Upgrade AEM-specific dependency versions")
public class UpgradeDependenciesCommand extends AbstractOpenRewriteCommand {

    private static final String RECIPE_ARTIFACTS =
        "com.adobe.aem:aem65lts-migration-recipes:1.0-SNAPSHOT";

    @Override
    protected String getActiveRecipes() {
        return "aem.lts.migration.UpgradeCommonLibraries";
    }

    @Override
    protected String getRecipeArtifactCoordinates() {
        return RECIPE_ARTIFACTS;
    }

    @Override
    protected String getCommandName() {
        return "upgrade-dependencies";
    }
}
