package com.adobe.aem.migration.cli.report;

import com.adobe.aem.migration.cli.report.AnalysisReport.Finding;
import com.adobe.aem.migration.cli.report.AnalysisReport.Severity;
import com.adobe.aem.migration.cli.report.AnalysisReport.Status;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for {@link AnalysisReport}'s JSON contract.
 *
 * <p>JSON output is consumed by CI tools, so the schema is treated as a
 * stability surface. The tests pin schemaVersion, status enum values,
 * exit codes, and string escaping so a downstream consumer can rely on
 * the shape.
 */
class AnalysisReportTest {

    @Test
    @DisplayName("clean project reports READY/0")
    void cleanProjectReportsReady() {
        AnalysisReport r = new AnalysisReport("/tmp/clean");
        r.detectedJavaVersion("11");
        r.hasGit(true);

        assertEquals(Status.READY, r.status());
        assertEquals(0, r.exitCode());
        String json = r.toJson();
        assertTrue(json.contains("\"schemaVersion\":1"), json);
        assertTrue(json.contains("\"status\":\"READY\""), json);
        assertTrue(json.contains("\"exitCode\":0"), json);
        assertTrue(json.contains("\"findings\":[]"), json);
        assertTrue(json.contains("\"fatal\":null"), json);
    }

    @Test
    @DisplayName("removed-bundle import reports READY_WITH_WARNINGS/1")
    void warningOnlyReportsReadyWithWarnings() {
        AnalysisReport r = new AnalysisReport("/tmp/w");
        r.detectedJavaVersion("8");
        r.hasGit(true);
        r.findings(Collections.singletonList(
                new Finding(Severity.WARNING, "com.google.common.", "core/Cache.java", 7)));

        assertEquals(Status.READY_WITH_WARNINGS, r.status());
        assertEquals(1, r.exitCode());
        assertEquals(0, r.blockerCount());
        assertEquals(1, r.warningCount());
        String json = r.toJson();
        assertTrue(json.contains("\"severity\":\"WARNING\""), json);
        assertTrue(json.contains("\"warningCount\":1"), json);
    }

    @Test
    @DisplayName("commerce import reports BLOCKED/2 and lists the finding")
    void blockerReportsBlocked() {
        AnalysisReport r = new AnalysisReport("/tmp/b");
        r.detectedJavaVersion("8");
        r.findings(Arrays.asList(
                new Finding(Severity.BLOCKER, "com.adobe.cq.commerce.", "core/Foo.java", 14),
                new Finding(Severity.WARNING, "com.google.common.", "core/Bar.java", 5)));

        assertEquals(Status.BLOCKED, r.status());
        assertEquals(2, r.exitCode());
        assertEquals(1, r.blockerCount());
        assertEquals(1, r.warningCount());
    }

    @Test
    @DisplayName("missing pom.xml reports INVALID/2")
    void fatalReportsInvalid() {
        AnalysisReport r = new AnalysisReport("/tmp/missing");
        r.fatal("No pom.xml found");

        assertEquals(Status.INVALID, r.status());
        assertEquals(2, r.exitCode());
        String json = r.toJson();
        assertTrue(json.contains("\"fatal\":\"No pom.xml found\""), json);
        assertTrue(json.contains("\"status\":\"INVALID\""), json);
    }

    @Test
    @DisplayName("control characters in paths are JSON-escaped")
    void controlCharactersAreEscaped() {
        AnalysisReport r = new AnalysisReport("/tmp/p\"with\\quotes");
        r.detectedJavaVersion("11");

        String json = r.toJson();
        assertTrue(json.contains("\\\"with"), json);
        assertTrue(json.contains("\\\\quotes"), json);
    }
}
