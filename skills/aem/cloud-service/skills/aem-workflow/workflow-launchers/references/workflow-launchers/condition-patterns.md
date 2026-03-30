# Launcher Condition Patterns — AEM Cloud Service

## Glob Pattern Syntax

The `glob` property uses a glob/regex hybrid. AEM's `WorkflowLauncherListener` matches the event node path against the glob using the following rules:

| Pattern | Matches |
|---|---|
| `/content/dam(/.*)?` | `/content/dam` and all descendants |
| `/content/dam/.*` | All direct and indirect children of `/content/dam` (regex) |
| `/content/dam/brand1/.*` | Everything under `/content/dam/brand1` |
| `/content/dam/*/jcr:content` | `jcr:content` of any direct child of `/content/dam` |
| `/content/dam/**/jcr:content` | `jcr:content` at any depth under `/content/dam` |
| `/content/[^/]+/en(/.*)?` | `en` branch of any top-level site |

**Note:** The path matched is the **event node path**, not the asset or page path. For DAM assets, the event fires on `dam:AssetContent` (the `jcr:content` node of the asset), not on the `dam:Asset` node itself.

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

### Match a Numeric Property Threshold

This is limited — conditions support equality only, not comparisons. For threshold logic, implement a `WorkflowProcess` step that validates and terminates early if the condition is not met.

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

## Glob-to-Payload Mapping

The `glob` path matches the **event node**, not the workflow payload. The workflow payload is typically set to:
- For DAM: the `dam:Asset` path (the asset node, not `jcr:content`)
- For Pages: the `cq:Page` path (the page node, not `jcr:content`)

Example:
- Event fires on: `/content/dam/brand1/hero.png/jcr:content/renditions/original`
- Workflow payload set to: `/content/dam/brand1/hero.png` (resolved up the tree)

The payload derivation logic is handled by the launcher engine, which walks up from the event node to find the first `dam:Asset`, `cq:Page`, or the event node itself, depending on the configuration.

---

## Run Mode Patterns

### Author Only (Most Common for Launchers)

```xml
runModes="[author]"
```

Launchers configured this way will not fire on publish tier, which is typical because content changes originate on Author.

### Both Author and Publish

```xml
<!-- omit runModes entirely -->
```

### Publish Only (Rare)

```xml
runModes="[publish]"
```

---

## Avoiding Infinite Loops

A launcher can cause a loop if:
1. Workflow step A modifies content at path X
2. The launcher watches path X and fires again
3. New workflow instance starts → modifies X again → loop

**Prevention strategies:**

1. **Add the workflow model to `excludeList`:** The launcher will not re-fire if the last write was by the same workflow model
2. **Set user data on the JCR session:** Use `session.setUserData(WorkflowLauncherListener.GLOBALLY_EXCLUDED_EVENT_USER_DATA)` in your process step to mark the session so the launcher ignores events from it
3. **Use a condition** to check a flag set by the workflow step that prevents re-triggering

```java
// In WorkflowProcess.execute() — mark this session so launchers ignore it
Session jcrSession = resolver.adaptTo(Session.class);
jcrSession.getWorkspace().getObservationManager()
    .setUserData("workflowmanager");
```

The string `"workflowmanager"` is the value of `WorkflowLauncherListener.GLOBALLY_EXCLUDED_EVENT_USER_DATA`.
