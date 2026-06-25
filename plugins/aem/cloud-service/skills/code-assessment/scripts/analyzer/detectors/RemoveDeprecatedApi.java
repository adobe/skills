package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;
import analyzer.OsgiUnit;
import analyzer.PomUnit;
import analyzer.util.Poms;
import com.sun.source.tree.ImportTree;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class RemoveDeprecatedApi implements Detector {
    public String pattern() { return "remove-deprecated-api"; }
    public boolean needsOsgi() { return true; }

    // {import-prefix, deadline_iso or null for already-enforced}
    private static final String[][] IMPORT_RULES = {
        // already enforced (April 14, 2026)
        {"org.apache.sling.commons.auth.",          null},
        {"org.eclipse.jetty.",                      null},
        {"com.mongodb.",                            null},
        {"org.apache.abdera.",                      null},
        {"org.apache.felix.http.whiteboard.",       null},
        {"ch.qos.logback.",                         null},
        {"org.slf4j.spi.",                          null},
        {"org.slf4j.event.",                        null},
        {"org.apache.log4j.",                       null},
        {"com.google.common.",                      null},
        {"org.apache.cocoon.xml.",                  null},
        {"org.apache.felix.webconsole.",            null},
        {"com.drew.",                               null},
        {"org.apache.jackrabbit.oak.plugins.memory.", null},
        // HIGH — March 31, 2027
        {"com.adobe.granite.xss.",                  "2027-03-31"},
        {"com.day.cq.xss.",                         "2027-03-31"},
        {"com.github.jknack.handlebars.",           "2027-03-31"},
        {"org.apache.tika.",                        "2027-03-31"},
        {"org.bson.",                               "2027-03-31"},
        {"org.apache.jackrabbit.oak.plugins.blob.", "2027-03-31"},
        {"com.day.cq.contentsync.handler.util.",    "2027-03-31"},
        {"com.day.cq.mailer.commons.",              "2027-03-31"},
        {"com.adobe.granite.httpcache.api.",        "2027-03-31"},
        {"org.apache.jackrabbit.webdav.client.methods.", "2027-03-31"},
        {"org.apache.commons.fileupload.",          "2027-03-31"},
        {"com.adobe.cq.smartcontent.",              "2027-03-31"},
        {"opennlp.tools.",                          "2027-03-31"},
        {"com.day.cq.commons.predicate.",           "2027-03-31"},
        // MEDIUM — Dec 31, 2027
        {"org.apache.commons.lang.",                "2027-12-31"},
        {"org.apache.commons.collections.",         "2027-12-31"},
        {"org.json.",                               "2027-12-31"},
        {"org.apache.sling.runmode.",               "2027-12-31"},
        {"org.apache.sling.commons.json.",          "2027-12-31"},
        {"org.osgi.service.http.",                  "2027-12-31"},
    };

    // {groupId, artifactId or "*", deadline_iso or null}
    private static final String[][] DEP_RULES = {
        {"log4j",               "log4j",              null},
        {"ch.qos.logback",      "*",                  null},
        {"com.github.jknack",   "handlebars",         "2027-03-31"},
        {"org.apache.opennlp",  "opennlp-tools",      "2027-03-31"},
        {"commons-lang",        "commons-lang",       "2027-12-31"},
        {"commons-collections", "commons-collections","2027-12-31"},
        {"org.json",            "json",               "2027-12-31"},
    };

    private static final String[] OSGI_PIDS = {
        "org.apache.sling.commons.log.LogManager",
        "org.apache.sling.jcr.davex.impl.servlets.SlingDavExServlet",
        "com.adobe.granite.toggle.impl.dev.DynamicToggleProviderImpl",
        "org.apache.http.proxyconfigurator",
        "com.day.cq.auth.impl.cug.CugSupportImpl",
        "com.day.cq.jcrclustersupport.ClusterStartLevelController",
    };

    private static boolean isActive(String deadline) {
        if (deadline == null) return true;
        return !LocalDate.parse(deadline).isAfter(LocalDate.now());
    }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            for (ImportTree imp : u.cu.getImports()) {
                String q = imp.getQualifiedIdentifier().toString();
                for (String[] rule : IMPORT_RULES) {
                    if (!isActive(rule[1]) && !c.allowAll) continue;
                    if (q.startsWith(rule[0])) {
                        out.add(new Finding(pattern(), u.rel, u.lineOf(imp), q));
                        break;
                    }
                }
            }
        }

        for (PomUnit pom : c.poms) {
            Map<String, Integer> cursor = new HashMap<>();
            NodeList deps = pom.doc.getElementsByTagName("dependency");
            for (int i = 0; i < deps.getLength(); i++) {
                Element d = (Element) deps.item(i);
                if (Poms.underAny(d, "build", "plugin", "pluginManagement", "reporting")) continue;
                String g = Poms.childText(d, "groupId");
                String a = Poms.childText(d, "artifactId");
                if (g == null || a == null) continue;
                for (String[] rule : DEP_RULES) {
                    if (!isActive(rule[2]) && !c.allowAll) continue;
                    if (rule[0].equals(g) && ("*".equals(rule[1]) || rule[1].equals(a))) {
                        long ln = Poms.findLine(pom.lines, "<artifactId>" + a + "</artifactId>", cursor);
                        out.add(new Finding(pattern(), pom.rel, ln, g + ":" + a));
                        break;
                    }
                }
            }
        }

        for (OsgiUnit osgi : c.osgi) {
            for (String pid : OSGI_PIDS) {
                if (pid.equals(osgi.pid)) {
                    out.add(new Finding(pattern(), osgi.rel, 1, osgi.pid));
                    break;
                }
            }
        }
    }
}
