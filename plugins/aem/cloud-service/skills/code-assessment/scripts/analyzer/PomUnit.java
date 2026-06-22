package analyzer;

import org.w3c.dom.Document;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public final class PomUnit {
    public final Path path;
    public final String rel;
    public final List<String> lines;
    public final Document doc;

    public PomUnit(Path path, String rel, List<String> lines, Document doc) {
        this.path = path; this.rel = rel; this.lines = lines; this.doc = doc;
    }

    public static PomUnit parse(Path pom, String rel) throws Exception {
        List<String> lines = Files.readAllLines(pom, StandardCharsets.UTF_8);
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(false);
        // XXE hardening — best-effort: a parser lacking a feature must not break all pom parsing
        setFeatureQuietly(dbf, "http://javax.xml.XMLConstants/feature/secure-processing", true);
        setFeatureQuietly(dbf, "http://apache.org/xml/features/disallow-doctype-decl", true);
        setFeatureQuietly(dbf, "http://xml.org/sax/features/external-general-entities", false);
        setFeatureQuietly(dbf, "http://xml.org/sax/features/external-parameter-entities", false);
        dbf.setXIncludeAware(false);
        dbf.setExpandEntityReferences(false);
        DocumentBuilder builder = dbf.newDocumentBuilder();
        builder.setErrorHandler(new ErrorHandler() {
            public void warning(SAXParseException e) {}
            public void error(SAXParseException e) throws SAXException { throw e; }
            public void fatalError(SAXParseException e) throws SAXException { throw e; }
        });
        Document doc = builder.parse(pom.toFile());
        return new PomUnit(pom, rel, lines, doc);
    }

    private static void setFeatureQuietly(DocumentBuilderFactory f, String feature, boolean value) {
        try { f.setFeature(feature, value); } catch (Exception ignored) { /* feature unsupported on this parser */ }
    }
}
