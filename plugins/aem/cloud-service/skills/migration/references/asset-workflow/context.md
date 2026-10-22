# Asset Workflow Migration — Context (Branch F)

Migrates on-premise / AMS **DAM asset-processing workflows** (enabled `DAM Update Asset` launchers, overlaid or custom asset workflow models, custom process steps) to AEM as a Cloud Service. On Cloud Service the **asset microservices** create renditions and extract metadata; anything else the old workflow did must run afterwards as a **post-processing workflow** started by the **Custom Workflow Runner** (`com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl`), and custom renditions move to **processing profiles**.

This branch wraps Adobe's own **Asset Workflow Migration Tool** ([`adobe/aem-cloud-migration`](https://github.com/adobe/aem-cloud-migration), `wf-migrator` JAR) — it does not reimplement it. The tool runs **unmodified**; deterministic Node scripts under `scripts/` add a pre-run gate, follow-up fixes (listed below), verification gates and a post-deploy checklist. Adobe docs: [Asset Workflow Migration Tool](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/migration-journey/refactoring-tools/asset-workflow-migration-tool), [asset microservices and post-processing workflows](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/manage/asset-microservices-configure-and-use).

## Does this project need it?

Only workflows that still do something on Cloud Service need migrating. Run the dry run (below) or the Step 0 runbook (pattern `assetWorkflowMigration`, content-scan): it lists every enabled asset launcher whose model has

- **real work** — a `SUPPORTED`, custom Java (`CUSTOM`) or ECMA (`SCRIPT`) step, at the top level or inside a split. It becomes a post-processing workflow; or
- an **`UNSUPPORTED` step** but no real work — typically OOTB steps plus an ImageMagick `CommandLineProcess` (**renditions only**). The tool disables the launcher and leaves the model alone, so its renditions would stop being generated. The model is not migrated (nothing would be left to run); its commands become processing-profile renditions and the rest goes through the same gate as any other `UNSUPPORTED` step; or
- a **rendition step inside an OR/AND split** (`ThumbnailProcess`, `CreateWebEnabledImageProcess`, …). The tool adds rendition steps to the processing profile only when they are at the top level, so the skill maps these itself; or
- a **top-level rendition step that produces a rendition that is not standard** (e.g. a 600×600 thumbnail, a PDF preview that is kept). The tool writes it to its `Migrated from <model>` processing profile but disables the launcher, so the rendition is generated again only once that profile is attached to the folders; the skill lists the profile and the folders.

Workflows made only of OOTB rendition / metadata steps with their standard settings need nothing — the microservices already do that work.

Step categories and what happens to each are in [step-catalog.md](step-catalog.md).

## Prerequisites

| Need | Why | Checked by |
|---|---|---|
| Java 11+ on `PATH` | runs the JAR | `checkJava` (stops with exit 2) |
| A Maven multi-module project: root `pom.xml` with `<modules>` and at least one `content-package` module | the tool only scans content packages | `checkProject` |
| A clean git tree (or `--allow-dirty`) | the tool rewrites files in place; the diff must be reviewable and `git checkout .` must undo it | `checkCleanGitTree` |
| Network on the first run (or `--jar <path>`) | downloads the pinned `wf-migrator-0.6.0.jar` into the gitignored `scripts/asset-workflow-tool/`, verified by SHA-256 | `ensureToolInstalled` |

There is no manual install step — do not ask the user to download the tool.

## The flow

Run everything from the migration skill directory (`plugins/aem/cloud-service/skills/migration/`). `<project>` is the Maven root.

1. **INVENTORY + PLAN** — dry run; changes nothing:

   ```bash
   node scripts/asset-workflow-run.js <project> --dry-run
   ```

   Prints, per affected model: launchers (glob + conditions), steps kept and removed (`*` = inside a split), then the **gate**: each step whose renditions would be lost — an `UNSUPPORTED` step, or a rendition step inside a split — (`STOP` unless everything it produced maps to processing-profile or standard renditions) and each packaged runtime model under `/var/workflow` with no design-time model (`STOP` — the tool deletes it).

2. **CONFIRM WITH THE USER** — show the plan, then ask one decision at a time:
   - Each `STOP` step: is its remediation (printed under it; see [step-catalog.md](step-catalog.md#unsupported-steps)) acceptable? Acknowledge with `--acknowledge <ShortName|fqcn>`.
   - Each `STOP` runtime model: export it into `/conf/global/settings/workflow/models/<id>` first, or acknowledge its `/var/workflow/models/<id>` path if it is obsolete.
   - Rename overlaid OOTB models (`dam/update_asset` → `update_asset-postprocessing`)? Recommended (`--rename-ootb-models`).
   - Attach processing profiles with a repoinit config (`--emit-repoinit`)? Off by default — confirm on an RDE first.

   Never pass `--acknowledge all` without the user's explicit agreement: it silences the gate that stops the tool deleting work.

3. **EXECUTE + FIX + VERIFY** — one command:

   ```bash
   node scripts/asset-workflow-run.js <project> --acknowledge CommandLineProcess --rename-ootb-models
   ```

   Pre-flight → baseline copy → run the tool and check it succeeded → follow-up fixes → verification gates → report. Exit `0` = verification passed; `1` = the tool or verification failed; `2` = a pre-flight or gate stop, or bad arguments.

4. **REVIEW** — read `target/asset-workflow-migration/asset-workflow-report.md` with the user and review `git diff`. On a verification failure follow [validation.md](validation.md); never present a failed run as done. To undo: `git checkout . && git clean -fd`.

5. **POST-DEPLOY** — the report's **checklist** (sync models, attach profiles, custom workers, launcher conditions, overlapping workflows, …) can only be done on the Cloud Service environment. Hand it over explicitly; [validation.md](validation.md) lists the RDE checks.

**Already ran the tool by hand?** Use `--fix-only`: it rebuilds the pre-tool baseline from git `HEAD` (or `--baseline <dir>`) and applies the fixers and gates to the current tree without Java.

### Options

| Option | Effect |
|---|---|
| `--dry-run` | Inventory, plan and gate only. No changes. |
| `--acknowledge <list>` | Comma-separated step short names or FQCNs, `/var/workflow/models/<id>` paths, or `all`. Repeatable. |
| `--rename-ootb-models` | Move overlaid OOTB models to `<name>-postprocessing` (the overlay at the old path is removed) and update the runner config and filter roots (adding a root for the new path when only an ancestor of the old one was covered, e.g. `…/models/dam`). |
| `--emit-repoinit` | Write a repoinit OSGi config that sets `processingProfile` on the mapped folders. |
| `--fix-only` | Skip the tool; fix the current tree against the git `HEAD` baseline. |
| `--baseline <dir>` | Baseline project copy for `--fix-only`, instead of git `HEAD`. |
| `--jar <path>` | Use a local `wf-migrator` JAR (a JAR that is not the pinned release is reported as `custom jar`). |
| `--report-dir <dir>` | Default `<project>/target/asset-workflow-migration`. Must not be the project folder or one of its parents. |
| `--allow-dirty` | Run on a dirty git tree. |
| `--json` | Print the full result object. |

Outputs in the report dir: `asset-workflow-report.md` (review + checklist), `asset-workflow-result.json`, `tool/migration-report.md` and `tool/wf-migrator.log` (the tool's own output), and `baseline/` (the pre-run copy used by verification; emptied on every run, and only if this runner created it). A dry run uses a temporary baseline and leaves the report dir alone.

## What the tool does (wf-migrator 0.6.0)

- Looks at **enabled launchers** on `/content/dam` asset paths and migrates a model when a **top-level** step is `SUPPORTED`, custom Java, a script or `noop`. Steps nested in OR/AND splits are not inspected.
- Rewrites the migrated models, removing steps by category ([step-catalog.md](step-catalog.md)); disables **every** asset launcher (including those of workflows it does not migrate); deletes everything under `jcr_root/var/workflow`.
- Adds the modules `aem-cloud-migration.apps` (Custom Workflow Runner config, as XML) and `aem-cloud-migration.content` (processing profiles titled `Migrated from <model>` for top-level `NUI_MIGRATED` renditions), and wires them into the POMs.
- Writes `migration-report.md`. The exit code is `0` whether or not the run succeeds, so the skill also checks the log and the report.

## What the skill adds after the tool runs

Each item that changes something gets its own heading in `asset-workflow-report.md`.

These steps never modify the tool itself. They run on its output and are written for wf-migrator 0.6.0, the release the skill pins. When a later tool release covers one of them, the pin moves to that release and the matching step is retired. Report tool behaviour you rely on these steps for at [adobe/aem-cloud-migration](https://github.com/adobe/aem-cloud-migration/issues).

| Area | What the skill does | Automated |
|---|---|---|
| Completed step | Cloud Service post-processing workflows end with the DAM Update Asset Workflow Completed step. Move it to the end of the flow, or add it; list the steps that now run before it | Yes, with a review note |
| Steps inside OR/AND splits | Apply the same keep/remove rules inside branches; remove emptied splits; flatten AND splits left with one branch (renaming a moved step whose node name a sibling already uses — Oak rejects same-name siblings — and declaring on the root any namespace prefix only the removed split declared; a split whose prefix is bound to another namespace elsewhere in the model is kept); flag remaining OR routing scripts. Also wire models whose only real work is inside a split, and add the renditions of rendition steps inside splits to the processing profile | Yes, with review |
| `UNSUPPORTED` steps | Stop before the tool runs until each one is mapped or acknowledged (`--acknowledge`). Map simple ImageMagick `CommandLineProcess` commands to processing-profile renditions, including renditions-only workflows the tool does not migrate; per-step remediation for the rest. A rendition name produced twice with different settings stops instead of overwriting one | Partly |
| Custom Workflow Runner config | One `config.author/…CustomDamWorkflowRunnerImpl.cfg.json`, merged with any existing runner config | Yes |
| Overlaid OOTB models | Rename an overlaid `dam/update_asset` to `<name>-postprocessing`, keeping it inside a `filter.xml` root (`--rename-ootb-models`) | Yes (opt-in) |
| Processing profiles on folders | Folder → profile list from literal launcher globs, including the profiles the tool creates for workflows it does not migrate; optional repoinit config (`--emit-repoinit`) | Partly |
| Launcher conditions | The Custom Workflow Runner has no launcher conditions (e.g. `mimeType != video/.*`); checklist item suggesting a guard step | Checklist only |
| `/var/workflow` runtime models | Not packaged on Cloud Service. Gate on runtime models with no design-time model; checklist item to **Sync** each model | Gate + checklist |
| Tool success | Success = exit `0` + `Migration complete.` in the log + `migration-report.md` | Yes |
| File formatting | Where a file was rewritten whole, re-apply the known edits as minimal span edits when the result is equivalent, so license headers and comments stay; otherwise keep the tool's file | Yes, for known edits |
| Filter roots | Make processing-profile `filter.xml` roots absolute | Yes |
| Overlapping runner entries | On-prem, each launcher started its own workflow. When several runner entries match one asset, order narrower entries first; checklist item to merge the models | Partly — see below |

## Scope and honest automation

The tool run is deterministic, and so are the fixers — a second `--fix-only` run changes nothing. What cannot be generated is left as a precise checklist rather than guessed:

- **Custom workers.** ImageMagick options with no processing-profile equivalent (`-resize 25%`, watermarks, colour profiles, …) and InDesign / Word extraction need an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility) built in App Builder.
- **Custom Java steps** are kept, not reviewed. They must be Cloud Service compatible — no rendition writes (the microservices own renditions) and no local-binary assumptions. Route them to the Java patterns (Branch B) or the [`aem-workflow` skill](../../../aem-workflow/SKILL.md).
- **Not verified against AEM:** which runner entry wins when several match one asset (the skill assumes one post-processing workflow per asset and orders narrower entries first); whether the repoinit `processingProfile` property attaches the profile; sizes of format-only renditions (no `wid`/`hei`). The report flags each one; confirm them on an RDE ([`aem-rde` skill](../../../aem-rde/SKILL.md)).
