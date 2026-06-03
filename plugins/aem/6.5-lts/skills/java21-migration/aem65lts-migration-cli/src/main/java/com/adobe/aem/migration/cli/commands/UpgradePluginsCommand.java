package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

@CommandLine.Command(name = "upgrade-plugins",
                     description = "Upgrade Maven build plugins for Java 21 compatibility")
public class UpgradePluginsCommand extends AbstractOpenRewriteCommand {

    private static final String RECIPE_ARTIFACTS =
        "com.adobe.aem:aem65lts-migration-recipes:1.0-SNAPSHOT";

    @Override
    protected String getActiveRecipes() {
        return "aem.lts.migration.UpgradePluginVersions";
    }

    @Override
    protected String getRecipeArtifactCoordinates() {
        return RECIPE_ARTIFACTS;
    }

    @Override
    protected String getCommandName() {
        return "upgrade-plugins";
    }
}
