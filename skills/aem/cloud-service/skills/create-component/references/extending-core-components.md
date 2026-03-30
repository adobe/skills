# Extending AEM Core Components

Complete guide for extending Adobe Core Components with proper inheritance patterns using Sling Resource Merger and Model Delegation.

---

## When to Extend vs Create New

| Scenario | Recommendation |
|----------|----------------|
| Need core functionality + custom fields | **Extend** |
| Core component has 80%+ of what you need | **Extend** |
| Need to hide some inherited tabs/fields | **Extend** |
| Completely different behavior needed | **Create new** |
| Need to hide most inherited fields | Consider **Create new** |

---

## Sling Resource Merger - Complete Reference

When extending a component via `sling:resourceSuperType`, the dialog is automatically inherited. Sling Resource Merger allows overlaying, hiding, and modifying inherited dialog content.

### Property Reference

| Property | Type | Purpose | Example |
|----------|------|---------|---------|
| `sling:hideResource` | Boolean | Hide entire node (tab, field, container) | `sling:hideResource="{Boolean}true"` |
| `sling:hideChildren` | String[] | Hide specific child nodes by name | `sling:hideChildren="[field1,field2]"` |
| `sling:hideProperties` | String[] | Remove inherited properties before merging | `sling:hideProperties="[fieldLabel,required]"` |
| `sling:orderBefore` | String | Position node before another sibling | `sling:orderBefore="existingTab"` |

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

---

## Core Component Dialog Tab Names Reference

To hide or modify tabs, you must use the exact node names from the parent component:

| Core Component | Version | Tab Node Names |
|----------------|---------|----------------|
| **List** | v4 | `listSettings`, `itemSettings` |
| **Teaser** | v2 | `properties`, `actions` |
| **Image** | v3 | `properties`, `features` |
| **Button** | v2 | `properties` |
| **Title** | v3 | `properties` |
| **Text** | v2 | `properties` |
| **Container** | v1 | `properties`, `policy` |
| **Tabs** | v1 | `properties`, `accessibility` |
| **Accordion** | v1 | `properties`, `accessibility` |
| **Carousel** | v1 | `properties`, `accessibility` |
| **Navigation** | v2 | `properties` |
| **Embed** | v2 | `properties` |

### Finding Tab Names

If you need to find tab names for a Core Component:
1. Check Adobe Core Components GitHub: `https://github.com/adobe/aem-core-wcm-components`
2. Navigate to: `content/src/content/jcr_root/apps/core/wcm/components/{component}/{version}/_cq_dialog`
3. Look at the `<items>` nodes under `<tabs>`

---

## Model Delegation Pattern

### When to Use Delegation

**ALWAYS delegate when extending Core Components that have:**

| Core Component | Has Complex Logic? | Use Delegation? | Adaptable |
|----------------|-------------------|-----------------|-----------|
| Image | Yes (renditions, lazy-load) | **YES** | `SlingHttpServletRequest` |
| Teaser | Yes (links, actions) | **YES** | `SlingHttpServletRequest` |
| List | Yes (data fetching) | **YES** | `SlingHttpServletRequest` |
| Button | Yes (link handling) | **YES** | `SlingHttpServletRequest` |
| Navigation | Yes (page tree) | **YES** | `SlingHttpServletRequest` |
| Title | Simple | Optional | `Resource` or `SlingHttpServletRequest` |
| Text | Simple | Optional | `Resource` or `SlingHttpServletRequest` |
| Container | Medium | Recommended | `SlingHttpServletRequest` |

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
|----------------|----------------------------|
| List | `com.adobe.cq.wcm.core.components.models.List` |
| Teaser | `com.adobe.cq.wcm.core.components.models.Teaser` |
| Image | `com.adobe.cq.wcm.core.components.models.Image` |
| Button | `com.adobe.cq.wcm.core.components.models.Button` |
| Title | `com.adobe.cq.wcm.core.components.models.Title` |
| Text | `com.adobe.cq.wcm.core.components.models.Text` |
| Navigation | `com.adobe.cq.wcm.core.components.models.Navigation` |
| Container | `com.adobe.cq.wcm.core.components.models.LayoutContainer` |
| Tabs | `com.adobe.cq.wcm.core.components.models.Tabs` |
| Accordion | `com.adobe.cq.wcm.core.components.models.Accordion` |
| Carousel | `com.adobe.cq.wcm.core.components.models.Carousel` |

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

---

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

## Complete Example: Extending Core List Component

### Requirements
- Extend core List component (v4)
- Add custom "listTitle" field
- Hide "List Settings" and "Item Settings" tabs
- Only allow "Fixed list" (static pages)
- Add custom pages multifield

### 1. Component Definition (.content.xml)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    jcr:primaryType="cq:Component"
    jcr:title="CTA List"
    jcr:description="Fixed list of CTA buttons"
    componentGroup="[group]"
    sling:resourceSuperType="core/wcm/components/list/v4/list"/>
```

### 2. Dialog with Sling Resource Merger

```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    xmlns:granite="http://www.adobe.com/jcr/granite/1.0"
    xmlns:cq="http://www.day.com/jcr/cq/1.0"
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
    jcr:primaryType="nt:unstructured"
    jcr:title="CTA List"
    sling:resourceType="cq/gui/components/authoring/dialog">
    <content
        jcr:primaryType="nt:unstructured"
        sling:resourceType="granite/ui/components/coral/foundation/container">
        <items jcr:primaryType="nt:unstructured">
            <tabs
                jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/tabs"
                maximized="{Boolean}true">
                <items jcr:primaryType="nt:unstructured">

                    <!-- HIDE inherited tabs from core List using Sling Resource Merger -->
                    <listSettings
                        jcr:primaryType="nt:unstructured"
                        sling:hideResource="{Boolean}true"/>
                    <itemSettings
                        jcr:primaryType="nt:unstructured"
                        sling:hideResource="{Boolean}true"/>

                    <!-- Custom Properties tab -->
                    <properties
                        jcr:primaryType="nt:unstructured"
                        jcr:title="Properties"
                        sling:resourceType="granite/ui/components/coral/foundation/container"
                        margin="{Boolean}true">
                        <items jcr:primaryType="nt:unstructured">
                            <columns
                                jcr:primaryType="nt:unstructured"
                                sling:resourceType="granite/ui/components/coral/foundation/fixedcolumns"
                                margin="{Boolean}true">
                                <items jcr:primaryType="nt:unstructured">
                                    <column
                                        jcr:primaryType="nt:unstructured"
                                        sling:resourceType="granite/ui/components/coral/foundation/container">
                                        <items jcr:primaryType="nt:unstructured">
                                            <listTitle
                                                jcr:primaryType="nt:unstructured"
                                                sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                                fieldLabel="List Title"
                                                fieldDescription="Title displayed above the list"
                                                name="./listTitle"/>
                                            <!-- Hidden field to force "static" list type -->
                                            <listFrom
                                                jcr:primaryType="nt:unstructured"
                                                sling:resourceType="granite/ui/components/coral/foundation/form/hidden"
                                                name="./listFrom"
                                                value="static"/>
                                            <!-- Custom pages multifield -->
                                            <pages
                                                jcr:primaryType="nt:unstructured"
                                                sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
                                                composite="{Boolean}true"
                                                fieldLabel="Pages"
                                                fieldDescription="Add pages to display">
                                                <field
                                                    jcr:primaryType="nt:unstructured"
                                                    sling:resourceType="granite/ui/components/coral/foundation/container"
                                                    name="./pages">
                                                    <items jcr:primaryType="nt:unstructured">
                                                        <linkURL
                                                            jcr:primaryType="nt:unstructured"
                                                            sling:resourceType="granite/ui/components/coral/foundation/form/pathfield"
                                                            fieldLabel="Page"
                                                            name="./linkURL"
                                                            rootPath="/content"/>
                                                        <linkText
                                                            jcr:primaryType="nt:unstructured"
                                                            sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                                                            fieldLabel="Link Text"
                                                            fieldDescription="Custom text (optional)"
                                                            name="./linkText"/>
                                                    </items>
                                                </field>
                                            </pages>
                                        </items>
                                    </column>
                                </items>
                            </columns>
                        </items>
                    </properties>
                </items>
            </tabs>
        </items>
    </content>
</jcr:root>
```

### 3. Sling Model with Delegation

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
import com.adobe.cq.wcm.core.components.models.ListItem;

@Model(
    adaptables = SlingHttpServletRequest.class,
    adapters = {CtaListModel.class, ComponentExporter.class},
    resourceType = CtaListModel.RESOURCE_TYPE,
    defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
@Exporter(
    name = ExporterConstants.SLING_MODEL_EXPORTER_NAME,
    extensions = ExporterConstants.SLING_MODEL_EXTENSION
)
public class CtaListModel implements ComponentExporter {

    public static final String RESOURCE_TYPE = "[project]/components/cta-list";

    /**
     * Delegate to core List model (use fully qualified name to avoid collision)
     */
    @Self
    @Via(type = ResourceSuperType.class)
    private com.adobe.cq.wcm.core.components.models.List coreList;

    @SlingObject
    private Resource resource;

    @ValueMapValue
    private String listTitle;

    private List<CtaListPageItem> pages;

    @PostConstruct
    protected void init() {
        pages = new ArrayList<>();
        Resource pagesResource = resource.getChild("pages");
        if (pagesResource != null) {
            for (Resource itemResource : pagesResource.getChildren()) {
                CtaListPageItem pageItem = itemResource.adaptTo(CtaListPageItem.class);
                if (pageItem != null && pageItem.hasContent()) {
                    pages.add(pageItem);
                }
            }
        }
    }

    public String getListTitle() {
        return listTitle;
    }

    public List<CtaListPageItem> getPages() {
        return Collections.unmodifiableList(pages);
    }

    /**
     * Delegate to core List model for future use
     */
    public Collection<ListItem> getListItems() {
        return coreList != null ? coreList.getListItems() : Collections.emptyList();
    }

    public boolean hasContent() {
        return (listTitle != null && !listTitle.trim().isEmpty()) ||
               (pages != null && !pages.isEmpty());
    }

    @Override
    public String getExportedType() {
        return RESOURCE_TYPE;
    }
}
```

### 4. Child Item Model

```java
package [package].models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
    adaptables = Resource.class,
    defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class CtaListPageItem {

    @ValueMapValue
    private String linkURL;

    @ValueMapValue
    private String linkText;

    public String getLinkURL() {
        return linkURL;
    }

    public String getLinkText() {
        return linkText;
    }

    public boolean hasContent() {
        return linkURL != null && !linkURL.trim().isEmpty();
    }
}
```

---

## Unit Testing Extended Components

When testing models that use `SlingHttpServletRequest` as adaptable:

```java
package [package].models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class CtaListModelTest {

    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        // Register both model classes
        context.addModelsForClasses(CtaListModel.class, CtaListPageItem.class);
    }

    /**
     * Helper to adapt via request (required for SlingHttpServletRequest adaptable)
     */
    private CtaListModel getModel(Resource resource) {
        context.currentResource(resource);
        return context.request().adaptTo(CtaListModel.class);
    }

    @Test
    void testWithCompleteData() {
        // Create resource with sling:resourceType
        Resource componentResource = context.create().resource("/content/test",
            "sling:resourceType", CtaListModel.RESOURCE_TYPE,
            "listTitle", "Most Visited");

        // Create multifield items
        context.create().resource("/content/test/pages/item0",
            "linkURL", "/content/page1",
            "linkText", "Page One");
        context.create().resource("/content/test/pages/item1",
            "linkURL", "/content/page2",
            "linkText", "Page Two");

        CtaListModel model = getModel(componentResource);

        assertNotNull(model);
        assertTrue(model.hasContent());
        assertEquals("Most Visited", model.getListTitle());
        assertEquals(2, model.getPages().size());
        assertEquals(CtaListModel.RESOURCE_TYPE, model.getExportedType());
    }

    @Test
    void testWithEmptyData() {
        Resource componentResource = context.create().resource("/content/test",
            "sling:resourceType", CtaListModel.RESOURCE_TYPE);

        CtaListModel model = getModel(componentResource);

        assertNotNull(model);
        assertFalse(model.hasContent());
        assertNull(model.getListTitle());
        assertTrue(model.getPages().isEmpty());
    }
}
```

---

## Checklist for Extending Core Components

### Component Definition
- [ ] Added `sling:resourceSuperType` pointing to core component
- [ ] Used correct version (v2, v3, v4) of core component

### Dialog
- [ ] Identified parent component's tab/field node names
- [ ] Used `sling:hideResource="{Boolean}true"` to hide unwanted tabs
- [ ] Used `sling:hideResource` to hide unwanted fields (if needed)
- [ ] Used `sling:hideProperties` for field overrides (if needed)
- [ ] Used `sling:orderBefore` for tab positioning (if needed)
- [ ] Added hidden fields for forced default values (if needed)

### Sling Model
- [ ] Changed adaptable to `SlingHttpServletRequest.class`
- [ ] Added `resourceType` to `@Model` annotation
- [ ] Added `adapters` with model class AND `ComponentExporter.class`
- [ ] Added `@Exporter` annotation
- [ ] Added delegation: `@Self @Via(type = ResourceSuperType.class)`
- [ ] Used `@SlingObject` for Resource access
- [ ] Used fully qualified name for core interface (avoid import collision)
- [ ] Implemented `getExportedType()` method
- [ ] Implemented `hasContent()` method

### Unit Tests
- [ ] Updated to use `context.request().adaptTo()`
- [ ] Added `context.currentResource()` before adapting
- [ ] Added `sling:resourceType` to test resources
- [ ] Registered all model classes in `setUp()`
- [ ] Added test for `getExportedType()`
