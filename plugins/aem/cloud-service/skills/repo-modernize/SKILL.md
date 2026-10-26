---
name: repo-modernize
description: "[BETA] Restructures a legacy AEM (6.x, AMS, on-prem) Maven project into the AEM as a Cloud Service package layout (ui.apps, ui.apps.structure, ui.config, ui.content, all) as a reviewable change on a git branch: the outcome of Adobe's CAM Repository Modernizer, produced locally. Splits immutable code (/apps, /libs, /oak:index) from mutable content, converts OSGi configs to typed .cfg.json, swaps uber-jar for aem-sdk-api, embeds bundles in all, and reports findings by priority, for single, nested, multi-project and monolithic layouts. Use for \"restructure my project for AEM as a Cloud Service\", \"split my apps and content packages\", or a project not yet in the Cloud Service layout. This skill is in beta. Verify all outputs before applying them to production projects."
license: Apache-2.0
compatibility: Requires git, Python 3.9+ with lxml (pip install -r requirements.txt), and Maven with JDK 11+ to generate the AEM project archetype (or a project already generated from an archetype).
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

**You run the workflow and make the decisions with the user.** The skill's scripts do the bulk edits that must be exact and repeatable — moving hundreds of files with their git history, splitting content and filters, converting OSGi configs, editing POMs — and check that nothing was lost. Do not hand-edit what the scripts produce; change the plan and re-run.

## When to use
- A content package deploys both `/apps` and mutable paths (`/content`, `/conf`, `/etc`, ...), or the project has no `ui.apps` / `ui.content` / `ui.config` / `all` split.
- Before the `migration` skill's per-pattern fixes, when the project is not yet in the Cloud Service layout.

Not for: Dispatcher configs (`migration`, Dispatcher branch), Java API fixes (`code-assessment`), Oak index definitions (`migration`, Oak index branch).

## Prerequisites
- **git**, and **Python 3.9+ with `lxml`**. If `python3` lacks lxml, create a virtual environment in this skill's folder (never in the user's project): `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`, then use `.venv/bin/python` wherever `python3` appears below. The apply step checks both and stops with instructions if anything is missing.
- **Maven and JDK 11+.** The skill ships no archetype: the plan step generates the latest AEM Project Archetype with Maven, which downloads it on first use (through the user's Maven settings and mirrors) or takes it from the local Maven repository. Without Maven, the user can point to a project already generated from an archetype (`--archetype <path>`). Maven also runs the optional build check (`--mvn`).
- A **clean working tree** (the user commits or stashes their own changes first). If this skill is installed inside the project (e.g. `.agents/skills/`), that folder and `skills-lock.json` are ignored.

Run the scripts from this skill's folder (`scripts/...`), passing the project root. The project is changed in place; if the user wants a separate copy, run on a worktree instead: `git worktree add ../<project>-cloud -b repo-modernize/<YYYY-MM-DD>-<short-sha>`.

## Workflow

### 1. Plan (read-only)
`python3 scripts/orchestrate.py <project-root> --plan [--archetype <spec>]`

Detects the project shape (single, nested, multi-project or monolithic) and the code-bearing units to restructure, and writes for each unit `.modernize/config.json` (the plan), `inventory.json` (file checksums for the no-loss check) and `findings.json`. Units that are already restructured or have no code are skipped.

It also prepares the module templates in `.modernize/archetype-templates/` and prints where they came from, e.g. `archetype: com.adobe.aem:aem-project-archetype:58 (latest, from Maven Central); AEM SDK <version>`. By default that is the latest Adobe AEM Project Archetype, generated in a temporary folder (never in the project) with the latest AEM SDK. `--archetype` takes instead a version (`58`), the user's own `groupId:artifactId:version`, or a path to a project the user generated from an archetype. The templates are checked against what the restructuring needs; if the latest archetype doesn't fit, the plan falls back to the newest version the skill is tested with and says so. Nothing outside `.modernize/` changes. Exit 2 means the templates couldn't be prepared (e.g. no Maven, or Maven Central and the local repository both unavailable) and none are left for apply: follow the printed instructions and plan again.

### 2. Review the plan with the user — required
For each unit, show the shape, `appId`, bundles, content packages, target module names and the findings so far. Check with the user:
- **Archetype** (settle this first: planning again rewrites `config.json`): show the `archetype:` line. If the user has their own archetype (their company's), a specific version, or a project already generated from an archetype, plan again with `--archetype <groupId:artifactId:version | version | path>`.
- **`appId`** names `/apps/<appId>/osgiconfig` and `/apps/<appId>-packages`. Inspection proposes the reactor artifactId; if the legacy embed targets use a shorter app folder (e.g. `/apps/wknd/install` → `wknd`), propose that instead.
- **`targetModules`**: rename any module that would collide with an existing directory.
- **`bundles` / `testBundles`**: test bundles are not embedded in `all`.
- **`contentPackages`**: every legacy content package must be listed.

Edit `config.json` ([schema](references/config-schema.md)) and get explicit approval before applying.

### 3. Apply
After the user approves the plan, create the branch for the changes, named like `code-assessment`'s: `git checkout -b repo-modernize/<YYYY-MM-DD>-<short-sha>` (today's date, the first 7 characters of `HEAD`). Then:

`python3 scripts/orchestrate.py <project-root> --apply --git --verify [--mvn]`

Uses each reviewed `config.json` and the templates the plan prepared, as they are (never re-inspects), and prints the `archetype:` line it uses. `--archetype` or `--sdk-version` here replaces only that part of the plan's choice; the other stays as planned, and the SDK alone needs no Maven. Per unit, sub-projects first:
1. scaffold the missing modules (and `all`'s package filter) from the archetype templates;
2. split content and filters: `/apps`, `/libs`, `/oak:index` → `ui.apps`; everything else → `ui.content`; repository roots → `ui.apps.structure`;
3. move OSGi configs to `ui.config/.../apps/<appId>/osgiconfig/<run-mode>/` and convert them to `.cfg.json`, typed exactly as AEM read the legacy file (`{Long}5` → `5`, `{Boolean}true` → `true`; consistent with the `migration` skill's OSGi rules);
4. refactor POMs: `uber-jar` → `aem-sdk-api`, FileVault packaging, `all` embeds, reactor modules, Java level 11, plugin versions;
5. verify: no file lost, filter immutability, POM shape, embeds; `--mvn` adds a Maven build.

| Exit | Meaning | Next step |
|---|---|---|
| 0 | Done; with `--mvn`, either a clean build or a break in a module's **legacy code** (Java compile, Felix SCR plugin, unit tests) | Review; hand legacy code breaks to `code-assessment` |
| 1 | Structural check failed (violations listed) | Usually a wrong mapping in `config.json`: reset the branch (`git reset --hard`, then `git clean -fd -- <module folders apply created>`; the plan in `.modernize/` is kept), fix the plan, re-apply |
| 2 | Prerequisite, plan or archetype templates missing, or the templates don't fit | Follow the printed instructions; nothing was changed |
| 3 | aem-analyser ERROR | A real Cloud Service problem; investigate before continuing |
| 4 | A restructured content module's POM can't be read by Maven | Report it as a bug with the printed lines |

### 4. Review the result with the user
- `git status` / `git diff --stat`: new modules, moved files (history kept), changed POMs.
- Spot-check that `ui.apps`' filter holds only immutable roots, and compare a few `.cfg.json` files with their sources (in the diff).
- Work through the findings below, then commit when the user agrees. `.modernize/` (the plan and reports) ignores itself, so it never lands in a commit; `git add -f .modernize` keeps a record if the user wants one. Never commit an in-project install of this skill or `skills-lock.json`.

## Findings — what to do with each
Findings are in each unit's `.modernize/findings.json`. Present them by priority, then:

| Code | Meaning | Your action |
|---|---|---|
| RM-101 CRITICAL | Third-party dependency in a bundle or `ui.apps` | Decide with the user how it reaches Cloud Service: embed it in `all` (target `/apps/<appId>-packages/application/install`) or drop it if AEM provides it. [manual-followups §2](references/manual-followups.md) |
| RM-107 CRITICAL | Content under `/libs` | Adobe owns `/libs`; customer code must not change it. With the user, move the customization to an `/apps` overlay or remove it. |
| RM-108 HIGH | Run-mode folder Cloud Service ignores (e.g. `config.qa`) | Moved unchanged. Hand to the `migration` skill's OSGi branch (unsupported run modes): the user decides which Cloud run mode each maps to. Never merge folders silently — conflicting values would be lost. |
| RM-901 NORMAL | Repoinit config moved without conversion | Nothing required. |
| RM-902 HIGH | Bundle uses Felix SCR / `maven-bundle-plugin` | Hand to `code-assessment` (SCR → OSGi DS annotations, `bnd-maven-plugin`). |
| RM-903 NORMAL | The content package installs ACLs; `accessControlHandling=merge_preserve` set (without ACLs none is set: FileVault rejects one) | Confirm with the user. |
| RM-904 NORMAL | Existing third-party embed kept in `all` | Confirm it is still needed. |
| RM-905 HIGH | Oak index defined but not covered by any filter root | If the user wants it deployed, add `<filter root="/oak:index/<name>"/>` to `ui.apps`' filter and review index naming; the `migration` skill's Oak index branch converts legacy index definitions. [manual-followups §7](references/manual-followups.md) |
| RM-906 NORMAL / HIGH | Same OSGi PID in several app folders | NORMAL: identical copies, deduplicated. HIGH: conflicting copies — the second stayed in `ui.apps`; ask the user which values apply, then move it. |
| RM-907 NORMAL / HIGH | OSGi value conversion note | NORMAL: a property AEM never applied (e.g. a `{Path}` value) was not carried over; the source value is in the finding — re-add only if wanted. HIGH: a value or whole file was invalid and left as-is — fix it with the user and convert per [transform-rules §10](references/transform-rules.md). |
| RM-908 NORMAL | Java compiler level raised to 11 | Code that no longer compiles goes to `code-assessment`. |

## Archetype and AEM SDK version
The skill ships no archetype; each plan prepares the templates from one:
- **Default (`latest`):** the newest Adobe AEM Project Archetype and AEM SDK on Maven Central, or the newest in the local Maven repository when Maven Central can't be reached. Maven generates the archetype; it uses the local repository first, so repeat runs work offline. If no AEM SDK version is found offline (generating the archetype doesn't download it), the plan uses the previous plan's, else the tested one, and says so.
- **`--archetype <version>` or `<groupId:artifactId:version>`:** a specific Adobe archetype version, or the user's own archetype from their Maven repository.
- **`--archetype <path>`:** a project the user already generated from an archetype (its `archetype.properties` gives the app id and title), or a folder of templates. No Maven needed.
- **`--sdk-version <version|latest>`:** the AEM SDK API version to use instead (a path keeps its own by default).

The templates must fit what the restructuring relies on (package types, FileVault configuration, filters, `all` embeds, versions the project's own reactor can resolve); otherwise the plan says why and nothing changes. `.modernize/archetype.json` records what was used; to repeat a run exactly, pass its archetype and AEM SDK version. The tests use archetype 58 (`TESTED_ARCHETYPE` / `TESTED_SDK` in `scripts/archetype.py`).

## References
- [references/config-schema.md](references/config-schema.md) — the plan file.
- [references/transform-rules.md](references/transform-rules.md) — every transformation rule, and where it intentionally differs from CAM.
- [references/manual-followups.md](references/manual-followups.md) — what is reported rather than changed, and how to resolve it.
- [references/cam-validation.md](references/cam-validation.md) — results against CAM on four real projects.

The stages can also be run one at a time per unit (`inspect_project.py`, `scaffold_modules.py`, `split_content.py`, `convert_osgi.py`, `refactor_poms.py`, `verify.py`); see each script's `--help`.
