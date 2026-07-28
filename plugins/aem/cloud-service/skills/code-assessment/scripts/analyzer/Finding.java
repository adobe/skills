package analyzer;

public final class Finding {
    public final String pattern, file, snippet;
    public final long line;
    // Optional detection-time hint (e.g. successor package parsed from the AEM Analyser
    // Maven Plugin's deprecation message). Null for detectors that do not carry hints —
    // the JSON encoder omits the field entirely in that case.
    public final String hint;

    public Finding(String pattern, String file, long line, String snippet) {
        this(pattern, file, line, snippet, null);
    }

    public Finding(String pattern, String file, long line, String snippet, String hint) {
        this.pattern = pattern; this.file = file; this.line = line; this.snippet = snippet;
        this.hint = hint;
    }
}
