'use strict';
// Branch H follow-ups: reads the project before and after wf-migrator ran (and the tool's own
// migration report) and lists what still has to be done by hand. Read-only: the tool owns every change.
const path = require('path');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');

const isAuthorScoped = c => c.runMode === '' || c.runMode === 'author';
const profileTitle = name => `Migrated from ${name}`;
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');

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

// ── Launcher globs → folders to attach profiles to ────────────────────

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

// ── Follow-ups ────────────────────────────────────────────────────────

const ackMatches = (acks, process) => acks.includes('all') || acks.includes(process) || acks.includes(C.shortName(process));

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
  const entries = authorCfgs.flatMap(c => [...c.byPath.map(e => Object.assign({ type: 'path' }, e)), ...c.byExpression.map(e => Object.assign({ type: 'expression' }, e))]);
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
  const runner = cfg ? { file: rel(post.root, cfg.file), byPath: cfg.byPath.map(e => e.raw), byExpression: cfg.byExpression.map(e => e.raw) } : null;
  return { workflows, manual, runner };
}

module.exports = { collectFollowUps, parseToolIssues, literalPrefix, foldersFor, describeFolder, overlapDetail };
