'use strict';
// Asset workflow step catalogue — ported from adobe/aem-cloud-migration
// src/main/resources/workflowSteps.properties (wf-migrator 0.6.0, Apache License 2.0,
// Copyright Adobe). Keep in sync with TOOL_VERSION in asset-workflow-run.js.
//
// Categories mirror the tool's WorkflowStepSupportStatus. CUSTOM (unknown Java class) and SCRIPT
// (ECMA script path) are this skill's names for what the tool treats as "unknown → keep".

const X = require('./asset-workflow-xml.js');

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
    'com.day.cq.dam.core.process.CreatePdfPreviewProcess',
    'com.day.cq.dam.core.process.CreateWebEnabledImageProcess',
    'com.day.cq.dam.video.FFMpegThumbnailProcess',
    'com.day.cq.dam.video.FFMpegTranscodeProcess',
    'com.day.cq.dam.core.process.ThumbnailProcess',
    'com.day.cq.dam.core.impl.process.ThumbnailProcess',
  ],
  UNSUPPORTED: [
    'com.day.cq.dam.cameraraw.process.CameraRawHandlingProcess',
    'com.day.cq.dam.core.process.CommandLineProcess',
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

// Per-step remediation for UNSUPPORTED steps (the tool removes them from the models it migrates).
const REMEDIATION = {
  'com.day.cq.dam.core.process.CommandLineProcess':
    'Simple ImageMagick resize/format conversions are mapped to processing-profile renditions by this skill. Anything else needs an Asset Compute custom worker (App Builder).',
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

// Rendition steps (NUI_MIGRATED) inside a split, which the tool skips when it builds the processing profile.
const NESTED_RENDITION_REMEDIATION = 'The tool adds the renditions of this step to the processing profile only when the step is at the top level of the model. Inside a split they are lost: add them to the processing profile by hand.';

const remediationFor = s => REMEDIATION[s.process] || (classifyStep(s.process) === 'NUI_MIGRATED' ? NESTED_RENDITION_REMEDIATION : null);

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

// ── Renditions a step produces ────────────────────────────────────────
// Ports of the tool's profile mappers (ThumbnailProcess, CreateWebEnabledImageProcess) plus the
// skill's mapping of ImageMagick command lines, as processing-profile renditions.

const STANDARD_THUMBS = /^cq5dam\.thumbnail\.(48\.48|140\.100|319\.319)\.png$/;
const FORMATS = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', tif: 'tiff', tiff: 'tiff' };
const CLP = 'com.day.cq.dam.core.process.CommandLineProcess';
const THUMBNAIL_PROCESSES = new Set(['com.day.cq.dam.core.process.ThumbnailProcess', 'com.day.cq.dam.core.impl.process.ThumbnailProcess']);
const WEB_PROCESS = 'com.day.cq.dam.core.process.CreateWebEnabledImageProcess';
const PDF_PREVIEW_PROCESS = 'com.day.cq.dam.core.process.CreatePdfPreviewProcess';
const DELETE_PREVIEW_PROCESS = 'com.day.cq.dam.core.process.DeleteImagePreviewProcess';
const FFMPEG_THUMBNAIL_PROCESS = 'com.day.cq.dam.video.FFMpegThumbnailProcess';

function mapCommand(cmd, include) {
  const t = cmd.trim().split(/\s+/);
  const out = t[t.length - 1];
  let i = t[0] === 'magick' && t[1] === 'convert' ? 2 : (t[0] === 'convert' || t[0] === 'magick') ? 1 : -1;
  if (i < 0) return { status: 'custom', command: cmd, reason: 'not an ImageMagick convert command' };
  let input = false, geom = null, qlt = null; const unknown = [];
  for (; i < t.length - 1; i++) {
    const tok = t[i];
    if (tok.includes('${filename}')) { input = true; continue; }
    if (tok === '-define') {
      // jpeg:size only speeds up decoding; any other -define changes the output.
      const v = t[++i];
      if (!/^jpeg:size=/i.test(v || '')) unknown.push(`-define ${v}`);
      continue;
    }
    if (tok === '-thumbnail' || tok === '-resize' || tok === '-scale') { geom = t[++i]; continue; }
    if (tok === '-quality') { qlt = t[++i]; continue; }
    if (['-strip', '-flatten', '-auto-orient'].includes(tok)) continue;
    unknown.push(tok);
  }
  const ext = (/\.([A-Za-z0-9]+)$/.exec(out) || [])[1];
  const fmt = ext && FORMATS[ext.toLowerCase()];
  if (!input) return { status: 'custom', command: cmd, reason: 'input is not ${filename}' };
  if (!fmt) return { status: 'custom', command: cmd, reason: `output format of ${out} has no processing-profile equivalent` };
  if (unknown.length) return { status: 'custom', command: cmd, reason: `ImageMagick options ${unknown.join(' ')} have no processing-profile equivalent` };
  let wid = null, hei = null;
  if (geom) {
    const g = /^(\d+)x(\d+)>?$/.exec(geom);
    if (!g) return { status: 'custom', command: cmd, reason: `geometry ${geom} (only WxH is supported by processing profiles)` };
    wid = g[1]; hei = g[2];
  }
  const std = STANDARD_THUMBS.exec(out);
  if (std) {
    // Every asset gets this rendition anyway; a command that writes something else under its name
    // cannot be replaced by a processing-profile rendition of the same name.
    if (`${wid}.${hei}` === std[1]) return { status: 'standard', command: cmd, output: out };
    return { status: 'custom', command: cmd, reason: `${out} is the name of a standard rendition (${std[1].replace('.', 'x')}), but this command produces ${geom || 'the original size'}` };
  }
  const dynamic = /\$\{[^}]+\}/.test(out);
  const name = out.replace(/\$\{[^}]+\}/g, '').replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.').replace(/-\./g, '.').replace(/^[-.]+/, '');
  return { status: 'mapped', command: cmd, output: out, nameChanged: dynamic, rendition: { name, fmt, wid, hei, qlt, include } };
}

// ── One rendition name, one definition ──
const untyped = v => (v == null ? '' : String(v).trim().replace(/^\{[A-Za-z]+\}/, ''));
const list = v => X.parseMultiValue(v).flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean);
const csv = a => (a.length ? [...new Set(a)].join(',') : null);
const num = v => { const s = untyped(v); return s === '0' ? '' : s; };
const fmtOf = v => { const s = untyped(v).toLowerCase(); return FORMATS[s] || s; };
const typeSet = v => [...new Set(list(v))].sort().join(',');

// Same output for the same asset: format, size, quality and excluded types. Included types may differ;
// they are combined.
const sameDefinition = (a, b) => fmtOf(a.fmt) === fmtOf(b.fmt) && num(a.wid) === num(b.wid) && num(a.hei) === num(b.hei)
  && num(a.qlt) === num(b.qlt) && typeSet(a.exclude ?? a.excludeMimeTypes) === typeSet(b.exclude ?? b.excludeMimeTypes);

// An empty list means every type, so it absorbs the other.
function mergeInclude(a, b) {
  const x = list(a), y = list(b);
  return x.length && y.length ? [...new Set([...x, ...y])].join(',') : '';
}

// A later entry for a rendition name already produced is merged into the first when the settings
// match (status "duplicate") and stopped when they differ (status "custom"), so neither overwrites
// the other. Mutates and returns `maps`.
function dedupeRenditions(maps) {
  const first = new Map();
  for (const m of maps) {
    if (m.status !== 'mapped' && m.status !== 'standard') continue;
    const k = m.rendition ? m.rendition.name : m.output;
    const prev = first.get(k);
    if (!prev) { first.set(k, m); continue; }
    if (prev.status === m.status && (m.status === 'standard' || sameDefinition(prev.rendition, m.rendition))) {
      if (m.rendition) prev.rendition.include = mergeInclude(prev.rendition.include, m.rendition.include) || 'image/.*';
      Object.assign(m, { status: 'duplicate', of: prev.command });
    } else {
      Object.assign(m, { status: 'custom', reason: `${prev.command} already produces ${k} with different settings` });
      delete m.rendition;
    }
  }
  return maps;
}

function mapUnsupported(step) {
  const res = [];
  if (step.process !== CLP) return res;
  const include = X.parseMultiValue(step.args.MIME_TYPES).join(',') || 'image/.*';
  for (const cmd of X.parseMultiValue(step.args.COMMANDS)) res.push(mapCommand(cmd, include));
  for (const sz of X.parseMultiValue(step.args.THUMBNAILS)) {
    const m = /^(\d+):(\d+)/.exec(sz);
    if (!m) continue;
    const name = `cq5dam.thumbnail.${m[1]}.${m[2]}.png`;
    if (STANDARD_THUMBS.test(name)) res.push({ status: 'standard', command: `THUMBNAILS ${sz}`, output: name });
    else res.push({ status: 'mapped', command: `THUMBNAILS ${sz}`, output: name, rendition: { name, fmt: 'png', wid: m[1], hei: m[2], qlt: null, include } });
  }
  // COMMANDS and THUMBNAILS can both produce the same file; report it once.
  return dedupeRenditions(res).filter(r => r.status !== 'duplicate');
}

// Renditions every asset gets anyway (the tool's isOotbRendition).
const isStandardRendition = r => (r.fmt === 'png' && ['319x319', '140x100', '48x48'].includes(`${r.wid}x${r.hei}`))
  || (r.fmt === 'jpeg' && r.wid === '1280' && r.hei === '1280' && r.qlt === '90');

// What a removed step produced, as processing-profile renditions. Command lines are parsed; thumbnail
// and web-rendition steps are mapped the way the tool maps them when they are at the top level of a
// model (it skips them inside splits). Other steps produce nothing the skill can map.
function mapRemovedStep(step) {
  if (step.process === CLP) return mapUnsupported(step);
  const a = step.args || {}, label = shortName(step.process), out = [];
  const push = (command, mime, r) => {
    if (!r.fmt) out.push({ status: 'custom', command, reason: `output format ${mime} has no processing-profile equivalent` });
    else if (isStandardRendition(r)) out.push({ status: 'standard', command, output: r.name });
    else out.push({ status: 'mapped', command, output: r.name, rendition: r });
  };
  const thumb = (command, wid, hei, exclude) => push(command, 'image/png', { name: `cq5dam.thumbnail.${wid}.${hei}.png`, fmt: 'png', wid, hei, qlt: null, include: 'image/.*', exclude });
  const web = (command, node) => {
    const mime = untyped(a.MIME_TYPE) || 'image/png', ext = mime.split('/')[1] || '';
    const wid = untyped(a.WIDTH) || null, hei = untyped(a.HEIGHT) || null;
    push(command, mime, { name: `cq5dam.${node}.${wid || 0}.${hei || 0}.${ext}`, fmt: FORMATS[ext.toLowerCase()] || null, wid, hei, qlt: untyped(a.QUALITY) || null,
      include: csv(list(a.KEEP_FORMAT_LIST)) || 'image/.*', exclude: csv(list(a.SKIP).map(x => x.replace(/^skip:/, ''))) });
  };
  if (THUMBNAIL_PROCESSES.has(step.process)) {
    if (a.PROCESS_ARGS != null) {
      for (const m of String(a.PROCESS_ARGS).matchAll(/(\d+):(\d+)/g)) thumb(`${label} ${m[1]}:${m[2]}`, m[1], m[2], null);
    } else {
      const exclude = csv(list(a.SKIP_MIME_TYPES).map(x => x.replace(/^skip:/, '')));
      for (const c of list(a.CONFIGS)) { const m = /^(\d+):(\d+)/.exec(c); if (m) thumb(`${label} ${m[1]}:${m[2]}`, m[1], m[2], exclude); }
      web(`${label} web rendition`, 'thumbnail');
      if (untyped(a.FPO_CREATION_ENABLED) === 'true') {
        push(`${label} FPO rendition`, 'image/jpeg', { name: 'cq5dam.fpo.jpeg', fmt: 'jpeg', wid: null, hei: null, qlt: untyped(a.FPO_QUALITY) || null, include: csv(list(a.CREATE_FPO_MIMETYPES)) || 'image/.*', exclude: null });
        out[out.length - 1].fullSize = true;
      }
    }
  } else if (step.process === WEB_PROCESS) web(label, 'web');
  return dedupeRenditions(out).filter(r => r.status !== 'duplicate');
}

// Mapping for several removed steps of one model, deduplicated across them. Entries that repeat an
// earlier rendition keep status "duplicate" so every step still has its full list.
function mapSteps(steps) {
  const lists = steps.map(mapRemovedStep);
  dedupeRenditions(lists.flat());
  return lists;
}

// Top-level steps whose renditions the tool writes to its "Migrated from <model>" processing profile
// (it leaves out the standard renditions). FFmpeg transcoding is not predicted: it depends on the
// project's video profiles.
function profileRenditionSteps(steps) {
  const deletesPreview = steps.some(s => s.process === DELETE_PREVIEW_PROCESS);
  return steps.filter(s => s.kind === 'process' && s.category === 'NUI_MIGRATED' && (
    s.process === PDF_PREVIEW_PROCESS ? !deletesPreview
      : s.process === FFMPEG_THUMBNAIL_PROCESS ? [...String((s.args || {}).PROCESS_ARGS ?? (s.args || {}).CONFIGS ?? '').matchAll(/(\d+):(\d+)/g)].some(m => !isStandardRendition({ fmt: 'png', wid: m[1], hei: m[2] }))
        : mapRemovedStep(s).some(r => r.status !== 'standard')));
}

module.exports = {
  CATALOG, COMPLETED_PROCESS, NOOP_SCRIPT, DOCS, REMEDIATION, NESTED_RENDITION_REMEDIATION,
  classifyStep, isKept, triggersMigration, isRealWork, shortName, remediationFor,
  CLP, mapCommand, mapUnsupported, mapRemovedStep, mapSteps, profileRenditionSteps, dedupeRenditions, sameDefinition, mergeInclude, typeSet, list,
};
