package com.adobe.aem.migration.openrewrite;

import org.apache.maven.shared.invoker.DefaultInvocationRequest;
import org.apache.maven.shared.invoker.DefaultInvoker;
import org.apache.maven.shared.invoker.InvocationRequest;
import org.apache.maven.shared.invoker.InvocationResult;
import org.apache.maven.shared.invoker.Invoker;
import org.apache.maven.shared.invoker.MavenInvocationException;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

public class OpenRewriteRunner {

    private static final String REWRITE_PLUGIN = "org.openrewrite.maven:rewrite-maven-plugin:6.8.0";

    private final File repositoryPath;
    private final File mavenHome;
    private final String javaHome;

    public OpenRewriteRunner(File repositoryPath, String javaHome) {
        this.repositoryPath = repositoryPath;
        this.javaHome = javaHome;

        String mavenHomePath = System.getenv("MAVEN_HOME");
        if (mavenHomePath == null) {
            mavenHomePath = System.getenv("M2_HOME");
        }
        this.mavenHome = mavenHomePath != null ? new File(mavenHomePath) : null;
    }

    public int runRecipe(String activeRecipes, String configLocation,
                         String recipeArtifactCoordinates, boolean dryRun) throws MavenInvocationException {

        InvocationRequest request = new DefaultInvocationRequest();
        request.setPomFile(new File(repositoryPath, "pom.xml"));
        request.setGoals(buildGoals());
        request.setProperties(buildProperties(activeRecipes, configLocation,
                recipeArtifactCoordinates, dryRun));

        if (javaHome != null && !javaHome.isEmpty()) {
            request.setJavaHome(new File(javaHome));
        }

        if (mavenHome != null) {
            request.setMavenHome(mavenHome);
        }

        request.setShowErrors(true);
        request.setBatchMode(true);

        Invoker invoker = new DefaultInvoker();
        if (mavenHome != null) {
            invoker.setMavenHome(mavenHome);
        }

        InvocationResult result = invoker.execute(request);
        return result.getExitCode();
    }

    public int runBuild(boolean skipTests) throws MavenInvocationException {
        InvocationRequest request = new DefaultInvocationRequest();
        request.setPomFile(new File(repositoryPath, "pom.xml"));

        List<String> goals = new ArrayList<String>();
        goals.add("clean");
        goals.add("install");
        request.setGoals(goals);

        Properties props = new Properties();
        if (skipTests) {
            props.setProperty("skipTests", "true");
        }
        props.setProperty("skipFrontend", "true");
        request.setProperties(props);

        if (javaHome != null && !javaHome.isEmpty()) {
            request.setJavaHome(new File(javaHome));
        }

        if (mavenHome != null) {
            request.setMavenHome(mavenHome);
        }

        request.setShowErrors(true);
        request.setBatchMode(true);

        Invoker invoker = new DefaultInvoker();
        if (mavenHome != null) {
            invoker.setMavenHome(mavenHome);
        }

        InvocationResult result = invoker.execute(request);
        return result.getExitCode();
    }

    private List<String> buildGoals() {
        List<String> goals = new ArrayList<String>();
        goals.add("clean");
        goals.add("install");
        goals.add(REWRITE_PLUGIN + ":run");
        return goals;
    }

    private Properties buildProperties(String activeRecipes, String configLocation,
                                        String recipeArtifactCoordinates, boolean dryRun) {
        Properties props = new Properties();
        props.setProperty("skipTests", "true");
        props.setProperty("skipFrontend", "true");
        props.setProperty("vault.skipValidation", "true");
        props.setProperty("rewrite.activeRecipes", activeRecipes);
        props.setProperty("exportDatatables", "true");

        if (configLocation != null && !configLocation.isEmpty()) {
            props.setProperty("rewrite.configLocation", configLocation);
        }

        if (recipeArtifactCoordinates != null && !recipeArtifactCoordinates.isEmpty()) {
            props.setProperty("rewrite.recipeArtifactCoordinates", recipeArtifactCoordinates);
        }

        if (dryRun) {
            props.setProperty("rewrite.dryRun", "true");
        }

        return props;
    }
}
