package com.adobe.aem.migration.recipes;

import lombok.EqualsAndHashCode;
import lombok.Value;
import org.openrewrite.*;
import org.openrewrite.maven.MavenIsoVisitor;
import org.openrewrite.xml.ChangeTagValueVisitor;
import org.openrewrite.xml.tree.Xml;

import java.util.Optional;

@Value
@EqualsAndHashCode(callSuper = false)
public class ChangeFilevaultEmbeddedArtifact extends Recipe {

    @Option(displayName = "Old groupId",
            description = "The current groupId of the embedded artifact (glob pattern).",
            example = "com.icfolson.aem*")
    String oldGroupId;

    @Option(displayName = "Old artifactId",
            description = "The current artifactId of the embedded artifact (glob pattern).",
            example = "aem-groovy-console*")
    String oldArtifactId;

    @Option(displayName = "New groupId",
            description = "The new groupId to set.",
            example = "be.orbinson.aem")
    String newGroupId;

    @Option(displayName = "New artifactId",
            description = "The new artifactId to set. Leave empty to keep the original.",
            example = "aem-groovy-console",
            required = false)
    String newArtifactId;

    @Override
    public String getDisplayName() {
        return "Change FileVault embedded artifact coordinates";
    }

    @Override
    public String getDescription() {
        return "Updates the groupId and optionally the artifactId of embedded artifacts " +
               "in filevault-package-maven-plugin configuration.";
    }

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        return new MavenIsoVisitor<ExecutionContext>() {
            @Override
            public Xml.Tag visitTag(Xml.Tag tag, ExecutionContext ctx) {
                Xml.Tag t = super.visitTag(tag, ctx);

                if (!"embedded".equals(t.getName())) {
                    return t;
                }

                if (!isInsideFileVaultPlugin()) {
                    return t;
                }

                Optional<String> groupId = t.getChild("groupId")
                        .flatMap(Xml.Tag::getValue);
                Optional<String> artifactId = t.getChild("artifactId")
                        .flatMap(Xml.Tag::getValue);

                if (!groupId.isPresent() || !artifactId.isPresent()) {
                    return t;
                }

                if (!matchesGlob(groupId.get().trim(), oldGroupId)) {
                    return t;
                }
                if (!matchesGlob(artifactId.get().trim(), oldArtifactId)) {
                    return t;
                }

                t.getChild("groupId").ifPresent(g ->
                    doAfterVisit(new ChangeTagValueVisitor<>(g, newGroupId)));

                if (newArtifactId != null && !newArtifactId.isEmpty()) {
                    t.getChild("artifactId").ifPresent(a ->
                        doAfterVisit(new ChangeTagValueVisitor<>(a, newArtifactId)));
                }

                return t;
            }

            private boolean isInsideFileVaultPlugin() {
                Cursor parent = getCursor().getParent();
                while (parent != null) {
                    if (parent.getValue() instanceof Xml.Tag) {
                        Xml.Tag parentTag = (Xml.Tag) parent.getValue();
                        if ("plugin".equals(parentTag.getName())) {
                            String groupId = parentTag.getChild("groupId")
                                    .flatMap(Xml.Tag::getValue)
                                    .map(String::trim)
                                    .orElse("org.apache.jackrabbit");
                            String artifactId = parentTag.getChild("artifactId")
                                    .flatMap(Xml.Tag::getValue)
                                    .map(String::trim)
                                    .orElse("");
                            return "org.apache.jackrabbit".equals(groupId)
                                    && "filevault-package-maven-plugin".equals(artifactId);
                        }
                    }
                    parent = parent.getParent();
                }
                return false;
            }

            private boolean matchesGlob(String value, String pattern) {
                String regex = pattern
                        .replace(".", "\\.")
                        .replace("*", ".*")
                        .replace("?", ".");
                return value.matches(regex);
            }
        };
    }
}
