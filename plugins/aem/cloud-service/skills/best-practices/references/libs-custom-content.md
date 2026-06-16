# Custom content under `/libs` on AEM as a Cloud Service

BPA pattern id: **`libsCustomContent`**.

Covers BPA findings flagged on JCR paths under `/libs` that are **not** part of the Adobe-shipped namespace and were installed by a customer package. On AEM as a Cloud Service `/libs` is read-only and Adobe-managed — any customer content there is wiped on upgrade. Volumes are small (~44 findings across the reference customer set, all severity *major*) but each finding is a real deployment risk.

Unlike the Java-class patterns in this skill, the `identifier` on these findings is a **JCR path** (e.g. `/libs/myco/components/foo`), not a class name.

---

## Why `/libs` is reserved

- `/libs` is an **Adobe namespace**. The CS deployment pipeline overwrites it on every upgrade with the AEM SDK contents.
- Customer-installed content under `/libs` does not survive a CS deployment — it is removed silently.
- The pre-Cloud Service "overlay under /apps" pattern is the supported way to extend Adobe-shipped behavior. Customer content goes under `/apps/<your-namespace>/...` and overlays Adobe equivalents path-for-path.
- Some legacy AEM 6.x projects installed shared libraries (clientlibs, components, configurations) directly under `/libs/<not-Adobe>` as a shortcut. That shortcut no longer works on CS.

> **Subtype string note:** the BPA CSV column `subtype` carries `custom.content.libs` for these findings (best-practices/migration scripts wire to that exact string). If your BPA report uses a different subtype, update [`bpa-local-parser.js`](../../migration/scripts/bpa-local-parser.js) and [`unified-collection-reader.js`](../../migration/scripts/unified-collection-reader.js).

---

## Adobe-owned `/libs` subtrees

If a flagged path starts with one of these, it is **Adobe-owned** and should be reported as an installation error (something is overlaying or shadowing Adobe content). Do **not** "fix" by relocating — investigate the source package:

`/libs/granite/**`, `/libs/sling/**`, `/libs/cq/**`, `/libs/dam/**`, `/libs/wcm/**`, `/libs/foundation/**`, `/libs/clientlibs/granite/**`, `/libs/social/**`, `/libs/screens/**`, `/libs/mcm/**`, `/libs/commerce/**`.

Everything else (`/libs/<customer-namespace>/...`) is the actual subject of this pattern.

---

## Classification

For each flagged path, ask:

1. **Is there an Adobe path with the same suffix?** e.g. flagged `/libs/myco/foundation/components/page/page.html` and there exists `/libs/foundation/components/page/page.html` → this was a legacy overlay attempt. Relocate to `/apps` (step L1).
2. **Is the path purely custom** (no Adobe sibling at the equivalent name)? → it was misfiled custom content. Move to `/apps/<your-namespace>/...` (step L2).
3. **Is the content referenced anywhere?** Search the codebase for the flagged path. If nothing references it, it may be dead — propose deletion (step L3) before relocation.
4. **Is the content a clientlib?** Clientlibs under `/libs/<custom>/clientlibs/...` follow the same rules but require extra attention to `categories` and `dependencies` references (step L4).

---

## Transformation steps

### L1 — Relocate to `/apps` overlay (when an Adobe sibling exists)

This was a legacy "overlay" installed at the wrong root. The supported pattern is to mirror the Adobe path under `/apps`:

```
BEFORE (in ui.apps):
  jcr_root/libs/foundation/components/page/page.html         (customer file)

AFTER:
  jcr_root/apps/foundation/components/page/page.html         (same file, same JCR name)
  + Sling resolver automatically overlays /libs/foundation/components/page/page.html
```

Rules:
- The **path under `/apps` mirrors the Adobe path under `/libs`** — same node names, same depth. Sling's resource resolution prefers `/apps` over `/libs`.
- Do **not** rename the leaf nodes (`page`, `page.html`, etc.). The overlay only works when the names match.
- Update the **`filter.xml`** in `ui.apps`: remove the `<filter root="/libs/..."/>` and add `<filter root="/apps/..."/>`.
- Move the corresponding source files in `ui.apps/src/main/content/jcr_root/libs/.../` → `ui.apps/src/main/content/jcr_root/apps/.../`.
- If there were `.content.xml` files at each node level, move them with the directory.

### L2 — Relocate to `/apps/<your-namespace>` (when the content is purely custom)

```
BEFORE:
  jcr_root/libs/myco/components/foo/.content.xml

AFTER:
  jcr_root/apps/myco/components/foo/.content.xml
```

Rules:
- Pick a stable namespace under `/apps` — usually `apps/<bundle-or-product-name>/...`. If `/apps/myco` already exists, merge into it.
- Update **every reference** to the old path:
  - HTL `data-sly-resource="..."` and `data-sly-include="..."`
  - `sling:resourceType` property values across content
  - Servlet `@SlingServletResourceTypes` and similar annotations
  - Component dialog `sling:resourceType` includes
  - Any hard-coded `/libs/myco/...` strings in Java
  - Clientlib `categories` and `dependencies` arrays
- Update **`filter.xml`** roots.
- After the move, re-run BPA against the same project to confirm the finding cleared.

### L3 — Delete when the content is dead

If a `find` / `rg` for the flagged path across the entire customer codebase (Java, HTL, JS, JSON, content XML) returns zero references, propose deletion to the user instead of relocation:

```bash
# from the project root
rg --fixed-strings '/libs/myco/components/foo' --type-add 'aem:*.{java,html,js,json,xml}' -t aem
```

Rules:
- **Always show the user the rg output (or its emptiness) before proposing deletion** — do not auto-delete.
- Remove the directory from `ui.apps/src/main/content/jcr_root/libs/...` and the corresponding entry from `filter.xml`.

### L4 — Clientlibs under `/libs/<custom>/clientlibs/...`

Clientlibs follow the same relocation rules with two extra steps:

1. **Update the clientlib's `categories` property** if any categories embed the old path (rare but seen in legacy code).
2. **Update `dependencies` arrays** in *other* clientlibs that referenced the old category-only name (no path change needed if dependencies use category names, which is the recommended form).
3. **Recompile JS/CSS** through `mvn clean install` and confirm `/etc.clientlibs/...` URLs serve the expected content.

---

## Repository structure prerequisite

For all three relocation steps to land in the right Maven module, the project's `ui.apps` vs `ui.content` split must already match the AEM Cloud Service convention (immutable code under `ui.apps`, mutable content under `ui.content`). If the project is still on the legacy single-package layout, the larger restructure (BPA finding type **Unsupported repo structure** → handled by the Adobe Repository Modernizer) should be completed first. See **Wall ②, Unsupported repo structure** in the migration skill.

---

## Validation checklist

- [ ] No remaining `<filter root="/libs/<custom>/..."/>` entries in `ui.apps/src/main/content/META-INF/vault/filter.xml`.
- [ ] No remaining `jcr_root/libs/<custom>/` directories in `ui.apps` source.
- [ ] `rg --fixed-strings '/libs/<old-path>'` across the project returns zero hits, OR all remaining hits have been deliberately updated to the new `/apps` path.
- [ ] `sling:resourceType` references are updated to the new `/apps/<namespace>/...` resource types.
- [ ] Clientlib `categories` / `dependencies` resolve (no missing-category warnings in the AEM SDK log).
- [ ] `mvn clean install` passes; **aemanalyser** reports no `/libs/<custom>` findings.
- [ ] After deploying to a local AEM SDK quickstart, the affected components render correctly (overlay case: same look-and-feel as before; relocated case: the page that used the resource still renders).

---

## See also

- [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) — repo structure, service-user resolvers.
- [`../SKILL.md`](../SKILL.md) — pattern index.
- AEM as a Cloud Service docs: *Repository Restructuring* — for the wider `ui.apps` / `ui.content` / `all` package split.
