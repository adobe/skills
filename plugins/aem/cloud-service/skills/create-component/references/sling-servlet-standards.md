# Sling Servlet Standards for AEM Components

> **Placeholders**: `[project]` = project name, `[package]` = Java package (from `aem-conventions.md`)

## Table of Contents

- [When to Use Servlets](#when-to-use-servlets)
- [File Location](#file-location)
- [JSON Library - Use javax.json](#json-library---use-javaxjson)
- [GET Servlet Pattern](#get-servlet-pattern)
- [POST Servlet Pattern](#post-servlet-pattern)
- [JSON Response Structure](#json-response-structure)
- [Security Checklist](#security-checklist)
- [Frontend Integration](#frontend-integration)
- [CSRF Token Handling](#csrf-token-handling)
- [Unit Test Pattern](#unit-test-pattern)
  - [Content Type Assertion - Critical Note](#content-type-assertion---critical-note)
- [Quick Reference](#quick-reference)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
- [Checklist](#checklist)
  - [Before Creating a Servlet](#before-creating-a-servlet)
  - [Servlet Implementation](#servlet-implementation)
  - [Security](#security)
  - [Frontend Integration](#frontend-integration)
  - [Testing](#testing)

---

## When to Use Servlets

| Component Behavior | Servlet Needed? |
|--------------------|-----------------|
| Static content from dialog | No |
| Content from JCR (author-configured) | No |
| Real-time data from external API | **Yes** |
| Form submission with validation | **Yes** |
| Async content loading | **Yes** |
| Search results based on user query | **Yes** |

---

## File Location

```
core/src/main/java/[package-path]/servlets/{ComponentName}Servlet.java
core/src/test/java/[package-path]/servlets/{ComponentName}ServletTest.java
```

---

## JSON Library - Use javax.json

**Always use `javax.json`** - guaranteed available in AEM, no dependency conflicts.

```java
import javax.json.Json;
import javax.json.JsonObjectBuilder;
import javax.json.JsonArrayBuilder;
import javax.json.JsonReader;

// Build JSON
JsonObjectBuilder result = Json.createObjectBuilder();
result.add("success", true);
result.add("data", Json.createObjectBuilder().add("key", "value"));
response.getWriter().write(result.build().toString());

// Parse JSON
try (JsonReader reader = Json.createReader(new StringReader(jsonString))) {
    JsonObject obj = reader.readObject();
}
```

---

## GET Servlet Pattern

```java
package [package].servlets;

import java.io.IOException;
import javax.json.Json;
import javax.json.JsonObjectBuilder;
import javax.servlet.Servlet;
import javax.servlet.ServletException;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.HttpConstants;
import org.apache.sling.api.servlets.SlingSafeMethodsServlet;
import org.apache.sling.servlets.annotations.SlingServletResourceTypes;
import org.osgi.service.component.annotations.Component;

@Component(service = Servlet.class)
@SlingServletResourceTypes(
    resourceTypes = "[project]/components/{component-name}",
    methods = HttpConstants.METHOD_GET,
    extensions = "json",
    selectors = "data"
)
public class ComponentNameServlet extends SlingSafeMethodsServlet {

    @Override
    protected void doGet(SlingHttpServletRequest request,
                         SlingHttpServletResponse response)
            throws ServletException, IOException {

        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        JsonObjectBuilder result = Json.createObjectBuilder();
        try {
            result.add("success", true);
            result.add("data", Json.createObjectBuilder().add("key", "value"));
        } catch (Exception e) {
            response.setStatus(SlingHttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            result.add("success", false);
            result.add("error", "An error occurred");
        }
        response.getWriter().write(result.build().toString());
    }
}
```

**URL Pattern**: `/content/mysite/page/jcr:content/component.data.json`

---

## POST Servlet Pattern

```java
package [package].servlets;

import java.io.IOException;
import javax.json.Json;
import javax.json.JsonObjectBuilder;
import javax.servlet.Servlet;
import javax.servlet.ServletException;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.HttpConstants;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.apache.sling.servlets.annotations.SlingServletResourceTypes;
import org.osgi.service.component.annotations.Component;

@Component(service = Servlet.class)
@SlingServletResourceTypes(
    resourceTypes = "[project]/components/{component-name}",
    methods = HttpConstants.METHOD_POST,
    extensions = "json",
    selectors = "submit"
)
public class ComponentNameServlet extends SlingAllMethodsServlet {

    @Override
    protected void doPost(SlingHttpServletRequest request,
                          SlingHttpServletResponse response)
            throws ServletException, IOException {

        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        JsonObjectBuilder result = Json.createObjectBuilder();
        try {
            String name = request.getParameter("name");
            // Validate and process...
            result.add("success", true);
            result.add("message", "Submitted successfully");
        } catch (IllegalArgumentException e) {
            response.setStatus(SlingHttpServletResponse.SC_BAD_REQUEST);
            result.add("success", false);
            result.add("error", e.getMessage());
        }
        response.getWriter().write(result.build().toString());
    }
}
```

---

## JSON Response Structure

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": "User-friendly message" }
```

| Status Code | When to Use |
|-------------|-------------|
| `200` | Success |
| `400` | Invalid input |
| `403` | Access denied |
| `404` | Not found |
| `500` | Server error |

---

## Security Checklist

- **Input validation**: Validate and sanitize all parameters
- **CSRF protection**: AEM's CSRFFilter handles form submissions automatically
- **Error messages**: Never expose stack traces or internal paths
- **Permissions**: Use resource-based binding (respects ACLs)

---

## Frontend Integration

**HTL - Expose resource path:**
```html
<div data-cmp-is="componentname" data-resource-path="${resource.path}">
```

**JavaScript - Fetch pattern:**
```javascript
var url = element.dataset.resourcePath + '.data.json';
fetch(url, { method: 'GET', credentials: 'same-origin' })
    .then(function(response) { return response.json(); })
    .then(function(result) {
        if (result.success) { /* handle data */ }
        else { /* handle error */ }
    });
```

---

## CSRF Token Handling

POST servlets are protected by AEM's CSRF filter. The frontend must obtain a token and include it with every POST request. GET requests do not require CSRF tokens.

**Step 1 — Fetch the CSRF token:**
```javascript
function getCsrfToken() {
    return fetch('/libs/granite/csrf/token.json', {
        credentials: 'same-origin'
    })
    .then(function(response) { return response.json(); })
    .then(function(data) { return data.token; });
}
```

**Step 2 — Submit a POST request with the token:**
```javascript
getCsrfToken().then(function(token) {
    fetch(element.dataset.resourcePath + '.submit.json', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'CSRF-Token': token,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'title=' + encodeURIComponent(title)
    })
    .then(function(response) { return response.json(); })
    .then(function(result) {
        if (result.success) { /* handle success */ }
        else { /* handle error */ }
    });
});
```

**Alternative — Send the token as a form parameter:**
```javascript
var body = ':cq_csrf_token=' + encodeURIComponent(token)
         + '&title=' + encodeURIComponent(title);
```

> **Note:** GET servlets do not need CSRF protection — only POST (and other state-changing methods) are filtered.

---

## Unit Test Pattern

```java
package [package].servlets;

import static org.junit.jupiter.api.Assertions.*;
import java.io.StringReader;
import javax.json.Json;
import javax.json.JsonObject;
import org.apache.sling.testing.mock.sling.servlet.MockSlingHttpServletRequest;
import org.apache.sling.testing.mock.sling.servlet.MockSlingHttpServletResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class ComponentNameServletTest {

    private final AemContext context = new AemContext();

    @Test
    void testDoGet_Success() throws Exception {
        ComponentNameServlet servlet = new ComponentNameServlet();
        context.create().resource("/content/test", "sling:resourceType", "[project]/components/name");
        context.currentResource("/content/test");

        servlet.doGet(context.request(), context.response());

        // IMPORTANT: Use startsWith() for content type (see note below)
        assertTrue(context.response().getContentType().startsWith("application/json"));
        
        JsonObject result = Json.createReader(
            new StringReader(context.response().getOutputAsString())).readObject();
        assertTrue(result.getBoolean("success"));
    }
}
```

### Content Type Assertion - Critical Note

**NEVER** use exact match for content type in servlet tests:

```java
// WRONG - Will fail because mock includes charset
assertEquals("application/json", context.response().getContentType());

// CORRECT - Use startsWith() to handle charset suffix
assertTrue(context.response().getContentType().startsWith("application/json"));
```

The `MockSlingHttpServletResponse.getContentType()` returns `"application/json;charset=UTF-8"` when both content type and character encoding are set.

---

## Quick Reference

| Attribute | GET Servlet | POST Servlet |
|-----------|-------------|--------------|
| Parent class | `SlingSafeMethodsServlet` | `SlingAllMethodsServlet` |
| Method | `HttpConstants.METHOD_GET` | `HttpConstants.METHOD_POST` |
| Typical selector | `data`, `search` | `submit` |
| Use case | Read data | Write/submit data |

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Better Approach |
|--------------|--------------|-----------------|
| Path-based binding for component servlets | Bypasses ACLs, requires dispatcher config | Use `@SlingServletResourceTypes` |
| Exposing stack traces | Security risk, reveals internal details | Log server-side, return generic message |
| Hardcoded content paths | Breaks in different environments | Use resource-relative paths |
| No input validation | XSS, injection vulnerabilities | Validate and sanitize all input |
| Synchronous blocking calls | Poor performance | Use async patterns where possible |
| Ignoring HTTP status codes | Clients can't handle errors properly | Return appropriate status codes |
| No CSRF protection on POST | Vulnerable to CSRF attacks | Use Granite CSRF framework |
| Returning sensitive data | Privacy/security issues | Only return necessary data |

---

## Checklist

### Before Creating a Servlet
- [ ] Confirmed servlet is needed (can't use Sling Model + HTL alone)
- [ ] Chose resource-based binding (not path-based)
- [ ] Identified correct HTTP method (GET for read, POST for write)
- [ ] Determined selector and extension

### Servlet Implementation
- [ ] Package is `[package].servlets`
- [ ] Class name follows `{ComponentName}Servlet` convention
- [ ] `@SlingServletResourceTypes` uses correct `resourceTypes`
- [ ] Correct parent class (`SlingSafeMethodsServlet` or `SlingAllMethodsServlet`)
- [ ] Response content type set (`application/json`)
- [ ] Response character encoding set (`UTF-8`)
- [ ] Standard JSON response structure used
- [ ] Proper HTTP status codes returned
- [ ] Uses `javax.json` (not GSON)

### Security
- [ ] Input validated and sanitized
- [ ] Error messages don't expose internals
- [ ] CSRF protection for POST requests
- [ ] Permission checks where needed

### Frontend Integration
- [ ] HTL exposes `data-resource-path`
- [ ] JavaScript uses correct URL pattern (`path.selector.extension`)
- [ ] Error handling with user feedback
- [ ] Loading states implemented

### Testing
- [ ] Unit test file created
- [ ] Success scenario tested
- [ ] Error scenarios tested
- [ ] Validation tested
