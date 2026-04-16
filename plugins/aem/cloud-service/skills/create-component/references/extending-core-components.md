# Extending AEM Core Components

Complete guide for extending Adobe Core Components with proper inheritance patterns using Sling Resource Merger and Model Delegation.

## Table of Contents

- [Project Component vs Core Component Extension](#project-component-vs-core-component-extension)
- [When to Extend vs Create New](#when-to-extend-vs-create-new)
- [Sling Resource Merger - Complete Reference](#sling-resource-merger---complete-reference)
  - [Property Reference](#property-reference)
  - [Hide Entire Tab](#hide-entire-tab)
  - [Hide Specific Field](#hide-specific-field)
  - [Hide Multiple Children](#hide-multiple-children)
  - [Override Inherited Field Properties](#override-inherited-field-properties)
  - [Position Custom Tab Before Inherited](#position-custom-tab-before-inherited)
- [Core Component Dialog Tab Names Reference](#core-component-dialog-tab-names-reference)
  - [Finding Tab Names](#finding-tab-names)
- [Model Delegation Pattern](#model-delegation-pattern)
  - [When to Use Delegation](#when-to-use-delegation)
  - [Why SlingHttpServletRequest?](#why-slinghttpservletrequest)
  - [Delegation Template](#delegation-template)
  - [Core Component Model Interfaces](#core-component-model-interfaces)
  - [Import Collision Resolution](#import-collision-resolution)
- [ComponentExporter Interface](#componentexporter-interface)
  - [What is ComponentExporter?](#what-is-componentexporter)
  - [Implementation](#implementation)


## Project Component vs Core Component Extension

Not all component extension is the same. The approach depends on whether the parent component is an external Core Component or a component already in your project.

- **Core Component extension** (what most of this reference covers): Uses Sling Resource Merger for dialog inheritance, `@Self @Via(type = ResourceSuperType.class)` for model delegation. Required because Core Components are external dependencies — you can't modify their source code directly.
- **Project component extension** (simpler): When extending a component already in your project, you can directly extend the Java class (`extends ParentModel`), copy and modify the dialog (or use Sling Resource Merger), and inherit HTL via `sling:resourceSuperType`. No delegation pattern needed — just standard Java inheritance.

### Decision Table

| Parent Component | Dialog Approach | Model Approach |
|-----------------|-----------------|----------------|
| Core Component (under `core/wcm/components/`) | Sling Resource Merger (overlay tabs/fields) | `@Self @Via(type = ResourceSuperType.class)` delegation |
| Project component (under `apps/[project]/components/`) | Direct copy + modify OR Sling Resource Merger | Direct Java `extends ParentModel` |

> **Key rule:** Only use the `@Self @Via(type = ResourceSuperType.class)` delegation pattern when extending Core Components. For project components, use direct Java class extension (`extends`).

## When to Extend vs Create New

| Scenario | Recommendation |
| --- | --- |
| Need core functionality + custom fields | Extend |
| Core component has 80%+ of what you need | Extend |
| Need to hide some inherited tabs/fields | Extend |
| Completely different behavior needed | Create new |
| Need to hide most inherited fields | Consider Create new |

## Sling Resource Merger - Complete Reference

When extending a component via `sling:resourceSuperType`, the dialog is automatically inherited. Sling Resource Merger allows overlaying, hiding, and modifying inherited dialog content.

### Property Reference

| Property | Type | Purpose | Example |
| --- | --- | --- | --- |
| sling:hideResource | Boolean | Hide entire node (tab, field, container) | sling:hideResource="{Boolean}true" |
| sling:hideChildren | String[] | Hide specific child nodes by name | sling:hideChildren="[field1,field2]" |
| sling:hideProperties | String[] | Remove inherited properties before merging | sling:hideProperties="[fieldLabel,required]" |
| sling:orderBefore | String | Position node before another sibling | sling:orderBefore="existingTab" |

### Hide Entire Tab

To hide an inherited tab, add a node with the same name and `sling:hideResource`:

```xml
<!-- Hide "List Settings" tab inherited from core List component -->
<listSettings
    jcr:primaryType="nt:unstructured"
    sling:hideResource="{Boolean}true"/>
```

### Hide Specific Field

```xml
<!-- Hide "maxItems" field within an inherited tab -->
<maxItems
    jcr:primaryType="nt:unstructured"
    sling:hideResource="{Boolean}true"/>
```

### Hide Multiple Children

```xml
<!-- Hide multiple fields at once -->
<items
    jcr:primaryType="nt:unstructured"
    sling:hideChildren="[maxItems,orderBy,childDepth,tags]"/>
```

### Override Inherited Field Properties

Use `sling:hideProperties` to remove specific inherited properties, then set new values:

```xml
<!-- Change inherited field label and make required -->
<title
    jcr:primaryType="nt:unstructured"
    sling:hideProperties="[fieldLabel,required,fieldDescription]"
    fieldLabel="Banner Title"
    fieldDescription="Enter the banner headline"
    required="{Boolean}true"/>
```

### Position Custom Tab Before Inherited

```xml
<customProperties
    jcr:primaryType="nt:unstructured"
    jcr:title="Custom Properties"
    sling:orderBefore="listSettings"
    sling:resourceType="granite/ui/components/coral/foundation/container"
    margin="{Boolean}true">
    <items jcr:primaryType="nt:unstructured">
        <!-- Custom fields here -->
    </items>
</customProperties>
```

## Core Component Dialog Tab Names Reference

To hide or modify tabs, you must use the exact node names from the parent component:

| Core Component | Version | Tab Node Names |
| --- | --- | --- |
| List | v4 | listSettings, itemSettings |
| Teaser | v2 | properties, actions |
| Image | v3 | properties, features |
| Button | v2 | properties |
| Title | v3 | properties |
| Text | v2 | properties |
| Container | v1 | properties, policy |
| Tabs | v1 | properties, accessibility |
| Accordion | v1 | properties, accessibility |
| Carousel | v1 | properties, accessibility |
| Navigation | v2 | properties |
| Embed | v2 | properties |

### Finding Tab Names

If you need to find tab names for a Core Component:

1. Check Adobe Core Components GitHub: `https://github.com/adobe/aem-core-wcm-components`
2. Navigate to: `content/src/content/jcr_root/apps/core/wcm/components/{component}/{version}/_cq_dialog`
3. Look at the `<items>` nodes under `<tabs>`

## Model Delegation Pattern

### When to Use Delegation

**ALWAYS delegate when extending Core Components that have:**

| Core Component | Has Complex Logic? | Use Delegation? | Adaptable |
| --- | --- | --- | --- |
| Image | Yes (renditions, lazy-load) | YES | SlingHttpServletRequest |
| Teaser | Yes (links, actions) | YES | SlingHttpServletRequest |
| List | Yes (data fetching) | YES | SlingHttpServletRequest |
| Button | Yes (link handling) | YES | SlingHttpServletRequest |
| Navigation | Yes (page tree) | YES | SlingHttpServletRequest |
| Title | Simple | Optional | Resource or SlingHttpServletRequest |
| Text | Simple | Optional | Resource or SlingHttpServletRequest |
| Container | Medium | Recommended | SlingHttpServletRequest |

### Why SlingHttpServletRequest?

Core Components use `SlingHttpServletRequest` as adaptable because:

- Required for `@Via(type = ResourceSuperType.class)` delegation
- Supports proper request context resolution
- Enables JSON export via Sling Model Exporter
- Provides access to request attributes and parameters

### Delegation Template

```java
package [package].models;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Exporter;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.Via;
import org.apache.sling.models.annotations.injectorspecific.Self;
import org.apache.sling.models.annotations.injectorspecific.SlingObject;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;
import org.apache.sling.models.annotations.via.ResourceSuperType;

import com.adobe.cq.export.json.ComponentExporter;
import com.adobe.cq.export.json.ExporterConstants;

@Model(
    adaptables = SlingHttpServletRequest.class,
    adapters = {CustomComponentModel.class, ComponentExporter.class},
    resourceType = CustomComponentModel.RESOURCE_TYPE,
    defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
@Exporter(
    name = ExporterConstants.SLING_MODEL_EXPORTER_NAME,
    extensions = ExporterConstants.SLING_MODEL_EXTENSION
)
public class CustomComponentModel implements ComponentExporter {

    public static final String RESOURCE_TYPE = "[project]/components/{component-name}";

    /**
     * Delegate to parent Core Component model via resourceSuperType.
     * Use fully qualified name to avoid import collisions.
     */
    @Self
    @Via(type = ResourceSuperType.class)
    private com.adobe.cq.wcm.core.components.models.ParentInterface coreComponent;

    /**
     * Access to current resource for reading child resources.
     */
    @SlingObject
    private Resource resource;

    /**
     * Custom property added by this extension.
     */
    @ValueMapValue
    private String customProperty;

    private List<CustomItem> customItems;

    @PostConstruct
    protected void init() {
        // Initialize custom multifield items
        customItems = new ArrayList<>();
        Resource itemsResource = resource.getChild("items");
        if (itemsResource != null) {
            for (Resource itemResource : itemsResource.getChildren()) {
                CustomItem item = itemResource.adaptTo(CustomItem.class);
                if (item != null && item.hasContent()) {
                    customItems.add(item);
                }
            }
        }
    }

    // Delegate inherited methods to parent
    public String getInheritedProperty() {
        return coreComponent != null ? coreComponent.getSomeProperty() : null;
    }

    // Custom property getters
    public String getCustomProperty() {
        return customProperty;
    }

    public List<CustomItem> getCustomItems() {
        return Collections.unmodifiableList(customItems);
    }

    public boolean hasContent() {
        return (customProperty != null && !customProperty.trim().isEmpty()) ||
               (customItems != null && !customItems.isEmpty()) ||
               coreComponent != null;
    }

    @Override
    public String getExportedType() {
        return RESOURCE_TYPE;
    }
}
```

### Core Component Model Interfaces

| Core Component | Interface (Fully Qualified) |
| --- | --- |
| List | com.adobe.cq.wcm.core.components.models.List |
| Teaser | com.adobe.cq.wcm.core.components.models.Teaser |
| Image | com.adobe.cq.wcm.core.components.models.Image |
| Button | com.adobe.cq.wcm.core.components.models.Button |
| Title | com.adobe.cq.wcm.core.components.models.Title |
| Text | com.adobe.cq.wcm.core.components.models.Text |
| Navigation | com.adobe.cq.wcm.core.components.models.Navigation |
| Container | com.adobe.cq.wcm.core.components.models.LayoutContainer |
| Tabs | com.adobe.cq.wcm.core.components.models.Tabs |
| Accordion | com.adobe.cq.wcm.core.components.models.Accordion |
| Carousel | com.adobe.cq.wcm.core.components.models.Carousel |

### Import Collision Resolution

Some Core Component interface names collide with `java.util` classes (e.g., `List`):

```java
// WRONG - Import collision error
import java.util.List;
import com.adobe.cq.wcm.core.components.models.List;  // ERROR!

// CORRECT - Use fully qualified name for Core Component interface
import java.util.List;  // Keep for collections

// In field declaration, use fully qualified name:
@Self
@Via(type = ResourceSuperType.class)
private com.adobe.cq.wcm.core.components.models.List coreList;
```

## ComponentExporter Interface

### What is ComponentExporter?

`ComponentExporter` enables JSON serialization of Sling Models via the `.model.json` extension.

**Required for:**

- SPA/headless implementations
- JSON API endpoints
- React/Angular AEM integrations

### Implementation

```java
// 1. Add to adapters in @Model
@Model(
    adapters = {CustomModel.class, ComponentExporter.class},  // Add ComponentExporter
    ...
)

// 2. Add @Exporter annotation
@Exporter(
    name = ExporterConstants.SLING_MODEL_EXPORTER_NAME,
    extensions = ExporterConstants.SLING_MODEL_EXTENSION
)

// 3. Implement interface
public class CustomModel implements ComponentExporter {

    // 4. Implement required method
    @Override
    public String getExportedType() {
        return RESOURCE_TYPE;  // Must match @Model resourceType
    }
}
```

---

For a complete worked example (CTA List extending Core List), unit testing patterns, and implementation checklists, see `references/extending-core-components-example.md`.