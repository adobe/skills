package com.adobe.aem.migration.cli.report;

import java.util.ArrayList;
import java.util.List;

/**
 * Structured result of {@code aem-migrate verify}.
 *
 * <p>Mirrors {@link AnalysisReport} in shape and stability discipline.
 * Every post-migration check the {@code verify} command runs surfaces as
 * a {@link CheckResult} with a fixed {@code id} (greppable from CI
 * logs) and a {@link Status} of {@code PASS}, {@code FAIL}, or
 * {@code SKIP}. Per-finding detail (file path, observed value) is
 * attached as a list of {@link Issue} entries under each result.
 *
 * <p>JSON schema (single-line output of {@link #toJson()}):
 *
 * <pre>{@code
 * {
 *   "schemaVersion": 1,
 *   "tool": "aem-migrate",
 *   "command": "verify",
 *   "repository": "/abs/path/to/project",
 *   "status": "PASS" | "FAIL",
 *   "exitCode": 0 | 1,
 *   "checkCount": 6,
 *   "passCount": 5,
 *   "failCount": 1,
 *   "skipCount": 0,
 *   "results": [
 *     {
 *       "id": "compiler-settings",
 *       "title": "Compiler source/target/release = 21",
 *       "status": "FAIL",
 *       "issueCount": 1,
 *       "issues": [{"file": "core/pom.xml", "detail": "still pinned to <source>11</source>"}]
 *     }
 *   ]
 * }
 * }</pre>
 *
 * <p>Stability promise: {@code schemaVersion} is incremented on any
 * breaking change. Consumers should refuse versions they were not
 * written against.
 */
public final class VerificationReport {

    public static final int SCHEMA_VERSION = 1;

    public enum Status {PASS, FAIL, SKIP}

    public static final class Issue {
        public final String file;
        public final String detail;

        public Issue(String file, String detail) {
            this.file = file;
            this.detail = detail;
        }
    }

    public static final class CheckResult {
        public final String id;
        public final String title;
        public final Status status;
        public final List<Issue> issues;

        public CheckResult(String id, String title, Status status, List<Issue> issues) {
            this.id = id;
            this.title = title;
            this.status = status;
            this.issues = issues == null ? new ArrayList<>() : issues;
        }
    }

    private final String repository;
    private final List<CheckResult> results = new ArrayList<>();

    public VerificationReport(String repository) {
        this.repository = repository;
    }

    public void addResult(CheckResult result) {
        results.add(result);
    }

    public List<CheckResult> getResults() {
        return results;
    }

    public int checkCount() {
        return results.size();
    }

    public int passCount() {
        return (int) results.stream().filter(r -> r.status == Status.PASS).count();
    }

    public int failCount() {
        return (int) results.stream().filter(r -> r.status == Status.FAIL).count();
    }

    public int skipCount() {
        return (int) results.stream().filter(r -> r.status == Status.SKIP).count();
    }

    public Status overallStatus() {
        return failCount() > 0 ? Status.FAIL : Status.PASS;
    }

    public int exitCode() {
        return overallStatus() == Status.PASS ? 0 : 1;
    }

    public String toJson() {
        StringBuilder sb = new StringBuilder(512);
        sb.append('{');
        appendNumber(sb, "schemaVersion", SCHEMA_VERSION, true);
        appendString(sb, "tool", "aem-migrate", false);
        appendString(sb, "command", "verify", false);
        appendString(sb, "repository", repository, false);
        appendString(sb, "status", overallStatus().name(), false);
        appendNumber(sb, "exitCode", exitCode(), false);
        appendNumber(sb, "checkCount", checkCount(), false);
        appendNumber(sb, "passCount", passCount(), false);
        appendNumber(sb, "failCount", failCount(), false);
        appendNumber(sb, "skipCount", skipCount(), false);
        sb.append(",\"results\":[");
        for (int i = 0; i < results.size(); i++) {
            CheckResult r = results.get(i);
            if (i > 0) {
                sb.append(',');
            }
            sb.append('{');
            appendString(sb, "id", r.id, true);
            appendString(sb, "title", r.title, false);
            appendString(sb, "status", r.status.name(), false);
            appendNumber(sb, "issueCount", r.issues.size(), false);
            sb.append(",\"issues\":[");
            for (int j = 0; j < r.issues.size(); j++) {
                Issue issue = r.issues.get(j);
                if (j > 0) {
                    sb.append(',');
                }
                sb.append('{');
                appendString(sb, "file", issue.file, true);
                appendString(sb, "detail", issue.detail, false);
                sb.append('}');
            }
            sb.append(']');
            sb.append('}');
        }
        sb.append(']');
        sb.append('}');
        return sb.toString();
    }

    public String toHumanReadable() {
        StringBuilder sb = new StringBuilder(1024);
        sb.append("=== AEM 6.5 LTS Post-Migration Verification ===\n");
        sb.append("Repository: ").append(repository).append("\n\n");
        for (CheckResult r : results) {
            sb.append('[').append(pad(r.status.name(), 4)).append("] ")
                    .append(r.id).append(" — ").append(r.title).append('\n');
            for (Issue issue : r.issues) {
                sb.append("         ").append(issue.file).append(": ").append(issue.detail).append('\n');
            }
        }
        sb.append('\n');
        sb.append("Checks: ").append(checkCount())
                .append("  Pass: ").append(passCount())
                .append("  Fail: ").append(failCount())
                .append("  Skip: ").append(skipCount()).append('\n');
        sb.append("Overall: ").append(overallStatus())
                .append(" (exit ").append(exitCode()).append(")\n");
        return sb.toString();
    }

    private static String pad(String s, int width) {
        if (s.length() >= width) {
            return s;
        }
        StringBuilder sb = new StringBuilder(width);
        sb.append(s);
        while (sb.length() < width) {
            sb.append(' ');
        }
        return sb.toString();
    }

    private static void appendString(StringBuilder sb, String key, String value, boolean first) {
        if (!first) {
            sb.append(',');
        }
        sb.append('"').append(key).append("\":\"").append(escape(value)).append('"');
    }

    private static void appendNumber(StringBuilder sb, String key, int value, boolean first) {
        if (!first) {
            sb.append(',');
        }
        sb.append('"').append(key).append("\":").append(value);
    }

    private static String escape(String s) {
        StringBuilder out = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.toString();
    }
}
