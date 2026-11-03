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
| The `wf-migrator` **0.7.0** JAR | downloaded on first run into `scripts/asset-workflow-tool/` (needs `curl` and network) and checked against the pinned SHA-256; or pass a local copy with `--jar <path>` | `ensureToolInstalled` (stops with exit 2 on a download failure or checksum mismatch) |

The dry run (`--dry-run`) and `--verify-only` need neither Java nor the JAR.

### Tool version: 0.7.0

The skill pins **[wf-migrator v0.7.0](https://github.com/adobe/aem-cloud-migration/releases/tag/v0.7.0)** (URL and SHA-256 in `scripts/asset-workflow-run.js`) and downloads it on first use. The older **v0.6.0 (May 2024)** has none of the fixes below; do not use it with this skill. `--jar <path>` overrides the download (for example offline, or behind a proxy that blocks GitHub downloads); a JAR whose checksum is not the pinned one is reported as `custom jar` in the report.

Behaviour that **needs 0.7.0** (marked _(0.7.0)_ under [What the tool does](#what-the-tool-does-wf-migrator-070)): steps inside OR/AND splits classified and removed, emptied branches filled with No Operation; the Completed step exactly once, as the last step; ImageMagick `CommandLineProcess` commands mapped to processing-profile renditions; one merged author runner config `.cfg.json`; XML formatting kept; per-profile absolute filter roots; packages that pass FileVault validation. The verification gates in [validation.md](validation.md) expect this output, so a v0.6.0 run fails them.

## The flow

Run everything from the migration skill directory (`plugins/aem/cloud-service/skills/migration/`). `<project>` is the Maven root.

1. **INVENTORY + PLAN** — dry run; changes nothing:

   ```bash
   node scripts/asset-workflow-run.js <project> --dry-run
   ```

   Prints, per affected model: launchers (glob + conditions), steps kept and removed (`*` = inside a split), then the **gate**: each removed step that may have no replacement — every `UNSUPPORTED` step and every `CommandLineProcess` (`STOP`) — and each packaged runtime model under `/var/workflow` with no design-time model (`STOP` — the tool deletes it). It also prints the [custom Java step review](#custom-java-step-review): one line per kept custom step with its outcome and evidence.

2. **CONFIRM WITH THE USER** — show the plan, then ask one decision at a time:
   - Each `STOP` step: is its remediation (printed under it; see [step-catalog.md](step-catalog.md#steps-that-need-acknowledging)) acceptable? Acknowledge with `--acknowledge <ShortName|fqcn>`.
   - Each `STOP` runtime model: export it into `/conf/global/settings/workflow/models/<id>` first, or acknowledge its `/var/workflow/models/<id>` path if it is obsolete.
   - Each custom Java step that needs action: read its helpers and agree the outcome ([below](#custom-java-step-review)). This does not block the tool, which keeps the steps either way.

   Never pass `--acknowledge all` without the user's explicit agreement: it silences the gate that stops the tool deleting work.

3. **EXECUTE + VERIFY** — one command:

   ```bash
   node scripts/asset-workflow-run.js <project> --acknowledge CommandLineProcess
   ```

   The first run downloads the pinned wf-migrator 0.7.0 JAR ([Tool version](#tool-version-070)); add `--jar <path>` to use a local copy instead.

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
| `--jar <path>` | A local `wf-migrator` JAR to run instead of the pinned 0.7.0 download (a JAR that is not the pinned release is reported as `custom jar`). |
| `--report-dir <dir>` | Default `<project>/target/asset-workflow-migration`. Must not be the project folder or one of its parents. |
| `--allow-dirty` | Run on a dirty git tree. |
| `--json` | Print the full result object. |

Outputs in the report dir: `asset-workflow-report.md` (review + checklist), `asset-workflow-result.json`, `tool/migration-report.md` and `tool/wf-migrator.log` (the tool's own output), and `baseline/` (the pre-run copy used by verification; emptied on every run, and only if this runner created it). A dry run uses a temporary baseline and leaves the report dir alone.

## What the tool does (wf-migrator 0.7.0)

Items marked _(0.7.0)_ are new in v0.7.0 ([adobe/aem-cloud-migration#25](https://github.com/adobe/aem-cloud-migration/pull/25)); v0.6.0 does not do them.

- Looks at **enabled launchers** on `/content/dam` asset paths and migrates a model when a step is `SUPPORTED`, custom Java, a script or `noop` — including steps inside OR/AND splits _(0.7.0)_.
- Rewrites the migrated models, removing steps by category ([step-catalog.md](step-catalog.md)). At every depth _(0.7.0)_: an emptied split branch gets a No Operation step, and a split left with only No Operation steps is removed. The Completed step runs exactly once, as the last step _(0.7.0)_.
- Maps rendition steps to renditions of a `Migrated from <model>` processing profile — including those inside splits _(0.7.0)_ — and simple ImageMagick `CommandLineProcess` commands _(0.7.0)_; lists every command it cannot map under **Migration Issues** in its report _(0.7.0)_.
- Disables **every** asset launcher (including those of workflows it does not migrate) and deletes everything under `jcr_root/var/workflow`.
- Writes the Custom Workflow Runner config in the new `aem-cloud-migration.apps` module: one author `…CustomDamWorkflowRunnerImpl.cfg.json`, merged with any existing runner config _(0.7.0)_. Profiles go to `aem-cloud-migration.content` with per-profile absolute filter roots _(0.7.0)_. Both are wired into the POMs, and the packages pass FileVault validation _(0.7.0)_. Changed XML files keep their formatting and comments _(0.7.0)_.
- Writes `migration-report.md`. The exit code is `0` whether or not the run succeeds, so the skill also checks the log and the report.

## What the skill adds

| Area | What the skill does |
|---|---|
| Pre-run gate | Stops before the tool runs on removed steps that may have no replacement (`UNSUPPORTED` steps, `CommandLineProcess`) and on runtime models with no design-time model, until each is acknowledged |
| Tool success | Success = exit `0` + `Migration complete.` in the log + `migration-report.md` |
| Verification | Compares the project before and after the run: no real work lost, every migrated model wired, Completed last, launchers disabled, filters and runner config valid ([validation.md](validation.md)) |
| Custom Java step review | Read-only review of each custom Java step the tool keeps, classified by what its class does ([below](#custom-java-step-review)) |
| Follow-ups | Read-only checklist from the tool's output and report: profiles to attach (with the folders, from literal launcher globs), commands that need a custom worker, launcher conditions the runner cannot express, overlapping runner entries, OR routing to review, steps now before Completed, models to sync |

Report tool behaviour that needs a fix at [adobe/aem-cloud-migration](https://github.com/adobe/aem-cloud-migration/issues) — the skill does not patch the tool's output.

## Scope and honest automation

What cannot be generated is left as a precise checklist rather than guessed:

- **Custom workers.** ImageMagick options with no processing-profile equivalent (`-resize 25%`, watermarks, colour profiles, …) and InDesign / Word extraction need an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility) built in App Builder.
- **Custom Java steps** are kept by the tool and reviewed read-only by the skill ([below](#custom-java-step-review)). The skill never edits Java: rewrites go through a processing profile, a custom worker or a Branch B pattern, each agreed with the user. For workflow-code questions beyond the review, use the [`aem-workflow` skill](../../../aem-workflow/SKILL.md).
- **Not verified against AEM:** which runner entry wins when several match one asset (merge the models into one); sizes of format-only renditions (no `wid`/`hei`). The report flags each one; confirm them on an RDE ([`aem-rde` skill](../../../aem-rde/SKILL.md)).

## Custom Java step review

The tool keeps every custom Java (`CUSTOM`) process step in the workflows it migrates, but on Cloud Service those steps run after the asset microservices, which own renditions and the binary. The runner reviews each kept step **read-only** (`asset-workflow-custom-steps.js`) and writes the result to the dry-run output, the **Custom Java steps** section of `asset-workflow-report.md` and `customSteps` in `asset-workflow-result.json`. It never edits project code.

**Finding the class.** The model's `PROCESS` value (an FQCN) is matched to `src/main/java/<package path>.java` in any module. If there is no match, the runner looks for a class whose `process.label` property equals `PROCESS` (`@Component(property = "process.label=…")` or SCR `@Property(name = "process.label", value = "…")`). No match, or more than one, means **unresolved**. Comments are ignored.

| Outcome | Found in the class | Action |
|---|---|---|
| `processing-profile-or-worker` | `addRendition`, `RenditionMaker`, `Layer`, `Gfx`, `AssetHandler` | Move the work to a processing-profile rendition or an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility), then drop the step |
| `custom-worker` | `Runtime.exec`, `ProcessBuilder`, `CommandLineProcess`, commons-exec | Re-implement as an Asset Compute custom worker |
| `manual-review` | `getOriginal().getStream()`, `java.io.File*`, temp files | Review: avoid loading the binary or using local files, or move the work to a custom worker |
| `pattern-handoff` | `com.day.cq.dam.api.AssetManager` → [asset-manager](../../../code-assessment/asset-manager/SKILL.md); `Replicator` → [replication](../../../code-assessment/replication/SKILL.md); Felix SCR annotations → [scr-to-osgi-ds](../../../code-assessment/references/scr-to-osgi-ds.md) | Fix it with that pattern (Branch B, its own session), then keep it |
| `keep-post-processing` | none of the above | Keep it as a post-processing step |
| `unresolved` | source not in the workspace | Not reviewed |

The first three are checked in that order and the first match wins; hand-offs are listed with any outcome. Every signal comes with its line number.

**Scope: the step's class only.** Helpers, base classes and called services are not scanned. The review lists the project classes the step imports as **helpers**. The agent then:

1. Reads each listed helper, and the base class and any services the step calls, before accepting `keep-post-processing` — a helper can write renditions or shell out where the scan cannot see it.
2. Judges the ambiguous cases from the code (for example a `getOriginal()` used only for metadata, or `java.io.File` used only for a path name), and tells the user when its judgement differs from the outcome.
3. For an **unresolved** step, asks the user where the class lives (another repository, a dependency) and reviews it there. Never guess what an unseen class does.
4. Runs hand-offs as separate Branch B sessions. Branch H never changes Java.
