## AEM Component Development Agent

AI-powered component generation skill that scaffolds complete, production-ready AEM components following Adobe best practices. Works with GitHub Copilot, Cursor, Claude Code, and Factory AI.

- Complete component generation: Dialog, HTL, Sling Model, Unit Tests, Clientlibs
- Multifield support with composite nested items
- Conditional dialog logic (show/hide/enable fields)
- Core Component extension with Sling Resource Merger
- Auto-generated JUnit 5 tests with AEM Mocks
- Creates ONLY the fields you specify (no hallucination)

### Prerequisites

- **IDE**: VS Code with GitHub Copilot, Cursor, or any Claude-enabled IDE
- **AEM Project**: Maven-based AEM project (created via AEM Archetype)
- **Java**: JDK 11+ / **Maven**: 3.6+

### Installation

Copy the skills folder for your AI assistant to your AEM project root (same level as `pom.xml`):

| AI Assistant | Copy to |
|--------------|---------|
| GitHub Copilot | `.github/skills/create-component/` |
| Claude Code | `.claude/skills/create-component/` |
| Cursor | `.cursor/skills/create-component/` |
| Factory AI | `.factory/skills/create-component/` |

### Configuration

On first use, the skill automatically detects your project settings (`project`, `package`, `group`) from `pom.xml` and existing components, asks you to confirm, and creates `.aem-skills-config.yaml` in your project root. No manual setup required.

You can also pre-create the config file manually if preferred.

Example configuration (using WKND project):

```yaml
configured: true          # Change from false to true

project: "wknd"           # Your AEM project name (check /apps/{project}/ or pom.xml)
package: "com.adobe.aem.guides.wknd.core"  # Java base package (check core/pom.xml)
group: "WKND Components"  # Component group in Touch UI (check existing .content.xml)
```

This file lives outside the skill directory, so it is never overwritten when you update the skill.

### Usage

In your IDE's AI chat:

```
Create an AEM component called "Hero Banner"

Dialog specification:
Title (title) - Textfield, mandatory
Subtitle (subtitle) - Textfield
Background Image (backgroundImage) - Fileupload
CTA Text (ctaText) - Textfield
CTA Link (ctaLink) - Pathfield
```

The AI will echo back your field specification for confirmation, then generate all files (component definition, dialog, HTL, Sling Model, unit tests, and clientlibs).

**With multifields:**

```
Create an AEM component called "Procedure Cards"

Dialog specification:
Title (listTitle) - Textfield, mandatory
Cards - Multifield containing:
  Card Title (cardTitle) - Textfield, mandatory
  Card Title URL (cardTitleURL) - Pathfield, editable when Card Title is non-empty
  Card Description (cardDesc) - Textarea
```

See `references/examples.md` inside the skill folder for more examples.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Project configuration required" | The skill should auto-detect settings on first use. If it doesn't, create `.aem-skills-config.yaml` in your project root with `configured: true` and your project values |
| Skill not recognized by AI assistant | Verify skill files exist at the correct path for your IDE (e.g., `.claude/skills/create-component/SKILL.md`) |
| AI generates wrong paths or package names | Check values in `.aem-skills-config.yaml` match your actual project structure |
