# Codified context — `.aem/context/*`

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference defines the schemas, discovery rules, and stability rules for
every file under `.aem/context/`. The skill targets **AEM as a Cloud
Service only**; non-Cloud-Service layouts trigger the early-exit notice
documented in [`SKILL.md`](../SKILL.md) § Scope.

## 1. Discovery scope

All filesystem walks are performed by the deterministic helper's `walk`
operation (see [`helpers.md`](./helpers.md) § 2.3) which enforces the
realpath / deny-list / special-filesystem / depth / file-count rules
documented in [`privacy-and-sanitization.md`](./privacy-and-sanitization.md)
§ 1.

- **Components.** Walk `**/src/main/content/jcr_root/apps/**/components/**`
  in every FileVault content-package module (typically `ui.apps`, optionally
  `ui.apps.*` siblings). Do **not** index Core Components or anything under
  `/libs`. Key by full JCR path (e.g. `/apps/wknd/components/byline`) so
  duplicates across component groups stay distinguishable.
- **Sling Models, OSGi services, Sling Servlets.** Walk every module
  containing `src/main/java/**`. The walk prunes `target/`,
  `generated-sources/`, `out/`, `build/`, `node_modules/` at every depth
  regardless of root (the helper enforces this as part of its segment-
  by-segment deny-list).
- **Multiple HTL files per component.** Index the primary HTL file
  (`<componentname>.html` matching directory name) under `htlPath`. List
  others under `siblingHtmlFiles` as repo-relative POSIX paths, sorted
  ascending by `sort()`. Empty array when there are none.
- **Dialogs.** Index both `cq:dialog` and `cq:editConfig` when present.
- **Multi-adaptable Sling Models.** Include every adaptable in the entry.
- **Multi-impl services.** Each impl is its own entry; entries include
  `siblingImpls` (count of other impls of the same interface).
- **Symlinks.** Walk by logical path, then resolve via the helper's
  `realpath` operation, which performs realpath check (canonical),
  workspace-escape rejection (against the workspace root resolved once
  at startup), deny-list rejection on every path segment, special-
  filesystem rejection (`/proc`, `/sys`, `/dev`, Windows device paths,
  UNC roots), visited-set loop guard, `O_NOFOLLOW` open with TOCTOU
  re-check after open. Deduplication uses realpath. Hard depth cap: 32
  directories from the workspace root. Full rules in
  [`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 1.2.
- **File-walk caps.** Global: 100,000 files per workspace. Per-immediate-
  child-of-root: 10,000 files (prevents a single subtree from starving
  the global budget). On overflow, set `truncated: true` at the top
  level of every index file that would otherwise have been written
  (`components.json`, `osgi-services.json`), append a `warningStubs`
  entry naming every truncated subtree (the helper returns these in
  `truncatedSubtrees`), and do **not** declare the indexes
  authoritative — downstream slash commands (`/new-component`,
  `/new-sling-model`) refuse to proceed on a `truncated: true` index
  until the customer either narrows the workspace or raises the cap
  through `.aem/agentkit-overrides.yml`
  (see [`manifest.md`](./manifest.md) § Overrides). Silent half-completion
  is the failure mode being blocked.
- **Declared-but-missing modules.** When `per-module-agents-md.md` step 1
  detects a `<module>` declared in `pom.xml` whose directory is missing,
  the same `warningStubs` entry (`"declared module <name> has no
  directory; skipped"`) is added to every workspace-root index in
  addition to the per-module warning. For a workspace that produces no
  `components.json` or `osgi-services.json` entry at all (dispatcher-only
  or content-only repos), the warning lands in `components.json`'s
  `warningStubs` regardless — `components.json` always exists for every
  run, so every warning has a stable destination.
- **Off-limits (privacy deny-list).** See [SKILL.md](../SKILL.md) §
  "What this skill never does" and
  [`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 1.
  The off-limits list is the source of truth — this file does not
  duplicate it.
- **Zero-X sanity.** If a `ui.apps` module exists but discovery returns
  zero components, treat as discovery error: emit a clear warning and
  do **not** overwrite an existing `components.json`. Same rule for
  `core/` with zero Java files.
- **Multi-module repos.** Discover from each module that exists. Repo
  with no `ui.apps` (decoupled / EDS) → `components.json` is an empty list
  with a `warningStubs` entry noting the layout.
- **Pom heuristic robustness.** When a Sling Model is annotated in a way
  the heuristic does not recognise (custom annotation processor, Lombok
  with no Sling-model marker, mixin imports), emit a `warningStubs`
  entry naming the file and do not infer. Do not guess.

## 2. Output stability

- JSON: 2-space indent, sorted keys at every level, LF line endings, final
  newline, UTF-8 no BOM. The on-disk byte sequence and the canonical-body
  sequence used for the marker checksum differ in exactly one respect: the
  on-disk file includes `_generatedBy`, `_skillVersion`, `schemaVersion`,
  `_markerChecksum`, `generatedAt`, and `_static` (when applicable). The
  helper's `sha256-canonical` operation (see
  [`helpers.md`](./helpers.md) § 2.4) strips those six keys before hashing,
  so two runs that change only `generatedAt` produce identical marker
  checksums and the file is left untouched on disk (no `mtime` churn,
  no `.agentkit-new` noise).
- Markdown: LF line endings, final newline, UTF-8 no BOM, no trailing
  whitespace.
- `generatedAt` uses the format `YYYY-MM-DDTHH:MM:SSZ` exactly. Renderers
  must emit a zero-padded, second-resolution UTC timestamp with the literal
  `T` and `Z` separators (no millisecond suffix, no `+00:00`). Excluded
  from the marker checksum so re-runs with no content change leave the
  file alone.
- Discovery enumerates with `sort()` on POSIX paths before processing.
- **Determinism tiebreaker.** Follows [SKILL.md](../SKILL.md) § Rules
  "Determinism tiebreaker": path ascending, then line number ascending,
  then **pre-sanitization** value ascending (byte order over UTF-8
  NFC-normalized bytes), then SHA-256 of the pre-sanitization value
  ascending. Four levels of tiebreak so post-sanitization truncation
  collisions still resolve deterministically. Single source of truth.
- **Sanitisation.** Customer strings baked into Markdown follow the
  exhaustive code-point list in
  [`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 2.1
  and are run through the helper's `sanitize-string` operation. Single
  source of truth.

## 3. `components.json`

```json
{
  "_generatedBy": "aem-agentkit",
  "_markerChecksum": "<sha256>",
  "_skillVersion": "1.0.0-beta",
  "components": [
    {
      "componentGroup": "WKND - Content",
      "dialogFieldNames": ["name", "occupations"],
      "dialogPath": "ui.apps/src/main/content/jcr_root/apps/wknd/components/byline/_cq_dialog/.content.xml",
      "editConfigPath": null,
      "htlPath": "ui.apps/src/main/content/jcr_root/apps/wknd/components/byline/byline.html",
      "jcrPath": "/apps/wknd/components/byline",
      "resourceType": "wknd/components/byline",
      "siblingHtmlFiles": [],
      "slingModelFqcn": "com.adobe.aem.guides.wknd.core.models.Byline",
      "title": "Byline"
    }
  ],
  "generatedAt": "2026-06-04T11:30:53Z",
  "schemaVersion": "1",
  "warningStubs": []
}
```

Notes:
- `slingModelFqcn` is the interface (not impl) when both exist.
- `dialogFieldNames` is best-effort: extract `name="./<field>"` attributes
  from `cq:dialog`'s `.content.xml`.
- `siblingHtmlFiles` is a `sort()`-ordered list of workspace-relative
  POSIX paths to non-primary HTL files in the same component directory
  (e.g. `partials.html`, `meta.html`). The primary HTL goes under
  `htlPath` so consumers never have to disambiguate.

## 4. `osgi-services.json`

```json
{
  "_generatedBy": "aem-agentkit",
  "_markerChecksum": "<sha256>",
  "_skillVersion": "1.0.0-beta",
  "generatedAt": "2026-06-04T11:30:53Z",
  "schemaVersion": "1",
  "services": [
    {
      "configPids": [],
      "dsAnnotationsPackage": "org.osgi.service.component.annotations",
      "dsGeneration": "R7",
      "implFqcn": "com.adobe.aem.guides.wknd.core.services.impl.SomeServiceImpl",
      "implPath": "core/src/main/java/com/adobe/aem/guides/wknd/core/services/impl/SomeServiceImpl.java",
      "interfaceFqcn": "com.adobe.aem.guides.wknd.core.services.SomeService",
      "references": [
        {"interface": "org.apache.sling.api.resource.ResourceResolverFactory", "name": "resourceResolverFactory"}
      ],
      "siblingImpls": 0
    }
  ],
  "servlets": [
    {
      "implFqcn": "com.adobe.aem.guides.wknd.core.servlets.PermissionCheckServlet",
      "implPath": "core/src/main/java/com/adobe/aem/guides/wknd/core/servlets/PermissionCheckServlet.java",
      "registration": {
        "sling.servlet.methods": ["GET"],
        "sling.servlet.paths": ["/bin/wknd/permission-check"],
        "sling.servlet.resourceTypes": []
      }
    }
  ],
  "slingModels": [
    {
      "adaptables": ["org.apache.sling.api.SlingHttpServletRequest"],
      "modelFqcn": "com.adobe.aem.guides.wknd.core.models.Byline",
      "modelImplFqcn": "com.adobe.aem.guides.wknd.core.models.impl.BylineImpl",
      "modelPath": "core/src/main/java/com/adobe/aem/guides/wknd/core/models/impl/BylineImpl.java",
      "resourceType": "wknd/components/byline"
    }
  ],
  "warningStubs": []
}
```

DS generation detection:
- `org.osgi.service.component.annotations` → `R7`
- `org.apache.felix.scr.annotations` → `R6`
- Both in the same impl → `MIXED`. The entry's `dsGeneration` is set to
  `MIXED` (not silently downgraded to `R6`), a `warningStubs` entry is
  emitted, and `/new-sling-model` refuses to edit a `MIXED` file until
  the customer resolves the mix. The `sling-model-author` role checks
  for `MIXED` before writing and surfaces the mismatch.

## 5. `conventions.md`

Sections (each cites ≥ 3 evidence pointers, otherwise becomes a TODO):

1. Package naming
2. Sling Model annotation style
3. OSGi DS annotation style
4. HTL naming
5. Logging style
6. Dispatcher includes
7. Build / verify commands (derived from Maven wrapper detection and
   `.cloudmanager/java-version`)

Evidence-pointer format: `<repo-relative-posix-path>:<1-based-line>`.

Soft size limit: 80 lines. Hard: 150. If derived rules exceed the budget,
truncate per-rule evidence to 3 pointers and append a TODO pointing at
`.aem/context/components.json` / `osgi-services.json` for the full sample
set.

## 6. `avoid.md`

Detected anti-patterns. Each entry has:
- Pattern name and one-line description.
- Where it was found (evidence pointer).
- An **absolute documentation URL** under
  `https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/`
  or `https://developer.adobe.com/experience-manager/reference-materials/cloud-service/`
  pointing to the supported pattern. The link is a real URL, not a
  relative pointer to another skill — `.aem/context/avoid.md` is
  consumed by agents that may never have the `best-practices` skill
  installed at any specific relative path, so absolute URLs are the
  only durable form.

Detection signals (initial set):

| Pattern | Signal | Replacement URL category |
|---|---|---|
| `Scheduler` + `Runnable` | imports `org.apache.sling.commons.scheduler.Scheduler` + `Runnable` in same class | Sling Jobs (`org.apache.sling.event.jobs`) |
| JCR observation `EventListener` | implements `javax.jcr.observation.EventListener` | `ResourceChangeListener` |
| OSGi `EventHandler` (substantive) | implements `org.osgi.service.event.EventHandler` with non-trivial body | Sling Jobs / `ResourceChangeListener` |
| Direct `Replicator` call | uses `com.day.cq.replication.Replicator` | Distribution API on Cloud Service |
| Legacy `AssetManager` create/remove | uses deprecated `com.day.cq.dam.api.AssetManager` ops | Asset API on Cloud Service |
| `getAdministrativeResourceResolver` | direct call | Service User Mapping |
| Felix SCR annotations | `org.apache.felix.scr.annotations` import | DS R7 annotations |
| HTL redundant constant comparison | `data-sly-test` containing `== 'something'` or `=== 'something'` | HTL conventions on Cloud Service |

For each match, embed the absolute URL inline next to the evidence
pointer. The `aem-agentkit-helper` ships a fixed URL table per category
so the rendered URLs are byte-identical across runs.

Soft: 60 lines. Hard: 120.

## 7. `glossary.md`

Domain disambiguation only. Extracted terms:
- Component `cq:title` values from `.content.xml` under
  `ui.apps/.../components/**/.content.xml`.
- Content Fragment model titles from
  `/conf/*/settings/dam/cfm/models/**/.content.xml`.
- Taxonomy node names from `ui.content/.../tags/**`.

Every extracted value passes the § 2 sanitisation rule (executed by
the helper). In addition, **PII heuristics** filter out values that
look like personal data. Heuristics are deterministic (no LLM
judgement); each is a regex applied to the post-sanitisation value:

- Email: `\b\S+@\S+\.\S+\b`
- Phone-shaped: `\b\+?\d[\d\s().\-]{6,}\b`
- IPv4: `\b(?:\d{1,3}\.){3}\d{1,3}\b`
- IPv6 (rough): `\b[0-9a-fA-F:]{8,}:[0-9a-fA-F:]{2,}\b`
- IBAN-shaped: `\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b`
- Postal-address fragment: `\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Drive|Dr)\b`
- Employee / badge ID: `\b[A-Z]{2,5}-?\d{4,8}\b`
- High-entropy token: any token with `>= 8` ASCII digits in a row, or
  `>= 12` alphanumeric chars where digit-count is `>= 4`.
- Provider-prefixed tokens: `\bAKIA[A-Z0-9]{12,}\b`, `\bASIA[A-Z0-9]{12,}\b`, `\bghp_[A-Za-z0-9]{20,}\b`, `\bgho_[A-Za-z0-9]{20,}\b`, `\bghs_[A-Za-z0-9]{20,}\b`, `\bxox[abopr]-[A-Za-z0-9-]{10,}\b`, `\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b`, `\bpat_[A-Za-z0-9]{20,}\b`, `\bAIza[A-Za-z0-9_-]{20,}\b`, `\bEAAC[A-Za-z0-9]{20,}\b`.
- JWT: `\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`.
- Base64 blob: `\b[A-Za-z0-9+/]{40,}={0,2}\b` (no whitespace; conservative
  ≥ 40 chars to avoid catching plain words).
- Internal-domain URL: `https?://[^/\s]*\.(?:corp|internal|intranet)\b`.

Any value that matches **any** of the above produces a TODO marker; the
raw value is never written. Trade-off: this set will over-match on some
benign domain terms (e.g. internal product names that look like IDs).
The customer reviews TODO markers manually. The full regex set is the
authoritative input to the helper's PII pass.

Soft: 60. Hard: 120.

## 8. `test-patterns.md`

How this project writes tests. Derive from existing test sources:
- Test framework (JUnit 4 vs JUnit 5).
- AemContext usage (`io.wcm.testing.mock.aem.junit5.AemContextExtension`
  vs `SlingContextRule`).
- Mocking (Mockito vs other).
- Integration test client (`org.apache.sling.testing.clients`).

Each derivation cites ≥ 2 evidence pointers (tests are usually uniform so
fewer samples are needed).

Soft: 60. Hard: 120.

## 9. `aem-api-namespaces.md`

Static reference of canonical AEM as a Cloud Service API package roots
(`com.adobe.aem.*`, `com.adobe.cq.*`, `com.adobe.granite.*`,
`com.day.cq.*`, `org.apache.sling.*`, `org.osgi.service.component.annotations.*`,
SLF4J, JCR, etc.). Used by the "verify before import" guardrail so the
agent can sanity-check imports against a static list before fabricating
class names. Complements (does not replace) live Javadoc lookup.

Rendered from [`templates/aem-api-namespaces.md.template`](./templates/aem-api-namespaces.md.template).
The template is project-agnostic, so the rendered file is byte-identical
across repos and carries `_static: true` in its marker — eligible for
in-place overwrite on a skill version bump (see
[`upgrade-and-migration.md`](./upgrade-and-migration.md) § Static-
reference handling).

## 10. `README.md` (context index)

Plain Markdown pointing at the indexes and the derived files. No
evidence pointers; just a navigation aid for humans. Also a static-
reference file (`_static: true`).

## 11. Per-sub-project scope (nested AEM monorepos) — mandatory

When the workspace contains one or more nested AEM projects (detected
per [`per-module-agents-md.md`](./per-module-agents-md.md) § 1 and
recorded in `heuristics[]` as `decision: module-shape,
value: nested-aem-project`), the skill **MUST** also write a scoped
`.aem/context/` at each sub-project root. This is step 9 of the
[`SKILL.md`](../SKILL.md) generation order, and is **not optional**:
the self-validation pass after step 13 fails the run (exit `1`) if any
declared `nested-aem-project` entry is missing its scoped
`.aem/context/components.json` or `.aem/context/osgi-services.json`.

### What's in each per-sub-project `.aem/context/`

| File | Scoped content |
|---|---|
| `components.json` | Only components under `<sub-project>/ui.apps*/.../jcr_root/apps/<sub-project's apps namespace>/components/**` — that sub-project's own JCR component tree |
| `osgi-services.json` | Only Sling Models / OSGi services / Sling Servlets discovered under `<sub-project>/**/src/main/java/**` |
| `conventions.md` | Conventions derived from **that sub-project's** source files only; if conventions differ from the workspace-root file (e.g. one sub-project uses Felix SCR while the other has migrated to DS R7), the scoped copy is the source of truth for agents working in that sub-project |
| `avoid.md` | Anti-patterns detected in that sub-project's source files only |
| `glossary.md` | Domain terms extracted from that sub-project's `cq:title` / CF models / taxonomy only |
| `test-patterns.md` | Test conventions derived from that sub-project's `it.tests/` and `core/src/test/` only |

### What's NOT duplicated per sub-project

| File | Why workspace-root only |
|---|---|
| `aem-api-namespaces.md` | Project-agnostic static reference — same content across every repo and every sub-project |
| `README.md` (context index) | Project-agnostic static reference |
| `.agentkit-manifest.json` | Workspace-scoped record of the whole run; each per-sub-project file is listed with its `subprojectRoot` |
| `.agentkit.lock` | Workspace-scoped advisory lock |

### Discovery walk for per-sub-project context

Step 9 reuses the helper's `walk` op with `roots: ["<sub-project>"]` and
the standard caps (depth 32, 10k per-subtree, 100k global). The walk is
bounded to the sub-project's tree, so the scoped indexes never leak
content from sibling sub-projects.

Subagents and rules reference **whichever `.aem/context/` is closest to
the file under edit** — sub-project context when working inside a
sub-project, workspace-root context otherwise. Role bodies state this
explicitly so the agent resolves `<project>` and the path prefix at
runtime instead of relying on a hard-coded path.

## 12. Self-validation (this step only)

After writing all `.aem/context/*` files:
- Every evidence pointer resolves to an existing file (and line when given).
- Every `slingModelFqcn` in `components.json` resolves to an existing
  `.java` file.
- Every `implFqcn` in `osgi-services.json` resolves to an existing `.java` file.
- Every URL is Cloud-Service-scoped (no `/6.5/`, no
  `experience-manager-65/`).
- No file contains marketing language; framing stays factual.
- Every sanitized string in every generated Markdown is free of every
  strip-list code point (the helper re-scans).

On failure, the skill prints a one-line diagnostic naming the failing
file (workspace-relative path) and the failing check. Each individual
file write is atomic (helper `write-atomic`), so no file is left
half-written; but earlier successful writes within the `.aem/context/`
step set remain on disk. The next invocation resumes idempotently:
completed files match their checksum and are skipped; the failing file
is re-attempted. The customer can remove everything with the grep
helper in [`upgrade-and-migration.md`](./upgrade-and-migration.md)
§ Reversibility.
