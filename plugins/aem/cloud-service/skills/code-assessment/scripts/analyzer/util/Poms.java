package analyzer.util;

import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class Poms {
    private Poms() {}

    public static String childText(Element parent, String tag) {
        NodeList n = parent.getElementsByTagName(tag);
        for (int i = 0; i < n.getLength(); i++) {
            if (n.item(i).getParentNode() == parent) return n.item(i).getTextContent().trim();
        }
        return null;
    }

    public static boolean underAny(Node n, String... tags) {
        Set<String> set = new HashSet<>(Arrays.asList(tags));
        for (Node p = n.getParentNode(); p != null; p = p.getParentNode()) {
            if (p.getNodeType() == Node.ELEMENT_NODE && set.contains(p.getNodeName())) return true;
        }
        return false;
    }

    public static long findLine(List<String> lines, String needle, Map<String, Integer> cursor) {
        int from = cursor.getOrDefault(needle, 0);
        for (int i = from; i < lines.size(); i++) {
            if (lines.get(i).contains(needle)) { cursor.put(needle, i + 1); return i + 1; }
        }
        return -1;
    }

    public static boolean isReactorVersion(String v) {
        String t = v.trim();
        return t.equals("${project.version}") || t.equals("${project.parent.version}")
            || t.equals("${version}") || t.equals("${parent.version}")
            || t.equals("${revision}") || t.equals("${changelist}") || t.equals("${sha1}");
    }
}
