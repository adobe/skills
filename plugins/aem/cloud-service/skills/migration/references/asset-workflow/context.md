# Asset Workflow Migration — Context (Branch H)

Migrates on-premise / AMS **DAM asset-processing workflows** (enabled `DAM Update Asset` launchers, overlaid or custom asset workflow models, custom process steps) to AEM as a Cloud Service. On Cloud Service the **asset microservices** create renditions and extract metadata; anything else the old workflow did must run afterwards as a **post-processing workflow** started by the **Custom Workflow Runner** (`com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl`), and custom renditions move to **processing profiles**.

This branch wraps Adobe's own **Asset Workflow Migration Tool** ([`adobe/aem-cloud-migration`](https://github.com/adobe/aem-cloud-migration), `wf-migrator` JAR). **The tool makes every change to the project**; the Node scripts under `scripts/` only orchestrate it: a pre-run gate, verification gates on its output, and a report with a post-deploy checklist. They never edit project files. Adobe docs: [Asset Workflow Migration Tool](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/migration-journey/refactoring-tools/asset-workflow-migration-tool), [asset microservices and post-processing workflows](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/manage/asset-microservices-configure-and-use).

## Does this project need it?

Only workflows that still do something on Cloud Service need migrating. Run the dry run (below) or the Step 0 runbook (pattern `assetWorkflowMigration`, content-scan): it lists every enabled asset launcher whose model has

- **real work** — a `SUPPORTED`, custom Java (`CUSTOM`) or ECMA (`SCRIPT`) step, at the top level or inside a split. It becomes a post-processing workflow; or
- **renditions only** — rendition steps (`NUI_MIGRATED`, including ImageMagick `CommandLineProcess`) or `UNSUPPORTED` steps, but no real work. The tool disables the launcher and does not migrate the model; the renditions it can map go to a `Migrated from <model>` processing profile, which has to be attached to the folders the launcher covered.

Workflows made only of OOTB rendition / metadata steps with their standard settings need nothing — the microservices already do that work.

Step categories and what happens to each are in [step-catalog.md](step-catalog.md).

## Prerequisites

| Need | Why | Checked by |
|---|---|---|
| Java 11+ on `PATH` | runs the JAR | `checkJava` (stops with exit 2) |
| A Maven multi-module project: root `pom.xml` with `<modules>` and at least one `content-package` module | the tool only scans content packages | `checkProject` |
| A clean git tree (or `--allow-dirty`) | the tool rewrites files in place; the diff must be reviewable and `git checkout .` must undo it | `checkCleanGitTree` |
| Network on the first run (or `--jar <path>`) | downloads the pinned `wf-migrator-0.7.0.jar` into the gitignored `scripts/asset-workflow-tool/`, verified by SHA-256 | `ensureToolInstalled` |

There is no manual install step — do not ask the user to download the tool.

## The flow

Run everything from the migration skill directory (`plugins/aem/cloud-service/skills/migration/`). `<project>` is the Maven root.

1. **INVENTORY + PLAN** — dry run; changes nothing:

   ```bash
   node scripts/asset-workflow-run.js <project> --dry-run
   ```

   Prints, per affected model: launchers (glob + conditions), steps kept and removed (`*` = inside a split), then the **gate**: each removed step that may have no replacement — every `UNSUPPORTED` step and every `CommandLineProcess` (`STOP`) — and each packaged runtime model under `/var/workflow` with no design-time model (`STOP` — the tool deletes it).

2. **CONFIRM WITH THE USER** — show the plan, then ask one decision at a time:
   - Each `STOP` step: is its remediation (printed under it; see [step-catalog.md](step-catalog.md#steps-that-need-acknowledging)) acceptable? Acknowledge with `--acknowledge <ShortName|fqcn>`.
   - Each `STOP` runtime model: export it into `/conf/global/settings/workflow/models/<id>` first, or acknowledge its `/var/workflow/models/<id>` path if it is obsolete.

   Never pass `--acknowledge all` without the user's explicit agreement: it silences the gate that stops the tool deleting work.

3. **EXECUTE + VERIFY** — one command:

   ```bash
   node scripts/asset-workflow-run.js <project> --acknowledge CommandLineProcess
   ```

   Pre-flight → baseline copy → run the tool and check it succeeded → verification gates → follow-ups → report. Exit `0` = verification passed; `1` = the tool or verification failed; `2` = a pre-flight or gate stop, or bad arguments.

4. **REVIEW** — read `target/asset-workflow-migration/asset-workflow-report.md` with the user and review `git diff`. On a verification failure follow [validation.md](validation.md); never present a failed run as done. To undo: `git checkout . && git clean -fd`.

5. **POST-DEPLOY** — the report's **checklist** (sync models, attach profiles, custom workers, launcher conditions, overlapping workflows, …) can only be done on the Cloud Service environment. Hand it over explicitly; [validation.md](validation.md) lists the RDE checks.

**Already ran the tool by hand, or fixed something after a failed verification?** Use `--verify-only`: it rebuilds the pre-tool baseline from git `HEAD` (or `--baseline <dir>`) and re-runs the gates and the report on the current tree, without Java and without changing anything.

### Options

| Option | Effect |
|---|---|
| `--dry-run` | Inventory, plan and gate only. No changes. |
| `--acknowledge <list>` | Comma-separated step short names or FQCNs, `/var/workflow/models/<id>` paths, or `all`. Repeatable. |
| `--verify-only` | Skip the tool; verify the current tree against the git `HEAD` baseline and write the report. |
| `--baseline <dir>` | Baseline project copy for `--verify-only`, instead of git `HEAD`. |
| `--jar <path>` | Use a local `wf-migrator` JAR (a JAR that is not the pinned release is reported as `custom jar`). |
| `--report-dir <dir>` | Default `<project>/target/asset-workflow-migration`. Must not be the project folder or one of its parents. |
| `--allow-dirty` | Run on a dirty git tree. |
| `--json` | Print the full result object. |

Outputs in the report dir: `asset-workflow-report.md` (review + checklist), `asset-workflow-result.json`, `tool/migration-report.md` and `tool/wf-migrator.log` (the tool's own output), and `baseline/` (the pre-run copy used by verification; emptied on every run, and only if this runner created it). A dry run uses a temporary baseline and leaves the report dir alone.

## What the tool does (wf-migrator 0.7.0)

- Looks at **enabled launchers** on `/content/dam` asset paths and migrates a model when a step — at the top level or inside an OR/AND split — is `SUPPORTED`, custom Java, a script or `noop`.
- Rewrites the migrated models, removing steps by category ([step-catalog.md](step-catalog.md)) at every depth: an emptied split branch gets a No Operation step, and a split left with only No Operation steps is removed. The Completed step runs exactly once, as the last step.
- Maps rendition steps (top level and inside splits) and simple ImageMagick `CommandLineProcess` commands to renditions of a `Migrated from <model>` processing profile; lists every command it cannot map under **Migration Issues** in its report.
- Disables **every** asset launcher (including those of workflows it does not migrate) and deletes everything under `jcr_root/var/workflow`.
- Writes one author `…CustomDamWorkflowRunnerImpl.cfg.json`, merged with any existing runner config, in the new `aem-cloud-migration.apps` module; profiles go to `aem-cloud-migration.content` with absolute filter roots. Both are wired into the POMs. Changed XML files keep their formatting and comments.
- Writes `migration-report.md`. The exit code is `0` whether or not the run succeeds, so the skill also checks the log and the report.

## What the skill adds

| Area | What the skill does |
|---|---|
| Pre-run gate | Stops before the tool runs on removed steps that may have no replacement (`UNSUPPORTED` steps, `CommandLineProcess`) and on runtime models with no design-time model, until each is acknowledged |
| Tool success | Success = exit `0` + `Migration complete.` in the log + `migration-report.md` |
| Verification | Compares the project before and after the run: no real work lost, every migrated model wired, Completed last, launchers disabled, filters and runner config valid ([validation.md](validation.md)) |
| Follow-ups | Read-only checklist from the tool's output and report: profiles to attach (with the folders, from literal launcher globs), commands that need a custom worker, launcher conditions the runner cannot express, overlapping runner entries, OR routing to review, steps now before Completed, models to sync |

Report tool behaviour that needs a fix at [adobe/aem-cloud-migration](https://github.com/adobe/aem-cloud-migration/issues) — the skill does not patch the tool's output.

## Scope and honest automation

What cannot be generated is left as a precise checklist rather than guessed:

- **Custom workers.** ImageMagick options with no processing-profile equivalent (`-resize 25%`, watermarks, colour profiles, …) and InDesign / Word extraction need an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility) built in App Builder.
- **Custom Java steps** are kept, not reviewed. They must be Cloud Service compatible — no rendition writes (the microservices own renditions) and no local-binary assumptions. Route them to the Java patterns (Branch B) or the [`aem-workflow` skill](../../../aem-workflow/SKILL.md).
- **Not verified against AEM:** which runner entry wins when several match one asset (merge the models into one); sizes of format-only renditions (no `wid`/`hei`). The report flags each one; confirm them on an RDE ([`aem-rde` skill](../../../aem-rde/SKILL.md)).
