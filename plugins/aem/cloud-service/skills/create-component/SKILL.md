---
name: create-component
description: |
  Creates complete AEM components with dialog, HTL template, Sling Model, unit tests, and clientlibs.
  Supports extending Core Components and project components. When a Figma design URL is provided,
  fetches the design via Figma MCP (get_design_context) and translates it into pixel-perfect HTL, CSS,
  and JS. Follows Adobe Experience League best practices for AEM Cloud Service and 6.5.
  Use this skill whenever the user mentions creating, building, generating, or scaffolding an AEM
  component, or mentions component types like teaser, card, hero, banner, accordion, tabs, carousel,
  list, navigation, breadcrumb, or any custom AEM component. Also trigger when the user wants to
  extend a Core Component, create a component dialog, add a Sling Model, or convert a Figma design
  into an AEM component.
compatibility: Requires AEM as a Cloud Service or AEM 6.5. Maven project structure with core, ui.apps modules. Figma design integration requires the `plugin-figma-figma` MCP server to be enabled in the IDE.
license: Apache-2.0
metadata:
  author: AEM Dev Agent
  version: "1.0"
  aem_version: "6.5/Cloud Service"
---
# AEM Component Creation Skill

Creates complete AEM components following Adobe best practices.

## Configuration Gate Check — Do This First

> This configuration check needs to happen first because without it, the skill will use incorrect project paths and package names, causing every generated file to be wrong.

**First tool call**: Read `.aem-skills-config.yaml` in the **project root** (same level as `pom.xml`).

**Check**: Does the file exist and does it have `configured: true`?

| Status | Action |
| --- | --- |
| File missing or configured: false | Stop and display the error message below. Do not explore the codebase or proceed — the config values are needed for correct file paths and naming. Wait for the user to configure. |
| configured: true | Read project, package, and group values from the YAML file. Proceed with component creation. |

### If NOT configured, Display This Message and Stop:

```
Project configuration required!

Before creating components, configure your project settings in:
`.aem-skills-config.yaml` (in your project root, same level as pom.xml)

Open the file and update:
- project: Your AEM project name (e.g., 'mysite', 'wknd')
- package: Your Java package (e.g., 'com.mysite.core')
- group: Your component group (e.g., 'MySite Components')
- configured: true

After updating, ask me to create the component again.
```

### Why you should not explore the codebase when unconfigured:

Doing any of the following before configuration is set will lead to incorrect assumptions and wasted effort:

- Reading any other repository files
- Listing directories to "understand the project"
- Checking existing components for patterns
- Looking at pom.xml, Java files, or folder structures
- Inferring values from any source

The config file is the single source of truth for project values — skipping it leads to wrong paths and package names in every generated file.

## No Hallucination Rule

Only create the exact fields the user specified — adding extra fields creates authoring confusion and maintenance burden, and renaming fields breaks content contracts.

**Load reference for full rules:** `references/no-hallucination-rules.md`

## Workflow Overview

| Step | Action |
| --- | --- |
| 0 | Configuration validation (do this first — see above) |
| 1 | Extract & validate component name |
| 1.5 | Component extension decision (if extending) |
| 2 | Gather requirements & confirm dialog specification |
| 2.3 | Figma design fetch (if Figma URL provided) |
| 3 | Create all component files |
| 3.11 | Dependency verification (required for servlets) |
| 4 | Completion summary |

## Step 0: Configuration Validation

### 0.1 Read Configuration

1. Read `.aem-skills-config.yaml` from the project root
2. Check that `configured: true`
3. Read `project`, `package`, and `group` values

### 0.2 Validate — Use Only the Config File

Do not infer project values from the file system, existing components, Java files, pom.xml, or prior knowledge. These sources may be outdated or inconsistent — `.aem-skills-config.yaml` is the single source of truth because the user explicitly sets it.

### 0.3 Load Conventions

1. Read `references/aem-conventions.md` for file structure templates, naming conventions, and patterns

### 0.4 Project State Analysis (after configuration validated)

1. **Check Component Name Uniqueness** - Look in `/apps/[project]/components/`
2. **Check Model Class Conflicts** - Look in `core/src/main/java/[package-path]/models/`
3. **Analyze Existing Patterns** - Review 1-2 recent components for style reference

## Step 1: Extract & Validate Component Name

- Parse component name from user's message (ask if not provided)
- Normalize to lowercase kebab-case (e.g., `My Component` -> `my-component`)
- Validate: starts with letter, only letters/numbers/hyphens, no consecutive hyphens

## Step 1.5: Component Extension Decision

### When user says "extend {component}":

**Tier 1: Check Project Components First**

- Search `/apps/{project}/components/{component}`
- If found -> Use as `sling:resourceSuperType`

**Tier 2: Check Core Components**

| User Says | Maps To |
| --- | --- |
| image | core/wcm/components/image/v3/image |
| teaser, card | core/wcm/components/teaser/v2/teaser |
| text, richtext | core/wcm/components/text/v2/text |
| title, heading | core/wcm/components/title/v3/title |
| list | core/wcm/components/list/v4/list |
| button, cta | core/wcm/components/button/v2/button |
| navigation, nav | core/wcm/components/navigation/v2/navigation |
| container, section | core/wcm/components/container/v1/container |
| accordion | core/wcm/components/accordion/v1/accordion |
| tabs | core/wcm/components/tabs/v1/tabs |
| carousel | core/wcm/components/carousel/v1/carousel |
| embed, video | core/wcm/components/embed/v2/embed |

**Tier 3: Not Found** - Ask user for clarification.

**For extension patterns, load:** `references/extending-core-components.md`

## Step 1.6: Core Component Extension Requirements

**Required when extending with "hide", "remove", "add custom field", or "override"** (these operations need Sling Resource Merger patterns to work correctly):

**Load reference:** `references/extending-core-components.md`

| User Request | Action |
| --- | --- |
| "Add custom fields" | Create new tab OR add to existing |
| "Hide {tab}" | Use sling:hideResource="{Boolean}true" |
| "Hide {field}" | Use sling:hideResource="{Boolean}true" |
| "Override {field}" | Use sling:hideProperties + new values |

**When extending Core Components:**

- Use `@Self @Via(type = ResourceSuperType.class)` for model delegation
- Implement `ComponentExporter` interface
- Add `resourceType` to `@Model` annotation
- Use `sling:hideResource` in dialog for inherited tabs/fields

> **Note:** If the parent component is a project component (not a Core Component), use direct Java class extension (`extends ParentModel`) instead of the delegation pattern. The `@Self @Via(type = ResourceSuperType.class)` pattern is only for Core Components. Load `references/extending-core-components.md` for the decision table.

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

### 2.3 Figma Design Input

**Load:** `references/figma-design-rules.md`

When user provides a Figma URL (`figma.com/design/...`, `figma.com/make/...`, or `figma.com/board/...`):

1. **Parse the URL** to extract `fileKey` and `nodeId` (see references/figma-design-rules.md Rule 1)

- Convert `-` to `:` in the `node-id` query parameter
- Use `branchKey` as `fileKey` for branch URLs

1. **Call **`get_design_context` via the `plugin-figma-figma` MCP server (see Rule 2):`{ "server": "plugin-figma-figma", "toolName": "get_design_context", "arguments": { "nodeId": "<extracted-node-id>", "fileKey": "<extracted-file-key>", "clientLanguages": "html,css,javascript", "clientFrameworks": "htl" } }`
2. **Extract design tokens** from the response — colors, fonts, sizes, spacing, layout (see Rules 3-4)
3. **Use the Figma output** for HTL structure, CSS styling, and JS behavior — **NOT** for dialog fields

**Precedence when BOTH dialog spec AND Figma URL are provided:**

- **Dialog specification** → determines dialog fields (absolute precedence, no hallucination)
- **Figma design** → determines HTML structure, CSS styling, JS behavior only

**When ONLY Figma URL is provided (no dialog spec):**

- Analyze the design and **PROPOSE** dialog fields to the user
- **ASK for confirmation** before proceeding

**Figma response handling:**

- The response is React+Tailwind — treat as a REFERENCE, not production code
- Convert JSX to semantic HTL with BEM classes (see Rule 5)
- Extract all CSS values to the component clientlib (see Rule 6)
- Create JS only if interactivity is implied (see Rule 7)
- Do not hardcode Figma temporary image URLs — they expire and will break in production (see Rule 8)

### 2.4 Dynamic Content Requirements

| User Indicates | Servlet Required? |
| --- | --- |
| External API integration | Yes (GET) |
| Dynamic data loading | Yes (GET) |
| Form submission | Yes (POST) |
| Search/filter | Yes (GET) |
| Static dialog content | No |

## Step 3: Create Component Files

Create ALL files in this order:

### 3.1 Component Definition

**Path:** `ui.apps/src/main/content/jcr_root/apps/[project]/components/{component-name}/.content.xml`

Load: `references/aem-conventions.md`

### 3.2 Component Dialog

**Path:** `ui.apps/.../components/{component-name}/_cq_dialog/.content.xml`

**Load:** `references/dialog-patterns.md`

**For extended components:** Load `references/extending-core-components.md` — Sling Resource Merger is required here because dialog inheritance only works through the merger; without it, parent dialog nodes won't be resolved.

### 3.2.1 Image Field Handling

When a user specifies an image or photo field:

- **Default approach:** Embed the Core Image component via `data-sly-resource` — do NOT create a fileupload dialog field with manual `<img>` rendering.
- **Fileupload is only for non-image files** (PDFs, documents, etc.). Only use `cq/gui/components/authoring/dialog/fileupload` when the user explicitly asks for a non-image file upload.
- **Load** `references/htl-patterns.md` (Image Handling section) for the correct embedding pattern.

### 3.3 HTL Template

**Path:** `ui.apps/.../components/{component-name}/{component-name}.html`

**Load:** `references/htl-patterns.md`**If Figma URL provided, ALSO load:** `references/figma-design-rules.md` (Rules 5, 8) — Convert JSX structure to semantic HTL with BEM classes. Replace static text with Sling Model expressions. Use the Figma screenshot as visual truth for element hierarchy.

**i18n check:** If the component has static display text (labels, button text, placeholder strings), use HTL i18n expressions: `${'Label Text' @ i18n}`. Do not handle static text translation in the Sling Model — keep it in HTL where translation is automatic.

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

### 3.7 Component Clientlib — Create for Every Component

**Path:** `ui.apps/.../clientlibs/clientlib-{component-name}/`

**Load:** `references/clientlib-patterns.md`**If Figma URL provided, ALSO load:** `references/figma-design-rules.md` (Rules 6, 7) — Extract exact colors, fonts, sizes, spacing, border-radius from the Figma response. Place all CSS into `css/{component-name}.css` using BEM naming. Create JS in `js/{component-name}.js` only if the design implies interactivity. Verify pixel-perfect fidelity against the Figma screenshot.

### 3.8 Dialog Clientlib - If Conditional Logic

**Path:** `ui.apps/.../clientlibs/clientlib-{component-name}-dialog/`

**Load:** `references/clientlib-patterns.md` (Dialog JavaScript Pattern section)

### 3.9 Sling Servlet - If Dynamic Content

**Path:** `core/src/main/java/[package-path]/servlets/{ComponentName}Servlet.java`

**Load:** `references/sling-servlet-standards.md`

### 3.10 Servlet Unit Test

**Path:** `core/src/test/java/[package-path]/servlets/{ComponentName}ServletTest.java`

### 3.11 Dependency Verification — Required for Servlets

**Before completing, verify dependencies in **`core/pom.xml`**:**

- Do not hardcode versions — check parent pom.xml for version properties instead, since hardcoded versions drift out of sync and cause build conflicts
- Most common APIs included in `aem-sdk-api` (GSON, Jackson, Commons)
- Use `provided` scope for AEM runtime libraries

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

## Quick Reference: Field Type Mapping

| User Says | Granite Resource Type |
| --- | --- |
| Textfield | granite/ui/components/coral/foundation/form/textfield |
| Textarea | granite/ui/components/coral/foundation/form/textarea |
| Richtext, RTE | cq/gui/components/authoring/dialog/richtext |
| Pathfield, Path | granite/ui/components/coral/foundation/form/pathfield |
| Image, Photo | Embed Core Image component (see references/htl-patterns.md Image Handling section). Do not use fileupload for image rendering. |
| Fileupload, File Upload | cq/gui/components/authoring/dialog/fileupload (for non-image files: PDFs, documents) |
| Multifield | granite/ui/components/coral/foundation/form/multifield |
| Checkbox | granite/ui/components/coral/foundation/form/checkbox |
| Select, Dropdown | granite/ui/components/coral/foundation/form/select |
| Numberfield | granite/ui/components/coral/foundation/form/numberfield |
| Datepicker | granite/ui/components/coral/foundation/form/datepicker |

For complete mappings: `assets/field-type-mappings.md`

## Reference Files

Load on-demand based on what you're creating:

| Creating | Load Reference |
| --- | --- |
| Any component | .aem-skills-config.yaml (project root, load first — see Configuration Gate Check), then references/aem-conventions.md |
| Dialog XML | references/dialog-patterns.md |
| HTL Template | references/htl-patterns.md |
| Sling Model | references/model-patterns.md, references/java-standards.md |
| Unit Tests | references/test-patterns.md |
| Clientlibs | references/clientlib-patterns.md |
| Extending Core Component | references/extending-core-components.md |
| Extending Core Component — worked example & checklists | references/extending-core-components-example.md (load when you need a complete worked example of extending a Core Component, unit testing patterns, or the implementation checklist) |
| Sling Servlet | references/sling-servlet-standards.md |
| Core Component patterns | references/core-components.md |
| No Hallucination rules | references/no-hallucination-rules.md |
| Figma design integration | references/figma-design-rules.md |
| Troubleshooting | references/troubleshooting.md |
| Examples | references/examples.md |

If encountering issues during or after component creation, consult `references/troubleshooting.md` for common problems and solutions.