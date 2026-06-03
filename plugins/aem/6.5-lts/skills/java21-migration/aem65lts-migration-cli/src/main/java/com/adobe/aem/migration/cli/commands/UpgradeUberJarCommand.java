package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

@CommandLine.Command(name = "upgrade-uberjar",
                     description = "Upgrade AEM UberJar to 6.6.0 with apis classifier")
public class UpgradeUberJarCommand extends AbstractOpenRewriteCommand {

    private static final String RECIPE_ARTIFACTS =
        "com.adobe.aem:aem65lts-migration-recipes:1.0-SNAPSHOT";

    @Override
    protected String getActiveRecipes() {
        return "aem.lts.migration.UpdateUberJarVersion";
    }

    @Override
    protected String getRecipeArtifactCoordinates() {
        return RECIPE_ARTIFACTS;
    }

    @Override
    protected String getCommandName() {
        return "upgrade-uberjar";
    }
}
