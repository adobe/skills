'use strict';
// Verification gates for Branch F (asset workflow migration). Compares the pre-run inventory of the
// project (baseline) with the post-fix inventory and fails on anything that would silently lose
// work or break on AEM as a Cloud Service. Read-only.
const fs = require('fs');
const path = require('path');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');
const X = require('./asset-workflow-xml.js');

const isAuthorScoped = c => c.runMode === '' || c.runMode === 'author';

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

function acknowledgedSet(opts) {
  const set = new Set((opts.acknowledge || []).map(String));
  for (const m of (opts.fix && opts.fix.manual) || []) {
    if (m.code === 'unsupported-step-removed' && m.acknowledged) set.add(m.path ? `${m.model}|${m.process}|${m.path}` : `${m.model}|${m.process}`);
  }
  return set;
}

// One step is acknowledged by name (all of that process), or by the fixer for that step only.
const isAcked = (set, model, process, stepPath) => set.has('all') || set.has(process) || set.has(C.shortName(process))
  || set.has(`${model}|${process}`) || (!!stepPath && set.has(`${model}|${process}|${stepPath}`));
const lostWhy = s => `not everything it produced has a replacement. ${C.remediationFor(s) || ''} Re-run with --acknowledge ${C.shortName(s.process)} once handled.`;

// Old conf path → new conf path, for models the fixer renamed.
function renameMap(opts) {
  const m = new Map();
  for (const w of (opts.fix && opts.fix.workflows) || []) if (w.renamedFrom) m.set(w.renamedFrom, w.confPath);
  return m;
}

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
  const acks = acknowledgedSet(opts);
  const renames = renameMap(opts);

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
    const entries = [...c.byPath.map(e => Object.assign({ type: 'path' }, e)), ...c.byExpression.map(e => Object.assign({ type: 'expression' }, e))];
    for (const o of I.runnerOverlaps(entries)) warn('overlapping-workflows', `${o.sample} matches ${o.narrow.raw} and ${o.broad.raw}; only one post-processing workflow runs per asset.`, c.file);
  }

  // ── Per asset workflow ──
  const assetWorkflows = pre.workflows.filter(w => w.model && w.summary && w.summary.hasRealWork);
  if (assetWorkflows.length && !authorCfgs.length) fail('runner-config-missing', `No author Custom Workflow Runner config (${I.RUNNER_PID}) found; ${assetWorkflows.length} asset workflow(s) with real work would never run.`);

  const seen = new Set();
  for (const w of assetWorkflows) {
    const key = `${w.module}|${w.model.confPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const confPath = renames.get(w.model.confPath) || w.model.confPath;
    const pm = post.models.find(m => m.confPath === confPath && (m.module === w.module || renames.has(w.model.confPath)));
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

    for (const s of w.model.flat.filter(x => x.kind === 'process' && I.needsRenditionMapping(x))) {
      const still = pm.flat.some(x => x.process === s.process);
      if (!still && !isAcked(acks, confPath, s.process, s.path) && !isAcked(acks, w.model.confPath, s.process, s.path)) {
        fail('unsupported-step-removed', `${w.model.confPath}: ${C.shortName(s.process)} at ${s.path} was removed and ${lostWhy(s)}`.replace(/\s+/g, ' ').trim(), pm.file);
      }
    }
    if (!pm.transient) warn('model-not-transient', `${confPath}: Adobe recommends transient post-processing workflows.`, pm.file);
  }

  // Renditions-only workflows are not migrated: the tool disables their launchers, so their rendition
  // steps stop running even though they are still in the (now unused) model. Each one needs everything
  // it produced mapped to a processing-profile rendition, or an acknowledgement.
  const seenRo = new Set();
  for (const w of pre.workflows.filter(I.isRenditionsOnly)) {
    const key = `${w.module}|${w.model.confPath}`;
    if (seen.has(key) || seenRo.has(key)) continue;
    seenRo.add(key);
    const pm = post.models.find(m => m.confPath === w.model.confPath && m.module === w.module);
    for (const s of w.model.flat.filter(x => x.kind === 'process' && I.needsRenditionMapping(x))) {
      if (isAcked(acks, w.model.confPath, s.process, s.path) || isAcked(acks, renames.get(w.model.confPath) || w.model.confPath, s.process, s.path)) continue;
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
  for (const [from, to] of renames) if (designIds.has(I.modelIdOf(to))) designIds.add(I.modelIdOf(from));
  for (const r of pre.runtimeModels || []) {
    if ((post.runtimeModels || []).some(p => p.path === r.path)) continue;
    if (!designIds.has(I.modelIdOf(r.path)) && !acks.has('all') && !acks.has(r.path)) fail('runtime-model-without-design-time', `${r.path} was deleted and the project has no design-time model for it; export the model from the source system into /conf/global/settings/workflow/models/${I.modelIdOf(r.path)}.`, r.file);
  }

  // ── Manual follow-ups from the fixer ──
  for (const m of (opts.fix && opts.fix.manual) || []) {
    if (m.code === 'unsupported-step-removed' || m.code === 'overlapping-workflows') continue;
    if (m.code === 'runner-config-missing' || m.code === 'runner-config-unparseable' || m.code === 'profile-module-missing') fail(m.code, `${m.model ? m.model + ': ' : ''}${m.detail}`);
    else warn(m.code, `${m.model ? m.model + ': ' : ''}${m.detail}`);
  }
  for (const wmsg of post.warnings || []) warn('inventory', wmsg);

  return { ok: failures.length === 0, failures, warnings };
}

module.exports = { verifyMigration };
