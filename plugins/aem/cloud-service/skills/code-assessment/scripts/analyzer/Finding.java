package analyzer;

public final class Finding {
    public final String pattern, file, snippet;
    public final long line;
    public Finding(String pattern, String file, long line, String snippet) {
        this.pattern = pattern; this.file = file; this.line = line; this.snippet = snippet;
    }
}
