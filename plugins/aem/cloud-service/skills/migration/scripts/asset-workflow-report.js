'use strict';
// Markdown report for Branch F (asset workflow migration): what the tool and the fixers changed,
// the verification verdict (echoed, never recomputed), and the post-deploy checklist that has to be
// done on AEM as a Cloud Service because it cannot be expressed in code.
const fs = require('fs');
const path = require('path');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');

const ADVISORY = '> **Review before production:** the migrated models, runner config and processing profiles are generated. Review the diff, deploy to a development environment or RDE, upload test assets to every mapped folder and compare renditions and metadata with the source system before promoting.';

const CHANGES = {
  'completed-step': 'Completed step placed last',
  'non-runnable-steps': 'Steps that cannot run in post-processing removed; splits cleaned up',
  'renditions': 'Command-line renditions mapped to processing-profile renditions',
  'runner-config': 'Custom Workflow Runner config merged into one author .cfg.json',
  'model-rename': 'Overlaid OOTB models renamed',
  'profile-folders': 'Processing profiles attached to folders (repoinit)',
  'formatting': 'Rewritten files reduced to their real changes',
  'filter-roots': 'Filter roots made absolute',
  'runner-order': 'Overlapping runner entries ordered most specific first',
};

const CHECKLIST = [
  ['models-to-sync', 'Sync workflow models', 'Open each model in the workflow editor and click **Sync** so its runtime copy under `/var/workflow/models` exists. Runtime models are not packaged.'],
  ['profiles-to-attach', 'Attach processing profiles to folders', 'Folder → Properties → Asset Processing, or via the repoinit config if `--emit-repoinit` was used. Without a profile on a folder, mapped renditions are not generated there.'],
  ['needs-custom-worker', 'Build Asset Compute custom workers', `Commands that cannot be expressed as a processing-profile rendition. See ${C.DOCS.customWorker}.`],
  ['unsupported-step-removed', 'Handle removed steps that have no replacement', 'Each removed step lists its replacement. Re-run with `--acknowledge <step>` once handled.'],
  ['launcher-condition-dropped', 'Re-create launcher conditions', 'The Custom Workflow Runner has no conditions. Add a guard step (e.g. an OR split or a process step that exits early) at the start of the workflow.'],
  ['overlapping-workflows', 'Merge workflows that now compete for the same assets', 'These assets match several runner entries, but the Custom Workflow Runner starts one post-processing workflow per asset. Merge the steps they still need into one model.'],
  ['or-routing-script-review', 'Review OR-split routing', 'A branch was removed or emptied; check the remaining routing scripts still choose the intended branch.'],
  ['steps-now-before-completed', 'Check steps that now run before Completed', 'They used to run after the asset was marked processed; make sure they do not rely on that.'],
  ['rendition-name-changed', 'Update code that reads renamed renditions', 'Processing-profile rendition names cannot contain `${basename}`.'],
  ['rendition-size-review', 'Check rendition sizes', 'Format-only conversions have no size in the profile; set width/height if the original kept a specific size.'],
  ['participant-or-nontransient-step', 'Review participant steps and non-transient models', 'Post-processing workflows should run unattended and be transient.'],
  ['runner-config-runmode-specific', 'Review run-mode-specific runner configs', 'Only the author config is used; merge or remove the others.'],
  ['rename-target-exists', 'Resolve rename conflicts', 'A model could not be renamed because the target already exists.'],
  ['repoinit-skipped', 'Add the repoinit config manually', 'There was no module to hold it.'],
  ['profile-module-missing', 'Create processing profiles manually', 'There was no content module to hold them.'],
];

const cell = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const relTo = (root, f) => (f && root && path.isAbsolute(f) ? path.relative(root, f).split(path.sep).join('/') : f);

function workflowRows(fix) {
  return (fix.workflows || []).map(w => {
    const removed = w.removed.map(s => `${C.shortName(s.process)}${s.inSplit ? ' (in split)' : ''}`);
    const kept = (w.kept || []).filter(s => s.process !== C.COMPLETED_PROCESS).map(s => C.shortName(s.process));
    const name = `${w.renamedFrom ? `\`${w.confPath}\` (was \`${w.renamedFrom}\`)` : `\`${w.confPath}\``}${w.renditionsOnly ? ' (renditions only — not migrated)' : ''}`;
    return `| ${cell(name)} | ${cell([...new Set(w.launchers.map(l => l.glob))].join('<br>') || '—')} | ${cell(kept.join(', ') || '—')} | ${cell(removed.join(', ') || '—')} | ${w.profile ? `\`${cell(w.profile)}\`` : '—'} |`;
  });
}

function renderReport({ pre, post, fix, verify, tool, opts, gate }) {
  fix = fix || { actions: [], manual: [], workflows: [], changedFiles: [], deletedFiles: [] };
  verify = verify || { ok: false, failures: [], warnings: [] };
  tool = tool || {};
  opts = opts || {};
  const root = post && post.root;
  const L = [];
  L.push('# Asset Workflow Migration Report', '', ADVISORY, '');

  L.push('## Summary', '');
  L.push('| Item | Value |', '|---|---|');
  L.push(`| Project | \`${cell(root || '')}\` |`);
  L.push(`| Migration tool | ${tool.skipped ? 'not run (fix-only)' : `wf-migrator ${cell(tool.version || '?')} — ${tool.ok ? 'completed' : '**failed**'}`} |`);
  const assetWf = pre ? new Set(pre.workflows.filter(I.isAffected).map(w => `${w.module}|${w.model.confPath}`)).size : 0;
  const renditionsOnly = (fix.workflows || []).filter(w => w.renditionsOnly).length;
  L.push(`| Asset workflows with work to keep | ${assetWf} |`);
  L.push(`| Post-processing workflows | ${(fix.workflows || []).length - renditionsOnly} |`);
  if (renditionsOnly) L.push(`| Renditions-only workflows (processing profile only) | ${renditionsOnly} |`);
  if (fix.runner) L.push(`| Runner config | \`${cell(fix.runner.file)}\` — ${fix.runner.byPath.length} by path, ${fix.runner.byExpression.length} by expression |`);
  L.push(`| Files changed / deleted | ${(fix.changedFiles || []).length} / ${(fix.deletedFiles || []).length} |`);
  L.push(`| Verification | ${verify.ok ? '**PASS**' : `**FAIL** (${verify.failures.length})`} |`);
  L.push('');

  if ((fix.workflows || []).length) {
    L.push('## Asset workflows', '');
    L.push('| Model | Launcher globs (before) | Steps kept | Steps removed | Processing profile |', '|---|---|---|---|---|');
    L.push(...workflowRows(fix), '');
  }

  L.push('## Verification', '');
  if (verify.ok) L.push('- `ok`: **true** — no gate failures.');
  else {
    L.push('- `ok`: **false** — fix these before deploying:');
    for (const f of verify.failures) L.push(`  - \`${f.category}\`: ${f.detail}${f.file ? ` (\`${relTo(root, f.file)}\`)` : ''}`);
  }
  const otherWarnings = verify.warnings.filter(w => !CHECKLIST.some(c => c[0] === w.category));
  for (const w of otherWarnings) L.push(`- warning \`${w.category}\`: ${w.detail}`);
  L.push('');

  L.push('## Changes made by this skill', '');
  const byChange = new Map();
  for (const a of fix.actions || []) {
    if (!byChange.has(a.change)) byChange.set(a.change, []);
    byChange.get(a.change).push(a);
  }
  if (!byChange.size) L.push('- none.');
  for (const key of Object.keys(CHANGES).filter(k => byChange.has(k))) {
    L.push(`### ${CHANGES[key]}`, '');
    for (const a of byChange.get(key)) L.push(`- ${a.file ? `\`${a.file}\`: ` : ''}${a.detail}`);
    L.push('');
  }

  L.push('## Post-deploy checklist', '');
  L.push('Do these on AEM as a Cloud Service after deploying. They cannot be done in code.', '');
  let any = false;
  for (const [code, title, help] of CHECKLIST) {
    const items = (fix.manual || []).filter(m => m.code === code && !(code === 'unsupported-step-removed' && m.fullyMapped));
    if (!items.length) continue;
    any = true;
    L.push(`- [ ] **${title}** — ${help}`);
    for (const m of items) {
      const done = code === 'unsupported-step-removed' && m.acknowledged ? ' _(acknowledged)_' : '';
      L.push(`  - ${m.model ? `\`${m.model}\`: ` : ''}${m.detail}${done}`);
    }
  }
  const orphans = ((gate && gate.orphans) || []).filter(o => o.acknowledged);
  if (orphans.length) {
    any = true;
    L.push('- [ ] **Re-create deleted runtime-only models** — The tool deleted these runtime models because the project has no design-time model for them. Export them from the source system into `/conf/global/settings/workflow/models` if they are still needed.');
    for (const o of orphans) L.push(`  - \`${o.path}\` _(acknowledged)_`);
  }
  L.push('- [ ] **Reprocess existing assets** — post-processing runs only for new uploads; use Reprocess Assets on folders whose renditions must change.');
  if (opts.emitRepoinit) L.push('- [ ] **Verify the repoinit config on an RDE** before promoting; it sets the processing profile on folders at startup.');
  if (!any) L.push('', '_No follow-ups from the fixers._');
  L.push('');

  L.push('## References', '');
  L.push(`- Asset microservices and post-processing workflows: ${C.DOCS.microservices}`);
  L.push(`- Asset Workflow Migration Tool: ${C.DOCS.tool}`);
  L.push(`- Asset Compute custom workers: ${C.DOCS.customWorker}`);
  if (tool.reportPath) L.push(`- Tool report: \`${relTo(root, tool.reportPath)}\``);
  L.push('');
  return L.join('\n');
}

function writeReport(dir, markdown) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'asset-workflow-report.md');
  fs.writeFileSync(p, markdown);
  return p;
}

module.exports = { renderReport, writeReport, CHANGES, CHECKLIST };
