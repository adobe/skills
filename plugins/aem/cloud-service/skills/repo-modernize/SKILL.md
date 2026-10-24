---
name: repo-modernize
description: "[BETA] Restructures a legacy AEM (6.x, AMS, on-prem) Maven project into the AEM as a Cloud Service package layout (ui.apps, ui.apps.structure, ui.config, ui.content, all) as a reviewable change on a git branch: the outcome of Adobe's CAM Repository Modernizer, produced locally. Splits immutable code (/apps, /libs, /oak:index) from mutable content, converts OSGi configs to typed .cfg.json, swaps uber-jar for aem-sdk-api, embeds bundles in all, and reports findings by priority, for single, nested, multi-project and monolithic layouts. Use for \"restructure my project for AEM as a Cloud Service\", \"split my apps and content packages\", or a project not yet in the Cloud Service layout. This skill is in beta. Verify all outputs before applying them to production projects."
license: Apache-2.0
compatibility: Requires git and Python 3.9+ with lxml (pip install -r requirements.txt). The optional build check needs Maven and JDK 11+.
metadata:
  status: beta
  version: "1.0"
  visibility: public
---

# AEM as a Cloud Service — Repository Modernizer

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Restructures a legacy AEM Maven project into the AEM as a Cloud Service package layout, as a reviewable change on a git branch — the outcome of Adobe's CAM Repository Modernizer, produced locally.

**You run the workflow and make the decisions with the user.** The bundled scripts do the bulk edits that must be exact and repeatable — moving hundreds of files with their git history, splitting content and filters, converting OSGi configs, editing POMs — and check that nothing was lost. Do not hand-edit what the scripts produce; change the plan and re-run.

## When to use
- A content package deploys both `/apps` and mutable paths (`/content`, `/conf`, `/etc`, ...), or the project has no `ui.apps` / `ui.content` / `ui.config` / `all` split.
- Before the `migration` skill's per-pattern fixes, when the project is not yet in the Cloud Service layout.

Not for: Dispatcher configs (`migration`, Dispatcher branch), Java API fixes (`code-assessment`), Oak index definitions (Adobe's index converter).

## Prerequisites
- **git**, and **Python 3.9+ with `lxml`**: `python3 -m pip install -r requirements.txt` (from this skill's folder, or into a virtual environment). The apply step checks both and stops with instructions if anything is missing.
- **Optional build check:** Maven and JDK 11+.
- A **clean working tree on a new branch**: `git checkout -b cloud-modernize`.

Run the scripts from this skill's folder (`scripts/...`), passing the project root.

## Workflow

### 1. Plan (read-only)
`python3 scripts/orchestrate.py <project-root> --plan`

Detects the project shape (single, nested, multi-project or monolithic) and the code-bearing units to restructure, and writes for each unit `.modernize/config.json` (the plan), `inventory.json` (file checksums for the no-loss check) and `findings.json`. Nothing outside `.modernize/` changes. Units that are already restructured or have no code are skipped.

### 2. Review the plan with the user — required
For each unit, show the shape, `appId`, bundles, content packages, target module names and the findings so far. Check with the user:
- **`appId`** names `/apps/<appId>/osgiconfig` and `/apps/<appId>-packages`. Inspection proposes the reactor artifactId; if the legacy embed targets use a shorter app folder (e.g. `/apps/wknd/install` → `wknd`), propose that instead.
- **`targetModules`**: rename any module that would collide with an existing directory.
- **`bundles` / `testBundles`**: test bundles are not embedded in `all`.
- **`contentPackages`**: every legacy content package must be listed.

Edit `config.json` ([schema](references/config-schema.md)) and get explicit approval before applying.

### 3. Apply
`python3 scripts/orchestrate.py <project-root> --apply --git --verify [--mvn] [--sdk-version latest]`

Uses each reviewed `config.json` as-is (never re-inspects). Per unit, sub-projects first:
1. scaffold the missing modules from the bundled archetype templates;
2. split content and filters: `/apps`, `/libs`, `/oak:index` → `ui.apps`; everything else → `ui.content`; repository roots → `ui.apps.structure`;
3. move OSGi configs to `ui.config/.../apps/<appId>/osgiconfig/<run-mode>/` and convert them to `.cfg.json`, typed exactly as AEM read the legacy file (`{Long}5` → `5`, `{Boolean}true` → `true`; consistent with the `migration` skill's OSGi rules);
4. refactor POMs: `uber-jar` → `aem-sdk-api`, FileVault packaging, `all` embeds, reactor modules, Java level 11, plugin versions;
5. verify: no file lost, filter immutability, POM shape, embeds; `--mvn` adds a Maven build.

| Exit | Meaning | Next step |
|---|---|---|
| 0 | Done; with `--mvn`, either a clean build or a break in a module's **legacy code** (Java compile, Felix SCR plugin, unit tests) | Review; hand legacy code breaks to `code-assessment` |
| 1 | Structural check failed (violations listed) | Usually a wrong mapping in `config.json`: reset the branch, fix the plan, re-apply |
| 2 | Prerequisite or plan missing | Follow the printed instructions |
| 3 | aem-analyser ERROR | A real Cloud Service problem; investigate before continuing |
| 4 | A restructured content module's POM can't be read by Maven | Report it as a bug with the printed lines |

### 4. Review the result with the user
- `git status` / `git diff --stat`: new modules, moved files (history kept), changed POMs.
- Spot-check that `ui.apps`' filter holds only immutable roots, and compare a few `.cfg.json` files with their sources (in the diff).
- Work through the findings below, then commit when the user agrees. `.modernize/` holds the plan and reports; leave it out of the commit unless the user wants the record.

## Findings — what to do with each
Findings are in each unit's `.modernize/findings.json`. Present them by priority, then:

| Code | Meaning | Your action |
|---|---|---|
| RM-101 CRITICAL | Third-party dependency in a bundle or `ui.apps` | Decide with the user how it reaches Cloud Service: embed it in `all` (target `/apps/<appId>-packages/application/install`) or drop it if AEM provides it. [manual-followups §2](references/manual-followups.md) |
| RM-107 CRITICAL | Content under `/libs` | Adobe owns `/libs`; customer code must not change it. With the user, move the customization to an `/apps` overlay or remove it. |
| RM-108 HIGH | Run-mode folder Cloud Service ignores (e.g. `config.qa`) | Moved unchanged. Hand to the `migration` skill's OSGi branch (unsupported run modes): the user decides which Cloud run mode each maps to. Never merge folders silently — conflicting values would be lost. |
| RM-901 NORMAL | Repoinit config moved without conversion | Nothing required. |
| RM-902 HIGH | Bundle uses Felix SCR / `maven-bundle-plugin` | Hand to `code-assessment` (SCR → OSGi DS annotations, `bnd-maven-plugin`). |
| RM-903 NORMAL | ACLs in a content package; `accessControlHandling=merge_preserve` set | Confirm with the user. |
| RM-904 NORMAL | Existing third-party embed kept in `all` | Confirm it is still needed. |
| RM-905 HIGH | Oak index defined but not covered by any filter root | If the user wants it deployed, add `<filter root="/oak:index/<name>"/>` to `ui.apps`' filter and review index naming. [manual-followups §7](references/manual-followups.md) |
| RM-906 NORMAL / HIGH | Same OSGi PID in several app folders | NORMAL: identical copies, deduplicated. HIGH: conflicting copies — the second stayed in `ui.apps`; ask the user which values apply, then move it. |
| RM-907 NORMAL / HIGH | OSGi value conversion note | NORMAL: a property AEM never applied (e.g. a `{Path}` value) was not carried over; the source value is in the finding — re-add only if wanted. HIGH: a value or whole file was invalid and left as-is — fix it with the user and convert per [transform-rules §10](references/transform-rules.md). |
| RM-908 NORMAL | Java compiler level raised to 11 | Code that no longer compiles goes to `code-assessment`. |

## Archetype and AEM SDK version
Modules are scaffolded from bundled, pinned AEM archetype templates, so every run is deterministic and works offline. The plan step prints a notice when a newer archetype or SDK exists. `--sdk-version latest` writes the newest `aem-sdk-api` from Maven Central (falls back to the pinned version when offline); `scripts/refresh_archetype.py` updates the pins.

## References
- [references/config-schema.md](references/config-schema.md) — the plan file.
- [references/transform-rules.md](references/transform-rules.md) — every transformation rule, and where it intentionally differs from CAM.
- [references/manual-followups.md](references/manual-followups.md) — what is reported rather than changed, and how to resolve it.
- [references/cam-validation.md](references/cam-validation.md) — results against CAM on four real projects.

The stages can also be run one at a time per unit (`inspect_project.py`, `scaffold_modules.py`, `split_content.py`, `convert_osgi.py`, `refactor_poms.py`, `verify.py`); see each script's `--help`.
