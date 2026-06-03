package com.adobe.aem.migration.cli.report;

import com.adobe.aem.migration.cli.report.VerificationReport.CheckResult;
import com.adobe.aem.migration.cli.report.VerificationReport.Issue;
import com.adobe.aem.migration.cli.report.VerificationReport.Status;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the JSON contract for the verify report. Downstream CI tools
 * depend on the schema; breaking it without bumping {@code schemaVersion}
 * is a regression.
 */
class VerificationReportTest {

    @Test
    @DisplayName("all-passing run reports PASS/0")
    void allPassingReportsPass() {
        VerificationReport r = new VerificationReport("/tmp/p");
        r.addResult(new CheckResult("cloudmanager-version", ".cloudmanager/java-version = 21", Status.PASS, Collections.emptyList()));
        r.addResult(new CheckResult("compiler-settings",   "Compiler source/target/release = 21", Status.PASS, Collections.emptyList()));

        assertEquals(Status.PASS, r.overallStatus());
        assertEquals(0, r.exitCode());
        assertEquals(2, r.passCount());
        assertEquals(0, r.failCount());

        String json = r.toJson();
        assertTrue(json.contains("\"schemaVersion\":1"), json);
        assertTrue(json.contains("\"command\":\"verify\""), json);
        assertTrue(json.contains("\"status\":\"PASS\""), json);
        assertTrue(json.contains("\"exitCode\":0"), json);
        assertTrue(json.contains("\"id\":\"cloudmanager-version\""), json);
    }

    @Test
    @DisplayName("a single failing check makes the overall run FAIL/1")
    void anyFailingMakesOverallFail() {
        VerificationReport r = new VerificationReport("/tmp/f");
        r.addResult(new CheckResult("cloudmanager-version", ".cloudmanager/java-version = 21", Status.PASS, Collections.emptyList()));
        r.addResult(new CheckResult("compiler-settings",   "Compiler source/target/release = 21", Status.FAIL,
                Collections.singletonList(new Issue("core/pom.xml", "still contains <source>11</source>"))));

        assertEquals(Status.FAIL, r.overallStatus());
        assertEquals(1, r.exitCode());
        assertEquals(1, r.passCount());
        assertEquals(1, r.failCount());

        String json = r.toJson();
        assertTrue(json.contains("\"status\":\"FAIL\""), json);
        assertTrue(json.contains("\"file\":\"core/pom.xml\""), json);
        assertTrue(json.contains("still contains \\u003csource\\u003e11\\u003c/source\\u003e") ||
                  json.contains("still contains <source>11</source>"), json);
    }

    @Test
    @DisplayName("SKIP results do not flip the overall status")
    void skipDoesNotFail() {
        VerificationReport r = new VerificationReport("/tmp/s");
        r.addResult(new CheckResult("cloudmanager-version", ".cloudmanager/java-version = 21", Status.PASS, Collections.emptyList()));
        r.addResult(new CheckResult("compiler-settings",   "Compiler source/target/release = 21", Status.SKIP, Collections.emptyList()));

        assertEquals(Status.PASS, r.overallStatus());
        assertEquals(0, r.exitCode());
        assertEquals(1, r.skipCount());
    }

    @Test
    @DisplayName("human-readable output prints id and title per check")
    void humanReadableContainsIdAndTitle() {
        VerificationReport r = new VerificationReport("/tmp/h");
        r.addResult(new CheckResult("uberjar-classifier", "uber-jar has 'apis' classifier", Status.PASS, Collections.emptyList()));

        String text = r.toHumanReadable();
        assertTrue(text.contains("[PASS] uberjar-classifier — uber-jar has 'apis' classifier"), text);
        assertTrue(text.contains("Overall: PASS (exit 0)"), text);
    }

    @Test
    @DisplayName("issue count per check is preserved in JSON")
    void issueCountIsPreserved() {
        VerificationReport r = new VerificationReport("/tmp/i");
        r.addResult(new CheckResult("unsupported-packages", "No unsupported package imports", Status.FAIL,
                Arrays.asList(
                        new Issue("core/Foo.java", "imports unsupported package com.adobe.cq.commerce.*"),
                        new Issue("core/Bar.java", "imports unsupported package com.adobe.cq.screens.*"))));

        String json = r.toJson();
        assertTrue(json.contains("\"issueCount\":2"), json);
        assertTrue(json.contains("\"failCount\":1"), json);
    }
}
