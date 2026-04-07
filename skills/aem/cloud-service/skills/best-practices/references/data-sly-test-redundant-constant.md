# data-sly-test: Redundant Constant Value Comparison

Fixes for the AEM Cloud SDK HTL lint warning **"data-sly-test: redundant constant value comparison"**.

**Rule:** In HTL, `data-sly-test` should always receive a variable or expression that evaluates to boolean — never a raw string literal, raw `true`/`false`, or a number directly.

---

## Pattern 1: Boolean Constant Comparison (`== true` / `== false`)

### What the linter flags

The warning value is `true` or `false`. The HTL expression compares a variable against a boolean literal.

### Before (warns)

```html
<div data-sly-test="${someVar == true}">visible when someVar is truthy</div>
<div data-sly-test="${someVar == false}">visible when someVar is falsy</div>
```

### After (clean)

```html
<div data-sly-test="${someVar}">visible when someVar is truthy</div>
<div data-sly-test="${!someVar}">visible when someVar is falsy</div>
```

### Rules

- `== true` → remove the comparison; HTL treats the variable as boolean by default
- `== false` → negate with `!`
- If the original uses `data-sly-test.varName`, preserve the variable name:

```html
<!-- Before -->
<div data-sly-test.isActive="${model.active == true}">

<!-- After -->
<div data-sly-test.isActive="${model.active}">
```

### Edge case: `!= true` / `!= false`

```html
<!-- != true is the same as == false -->
<div data-sly-test="${someVar != true}">  →  <div data-sly-test="${!someVar}">

<!-- != false is the same as == true -->
<div data-sly-test="${someVar != false}">  →  <div data-sly-test="${someVar}">
```

---

## Pattern 2: Hardcoded String/Path as Test Value

### What the linter flags

The warning value is a string like `/apps/bcbsmgeneral/components/content/container`. A raw string literal inside `data-sly-test` is always truthy (non-empty string), so the condition is meaningless.

### Diagnosis

The author almost always **meant** to compare a variable against that string. Common cases:

| Intent | Variable to compare |
|--------|---------------------|
| Check current resource type | `resource.resourceType` |
| Check a child resource type | `childResource.resourceType` |
| Check a property value | `properties.someProperty` |
| Check a `data-sly-resource` path | a variable holding the resource type |

### Before (warns)

```html
<!-- Always truthy — the string itself is the test -->
<div data-sly-test="${'/apps/bcbsmgeneral/components/content/container'}">
    ...
</div>
```

### After (clean)

Determine **what variable** should be compared. The most common fix:

```html
<!-- Compare resource type (strip /apps/ prefix for sling:resourceType) -->
<div data-sly-test="${resource.resourceType == 'bcbsmgeneral/components/content/container'}">
    ...
</div>
```

Or if the path was being passed to `data-sly-resource`:

```html
<!-- The test was guarding a data-sly-resource include -->
<sly data-sly-set.containerType="${'bcbsmgeneral/components/content/container'}"/>
<div data-sly-test="${containerType}"
     data-sly-resource="${resource @ resourceType=containerType}">
</div>
```

### Rules

- **Never** leave a raw string as the sole `data-sly-test` value
- Strip the `/apps/` prefix when comparing against `resource.resourceType` (Sling stores relative resource types)
- If you cannot determine the intended variable, wrap in `data-sly-set` and add a `TODO` comment:

```html
<!-- TODO: verify the correct variable for this comparison -->
<sly data-sly-set.expectedType="${'bcbsmgeneral/components/content/container'}"/>
<div data-sly-test="${resource.resourceType == expectedType}">
```

### Nested resource iteration

When iterating child resources (e.g. `data-sly-list`), the comparison often belongs on the child:

```html
<!-- Before (warns — raw path string) -->
<sly data-sly-list.child="${resource.children}">
    <div data-sly-test="${'/apps/bcbsmgeneral/components/content/container'}">
        <sly data-sly-resource="${child}"/>
    </div>
</sly>

<!-- After -->
<sly data-sly-list.child="${resource.children}">
    <div data-sly-test="${child.resourceType == 'bcbsmgeneral/components/content/container'}">
        <sly data-sly-resource="${child}"/>
    </div>
</sly>
```

---

## Pattern 3: Numeric Constant Comparison

### What the linter flags

The warning value is a number like `1` or `2`. HTL's linter flags numeric literals in comparisons even when the logic is correct.

### Before (warns)

```html
<div data-sly-test="${properties.columnCount == 1}">one column</div>
<div data-sly-test="${properties.columnCount == 2}">two columns</div>
```

### After (clean)

Extract the comparison into a `data-sly-set` variable:

```html
<sly data-sly-set.isOneColumn="${properties.columnCount == 1}"/>
<sly data-sly-set.isTwoColumn="${properties.columnCount == 2}"/>

<div data-sly-test="${isOneColumn}">one column</div>
<div data-sly-test="${isTwoColumn}">two columns</div>
```

### Rules

- Move the numeric comparison into `data-sly-set` so `data-sly-test` only sees a boolean variable
- Choose descriptive variable names (`isOneColumn`, `isTypeTwo`, etc.)
- Place `data-sly-set` on a `<sly>` element **before** the element that uses `data-sly-test`
- If many numeric comparisons exist (e.g. a switch-like block), group all `data-sly-set` declarations together at the top

### Alternative: Use a Sling Model

For complex switch logic, expose a method from the model:

```java
public boolean isOneColumn() {
    return getColumnCount() == 1;
}
```

```html
<div data-sly-test="${model.oneColumn}">one column</div>
```

---

## Pattern 4: Split-Expression Logical OR/AND

### What the linter flags

The warning value is something like `${properties.videoUrl} || ${properties.videoUrl1}`. HTL does **not** support `||` or `&&` operators **across** separate `${}` expression blocks.

When you write:

```html
<div data-sly-test="${properties.videoUrl} || ${properties.videoUrl1}">
```

HTL evaluates `${properties.videoUrl}` as one expression and treats the literal string ` || ` and `${properties.videoUrl1}` as separate tokens. The result is unpredictable and always flagged.

### Before (warns)

```html
<div data-sly-test="${properties.videoUrl} || ${properties.videoUrl1}">
    video content
</div>
```

### After (clean)

Combine into a **single** `${}` block:

```html
<sly data-sly-set.hasVideo="${properties.videoUrl || properties.videoUrl1}"/>
<div data-sly-test="${hasVideo}">
    video content
</div>
```

Or inline if the expression is short:

```html
<div data-sly-test="${properties.videoUrl || properties.videoUrl1}">
    video content
</div>
```

### Rules

- **All** logical operators (`||`, `&&`, ternary `? :`) must be inside a **single** `${}` block
- If the combined expression is long, use `data-sly-set` for readability
- The same applies to `&&`:

```html
<!-- BAD -->
<div data-sly-test="${properties.a} && ${properties.b}">

<!-- GOOD -->
<div data-sly-test="${properties.a && properties.b}">
```

---

## Validation Checklist

After fixing all warnings in a file:

- [ ] **Build passes** — re-run `mvn clean install` and confirm no `redundant constant value comparison` warnings remain for this file
- [ ] **Logical intent preserved** — the element still shows/hides under the same conditions as before
- [ ] **No broken references** — if `data-sly-test.varName` was changed, all downstream `${varName}` references still work
- [ ] **No orphaned `data-sly-set`** — every `data-sly-set` variable is used by at least one `data-sly-test`
- [ ] **Authoring still works** — component dialog values still drive the correct rendering in author and publish mode

## Files That Cannot Be Auto-Fixed

Some warnings require **human judgment**:

- **Pattern 2** when the intended comparison variable is ambiguous (no obvious `resource.resourceType` or `properties.*` candidate)
- **Expressions inside `data-sly-include` or `data-sly-template`** — the scope of variables may differ
- **Third-party / ACS Commons overlays** — changing shared component HTL may break other sites on the same instance

Flag these to the user with a `TODO` comment and move on.
