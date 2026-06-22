# Recipe — @Inject in Sling Models

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Input contract

Per invocation, a deduplicated list of repo-relative Java paths:

```json
{
  "files": [
    "core/src/main/java/com/example/core/models/HeroModel.java"
  ]
}
```

Sources:

1. **User-named** — the user names the Java file(s) directly.
2. **Discover** — the file list is the output of the **Discovery** scan in [`SKILL.md`](SKILL.md).

The decision table and skip-file policy apply identically in both sources.

## Decision table — replacement annotation per field

For each `@Inject`-annotated field in the file, inspect the field's declared Java type and pick a replacement:

| Field declared type | Replacement | Intent |
|---|---|---|
| `String`, `String[]`, `boolean`, `Boolean`, `int`, `Integer`, `long`, `Long`, `double`, `Double`, `float`, `Float`, `Calendar`, `Date` | `@ValueMapValue` | Read a property from the adapted resource's `ValueMap` |
| Any interface type **whose fully-qualified package starts with NONE of**: `org.apache.sling.api.*`, `org.apache.sling.models.*`, `javax.*`, `java.*`, `com.day.cq.*`, `com.adobe.cq.*`, `org.osgi.service.component.*` | `@OSGiService` | Inject an OSGi service reference |
| `org.apache.sling.api.resource.Resource`, `org.apache.sling.api.resource.ResourceResolver`, `org.apache.sling.api.SlingHttpServletRequest`, `org.apache.sling.api.SlingHttpServletResponse` | `@SlingObject` | Inject the Sling-provided object. **`@SlingObject`, not `@Self`** — these resolve correctly whether the model adapts from a request or a resource. `@Self` would try to adapt the adaptable *to* this type and returns `null` for request-adapted models (compiles fine, fails at runtime). |

**Any other type → trigger the skip-file policy below.** Do not guess. In particular `com.day.cq.wcm.api.Page` / `Component` and other `org.apache.sling.*` / `com.day.cq.*` types are **not** handled here — they typically need `@ScriptVariable` or adaptation, so they skip-file (see below). `@Self` (adapting the adaptable to another Sling Model) is also out of scope and skips.

The three supported annotations all live in `org.apache.sling.models.annotations.injectorspecific` — see imports.

## Companion annotations — deterministic transforms

If an `@Inject` field also carries any of the following, apply the per-companion transform during field rewrite. These are the only companion forms currently supported.

| Existing companion | Transform |
|---|---|
| `@Named("foo")` (`javax.inject.Named`) | Merge into the new annotation as the `name = "foo"` attribute. Drop `@Named` from the field. |
| `@Default(...)` (`org.apache.sling.models.annotations.Default`) | Keep unchanged; place alongside the new annotation. |
| `@Via("...")` (`org.apache.sling.models.annotations.Via`) | Keep unchanged; place alongside the new annotation. |
| `@Optional` (`org.apache.sling.models.annotations.Optional`, field-level) | Drop `@Optional` and add `injectionStrategy = InjectionStrategy.OPTIONAL` to **this field's** new injector-specific annotation (merge with any `name`/other attributes). Do **not** touch the class-level `@Model` — changing `defaultInjectionStrategy` would make *every* field optional and silently turn previously-required fields into `null`-injected ones. Per-field `injectionStrategy` preserves exact semantics. |

Any companion annotation not in this table → treat as an ambiguous field and trigger skip-file.

## Import management

After all field transforms are computed for a file — and before writing the file — update the imports:

1. **Add** (only for annotations actually used in the transformed file):
   - `org.apache.sling.models.annotations.injectorspecific.ValueMapValue`
   - `org.apache.sling.models.annotations.injectorspecific.OSGiService`
   - `org.apache.sling.models.annotations.injectorspecific.SlingObject`
2. **Add conditionally** — only if any field gained `injectionStrategy = InjectionStrategy.OPTIONAL`:
   - `org.apache.sling.models.annotations.injectorspecific.InjectionStrategy` (skip if already imported)
3. **Remove** (only if zero remaining usages in the file after the rewrite):
   - `javax.inject.Inject` — if no `@Inject` remains
   - `javax.inject.Named` — if no `@Named` remains
   - `org.apache.sling.models.annotations.Optional` — if no `@Optional` remains (field-level)

Alphabetize new imports within the existing import-block convention used by the file (most AEM projects order by package; maintain what's there).

## Unlocatable cases (skip-file policy)

If **any** `@Inject`-annotated field in the file fails to match a decision-table row, or carries a companion annotation not in the Companion Annotations table, **skip the entire file**. Do not apply partial migrations. Rationale: a half-migrated file where some `@Inject`s were replaced and others were not produces a diff the reviewer cannot efficiently distinguish from intentional mixed usage.

Common ambiguous cases that trigger skip-file:

- `List<X>`, `Collection<X>`, arrays of non-ValueMap types — likely `@ChildResource`, not currently supported
- `org.apache.sling.*` / `com.day.cq.*` types **other than** the four `@SlingObject` types in the decision table — e.g. `com.day.cq.wcm.api.Page`, `Component`, `Style`, or another Sling Model — these need `@ScriptVariable`, `@Self` (model-to-model) adaptation, or `@ChildResource` depending on the exact type; not currently disambiguated
- `@Inject` on constructor parameters or setter methods — not field injection
- Raw `Object` or generic type parameters (e.g. `T`)
- A field carrying a companion annotation outside the supported table (for example `@Source`)

When skip-file triggers, record the skip in the run's skip-report with reason:

```
inject-ambiguous-field: <relative-file-path> has @Inject on <fieldName> of type <fieldType> [with companion <annotation>] which does not match any decision-table rule
```

Continue with the remaining files; the entire skipped file is left untouched on disk.

## Per-file edit procedure

For each file in `findings[].files`:

1. Read the file.
2. Parse each field declaration that carries `@Inject`. For each field, consult the Decision Table and Companion Annotations sections and compute the replacement annotation and companion adjustments.
3. If any field in the file triggers skip-file, record the skip, move on to the next file. Do not write this file.
4. Otherwise, rewrite the field sites in memory — preserving leading whitespace, adjacent comments, and non-targeted annotations — then compute the import-block and `@Model` updates.
5. Write the file back.

After all files are processed, continue the Verify & summarize step in [`../references/runbook.md`](../references/runbook.md).

## Before / after example

A class mixing all three patterns, plus `@Optional` and `@Named`:

**Before** (`core/src/main/java/com/example/core/models/HeroModel.java`):

```java
package com.example.core.models;

import javax.inject.Inject;
import javax.inject.Named;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.Optional;

import com.example.core.services.ContentService;

@Model(adaptables = SlingHttpServletRequest.class)
public class HeroModel {

    @Inject
    private String title;

    @Inject
    @Named("cta-label")
    private String ctaLabel;

    @Inject
    @Optional
    private String subtitle;

    @Inject
    private ContentService contentService;

    @Inject
    private Resource resource;

    // ...
}
```

**After:**

```java
package com.example.core.models;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.InjectionStrategy;
import org.apache.sling.models.annotations.injectorspecific.OSGiService;
import org.apache.sling.models.annotations.injectorspecific.SlingObject;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import com.example.core.services.ContentService;

@Model(adaptables = SlingHttpServletRequest.class)
public class HeroModel {

    @ValueMapValue
    private String title;

    @ValueMapValue(name = "cta-label")
    private String ctaLabel;

    @ValueMapValue(injectionStrategy = InjectionStrategy.OPTIONAL)
    private String subtitle;

    @OSGiService
    private ContentService contentService;

    @SlingObject
    private Resource resource;

    // ...
}
```

What changed, in order:

- `javax.inject.Inject`, `javax.inject.Named`, and `org.apache.sling.models.annotations.Optional` imports removed (no remaining usages).
- Injector-specific imports added: `ValueMapValue`, `OSGiService`, `SlingObject`, and `InjectionStrategy` (for the optional field).
- `@Model` is **unchanged** — the optional field is handled per-field, so previously-required fields stay required.
- `@Named("cta-label")` was merged into `@ValueMapValue(name = "cta-label")`.
- `title` (`String`) → `@ValueMapValue`.
- `subtitle` (`String`, was `@Optional`) → `@ValueMapValue(injectionStrategy = InjectionStrategy.OPTIONAL)` — optional preserved on this field only.
- `contentService` (interface from an application package `com.example.core.services`) → `@OSGiService`.
- `resource` (`org.apache.sling.api.resource.Resource`) → `@SlingObject` — resolves for both request- and resource-adapted models (`@Self` would return `null` here).

## Editing strategy

Use a surgical text-level replace, not a source reformatter, to preserve the developer's exact formatting, comments, and import order.

Concretely, per field site:

1. Locate the annotation block immediately above the field declaration — this is the smallest run of `@Annotation[(...)]` lines that sit on consecutive lines ending at the field declaration line.
2. Replace that block with the transformed annotation block (one annotation per line, in this order: the injector-specific annotation first, then `@Default` if present, then `@Via` if present).
3. Preserve leading indentation (match the column of the field declaration).
4. Leave the field declaration line (type and name) unchanged.

Then, once all field sites in the file are rewritten:

5. Do **not** modify the class-level `@Model(...)` for `@Optional`; the optional field carries `injectionStrategy = InjectionStrategy.OPTIONAL` on its own annotation instead.
6. Update the imports block: remove unused imports from the "Remove" list; add required imports from the "Add" list, alphabetized within the existing grouping convention.

If at any point the transform for a field does not cleanly fit (e.g. the annotation block contains an unexpected companion, or the annotation/field block does not match the form described above — single-line annotations on consecutive lines ending at the field declaration), trigger skip-file for the whole file — per policy.
