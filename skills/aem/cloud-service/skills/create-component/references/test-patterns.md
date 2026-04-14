# Testing Patterns for AEM Components

Patterns for creating unit tests using wcm.io AEM Mocks with JUnit 5.

## Table of Contents

- [Critical Rules](#critical-rules)
  - [Rule 1: NEVER Mock Resource.adaptTo()](#rule-1-never-mock-resourceadaptto)
  - [Rule 2: Register All Sling Models](#rule-2-register-all-sling-models)
  - [Rule 3: Use Real Resources, Not Mocks](#rule-3-use-real-resources-not-mocks)
- [Test Class Structure](#test-class-structure)
- [Test Naming Convention](#test-naming-convention)
- [Required Test Scenarios](#required-test-scenarios)
  - [For Every Component Model](#for-every-component-model)
  - [For Multifield Components](#for-multifield-components)
  - [For Components with Images](#for-components-with-images)
- [Creating Test Resources](#creating-test-resources)
  - [Simple Properties](#simple-properties)
  - [Nested Resources (Multifield)](#nested-resources-multifield)
  - [Image Child Resource](#image-child-resource)
- [Assertions](#assertions)
- [Code Coverage Goals](#code-coverage-goals)
  - [Coverage Strategy](#coverage-strategy)
- [Common Mistakes to Avoid](#common-mistakes-to-avoid)
- [Quick Checklist](#quick-checklist)

---

## Critical Rules

### Rule 1: NEVER Mock Resource.adaptTo()
`Resource.adaptTo()` is a **final method** and cannot be mocked.

```java
// WRONG - Will fail
Resource resource = mock(Resource.class);
when(resource.adaptTo(MyModel.class)).thenReturn(mockModel); // FAILS!

// CORRECT - Use AemContext
Resource resource = context.create().resource("/content/test", "title", "Test");
MyModel model = resource.adaptTo(MyModel.class);
```

### Rule 2: Register All Sling Models
```java
@BeforeEach
void setUp() {
    context.addModelsForClasses(ParentModel.class, ChildItemModel.class);
}
```

### Rule 3: Use Real Resources, Not Mocks
```java
// CORRECT
Resource parent = context.create().resource("/content/test", "title", "My Title");
context.create().resource("/content/test/items/item0", "itemTitle", "Item 1");
ParentModel model = parent.adaptTo(ParentModel.class);

// WRONG - Too complex, error-prone
Resource parent = mock(Resource.class);
when(parent.getValueMap()).thenReturn(...);
```

---

## Test Class Structure

```java
package [package].models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

// NOTE: Projects MAY have a custom `AppAemContext` helper class that pre-registers
// common services or content. Using `new AemContext()` directly works universally
// with just the wcm.io AEM Mocks dependency.

@ExtendWith(AemContextExtension.class)
class ComponentNameModelTest {

    private final AemContext context = new AemContext();

    private Page page;
    private Resource componentResource;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(ComponentNameModel.class);
        page = context.create().page("/content/[project]/test-page");
    }

    @Test
    void testWithCompleteData() {
        // Arrange
        componentResource = context.create().resource(page, "component",
            "sling:resourceType", "[project]/components/component-name",
            "title", "Test Title",
            "description", "Test Description");

        // Act
        ComponentNameModel model = componentResource.adaptTo(ComponentNameModel.class);

        // Assert
        assertNotNull(model);
        assertEquals("Test Title", model.getTitle());
        assertEquals("Test Description", model.getDescription());
        assertTrue(model.hasContent());
    }

    @Test
    void testWhenEmpty() {
        componentResource = context.create().resource(page, "component",
            "sling:resourceType", "[project]/components/component-name");

        ComponentNameModel model = componentResource.adaptTo(ComponentNameModel.class);

        assertNotNull(model);
        assertNull(model.getTitle());
        assertFalse(model.hasContent());
    }
}
```

---

## Test Naming Convention

```java
void testMethodName_Scenario() { }

// Examples:
void testGetTitle_WithValidTitle() { }
void testGetTitle_WhenTitleIsNull() { }
void testHasContent_WithCompleteData() { }
void testHasContent_WhenEmpty() { }
void testGetItems_WithMultipleItems() { }
void testGetItems_WhenNoItems() { }
```

---

## Required Test Scenarios

### For Every Component Model

```java
@Test
void testWithCompleteData() {
    // All properties populated
    // Assert all getters return expected values
    // Assert hasContent() returns true
}

@Test
void testWhenEmpty() {
    // No properties
    // Assert getters return null/empty
    // Assert hasContent() returns false
}

@Test
void testWithPartialData() {
    // Some properties
    // Assert populated properties return values
    // Assert unpopulated return null
}
```

### For Multifield Components

```java
@Test
void testWithMultipleItems() {
    Resource parent = context.create().resource("/content/test", "listTitle", "List");
    context.create().resource("/content/test/items/item0", "itemTitle", "Item 1");
    context.create().resource("/content/test/items/item1", "itemTitle", "Item 2");

    ParentModel model = parent.adaptTo(ParentModel.class);

    assertNotNull(model);
    assertEquals(2, model.getItems().size());
    assertEquals("Item 1", model.getItems().get(0).getItemTitle());
}

@Test
void testWithSingleItem() {
    Resource parent = context.create().resource("/content/test");
    context.create().resource("/content/test/items/item0", "itemTitle", "Only Item");

    ParentModel model = parent.adaptTo(ParentModel.class);

    assertEquals(1, model.getItems().size());
}

@Test
void testWithNoItems() {
    Resource parent = context.create().resource("/content/test");

    ParentModel model = parent.adaptTo(ParentModel.class);

    assertNotNull(model.getItems());
    assertTrue(model.getItems().isEmpty());
}
```

### For Components with Images

```java
@Test
void testImageWithReference() {
    componentResource = context.create().resource(page, "component");
    context.create().resource(componentResource, "image",
        "fileReference", "/content/dam/[project]/image.jpg");

    ComponentModel model = componentResource.adaptTo(ComponentModel.class);

    assertEquals("/content/dam/[project]/image.jpg", model.getImageReference());
}

@Test
void testImageWithoutReference() {
    componentResource = context.create().resource(page, "component");

    ComponentModel model = componentResource.adaptTo(ComponentModel.class);

    assertNull(model.getImageReference());
}
```

---

## Creating Test Resources

### Simple Properties
```java
Resource resource = context.create().resource(page, "component",
    "sling:resourceType", "[project]/components/example",
    "title", "Test Title",
    "description", "Test Description");
```

### Nested Resources (Multifield)
```java
Resource component = context.create().resource(page, "component",
    "sling:resourceType", "[project]/components/example",
    "listTitle", "My List");

context.create().resource(component, "items/item0",
    "title", "Item 1 Title",
    "description", "Item 1 Description");

context.create().resource(component, "items/item1",
    "title", "Item 2 Title");
```

### Image Child Resource
```java
context.create().resource(itemResource, "tileImage",
    "fileReference", "/content/dam/[project]/image.jpg",
    "fileName", "image.jpg");
```

---

## Assertions

```java
// Null checks
assertNotNull(model);
assertNull(model.getOptionalField());

// Equality
assertEquals("expected", model.getActualValue());
assertEquals(3, model.getItems().size());

// Boolean
assertTrue(model.hasContent());
assertFalse(model.isEmpty());

// Collections
assertNotNull(model.getItems());
assertTrue(model.getItems().isEmpty());
```

---

## Code Coverage Goals

- Minimum 80% line coverage
- 100% coverage for public methods
- Cover all branches (if/else)

### Coverage Strategy

| Code Pattern | Tests Needed |
|--------------|--------------|
| Simple getter | 2 (with value, null) |
| Conditional (if/else) | 2+ (each branch) |
| Multifield init | 4 (null, empty, single, multiple) |
| Ternary operator | 2 (true, false) |

---

## Common Mistakes to Avoid

### Wrong: Mocking adaptTo()
```java
when(resource.adaptTo(MyModel.class)).thenReturn(mockModel); // FAILS!
```

### Wrong: Not Registering Models
```java
// Returns null without registration
MyModel model = resource.adaptTo(MyModel.class);
```
**Fix:** `context.addModelsForClasses(MyModel.class)`

### Wrong: Incorrect Multifield Path
```java
context.create().resource("/content/test/item0"); // Won't be found
```
**Fix:** Match dialog structure:
```java
context.create().resource("/content/test/items/item0");
```

---

## Quick Checklist

Before submitting tests:
- [ ] All models registered in `@BeforeEach`
- [ ] Using `context.create().resource()` (not mocks)
- [ ] Multifield paths match dialog structure
- [ ] Tests cover: complete, empty, partial data
- [ ] Tests cover: multiple, single, zero items
- [ ] `hasContent()` tested for true and false
