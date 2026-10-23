'use strict';
// Post-processing fixers for the output of adobe/aem-cloud-migration (wf-migrator).
// Each fixer is deterministic, idempotent, and edits text spans so `git diff` stays reviewable.
//   minimal diffs · absolute filter roots · steps that cannot run removed (also inside splits)
//   Completed step last · UNSUPPORTED steps → renditions / remediation · OOTB model rename (opt-in)
//   runner config → merged .cfg.json · profile→folder mapping (+ opt-in repoinit) · checklist data
//   overlapping runner entries: most specific first + checklist note
const fs = require('fs');
const path = require('path');
const X = require('./asset-workflow-xml.js');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');

const REPOINIT_PID = 'org.apache.sling.jcr.repoinit.RepositoryInitializer~asset-processing-profiles';
const NS = 'xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0"';

const readText = p => fs.readFileSync(p, 'utf8');
const exists = p => { try { fs.statSync(p); return true; } catch { return false; } };
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
const jcrSafe = s => s.replace(/[/:[\]|* ."']/g, '_').toLowerCase();

function makeCtx(root, baseline, opts) {
  return {
    root, baseline, opts: Object.assign({ acknowledge: [], renameOotbModels: false, emitRepoinit: false }, opts || {}),
    changed: new Set(), deleted: new Set(), actions: [], manual: [], workflows: [],
  };
}

function write(ctx, file, text) {
  if (exists(file) && readText(file) === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  ctx.changed.add(file);
  return true;
}

function remove(ctx, file) {
  if (!exists(file)) return;
  fs.rmSync(file, { recursive: true, force: true });
  ctx.deleted.add(file);
  ctx.changed.add(file);
}

const act = (ctx, change, file, detail) => ctx.actions.push({ change, file: file ? rel(ctx.root, file) : null, detail });
const note = (ctx, code, model, detail, extra) => ctx.manual.push(Object.assign({ code, model, detail }, extra || {}));

// ── Diff minimiser: keep the original formatting ──────────────────────

function listXml(dir, out = []) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', 'target', 'dist'].includes(e.name)) listXml(p, out); } else if (e.isFile() && e.name.endsWith('.xml')) out.push(p);
  }
  return out;
}

function fixMinimize(ctx) {
  for (const file of listXml(ctx.root)) {
    const orig = path.join(ctx.baseline, path.relative(ctx.root, file));
    if (!exists(orig)) continue;
    const a = readText(orig), b = readText(file);
    if (a === b) continue;
    const r = X.minimizeDiff(a, b);
    if (!r.minimized) { act(ctx, 'formatting', file, `kept tool rewrite (${r.reason})`); continue; }
    if (r.text !== b && write(ctx, file, r.text)) act(ctx, 'formatting', file, r.identical ? 'restored original (tool change was formatting only)' : 'reduced tool rewrite to minimal edits');
  }
}

// The next run rebuilds every changed file from the baseline with minimal edits, so the fixers'
// own edits are put in that same form now; otherwise a rerun would reformat them (not idempotent).
function normalizeChanged(ctx) {
  for (const file of [...ctx.changed].filter(f => f.endsWith('.xml') && exists(f))) {
    const orig = path.join(ctx.baseline, path.relative(ctx.root, file));
    if (!exists(orig)) continue;
    const r = X.minimizeDiff(readText(orig), readText(file));
    if (r.minimized && !r.identical) write(ctx, file, r.text);
  }
}

// ── Absolute filter roots ─────────────────────────────────────────────

function fixFilterRoots(ctx) {
  for (const mod of I.findModules(ctx.root).filter(m => m.contentPackage)) {
    const file = path.join(mod.dir, I.FILTER_REL);
    if (!exists(file)) continue;
    const text = readText(file);
    let doc; try { doc = X.parseXml(text); } catch { continue; }
    const ws = X.rootElement(doc);
    const edits = [];
    for (const f of (ws ? ws.children : []).filter(c => c.name === 'filter')) {
      const a = X.findAttr(f, 'root');
      if (a && a.value && !a.value.startsWith('/')) edits.push(X.setAttrEdit(text, f, 'root', '/' + a.value));
    }
    if (edits.length && write(ctx, file, X.applyEdits(text, edits))) act(ctx, 'filter-roots', file, `made ${edits.length} filter root(s) absolute`);
  }
}

// ── Model passes: steps that cannot run, Completed step ───────────────

function stepInfo(el) {
  const rt = X.getAttr(el, 'sling:resourceType') || '';
  const meta = X.child(el, 'metaData');
  const process = meta ? (X.getAttr(meta, 'PROCESS') || X.getAttr(meta, 'EXTERNAL_PROCESS') || null) : null;
  const kind = /\/model\/or$/.test(rt) || X.getAttr(el, 'orSplit') === 'true' ? 'or' : /\/model\/and$/.test(rt) ? 'and' : process ? 'process' : 'other';
  const args = {};
  if (meta) for (const a of meta.attrs) if (!a.name.startsWith('jcr:')) args[a.name] = a.value;
  return { kind, process, rt, args, category: process ? C.classifyStep(process) : kind === 'other' ? 'NONE' : 'SPLIT' };
}

const flowOf = doc => X.child(X.child(X.rootElement(doc), 'jcr:content'), 'flow');

// Removes steps that cannot run in a post-processing workflow, at every depth (the tool only
// handles top-level steps). Returns whether anything with real work survives in `children`.
function cleanChildren(text, children, st, nested) {
  const edits = []; let real = false;
  for (const el of children) {
    const info = stepInfo(el);
    if (info.kind === 'process') {
      const drop = !C.isKept(info.category) || (nested && info.process === C.COMPLETED_PROCESS);
      if (drop) { edits.push(X.removeElementEdit(text, el)); st.removed.push({ node: el.name, process: info.process, category: info.category, nested }); } else if (C.isRealWork(info.category)) real = true;
    } else if (info.kind === 'or' || info.kind === 'and') {
      const r = cleanSplit(text, el, info.kind, st);
      edits.push(...r.edits); if (r.real) real = true;
    } else {
      real = true;
      st.others.push({ node: el.name, resourceType: info.rt });
    }
  }
  return { edits, real };
}

function cleanSplit(text, el, kind, st) {
  const branches = el.children.filter(b => b.name !== 'metaData');
  const results = branches.map(b => Object.assign(cleanChildren(text, b.children, st, true), { branch: b }));
  const realOnes = results.filter(r => r.real);
  if (!realOnes.length) {
    st.splits.push({ node: el.name, kind, outcome: 'removed (no branch left with real work)' });
    return { edits: [X.removeElementEdit(text, el)], real: false };
  }
  if (kind === 'and' && realOnes.length === 1) {
    const b = realOnes[0].branch;
    // A prefix this split (or its branch) binds to a namespace that another element binds it to
    // differently would change meaning once the branch moves up; keep the split instead.
    const rebound = [el, b].flatMap(x => x.attrs).filter(a => isNsDecl(a) && (st.nsUris.get(a.name.slice(6)) || new Set()).size > 1).map(a => a.name.slice(6) || '(default)');
    if (rebound.length) {
      st.splits.push({ node: el.name, kind, outcome: `kept (flattening it would change the namespace of prefix ${rebound.join(', ')})` });
      return { edits: results.flatMap(r => r.edits), real: true };
    }
    const inner = b.selfClosing ? '' : text.slice(b.startTagEnd, b.endTagStart);
    const shifted = realOnes[0].edits.map(e => X.mkEdit(e.start - b.startTagEnd, e.end - b.startTagEnd, e.text));
    const body = X.applyEdits(inner, shifted).trim();
    const from = X.childIndent(text, b), to = X.lineIndent(text, el.start);
    st.splits.push({ node: el.name, kind, outcome: 'flattened (one branch left)' });
    return { edits: [X.mkEdit(el.start, el.end, X.reindent(body, from, to))], real: true };
  }
  if (kind === 'or') st.splits.push({ node: el.name, kind, outcome: 'kept — review routing scripts', review: true });
  else st.splits.push({ node: el.name, kind, outcome: 'kept' });
  return { edits: results.flatMap(r => r.edits), real: true };
}

// Flattening an AND split moves the surviving branch's children up a level, where a sibling may
// already have the same node name. Oak cannot import same-name siblings, so later duplicates get the
// first free "_<n>" suffix. Node names inside a flow carry no meaning; only their order does.
function uniqueSiblingsPass(text, st) {
  const flow = flowOf(X.parseXml(text));
  if (!flow) return text;
  const edits = [];
  const visit = el => {
    const taken = new Set(el.children.map(c => c.name));
    const seen = new Set();
    for (const c of el.children) {
      if (seen.has(c.name)) {
        let k = 1, name;
        do name = `${c.name}_${k++}`; while (taken.has(name));
        taken.add(name); seen.add(name);
        edits.push(X.mkEdit(c.start + 1, c.nameEnd, name));
        if (!c.selfClosing) edits.push(X.mkEdit(c.endTagStart + 2, c.endTagStart + 2 + c.name.length, name));
        st.renamed.push({ from: c.name, to: name });
      } else seen.add(c.name);
      visit(c);
    }
  };
  visit(flow);
  return edits.length ? X.applyEdits(text, edits) : text;
}

function completedXml(name) {
  return `<${name}
    jcr:primaryType="nt:unstructured"
    jcr:description="This process will send DamEvent.Type.DAM_UPDATE_ASSET_WORKFLOW_COMPLETED event when DAM update asset workflow is completed"
    jcr:title="DAM Update Asset Workflow Completed"
    sling:resourceType="dam/components/workflow/damupdateassetworkflowcompletedprocess">
    <metaData
        jcr:primaryType="nt:unstructured"
        PROCESS="${C.COMPLETED_PROCESS}"
        PROCESS_AUTO_ADVANCE="true"/>
</${name}>`;
}

// Exactly one Completed step, as the last top-level step.
function completedPass(text, st) {
  const doc = X.parseXml(text);
  const flow = flowOf(doc);
  if (!flow) return text;
  const steps = flow.children;
  const done = steps.filter(el => stepInfo(el).process === C.COMPLETED_PROCESS);
  const last = steps[steps.length - 1];
  if (!done.length) {
    let name = 'damupdateassetworkflowcompletedprocess', k = 1;
    while (steps.some(s => s.name === name)) name = `damupdateassetworkflowcompletedprocess_${k++}`;
    st.completed = 'added';
    return X.applyEdits(text, [X.insertChildEdit(text, flow, completedXml(name))]);
  }
  const keep = done[done.length - 1];
  const edits = done.slice(0, -1).map(el => X.removeElementEdit(text, el));
  if (keep !== last) {
    const after = steps.slice(steps.indexOf(keep) + 1).filter(el => !done.includes(el));
    st.before = after.map(el => ({ node: el.name, process: stepInfo(el).process, title: X.getAttr(el, 'jcr:title') || '' }));
    edits.push(X.removeElementEdit(text, keep));
    edits.push(X.insertChildEdit(text, flow, text.slice(keep.start, keep.end), { after: last, fromIndent: X.lineIndent(text, keep.start) }));
    st.completed = 'moved to last';
  }
  if (done.length > 1) st.completed = (st.completed ? st.completed + '; ' : '') + `removed ${done.length - 1} duplicate(s)`;
  return edits.length ? X.applyEdits(text, edits) : text;
}

function renditionXml(r) {
  const attrs = ['jcr:primaryType="nt:unstructured"', 'sling:resourceType="dam/processing/profile/rendition"', `fmt="${X.encodeAttr(r.fmt)}"`, `name="${X.encodeAttr(r.name)}"`];
  if (r.wid || r.hei) attrs.push(`wid="${r.wid || 0}"`, `hei="${r.hei || 0}"`);
  attrs.push(`includeMimeTypes="${X.encodeAttr(r.include)}"`);
  if (r.exclude) attrs.push(`excludeMimeTypes="${X.encodeAttr(r.exclude)}"`);
  if (r.qlt) attrs.push(`qlt="${r.qlt}"`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root ${NS} jcr:primaryType="cq:Page">\n    <jcr:content ${attrs.join(' ')}/>\n</jcr:root>\n`;
}

function profileXml(title) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jcr:root ${NS} jcr:primaryType="cq:Page">\n    <jcr:content jcr:primaryType="nt:unstructured" jcr:title="${X.encodeAttr(title)}" sling:resourceType="dam/processing/profile"/>\n</jcr:root>\n`;
}

function contentModuleProcessingDir(root) {
  const dir = path.join(root, I.MIGRATION_CONTENT, I.JCR_ROOT_REL, 'conf', 'global', 'settings', 'dam', 'processing');
  return exists(path.join(root, I.MIGRATION_CONTENT, 'pom.xml')) ? dir : null;
}

// The tool titles each generated profile "Migrated from <model name>"; mapped renditions join it.
// A renamed model keeps the profile of the model it came from.
const profileTitle = wf => `Migrated from ${wf.sourceName || wf.name}`;

function findProfile(root, title) {
  for (const mod of I.findModules(root).filter(m => m.contentPackage)) {
    const p = I.readProfiles(path.join(mod.dir, I.JCR_ROOT_REL)).find(x => x.title === title);
    if (p) return p;
  }
  return null;
}

// `mapping` is every entry of the model; entries that repeat a rendition ("duplicate") share the fate of
// the one that produced it, so a conflict with the profile stops them too.
function addRenditions(ctx, wf, mapping) {
  const mapped = mapping.filter(m => m.status === 'mapped');
  if (!mapped.length) return;
  const title = profileTitle(wf);
  let profileDir = null;
  const found = findProfile(ctx.root, title);
  if (found) { profileDir = path.dirname(found.file); wf.profile = found.repoPath; }
  if (!profileDir) {
    const base = contentModuleProcessingDir(ctx.root);
    if (!base) {
      note(ctx, 'profile-module-missing', wf.confPath, `Create a processing profile "${title}" with renditions: ${mapped.map(m => m.rendition.name).join(', ')}`);
      return;
    }
    profileDir = path.join(base, jcrSafe(title));
    write(ctx, path.join(profileDir, '.content.xml'), profileXml(title));
    wf.profile = `/conf/global/settings/dam/processing/${jcrSafe(title)}`;
    act(ctx, 'renditions', path.join(profileDir, '.content.xml'), `created processing profile "${title}"`);
  }
  const existing = findProfile(ctx.root, title);
  const byName = new Map((existing ? existing.renditions : []).map(r => [r.name, r]));
  const conflicts = new Map();
  for (const m of mapped) {
    const have = byName.get(m.rendition.name);
    if (have) {
      if (!C.sameDefinition(have, m.rendition)) {
        conflicts.set(m.rendition.name, `the processing profile already has ${m.rendition.name} with different settings`);
        Object.assign(m, { status: 'custom', reason: conflicts.get(m.rendition.name) });
        delete m.rendition;
      } else if (have.file) mergeIncludeInto(ctx, have, m);
      continue;
    }
    let node = jcrSafe(m.rendition.name), k = 1;
    while (exists(path.join(profileDir, node))) node = `${jcrSafe(m.rendition.name)}_${k++}`;
    const f = path.join(profileDir, node, '.content.xml');
    write(ctx, f, renditionXml(m.rendition));
    byName.set(m.rendition.name, { file: f, name: m.rendition.name, fmt: m.rendition.fmt, wid: m.rendition.wid, hei: m.rendition.hei, qlt: m.rendition.qlt, includeMimeTypes: m.rendition.include, excludeMimeTypes: m.rendition.exclude });
    act(ctx, 'renditions', f, `rendition ${m.rendition.name} (${m.rendition.fmt}${m.rendition.wid ? ` ${m.rendition.wid}x${m.rendition.hei}` : ''}) from: ${m.command}`);
  }
  for (const m of mapping) {
    if (m.status !== 'duplicate' || !m.rendition || !conflicts.has(m.rendition.name)) continue;
    Object.assign(m, { status: 'custom', reason: conflicts.get(m.rendition.name) });
    delete m.rendition;
  }
}

// The profile already has this rendition with the same settings: add the step's file types to it.
function mergeIncludeInto(ctx, have, m) {
  const merged = C.mergeInclude(have.includeMimeTypes, m.rendition.include);
  if (C.typeSet(merged) === C.typeSet(have.includeMimeTypes)) return;
  const text = readText(have.file);
  const jc = X.child(X.rootElement(X.parseXml(text)), 'jcr:content');
  const raw = X.getAttr(jc, 'includeMimeTypes') || '';
  const type = (/^\{[A-Za-z]+\}/.exec(raw) || [''])[0];
  const value = raw.slice(type.length).startsWith('[') ? type + X.formatMultiValue(merged.split(',')) : merged;
  if (write(ctx, have.file, X.applyEdits(text, [X.setAttrEdit(text, jc, 'includeMimeTypes', value)]))) {
    act(ctx, 'renditions', have.file, `rendition ${m.rendition.name} already in the profile: added ${C.list(m.rendition.include).join(', ')} to its file types, from: ${m.command}`);
  }
  have.includeMimeTypes = merged;
}

// ── Per-model orchestration ───────────────────────────────────────────

function stepKey(s) { return `${s.node}|${s.process}`; }

// Renditions of the removed steps that would otherwise be lost (UNSUPPORTED steps, and rendition
// steps the tool skipped because they were inside a split). `stepIndex` ties each entry to its step.
function mapRemoved(wf) {
  const need = wf.removed.filter(I.needsRenditionMapping);
  C.mapSteps(need).forEach((maps, k) => wf.mapping.push(...maps.map(m => Object.assign({ step: need[k].node, stepIndex: wf.removed.indexOf(need[k]) }, m))));
}

const isNsDecl = a => a.name === 'xmlns' || a.name.startsWith('xmlns:');

// Every namespace each prefix is bound to anywhere in the document ('' is the default namespace).
function namespaceUris(doc) {
  const uris = new Map();
  const root = X.rootElement(doc);
  for (const el of [root, ...X.findAll(root, () => true)]) {
    for (const a of el.attrs.filter(isNsDecl)) {
      const p = a.name.slice(6);
      if (!uris.has(p)) uris.set(p, new Set());
      uris.get(p).add(a.value);
    }
  }
  return uris;
}

// Namespace prefixes still used after a split was removed but declared only on it (or on another
// removed element) are declared on the root, so the package still installs.
function namespacePass(text, sourceDoc, st) {
  const unbound = X.unboundPrefixes(X.parseXml(text));
  if (!unbound.length) return text;
  const uris = namespaceUris(sourceDoc);
  const add = unbound.filter(p => uris.has(p) && uris.get(p).size === 1);
  if (!add.length) return text;
  const root = X.rootElement(X.parseXml(text));
  const lastNs = root.attrs.filter(a => a.name.startsWith('xmlns')).pop();
  const at = lastNs ? lastNs.end : root.nameEnd;
  st.namespaces.push(...add);
  return X.applyEdits(text, [X.mkEdit(at, at, add.map(p => ` xmlns:${p}="${X.encodeAttr([...uris.get(p)][0])}"`).join(''))]);
}

function fixModel(ctx, model, baseModel) {
  const wf = { confPath: model.confPath, runtimePath: model.runtimePath, name: model.name, sourceName: baseModel ? baseModel.name : model.name, file: model.file, removed: [], splits: [], others: [], mapping: [], completed: null, before: [] };
  const st = { removed: [], splits: [], others: [], completed: null, before: [], renamed: [], namespaces: [] };
  let text = readText(model.file);
  const doc = X.parseXml(text);
  st.nsUris = namespaceUris(doc);
  const flow = flowOf(doc);
  if (!flow) { note(ctx, 'model-without-flow', model.confPath, 'Model has no flow node; fix it in the workflow editor.'); return wf; }
  const r = cleanChildren(text, flow.children, st, false);
  if (r.edits.length) text = X.applyEdits(text, r.edits);
  text = uniqueSiblingsPass(text, st);
  text = completedPass(text, st);
  text = namespacePass(text, doc, st);
  if (write(ctx, model.file, text)) {
    if (st.removed.length) act(ctx, 'non-runnable-steps', model.file, `removed ${st.removed.length} step(s) that cannot run in post-processing: ${st.removed.map(s => C.shortName(s.process)).join(', ')}`);
    for (const s of st.splits) act(ctx, 'non-runnable-steps', model.file, `${s.kind.toUpperCase()} split ${s.node}: ${s.outcome}`);
    for (const s of st.renamed) act(ctx, 'non-runnable-steps', model.file, `node ${s.from} renamed to ${s.to}: a sibling already had that name after flattening`);
    if (st.namespaces.length) act(ctx, 'non-runnable-steps', model.file, `declared namespace prefix(es) ${st.namespaces.join(', ')} on the root: only a removed split declared them`);
    if (st.completed) act(ctx, 'completed-step', model.file, `Completed step ${st.completed}`);
  }
  Object.assign(wf, { splits: st.splits, others: st.others, completed: st.completed, before: st.before });

  // Everything removed relative to the baseline, by the tool or by the split cleanup. Steps are matched by node and
  // process first, then by process alone (a flattened step may have been renamed).
  const finalFlat = I.readModel(model.file, jcrRootOf(model.file), X.parseXml(readText(model.file))).flat;
  const finalProc = finalFlat.filter(x => x.kind === 'process');
  const left = new Map(), leftByProcess = new Map();
  const inc = (m, k, d) => m.set(k, (m.get(k) || 0) + d);
  for (const s of finalProc) { inc(left, stepKey(s), 1); inc(leftByProcess, s.process, 1); }
  const baseFlat = baseModel ? baseModel.flat.filter(x => x.kind === 'process') : [];
  const unmatched = [];
  for (const s of baseFlat) {
    if (left.get(stepKey(s))) { inc(left, stepKey(s), -1); inc(leftByProcess, s.process, -1); } else unmatched.push(s);
  }
  for (const s of unmatched) {
    if (leftByProcess.get(s.process) > 0) { inc(leftByProcess, s.process, -1); continue; }
    wf.removed.push({ node: s.node, path: s.path, process: s.process, category: s.category, inSplit: !!s.split, args: s.args, title: s.title });
  }
  mapRemoved(wf);
  addRenditions(ctx, wf, wf.mapping);
  wf.kept = finalFlat.filter(x => x.kind === 'process').map(s => ({ node: s.node, process: s.process, category: s.category, inSplit: !!s.split }));
  // Steps that followed Completed in the source model and still exist now run before it. Derived
  // from the baseline so a re-run reports the same follow-up.
  if (baseModel) {
    const top = baseModel.steps;
    const idx = top.findIndex(s => s.process === C.COMPLETED_PROCESS);
    const finalNodes = new Set(finalFlat.filter(x => !x.split).map(stepKey));
    if (idx >= 0) wf.before = top.slice(idx + 1).filter(s => s.kind === 'process' && finalNodes.has(stepKey(s))).map(s => ({ node: s.node, process: s.process, title: s.title || '' }));
  }
  return wf;
}

function jcrRootOf(file) {
  const marker = `${path.sep}jcr_root${path.sep}`;
  const i = file.lastIndexOf(marker);
  return file.slice(0, i + marker.length - 1);
}

// ── Rename overlaid OOTB models ───────────────────────────────────────

function renameModel(ctx, wf, renames) {
  const newName = `${wf.name}${RENAME_SUFFIX}`;
  const newConf = `/conf/global/settings/workflow/models/${newName}`;
  const oldDir = path.dirname(wf.file);
  const newDir = path.join(jcrRootOf(wf.file), ...newConf.slice(1).split('/'));
  if (exists(newDir)) { note(ctx, 'rename-target-exists', wf.confPath, `${newConf} already exists; model not renamed.`); return; }
  let text = readText(wf.file);
  const doc = X.parseXml(text);
  const jc = X.child(X.rootElement(doc), 'jcr:content');
  const title = X.getAttr(jc, 'jcr:title') || wf.name;
  if (!/post-processing/i.test(title)) text = X.applyEdits(text, [X.setAttrEdit(text, jc, 'jcr:title', `${title} (post-processing)`)]);
  fs.mkdirSync(path.dirname(newDir), { recursive: true });
  fs.renameSync(oldDir, newDir);
  for (let d = path.dirname(oldDir); d.length > jcrRootOf(wf.file).length; d = path.dirname(d)) {
    if (fs.readdirSync(d).length) break;
    fs.rmdirSync(d);
  }
  ctx.deleted.add(wf.file); ctx.changed.add(wf.file);
  wf.file = path.join(newDir, '.content.xml');
  write(ctx, wf.file, text);
  renames.set(wf.runtimePath, I.runtimePathFor(newConf));
  act(ctx, 'model-rename', wf.file, `renamed overlaid OOTB model ${wf.confPath} → ${newConf}`);
  wf.renamedFrom = wf.confPath; wf.confPath = newConf; wf.runtimePath = I.runtimePathFor(newConf);
  const jcrRoot = jcrRootOf(wf.file);
  for (const mod of I.findModules(ctx.root).filter(m => m.contentPackage)) {
    const ff = path.join(mod.dir, I.FILTER_REL);
    if (!exists(ff)) continue;
    const ft = readText(ff);
    const fdoc = X.parseXml(ft);
    const edits = [];
    for (const f of X.rootElement(fdoc).children.filter(c => c.name === 'filter')) {
      const root = X.getAttr(f, 'root') || '';
      if (root === wf.renamedFrom || root.startsWith(wf.renamedFrom + '/')) edits.push(X.setAttrEdit(ft, f, 'root', newConf + root.slice(wf.renamedFrom.length)));
    }
    if (edits.length && write(ctx, ff, X.applyEdits(ft, edits))) act(ctx, 'model-rename', ff, 'updated filter root for renamed model');
    // A filter on an ancestor of the old path (e.g. .../models/dam) does not cover the new one.
    if (path.join(mod.dir, I.JCR_ROOT_REL) !== jcrRoot || I.coveredBy(newConf, I.readFilter(ff))) continue;
    const now = readText(ff);
    const ws = X.rootElement(X.parseXml(now));
    if (write(ctx, ff, X.applyEdits(now, [X.insertChildEdit(now, ws, `<filter root="${newConf}"/>`)]))) act(ctx, 'model-rename', ff, `added filter root ${newConf}: no filter covered the renamed model`);
  }
}

// ── Runner config ─────────────────────────────────────────────────────

function fixRunnerConfig(ctx, renames, extraEntries) {
  const post = I.buildInventory(ctx.root);
  const authorScoped = post.runnerConfigs.filter(c => c.runMode === '' || c.runMode === 'author');
  for (const c of post.runnerConfigs.filter(x => !authorScoped.includes(x))) note(ctx, 'runner-config-runmode-specific', null, `${rel(ctx.root, c.file)} (run mode ${c.runMode}) was left untouched; check it does not override the merged config.`);
  const broken = authorScoped.filter(c => c.error);
  if (broken.length) {
    for (const c of broken) note(ctx, 'runner-config-unparseable', null, `${rel(ctx.root, c.file)}: ${c.error}. No runner config was merged or removed; fix the file and re-run.`);
    return;
  }
  if (!authorScoped.length && !extraEntries.length) return;
  const existing = authorScoped.filter(c => c.module !== I.MIGRATION_APPS);
  let target;
  if (existing.length) {
    const t = existing[0];
    target = t.format === 'cfg.json' ? t.file : path.join(path.dirname(t.file), `${I.RUNNER_PID}.cfg.json`);
  } else {
    const appsRoot = path.join(ctx.root, I.MIGRATION_APPS);
    if (!exists(path.join(appsRoot, 'pom.xml'))) {
      note(ctx, 'runner-config-missing', null, `Add these Custom Workflow Runner entries to an author OSGi config: ${extraEntries.map(e => e.raw).join(', ')}`);
      return;
    }
    target = path.join(appsRoot, I.JCR_ROOT_REL, 'apps', 'aem-cloud-migration', 'config.author', `${I.RUNNER_PID}.cfg.json`);
  }
  const ordered = [...authorScoped.filter(c => c.file === target || (existing[0] && c.file === existing[0].file)), ...authorScoped.filter(c => c.file !== target && !(existing[0] && c.file === existing[0].file))];
  const byPath = [], byExpr = [];
  const push = (list, e) => {
    const model = renames.get(e.model) || e.model;
    const raw = e.model ? `${e.match}:${model}` : e.raw;
    if (!list.includes(raw)) list.push(raw);
  };
  for (const c of ordered) { c.byPath.forEach(e => push(byPath, e)); c.byExpression.forEach(e => push(byExpr, e)); }
  for (const e of extraEntries) push(e.type === 'path' ? byPath : byExpr, e);
  for (const [list, type] of [[byPath, 'path'], [byExpr, 'expression']]) {
    const sorted = I.orderMostSpecificFirst(I.parseRunnerEntries(list).map(e => Object.assign(e, { type }))).map(e => e.raw);
    if (sorted.join('\n') === list.join('\n')) continue;
    list.splice(0, list.length, ...sorted);
    act(ctx, 'runner-order', target, `${type === 'path' ? 'by-path' : 'by-expression'} entries ordered most specific first: ${sorted.join(', ')}`);
  }

  let base = {};
  if (exists(target)) {
    try { base = JSON.parse(readText(target)); } catch (e) { note(ctx, 'runner-config-unparseable', null, `${rel(ctx.root, target)}: ${e.message}; merge the entries by hand.`); return; }
  }
  const next = Object.assign({}, base);
  if (byPath.length) next.postProcWorkflowsByPath = byPath; else delete next.postProcWorkflowsByPath;
  if (byExpr.length) next.postProcWorkflowsByExpression = byExpr; else delete next.postProcWorkflowsByExpression;
  const same = JSON.stringify(base) === JSON.stringify(next);
  if (!same || !exists(target)) {
    write(ctx, target, JSON.stringify(next, null, 2) + '\n');
    act(ctx, 'runner-config', target, `Custom Workflow Runner config (.cfg.json, author): ${byPath.length} by-path, ${byExpr.length} by-expression entr${byPath.length + byExpr.length === 1 ? 'y' : 'ies'}`);
  }
  for (const c of authorScoped) {
    if (c.file === target) continue;
    remove(ctx, c.file);
    act(ctx, 'runner-config', c.file, `merged into ${rel(ctx.root, target)} and removed (${c.format}${c.module === I.MIGRATION_APPS ? ', tool output' : ''})`);
  }
  return { target, byPath, byExpr };
}

// ── Overlapping runner entries ────────────────────────────────────────

function overlapDetail(o) {
  const kind = e => (e.type === 'path' ? 'path' : 'expression');
  const which = o.mutual ? 'They match the same assets, so order cannot decide.' : o.narrow.type === o.broad.type ? `The more specific ${kind(o.narrow)} is listed first.` : 'Path and expression entries are separate lists, so order cannot decide.';
  return `Assets such as ${o.sample} match ${kind(o.narrow)} ${o.narrow.match} → ${o.narrow.model} and ${kind(o.broad)} ${o.broad.match} → ${o.broad.model}, but only one post-processing workflow runs per asset. ${which} If these assets need the steps of both, merge them into one model, then confirm on an RDE.`;
}

// ── Processing profile → folders ──────────────────────────────────────

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

function repoinitScript(pairs) {
  const lines = [];
  for (const { folder, profile } of pairs) {
    lines.push(`create path ${folder}/jcr:content(nt:unstructured)`);
    lines.push(`set properties on ${folder}/jcr:content\n  set processingProfile{String} to "${profile}"\nend`);
  }
  return lines.join('\n');
}

// ── Entry point ───────────────────────────────────────────────────────

const RENAME_SUFFIX = '-postprocessing';

function renamedOrigin(pre, post, m) {
  if (!m.name.endsWith(RENAME_SUFFIX)) return null;
  const name = m.name.slice(0, -RENAME_SUFFIX.length);
  if (!I.DEFAULT_ENABLED_MODELS[name]) return null;
  const orig = pre.models.find(b => b.name === name && b.module === m.module && !post.models.some(p => p.confPath === b.confPath && p.module === b.module));
  return orig ? orig.confPath : null;
}

function applyFixes(root, baseline, opts) {
  root = path.resolve(root); baseline = path.resolve(baseline);
  const ctx = makeCtx(root, baseline, opts);
  const pre = I.buildInventory(baseline);

  fixMinimize(ctx);
  fixFilterRoots(ctx);

  // Models to fix: those the runner config points at, plus asset workflows the tool disabled
  // without wiring although they still hold real work (e.g. custom steps only inside a split).
  // Models are found by their pre-run path; a model renamed by an earlier --rename-ootb-models run
  // (<name>-postprocessing) maps back to the overlaid OOTB model it came from.
  let post = I.buildInventory(root);
  const baseConfOf = m => renamedOrigin(pre, post, m) || m.confPath;
  const wired = new Set();
  for (const c of post.runnerConfigs) for (const e of [...c.byPath, ...c.byExpression]) wired.add(e.model);
  const extraEntries = [];
  const targets = [];
  for (const m of post.models) {
    if (wired.has(m.runtimePath)) { targets.push(m); continue; }
    const pw = pre.workflows.find(w => w.model && w.model.confPath === baseConfOf(m) && w.module === m.module);
    if (!pw || pw.toolWillMigrate || !pw.summary.hasRealWork) continue;
    const launchersOff = !post.launchers.some(l => l.enabled && l.isAsset && l.modelConfPath === m.confPath);
    if (!launchersOff) continue;
    targets.push(m);
    for (const l of pw.launchers) {
      const e = I.globToRunnerEntry(l.glob);
      extraEntries.push({ type: e.type, match: e.pattern, model: m.runtimePath, raw: `${e.pattern}:${m.runtimePath}` });
    }
    act(ctx, 'non-runnable-steps', m.file, `wired ${m.confPath}: the tool disabled its launcher but it still has real work inside a split`);
  }

  for (const m of targets) {
    const base = baseConfOf(m);
    const baseModel = pre.models.find(b => b.confPath === base && b.module === m.module) || null;
    const wf = fixModel(ctx, m, baseModel);
    if (base !== m.confPath) wf.renamedFrom = base;
    const pw = pre.workflows.find(w => w.model && w.model.confPath === base && w.module === m.module);
    wf.launchers = pw ? pw.launchers.map(l => ({ id: l.id, glob: l.glob, conditions: l.conditions, synthetic: !!l.synthetic })) : [];
    wf.transient = m.transient;
    ctx.workflows.push(wf);
  }

  // Renditions-only workflows: their only work beyond what runs natively is steps whose renditions
  // would be lost (UNSUPPORTED steps such as ImageMagick command lines, rendition steps inside a split,
  // top-level rendition steps the tool moved to its profile). The tool disables their launchers
  // without migrating them, so the renditions move to the processing profile. Nothing is wired and
  // the model is left as is. A workflow the tool created a profile for is included even when the
  // inventory did not predict it, so that profile is still attached.
  const handled = new Set(targets.map(m => `${m.module}|${baseConfOf(m)}`));
  const toolProfile = w => post.profiles.some(p => p.title === profileTitle(w.model));
  for (const pw of pre.workflows.filter(w => I.isRenditionsOnly(w) || (w.model && w.summary && !I.isAffected(w) && toolProfile(w)))) {
    const key = `${pw.module}|${pw.model.confPath}`;
    if (handled.has(key)) continue;
    handled.add(key);
    const m = pw.model;
    const pm = post.models.find(x => x.confPath === m.confPath && x.module === m.module);
    const wf = { confPath: m.confPath, runtimePath: m.runtimePath, name: m.name, sourceName: m.name, file: pm ? pm.file : null, removed: [], splits: [], others: [], mapping: [], completed: null, before: [], kept: [], renditionsOnly: true };
    for (const s of m.flat.filter(x => x.kind === 'process' && I.needsRenditionMapping(x))) {
      wf.removed.push({ node: s.node, path: s.path, process: s.process, category: s.category, inSplit: !!s.split, args: s.args, title: s.title });
    }
    mapRemoved(wf);
    addRenditions(ctx, wf, wf.mapping);
    wf.launchers = pw.launchers.map(l => ({ id: l.id, glob: l.glob, conditions: l.conditions, synthetic: !!l.synthetic }));
    wf.transient = m.transient;
    ctx.workflows.push(wf);
  }

  const renames = new Map();
  if (ctx.opts.renameOotbModels) {
    for (const wf of ctx.workflows) if (!wf.renditionsOnly && I.DEFAULT_ENABLED_MODELS[wf.name] && wf.confPath.startsWith('/conf/global/settings/workflow/models/')) renameModel(ctx, wf, renames);
  }
  for (const e of extraEntries) if (renames.has(e.model)) e.model = renames.get(e.model);
  ctx.runner = fixRunnerConfig(ctx, renames, extraEntries) || null;
  if (ctx.runner) {
    const entries = [...I.parseRunnerEntries(ctx.runner.byPath).map(e => Object.assign(e, { type: 'path' })), ...I.parseRunnerEntries(ctx.runner.byExpr).map(e => Object.assign(e, { type: 'expression' }))];
    for (const o of I.runnerOverlaps(entries)) note(ctx, 'overlapping-workflows', I.confPathFor(o.narrow.model), overlapDetail(o), { sample: o.sample, models: [o.narrow.model, o.broad.model] });
  }

  normalizeChanged(ctx);
  post = I.buildInventory(root);
  const repoinit = [];
  for (const wf of ctx.workflows) {
    const prof = post.profiles.find(p => p.title === profileTitle(wf));
    wf.profile = prof ? prof.repoPath : wf.profile || null;
    wf.folders = foldersFor(wf.launchers);
    if (wf.profile) {
      for (const f of wf.folders) if (f.subtree && !f.excludes.length && f.folder.startsWith('/content/dam/') && !repoinit.some(r => r.folder === f.folder)) repoinit.push({ folder: f.folder, profile: wf.profile });
      note(ctx, 'profiles-to-attach', wf.confPath, `Attach ${wf.profile} to: ${wf.folders.map(describeFolder).join('; ')}`, { profile: wf.profile, folders: wf.folders });
    }
    const conds = new Map();
    for (const l of wf.launchers.filter(x => x.conditions.length)) {
      const k = l.conditions.join(' AND ');
      if (!conds.has(k)) conds.set(k, []);
      conds.get(k).push(l.id);
    }
    for (const [k, ids] of wf.renditionsOnly ? [] : conds) note(ctx, 'launcher-condition-dropped', wf.confPath, `${k} (launcher${ids.length > 1 ? 's' : ''} ${ids.join(', ')}) — the Custom Workflow Runner has no conditions; add a guard step at the start of the workflow.`);
    if (wf.before.length) note(ctx, 'steps-now-before-completed', wf.confPath, `Now run before Completed: ${wf.before.map(b => C.shortName(b.process) || b.node).join(', ')} — check they do not depend on processing having finished.`);
    for (const s of wf.splits.filter(x => x.review)) note(ctx, 'or-routing-script-review', wf.confPath, `OR split ${s.node} still routes work; review its routing scripts.`);
    for (const o of wf.others) note(ctx, 'participant-or-nontransient-step', wf.confPath, `${o.node} (${o.resourceType}) is not an automatic process step; post-processing workflows should run unattended.`);
    if (!wf.transient && !wf.renditionsOnly) note(ctx, 'participant-or-nontransient-step', wf.confPath, 'Model is not transient; Adobe recommends transient post-processing workflows.');
    for (const m of wf.mapping) {
      if (m.status === 'custom') note(ctx, 'needs-custom-worker', wf.confPath, `${m.command} — ${m.reason}. Implement as an Asset Compute custom worker.`, { docs: C.DOCS.customWorker });
      if (m.status === 'mapped' && m.nameChanged) note(ctx, 'rendition-name-changed', wf.confPath, `${m.output} becomes ${m.rendition.name}; update code that reads the old rendition name.`);
      if (m.status === 'mapped' && !m.rendition.wid && !m.fullSize) note(ctx, 'rendition-size-review', wf.confPath, `${m.rendition.name}: format conversion only — no size set; check the rendition size in the profile.`);
    }
    wf.removed.forEach((s, k) => {
      if (!I.needsRenditionMapping(s)) return;
      const maps = wf.mapping.filter(m => m.stepIndex === k);
      // Everything the step produced became a profile rendition (or is a standard one): nothing is lost.
      const fullyMapped = maps.length > 0 && maps.every(m => m.status !== 'custom');
      const acked = fullyMapped || ctx.opts.acknowledge.includes('all') || ctx.opts.acknowledge.includes(s.process) || ctx.opts.acknowledge.includes(C.shortName(s.process));
      const how = !fullyMapped ? (C.remediationFor(s) || '')
        : s.process === C.CLP ? 'All of its commands were mapped to processing-profile renditions.' : 'Everything it produced is covered by processing-profile or standard renditions.';
      const what = wf.renditionsOnly ? 'no longer runs (its launcher is disabled and the model is not migrated)' : 'removed';
      note(ctx, 'unsupported-step-removed', wf.confPath, `${C.shortName(s.process)} (${s.node}) ${what}. ${how}`.trim(), { process: s.process, path: s.path, acknowledged: acked, fullyMapped });
    });
    if (!wf.renditionsOnly) note(ctx, 'models-to-sync', wf.confPath, `After deploy, open ${wf.confPath} in the workflow editor and click Sync so ${wf.runtimePath} exists.`);
  }
  if (ctx.opts.emitRepoinit && repoinit.length) {
    const f = path.join(root, I.MIGRATION_APPS, I.JCR_ROOT_REL, 'apps', 'aem-cloud-migration', 'config.author', `${REPOINIT_PID}.cfg.json`);
    if (exists(path.join(root, I.MIGRATION_APPS, 'pom.xml'))) {
      if (write(ctx, f, JSON.stringify({ scripts: [repoinitScript(repoinit)] }, null, 2) + '\n')) act(ctx, 'profile-folders', f, `repoinit attaching profiles to ${repoinit.length} folder(s) — verify on an RDE first`);
    } else note(ctx, 'repoinit-skipped', null, 'No aem-cloud-migration.apps module to hold the repoinit config.');
  }

  return {
    changedFiles: [...ctx.changed].map(f => rel(root, f)).sort(),
    deletedFiles: [...ctx.deleted].map(f => rel(root, f)).sort(),
    actions: ctx.actions, manual: ctx.manual, workflows: ctx.workflows, runner: ctx.runner ? { file: rel(root, ctx.runner.target), byPath: ctx.runner.byPath, byExpression: ctx.runner.byExpr } : null,
  };
}

module.exports = { applyFixes, renamedOrigin, literalPrefix, foldersFor, cleanChildren, uniqueSiblingsPass, completedPass, namespacePass, stepInfo, repoinitScript, renditionXml, jcrSafe };
