# Transform rules (code-verified, minus the bugs)

**Agent:** This is the rule set `inspect_project.py`, `split_content.py`, `convert_osgi.py`, and `refactor_poms.py`
implement. It is distilled from the code-verified analysis of Adobe's CAM Repository Modernizer
(`cam-repo-modernizer-analysis.md`) — **minus its bugs**. Where this doc's rule differs from CAM's actual
behavior, that is intentional; see §9. Every concrete example below is verified against this skill's own
fixture, `aem-guides-wknd-legacy` (`groupId=com.adobe.aem.guides`, `appId=wknd`, `appTitle=WKND`), and
against the pinned archetype-56 templates this skill scaffolds from. Do not re-derive these rules from
first principles — implement exactly what's written here, and if a script's behavior needs to diverge,
update this file first.

## 1. Content routing — immutable vs. mutable

Route each **top-level folder name** directly under a content package's `jcr_root`:

| Top-level folder | Destination |
|---|---|
| `apps`, `libs`, `_oak_index` (filesystem escaping of the `oak:index` node) | `ui.apps` (immutable) |
| everything else — **including** `etc`, `content`, `conf`, `home` | `ui.content` (mutable) |

This is name-based on the **top-level folder only**, not a deep path analysis. Whole directories move as a unit.

**Fixture:** `oak-indexes/src/main/content/jcr_root/_oak_index/` → `ui.apps` (top-level folder `_oak_index`).
`ui.content/src/main/content/jcr_root/content/wknd/` → `ui.content` (top-level folder `content`).

## 2. Filter routing — by root prefix, not by source package

Route each source `<filter root>` by **prefix**, independent of which package it was declared in:

- Starts `/apps`, `/libs`, or `/oak:index` → **ui.apps** filter.
- Anything else → **ui.content** filter.

**Immutable (ui.apps-routed) filters keep only their `root` — `<include>`/`<exclude>` (and any `mode`
attribute) are stripped**, because application packages install before content and a root-level filter is
sufficient. Mutable (ui.content-routed) filters keep whatever include/exclude they had **and preserve the
source `<filter>`'s own `mode` attribute** (`update`/`merge`) verbatim — dropping `mode` would default the
root to `replace` on install and risk clobbering existing author content under `/content` or `/conf`. The
`mode` is emitted before `root` (`<filter mode="update" root="…"/>`), matching CAM's output.

**Content-resolution pruning (CAM parity).** A **bare** filter root (no `<include>`/`<exclude>`) that
resolves to **no content on disk** is dropped from the modernized filter — matching CAM, whose activity log
records *"Skipped the following filter paths as they could not be resolved to valid content"* (e.g.
acme-portal's `/apps/settings/wcm/designs/digital`, which the legacy filter declares but no `digital` node
backs). `split_content._filter_root_resolves_to_content` checks the **routed target module** (content was
already relocated by `move_content`) for the path as a directory, a `<leaf>.xml`/`_<leaf>.xml` docview file,
**or an inline child element in the parent's `.content.xml`** (so an inline-serialized node like an
`/oak:index/<name>` is never false-pruned). It is **safe by construction**: a root is pruned only when
nothing on disk backs it, so pruning removes coverage of nothing and can never drop real content; a root
carrying `<include>`/`<exclude>` (a deliberate customer narrowing) is always kept. This makes acme-portal's
`ui.apps` filter byte-identical to CAM's. (On globex the skill and CAM agree on all backed roots and on
pruning the content-less policy/tool roots; they differ on ONE content-less root — `.../nav/tools/
contentMigration`, which has zero backing anywhere, so the skill prunes it while CAM keeps it dangling —
a safe, cleaner divergence, never content loss.)

**Fixture — before** (`ui.apps/src/main/content/META-INF/vault/filter.xml`):
```xml
<filter root="/apps/wknd">
    <exclude pattern="/apps/wknd/install" />
    <include pattern="/apps/wknd/components/structure" />
    <include pattern="/apps/wknd/components/content" />
</filter>
```
**after** (modernized `ui.apps` filter):
```xml
<filter root="/apps/wknd"/>
```

**`/etc/...` is mutable even when the legacy project filed it under a `ui.apps` package.** The fixture's
*legacy* `ui.apps/filter.xml` literally contains `<filter root="/etc/designs/wknd"/>` right next to
`/apps/wknd` and `/apps/sling` — but because the root prefix is `/etc`, not `/apps`, this filter (and the
`jcr_root/etc/designs/wknd` content behind it) is routed to the **modernized `ui.content`**, not `ui.apps`.
Source-package placement never overrides the prefix rule.

The same fixture's `ui.apps/filter.xml` also has `<filter root="/libs/cq/core/content/nav/wknd"/>` — prefix
`/libs` → stays in the `ui.apps` filter. See §3 for why this one still gets flagged.

## 3. RM-107 — content under `/libs`

Content whose top-level `jcr_root` folder is `libs` is **moved to `ui.apps` like any other immutable
content** (§1) — it is not blocked or left in place — **but is also flagged**:

- Code: `RM-107` / `UNSUPPORTED_CONTENT_STRUCTURE`
- Priority: **CRITICAL**

**Fixture:** `ui.apps/src/main/content/jcr_root/libs/cq/core/content/nav/wknd/` triggers this — moved to the
modernized `ui.apps`, and a CRITICAL finding is recorded so the developer knows `/libs` authoring (a legacy
anti-pattern Cloud Service discourages) is present.

## 4. `ui.apps.structure` roots

`ui.apps.structure/pom.xml` declares the JCR repository roots the code packages deploy into. Its filter list
is **not** the ui.apps/ui.config filter roots themselves — it's every **ancestor path** of each one (leaf
segment dropped, then every remaining prefix down to depth 1), unioned, plus two fixed seeds:

- Always seed `/apps` and `/apps/<appId>`.
- For every `ui.apps` **and** `ui.config` filter root, add every proper prefix of that root (i.e. drop the
  last segment, then include that path and all of *its* ancestors up to `/<first-segment>`).
- If any resulting root starts `/oak:index`, add `<allowIndexDefinitions>true</allowIndexDefinitions>` to
  the plugin config.

Generic example: filter root `/apps/settings/wcm/designs/x` contributes `/apps`, `/apps/settings`,
`/apps/settings/wcm`, `/apps/settings/wcm/designs`.

**Fixture worked example.** Modernized filter roots feeding this step:
- `ui.apps`: `/apps/wknd`, `/apps/sling`, `/libs/cq/core/content/nav/wknd`, `/oak:index/damAssetLucene`,
  `/oak:index/wkndId` (the last two arrive via `oak-indexes`, routed to `ui.apps` per §2).
- `ui.config`: `/apps/wknd/osgiconfig` (the single fixed filter root the OSGi-segregation step adds).

Ancestor expansion + seeds yields exactly:
```
/apps
/apps/wknd
/libs
/libs/cq
/libs/cq/core
/libs/cq/core/content
/libs/cq/core/content/nav
/oak:index
```
Because `/oak:index` is present, `ui.apps.structure/pom.xml` also gets
`<allowIndexDefinitions>true</allowIndexDefinitions>`. The template ships this plugin's `<filters />` empty
(`template_archetype_56/ui.apps.structure/pom.xml`) — this step populates it.

Missing FileVault plugin block in the template is a hard failure, not a skip.

## 5. `packageType` and `cloudManagerTarget`

Both are **static values baked into the archetype-56 templates**, verified byte-for-byte in
`template_archetype_56/*/pom.xml` — no script computes them:

| Module | `packageType` | `cloudManagerTarget` |
|---|---|---|
| `all` | `container` | *(not declared)* |
| `ui.apps` | `application` | `none` |
| `ui.content` | `content` | `none` |
| `ui.config` | `container` | `none` |
| `ui.apps.structure` | *(not declared)* | `none` |

Note the asymmetry: `all` is the one module that declares `packageType` but **not** `cloudManagerTarget`;
`ui.apps.structure` is the one module that declares `cloudManagerTarget` but **not** `packageType`. If the
npm validator tool's docs say "`all` must declare `none`," that statement is about `cloudManagerTarget` on
the *sub*-packages `all` bundles, not about `all`'s own pom — don't let that phrasing make you add a
`cloudManagerTarget` to `all`'s FileVault config; the archetype deliberately omits it there.

**Fix round 1 (Task C3):** injecting this `<configuration>` alone is not sufficient for `ui.apps`/
`ui.content` — `repositoryStructurePackages` (`ui.apps`) and the inner package `<dependencies>`
(`ui.content`) both *reference* another package by coordinates, and the module must separately *declare*
a real top-level Maven `<dependency>` on that same package, or `filevault-package-maven-plugin:
validate-files` fails outright. See §11's "ui.apps/ui.content poms" steps 3–4 for the mechanics.

## 6. `uber-jar` → `aem-sdk-api`

There is no rewrite step. Two independent facts produce the swap:

1. **Drop:** any dependency matching `groupId=com.adobe.aem` + `artifactId=uber-jar` is removed from every
   copied bundle POM — matched on groupId+artifactId only; version/scope don't matter.
2. **Pre-seed:** `aem-sdk-api` is already in the archetype template — declared once with
   `scope=provided` in the parent's `<dependencyManagement>` (version `${aem.sdk.api}`), and as a bare
   `<dependency>` (no version/scope — inherited) in `core`, `ui.apps`, and `ui.content`.

**Fixture:** `core/pom.xml` declares `<dependency><groupId>com.adobe.aem</groupId><artifactId>uber-jar</artifactId></dependency>` — dropped on copy. The modernized `core/pom.xml` (from
`template_archetype_56/core/pom.xml`) already has `aem-sdk-api` waiting; nothing re-adds it.

Because the API surfaces of `uber-jar` and the pinned `aem-sdk-api` version differ, code that compiled
against `uber-jar` may not compile against `aem-sdk-api` — that's a real hand-off, not a bug; see
`manual-followups.md`.

## 7. `all` embedding

Two layers combine, both targeting `/apps/<appId>-packages/{application|content}/install`:

- **Static (from the template, unconditional):** `all/pom.xml` already embeds `ui.apps` and `ui.config`
  (type `zip`) at `.../application/install`, and `ui.content` (type `zip`) at `.../content/install`.
- **Dynamic (added by this skill, one per project bundle):** for every module classified as a **bundle**
  (not a test bundle, not a wrapper/misc module — see §8's scope note), add one `<embedded>` of type `jar`
  at `.../application/install`, artifact = that bundle's rewritten identity.

**Fixture:** `core` and `bundle2` (both `packaging=bundle`) each get an `<embedded>` entry
(`aem-guides-wknd.core`, `aem-guides-wknd.bundle2`) at `/apps/wknd-packages/application/install`, alongside
the template's static `ui.apps`/`ui.config` embeds. `ui.content` lands at `/apps/wknd-packages/content/install`.

If the legacy `all` already embedded 3rd-party artifacts directly (identified structurally by
`packageType=container` in its FileVault plugin, not by module name), those embeds carry over. **Fixture:**
the legacy `all/pom.xml` embeds `net.engio:mbassador` directly (no `<type>`, target
`/apps/wknd-packages/application/install`) — that embed and its `<dependency>` both carry over into the
modernized `all`.

## 8. Third-party dependency detection (RM-101)

A dependency is third-party — and gets flagged `RM-101` / `THIRD_PARTY_DEPENDENCIES`, **CRITICAL** — unless
**one of these exemptions** applies:

1. Its `groupId` starts with the project's own groupId (e.g. `com.adobe.aem.guides` in the fixture — this
   exempts the project's own inter-module dependencies, like a bundle depending on `aem-guides-wknd.core`).
2. Its `groupId` starts with a provided/framework prefix: **`com.adobe`, `com.day`, `org.osgi`, `javax`,
   `jakarta`, `org.slf4j`, `org.apache.felix`, `org.apache.sling`, `org.apache.jackrabbit`, `biz.aQute`**.
3. Its `scope` is `test` or `provided`.
4. Its `groupId` is a known test-library group: `junit`, `junit-addons`, `org.mockito`, `org.hamcrest`,
   `org.junit`, `org.testng`.

Scanned across **bundles + `ui.apps` + `all`** (a deliberate widening of CAM's original bundles-and-`ui.apps`-only
scan, specifically so a dependency embedded only in `all` — like `mbassador` — isn't missed).

**Correct the CAM blind spot — precisely, not by blanket exclusion.** CAM's actual matcher is a 4-entry
prefix list, `com.adobe`, `com.day`, `org.apache`, `org.osgi`, which treats *every* `org.apache.*` groupId
as AEM-provided. That's too broad. But the naive fix — dropping `org.apache` from the provided list
entirely — is too narrow in the other direction: AEM/Felix genuinely ships `org.apache.felix.*` and
`org.apache.sling.*`, and AEM's repository layer genuinely ships `org.apache.jackrabbit.*`, so treating
*nothing* under `org.apache` as provided would flag those framework artifacts as CRITICAL third-party on
every legacy bundle — pure noise, and exactly the false-positive flood that makes a report unusable.
Exemption 2 above names the specific AEM/Felix/Sling/Jackrabbit sub-namespaces that are genuinely provided.
Everything else under `org.apache.*` — including real third-party libraries that happen to live there — is
evaluated like any other groupId and flagged if it's genuinely third-party.

**Example — the corrected blind spot, hypothetically.** A legacy bundle vendoring `org.apache.poi:poi`
(Excel/Word file generation) or `org.apache.commons:commons-csv` would be silently waved through as
"provided" under CAM's blanket `org.apache` match. Neither `org.apache.poi` nor `org.apache.commons`
matches `org.apache.felix`/`org.apache.sling`/`org.apache.jackrabbit`, so under this skill's rule both are
evaluated on their merits and flagged `RM-101` if genuinely present and not test/provided-scoped.

**Fixture — ordinary correct flag:** `net.engio:mbassador` (declared + embedded directly in the legacy
`all/pom.xml`, §7) — not the project's groupId, not a provided prefix, not test/provided-scoped, not a
test-library group → flagged.

**Fixture — correctly NOT flagged, including one that looks like it shouldn't be:** `com.adobe.aem:aem-api`,
`com.day.cq.wcm:cq-wcm-taglib` (provided prefixes). `biz.aQute:bndlib` (a dependency of both `core` and
`bundle2`) looks like ordinary third-party build tooling at first glance, but the fixture's root reactor
pom pins it `<scope>provided</scope>` in `<dependencyManagement>` — exempt on scope *and* on the
`biz.aQute` prefix, so it must **not** be flagged.

## 9. Bugs we do NOT reproduce

CAM's source has several latent defects. This skill implements the corrected behavior in every case:

| # | CAM's actual (buggy) behavior | This skill's behavior |
|---|---|---|
| 1 | Builds JCR/filter paths with `File.separator` — OS-dependent; wrong on Windows. | Always builds JCR/filter paths with literal `/`, regardless of host OS. |
| 2 | The OSGi value formatters have real bugs: the array-value branch tests the whole de-bracketed string (not each element) and blindly strips characters; the scalar branch strips a fixed 2 leading + 1 trailing characters assuming a Felix-specific type prefix, which throws `StringIndexOutOfBounds` on short values. | `.cfg.json` value conversion is driven by the actual `{Type}` hint / bracket structure, not fixed-offset character stripping — no OOB on short values, no truncated array elements. |
| 3 | When a source project has no content packages or no bundles, CAM **deletes** the corresponding template modules outright (`ui.apps`/`ui.content`/`ui.config`/`ui.apps.structure`/`core`) — a destructive skip. | We simply never **create** a module the project doesn't need in the first place — nothing pre-exists to delete, and nothing already-scaffolded is destructively removed. |
| 4 | `FindingsReporter` has no `LOW` branch, so any finding assigned `LOW` priority (e.g. `NO_CONTENT_PACKAGE_FOUND`, `NO_BUNDLE_FOUND`) is silently swallowed and never appears in the report. | The `Finding` model supports `LOW` end-to-end; `LOW` findings are reported like any other priority, never dropped. |
| 5 | Third-party detection treats every `org.apache.*` groupId as AEM-provided by blanket prefix match (§8). | Only the specific sub-namespaces AEM/Felix/Sling/Jackrabbit actually ship — `org.apache.felix`, `org.apache.sling`, `org.apache.jackrabbit` — are provided. Every other `org.apache.*` groupId (e.g. `org.apache.poi`, `org.apache.commons`) is evaluated like any other groupId and flagged if genuinely third-party. |

## 10. OSGi `.cfg.json` value conversion (`convert_osgi.py`)

**Config-folder scan (relocation).** `move_and_convert` finds run-mode OSGi config folders (a directory
whose name starts `config`) at **any depth** beneath `apps/<app>/`, not just as a direct child — some real
projects nest them under an intermediate grouping directory (e.g. `apps/<app>/runmodes/config.dev/…`, as
the acme-portal project does) or per site/brand (e.g. `apps/das/<site>/config.prod/…`, as the multi-brand
globex project does), which a direct-children-only scan silently skips. To avoid mistaking a folder merely
*named* `config` for a run-mode folder, only a `config*` folder that actually holds a **recognized OSGi
config file** (`.cfg.json`/`.xml`/`.config`/`.cfg`, excluding its own `.content.xml`) qualifies — a
frontend clientlib's `.../styles/config/_constants.scss` (real: globex) matches no OSGi suffix and is
skipped, and any stray non-config file inside a genuine run-mode folder is left in place rather than
crashing the move. Each matched folder's files are relocated to `ui.config/…/apps/<appId>/osgiconfig/
<config-dir>/` — the intermediate grouping directory is dropped from the destination (matching CAM), and
any now-empty intermediate (e.g. `runmodes/`) is pruned. **Multi-app collisions (`RM-906`):** a multi-app
or multi-brand project routinely files the SAME PID under several app subtrees (e.g. globex's
`apps/globex/config` and `apps/brand-a/config`), which flatten to one `apps/<appId>/osgiconfig/<run-mode>/`
destination. Identical copies are **deduplicated** (NORMAL finding); a genuine conflicting redefinition of
the same PID+run-mode is left in place and surfaced **HIGH** — never silently overwritten (which is what
CAM's own copy-based move does). **Run-mode folder names are preserved verbatim** — a folder whose name is
not a valid AEMaaCS run mode (honored tokens: `author`/`publish`/`dev`/`stage`/`prod`; so `config.test`,
`config.preprod`, `config.qa`, `config.dev2`, … are invalid) is **flagged `RM-108`** (`flag_noncloud_
runmodes`) but relocated as-is. This is deliberate CAM parity: CAM is detect-only for run modes
(`cam-repo-modernizer-analysis.md` §11 — "no user-directed rename/merge"). Renaming/merging is NOT done
here because it is a real data-loss hazard — two conflicting run modes (e.g. `config.test` and
`config.preprod` holding different values for the same PID) cannot both collapse into one Cloud run mode
without silently dropping a value — and is a separate, human-directed concern (the standalone
`runmode-restructure` skill) outside this skill's "reproduce CAM's outcome" scope.

`convert_value` turns one raw `sling:OsgiConfig` XML attribute value, or one Felix `.config`/`.cfg`
`key=value` line's value, into its `.cfg.json` equivalent — the actual encoding rules, minus CAM's own
positional-stripping bug (§9 row 2):

- **`[...]` → array.** A value that starts with `[` and ends with `]` is a multi-value. Its interior is
  split on commas that are **not** escaped — a backslash-comma (`\,`) is a literal comma inside one
  element, not a separator — then each element is unescaped and has its own `{Type}` hint stripped.
  `[]` (empty interior) → the explicit empty array `[]`.
- **`{Type}` hint stripped, value NOT coerced.** A leading `{Word}` hint (`{Boolean}`, `{Long}`,
  `{String}`, …) — anchored so only a genuinely *leading* hint is stripped, never a coincidental
  `{...}` substring elsewhere — is dropped from a scalar or from each array element. The remaining text
  stays a JSON **string**: `{Boolean}true` → `"true"`, not the JSON boolean `true`. This mirrors CAM's
  own actual behavior, not a "helpful" type coercion.
- **Brace escaping.** `\{` → `{` and `\}` → `}` (braces are escaped in the source because an unescaped
  leading `{...}` looks like a type hint). Applied to every scalar and every array element.
- **Comma escaping is array-only.** `\,` → `,` is unescaped only while splitting an array's interior —
  it has no separate meaning on a bare scalar.
- **Repoinit stays `.xml`, unconverted.** A `sling:OsgiConfig` `.xml` file whose PID names (or factory-
  instantiates) Sling's `org.apache.sling.jcr.repoinit.RepositoryInitializer` service is relocated into
  `ui.config`'s `osgiconfig/<runmode>/` tree like any other config file, but is copied byte-for-byte
  under its **original `.xml` filename** — never parsed into `.cfg.json`. This is a deliberate skip
  (CAM's own conversion leaves repoinit alone too), recorded as an `RM-901` finding (§12) rather than
  silently dropped.
- **An existing `.cfg.json` is already in the target shape** and is copied through byte-for-byte,
  untouched — no re-parse, no re-serialization, no finding.

**Example.** Raw `[foo,bar\,baz]` → `["foo", "bar,baz"]` (the escaped comma inside the second element
survives the split, then gets unescaped). Raw `{Boolean}true` → `"true"` (string). Raw `\{literal\}` →
`"{literal}"`.

Filename → PID mapping is a fixed 4-suffix table checked longest/most-specific first — `.cfg.json`,
`.xml`, `.config`, `.cfg` — via literal `endswith`, never a generic "last dot" split (an OSGi PID is
itself dot-separated, e.g. `com.x.Foo`, so a naive extension split would mangle it).

## 11. POM refactor rules (`refactor_poms.py`)

Runs strictly after Phase-1 scaffolding + split (§1–§4) — for the reactor step specifically, the
load-bearing dependency is **Stage 4's content/filter split** (`split_content.py`), not Stage 5's OSGi
move: `refactor_reactor_pom`'s `has_oak_index` reads the *already-modernized* `ui.apps` filter, and it's
Stage 4 that merges `/oak:index` roots into that filter (§1 routes the top-level `_oak_index` folder to
`ui.apps`, and Stage 4 is what carries its filter root along). `convert_osgi.py` (Stage 5) never touches
`/oak:index` or `ui.apps`'s own `filter.xml` at all — it only ever reads/writes `ui.config`'s filter (§4)
— so it has no bearing on this decision (see the reactor row below).

**Bundle poms** — `refactor_bundle_pom`: drop `com.adobe.aem:uber-jar` (matched groupId+artifactId only,
same as §6). When the bundle was **scaffolded** from the archetype template, `aem-sdk-api` is already
pre-seeded (§6) and nothing is added. When the bundle **pre-exists** (edited in place, not overwritten from
the template — the common real-world case), nothing pre-seeds it, so `refactor_bundle_pom` adds a **bare
`com.adobe.aem:aem-sdk-api` `<dependency>`** (no version/scope — inherited from the reactor
`<dependencyManagement>` the reactor step swaps `uber-jar` → `aem-sdk-api` in); without it the bundle loses
its AEM API surface entirely. Idempotent — a bundle already declaring `aem-sdk-api` is untouched. The
module's `<parent><version>` (and its own `<version>`, if any) is aligned to the reactor version
(`_ensure_module_version_matches_reactor`, see the reactor row). If the legacy Felix
`maven-scr-plugin`/`maven-bundle-plugin` pair (matched by artifactId alone — there is no other well-known
groupId shipping a plugin with either name) is present anywhere in the pom (including inside a `<profile>`),
those plugins are **left untouched** and an `RM-902` finding (HIGH) is raised — porting a Felix
`<instructions>` block into a `bnd-maven-plugin` `<bnd>` block is a semantic rewrite, not mechanical
(`manual-followups.md` §1).

**`ui.apps`/`ui.content` poms — the content-package → filevault two-plugin pattern**
(`refactor_content_pom`): the archetype's own `ui.apps`/`ui.content` templates keep **both** plugins,
verified byte-for-byte against `assets/archetype-pom-templates/{ui.apps,ui.content}/pom.xml`, and this
skill reproduces exactly that shape rather than replacing one plugin with the other. First, two in-place
normalizations a real legacy content pom needs: **(a)** any `com.adobe.aem:uber-jar` `<dependency>` the
content pom declares is **dropped** (same matcher as the bundle rule; a real project's `ui.apps`/
`ui.content` can declare it, and after the reactor swaps `uber-jar` → `aem-sdk-api` in
`<dependencyManagement>` a lingering one has no managed version and fails POM processing — nothing is added
back, a content package compiles no Java); **(b)** the module's `<parent><version>` (and own `<version>`,
if any) is aligned to the reactor version (`_ensure_module_version_matches_reactor`). Then the two-plugin
reshape:

1. The legacy `com.day.jcr.vault:content-package-maven-plugin` is **reshaped in place** (same slot in
   `<plugins>`, never renamed or removed) down to just `<extensions>true</extensions>`. Its legacy
   `<configuration>` — `<filterSource>`, `<group>`, and the `<embeddeds>` that used to embed e.g. `core`
   at `/apps/<appId>/install` — is stripped; that stripping is what drops the legacy embed (Cloud
   Service embeds bundles in `all`, never in `ui.apps`). It is kept, bare, purely because
   `<packaging>content-package</packaging>` is a non-standard Maven packaging value with **no lifecycle
   mapping** unless *some* plugin declares `<extensions>true</extensions>` — without it, `mvn package`
   cannot build the module at all.
2. `org.apache.jackrabbit:filevault-package-maven-plugin` is **added as a separate `<plugin>`**, whose
   `<configuration>` (carrying `packageType`/`cloudManagerTarget`/`repositoryStructurePackages`, §5) is
   sourced **verbatim** from this module's own archetype template with only `{{groupId}}`/
   `{{artifactId}}`/`{{version}}` substituted — never hand-built.

```xml
<plugin>
  <groupId>com.day.jcr.vault</groupId>
  <artifactId>content-package-maven-plugin</artifactId>
  <extensions>true</extensions>
</plugin>
<plugin>
  <groupId>org.apache.jackrabbit</groupId>
  <artifactId>filevault-package-maven-plugin</artifactId>
  <configuration>
    <packageType>...</packageType>
    <!-- ... rest sourced verbatim from the archetype template ... -->
  </configuration>
</plugin>
```

3. **(Fix round 1 — Critical.)** The module's own top-level `<dependencies>` gets a `type=zip`
   `<dependency>` matching the package step 2's injected `<configuration>` references: `ui.apps` →
   `<parentArtifactId>.ui.apps.structure` (its own `<repositoryStructurePackages>` entry, §5); `ui.content`
   → `<parentArtifactId>.ui.apps` (its own inner `<configuration><dependencies>` package reference).
   Coordinates come from the identical `config["groupId"]`/`config["artifactId"]`/`config["version"]`
   substitution step 2 already uses, so the declared dependency and the config reference it satisfies can
   never drift apart from two independently-kept-in-sync literals. Without this step, the config is
   structurally present but semantically dangling — `filevault-package-maven-plugin:validate-files` fails
   outright with *"...was not found among the Maven dependencies of this project"* — verified by actually
   running `mvn` against the real wknd fixture before this fix existed. Merged into the module's own
   top-level `<dependencies>` (creating one first if the pom somehow lacks it entirely); idempotent — a
   second run adds nothing already present.
4. **(Fix round 1 — required for buildability. DELIBERATE CAM divergence.)** Any top-level `<dependency>`
   this module has on one of the project's OWN reactor **bundle** modules is **dropped** — coordinates come
   from `config["bundles"]`, the same source and `<parentArtifactId>.<bundle-dir>` naming `refactor_all_pom`
   already uses to embed those same bundles into `all` (see below). Neither archetype content template
   declares any dependency on a bundle module — Cloud Service embeds a project's bundle(s) into `all` only —
   and a lingering one is more than cosmetically wrong: it drags the bundle (and anything not-yet-modernized
   about it, e.g. the Felix→BND hand-off above) into ANY `-am` reactor build of this content module, which
   is exactly what made a scoped `mvn -pl ui.apps.structure,ui.config,ui.content,ui.apps -am clean package`
   build unreachable before this fix (it failed trying to compile the legacy `core` bundle on a modern JDK —
   a module that build should never have needed to touch). External provided dependencies (`aem-api`, `jcr`,
   `servlet-api`, `cq-wcm-taglib`, ...) are left untouched: none of them is ever one of `config["bundles"]`'s
   own computed artifactIds.

   **Note — this DIFFERS from CAM by design (verified against CAM source, `UiAppsPomHandler`/
   `UiContentPomHandler`).** CAM *copies* the customer's existing content-package pom and *merges* archetype
   elements into it, so it CARRIES OVER the legacy bundle `<dependency>` (and even re-adds project bundle
   deps). This skill instead produces the clean archetype-56 shape — whose ui.apps/ui.content templates have
   NO bundle dependency — so a content package never depends on a bundle. This is the same category as the
   skill's other deliberate corrections ("reproduce the CAM outcome *without its bugs*"): carrying a bundle
   dep into a content package is a legacy anti-pattern that breaks scoped `-am` builds, not a feature to
   preserve.

Legacy `autoInstallPackage`/`autoInstallPackagePublish` `<profile>`s that reference the now-bare legacy
plugin are removed outright (they exist solely to `install` against a legacy CRX package manager URL —
Cloud Service has no equivalent). If the package's own content has ACL authoring (a `_rep_policy.xml`
sidecar, or an inline `rep:ACL`/`rep:policy` reference), `<accessControlHandling>merge_preserve
</accessControlHandling>` is added to the filevault plugin's `<configuration>` and an `RM-903` finding
(NORMAL) is raised.

**`all` pom** (`refactor_all_pom`) — purely additive, never replaces the customer's own
`filevault-package-maven-plugin` configuration: ensures `<packageType>container</packageType>`, then adds
an `<embedded>` for `ui.config` and for every `config.bundles[]` entry at
`/apps/<appId>-packages/application/install` (types `zip`/`jar` respectively), de-duped by
(groupId, artifactId) against what's already embedded. Nothing pre-existing is ever removed; a
pre-existing 3rd-party `<embedded>` (groupId ≠ the project's own) that survives the refactor unchanged is
noted with an `RM-904` finding (NORMAL) — purely informational.

**Reactor/parent pom** (`refactor_reactor_pom`) — runs last, and is the one step whose own input depends
on already-modernized project state rather than just `config`:

- `uber-jar` → `aem-sdk-api`: drop `com.adobe.aem:uber-jar` from `<dependencyManagement>`, add
  `com.adobe.aem:aem-sdk-api` (`scope=provided`, `version=${aem.sdk.api}`), and seed the `aem.sdk.api`
  property (the archetype's own pinned value) if absent.
- **Modules:** ensure **every** target module (`all`, `ui.apps.structure`, `ui.apps`, `ui.config`,
  `ui.content` — dir names from `config["targetModules"]`) is a live `<module>`, adding whichever is
  missing and never touching or duplicating one already listed. This is not just the three scaffolded
  modules: a legacy reactor may list `ui.apps` but leave **`ui.content` commented out** (a real
  acme-portal case) — which would orphan the whole mutable-content package from the build/deploy. A
  commented-out `<module>` is an XML comment node, not an element, so it is correctly (re-)added as live.
  Then **remove any superseded legacy source content-package module** (`_remove_superseded_content_modules`):
  a source content package whose directory name is NOT one of the target names (e.g. globex's legacy
  `globex.ui.apps`, distinct from target `ui.apps`) has had all its content split out by Stage 4 and now
  declares the SAME `artifactId` (`<parentArtifactId>.ui.apps`) the scaffolded `ui.apps` uses — leaving it
  in `<modules>` is a fatal `Project '…' is duplicated in the reactor`. CAM avoids this by writing the
  modernized package OVER the source dir (a rename); this skill scaffolds `ui.apps` alongside, so it drops
  the superseded source module from the reactor instead. A source package whose name already EQUALS the
  target (the SINGLE acme-portal/wknd case) IS the target and is never removed.
- **FileVault `extensions=true` binding (unconditional):** ensure the reactor's `<build>/
  <pluginManagement>` `filevault-package-maven-plugin` entry declares `<extensions>true</extensions>`
  (`_ensure_filevault_extensions_binding`). The scaffolded `ui.config`/`ui.apps.structure` declare
  `filevault-package-maven-plugin` *without* their own `<extensions>` (as the archetype's child poms do),
  relying on this inherited entry to bind the `content-package` packaging lifecycle. A legacy
  (pre-archetype) reactor's entry (e.g. filevault 1.0.3 with only a `<filterSource>`) has no
  `extensions=true`, so the scaffolded modules otherwise fail hard with `Unknown packaging:
  content-package`. Surgical: an existing entry keeps its own version/config, only `<extensions>` is
  ensured; if absent, a minimal (archetype-version + extensions) entry is installed. Runs BEFORE the
  index-settings step below, which — when it fires — fully re-specifies the same entry, so an oak-index
  project's final entry is byte-identical to before this rule existed.
- **aem-analyser:** add `com.adobe.aem:aemanalyser-maven-plugin` to the sibling `all/pom.xml`'s own
  `<build>/<plugins>` — but **only if that plugin identity isn't already declared there** (matched by
  groupId+artifactId alone, a presence check, not a shape check); if it was just added, also seed the
  `aemanalyser.version` property on the reactor.
- **Index settings — gated on `/oak:index`:** only when the *modernized* `ui.apps` module's own
  `filter.xml` declares a `<filter root="...">` starting with `/oak:index` (`has_oak_index`, derived by
  the CLI orchestration in `main`, §1's `/oak:index` routing having already merged those roots into
  `ui.apps` by Stage 4) does this step run at all. When it does, the reactor's `<build>/
  <pluginManagement>` gets an `org.apache.jackrabbit:filevault-package-maven-plugin` entry with
  `<allowIndexDefinitions>true</allowIndexDefinitions>` and the `jackrabbit-packagetype` validator's
  `immutableRootNodeNames=apps,libs,oak:index` + `allowComplexFilterRulesInApplicationPackages=true`
  options — placed in `<pluginManagement>` (not a bare `<plugins>`) because the reactor pom is
  `packaging=pom` and never builds a FileVault package itself; `<pluginManagement>` is how the real
  archetype hands every child module a shared, inherited FileVault config. When `has_oak_index` is
  false, none of these strings appear at all.

Every add across all four steps is upsert-by-identity (groupId+artifactId, or module name for
`<modules>`) — re-running `refactor_poms.py` is idempotent and never duplicates anything it already
added.

## 12. Skill-original finding codes (`RM-9xx`)

CAM's real `FindingsReporter` code table tops out at `RM-108` (`UNSUPPORTED_RUN_MODE`), and its separate
`ErrorCode` (exception) enum independently reuses `RM-100`..`RM-122` for unrelated meanings. Neither has a
code for the five skill-specific situations Phase 2's scripts detect-and-report rather than
transform, so this skill mints its own `RM-9xx` numbers — deliberately outside both of CAM's real
`RM-1xx` ranges, so they can never collide with a real CAM code:

| Code | Priority | Raised by | Meaning |
|---|---|---|---|
| `RM-901` | NORMAL | `convert_osgi.py` (`move_and_convert`, §10) | A repoinit OSGi config was relocated into `ui.config` but deliberately left unconverted (still `.xml`) — informational, not an error. |
| `RM-902` | HIGH | `refactor_poms.py` (`refactor_bundle_pom`, §11) | Legacy Felix `maven-scr-plugin`/`maven-bundle-plugin` found on a bundle module; migrate to `bnd-maven-plugin` manually — see `manual-followups.md` §1. |
| `RM-903` | NORMAL | `refactor_poms.py` (`refactor_content_pom`, §11) | ACL authoring (`rep:policy`/`rep:ACL`) detected in a converted content package; `accessControlHandling=merge_preserve` was added automatically. |
| `RM-904` | NORMAL | `refactor_poms.py` (`refactor_all_pom`, §11) | A pre-existing 3rd-party `<embedded>` in `all/pom.xml` survived the refactor unchanged — informational. |
| `RM-905` | HIGH | `inspect_project.py` (`find_oak_index_filter_gaps`, Phase-1 scan) | A source content package's `_oak_index/.content.xml` defines an `oak:QueryIndexDefinition` node with no matching `/oak:index/<name>` filter root anywhere in that package's `filter.xml` — a pre-existing customer-data gap that FileVault's `jackrabbit-filter` validator rejects once the content lands in the modernized `ui.apps`; see `manual-followups.md` §7. |
| `RM-906` | NORMAL / HIGH | `convert_osgi.py` (`move_and_convert`, §10) | A multi-app/multi-brand project filed the same OSGi PID+run-mode under several app subtrees, which flatten to one `ui.config` destination. **NORMAL** when the duplicate is byte/structure-identical and was deduplicated; **HIGH** when the copies genuinely differ (a conflicting redefinition) and the extra source was left in place for a human to resolve. |

`RM-901` and `RM-902` are the two called out in `manual-followups.md`: `RM-901` is purely informational —
there is nothing to *do* beyond knowing repoinit wasn't converted — while `RM-902` is the one that
actually blocks automatic bundle modernization and routes to a human / the `code-assessment` skill.
`RM-903`/`RM-904` are informational in the same spirit as `RM-901`, surfaced so a reviewer knows a
detail survived the refactor, not because either needs action. `RM-905` is, like `RM-902`, an
actionable HIGH finding that routes to a human / the `code-assessment` skill — the tool deliberately
does NOT auto-add the missing filter root (see `manual-followups.md` §7's ruling).

## Source

Rules distilled from `cam-repo-modernizer-analysis.md` (code-verified against
the CAM Repository Modernizer), cross-checked against its published behavior and
`src/test/resources/aem-guides-wknd-legacy` fixture and `src/main/resources/template_archetype_56` templates.
See `manual-followups.md` for what this skill deliberately detects-and-reports rather than transforms.
