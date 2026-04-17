# Sling Model Patterns for AEM Components

Patterns for creating AEM Sling Models following Adobe best practices.

## Table of Contents

- [File Location](#file-location)
- [Basic Model Template](#basic-model-template)
- [Property Injection Annotations](#property-injection-annotations)
  - [Simple Properties](#simple-properties)
  - [Properties with Custom Name](#properties-with-custom-name)
  - [Default Values](#default-values)
  - [Child Resources (Nested Content)](#child-resources-nested-content)
- [Multifield Processing Pattern](#multifield-processing-pattern)
  - [Single-Value Multifield](#single-value-multifield)
- [Child Item Model Pattern](#child-item-model-pattern)
- [Component Extension (Delegation Pattern)](#component-extension-delegation-pattern)
  - [Quick Reference](#quick-reference)
  - [Key Points](#key-points)
- [Prefer Java Native Over External Dependencies](#prefer-java-native-over-external-dependencies)
- [Getter Patterns](#getter-patterns)
- [Required Imports](#required-imports)
- [Naming Conventions](#naming-conventions)
- [Class Organization Order](#class-organization-order)

---

## File Location
```
core/src/main/java/[package-path]/models/{ComponentName}Model.java
```

**Note**: `[package-path]` = `[package]` with dots replaced by slashes (e.g., `com/mysite/core`)

---

## Basic Model Template

```java
// Include Apache 2.0 license header (see java-standards.md)
package [package].models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ComponentNameModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public boolean hasContent() {
        return title != null || description != null;
    }
}
```

---

## Property Injection Annotations

### Simple Properties
```java
@ValueMapValue
private String title;

@ValueMapValue
private String description;

@ValueMapValue
private String linkText;

@ValueMapValue
private String linkURL;
```

### Properties with Custom Name
```java
@ValueMapValue(name = "jcr:title")
private String pageTitle;
```

### Default Values
```java
@ValueMapValue
@Default(booleanValues = false)
private boolean enabled;

@ValueMapValue
@Default(intValues = 10)
private int maxItems;

@ValueMapValue
@Default(values = "default")
private String variant;
```

### Child Resources (Nested Content)
```java
// Single child resource (e.g., image)
@ChildResource(name = "image")
private Resource imageResource;

// List of child resources (for multifield)
@ChildResource(name = "items")
private List<Resource> itemResources;
```

---

## Multifield Processing Pattern

```java
package [package].models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TilesListModel {

    @ValueMapValue
    private String listTitle;

    @ChildResource(name = "tiles")
    private List<Resource> tileResources;

    private List<TileItem> tiles;

    @PostConstruct
    protected void init() {
        tiles = new ArrayList<>();
        if (tileResources != null) {
            for (Resource itemResource : tileResources) {
                TileItem tile = itemResource.adaptTo(TileItem.class);
                if (tile != null && tile.hasContent()) {
                    tiles.add(tile);
                }
            }
        }
    }

    public String getListTitle() {
        return listTitle;
    }

    public List<TileItem> getTiles() {
        return Collections.unmodifiableList(tiles);
    }

    public boolean hasContent() {
        return listTitle != null || (tiles != null && !tiles.isEmpty());
    }
}
```

### Single-Value Multifield

Even when a multifield has no `composite="true"` (i.e., it contains a single field per item), AEM stores each entry as a **child resource** — not as a multi-value JCR property. Each child resource has a `value` property containing the field's data.

**Correct pattern** — iterate child resources and extract the value from each:

```java
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;

// Inside the model class:

private List<String> tags;

@PostConstruct
private void init() {
    tags = Optional.ofNullable(resource.getChild("tags"))
        .map(Resource::getChildren)
        .map(children -> StreamSupport.stream(children.spliterator(), false)
            .map(child -> child.getValueMap().get("value", String.class))
            .filter(Objects::nonNull)
            .collect(Collectors.toList()))
        .orElse(Collections.emptyList());
}
```

> **Common shortcut (not recommended):** `@ValueMapValue String[] tags`
> This only works if the JCR node stores a true multi-value property (e.g., `cq:tags`). For standard multifields the values are stored as child resources (`tags/item0`, `tags/item1`, …), so `@ValueMapValue` will return `null`. Always use the child-resource iteration pattern above for multifield data.

---

## Child Item Model Pattern

```java
package [package].models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TileItem {

    @ChildResource(name = "tileImage")
    private Resource tileImageResource;

    @ValueMapValue
    private String tileTitle;

    @ValueMapValue
    private String tileDesc;

    @ValueMapValue
    private String tileLinkText;

    @ValueMapValue
    private String tileLinkURL;

    public String getImageReference() {
        if (tileImageResource != null) {
            return tileImageResource.getValueMap().get("fileReference", String.class);
        }
        return null;
    }

    public String getTileTitle() {
        return tileTitle;
    }

    public String getTileDesc() {
        return tileDesc;
    }

    public String getTileLinkText() {
        return tileLinkText;
    }

    public String getTileLinkURL() {
        return tileLinkURL;
    }

    public boolean hasContent() {
        return tileTitle != null;
    }
}
```

---

## Component Extension (Delegation Pattern)

**For complete extension guide, load:** `references/extending-core-components.md`

### Quick Reference

| Scenario | Use Delegation? | Adaptable |
|----------|-----------------|-----------|
| Extending Core Component | **YES** | `SlingHttpServletRequest` |
| Need JSON export (SPA) | **YES** | `SlingHttpServletRequest` |
| Simple property-only | Optional | `Resource` |

### Key Points
- Use `@Self @Via(type = ResourceSuperType.class)` for delegation
- Use `SlingHttpServletRequest` as adaptable (required for delegation)
- Implement `ComponentExporter` interface for JSON export
- Use fully qualified names for Core Component interfaces (avoid `java.util.List` collision)

---

## Prefer Java Native Over External Dependencies

| Need | Java Native Alternative |
|------|------------------------|
| String blank check | `s != null && !s.trim().isEmpty()` |
| String empty check | `s != null && !s.isEmpty()` |
| Collection empty | `c == null \|\| c.isEmpty()` |
| Null-safe equals | `Objects.equals(a, b)` |

---

## Getter Patterns

```java
// Simple value
public String getTitle() {
    return title;
}

// List (return unmodifiable)
public List<TileItem> getTiles() {
    return Collections.unmodifiableList(tiles);
}

// Content check (REQUIRED)
public boolean hasContent() {
    return title != null || (tiles != null && !tiles.isEmpty());
}
```

---

## Required Imports

```java
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;
import javax.annotation.PostConstruct;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
```

---

## Naming Conventions

| Component Name | Model Class | Item Class |
|----------------|-------------|------------|
| `hero-banner` | `HeroBannerModel` | - |
| `tiles-list` | `TilesListModel` | `TileItem` |
| `card-carousel` | `CardCarouselModel` | `CardItem` |

---

## Class Organization Order

1. Static fields (RESOURCE_TYPE)
2. Injected fields (@ValueMapValue, @ChildResource)
3. Derived fields (processed lists)
4. @PostConstruct method
5. Public getters
6. hasContent() method
