# remove-deprecated-api

Migrates AEM projects away from deprecated and removed APIs to comply with AEM as a Cloud
Service enforcement requirements. Operates entirely against the local workspace — no external
services or network calls beyond Maven dependency resolution.

## What it fixes

| Category | Examples |
|---|---|
| Java imports (already enforced) | `org.apache.log4j` → SLF4J, `org.apache.sling.commons.auth` → `org.apache.sling.auth` |
| Java imports (deadline Mar 2027) | `com.adobe.granite.xss` / `com.day.cq.xss` → `org.apache.sling.xss`, `com.day.cq.commons.predicate` → `predicates` |
| Java imports (deadline Dec 2027) | `org.apache.commons.lang` → `lang3`, `org.apache.commons.collections` → `collections4` |
| Maven dependencies | Remove `log4j:log4j`, `ch.qos.logback:*`; replace `commons-lang`, `commons-collections`, `org.json` |
| OSGi configs | Delete unmodifiable configs (LogManager, SlingDavExServlet, DynamicToggleProvider, and more) |

Enforcement deadlines are checked against today's date — rules whose deadline hasn't passed are skipped and automatically picked up on the next run.

## Structure

```
remove-deprecated-api/
├── SKILL.md     ← skill entry point and description
├── README.md    ← this file
└── recipe.md    ← step-by-step execution procedure
```

## Requirements

- Apache Maven 3.x or newer with a supported JVM
