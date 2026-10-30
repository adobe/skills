'use strict';
// Asset workflow step catalogue — ported from adobe/aem-cloud-migration
// src/main/resources/workflowSteps.properties (wf-migrator 0.7.0, Apache License 2.0,
// Copyright Adobe). Keep in sync with TOOL_VERSION in asset-workflow-run.js.
//
// Categories mirror the tool's WorkflowStepSupportStatus. CUSTOM (unknown Java class) and SCRIPT
// (ECMA script path) are this skill's names for what the tool treats as "unknown → keep".

const COMPLETED_PROCESS = 'com.day.cq.dam.core.impl.process.DamUpdateAssetWorkflowCompletedProcess';
const NOOP_SCRIPT = '/libs/workflow/scripts/noop.ecma';

const CATALOG = {
  SUPPORTED: [
    'com.day.cq.dam.similaritysearch.internal.workflow.process.AutoTagAssetProcess',
    'com.day.cq.dam.core.impl.process.CreateAssetLanguageCopyProcess',
    'com.day.cq.wcm.workflow.process.CreateVersionProcess',
    'com.day.cq.dam.core.impl.process.TranslateAssetLanguageCopyProcess',
    'com.day.cq.dam.core.impl.process.UpdateAssetLanguageCopyProcess',
    'com.adobe.cq.workflow.replication.impl.ReplicationWorkflowProcess',
    'com.day.cq.dam.core.process.XMPWritebackProcess',
    'com.day.cq.dam.core.process.ScheduledPublishBPProcess',
    'com.day.cq.dam.core.process.ScheduledUnPublishBPProcess',
    'com.day.cq.dam.similaritysearch.internal.workflow.process.InitiateTrainingProcess',
    'com.day.cq.dam.similaritysearch.internal.workflow.process.AddExamplesProcess',
    'com.day.cq.dam.similaritysearch.internal.workflow.process.DoTrainingProcess',
    'com.day.cq.dam.core.process.AssetSetLastModifiedProcess',
  ],
  REQUIRED: [COMPLETED_PROCESS],
  OPTIONAL: ['com.day.cq.dam.core.impl.process.SendTransientWorkflowCompletedEmailProcess'],
  UNNECESSARY: [
    'com.day.cq.dam.core.impl.process.DamMetadataWritebackWorkflowCompletedProcess',
    'com.day.cq.dam.core.process.DeleteImagePreviewProcess',
    'com.day.cq.dam.s7dam.common.process.DMEncodeVideoWorkflowCompletedProcess',
    'com.day.cq.dam.core.process.GateKeeperProcess',
  ],
  NUI_OOTB: [
    'com.day.cq.dam.core.process.AssetOffloadingProcess',
    'com.day.cq.dam.core.process.MetadataProcessorProcess',
  ],
  DMS7_OOTB: [
    'com.adobe.cq.dam.dm.process.workflow.DMImageProcess',
    'com.day.cq.dam.s7dam.common.process.S7VideoThumbnailProcess',
    'com.day.cq.dam.scene7.impl.process.Scene7UploadProcess',
    'com.day.cq.dam.s7dam.common.process.VideoProxyServiceProcess',
    'com.day.cq.dam.s7dam.common.process.VideoThumbnailDownloadProcess',
    'com.day.cq.dam.s7dam.common.process.VideoUserUploadedThumbnailProcess',
    'com.day.cq.dam.scene7.impl.process.Scene7BatchUploadProcess',
    'com.day.cq.dam.scene7.impl.process.DirectBinaryAccessS7UplProcess',
  ],
  NUI_MIGRATED: [
    'com.day.cq.dam.core.process.CommandLineProcess',
    'com.day.cq.dam.core.process.CreatePdfPreviewProcess',
    'com.day.cq.dam.core.process.CreateWebEnabledImageProcess',
    'com.day.cq.dam.video.FFMpegThumbnailProcess',
    'com.day.cq.dam.video.FFMpegTranscodeProcess',
    'com.day.cq.dam.core.process.ThumbnailProcess',
    'com.day.cq.dam.core.impl.process.ThumbnailProcess',
  ],
  UNSUPPORTED: [
    'com.day.cq.dam.cameraraw.process.CameraRawHandlingProcess',
    'com.day.cq.dam.pdfrasterizer.process.PdfRasterizerHandlingProcess',
    'com.day.cq.dam.core.process.AddPropertyWorkflowProcess',
    'com.day.cq.dam.core.process.CreateSubAssetsProcess',
    'com.day.cq.dam.core.process.DownloadAssetProcess',
    'com.day.cq.dam.word.process.ExtractImagesProcess',
    'com.day.cq.dam.word.process.ExtractPlainProcess',
    'com.day.cq.dam.ids.impl.process.IDSJobProcess',
    'com.day.cq.dam.indd.process.INDDMediaExtractProcess',
    'com.day.cq.dam.indd.process.INDDPageExtractProcess',
    'com.day.cq.dam.core.impl.lightbox.LightboxUpdateAssetProcess',
    'com.day.cq.dam.pim.impl.sourcing.upload.process.ProductAssetsUploadProcess',
    'com.day.cq.dam.core.process.SendDownloadAssetEmailProcess',
    'com.day.cq.dam.similaritysearch.internal.workflow.smarttags.StartTrainingProcess',
    'com.day.cq.dam.similaritysearch.internal.workflow.smarttags.TransferTrainingDataProcess',
    'com.day.cq.dam.switchengine.process.SwitchEngineHandlingProcess',
    'com.day.cq.dam.core.impl.process.BatchThumbnailProcess',
    'com.day.cq.dam.core.process.CreateThumbnailProcess',
  ],
};

const STATUS_BY_PROCESS = new Map();
for (const [status, list] of Object.entries(CATALOG)) for (const p of list) STATUS_BY_PROCESS.set(p, status);

// Categories the tool keeps in a migrated post-processing model.
const KEPT = new Set(['SUPPORTED', 'REQUIRED', 'OPTIONAL', 'CUSTOM', 'SCRIPT']);

// Section names are given in text: Experience League heading anchors are generated and unstable.
const DOCS = {
  // Sections: "Post-processing workflows", "Configure the Custom Workflow Runner service",
  // "Standard configuration", "Best practices and limitations".
  microservices: 'https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/manage/asset-microservices-configure-and-use',
  customWorker: 'https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility',
  tool: 'https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/migration-journey/refactoring-tools/asset-workflow-migration-tool',
};

// Steps the tool removes whose output may be lost: every UNSUPPORTED step, and command lines, of which
// the tool maps only simple ImageMagick conversions to renditions. Each must be acknowledged.
const requiresAck = process => STATUS_BY_PROCESS.get(process) === 'UNSUPPORTED' || process === 'com.day.cq.dam.core.process.CommandLineProcess';

// Per-step remediation for steps that require acknowledging (the tool removes them from the models it migrates).
const REMEDIATION = {
  'com.day.cq.dam.core.process.CommandLineProcess':
    'The tool maps simple ImageMagick resize/format conversions to processing-profile renditions and lists every other command under "Migration Issues" in its report; those need an Asset Compute custom worker (App Builder).',
  'com.day.cq.dam.cameraraw.process.CameraRawHandlingProcess':
    'Camera RAW files are processed by asset microservices by default; check the standard renditions cover your needs.',
  'com.day.cq.dam.pdfrasterizer.process.PdfRasterizerHandlingProcess':
    'PDF previews/renditions come from asset microservices; add a processing-profile rendition for custom sizes.',
  'com.day.cq.dam.core.process.AddPropertyWorkflowProcess':
    'Write the property from a custom post-processing step, or use a metadata profile.',
  'com.day.cq.dam.core.process.CreateSubAssetsProcess':
    'Sub-asset generation for multi-page documents is handled by asset microservices.',
  'com.day.cq.dam.core.process.DownloadAssetProcess': 'No replacement needed in a post-processing workflow.',
  'com.day.cq.dam.word.process.ExtractImagesProcess': 'Use an Asset Compute custom worker if images must be extracted from Word documents.',
  'com.day.cq.dam.word.process.ExtractPlainProcess': 'Text extraction for search is done by asset microservices.',
  'com.day.cq.dam.ids.impl.process.IDSJobProcess': 'InDesign Server is not supported; use asset microservices or an Asset Compute custom worker.',
  'com.day.cq.dam.indd.process.INDDMediaExtractProcess': 'InDesign media extraction is not supported; use an Asset Compute custom worker.',
  'com.day.cq.dam.indd.process.INDDPageExtractProcess': 'InDesign page extraction is not supported; use an Asset Compute custom worker.',
  'com.day.cq.dam.core.impl.lightbox.LightboxUpdateAssetProcess': 'Lightbox is not part of AEM as a Cloud Service; remove.',
  'com.day.cq.dam.pim.impl.sourcing.upload.process.ProductAssetsUploadProcess': 'Product-asset upload (PIM) is not supported; remove or re-implement as custom code.',
  'com.day.cq.dam.core.process.SendDownloadAssetEmailProcess': 'Download emails are sent by the Cloud Service download feature; remove.',
  'com.day.cq.dam.similaritysearch.internal.workflow.smarttags.StartTrainingProcess': 'Smart tag training is managed by Adobe Sensei; remove.',
  'com.day.cq.dam.similaritysearch.internal.workflow.smarttags.TransferTrainingDataProcess': 'Smart tag training is managed by Adobe Sensei; remove.',
  'com.day.cq.dam.switchengine.process.SwitchEngineHandlingProcess': 'Rendition generation is handled by asset microservices; add processing-profile renditions if needed.',
  'com.day.cq.dam.core.impl.process.BatchThumbnailProcess': 'Thumbnails come from asset microservices.',
  'com.day.cq.dam.core.process.CreateThumbnailProcess': 'Thumbnails come from asset microservices; add processing-profile renditions for custom sizes.',
};

const remediationFor = s => REMEDIATION[s.process] || null;

function classifyStep(process) {
  if (!process) return 'NONE';
  if (STATUS_BY_PROCESS.has(process)) return STATUS_BY_PROCESS.get(process);
  if (process.startsWith('/')) return process === NOOP_SCRIPT ? 'NOOP' : 'SCRIPT';
  return 'CUSTOM';
}

// NOOP is not in the tool's catalogue; the tool keeps it at the top level as an unknown step.
const isKept = cat => KEPT.has(cat) || cat === 'NOOP';
// A workflow is migrated only if it has a step that is kept and is not merely OPTIONAL/REQUIRED.
const triggersMigration = cat => isKept(cat) && cat !== 'OPTIONAL' && cat !== 'REQUIRED' && cat !== 'NOOP';
// Steps that justify running a post-processing workflow (the rule the tool uses to decide whether a model can run on Cloud Service).
const isRealWork = cat => cat === 'SUPPORTED' || cat === 'CUSTOM' || cat === 'SCRIPT';

const shortName = process => (process && !process.startsWith('/') ? process.split('.').pop() : process || '');

module.exports = {
  CATALOG, COMPLETED_PROCESS, NOOP_SCRIPT, DOCS, REMEDIATION,
  classifyStep, isKept, triggersMigration, isRealWork, shortName, remediationFor, requiresAck,
};
