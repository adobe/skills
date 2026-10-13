# `.modernize/config.json` schema (v1)

**Agent:** This is the shared contract every `repo-modernize` script reads and writes. `scripts/inspect_project.py` proposes it, the human confirm gate edits it, and every later script (`scaffold_modules.py`, `split_content.py`, `validate.py`, …) consumes it as-is. Do not invent additional top-level keys without updating this file first.

This exact v1 shape:

```json
{
  "schemaVersion": 1,
  "projectShape": "SINGLE",
  "groupId": "com.adobe.aem.guides",
  "artifactId": "aem-guides-wknd",
  "appId": "wknd",
  "appTitle": "WKND",
  "version": "1.0.0-SNAPSHOT",
  "targetModules": {
    "all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
    "uiConfig": "ui.config", "uiContent": "ui.content"
  },
  "bundles": [{"path": "core", "artifactIdSuffix": "core", "isTest": false},
              {"path": "bundle2", "artifactIdSuffix": "bundle2", "isTest": false}],
  "testBundles": [{"path": "it.tests"}, {"path": "it.launcher"}],
  "contentPackages": [
    {"path": "ui.apps", "jcrRoot": "ui.apps/src/main/content/jcr_root",
     "filterXml": "ui.apps/src/main/content/META-INF/vault/filter.xml"},
    {"path": "ui.content", "jcrRoot": "ui.content/src/main/content/jcr_root",
     "filterXml": "ui.content/src/main/content/META-INF/vault/filter.xml"},
    {"path": "oak-indexes", "jcrRoot": "oak-indexes/src/main/content/jcr_root",
     "filterXml": "oak-indexes/src/main/content/META-INF/vault/filter.xml"}
  ],
  "runModeDecisions": {}
}
```

## Field notes

- **`schemaVersion`** — integer, currently `1`. Recorded on every config for forward-compatibility; no script enforces it today (there is only one schema version to enforce against). Version-enforcement logic will land once a second schema version exists.
- **`projectShape`** — how the legacy project is laid out. Only `"SINGLE"` (one content package spanning `/apps` and `/content`) is supported today.
- **`groupId` / `artifactId` / `version`** — read from the root POM; carried forward onto the scaffolded Cloud Service modules.
- **`appId` / `appTitle`** — the app's short machine name and display title, used to name generated modules and content paths.
- **`targetModules`** — logical module name → on-disk directory name. The confirm gate is where a developer renames these if they collide with something already in the tree.
- **`bundles` / `testBundles`** — the project's existing Java (OSGi bundle) modules, each with its own POM path and artifact suffix; `testBundles` are excluded from the `all` content package.
- **`contentPackages`** — the content packages the split step produces or targets, each pointing at its `jcr_root` and `filter.xml` on disk.
- **`runModeDecisions`** — reserved for Phase 2 (OSGi/run-mode conversion); starts empty in Phase 1.
