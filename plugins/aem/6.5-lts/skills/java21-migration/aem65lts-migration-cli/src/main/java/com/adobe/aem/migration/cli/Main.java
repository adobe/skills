package com.adobe.aem.migration.cli;

import com.adobe.aem.migration.cli.commands.AnalyzeCommand;
import com.adobe.aem.migration.cli.commands.FullMigrateCommand;
import com.adobe.aem.migration.cli.commands.UpgradeCodeCommand;
import com.adobe.aem.migration.cli.commands.UpgradeDependenciesCommand;
import com.adobe.aem.migration.cli.commands.UpgradePluginsCommand;
import com.adobe.aem.migration.cli.commands.UpgradeTestsCommand;
import com.adobe.aem.migration.cli.commands.UpgradeUberJarCommand;
import com.adobe.aem.migration.cli.commands.VerifyCommand;
import picocli.CommandLine;

@CommandLine.Command(
    name = "aem-migrate",
    description = "AEM 6.5 LTS code migration tool — upgrades Maven projects from Java 8/11 to Java 21",
    mixinStandardHelpOptions = true,
    version = "1.0-SNAPSHOT",
    subcommands = {
        UpgradeCodeCommand.class,
        UpgradeTestsCommand.class,
        UpgradeUberJarCommand.class,
        UpgradePluginsCommand.class,
        UpgradeDependenciesCommand.class,
        FullMigrateCommand.class,
        AnalyzeCommand.class,
        VerifyCommand.class
    }
)
public class Main implements Runnable {

    @Override
    public void run() {
        CommandLine.usage(this, System.out);
    }

    public static void main(String[] args) {
        int exitCode = new CommandLine(new Main()).execute(args);
        System.exit(exitCode);
    }
}
