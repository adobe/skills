# Troubleshooting — Common AEM Component Issues

Quick-reference for diagnosing and fixing the most frequent AEM component development problems.

---

## 1. Model Returns Null

**Cause:** Sling Model not registered — missing `@Model` annotation, wrong `adaptables`, or missing `resourceType`.

**Fix:** Verify the `@Model` annotation specifies correct `adaptables` and includes the `resourceType` matching your component's `.content.xml`.

```java
// ✅ Correct
@Model(adaptables = SlingHttpServletRequest.class,
       adapters = MyComponentModel.class,
       resourceType = "myproject/components/my-component",
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class MyComponentModel { ... }

// ❌ Wrong — missing resourceType, wrong adaptable
@Model(adaptables = Resource.class)
public class MyComponentModel { ... }
```

---

## 2. Dialog Fields Not Saving

**Cause:** Missing `./` prefix on the field `name` property. Without it, the value is not stored relative to the component's JCR node.

**Fix:** All dialog field names must start with `./` (e.g., `./title`, not `title`).

```xml
<!-- ✅ Correct -->
<title jcr:primaryType="nt:unstructured"
       sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
       fieldLabel="Title"
       name="./title"/>

<!-- ❌ Wrong — missing ./ prefix -->
<title ... name="title"/>
```

---

## 3. Clientlib Not Loading

**Cause:** Wrong `categories` name in the clientlib, or the site's base clientlib doesn't embed it.

**Fix:** Verify the category matches what your page template or HTL includes. Check if a parent clientlib needs an `embed` entry.

```xml
<!-- In clientlib's .content.xml -->
<jcr:root jcr:primaryType="cq:ClientLibraryFolder"
          categories="[myproject.components.my-component]"/>

<!-- In page template or base clientlib, embed it: -->
<jcr:root jcr:primaryType="cq:ClientLibraryFolder"
          categories="[myproject.base]"
          embed="[myproject.components.my-component]"/>
```

---

## 4. Component Not Appearing in Sidekick / Insert Menu

**Cause:** Missing or wrong `componentGroup` in `.content.xml`, or the template policy doesn't allow it.

**Fix:** Check `.content.xml` has a `componentGroup` that matches the site's allowed component groups. Also verify the template's policy includes the group.

```xml
<!-- .content.xml -->
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"
          xmlns:cq="http://www.day.com/jcr/cq/1.0"
          jcr:primaryType="cq:Component"
          jcr:title="My Component"
          componentGroup="MySite Components"/>
```

---

## 5. HTL Shows Raw Variable Names (e.g., `${model.title}`)

**Cause:** `data-sly-use` points to a wrong or non-existent model class, or the Sling Model is not properly registered.

**Fix:** Verify the `data-sly-use` identifier resolves to a valid, registered Sling Model. Check the fully-qualified class name and confirm the model's `@Model` annotation is correct (see Issue #1).

```html
<!-- ✅ Correct -->
<sly data-sly-use.model="com.myproject.core.models.MyComponentModel"/>
<h2>${model.title}</h2>

<!-- ❌ Wrong — typo in class path -->
<sly data-sly-use.model="com.myproject.core.model.MyComponentModel"/>
```

---

## 6. Multifield Items Not Saving

**Cause:** Composite multifield misconfigured — missing `composite=true` or child field names lack `./` prefix.

**Fix:** Set `composite="{Boolean}true"` on the multifield node and ensure each child field uses `./` names.

```xml
<items jcr:primaryType="nt:unstructured"
       sling:resourceType="granite/ui/components/coral/foundation/form/multifield"
       composite="{Boolean}true"
       fieldLabel="Links"
       name="./links">
  <field jcr:primaryType="nt:unstructured"
         sling:resourceType="granite/ui/components/coral/foundation/container">
    <items jcr:primaryType="nt:unstructured">
      <linkText jcr:primaryType="nt:unstructured"
                sling:resourceType="granite/ui/components/coral/foundation/form/textfield"
                fieldLabel="Link Text"
                name="./linkText"/>
    </items>
  </field>
</items>
```

---

## 7. Unit Test NPE on Model Instantiation

**Cause:** Test context resource not created with required properties, or model class not registered in the AEM mock context.

**Fix:** Use `context.create().resource()` with the correct properties map, and register the model with `context.addModelsForClasses()`.

```java
@ExtendWith(AemContextExtension.class)
class MyComponentModelTest {
    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        // ✅ Register the model class
        context.addModelsForClasses(MyComponentModel.class);
        // ✅ Create resource with properties
        context.create().resource("/content/test",
            "title", "Test Title",
            "sling:resourceType", "myproject/components/my-component");
        context.currentResource("/content/test");
    }
}
```

---

## 8. Extended Component Dialog Shows No Tabs

**Cause:** Sling Resource Merger path is wrong — `sling:resourceSuperType` doesn't match the parent component's path exactly.

**Fix:** Verify `sling:resourceSuperType` matches the parent path character-for-character. When overriding properties, use `sling:hideProperties` or `merge:replaceProperties` carefully.

```xml
<!-- .content.xml — sling:resourceSuperType must be exact -->
<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
          jcr:primaryType="cq:Component"
          jcr:title="Custom Teaser"
          sling:resourceSuperType="core/wcm/components/teaser/v2/teaser"
          componentGroup="MySite Components"/>
```

If you need to hide an inherited tab in the dialog:
```xml
<inheritedTab jcr:primaryType="nt:unstructured"
              sling:hideResource="{Boolean}true"/>
```

---

## 9. CSS Not Applying

**Cause:** BEM class names in CSS don't match what the HTL template renders, or the clientlib category isn't loaded on the page.

**Fix:** Compare the class names in your CSS file against the actual HTL output. Verify the clientlib category is included or embedded by the page's base clientlib.

```html
<!-- HTL must output the exact BEM classes your CSS targets -->
<div class="cmp-my-component">
  <h2 class="cmp-my-component__title">${model.title}</h2>
</div>
```
```css
/* CSS must match exactly */
.cmp-my-component { ... }
.cmp-my-component__title { font-size: 1.5rem; }

/* ❌ Wrong — class mismatch */
.cmp-mycomponent__title { ... }
```

---

## 10. JS Initialization Not Firing

**Cause:** Missing `data-cmp-is` attribute on the component root element, or JS is querying the wrong selector.

**Fix:** Add `data-cmp-is="component-name"` to the component's root element in HTL. The JS must query `[data-cmp-is="component-name"]`.

```html
<!-- HTL -->
<div class="cmp-my-component" data-cmp-is="my-component">
  ...
</div>
```
```javascript
// JS initialization
(function() {
    'use strict';
    function init(element) {
        // Component logic here
    }
    // Query by data-cmp-is attribute
    document.querySelectorAll('[data-cmp-is="my-component"]').forEach(init);
})();
```

---

## 11. Embedded Component CSS Breaks During Page Editor Editing

**Cause:** CSS class is on the same element as `data-sly-resource`. The page editor replaces this element during inline editing (cropping, drag-and-drop), removing the CSS class until page refresh.

**Fix:** Use a wrapper div — put your CSS class on an outer `<div>`, and put `data-sly-resource` on an inner `<div>`. The outer div's CSS class survives page editor interactions.

```html
<!-- ❌ Wrong — CSS class and data-sly-resource on the same element -->
<div class="cmp-hero__image" data-sly-resource="${'image' @ resourceType='core/wcm/components/image/v3/image'}"></div>

<!-- ✅ Correct — wrapper div keeps CSS class safe from editor replacement -->
<div class="cmp-hero__image">
    <div data-sly-resource="${'image' @ resourceType='core/wcm/components/image/v3/image'}"></div>
</div>
```
