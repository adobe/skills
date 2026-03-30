# Component Creation Examples

This reference provides example prompts and expected responses for common component creation scenarios.

---

## Example 1: Simple Component

```
User: Create an AEM component called hero-banner
```

**Response:**
- Create with placeholder dialog (no fields specified)
- Ask user what dialog fields they need

---

## Example 2: Component with Dialog Spec

```
User: Create a tiles-list component with these fields:
| Field | Type |
|-------|------|
| Title | Textfield |
| Items | Multifield |
```

**Response:**
> "I will create a dialog with EXACTLY these 2 fields:
> 1. Title (textfield) -> `title`
> 2. Items (multifield) -> `items`
> Proceeding with creation..."

---

## Example 3: Extending Core Component

```
User: Create a hero-teaser extending teaser with Video URL (pathfield) and Autoplay (checkbox)
```

**Response:**
> "Using Core Component: `core/wcm/components/teaser/v2/teaser`
> Adding 2 custom fields while inheriting Teaser dialog."

---

## Example 4: Extending Core Component with Hidden Tabs

```
User: Create a CTA List component extending List. Hide List Settings and Item Settings tabs.
      Add listTitle field. Only allow Fixed list.
```

**Response:**
> "Extending Core Component: `core/wcm/components/list/v4/list`
>
> **Dialog Changes:**
> - Hiding inherited tabs: `listSettings`, `itemSettings` (using `sling:hideResource`)
> - Adding custom Properties tab with: listTitle, pages multifield
> - Setting listFrom=static via hidden field
>
> **Model Changes:**
> - Using `SlingHttpServletRequest` as adaptable
> - Implementing delegation to core List model via `@Self @Via(type = ResourceSuperType.class)`
> - Implementing `ComponentExporter` interface
> - Adding custom listTitle property
>
> Proceeding with creation..."

---

## Example 5: Overriding Inherited Field Properties

```
User: Create a custom-button extending button. Make the link text field required and change label to "Button Label"
```

**Response:**
> "Extending Core Component: `core/wcm/components/button/v2/button`
>
> **Dialog Changes:**
> - Overriding inherited `linkText` field using `sling:hideProperties`
> - Changing fieldLabel to "Button Label"
> - Adding required="{Boolean}true"
>
> Proceeding with creation..."

---

## Example 6: Integration Component with Sling Servlet

```
User: Create a search-results component that fetches results dynamically based on user query.
      Dialog fields: Search Path (pathfield), Results Per Page (numberfield)
```

**Response:**
> "I will create a component with dynamic content loading:
>
> **Dialog Fields (2 fields):**
> 1. Search Path (pathfield) -> `searchPath`
> 2. Results Per Page (numberfield) -> `resultsPerPage`
>
> **Dynamic Content:**
> - Creating GET Servlet: `SearchResultsServlet`
> - Selector: `search`
> - URL pattern: `/content/.../component.search.json?q={query}`
>
> **Files to Create:**
> - Component definition, dialog, HTL
> - Sling Model for dialog properties
> - **Sling Servlet** for search functionality
> - Clientlib with **Fetch API** for async loading
> - Unit tests for model AND servlet
>
> Proceeding with creation..."

---

## Example 7: Form Submission Component with POST Servlet

```
User: Create a contact-form component with Name (textfield), Email (textfield), Message (textarea).
      Form should submit via AJAX without page reload.
```

**Response:**
> "I will create a form component with async submission:
>
> **Dialog Fields (3 fields):**
> 1. Name (textfield) -> `name`
> 2. Email (textfield) -> `email`
> 3. Message (textarea) -> `message`
>
> **Form Submission:**
> - Creating POST Servlet: `ContactFormServlet`
> - Selector: `submit`
> - URL pattern: `/content/.../component.submit.json`
> - CSRF token handling included
>
> **Files to Create:**
> - Component definition, dialog, HTL (with form markup)
> - Sling Model for dialog configuration
> - **POST Servlet** with validation
> - Clientlib with form submission handler
> - Unit tests with validation scenarios
>
> Proceeding with creation..."

---

## Example 8: Path-Based Sling Servlet

```
User: Create AEM Path based sling servlet for returning "Hello World!" as the response.
```

**Response:**
> "I will create a path-based Sling Servlet:
>
> **Servlet Configuration:**
> - Type: Path-based GET Servlet
> - Path: `/bin/helloworld`
> - Response: Plain text `Hello World!`
>
> **Implementation Details:**
> - Using `@SlingServletPaths` annotation
> - Registered OSGi component with `javax.servlet.Servlet` service
> - Returns `text/plain` content type
> - Includes proper error handling
>
> **Files to Create:**
> - **Sling Servlet**: `HelloWorldServlet.java` in `core` module
> - Unit tests for servlet response validation
>
> Proceeding with creation..."
