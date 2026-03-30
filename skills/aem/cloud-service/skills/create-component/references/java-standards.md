# Java Coding Standards for AEM

> **Project Configuration**: This file uses placeholders that reference values from `aem-conventions.md`:
> - `[package]` → Your Java base package (e.g., `com.mysite.core`)
> 
> **Before using these rules**, ensure `aem-conventions.md` is configured for your project.

## License Header

All Java files must include the Apache 2.0 license header:

```java
/*
 *  Copyright 2015 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
```

## Package Structure

```
[package]
├── models/          # Sling Models
├── filters/         # Sling Filters
├── servlets/        # Sling Servlets
├── services/        # OSGi Services
├── schedulers/      # Scheduled Tasks
└── listeners/       # Event Listeners
```

## Sling Model Standards

### Model Declaration
```java
@Model(
    adaptables = Resource.class,
    defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class ComponentModel {
    // ...
}
```

### Required Imports
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

### Property Injection
```java
// Simple properties
@ValueMapValue
private String title;

// Properties with custom name
@ValueMapValue(name = "jcr:title")
private String pageTitle;

// Child resources (for nested content like images)
@ChildResource(name = "image")
private Resource imageResource;

// List of child resources (for multifield)
@ChildResource(name = "items")
private List<Resource> itemResources;
```

### Initialization Pattern
```java
private List<ItemModel> items;

@PostConstruct
protected void init() {
    items = new ArrayList<>();
    if (itemResources != null) {
        for (Resource itemResource : itemResources) {
            ItemModel item = itemResource.adaptTo(ItemModel.class);
            if (item != null && item.hasContent()) {
                items.add(item);
            }
        }
    }
}
```

### Getter Pattern
```java
// For simple values
public String getTitle() {
    return title;
}

// For lists - return unmodifiable
public List<ItemModel> getItems() {
    return Collections.unmodifiableList(items);
}

// Content check method
public boolean hasContent() {
    return title != null || (items != null && !items.isEmpty());
}
```

## Javadoc Requirements

Every public class and method must have Javadoc:

```java
/**
 * Sling Model for the Hero Banner component.
 * Provides properties for rendering the hero section.
 */
@Model(adaptables = Resource.class)
public class HeroBannerModel {

    /**
     * Gets the banner headline text.
     * @return the headline, or null if not set
     */
    public String getHeadline() {
        return headline;
    }
}
```

## General Java Rules

1. Use Java 11+ features where appropriate
2. Prefer `Optional` over null checks for method returns
3. Use meaningful variable and method names
4. Follow single responsibility principle
5. Keep methods short and focused
6. Use `final` for fields that shouldn't change
7. Avoid magic numbers - use constants
8. Handle exceptions appropriately
9. Use StringBuilder for string concatenation in loops
10. Prefer composition over inheritance

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Class | PascalCase | `HeroBannerModel` |
| Interface | PascalCase with adjective | `Linkable`, `Renderable` |
| Method | camelCase, verb prefix | `getTitle()`, `hasContent()`, `isVisible()` |
| Variable | camelCase | `listTitle`, `tileItems` |
| Constant | UPPER_SNAKE_CASE | `DEFAULT_LIMIT`, `MAX_ITEMS` |
| Package | lowercase | `[package].models` |

## Code Organization

Order within a class:
1. Static fields
2. Instance fields (with annotations)
3. Constructors
4. `@PostConstruct` method
5. Public methods (getters first)
6. Private/protected methods
7. Inner classes (if any)











