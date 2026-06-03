package com.adobe.aem.migration.cli.report;

import java.util.ArrayList;
import java.util.List;

/**
 * Structured result of {@code aem-migrate analyze}.
 *
 * <p>The report is the contract between this CLI and any downstream
 * consumer (CI scripts, audit dashboards, the agent's own bookkeeping).
 * It is intentionally a flat POJO with a hand-rolled JSON serialiser so
 * that the CLI's runtime dependency set stays minimal (picocli +
 * maven-invoker, no Jackson/Gson).
 *
 * <p>JSON schema (single-line output of {@link #toJson()}):
 *
 * <pre>{@code
 * {
 *   "schemaVersion": 1,
 *   "tool": "aem-migrate",
 *   "command": "analyze",
 *   "repository": "/abs/path/to/project",
 *   "detectedJavaVersion": "8",
 *   "hasGit": true,
 *   "hasCloudManagerConfig": false,
 *   "status": "BLOCKED" | "READY_WITH_WARNINGS" | "READY" | "INVALID",
 *   "exitCode": 0 | 1 | 2,
 *   "blockerCount": 2,
 *   "warningCount": 0,
 *   "findings": [
 *     {"severity": "BLOCKER", "package": "com.adobe.cq.commerce.", "file": "core/.../Foo.java", "line": 14}
 *   ],
 *   "fatal": null
 * }
 * }</pre>
 *
 * <p>Stability promise: the {@code schemaVersion} field is bumped on any
 * breaking change to keys, types, or enum values. Consumers should refuse
 * any version they were not written against.
 */
public final class AnalysisReport {

    public static final int SCHEMA_VERSION = 1;

    public enum Severity {BLOCKER, WARNING}

    public enum Status {READY, READY_WITH_WARNINGS, BLOCKED, INVALID}

    public static final class Finding {
        public final Severity severity;
        public final String packagePrefix;
        public final String file;
        public final int line;

        public Finding(Severity severity, String packagePrefix, String file, int line) {
            this.severity = severity;
            this.packagePrefix = packagePrefix;
            this.file = file;
            this.line = line;
        }
    }

    private final String repository;
    private final List<Finding> findings = new ArrayList<>();
    private String detectedJavaVersion = "unknown";
    private boolean hasGit;
    private boolean hasCloudManagerConfig;
    private String fatal;

    public AnalysisReport(String repository) {
        this.repository = repository;
    }

    public void detectedJavaVersion(String v) {
        this.detectedJavaVersion = v;
    }

    public void hasGit(boolean v) {
        this.hasGit = v;
    }

    public void hasCloudManagerConfig(boolean v) {
        this.hasCloudManagerConfig = v;
    }

    public void findings(List<Finding> more) {
        this.findings.addAll(more);
    }

    public void fatal(String message) {
        this.fatal = message;
    }

    public int blockerCount() {
        return (int) findings.stream().filter(f -> f.severity == Severity.BLOCKER).count();
    }

    public int warningCount() {
        return (int) findings.stream().filter(f -> f.severity == Severity.WARNING).count();
    }

    public Status status() {
        if (fatal != null) {
            return Status.INVALID;
        }
        if (blockerCount() > 0) {
            return Status.BLOCKED;
        }
        if (warningCount() > 0) {
            return Status.READY_WITH_WARNINGS;
        }
        return Status.READY;
    }

    public int exitCode() {
        switch (status()) {
            case INVALID:
            case BLOCKED:
                return 2;
            case READY_WITH_WARNINGS:
                return 1;
            case READY:
            default:
                return 0;
        }
    }

    public String toJson() {
        StringBuilder sb = new StringBuilder(256);
        sb.append('{');
        appendNumber(sb, "schemaVersion", SCHEMA_VERSION, true);
        appendString(sb, "tool", "aem-migrate", false);
        appendString(sb, "command", "analyze", false);
        appendString(sb, "repository", repository, false);
        appendString(sb, "detectedJavaVersion", detectedJavaVersion, false);
        appendBoolean(sb, "hasGit", hasGit, false);
        appendBoolean(sb, "hasCloudManagerConfig", hasCloudManagerConfig, false);
        appendString(sb, "status", status().name(), false);
        appendNumber(sb, "exitCode", exitCode(), false);
        appendNumber(sb, "blockerCount", blockerCount(), false);
        appendNumber(sb, "warningCount", warningCount(), false);
        sb.append(",\"findings\":[");
        for (int i = 0; i < findings.size(); i++) {
            Finding f = findings.get(i);
            if (i > 0) {
                sb.append(',');
            }
            sb.append('{');
            appendString(sb, "severity", f.severity.name(), true);
            appendString(sb, "package", f.packagePrefix, false);
            appendString(sb, "file", f.file, false);
            appendNumber(sb, "line", f.line, false);
            sb.append('}');
        }
        sb.append(']');
        sb.append(",\"fatal\":");
        if (fatal == null) {
            sb.append("null");
        } else {
            sb.append('"').append(escape(fatal)).append('"');
        }
        sb.append('}');
        return sb.toString();
    }

    public String toHumanReadable() {
        StringBuilder sb = new StringBuilder(512);
        sb.append("=== AEM 6.5 LTS Pre-Migration Analysis ===\n");
        sb.append("Repository:           ").append(repository).append('\n');
        sb.append("Detected Java:        ").append(detectedJavaVersion).append('\n');
        sb.append("Git working tree:     ").append(hasGit ? "yes" : "no").append('\n');
        sb.append("CloudManager config:  ").append(hasCloudManagerConfig ? "yes" : "no").append('\n');
        sb.append('\n');
        if (fatal != null) {
            sb.append("[FATAL] ").append(fatal).append('\n');
            return sb.toString();
        }
        if (findings.isEmpty()) {
            sb.append("No blockers or warnings detected.\n");
        } else {
            sb.append("Findings (").append(findings.size()).append("):\n");
            for (Finding f : findings) {
                sb.append("  [").append(f.severity).append("] ")
                        .append(f.file).append(':').append(f.line)
                        .append(" imports ").append(f.packagePrefix).append("*\n");
            }
            sb.append('\n');
        }
        sb.append("Status:               ").append(status()).append('\n');
        sb.append("Exit code:            ").append(exitCode()).append('\n');
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

    private static void appendBoolean(StringBuilder sb, String key, boolean value, boolean first) {
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
