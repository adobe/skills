# Extending Core Components — Worked Example & Checklists

> This is a companion to references/extending-core-components.md which covers the reference guide for Sling Resource Merger, Model Delegation, and ComponentExporter patterns.

## Table of Contents

- [Complete Example: Extending Core List Component](#complete-example-extending-core-list-component)
  - [Requirements](#requirements)
  - [1. Component Definition (.content.xml)](#1-component-definition-contentxml)
  - [2. Dialog with Sling Resource Merger](#2-dialog-with-sling-resource-merger)
  - [3. Sling Model with Delegation](#3-sling-model-with-delegation)
  - [4. Child Item Model](#4-child-item-model)
- [Unit Testing Extended Components](#unit-testing-extended-components)
  - [Known Limitation: Delegation is Null in Mock Context](#known-limitation-delegation-is-null-in-mock-context)
- [Checklist for Extending Core Components](#checklist-for-extending-core-components)
  - [Component Definition](#component-definition)
  - [Dialog](#dialog)
  - [Sling Model](#sling-model)
  - [Unit Tests](#unit-tests)

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

### Known Limitation: Delegation is Null in Mock Context

When using `@Self @Via(type = ResourceSuperType.class)` to delegate to a Core Component model, the delegated field (e.g., `coreList`) will be `null` in wcm.io `AemContext` unit tests.

**Why this happens:** The wcm.io mock context does not perform actual Sling Resource Merger resolution.The `@Via(type = ResourceSuperType.class)` annotation relies on the resource super type chain to adaptthe resource as the parent component's model, but in a mock environment this resolution never occurs.As a result, the injected Core Component model is always `null`.

**What this means in practice:**

- Any delegated method (e.g., `getListItems()`, `getTitle()`) will throw a `NullPointerException` or return `null` if the delegation field is not guarded
- The test example above works because it only tests **custom properties** (`getListTitle()`,`getPages()`, `hasContent()`), not delegated Core Component behavior

**Recommendations:**

1. **Test your custom properties directly** — as shown in the test example above, focus unit tests onthe properties and logic your extended model adds.
2. **Null-guard delegated calls in your model** — protect all methods that delegate to the corecomponent so they behave safely when the delegate is `null`:

```java
// In your Sling Model — null-guard pattern for delegated methods
public String getTitle() {
    return coreList != null ? coreList.getTitle() : null;
}

public Collection<ListItem> getListItems() {
    return coreList != null ? coreList.getListItems() : Collections.emptyList();
}
```

1. **Test delegation via integration tests** — to verify that `@Via(type = ResourceSuperType.class)`resolves correctly and delegated methods return real data, use AEM integration tests running in anactual Sling container where the Resource Merger is available.

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