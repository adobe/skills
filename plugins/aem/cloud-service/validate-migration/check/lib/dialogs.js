'use strict';

const { execFileSync } = require('child_process');

// Classic + Touch UI dialogs, folder or single-file serialization.
const DIALOG_PATH = /(jcr_root\/.*\/(?:_cq_dialog|cq:dialog|_cq_design_dialog|design_dialog|dialog)(?:\/\.content\.xml|\.xml))$/;

// Dialog files in a built package, scoped to the branch diff in auto mode.
function discoverDialogs(artifactPath, task) {
  const listing = execFileSync('unzip', ['-l', artifactPath], { encoding: 'utf8' });
  const dialogs = listing.split('\n').map((line) => (line.match(DIALOG_PATH) || [])[1]).filter(Boolean);
  const scoped = scopeToChangedFiles(dialogs, task);
  return scoped.length ? { dialogs: scoped } : null;
}

// Classify one dialog's XML. Coral 2 vs 3 differ by field type, not the shared
// dialog root: coral 2 = granite/ui/components/foundation/, coral 3 inserts /coral/.
function classifyDialog(xml) {
  if (/\bxtype\s*=\s*"/.test(xml)) return 'classic';
  if (/sling:resourceType\s*=\s*"granite\/ui\/components\/foundation\//.test(xml)) return 'coral2';
  if (/sling:resourceType\s*=\s*"granite\/ui\/components\/coral\/foundation/.test(xml)) return 'coral3';
  return 'other';
}

// Auto mode passes task.files (the branch diff); scope discovered dialogs to
// those. Explicit --pattern has no task.files → scan the whole package.
function scopeToChangedFiles(dialogs, task) {
  if (!task || !Array.isArray(task.files) || !task.files.length) return dialogs;
  const changed = task.files.map((f) => f.replace(/\\/g, '/'));
  return dialogs.filter((d) => changed.some((f) => f.endsWith(d)));
}

module.exports = { discoverDialogs, classifyDialog, scopeToChangedFiles };
