package com.adobe.aem.migration.cli.commands;

import picocli.CommandLine;

@CommandLine.Command(name = "upgrade-tests",
                     description = "Upgrade test frameworks (Mockito 1.x -> 5.x)")
public class UpgradeTestsCommand extends AbstractOpenRewriteCommand {

    private static final String RECIPE_ARTIFACTS =
        "org.openrewrite.recipe:rewrite-testing-frameworks:3.9.0";

    @Override
    protected String getActiveRecipes() {
        return "aem.lts.migration.UpgradeTestingFrameworks";
    }

    @Override
    protected String getRecipeArtifactCoordinates() {
        return RECIPE_ARTIFACTS;
    }

    @Override
    protected String getCommandName() {
        return "upgrade-tests";
    }
}
