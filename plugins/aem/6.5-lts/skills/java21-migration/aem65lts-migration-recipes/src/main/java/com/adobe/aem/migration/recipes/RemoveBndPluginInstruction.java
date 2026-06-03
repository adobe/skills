package com.adobe.aem.migration.recipes;

import lombok.EqualsAndHashCode;
import lombok.Value;
import org.openrewrite.*;
import org.openrewrite.maven.MavenIsoVisitor;
import org.openrewrite.xml.RemoveContentVisitor;
import org.openrewrite.xml.tree.Xml;

@Value
@EqualsAndHashCode(callSuper = false)
public class RemoveBndPluginInstruction extends Recipe {

    @Option(displayName = "Instruction pattern",
            description = "Text pattern to match inside <_plugin> instructions that should be removed.",
            example = "SCRDescriptorBndPlugin")
    String instructionPattern;

    @Override
    public String getDisplayName() {
        return "Remove BND plugin instruction";
    }

    @Override
    public String getDescription() {
        return "Removes <_plugin> instruction elements from maven-bundle-plugin configuration " +
               "that match the specified pattern. Used to remove SCRDescriptorBndPlugin which " +
               "is incompatible with Java 21.";
    }

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        return new MavenIsoVisitor<ExecutionContext>() {
            @Override
            public Xml.Tag visitTag(Xml.Tag tag, ExecutionContext ctx) {
                Xml.Tag t = super.visitTag(tag, ctx);

                if (!"_plugin".equals(t.getName())) {
                    return t;
                }

                // Check we're inside maven-bundle-plugin > configuration > instructions
                if (!isInsideBundlePluginInstructions()) {
                    return t;
                }

                // Check if the content matches the pattern
                String content = t.getValue().orElse("");
                if (content.contains(instructionPattern)) {
                    doAfterVisit(new RemoveContentVisitor<>(t, false, false));
                }

                return t;
            }

            private boolean isInsideBundlePluginInstructions() {
                Cursor cursor = getCursor();
                boolean foundInstructions = false;
                boolean foundPlugin = false;

                Cursor parent = cursor.getParent();
                while (parent != null) {
                    if (parent.getValue() instanceof Xml.Tag) {
                        Xml.Tag parentTag = parent.getValue();
                        if ("instructions".equals(parentTag.getName())) {
                            foundInstructions = true;
                        }
                        if ("plugin".equals(parentTag.getName())) {
                            // Verify it's the maven-bundle-plugin
                            boolean isBundlePlugin = parentTag.getChild("artifactId")
                                    .flatMap(Xml.Tag::getValue)
                                    .map(v -> v.trim().equals("maven-bundle-plugin"))
                                    .orElse(false);
                            if (isBundlePlugin) {
                                foundPlugin = true;
                            }
                            break;
                        }
                    }
                    parent = parent.getParent();
                }
                return foundInstructions && foundPlugin;
            }
        };
    }
}
