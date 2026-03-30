---
name: create-component
description: |
  Creates complete AEM components with dialog, HTL template, Sling Model, unit tests, and clientlibs.
  Use when user asks to create, build, or generate an AEM component. Supports extending Core Components
  and project components. Follows Adobe Experience League best practices for AEM Cloud Service and 6.5.
license: Apache-2.0
compatibility: Requires AEM as a Cloud Service or AEM 6.5. Maven project structure with core, ui.apps modules.
metadata:
  version: "1.0"
  aem_version: "6.5/Cloud Service"
---

# AEM Component Creation Skill

Creates complete AEM components following Adobe best practices.

---

## MANDATORY FIRST ACTION - Configuration Check

> **YOU MUST PERFORM THIS CHECK BEFORE ANYTHING ELSE**

**FIRST TOOL CALL**: Read `.aem-skills-config.yaml` in the **project root** (same level as `pom.xml`).

| Status | Action |
|--------|--------|
| File exists AND `configured: true` | Read `project`, `package`, and `group` values. **Proceed to Step 1.** |
| File exists but `configured: false` or values are empty | **Auto-detect values** (see below), confirm with user, update the file, then proceed. |
| File does NOT exist | **Auto-detect values** (see below), confirm with user, create the file, then proceed. |

### Auto-Detection of Project Values

When the config file is missing or not yet configured, detect values from the codebase:

1. **project**: Read root `pom.xml` → look for `<artifactId>` under the root `<project>`. Fallback: list directories under `ui.apps/src/main/content/jcr_root/apps/` to find the project folder name.
2. **package**: Read `core/pom.xml` → look for a `<package>` element or construct from `<groupId>` + `<artifactId>`. Fallback: find any `.java` file under `core/src/main/java/` and read its `package` declaration.
3. **group**: Find any existing component's `.content.xml` under `ui.apps/.../components/` and read the `componentGroup` attribute. Fallback: derive from the project name by converting to title case and appending " Components" (e.g., project `wknd` → `WKND Components`).

### Confirm with User

Display the detected values and **wait for user confirmation before proceeding**:

```
I detected the following project settings:
- project: "{detected-project}"
- package: "{detected-package}"
- group: "{detected-group}"

Are these correct? (If not, please provide the correct values)
```

### Write Config File

After user confirms (or provides corrections):
- Write `.aem-skills-config.yaml` to the project root with the confirmed values and `configured: true`
- Proceed to Step 1

**IMPORTANT**: Auto-detection is ONLY for first-time setup. Once `.aem-skills-config.yaml` exists with `configured: true`, always read values from the file — never re-detect.

---

## No Hallucination Rule

**STRICT REQUIREMENT**: Create ONLY fields explicitly specified by user. No additions, no renames.

**Load reference for full rules:** `references/no-hallucination-rules.md`

---

## Workflow Overview

| Step | Action |
|------|--------|
| 0 | Configuration setup (MANDATORY FIRST) |
| 1 | Extract & validate component name |
| 1.5 | Component extension decision (if extending) |
| 2 | Gather requirements & confirm dialog specification |
| 3 | Create all component files |
| 3.11 | **Dependency verification (MANDATORY for servlets)** |
| 4 | Completion summary |

---

## Step 0: Configuration Setup

### 0.1 Read or Create Configuration
1. Read `.aem-skills-config.yaml` from the project root
2. If `configured: true` → read `project`, `package`, `group` values and skip to 0.3
3. If file is missing or `configured: false` → auto-detect values, confirm with user, write/update the file (see "MANDATORY FIRST ACTION" section above)

### 0.2 Config File is the Source of Truth

After setup, **`.aem-skills-config.yaml` is the SINGLE SOURCE OF TRUTH** for `project`, `package`, and `group`. Do not re-detect or override these values on subsequent runs.

### 0.3 Load Conventions
1. Read `references/aem-conventions.md` for file structure templates, naming conventions, and patterns

### 0.4 Project State Analysis (after configuration validated)

1. **Check Component Name Uniqueness** - Look in `/apps/[project]/components/`
2. **Check Model Class Conflicts** - Look in `core/src/main/java/[package-path]/models/`
3. **Analyze Existing Patterns** - Review 1-2 recent components for style reference

---

## Step 1: Extract & Validate Component Name

- Parse component name from user's message (ask if not provided)
- Normalize to lowercase kebab-case (e.g., `My Component` -> `my-component`)
- Validate: starts with letter, only letters/numbers/hyphens, no consecutive hyphens

---

## Step 1.5: Component Extension Decision

### When user says "extend {component}":

**Tier 1: Check Project Components First**
- Search `/apps/{project}/components/{component}`
- If found -> Use as `sling:resourceSuperType`

**Tier 2: Check Core Components**

| User Says | Maps To |
|-----------|---------|
| image | `core/wcm/components/image/v3/image` |
| teaser, card | `core/wcm/components/teaser/v2/teaser` |
| text, richtext | `core/wcm/components/text/v2/text` |
| title, heading | `core/wcm/components/title/v3/title` |
| list | `core/wcm/components/list/v4/list` |
| button, cta | `core/wcm/components/button/v2/button` |
| navigation, nav | `core/wcm/components/navigation/v2/navigation` |
| container, section | `core/wcm/components/container/v1/container` |
| accordion | `core/wcm/components/accordion/v1/accordion` |
| tabs | `core/wcm/components/tabs/v1/tabs` |
| carousel | `core/wcm/components/carousel/v1/carousel` |
| embed, video | `core/wcm/components/embed/v2/embed` |

**Tier 3: Not Found** - Ask user for clarification.

**For extension patterns, load:** `references/extending-core-components.md`

---

## Step 1.6: Core Component Extension Requirements

**MANDATORY when extending with "hide", "remove", "add custom field", or "override":**

**Load reference:** `references/extending-core-components.md`

| User Request | Action |
|--------------|--------|
| "Add custom fields" | Create new tab OR add to existing |
| "Hide {tab}" | Use `sling:hideResource="{Boolean}true"` |
| "Hide {field}" | Use `sling:hideResource="{Boolean}true"` |
| "Override {field}" | Use `sling:hideProperties` + new values |

**When extending Core Components:**
- Use `@Self @Via(type = ResourceSuperType.class)` for model delegation
- Implement `ComponentExporter` interface
- Add `resourceType` to `@Model` annotation
- Use `sling:hideResource` in dialog for inherited tabs/fields

---

## Step 2: Gather Requirements

### 2.1 Parse Dialog Specification

Echo back EXACTLY what you understood before creating:

```
Dialog Specification Confirmed:
I will create exactly {N} fields:
| # | Field Label | Field Type | Property Name |
|---|-------------|------------|---------------|
| 1 | {label1}    | {type1}    | {name1}       |
No additional fields will be added.
Is this correct?
```

### 2.2 Mockup Image Handling

- **Both mockup AND spec provided:** Dialog spec takes precedence. Mockup for HTML/CSS only.
- **Only mockup provided:** Propose fields and ASK for confirmation.

### 2.3 Dynamic Content Requirements

| User Indicates | Servlet Required? |
|----------------|-------------------|
| External API integration | Yes (GET) |
| Dynamic data loading | Yes (GET) |
| Form submission | Yes (POST) |
| Search/filter | Yes (GET) |
| Static dialog content | No |

---

## Step 3: Create Component Files

Create ALL files in this order:

### 3.1 Component Definition
**Path:** `ui.apps/src/main/content/jcr_root/apps/[project]/components/{component-name}/.content.xml`

Load: `references/aem-conventions.md`

### 3.2 Component Dialog
**Path:** `ui.apps/.../components/{component-name}/_cq_dialog/.content.xml`

**Load:** `references/dialog-patterns.md`

**For EXTENDED components:** Load `references/extending-core-components.md` - MUST use Sling Resource Merger.

### 3.3 HTL Template
**Path:** `ui.apps/.../components/{component-name}/{component-name}.html`

**Load:** `references/htl-patterns.md`

### 3.4 Sling Model
**Path:** `core/src/main/java/[package-path]/models/{ComponentName}Model.java`

**Load:** `references/model-patterns.md`, `references/java-standards.md`

**For extensions:** Load `references/extending-core-components.md`

**Delegation Pattern (for Core Component extensions):**
```java
@Model(adaptables = SlingHttpServletRequest.class,
       adapters = {CustomModel.class, ComponentExporter.class},
       resourceType = CustomModel.RESOURCE_TYPE)
@Exporter(name = ExporterConstants.SLING_MODEL_EXPORTER_NAME,
          extensions = ExporterConstants.SLING_MODEL_EXTENSION)
public class CustomModel implements ComponentExporter {
    @Self @Via(type = ResourceSuperType.class)
    private com.adobe.cq.wcm.core.components.models.List coreList;
    // Use FQN for core interfaces to avoid import collision
}
```

### 3.5 Child Item Model - If Multifield
**Path:** `core/src/main/java/[package-path]/models/{ItemName}.java`

### 3.6 Unit Test
**Path:** `core/src/test/java/[package-path]/models/{ComponentName}ModelTest.java`

**Load:** `references/test-patterns.md`

### 3.7 Component Clientlib - ALWAYS CREATE
**Path:** `ui.apps/.../clientlibs/clientlib-{component-name}/`

**Load:** `references/clientlib-patterns.md`

### 3.8 Dialog Clientlib - If Conditional Logic
**Path:** `ui.apps/.../clientlibs/clientlib-{component-name}-dialog/`

**Load:** `references/clientlib-patterns.md` (Dialog JavaScript Pattern section)

### 3.9 Sling Servlet - If Dynamic Content
**Path:** `core/src/main/java/[package-path]/servlets/{ComponentName}Servlet.java`

**Load:** `references/sling-servlet-standards.md`

### 3.10 Servlet Unit Test
**Path:** `core/src/test/java/[package-path]/servlets/{ComponentName}ServletTest.java`

### 3.11 Dependency Verification - MANDATORY FOR SERVLETS

**Before completing, verify dependencies in `core/pom.xml`:**

- **NEVER hardcode versions** - Check parent pom.xml for version properties
- Most common APIs included in `aem-sdk-api` (GSON, Jackson, Commons)
- Use `provided` scope for AEM runtime libraries

---

## Step 4: Completion Summary

```
Component '{component-name}' created successfully!

## Files Created
- ui.apps/.../components/{component-name}/.content.xml
- ui.apps/.../components/{component-name}/_cq_dialog/.content.xml
- ui.apps/.../components/{component-name}/{component-name}.html
- core/.../models/{ComponentName}Model.java
- core/.../models/{ComponentName}ModelTest.java
- ui.apps/.../clientlibs/clientlib-{component-name}/
[+ servlet files if applicable]

## Dialog Fields (Exact Match)
{table matching specification}

Would you like me to add any additional fields or build the project?
```

---

## Quick Reference: Field Type Mapping

| User Says | Granite Resource Type |
|-----------|-----------------------|
| Textfield | `granite/ui/components/coral/foundation/form/textfield` |
| Textarea | `granite/ui/components/coral/foundation/form/textarea` |
| Richtext, RTE | `cq/gui/components/authoring/dialog/richtext` |
| Pathfield, Path | `granite/ui/components/coral/foundation/form/pathfield` |
| Fileupload, Image | `cq/gui/components/authoring/dialog/fileupload` |
| Multifield | `granite/ui/components/coral/foundation/form/multifield` |
| Checkbox | `granite/ui/components/coral/foundation/form/checkbox` |
| Select, Dropdown | `granite/ui/components/coral/foundation/form/select` |
| Numberfield | `granite/ui/components/coral/foundation/form/numberfield` |
| Datepicker | `granite/ui/components/coral/foundation/form/datepicker` |

For complete mappings: `assets/field-type-mappings.md`

---

## Reference Files

Load on-demand based on what you're creating:

| Creating | Load Reference |
|----------|----------------|
| Any component | `.aem-skills-config.yaml` (project root, ALWAYS FIRST), then `references/aem-conventions.md` |
| Dialog XML | `references/dialog-patterns.md` |
| HTL Template | `references/htl-patterns.md` |
| Sling Model | `references/model-patterns.md`, `references/java-standards.md` |
| Unit Tests | `references/test-patterns.md` |
| Clientlibs | `references/clientlib-patterns.md` |
| Extending Core Component | `references/extending-core-components.md` |
| Sling Servlet | `references/sling-servlet-standards.md` |
| Core Component patterns | `references/core-components.md` |
| No Hallucination rules | `references/no-hallucination-rules.md` |
| Examples | `references/examples.md` |
