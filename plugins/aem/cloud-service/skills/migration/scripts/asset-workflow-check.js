'use strict';
// Branch H checks after wf-migrator ran. Reads the project before and after (and the tool's own
// migration report) and produces: the follow-ups still to do by hand (collectFollowUps), the
// verification gates (verifyMigration), and the markdown report (renderReport). Read-only:
// the tool owns every change.
const fs = require('fs');
const path = require('path');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');
const S = require('./asset-workflow-custom-steps.js');
const { X } = I;

const isAuthorScoped = c => c.runMode === '' || c.runMode === 'author';
const profileTitle = name => `Migrated from ${name}`;
const relTo = (root, f) => (f && root && path.isAbsolute(f) ? path.relative(root, f).split(path.sep).join('/') : f);
const entriesOf = c => [...c.byPath.map(e => Object.assign({ type: 'path' }, e)), ...c.byExpression.map(e => Object.assign({ type: 'expression' }, e))];

// A step is acknowledged by name (all of that process), via "all", or by its exact model|process|path key.
const ackMatches = (acks, process) => acks.includes('all') || acks.includes(process) || acks.includes(C.shortName(process));

// ── Follow-ups ────────────────────────────────────────────────────────

// Rows of the tool report's "## Migration Issues" table: | Action | Step | Reason |.
function parseToolIssues(md) {
  const out = [];
  const start = (md || '').search(/^## Migration Issues\s*$/m);
  if (start < 0) return out;
  const body = md.slice(start).split('\n').slice(1);
  for (const line of body) {
    if (/^## /.test(line)) break;
    if (!/^\|.*\|\s*$/.test(line) || /^\|\s*-+/.test(line)) continue;
    const cells = line.trim().slice(1, -1).split(' | ').map(s => s.trim());
    if (cells.length < 3 || cells[0] === 'Action') continue;
    const action = cells[0], reason = cells[cells.length - 1], step = cells.slice(1, -1).join(' | ');
    const m = /\bin (\S+)\s*$/.exec(step);
    out.push({ action, step, model: m ? m[1] : null, reason });
  }
  return out;
}

// Launcher globs → folders to attach profiles to.

function literalPrefix(glob) {
  let g = glob;
  const jc = g.indexOf('/jcr:content');
  if (jc >= 0) g = g.slice(0, jc);
  const m = /[()[\]*?+|{}^$\\]/.exec(g);
  if (!m) return { folder: g.replace(/\/$/, ''), exact: true };
  let p = g.slice(0, m.index);
  // "/content/dam(/.*)" — the group starts a new segment, so "/content/dam" is complete.
  const segmentBoundary = p.endsWith('/') || (g[m.index] === '(' && g[m.index + 1] === '/');
  if (!segmentBoundary) p = p.slice(0, p.lastIndexOf('/') + 1);
  return { folder: p.replace(/\/$/, '') || '/', exact: false };
}

// True when the pattern part of a glob names no folder, i.e. it matches every folder below the
// literal prefix (negative lookaheads only carve out exclusions).
function matchesEverything(glob, folder) {
  let rest = glob.slice(folder.length);
  const jc = rest.indexOf('/jcr:content');
  if (jc >= 0) rest = rest.slice(0, jc);
  rest = rest.replace(/renditions\/original$/, '').replace(/\(\?[!=][^()]*\)/g, '');
  return !/[A-Za-z0-9_]/.test(rest);
}

function exclusionsOf(glob) {
  const out = [];
  const re = /\(\?!([^()]*)\)/g;
  let m;
  while ((m = re.exec(glob))) out.push(m[1]);
  return out;
}

function foldersFor(launchers) {
  const out = [];
  for (const l of launchers) {
    const f = literalPrefix(l.glob);
    const all = !f.exact && matchesEverything(l.glob, f.folder);
    const wholeDam = (f.folder === '/content/dam' || f.folder === '/content' || f.folder === '/') && all;
    const prev = out.find(x => x.folder === f.folder && x.wholeDam === wholeDam && x.subtree === (f.exact || all));
    if (prev) {
      prev.exact = prev.exact && f.exact;
      if (!prev.globs.includes(l.glob)) prev.globs.push(l.glob);
      continue;
    }
    out.push({ folder: f.folder, exact: f.exact, subtree: f.exact || all, globs: [l.glob], wholeDam, excludes: exclusionsOf(l.glob) });
  }
  return out;
}

function describeFolder(f) {
  const ex = f.excludes.length ? `, except ${f.excludes.join(', ')}` : '';
  if (f.wholeDam) return `every top-level folder under /content/dam (the launcher covered the whole DAM${ex})`;
  if (f.exact) return f.folder;
  if (f.subtree) return `${f.folder} (covers its sub-folders${ex})`;
  return `folders under ${f.folder} matching ${f.globs.join(' or ')}`;
}

function overlapDetail(o) {
  const kind = e => (e.type === 'path' ? 'path' : 'expression');
  const which = o.mutual ? 'They match the same assets, so order cannot decide.' : o.narrow.type === o.broad.type ? `The more specific ${kind(o.narrow)} is listed first.` : 'Path and expression entries are separate lists, so order cannot decide.';
  return `Assets such as ${o.sample} match ${kind(o.narrow)} ${o.narrow.match} → ${o.narrow.model} and ${kind(o.broad)} ${o.broad.match} → ${o.broad.model}, but only one post-processing workflow runs per asset. ${which} If these assets need the steps of both, merge them into one model, then confirm on an RDE.`;
}

// Process steps (no-ops aside) anywhere inside one split, by class.
function stepCounts(split) {
  const out = new Map();
  for (const b of split.branches || []) {
    for (const s of I.flattenSteps(b.steps)) {
      if (s.kind === 'process' && s.category !== 'NOOP') out.set(s.process, (out.get(s.process) || 0) + 1);
    }
  }
  return out;
}

function lostSteps(preSplit, postSplit) {
  const after = stepCounts(postSplit);
  for (const [p, n] of stepCounts(preSplit)) if ((after.get(p) || 0) < n) return true;
  return false;
}

function collectFollowUps({ pre, post, acknowledge, toolReport }) {
  const acks = (acknowledge || []).map(String);
  const manual = [];
  const note = (code, model, detail, extra) => manual.push(Object.assign({ code, model, detail }, extra || {}));

  const authorCfgs = post.runnerConfigs.filter(isAuthorScoped);
  const entries = authorCfgs.flatMap(entriesOf);
  const wired = new Set(entries.map(e => e.model));

  const workflows = [];
  for (const w of I.affectedWorkflows(pre)) {
    const m = w.model;
    const pm = post.models.find(x => x.confPath === m.confPath && x.module === w.module) || null;
    const prof = post.profiles.find(p => p.title === profileTitle(m.name));
    const migrated = !!pm && wired.has(pm.runtimePath);
    const wf = {
      confPath: m.confPath, runtimePath: m.runtimePath, name: m.name, migrated, renditionsOnly: I.isRenditionsOnly(w),
      removed: m.flat.filter(s => s.kind === 'process' && !C.isKept(s.category)).map(s => ({ node: s.node, path: s.path, process: s.process, category: s.category, inSplit: !!s.split })),
      kept: pm ? pm.flat.filter(s => s.kind === 'process' && s.process !== C.COMPLETED_PROCESS && s.category !== 'NOOP').map(s => ({ node: s.node, path: s.path, process: s.process })) : [],
      profile: prof ? prof.repoPath : null,
      launchers: w.launchers.map(l => ({ id: l.id, glob: l.glob, conditions: l.conditions || [], synthetic: !!l.synthetic })),
    };
    wf.folders = foldersFor(wf.launchers);
    workflows.push(wf);

    if (wf.profile) note('profiles-to-attach', wf.confPath, `Attach ${wf.profile} to: ${wf.folders.map(describeFolder).join('; ')}`, { profile: wf.profile, folders: wf.folders });

    for (const s of pm ? m.flat.filter(x => x.kind === 'or') : []) {
      const ps = pm.flat.find(x => x.kind === 'or' && x.path === s.path);
      if (ps && lostSteps(s, ps)) note('or-routing-script-review', wf.confPath, `OR split ${s.path} still routes work; review its routing scripts.`);
    }

    if (migrated) {
      const conds = new Map();
      for (const l of wf.launchers.filter(x => x.conditions.length)) {
        const k = l.conditions.join(' AND ');
        if (!conds.has(k)) conds.set(k, []);
        conds.get(k).push(l.id);
      }
      for (const [k, ids] of conds) note('launcher-condition-dropped', wf.confPath, `${k} (launcher${ids.length > 1 ? 's' : ''} ${ids.join(', ')}) — the Custom Workflow Runner has no conditions; add a guard step at the start of the workflow.`);

      // Steps that ran after Completed in the source now run before it (the tool moves Completed last).
      const top = m.steps;
      const idx = top.findIndex(s => s.process === C.COMPLETED_PROCESS);
      const after = idx < 0 ? [] : top.slice(idx + 1).filter(s => s.kind === 'process' && C.isKept(s.category) && s.category !== 'NOOP' && pm.flat.some(x => x.process === s.process));
      if (after.length) note('steps-now-before-completed', wf.confPath, `Now run before Completed: ${after.map(s => C.shortName(s.process)).join(', ')} — check they do not depend on processing having finished.`);

      for (const o of pm.flat.filter(x => x.kind === 'other')) note('participant-or-nontransient-step', wf.confPath, `${o.node} (${o.resourceType}) is not an automatic process step; post-processing workflows should run unattended.`);
      if (!pm.transient) note('participant-or-nontransient-step', wf.confPath, 'Model is not transient; Adobe recommends transient post-processing workflows.');
    }

    for (const s of m.flat.filter(x => x.kind === 'process' && C.requiresAck(x.process))) {
      const what = migrated ? 'removed' : 'no longer runs (its launcher is disabled and the model is not migrated)';
      note('unsupported-step-removed', wf.confPath, `${C.shortName(s.process)} (${s.node}) ${what}. ${C.remediationFor(s) || ''}`.trim(), { process: s.process, path: s.path, acknowledged: ackMatches(acks, s.process) });
    }
    if (migrated) note('models-to-sync', wf.confPath, `After deploy, open ${wf.confPath} in the workflow editor and click Sync so ${wf.runtimePath} exists.`);
  }

  for (const i of parseToolIssues(toolReport)) {
    const wf = workflows.find(x => x.name === i.model);
    note('needs-custom-worker', wf ? wf.confPath : i.model, `${i.step} — ${i.reason}`, { docs: C.DOCS.customWorker });
  }

  for (const o of I.runnerOverlaps(entries)) note('overlapping-workflows', I.confPathFor(o.narrow.model), overlapDetail(o), { sample: o.sample, models: [o.narrow.model, o.broad.model] });

  const cfg = authorCfgs.find(c => c.module === I.MIGRATION_APPS) || authorCfgs[0];
  const runner = cfg ? { file: relTo(post.root, cfg.file), byPath: cfg.byPath.map(e => e.raw), byExpression: cfg.byExpression.map(e => e.raw) } : null;
  return { workflows, manual, runner };
}

// ── Verification gates ────────────────────────────────────────────────
// Compares the pre-run inventory (baseline) with the inventory after wf-migrator ran and fails on
// anything that would silently lose work or break on AEM as a Cloud Service.

// Child nodes that share a name with an earlier sibling (Oak cannot import same-name siblings).
function duplicateSiblings(file) {
  let doc; try { doc = X.parseXml(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const out = new Set();
  const visit = (el, p) => {
    const seen = new Set();
    for (const c of el.children) {
      if (seen.has(c.name)) out.add(`${p}/${c.name}`);
      seen.add(c.name);
      visit(c, `${p}/${c.name}`);
    }
  };
  visit(X.rootElement(doc), '');
  return [...out];
}

function unboundIn(file) {
  try { return X.unboundPrefixes(X.parseXml(fs.readFileSync(file, 'utf8'))); } catch { return []; }
}

function acknowledgedList(opts) {
  const list = (opts.acknowledge || []).map(String);
  for (const m of (opts.followUps && opts.followUps.manual) || []) {
    if (m.code === 'unsupported-step-removed' && m.acknowledged) list.push(`${m.model}|${m.process}|${m.path}`);
  }
  return list;
}

// Acknowledged by name (all of that process), or through the follow-ups for that step only.
const isAcked = (acks, model, process, stepPath) => ackMatches(acks, process) || acks.includes(`${model}|${process}|${stepPath}`);
const lostWhy = s => `not everything it produced has a replacement. ${C.remediationFor(s) || ''} Re-run with --acknowledge ${C.shortName(s.process)} once handled.`;

function processCounts(steps, pred) {
  const out = new Map();
  for (const s of steps) if (s.kind === 'process' && pred(s)) out.set(s.process, (out.get(s.process) || 0) + 1);
  return out;
}

function verifyMigration(pre, post, opts) {
  opts = opts || {};
  const failures = [], warnings = [];
  const fail = (category, detail, file) => failures.push({ category, detail, file: file || null });
  const warn = (category, detail, file) => warnings.push({ category, detail, file: file || null });
  const acks = acknowledgedList(opts);

  // ── Runner configuration ──
  const authorCfgs = post.runnerConfigs.filter(isAuthorScoped);
  if (authorCfgs.length > 1) {
    fail('runner-config-duplicate-pid', `${authorCfgs.length} Custom Workflow Runner configs apply on author (${authorCfgs.map(c => c.repoPath).join(', ')}); only one is used, the others are ignored.`);
  }
  for (const c of post.runnerConfigs) if (c.error) fail('runner-config-unparseable', `${c.repoPath}: ${c.error}`, c.file);
  const wired = new Map();
  for (const c of authorCfgs) {
    for (const e of [...c.byPath, ...c.byExpression]) {
      if (!e.model) { fail('runner-entry-malformed', `${c.repoPath}: "${e.raw}" is not <pattern>:<model path>`, c.file); continue; }
      wired.set(e.model, (wired.get(e.model) || []).concat(e.match));
      if (/\/jcr:content|renditions/.test(e.match)) fail('runner-expression-targets-rendition', `${e.raw}: the Custom Workflow Runner matches asset paths, not renditions or jcr:content.`, c.file);
    }
  }
  for (const model of wired.keys()) {
    const conf = I.confPathFor(model);
    if (!post.models.some(m => m.confPath === conf)) warn('runner-model-not-in-project', `${model} is not defined in this project; make sure it exists on AEM as a Cloud Service (OOTB or deployed elsewhere).`);
  }
  for (const c of authorCfgs) {
    for (const o of I.runnerOverlaps(entriesOf(c))) warn('overlapping-workflows', `${o.sample} matches ${o.narrow.raw} and ${o.broad.raw}; only one post-processing workflow runs per asset.`, c.file);
  }

  // ── Per asset workflow ──
  const assetWorkflows = pre.workflows.filter(w => w.model && w.summary && w.summary.hasRealWork);
  if (assetWorkflows.length && !authorCfgs.length) fail('runner-config-missing', `No author Custom Workflow Runner config (${I.RUNNER_PID}) found; ${assetWorkflows.length} asset workflow(s) with real work would never run.`);

  const seen = new Set();
  for (const w of assetWorkflows) {
    const key = `${w.module}|${w.model.confPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const confPath = w.model.confPath;
    const pm = post.models.find(m => m.confPath === confPath && m.module === w.module);
    if (!pm) { fail('custom-step-loss', `${w.model.confPath}: model was deleted but it had steps that must keep running.`, w.model.file); continue; }

    // Every step with real work (custom, script, supported, optional) must survive, at any depth.
    const before = processCounts(w.model.flat, s => C.isRealWork(s.category));
    const after = processCounts(pm.flat, s => C.isRealWork(s.category));
    for (const [proc, n] of before) {
      const left = after.get(proc) || 0;
      if (left < n) fail('custom-step-loss', `${confPath}: ${n - left} × ${C.shortName(proc)} (${C.classifyStep(proc)}) missing after migration.`, pm.file);
    }

    if (!wired.has(pm.runtimePath)) fail('custom-workflow-not-wired', `${confPath} still has steps to run but no Custom Workflow Runner entry points at ${pm.runtimePath}.`, pm.file);

    const top = pm.steps;
    const doneIdx = top.map((s, i) => (s.process === C.COMPLETED_PROCESS ? i : -1)).filter(i => i >= 0);
    if (!doneIdx.length) fail('missing-completed-step', `${confPath}: no DAM Update Asset Workflow Completed step; post-processing never signals completion.`, pm.file);
    else if (doneIdx.length > 1 || doneIdx[0] !== top.length - 1) fail('completed-step-not-last', `${confPath}: the Completed step must be the single last top-level step.`, pm.file);
    if (pm.flat.some(s => s.split && s.process === C.COMPLETED_PROCESS)) fail('completed-step-not-last', `${confPath}: a Completed step is nested in a split.`, pm.file);

    for (const s of pm.flat.filter(x => x.kind === 'process' && !C.isKept(x.category))) {
      fail(s.split ? 'split-contains-unsupported-step' : 'non-runnable-step-remains', `${confPath}: ${C.shortName(s.process)} (${s.category}) at ${s.path} cannot run in a post-processing workflow.`, pm.file);
    }

    for (const s of w.model.flat.filter(x => x.kind === 'process' && C.requiresAck(x.process))) {
      const still = pm.flat.some(x => x.process === s.process);
      if (!still && !isAcked(acks, confPath, s.process, s.path)) {
        fail('unsupported-step-removed', `${w.model.confPath}: ${C.shortName(s.process)} at ${s.path} was removed and ${lostWhy(s)}`.replace(/\s+/g, ' ').trim(), pm.file);
      }
    }
    if (!pm.transient) warn('model-not-transient', `${confPath}: Adobe recommends transient post-processing workflows.`, pm.file);
  }

  // Renditions-only workflows are not migrated: the tool disables their launchers, so their unsupported
  // steps stop running even though they are still in the (now unused) model. Each needs an acknowledgement.
  const seenRo = new Set();
  for (const w of pre.workflows.filter(I.isRenditionsOnly)) {
    const key = `${w.module}|${w.model.confPath}`;
    if (seen.has(key) || seenRo.has(key)) continue;
    seenRo.add(key);
    const pm = post.models.find(m => m.confPath === w.model.confPath && m.module === w.module);
    for (const s of w.model.flat.filter(x => x.kind === 'process' && C.requiresAck(x.process))) {
      if (isAcked(acks, w.model.confPath, s.process, s.path)) continue;
      fail('unsupported-step-removed', `${w.model.confPath}: ${C.shortName(s.process)} at ${s.path} no longer runs (the launcher is disabled and the model is not migrated) and ${lostWhy(s)}`.replace(/\s+/g, ' ').trim(), (pm || w.model).file);
    }
  }

  // ── Post-processing model structure ──
  for (const m of post.models.filter(x => wired.has(x.runtimePath))) {
    if (m.filtered === false) fail('model-not-in-filter', `${m.confPath} is wired in the runner config but no filter root in ${m.module}'s filter.xml covers it, so it is never installed. Add <filter root="${m.confPath}"/>.`, m.file);
    for (const p of duplicateSiblings(m.file)) fail('duplicate-node-name', `${m.confPath}: more than one child node at ${p}; Oak cannot import same-name siblings. Rename all but one.`, m.file);
    const unbound = unboundIn(m.file);
    if (unbound.length) fail('unbound-namespace-prefix', `${m.confPath}: namespace prefix(es) ${unbound.join(', ')} used but not declared; the package will not install. Declare them on the root element.`, m.file);
  }

  // ── Launchers ──
  for (const l of post.launchers.filter(x => x.enabled && x.isAsset)) {
    fail('launcher-still-enabled', `${l.path} (glob ${l.glob}) is still enabled; on AEM as a Cloud Service asset processing is triggered by the Custom Workflow Runner, not by launchers on /content/dam.`, l.file);
  }

  // ── Filters ──
  for (const f of post.filters) {
    for (const e of f.entries) {
      if (e.root && !e.root.startsWith('/')) fail('filter-root-not-absolute', `${f.module}: filter root "${e.root}" must start with "/".`, f.file);
      if (e.root === '/var' || e.root === '/var/workflow' || e.root.startsWith('/var/workflow/')) fail('filter-covers-var-workflow', `${f.module}: filter root ${e.root} overwrites runtime workflow models; generate them with Sync instead.`, f.file);
    }
  }
  for (const mod of post.modules.filter(m => m.contentPackage)) {
    const d = path.join(mod.dir, I.JCR_ROOT_REL, 'var', 'workflow');
    if (fs.existsSync(d)) fail('filter-covers-var-workflow', `${mod.name}: ${path.relative(post.root, d)} still exists; runtime models under /var/workflow must not be packaged.`, d);
  }

  // The tool deletes every packaged /var/workflow node; a runtime model is only safe to drop when its
  // design-time model is still in the project (Sync regenerates it on AEM as a Cloud Service).
  const designIds = new Set(post.models.map(m => I.modelIdOf(m.confPath)));
  for (const r of pre.runtimeModels || []) {
    if ((post.runtimeModels || []).some(p => p.path === r.path)) continue;
    if (!designIds.has(I.modelIdOf(r.path)) && !acks.includes('all') && !acks.includes(r.path)) fail('runtime-model-without-design-time', `${r.path} was deleted and the project has no design-time model for it; export the model from the source system into /conf/global/settings/workflow/models/${I.modelIdOf(r.path)}.`, r.file);
  }

  // ── Post-deploy follow-ups ──
  for (const m of (opts.followUps && opts.followUps.manual) || []) {
    if (m.code === 'unsupported-step-removed' || m.code === 'overlapping-workflows') continue;
    warn(m.code, `${m.model ? m.model + ': ' : ''}${m.detail}`);
  }
  for (const wmsg of post.warnings || []) warn('inventory', wmsg);

  return { ok: failures.length === 0, failures, warnings };
}

// ── Report ────────────────────────────────────────────────────────────
// What wf-migrator changed, the verification verdict (echoed, never recomputed), and the
// post-deploy checklist that has to be done on AEM as a Cloud Service because it cannot be expressed in code.

const ADVISORY = '> **Review before production:** the migrated models, runner config and processing profiles are generated. Review the diff, deploy to a development environment or RDE, upload test assets to every mapped folder and compare renditions and metadata with the source system before promoting.';

const CHECKLIST = [
  ['models-to-sync', 'Sync workflow models', 'Open each model in the workflow editor and click **Sync** so its runtime copy under `/var/workflow/models` exists. Runtime models are not packaged.'],
  ['profiles-to-attach', 'Attach processing profiles to folders', 'The tool cannot attach them. Folder → Properties → Asset Processing, or the Processing Profiles console. Without a profile on a folder, its renditions are not generated there.'],
  ['needs-custom-worker', 'Build Asset Compute custom workers', `The tool reported these under "Migration Issues": they cannot be expressed as a processing-profile rendition. See ${C.DOCS.customWorker}.`],
  ['unsupported-step-removed', 'Handle removed steps that have no replacement', 'Each removed step lists its replacement. Re-run with `--acknowledge <step>` once handled.'],
  ['launcher-condition-dropped', 'Re-create launcher conditions', 'The Custom Workflow Runner has no conditions. Add a guard step (e.g. an OR split or a process step that exits early) at the start of the workflow.'],
  ['overlapping-workflows', 'Merge workflows that now compete for the same assets', 'These assets match several runner entries, but the Custom Workflow Runner starts one post-processing workflow per asset. Merge the steps they still need into one model.'],
  ['or-routing-script-review', 'Review OR-split routing', 'A branch was removed or emptied; check the remaining routing scripts still choose the intended branch.'],
  ['steps-now-before-completed', 'Check steps that now run before Completed', 'They used to run after the asset was marked processed; make sure they do not rely on that.'],
  ['participant-or-nontransient-step', 'Review participant steps and non-transient models', 'Post-processing workflows should run unattended and be transient.'],
];

const cell = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function workflowRows(fu) {
  return (fu.workflows || []).map(w => {
    const removed = w.removed.map(s => `${C.shortName(s.process)}${s.inSplit ? ' (in split)' : ''}`);
    const kept = (w.kept || []).filter(s => s.process !== C.COMPLETED_PROCESS).map(s => C.shortName(s.process));
    const name = `\`${w.confPath}\`${w.migrated ? '' : ' (not migrated — profile only)'}`;
    return `| ${cell(name)} | ${cell([...new Set(w.launchers.map(l => l.glob))].join('<br>') || '—')} | ${cell(kept.join(', ') || '—')} | ${cell(removed.join(', ') || '—')} | ${w.profile ? `\`${cell(w.profile)}\`` : '—'} |`;
  });
}

function customStepSection(review) {
  const steps = (review && review.steps) || [];
  if (!steps.length) return [];
  const L = ['## Custom Java steps', '', `Read-only review of the custom Java steps the migrated workflows keep. Nothing was changed. ${S.SCOPE}`, ''];
  L.push('| Step | Used in | Source | Outcome | Evidence |', '|---|---|---|---|---|');
  for (const s of steps) {
    const used = [...new Set(s.usedIn.map(u => `\`${u.model}\`${u.inSplit ? ' (in split)' : ''}`))].join('<br>');
    const evidence = [
      ...s.signals.map(x => `${x.evidence} (L${x.line})`),
      ...s.handoffs.map(h => `hand off: ${h.id}${h.pattern ? ` (\`${h.pattern}\`)` : ''}`),
      ...s.helpers.map(h => `helper: \`${h}\``),
    ];
    const src = s.source ? `\`${s.source}\`` : `— ${s.reason}${s.candidates.length ? `: ${s.candidates.map(c => `\`${c}\``).join(', ')}` : ''}`;
    L.push(`| \`${cell(s.shortName)}\` | ${cell(used)} | ${cell(src)} | ${s.outcome} | ${cell(evidence.join('<br>') || '—')} |`);
  }
  L.push('');
  for (const id of [...new Set(steps.map(s => s.outcome))]) L.push(`- **${id}** — ${S.ACTIONS[id]}`);
  const guides = [...new Map(steps.flatMap(s => s.handoffs).map(h => [h.id, h])).values()];
  for (const h of guides) L.push(`  - \`${h.id}\`: read \`${h.guide}\`${h.pattern ? ` (pattern id \`${h.pattern}\`)` : ''}`);
  L.push('');
  return L;
}

function renderReport({ pre, post, followUps, verify, tool, gate, customSteps }) {
  const fu = followUps || { manual: [], workflows: [], runner: null };
  verify = verify || { ok: false, failures: [], warnings: [] };
  tool = tool || {};
  const root = post && post.root;
  const L = [];
  L.push('# Asset Workflow Migration Report', '', ADVISORY, '');

  L.push('## Summary', '');
  L.push('| Item | Value |', '|---|---|');
  L.push(`| Project | \`${cell(root || '')}\` |`);
  L.push(`| Migration tool | ${tool.skipped ? 'not run (verify-only)' : `wf-migrator ${cell(tool.version || '?')} — ${tool.ok ? 'completed' : '**failed**'}`} |`);
  const assetWf = pre ? I.affectedWorkflows(pre).length : 0;
  const migrated = (fu.workflows || []).filter(w => w.migrated).length;
  L.push(`| Asset workflows with work to keep | ${assetWf} |`);
  L.push(`| Post-processing workflows | ${migrated} |`);
  if ((fu.workflows || []).length > migrated) L.push(`| Not migrated (processing profile only) | ${fu.workflows.length - migrated} |`);
  if (fu.runner) L.push(`| Runner config | \`${cell(fu.runner.file)}\` — ${fu.runner.byPath.length} by path, ${fu.runner.byExpression.length} by expression |`);
  if (customSteps && customSteps.steps.length) L.push(`| Custom Java steps reviewed | ${customSteps.steps.length} (${S.needsAction(customSteps).length} need action) |`);
  L.push(`| Verification | ${verify.ok ? '**PASS**' : `**FAIL** (${verify.failures.length})`} |`);
  L.push('');

  if ((fu.workflows || []).length) {
    L.push('## Asset workflows', '');
    L.push('| Model | Launcher globs (before) | Steps kept | Steps removed | Processing profile |', '|---|---|---|---|---|');
    L.push(...workflowRows(fu), '');
  }
  L.push(...customStepSection(customSteps));

  L.push('## Verification', '');
  if (verify.ok) L.push('- `ok`: **true** — no gate failures.');
  else {
    L.push('- `ok`: **false** — fix these before deploying:');
    for (const f of verify.failures) L.push(`  - \`${f.category}\`: ${f.detail}${f.file ? ` (\`${relTo(root, f.file)}\`)` : ''}`);
  }
  const otherWarnings = verify.warnings.filter(w => !CHECKLIST.some(c => c[0] === w.category));
  for (const w of otherWarnings) L.push(`- warning \`${w.category}\`: ${w.detail}`);
  L.push('');

  L.push('## Post-deploy checklist', '');
  L.push('Do these on AEM as a Cloud Service after deploying. They cannot be done in code.', '');
  let any = false;
  for (const [code, title, help] of CHECKLIST) {
    const items = (fu.manual || []).filter(m => m.code === code);
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
  if (!any) L.push('', '_No other follow-ups._');
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

module.exports = { collectFollowUps, parseToolIssues, literalPrefix, foldersFor, verifyMigration, renderReport, writeReport, ackMatches, CHECKLIST };
