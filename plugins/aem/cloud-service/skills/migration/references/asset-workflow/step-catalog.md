# Asset Workflow Migration — Step Catalog (Branch H)

How each workflow step is treated. Categories are those of Adobe's tool (`workflowSteps.properties` in [`adobe/aem-cloud-migration`](https://github.com/adobe/aem-cloud-migration/blob/master/src/main/resources/workflowSteps.properties), wf-migrator 0.7.0). The machine-readable copy is `scripts/asset-workflow-catalog.js` — keep both in sync with `TOOL_VERSION` in `scripts/asset-workflow-run.js` when the tool is upgraded.

## Categories

| Category | Kept? | Meaning | Examples |
|---|---|---|---|
| `SUPPORTED` | Kept | Runs in a post-processing workflow. **Real work** — a reason to migrate. | `CreateVersionProcess`, `ReplicationWorkflowProcess`, `XMPWritebackProcess`, `AutoTagAssetProcess`, language-copy steps |
| `REQUIRED` | Kept | `DamUpdateAssetWorkflowCompletedProcess` — must be the **last** step of every post-processing workflow. | — |
| `OPTIONAL` | Kept | Kept when the model is migrated, but never a reason to migrate it. | `SendTransientWorkflowCompletedEmailProcess` |
| `CUSTOM` | Kept | A Java process step not in the catalog — project code. **Real work.** Must be deployable on Cloud Service and must not write renditions. | `com.acme.dam.TagFromFolderProcess` |
| `SCRIPT` | Kept | An ECMA script step (process is a path). **Real work.** Review like custom code. | `/apps/acme/workflow/scripts/notify.ecma` |
| `NOOP` | Kept | `/libs/workflow/scripts/noop.ecma` placeholder (often an OR-split "else" branch). Not real work: a split whose branches hold only `noop` steps is removed. | — |
| `UNNECESSARY` | Removed | The microservices handle it. No action. | `GateKeeperProcess`, `DeleteImagePreviewProcess` |
| `NUI_OOTB` | Removed | The default microservices processing already does it. | `MetadataProcessorProcess`, `AssetOffloadingProcess` |
| `DMS7_OOTB` | Removed | Built-in Dynamic Media processing (when Dynamic Media is enabled). | `Scene7UploadProcess`, `DMImageProcess` |
| `NUI_MIGRATED` | Removed | Mapped by the tool to a rendition in the generated processing profile (only renditions that are not standard). `CommandLineProcess` is mapped only for simple ImageMagick commands — **gated**; see below. | `CreateWebEnabledImageProcess`, `ThumbnailProcess`, `FFMpegTranscodeProcess`, `CommandLineProcess` |
| `UNSUPPORTED` | Removed | No direct equivalent — **gated**; see below. | `CreateSubAssetsProcess`, `IDSJobProcess` |

**When is a model migrated?** The tool migrates a model when a step at any depth (top level or inside an OR/AND split) is kept and is not only `OPTIONAL` / `REQUIRED`. Inside split branches removable steps are dropped; an emptied branch gets a No Operation step and a split left with only No Operation steps is removed.

A model with rendition or `UNSUPPORTED` steps but no real work (**renditions only**, e.g. OOTB steps plus a `CommandLineProcess`) is not migrated: once its launcher is disabled nothing in it would run. The model file is left unchanged.

The tool writes the renditions it maps to a `Migrated from <model>` processing profile, but they are only generated once that profile is attached to the folders the launcher covered (checklist: `profiles-to-attach`; the report lists the folders).

## Steps that need acknowledging

The tool removes `UNSUPPORTED` steps and `CommandLineProcess` steps from the models it migrates, and in the models it does not migrate they stop running once the launcher is disabled. What they produced may have no replacement, so the run **stops** before calling the tool until each one is acknowledged with `--acknowledge <ShortName|fqcn>`. Remediation per step (also printed by the dry run and written into the report):

| Step | Replacement on Cloud Service |
|---|---|
| `CommandLineProcess` | The tool maps simple ImageMagick conversions to processing-profile renditions (below) and lists every other command under "Migration Issues" in its report (checklist: `needs-custom-worker`) — those need an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility). |
| `CameraRawHandlingProcess` | Camera RAW is processed by the microservices by default; check the standard renditions cover it. |
| `PdfRasterizerHandlingProcess` | PDF previews come from the microservices; add a profile rendition for custom sizes. |
| `AddPropertyWorkflowProcess` | Write the property from a custom post-processing step, or use a metadata profile. |
| `CreateSubAssetsProcess` | Sub-assets for multi-page documents come from the microservices. |
| `DownloadAssetProcess` | No replacement needed. |
| `ExtractImagesProcess` (Word) | A custom worker, if images must be extracted. |
| `ExtractPlainProcess` (Word) | Text extraction for search is done by the microservices. |
| `IDSJobProcess`, `INDDMediaExtractProcess`, `INDDPageExtractProcess` | InDesign Server is not supported; a custom worker. |
| `LightboxUpdateAssetProcess` | Lightbox does not exist on Cloud Service; remove. |
| `ProductAssetsUploadProcess` | PIM upload is not supported; remove or re-implement as custom code. |
| `SendDownloadAssetEmailProcess` | Download emails come from the Cloud Service download feature; remove. |
| `StartTrainingProcess`, `TransferTrainingDataProcess` | Smart-tag training is managed by Adobe; remove. |
| `SwitchEngineHandlingProcess`, `BatchThumbnailProcess`, `CreateThumbnailProcess` | Renditions come from the microservices; add profile renditions for custom sizes. |

## `CommandLineProcess` → processing-profile renditions (done by the tool)

The tool maps each ImageMagick `convert` command in the step's `COMMANDS` argument that only resizes, sets the quality or converts the format, and each `THUMBNAILS` size, to a rendition of the model's processing profile. Standard rendition names (`cq5dam.thumbnail.48.48.png`, `140.100`, `319.319`) produced at their standard size are dropped. Anything else — percent or other geometries, other options, other tools or output formats, a standard rendition name used for a different size, or a second, different definition of the same rendition name — is listed under **Migration Issues** in `tool/migration-report.md` and needs a custom worker. Check the generated renditions against the source system (names, sizes, formats) on an RDE.
