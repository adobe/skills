---
name: repo-modernize
description: Restructure a legacy AEM (6.x / AMS / on-prem) Maven project into the AEM as a Cloud Service module layout (ui.apps + ui.apps.structure + ui.config + ui.content + all), separating immutable code (/apps, /libs, /oak:index) from mutable content/config. Reproduces the CAM Repository Modernizer outcome locally in the IDE — auto-inspection, immutable/mutable content + filter split, ui.apps.structure roots, OSGi→.cfg.json, uber-jar→aem-sdk-api, all-embedding, 3rd-party detection, findings by priority — as a reviewable git diff on a dedicated branch, targeting the current archetype, without the CAM tool's bugs. Use for "restructure my project for Cloud", "split apps/content packages", "my project isn't Cloud-restructured", or as a pre-step of the migration journey. Handles all four CAM project shapes — SINGLE, NESTED, MULTI, MONOLITHIC — via a shape-aware orchestrator (scripts/orchestrate.py) that runs the pipeline per code-bearing sub-project.
license: Apache-2.0
metadata:
  version: "1.0"
  visibility: public
---

# AEM as a Cloud Service — Repository Modernizer (in-IDE)

Scoped under `plugins/aem/cloud-service/skills/repo-modernize/`.

## When to use
- A legacy project has a single content package spanning `/apps` and `/content`, or no ui.apps/ui.content split.
- Migration detects "project not Cloud-restructured" and delegates here before per-finding fixes.

## Precondition gate
Clean git working tree. Create a dedicated branch (default `cloud-modernize`) and **abort if the tree is dirty**.

## Prerequisites
- **`lxml`** — Phase-2 POM refactoring (`refactor_poms.py`, via `pom_engine.py`) parses/rewrites POMs with `lxml`. Install it before Stage 6: `pip install -r requirements.txt` (or into a project venv).
- **`runmode-restructure` companion skill** — *not required.* Run-mode folder **renaming/merging** is deliberately out of scope: `repo-modernize` reproduces the CAM Repository Modernizer, which is **detect-only** for run modes (it relocates config folders verbatim and flags non-Cloud ones as `RM-108`, never renaming or merging them). Renaming/merging is a separate, human-directed concern with a real data-loss hazard (two conflicting run modes — e.g. `config.test` and `config.preprod` holding different values — cannot both become one Cloud run mode without losing a value), so the standalone `runmode-restructure` skill owns it if a developer chooses to do it after this restructuring.

## Archetype & AEM SDK version
The skill scaffolds from a **bundled, pinned** copy of the AEM project archetype templates (`assets/archetype-pom-templates/`, currently **archetype-56**) and bakes a **pinned AEM SDK API** version into the reactor. Pinning keeps every run deterministic and offline — a re-runnable, reviewable diff — and mirrors how the CAM tool itself works (it bakes `template_archetype_56` into its jar). Staying current is handled explicitly, not by a silent runtime download:
- **Staleness notice (always on, offline-safe):** Stage 1 (`inspect_project.py`) checks Maven Central and prints a one-line notice when a newer archetype/SDK exists, so a run is never *silently* on a stale archetype. Disable with `--no-version-check` / `REPO_MODERNIZE_NO_VERSION_CHECK` (auto-disabled under pytest).
- **Latest SDK on demand:** pass `--sdk-version latest` to `refactor_poms.py` (or `orchestrate.py`) to bake the newest `aem-sdk-api` from Maven Central into the reactor (falls back to the pin when offline). Default is `pinned` for determinism; an explicit `--sdk-version <version>` is also accepted.
- **Refresh the pins:** `python3 scripts/refresh_archetype.py` bumps the pinned SDK to the latest (safe, version-string only) and reports whether a newer **archetype structure** (e.g. 57/58) is available. The template *structure* is intentionally **not** auto-swapped at runtime — the deterministic transforms are calibrated to the current template shapes, so a structure bump is regenerated under the full test suite as a gate (the model CAM uses in its weekly `archetype-auto-update` CI job). `--check` reports without changing anything.

## Project shapes & orchestration
`repo-modernize` handles all four CAM project shapes. `inspect_project.py` auto-detects the shape:
- **SINGLE** — reactor + its own bundle/content modules, no sub-projects.
- **NESTED** — reactor with no own code, but sub-projects (nested reactors), e.g. `globex-parent`.
- **MONOLITHIC** — reactor + own code AND sub-projects.
- **MULTI** — no root reactor pom; independent projects side by side.

A **sub-project** is a nested reactor that declares its own `<module>`s (a bare `pom` module like `dispatcher` is NOT one). The **modernization unit** = each code-bearing project the SINGLE pipeline runs on: for SINGLE it's the root; for NESTED it's each legacy sub-project; for MONOLITHIC it's the root itself + its sub-projects; for MULTI it's each child project. `inspect_project.py` writes the plan to `.modernize/units.json` (+ `subprojects.json`), classifying each unit `legacy` (modernize), `modern` (already Cloud-restructured — skip), or `empty` (nothing to do).

**Orchestrator (single entry point, any shape):** `python3 scripts/orchestrate.py <root> [--git] [--verify] [--mvn]` runs the full Stage 1–6 pipeline (below) on every `legacy` unit, **in place**, in CAM's order (**sub-projects first, then the main project**), skips `modern`/`empty` units, isolates per-unit failures, and writes `.modernize/orchestration.json` + an aggregate summary. Unlike CAM (which copies into a fresh `modernized/` tree), each unit is modernized in place and is independently reviewable as its own git diff; the umbrella/root reactor keeps its own `<modules>` wiring. Run the orchestrator, **or** drive the stages below manually per unit.

## Workflow (the SINGLE pipeline — run per unit)
1. **Inspect** (read-only): `python3 scripts/inspect_project.py <root>` → proposed `.modernize/config.json`, `inventory.json`, initial findings (+ `units.json`/`subprojects.json` for NESTED/MONOLITHIC/MULTI roots). Present the proposal.
2. **Confirm (human gate):** show the dev `config.json`; they edit target-module mapping / naming collisions / ambiguous content. Nothing is written to the tree before this.
3. **Scaffold:** `python3 scripts/scaffold_modules.py <root> --config .modernize/config.json` → only the needed target modules from pinned archetype-56 templates.
4. **Split content:** `python3 scripts/split_content.py <root> --config .modernize/config.json --git` → `git mv` content by immutable/mutable, split filters, derive ui.apps.structure roots.
5. **Convert OSGi:** `python3 scripts/convert_osgi.py <root> --config .modernize/config.json --git` → moves OSGi configs out of the (already-split) `ui.apps` module's `apps/<appId>/config*` folders (found recursively — nested `runmodes/`/per-site subtrees included; folders holding only non-OSGi files like `.scss` are skipped) into `ui.config/.../src/main/content/jcr_root/apps/<appId>/osgiconfig/<runmode>/`, **preserving each run-mode folder name verbatim**, converting `sling:OsgiConfig` `.xml` and Felix `.config`/`.cfg` files into `.cfg.json` along the way (repoinit configs are relocated but deliberately left as unconverted `.xml` — `RM-901`; an existing `.cfg.json` is copied through byte-for-byte; a same-PID duplicate across app subtrees is deduped or, if it conflicts, flagged `RM-906`). A run-mode folder whose name is not a valid AEMaaCS run mode (honored: `author`/`publish`/`dev`/`stage`/`prod`) is **flagged `RM-108`** but relocated as-is and never renamed/merged — matching CAM's detect-only behavior (no data loss).
6. **Refactor POMs:** `python3 scripts/refactor_poms.py <root> --config .modernize/config.json` → per-module POM refactor, in order:
   - **Bundle poms:** drop `com.adobe.aem:uber-jar`; a **scaffolded** bundle already has `aem-sdk-api` pre-seeded from the archetype template, while a **pre-existing** bundle (edited in place) gets a bare `aem-sdk-api` `<dependency>` added so it keeps its AEM API surface. The module's parent/own `<version>` is aligned to the reactor version. If the legacy Felix `maven-scr-plugin`/`maven-bundle-plugin` pair is present, those plugins are left untouched and `RM-902` (HIGH) is raised — porting Felix `<instructions>` into a `bnd-maven-plugin` `<bnd>` block is a manual/`code-assessment` job, not a mechanical one.
   - **`ui.apps` / `ui.content` poms:** any legacy `com.adobe.aem:uber-jar` `<dependency>` is dropped and the module's parent/own `<version>` is aligned to the reactor; then content-package → filevault conversion, producing the archetype's own two-plugin shape — `com.day.jcr.vault:content-package-maven-plugin` is reshaped down to a bare `<extensions>true</extensions>` (kept, not removed or renamed, purely so `<packaging>content-package</packaging>` still has a lifecycle binding), and `org.apache.jackrabbit:filevault-package-maven-plugin` is added as a separate plugin carrying the real `packageType`/`cloudManagerTarget` configuration sourced from the archetype template. Legacy `autoInstallPackage`/`autoInstallPackagePublish` profiles are dropped. If the package's content has ACL authoring (`rep:policy`/`rep:ACL`), `accessControlHandling=merge_preserve` is added and noted (`RM-903`).
   - **`all` pom:** ensures `packageType=container`, then embeds every project bundle plus `ui.config` (deduped by groupId+artifactId, additive only — nothing pre-existing is ever removed). A pre-existing 3rd-party `<embedded>` (e.g. one already hand-added by the legacy project) survives unchanged and is noted (`RM-904`).
   - **Reactor/parent pom:** `uber-jar` → `aem-sdk-api` in `dependencyManagement` (+ the `aem.sdk.api` property); ensures **every** target module (`all`/`ui.apps.structure`/`ui.apps`/`ui.config`/`ui.content`) is a live `<module>` — including re-adding a `ui.content` a legacy reactor left commented out; ensures the reactor's FileVault `<pluginManagement>` entry declares `<extensions>true</extensions>` so the archetype-scaffolded content modules can bind the `content-package` packaging (a legacy reactor's filevault entry lacks it → `Unknown packaging: content-package`); adds `aemanalyser-maven-plugin` to `all/pom.xml` if it isn't already declared there; and, only when the modernized `ui.apps` filter has an `/oak:index` root, adds the `jackrabbit-packagetype` validator's index-definition settings to the reactor's FileVault `<pluginManagement>`.

   **Must run after Stage 4's split** — `has_oak_index` (which gates the reactor's index-definition settings) is derived from the *modernized* `ui.apps` filter.xml, which only carries `/oak:index` roots once Stage 4 has merged them in from the legacy content packages.
7. **Verify:** `python3 scripts/verify.py <root> --config .modernize/config.json --inventory .modernize/inventory.json --mvn` → the structural gate (`validate.py` run with `--check-pom-shape --check-embeds`, plus the no-content-loss oracle when `--inventory` is given) followed by an informational `mvn`/aem-analyser run. Exit codes:
   - `0` — full success (structural PASS + analyser clean), **or** structural PASS where the *only* `mvn` problem is a Java compile failure attributable to a specific module and there are no aem-analyser `ERROR`-level findings — this is a `code-assessment` hand-off (Stage 8), not a Phase-2 failure.
   - `3` — structural PASS, but aem-analyser reported a genuine `ERROR`-level finding — a real Phase-2 failure (spec anti-gaming: the analyser must stay green), even if a compile break also occurred.
   - any other nonzero — the structural gate itself failed (filter-immutability / no-loss / pom-shape / embeds); `mvn` is never invoked in that case.
8. **Triage & report:** residual Java/bundle breakage — legacy `core`'s Felix SCR/bundle-plugin pair (`RM-902`), or Java code that no longer compiles after the `uber-jar` → `aem-sdk-api` swap (Stage 7's compile-break hand-off) — is handed off to the `code-assessment` skill for triage and resolution. Dispatcher config conversion and Oak index-definition conversion remain detect-and-report only (out of scope for this skill). A pre-existing `oak:index` filter/content coverage gap — a source `_oak_index/.content.xml` index node with no matching filter root, flagged at Stage 1 as `RM-905` (HIGH) — is likewise a hand-off, not something the skill auto-resolves: see `references/manual-followups.md` §7.

## Deterministic ↔ LLM boundary
Scripts do all mechanical edits deterministically. The LLM proposes config, runs the confirm gate, and adjudicates only what a script *flags*. It never free-hand-edits POMs or content.

See `references/transform-rules.md` for the code-verified rules and `references/manual-followups.md` for hand-offs.
