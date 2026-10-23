# Asset Workflow Migration — Step Catalog (Branch F)

How each workflow step is treated. Categories are those of Adobe's tool (`workflowSteps.properties` in [`adobe/aem-cloud-migration`](https://github.com/adobe/aem-cloud-migration/blob/master/src/main/resources/workflowSteps.properties), wf-migrator 0.6.0). The machine-readable copy is `scripts/asset-workflow-catalog.js` — keep both in sync with `TOOL_VERSION` in `scripts/asset-workflow-run.js` when the tool is upgraded.

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
| `NUI_MIGRATED` | Removed | Mapped by the tool to a rendition in the generated processing profile — only when the step is at the top level, and only for renditions that are not standard. Inside a split the skill maps it (see below). | `CreateWebEnabledImageProcess`, `ThumbnailProcess`, `FFMpegTranscodeProcess` |
| `UNSUPPORTED` | Removed | No direct equivalent — **gated**; see below. | `CommandLineProcess`, `CreateSubAssetsProcess`, `IDSJobProcess` |

**When is a model migrated?** The tool migrates a model when a **top-level** step is kept and is not only `OPTIONAL` / `REQUIRED`. This skill also wires models whose only real work (`SUPPORTED` / `CUSTOM` / `SCRIPT`) sits inside an OR/AND split. The same rules apply inside split branches: removable steps are dropped, emptied splits are removed, AND splits left with one branch are flattened — unless the split declares a namespace prefix that is bound to a different namespace elsewhere in the model, in which case it is kept so no property changes meaning.

A model with an `UNSUPPORTED` step, a rendition step inside a split, or a top-level rendition step that produces a rendition that is not standard (e.g. a 600×600 thumbnail), but no real work (**renditions only**, e.g. OOTB steps plus a `CommandLineProcess`), is not migrated: once its launcher is disabled nothing in it would run. Those steps are still gated and mapped below, and the model file is left unchanged.

The tool writes the renditions of top-level rendition steps to its `Migrated from <model>` processing profile, but those renditions are only generated once that profile is attached to the folders the launcher covered (checklist: `profiles-to-attach`). The dry run predicts this from thumbnail, web-rendition, video-thumbnail and PDF-preview steps; after the tool has run, any profile it created for a workflow is reported for attaching, including one for FFmpeg transcoding.

## Unsupported steps

The tool removes `UNSUPPORTED` steps from the models it migrates, and in the models it does not migrate the step stops running once the launcher is disabled. Either way the run **stops** before calling the tool unless each one is either fully mapped (below) or acknowledged with `--acknowledge <ShortName|fqcn>`. Remediation per step (also printed by the dry run and written into the report):

| Step | Replacement on Cloud Service |
|---|---|
| `CommandLineProcess` | Simple ImageMagick conversions → processing-profile renditions (automatic, below). Anything else → an [Asset Compute custom worker](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility). |
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

## `CommandLineProcess` → processing-profile renditions

Each entry in the step's `COMMANDS` and `THUMBNAILS` arguments is classified:

| Result | When | Effect |
|---|---|---|
| **standard** | Output is `cq5dam.thumbnail.48.48.png`, `140.100` or `319.319` **and** the command produces that size | Dropped — the standard profile already creates it. A command that writes another size under one of those names is **custom**. |
| **mapped** | `convert` / `magick [convert]` with input `${filename}`, only `-thumbnail` / `-resize` / `-scale WxH[>]`, `-quality`, `-strip`, `-flatten`, `-auto-orient`, `-define jpeg:size=…` (a decoder hint; other `-define` options change the output and are **custom**), and an output of `jpg`/`jpeg`/`png`/`gif`/`webp`/`tif`/`tiff`; or a `THUMBNAILS` size | A rendition (`fmt`, `wid`, `hei`, `qlt`, `includeMimeTypes` from `MIME_TYPES`) is added to the model's processing profile. `${…}` placeholders are stripped from the name (checklist: `rendition-name-changed`); format-only conversions have no size (checklist: `rendition-size-review`). |
| **custom** | Anything else — percent or other geometries, unknown options, other tools, other output formats | Needs a custom worker (checklist: `needs-custom-worker`). |

A step whose every command is **standard** or **mapped** passes the gate without `--acknowledge`.

**One rendition name, two definitions.** When two commands (in one or more steps of a model) produce the same rendition name, identical definitions become one rendition whose `includeMimeTypes` covers both; different definitions (size, format, quality, excluded types) are **custom** for the later one, which stops the run until acknowledged. The same applies to a rendition already in the model's processing profile: it is extended when identical; when it differs it is never overwritten, and every step that produces it stops the run until acknowledged.

## Rendition steps inside a split

The tool adds the renditions of `NUI_MIGRATED` rendition steps to the processing profile only when the step is at the top level of the model; inside an OR/AND split they are lost. The skill maps them the way the tool maps top-level ones and gates them like `UNSUPPORTED` steps:

| Step | Renditions added to the profile |
|---|---|
| `ThumbnailProcess` (`PROCESS_ARGS`) | A `cq5dam.thumbnail.W.H.png` per size. |
| `ThumbnailProcess` (`CONFIGS`) | A thumbnail per size (excluding `SKIP_MIME_TYPES`), the web rendition `cq5dam.thumbnail.W.H.<format>` (`WIDTH`, `HEIGHT`, `QUALITY`, `MIME_TYPE`, `KEEP_FORMAT_LIST`, `SKIP`), and `cq5dam.fpo.jpeg` when FPO creation is enabled. |
| `CreateWebEnabledImageProcess` | `cq5dam.web.W.H.<format>`. |

Standard renditions (48×48, 140×100 and 319×319 PNG thumbnails; the 1280×1280 JPEG web rendition at quality 90) are dropped. An output format the profile cannot produce, and any other rendition step (e.g. video thumbnails), stops the run until acknowledged; add those renditions to the processing profile by hand.
