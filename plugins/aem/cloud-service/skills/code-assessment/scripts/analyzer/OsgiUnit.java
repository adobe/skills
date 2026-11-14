package analyzer;

import java.nio.file.Path;

public final class OsgiUnit {
    public final Path path;
    public final String rel;
    public final String pid;

    public OsgiUnit(Path path, String rel, String pid) {
        this.path = path; this.rel = rel; this.pid = pid;
    }

    // "org.apache.sling.commons.log.LogManager.cfg" -> "org.apache.sling.commons.log.LogManager"
    // "org.apache.sling.commons.log.LogManager-author.cfg" -> same (strip run-mode)
    // "com.example.MyFactory~instance1.cfg.json" -> "com.example.MyFactory" (strip factory suffix)
    public static String pidFromFilename(String filename) {
        String base = filename;
        if (base.endsWith(".cfg.json")) base = base.substring(0, base.length() - ".cfg.json".length());
        else if (base.endsWith(".config"))  base = base.substring(0, base.length() - ".config".length());
        else if (base.endsWith(".cfg"))     base = base.substring(0, base.length() - ".cfg".length());
        int dash = base.indexOf('-');
        if (dash > 0) base = base.substring(0, dash);
        int tilde = base.indexOf('~');
        if (tilde > 0) base = base.substring(0, tilde);
        return base;
    }
}
