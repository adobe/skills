# Launcher Condition Patterns — AEM 6.5 LTS

## Glob Pattern Syntax

The `glob` property uses a glob/regex hybrid. AEM's `WorkflowLauncherListener` matches the event node path against the glob.

| Pattern | Matches |
|---|---|
| `/content/dam(/.*)?` | `/content/dam` and all descendants |
| `/content/dam/.*` | All direct and indirect children of `/content/dam` |
| `/content/dam/brand1/.*` | Everything under `/content/dam/brand1` |
| `/content/dam/*/jcr:content` | `jcr:content` of any direct child of `/content/dam` |
| `/content/[^/]+/en(/.*)?` | `en` branch of any top-level site |

**Note:** The path matched is the **event node path**. For DAM assets, the event fires on `dam:AssetContent` (the `jcr:content` node), not on `dam:Asset` itself.

---

## Event Type Patterns

### Single Event Types

```xml
eventType="{Long}1"   <!-- NODE_ADDED only -->
eventType="{Long}2"   <!-- NODE_MODIFIED only -->
eventType="{Long}4"   <!-- NODE_REMOVED only -->
```

### Combined Event Types

```xml
eventType="{Long}3"   <!-- ADD + MODIFY (1+2) -->
eventType="{Long}6"   <!-- MODIFY + REMOVE (2+4) -->
eventType="{Long}7"   <!-- ADD + MODIFY + REMOVE (1+2+4) -->
```

---

## Common Condition Patterns

### Match a Specific Property Value

Fire only when the node has `cq:type = "publicationevent"`:
```
property=cq:type,value=publicationevent,type=STRING
```

### Match a Boolean Property

Fire only when `dam:sha1Changed = true`:
```
property=dam:sha1Changed,value=true,type=BOOLEAN
```

Multiple conditions use multiple array entries — all must match (AND logic). Each entry is its own string in the multi-value `conditions` property; the inner commas inside each entry must be backslash-escaped in `.content.xml` so the FileVault parser does not split them as array separators:

```xml
conditions="[property=cq:type\,value=publicationevent\,type=STRING,property=jcr:mimeType\,value=image/jpeg\,type=STRING]"
```

The unescaped form (`property=cq:type,value=publicationevent,...` without backslashes) parses as a single garbled entry and silently makes the launcher never match.

---

## Common Node Type Patterns

| Use Case | `nodetype` |
|---|---|
| DAM asset upload | `dam:AssetContent` |
| Rendition file change | `nt:file` |
| Page edit | `cq:PageContent` |
| Generic content node | `nt:unstructured` |
| Any node (no filter) | *(omit the property)* |

---

## Avoiding Infinite Loops

A launcher can cause a loop if a workflow step writes to a path the same launcher watches.

**Prevention strategies:**

1. **Add the workflow model to `excludeList`:** The launcher will not re-fire if the triggering session belongs to the same model
2. **Mark the JCR session in the process step:** Set user data to the globally excluded value so the launcher ignores events from that session

```java
// In WorkflowProcess.execute() — mark this session so launchers ignore it
Session jcrSession = resolver.adaptTo(Session.class);
jcrSession.getWorkspace().getObservationManager()
    .setUserData("workflowmanager");
// "workflowmanager" = WorkflowLauncherListener.GLOBALLY_EXCLUDED_EVENT_USER_DATA
```

3. **Use a JCR property flag**: Set a flag property on the node before saving in the workflow step; add a launcher condition to skip nodes with that flag

---

## Run Mode Patterns

> **`runModes` on `cq:WorkflowLauncher` is unreliable on AEM 6.5 LTS.** The property is honored inconsistently — launchers can fire on the wrong run mode despite the restriction. **Default to packaging the launcher's `.content.xml` under `config.author/` (or `config.publish/`)** in your content package and let Sling's run-mode-aware OSGi config handling do the gating. The `runModes` examples below are documented for completeness only — do not generate them as the primary mechanism for run-mode restriction.

### Author Only (Most Common for Launchers)

```xml
runModes="[author]"
```

### Publish Only (Rare)

```xml
runModes="[publish]"
```

### All Run Modes

```xml
<!-- omit runModes entirely -->
```

---

## 6.5 LTS-Specific: Paths That Are Globally Excluded

The `WorkflowLauncherListener` ignores events under these paths regardless of launcher configuration:
- `/var` — workflow instances and runtime data
- `/tmp` — temporary storage
- `/jcr:system` — JCR system nodes

Events from the user `anonymous` are also suppressed.

---

## Testing Your Launcher Configuration

After deploying your launcher:

1. Verify it appears at **Tools → Workflow → Launchers** with **Enabled** status
2. Trigger the event manually (e.g., upload a file to the watched path)
3. Check **Tools → Workflow → Instances** to confirm a new instance was created
4. If no instance appears: check the CRXDE path, glob pattern, and node type match the actual event node
5. Enable `DEBUG` logging for `com.adobe.granite.workflow.core.launcher` in the Felix console
