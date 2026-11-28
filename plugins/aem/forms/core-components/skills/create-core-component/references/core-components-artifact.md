# Core Components Artifact — Source of Truth

This skill ships standalone and does **not** bundle component source. Whenever it needs
real component source, proxies, `README.md` files, the Java class hierarchy /
`FieldType` enum, or the "established patterns" it references, read them from the
published **AEM Forms Core Components Maven artifacts** (group `com.adobe.aem` on Maven
Central) — not a copied snapshot. Prefer a live checkout only if the user is running
against one.

## Choosing the version (ask, or default per platform)

**Always let the user specify the Forms Core Components version.** Treat it as an input
to gather up front (see the skill's Phase 1).

- **If the user gives a version**, use it verbatim.
- **If not**, resolve the **latest public GA** for the target AEM platform:
  - **AEM as a Cloud Service** → latest **`3.x.xxx`** line (e.g. `3.0.164`).
  - **AEM 6.5** → latest **`1.x.xx`** line (e.g. `1.1.80`).
- **If the target platform is also unknown**, ask (Cloud vs 6.5); default to Cloud
  (`3.x`) if the user has no preference.

Never hardcode a version and never pick a suffixed feature build (`-SNAPSHOT`, `-csp`,
`-ssv`, `-cloud` classifier, `-tablecomponent-N`, …) — only plain `MAJOR.MINOR.PATCH`.

```bash
# Latest GA for Cloud (3.x). Any core-forms-components-* artifact returns the same
# version; swap the artifactId for whichever module you fetch.
curl -s \
  https://repo1.maven.org/maven2/com/adobe/aem/core-forms-components-af-core/maven-metadata.xml \
  | grep -oE '<version>[^<]+</version>' | sed 's/<[^>]*>//g' \
  | grep -E '^3\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1

# Latest GA for AEM 6.5 (1.x): same command with the 1.x filter
#   ... | grep -E '^1\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1
```

Use the resolved value as `{coreComponentsVersion}` everywhere below.

## Relevant artifacts for this skill (fetch directly)

All share `groupId` `com.adobe.aem` and the same `{coreComponentsVersion}`:

| Need | Artifact | Contains |
|------|----------|----------|
| Java interfaces, abstract impls, `FieldType`, `FormConstants` | **`core-forms-components-af-core`** | `com/adobe/cq/forms/core/components/...` |
| Component definitions, HTL, `_cq_dialog`, clientlibs, `README.md`, `_cq_styleConfig`/`_cq_themeConfig` | **`core-forms-components-af-apps`** (content package `zip`) | `jcr_root/apps/core/fd/components/form/{component}/v{n}/{component}/…` |
| Example proxies / example content pages | **`core-forms-components-examples-apps`**, **`core-forms-components-examples-content`** | example components |
| Everything at once (convenience) | `core-forms-components-all` | all of the above bundled |

## Reading files from the artifacts

- **Component `README.md`** (authoritative JCR/dialog property list) and **HTL /
  dialog / clientlibs**: download `core-forms-components-af-apps` at
  `{coreComponentsVersion}`, unpack, and read
  `jcr_root/apps/core/fd/components/form/{component}/v{n}/{component}/README.md` (etc.).
- **Java hierarchy / `FieldType` / `FormConstants`**: download
  `core-forms-components-af-core` at `{coreComponentsVersion}` and read the sources/classes.
- **Or browse GitHub** at the matching tag:
  `https://github.com/adobe/aem-core-forms-components/tree/core-forms-components-reactor-{coreComponentsVersion}/ui.af.apps/src/main/content/jcr_root/apps/core/fd/components/form/{component}/v{n}/{component}/`
  (note the in-repo path is `ui.af.apps/src/main/content/jcr_root/...`, which maps to
  `jcr_root/...` inside the packaged artifact).

## When working inside a real checkout

If the user is actively running this skill against a local `aem-core-forms-components`
working copy, prefer that checkout's live files and pass its path via `--repo-root`.
The artifact rules above are the source of truth when no checkout is available.
