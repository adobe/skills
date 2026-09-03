package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.PomUnit;
import analyzer.util.Poms;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Detects AEM 6.x product-package Vault install-time {@code <dependencies>} declared inside
 * {@code content-package-maven-plugin / <configuration>} that cannot be resolved on AEM as a
 * Cloud Service. The product packages (day/cq60/product, day/cq560/*, adobe/cq60) are baked
 * into the AEMaaCS container image and are not present in CRX Package Manager — so CRX refuses
 * to install the customer package at deploy time even though {@code mvn clean install} succeeds.
 *
 * <p>Emits one finding per {@code <dependencies>} block (not per {@code <dependency>} entry)
 * because the fix removes the entire block.
 */
public final class VaultPackageDependencies implements Detector {

    public String pattern() { return "vault-package-dependencies"; }
    public boolean needsJava() { return false; }  // pom-only detector

    /** Group-path prefixes whose packages don't exist on AEMaaCS. */
    private static final String[] LEGACY_PREFIXES = {
        "day/cq60/",
        "day/cq560/",
        "adobe/cq60",
    };

    private static boolean isLegacyGroup(String group) {
        if (group == null) return false;
        for (String p : LEGACY_PREFIXES) {
            if (group.startsWith(p) || group.equals(p.replaceAll("/$", ""))) return true;
        }
        return false;
    }

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (PomUnit pom : c.poms) {
            Map<String, Integer> cursor = new HashMap<>();
            NodeList plugins = pom.doc.getElementsByTagName("plugin");
            for (int i = 0; i < plugins.getLength(); i++) {
                Element plugin = (Element) plugins.item(i);
                String artifactId = Poms.childText(plugin, "artifactId");
                if (!"content-package-maven-plugin".equals(artifactId)) continue;

                // Find direct <configuration> children of this plugin
                NodeList pluginChildren = plugin.getChildNodes();
                for (int j = 0; j < pluginChildren.getLength(); j++) {
                    Node pch = pluginChildren.item(j);
                    if (pch.getNodeType() != Node.ELEMENT_NODE) continue;
                    if (!"configuration".equals(pch.getNodeName())) continue;
                    Element config = (Element) pch;

                    // Find direct <dependencies> children of configuration
                    NodeList configChildren = config.getChildNodes();
                    for (int k = 0; k < configChildren.getLength(); k++) {
                        Node cch = configChildren.item(k);
                        if (cch.getNodeType() != Node.ELEMENT_NODE) continue;
                        if (!"dependencies".equals(cch.getNodeName())) continue;
                        Element depList = (Element) cch;

                        // Emit one finding if any <dependency> carries a legacy <group>
                        NodeList deps = depList.getElementsByTagName("dependency");
                        for (int m = 0; m < deps.getLength(); m++) {
                            String group = Poms.childText((Element) deps.item(m), "group");
                            if (isLegacyGroup(group)) {
                                long ln = Poms.findLine(pom.lines,
                                    "<artifactId>content-package-maven-plugin</artifactId>",
                                    cursor);
                                out.add(new Finding(pattern(), pom.rel, ln,
                                    "content-package-maven-plugin: legacy Vault dependency group=" + group));
                                break; // one finding per <dependencies> block
                            }
                        }
                    }
                }
            }
        }
    }
}
