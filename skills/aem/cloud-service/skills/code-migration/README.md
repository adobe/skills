# AEM Cloud Service Code Migration Skills

This plugin provides skills for migrating AEM code from legacy patterns to AEM Cloud Service compatible patterns.

## Skills

### aem-migration

Migrates AEM Java code from legacy patterns to AEM Cloud Service compatible patterns. Each pattern has a dedicated transformation module with specific migration paths.

**Supported Migration Patterns:**
- **Scheduler** - Migrate from legacy Sling Scheduler to Cloud Service compatible patterns
- **Resource Change Listener** - Update ResourceChangeListener implementations for cloud compatibility
- **Replication** - Transform replication code to use Sling Content Distribution
- **Event Listener** - Migrate JCR EventListener to modern patterns
- **Event Handler** - Update OSGi EventHandler implementations
- **Asset Manager** - Modernize Asset API usage for cloud deployment

**Key Features:**
- Automatic Best Practices Analyzer (BPA) integration
- Pattern-specific transformation modules
- Sub-path classification for complex migrations
- Validation and testing support
- Preserves business logic while updating patterns

## Installation

### Claude Code Plugins
```bash
/plugin install aem-cloud-service-code-migration@adobe-skills
```

### Vercel Skills
```bash
npx skills add adobe/skills -s aem-migration
```

### upskill (GitHub CLI Extension)
```bash
gh upskill adobe/skills --path skills/aem/cloud-service/skills/code-migration --all
```

## Usage

The skill automatically detects migration patterns and guides you through the transformation process:

1. **Pattern Detection** - Identifies which legacy pattern needs migration
2. **BPA Integration** - Uses Best Practices Analyzer findings when available
3. **Classification** - Determines the appropriate migration path
4. **Transformation** - Applies pattern-specific changes
5. **Validation** - Ensures code compiles and follows best practices

## Prerequisites

- AEM project with proper Maven/Gradle build setup
- Access to source code requiring migration
- Best Practices Analyzer results (recommended but optional)
- Understanding of target AEM Cloud Service patterns

## Support

For issues or questions about these migration skills, please refer to the main [Adobe Skills repository](https://github.com/adobe/skills).