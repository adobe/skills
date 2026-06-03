package com.adobe.aem.migration.cli.commands;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end coverage of the CLI's read-only commands.
 *
 * <p>Each test materialises a tiny Maven project under a JUnit
 * {@code @TempDir}, drives the corresponding picocli command via
 * {@link CommandLine#execute}, captures stdout, and asserts on both the
 * exit code and the structured output. This is the highest-fidelity test
 * the CLI module can run without spawning a JVM subprocess — it exercises
 * picocli's option binding, the command's filesystem walk, and the
 * report serialiser in one pass.
 *
 * <p>The destructive {@code upgrade-*} commands invoke
 * {@code rewrite-maven-plugin} via Maven Invoker, so they need a real
 * Maven installation on {@code PATH} and a network-reachable repository
 * — those are deferred to a manual smoke test on a representative
 * customer project before promoting out of beta.
 */
class MigrationCliE2ETest {

    private static final String CLEAN_POM =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            + "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">\n"
            + "  <modelVersion>4.0.0</modelVersion>\n"
            + "  <groupId>com.example</groupId>\n"
            + "  <artifactId>fixture</artifactId>\n"
            + "  <version>1.0.0</version>\n"
            + "  <properties><maven.compiler.source>11</maven.compiler.source></properties>\n"
            + "</project>\n";

    private static final String COMMERCE_JAVA =
            "package com.example;\n"
            + "import com.adobe.cq.commerce.api.CommerceService;\n"
            + "public class Bad { CommerceService s; }\n";

    private static final String GUAVA_JAVA =
            "package com.example;\n"
            + "import com.google.common.collect.ImmutableList;\n"
            + "public class Warn { ImmutableList<String> l; }\n";

    @Test
    @DisplayName("analyze on a clean fixture exits 0 and reports READY")
    void analyzeCleanFixture(@TempDir Path repo) throws Exception {
        Files.write(repo.resolve("pom.xml"), CLEAN_POM.getBytes(StandardCharsets.UTF_8));

        Captured c = runAnalyze(repo, false);
        assertEquals(0, c.exitCode, c.stdout);
        assertTrue(c.stdout.contains("Status:               READY"), c.stdout);
    }

    @Test
    @DisplayName("analyze --json on a clean fixture emits a single-line JSON document")
    void analyzeCleanFixtureJson(@TempDir Path repo) throws Exception {
        Files.write(repo.resolve("pom.xml"), CLEAN_POM.getBytes(StandardCharsets.UTF_8));

        Captured c = runAnalyze(repo, true);
        assertEquals(0, c.exitCode, c.stdout);
        String json = c.stdout.trim();
        assertTrue(json.startsWith("{"), json);
        assertTrue(json.endsWith("}"), json);
        assertEquals(0, countLines(json), "JSON output must be single-line");
        assertTrue(json.contains("\"schemaVersion\":1"), json);
        assertTrue(json.contains("\"status\":\"READY\""), json);
        assertTrue(json.contains("\"exitCode\":0"), json);
        assertTrue(json.contains("\"detectedJavaVersion\":\"11\""), json);
    }

    @Test
    @DisplayName("analyze --json with a commerce import exits 2 and lists the file/line")
    void analyzeWithBlocker(@TempDir Path repo) throws Exception {
        Files.write(repo.resolve("pom.xml"), CLEAN_POM.getBytes(StandardCharsets.UTF_8));
        Path src = repo.resolve("src/main/java/com/example");
        Files.createDirectories(src);
        Files.write(src.resolve("Bad.java"), COMMERCE_JAVA.getBytes(StandardCharsets.UTF_8));

        Captured c = runAnalyze(repo, true);
        assertEquals(2, c.exitCode, c.stdout);
        String json = c.stdout.trim();
        assertTrue(json.contains("\"status\":\"BLOCKED\""), json);
        assertTrue(json.contains("\"exitCode\":2"), json);
        assertTrue(json.contains("\"severity\":\"BLOCKER\""), json);
        assertTrue(json.contains("\"package\":\"com.adobe.cq.commerce.\""), json);
        assertTrue(json.contains("\"file\":\"src/main/java/com/example/Bad.java\""), json);
        assertTrue(json.contains("\"line\":2"), json);
    }

    @Test
    @DisplayName("analyze --json with only a removed-bundle import exits 1 and reports WARNING")
    void analyzeWithWarningOnly(@TempDir Path repo) throws Exception {
        Files.write(repo.resolve("pom.xml"), CLEAN_POM.getBytes(StandardCharsets.UTF_8));
        Path src = repo.resolve("src/main/java/com/example");
        Files.createDirectories(src);
        Files.write(src.resolve("Warn.java"), GUAVA_JAVA.getBytes(StandardCharsets.UTF_8));

        Captured c = runAnalyze(repo, true);
        assertEquals(1, c.exitCode, c.stdout);
        String json = c.stdout.trim();
        assertTrue(json.contains("\"status\":\"READY_WITH_WARNINGS\""), json);
        assertTrue(json.contains("\"severity\":\"WARNING\""), json);
        assertTrue(json.contains("\"package\":\"com.google.common.\""), json);
    }

    @Test
    @DisplayName("analyze on a directory without pom.xml exits 2 with status INVALID")
    void analyzeWithoutPom(@TempDir Path repo) throws Exception {
        Captured c = runAnalyze(repo, true);
        assertEquals(2, c.exitCode, c.stdout);
        String json = c.stdout.trim();
        assertTrue(json.contains("\"status\":\"INVALID\""), json);
        assertTrue(json.contains("\"fatal\":\"Invalid project"), json);
    }

    @Test
    @DisplayName("verify --json on a fully-migrated fixture emits PASS overall")
    void verifyFullyMigrated(@TempDir Path repo) throws Exception {
        Files.write(repo.resolve("pom.xml"),
                ("<?xml version=\"1.0\"?>\n"
                + "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">\n"
                + "  <modelVersion>4.0.0</modelVersion>\n"
                + "  <groupId>com.example</groupId>\n"
                + "  <artifactId>fixture</artifactId>\n"
                + "  <version>1.0.0</version>\n"
                + "</project>\n").getBytes(StandardCharsets.UTF_8));
        Files.createDirectories(repo.resolve(".cloudmanager"));
        Files.write(repo.resolve(".cloudmanager/java-version"),
                "21".getBytes(StandardCharsets.UTF_8));

        Captured c = runVerify(repo);
        assertEquals(0, c.exitCode, c.stdout);
        String json = c.stdout.trim();
        assertTrue(json.contains("\"schemaVersion\":1"), json);
        assertTrue(json.contains("\"command\":\"verify\""), json);
        assertTrue(json.contains("\"status\":\"PASS\""), json);
        assertTrue(json.contains("\"id\":\"cloudmanager-version\""), json);
        assertTrue(json.contains("\"id\":\"compiler-settings\""), json);
    }

    @Test
    @DisplayName("verify --json catches a leftover <source>11</source> and exits 1")
    void verifyCatchesUnmigratedCompiler(@TempDir Path repo) throws Exception {
        Files.write(repo.resolve("pom.xml"),
                ("<?xml version=\"1.0\"?>\n"
                + "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">\n"
                + "  <modelVersion>4.0.0</modelVersion>\n"
                + "  <groupId>com.example</groupId>\n"
                + "  <artifactId>fixture</artifactId>\n"
                + "  <version>1.0.0</version>\n"
                + "  <build><plugins><plugin>\n"
                + "    <groupId>org.apache.maven.plugins</groupId>\n"
                + "    <artifactId>maven-compiler-plugin</artifactId>\n"
                + "    <configuration><source>11</source><target>11</target></configuration>\n"
                + "  </plugin></plugins></build>\n"
                + "</project>\n").getBytes(StandardCharsets.UTF_8));
        Files.createDirectories(repo.resolve(".cloudmanager"));
        Files.write(repo.resolve(".cloudmanager/java-version"),
                "21".getBytes(StandardCharsets.UTF_8));

        Captured c = runVerify(repo);
        assertEquals(1, c.exitCode, c.stdout);
        String json = c.stdout.trim();
        assertTrue(json.contains("\"status\":\"FAIL\""), json);
        assertTrue(json.contains("\"id\":\"compiler-settings\""), json);
        assertTrue(json.contains("still contains \\u003csource\\u003e11\\u003c/source\\u003e") ||
                  json.contains("still contains <source>11</source>"), json);
    }

    private Captured runAnalyze(Path repo, boolean json) throws IOException {
        AnalyzeCommand cmd = new AnalyzeCommand();
        CommandLine cli = new CommandLine(cmd);
        String[] args = json
                ? new String[]{"-r", repo.toAbsolutePath().toString(), "--json"}
                : new String[]{"-r", repo.toAbsolutePath().toString()};
        return capture(cli, args);
    }

    private Captured runVerify(Path repo) throws IOException {
        VerifyCommand cmd = new VerifyCommand();
        CommandLine cli = new CommandLine(cmd);
        String[] args = new String[]{"-r", repo.toAbsolutePath().toString(), "--json", "--skip-git"};
        return capture(cli, args);
    }

    private Captured capture(CommandLine cli, String[] args) throws IOException {
        PrintStream originalOut = System.out;
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (PrintStream tee = new PrintStream(buf, true, "UTF-8")) {
            System.setOut(tee);
            int exit = cli.execute(args);
            return new Captured(exit, buf.toString("UTF-8"));
        } finally {
            System.setOut(originalOut);
        }
    }

    private int countLines(String s) {
        int newlines = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == '\n') {
                newlines++;
            }
        }
        return newlines;
    }

    private static final class Captured {
        final int exitCode;
        final String stdout;

        Captured(int exitCode, String stdout) {
            this.exitCode = exitCode;
            this.stdout = stdout;
        }
    }
}
