# Asset Workflow Migration — Context (Branch H)

Migrates on-premise / AMS **DAM asset-processing workflows** (enabled `DAM Update Asset` launchers, overlaid or custom asset workflow models, custom process steps) to AEM as a Cloud Service. On Cloud Service the **asset microservices** create renditions and extract metadata; anything else the old workflow did runs afterwards as a **post-processing workflow** started by the **Custom Workflow Runner** (`CustomDamWorkflowRunnerImpl`), and custom renditions move to **processing profiles**.

This branch runs Adobe's own **Asset Workflow Migration Tool** ([`adobe/aem-cloud-migration`](https://github.com/adobe/aem-cloud-migration), `wf-migrator` JAR). **The tool makes every change to the project.** `scripts/asset-workflow-run.js` only checks the environment, runs the tool and checks it finished; your job is to gather the user's decisions and guide the review. Do not re-implement or hand-patch what the tool does — if its output is wrong, tell the user and report it to the tool's repository.

Adobe docs: [Asset Workflow Migration Tool](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/migration-journey/refactoring-tools/asset-workflow-migration-tool), [asset microservices and post-processing workflows](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/manage/asset-microservices-configure-and-use). Step categories (what the tool keeps, removes or maps): [`workflowSteps.properties`](https://github.com/adobe/aem-cloud-migration/blob/master/src/main/resources/workflowSteps.properties).

## Does this project need it?

Only workflows that still do something on Cloud Service need migrating. The Step 0 runbook (pattern `assetWorkflowMigration`) lists enabled launchers whose glob is under `/content/dam`; it does not read the models. Open each launcher's model with the user:

- **Custom or supported steps** (custom Java, ECMA script, `CreateVersionProcess`, `ReplicationWorkflowProcess`, …) — becomes a post-processing workflow.
- **Only OOTB rendition / metadata steps with standard settings** — nothing to migrate; the microservices already do that work.
- **Non-standard renditions** (e.g. `CreateWebEnabledImageProcess` with custom sizes, simple ImageMagick `CommandLineProcess`) — the tool maps them to a `Migrated from <model>` processing profile.

## Prerequisites

- **Java 11+** on `PATH`, `curl` (the first run downloads the pinned JAR) and `git`.
- A **Maven multi-module project** with at least one `content-package` module (the tool rewrites those, adds `aem-cloud-migration.*` modules and edits the reactor POM).
- A **clean git tree**. The tool rewrites files in place, so the diff and the undo come from git. The script stops on a dirty tree; `--allow-dirty` overrides that.

## Tool version 0.7.0

The script pins `wf-migrator` **0.7.0** and checks the SHA-256 of the download. `--jar <path>` uses a local copy instead (the script then reports a custom JAR). Do not use 0.6.0 or older: they lack split handling, the `Completed` step, ImageMagick renditions, runner config merging and XML formatting ([adobe/aem-cloud-migration#25](https://github.com/adobe/aem-cloud-migration/pull/25)). To upgrade, change `TOOL_VERSION`, `TOOL_URL` and `TOOL_SHA256` in `asset-workflow-run.js` and run the opt-in end-to-end test (`ASSET_WF_E2E=1 npm test`).

## Run

```bash
node scripts/asset-workflow-run.js <projectRoot>   # [--jar <path>] [--report-dir <dir>] [--allow-dirty]
```

The tool exits `0` even when it fails, so the script counts a run as successful only if it printed `Migration complete.` **and** wrote `migration-report.md` (default `<project>/target/asset-workflow-migration/`, with `wf-migrator.log` next to it). Exit codes: `0` done, `1` tool failed, `2` stopped before changing anything. Never present a failed run as done.

What the tool does: disables the asset launchers, rewrites the models it migrates, writes processing profiles and a Custom Workflow Runner config (`/apps/aem-cloud-migration/config.author/…CustomDamWorkflowRunnerImpl.cfg.json`) into new `aem-cloud-migration.*` modules, **deletes every `jcr_root/var` workflow path** from the project and its filters (runtime models are regenerated on sync), and writes the report.

## Review with the user

Do this before anything is committed. To undo everything: `git checkout . && git clean -fd`.

1. **Go through `migration-report.md` section by section**: launchers disabled, runner configurations, models changed, paths deleted, processing profiles, **Migration Issues**.
2. **Check the script's warnings and `wf-migrator.log`.** The tool prints `Migration complete.` even when it skipped a launcher or model it could not parse (`Unable to parse …`), and it still deletes the `var` paths. A skipped model is **not** migrated: fix its XML and rerun from a clean tree.
3. **Read `git diff`.** Confirm each migrated model ends with `DAM Update Asset Completed` and each runner entry points at the right model and glob.
4. **Look at what the report does not list.** The tool disables the launcher of a model that has only rendition steps (for example OOTB steps plus a `CommandLineProcess`) but does not migrate or list that model. Open every model behind a disabled launcher and flag:
   - `CommandLineProcess` commands that are not simple ImageMagick conversions. The report lists the ones it could not map under *Migration Issues*; they need an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility).
   - Steps categorized `UNSUPPORTED` in `workflowSteps.properties` (for example `CreateSubAssetsProcess`, `IDSJobProcess`, `ExtractImagesProcess`). Ask whether what they produced is still needed and agree a replacement: a custom worker, a profile rendition, or dropping it.
5. **Custom Java steps** (a `PROCESS` that is not an Adobe class; the tool keeps them). For each one in the project source, check with the user that it:
   - **runs on Cloud Service** — it uses only APIs available there. Hand code that needs changes to the matching Branch B patterns (`asset-manager`, `replication`, `scr-to-osgi-ds`) instead of editing it here;
   - **does not write renditions** — renditions come from the processing profile; a step that writes them needs a custom worker instead.
6. Record decisions and anything accepted as-is, then let the user commit.

## Post-deploy checks (RDE or dev environment)

Deploy the migrated project (an RDE is quickest: [`aem-rde` skill](../../../aem-rde/SKILL.md)) and work through these with the user:

1. **Build and deploy.** `mvn clean install`; the new `aem-cloud-migration.*` modules must be in the all-package.
2. **Sync each migrated model**: open it in the workflow model editor and click **Sync**. `GET /var/workflow/models/<id>.json` must return `200`.
3. **Check the runner config** is active: the Developer Console (OSGi configurations) shows `CustomDamWorkflowRunnerImpl` with the expected `postProcWorkflowsByPath` / `postProcWorkflowsByExpression`. Look for overlapping entries; Adobe does not document which one wins when several match, so merge the models if the wrong one runs.
4. **Attach processing profiles**: Folder → Properties → Asset Processing. The tool cannot attach them; the report names the folders the old launchers covered.
5. **Upload test assets** to every mapped folder, one per mime type each old launcher handled. Check that the profile's renditions exist, and that **Tools → Workflow → Instances / Archive** shows one instance of the expected model per asset and that its custom steps did their work.
6. **Launcher conditions.** A launcher's `conditions` (for example `jcr:content/jcr:mimeType!=video/.*`) do not carry over to the runner. Upload an asset the old condition excluded and check the post-processing workflow handles or skips it as intended; add a guard step otherwise.
7. **Custom workers.** For every *Migration Issues* entry that needs one, deploy the App Builder worker, add it to a processing profile and repeat step 5.
