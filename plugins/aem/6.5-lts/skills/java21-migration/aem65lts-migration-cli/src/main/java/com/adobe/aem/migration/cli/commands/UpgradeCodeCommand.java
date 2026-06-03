package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

@CommandLine.Command(name = "upgrade-code",
                     description = "Upgrade Java source code from 8/11 to 21")
public class UpgradeCodeCommand extends AbstractOpenRewriteCommand {

    private static final String RECIPE_ARTIFACTS =
        "org.openrewrite.recipe:rewrite-migrate-java:3.9.0," +
        "com.adobe.aem:aem65lts-migration-recipes:1.0-SNAPSHOT";

    @Override
    protected String getActiveRecipes() {
        return "aem.lts.migration.UpgradeToAEM65LTS";
    }

    @Override
    protected String getRecipeArtifactCoordinates() {
        return RECIPE_ARTIFACTS;
    }

    @Override
    protected String getCommandName() {
        return "upgrade-code";
    }
}
