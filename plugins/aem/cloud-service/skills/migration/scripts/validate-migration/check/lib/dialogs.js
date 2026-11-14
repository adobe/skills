'use strict';

const { execFileSync } = require('child_process');

// Classic + Touch UI dialogs, folder or single-file serialization.
const DIALOG_PATH = /(jcr_root\/.*\/(?:_cq_dialog|cq:dialog|_cq_design_dialog|design_dialog|dialog)(?:\/\.content\.xml|\.xml))$/;

// Dialog files in a built package, scoped to the branch diff in auto mode.
function discoverDialogs(artifactPath, task) {
  const listing = execFileSync('unzip', ['-l', artifactPath], { encoding: 'utf8' });
  const dialogs = listing.split('\n').map((line) => (line.match(DIALOG_PATH) || [])[1]).filter(Boolean);
  const scoped = scopeToChangedFiles(dialogs, task);
  // changedOnly: dialogs come from this branch's diff, i.e. migration output.
  return scoped.length ? { dialogs: scoped, changedOnly: Boolean(task && Array.isArray(task.files) && task.files.length) } : null;
}

// Classify one dialog's XML. Coral 2 vs 3 differ by field type, not the shared
// dialog root: coral 2 = granite/ui/components/foundation/, coral 3 inserts /coral/.
function classifyDialog(xml) {
  if (/\bxtype\s*=\s*"/.test(xml)) return 'classic';
  if (/sling:resourceType\s*=\s*"granite\/ui\/components\/foundation\//.test(xml)) return 'coral2';
  if (/sling:resourceType\s*=\s*"granite\/ui\/components\/coral\/foundation/.test(xml)) return 'coral3';
  return 'other';
}

// Built-package subset of migration/references/legacy-ui/dialog/validation.md.
// Rule ids match that checklist, which stays the source of truth; checks that
// need the source tree (backup folders, sidecars, filter.xml) remain there.
const FORM_FIELD = /^granite\/ui\/components\/coral\/foundation\/form/;
function startTags(xml) {
  return [...xml.matchAll(/<([A-Za-z_][\w:.-]*)\b([^>]*)>/g)].map(([, , body]) =>
    Object.fromEntries([...body.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, v])));
}
function dialogRuleViolations(xml) {
  const blocking = [];
  const warnings = [];
  const tags = startTags(xml);
  if (/\bxtype\s*=\s*"/.test(xml)) blocking.push('1.2');
  if (/jcr:primaryType="cq:WidgetCollection"/.test(xml)) blocking.push('1.3');
  if (/sling:resourceType="granite\/ui\/components\/foundation\//.test(xml)) blocking.push('2.1');
  // A partial overlay (no root resource type) inherits the dialog root via Sling Resource Merger.
  const roots = (xml.match(/sling:resourceType="cq\/gui\/components\/authoring\/dialog"/g) || []).length;
  if (roots > 1 || (roots === 0 && tags[0] && tags[0]['sling:resourceType'])) blocking.push('2.2');
  if (/jcr:primaryType="cq:Widget"/.test(xml)) blocking.push('2.3');
  if (/<listeners\b/.test(xml)) blocking.push('3.1');
  if (/datepicker/.test(xml) && !/valueFormat=/.test(xml)) blocking.push('5.1');
  if (tags.some((a) => FORM_FIELD.test(a['sling:resourceType'] || '') && a.name && !/^[./]/.test(a.name))) blocking.push('7.1');
  if (/rootPath="\/libs\//.test(xml)) blocking.push('8.0');
  if (/fileupload/.test(xml) && !/useHTML5="\{Boolean\}true"/.test(xml)) warnings.push('6.1');
  if (/rootPath="[^"]*\/\/[^"]*"/.test(xml)) warnings.push('8.1b');
  return { blocking, warnings };
}

// Touch UI dialogs carry the Coral 3 contract; Classic `dialog` nodes are reported by classifyDialog.
function isTouchDialog(dialogPath) {
  return /\/(?:_cq_dialog|cq:dialog|_cq_design_dialog)(?:\/\.content\.xml|\.xml)$/.test(dialogPath);
}

// Short `apps/...` label for evidence.
function dialogLabel(dialogPath) {
  return dialogPath.replace(/^jcr_root\//, '').replace(/\/\.content\.xml$/, '');
}

// Auto mode passes task.files (the branch diff); scope discovered dialogs to
// those. Explicit --pattern has no task.files → scan the whole package.
function scopeToChangedFiles(dialogs, task) {
  if (!task || !Array.isArray(task.files) || !task.files.length) return dialogs;
  const changed = task.files.map((f) => f.replace(/\\/g, '/'));
  return dialogs.filter((d) => changed.some((f) => f.endsWith(d)));
}

module.exports = { discoverDialogs, classifyDialog, scopeToChangedFiles, dialogRuleViolations, isTouchDialog, dialogLabel };
