# Asset Workflow Migration — Validation (Branch F)

Two layers: the **verification gates** that `scripts/asset-workflow-run.js` runs on every migration (offline, against the baseline copy), and the **post-deploy checks** on a Cloud Service environment that no script can do. See [context.md](context.md) for the flow.

## Verification gates (automatic)

`scripts/asset-workflow-verify.js` (`verifyMigration(pre, post, { fix, acknowledge })`) compares the pre-run inventory with the result. Any **failure** makes the run exit `1` with `Verification: FAIL`; the report lists each one. Do not present the migration as done until every failure is fixed or explained to the user. After fixing by hand, re-run with `--fix-only` — it re-applies the fixers (a no-op when nothing is left to fix) and re-verifies.

| Failure | Meaning | What to do |
|---|---|---|
| `custom-step-loss` | A `SUPPORTED`/`CUSTOM`/`SCRIPT` step (or its whole model) that ran before is gone. | Restore it from the baseline (`git show HEAD:<file>`) into the post-processing model. |
| `unsupported-step-removed` | A step whose renditions would be lost — an `UNSUPPORTED` step, or a rendition step inside a split — was removed (or no longer runs because its renditions-only workflow's launcher was disabled), and not everything it produced has a replacement. | Implement the remediation ([step-catalog.md](step-catalog.md#unsupported-steps)), then acknowledge it. |
| `custom-workflow-not-wired` | A model with real work has no Custom Workflow Runner entry. | Add `<path or expression>:<runtime model path>` to the author runner `.cfg.json`. |
| `runner-config-missing` / `runner-config-unparseable` / `runner-entry-malformed` | No usable author runner config, or an entry that is not `<pattern>:<model>`. | Fix the `.cfg.json` under `config.author`. |
| `runner-config-duplicate-pid` | More than one runner config applies on author; only one wins. | Merge them into one `config.author/…CustomDamWorkflowRunnerImpl.cfg.json`. |
| `runner-expression-targets-rendition` | An entry matches `jcr:content` or `renditions`. | The runner matches **asset** paths — match the asset instead. |
| `missing-completed-step` / `completed-step-not-last` | No `DamUpdateAssetWorkflowCompletedProcess`, more than one, nested in a split, or not last. | One Completed step, the last top-level step. |
| `split-contains-unsupported-step` / `non-runnable-step-remains` | A removable step (`NUI_*`, `DMS7_OOTB`, `UNSUPPORTED`, …) is still in the model. | Remove it, or remove the split if no real work is left. |
| `duplicate-node-name` | Two child nodes of one parent in a wired model share a name (e.g. after flattening a split by hand). Oak cannot import same-name siblings. | Rename all but one; node names in a flow carry no meaning, only their order does. |
| `unbound-namespace-prefix` | A wired model uses a namespace prefix (e.g. on a step that was inside a split) that no element declares, so the package does not install. | Declare it (`xmlns:<prefix>="…"`) on the root element. |
| `model-not-in-filter` | A model the runner points at is not under any `filter.xml` root of its module, so it is never installed. | Add `<filter root="<model conf path>"/>`. |
| `launcher-still-enabled` | An asset launcher on `/content/dam` is still enabled. | Disable it (`enabled="{Boolean}false"`); the runner starts the workflow. |
| `filter-root-not-absolute` | A `filter.xml` root does not start with `/`. | Prefix it with `/`. |
| `filter-covers-var-workflow` | A filter or packaged content still covers `/var/workflow`. | Remove it; runtime models are created by **Sync**. |
| `runtime-model-without-design-time` | A packaged runtime model was deleted and the project has no `/conf` model for it. | Export the model from the source system into `/conf/global/settings/workflow/models/<id>`, or acknowledge its path. |
| `profile-module-missing` | Renditions need a processing profile but there is no content module to hold it. | Create the profile in a content package (or in the UI). |

**Warnings** do not fail the run: `overlapping-workflows`, `model-not-transient`, `runner-model-not-in-project` (the runner points at a model defined elsewhere — confirm it exists on Cloud Service), `inventory` (unparseable files), plus the fixer's follow-ups. Those with a checklist item appear in the report's checklist instead of the warning list.

### Testing the scripts

`npm test` in `scripts/` runs the unit tests against a fixture project and the tool's recorded output, both kept in `scripts/fixtures/asset-workflow.js`. The end-to-end test runs the real JAR, checks its output still matches the recording, and is opt-in:

```bash
ASSET_WF_E2E=1 npm test                          # downloads the pinned JAR (needs Java 11+, git, curl)
ASSET_WF_E2E=1 ASSET_WF_JAR=/path/to/wf-migrator-0.6.0.jar npm test
```

## Post-deploy checks (on an RDE or dev environment)

These follow the report's checklist; work through them with the user. An RDE is quickest ([`aem-rde` skill](../../../aem-rde/SKILL.md)).

1. **Build and deploy.** `mvn clean install` on the project, then deploy. The new `aem-cloud-migration.*` modules must be in the all-package.
2. **Sync each model** (checklist `models-to-sync`): open it in the workflow model editor and click **Sync**. Check the runtime model exists: `GET /var/workflow/models/<id>.json` returns `200`.
3. **Check the runner config** is active: in the Developer Console (OSGi configurations) `CustomDamWorkflowRunnerImpl` shows the merged `postProcWorkflowsByPath` / `postProcWorkflowsByExpression`.
4. **Attach processing profiles** (checklist `profiles-to-attach`): Folder → Properties → Asset Processing. With `--emit-repoinit`, check the folder's `jcr:content/processingProfile` instead — this property is not confirmed by Adobe docs, so fall back to the UI if it does not take effect.
5. **Upload test assets** to every mapped folder, one per mime type each launcher handled. Check:
   - the renditions from the processing profile exist (names and sizes as in the report; `rendition-name-changed` and `rendition-size-review` items);
   - the post-processing workflow ran: **Tools → Workflow → Instances / Archive** shows one instance of the expected model per asset, and its custom steps did their work;
   - for assets matching several runner entries (`overlapping-workflows`), which model actually ran. The precedence is not documented by Adobe; if the wrong one runs, merge the models into one.
6. **Launcher conditions** (`launcher-condition-dropped`): upload an asset the old condition excluded (e.g. a video) and check the guard step skips it.
7. **Custom workers** (`needs-custom-worker`): deploy the App Builder worker, add it to a processing profile and repeat step 5.

Record the results (including anything accepted as-is) in the report before promoting to stage / production.
