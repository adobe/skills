'use strict';
// Inventory of asset-processing workflow configuration in an AEM Maven project.
// Mirrors how adobe/aem-cloud-migration (wf-migrator 0.6.0) discovers workflows, so the
// pre-run inventory predicts what the tool will touch and the post-run inventory feeds the
// fixers and verification gates. Read-only.
const fs = require('fs');
const path = require('path');
const X = require('./asset-workflow-xml.js');
const C = require('./asset-workflow-catalog.js');

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist']);
const RUNNER_PID = 'com.adobe.cq.dam.processor.nui.impl.workflow.CustomDamWorkflowRunnerImpl';
const MODEL_PAGE_RT = 'cq/workflow/components/pages/model';
const MIGRATION_APPS = 'aem-cloud-migration.apps';
const MIGRATION_CONTENT = 'aem-cloud-migration.content';
const JCR_ROOT_REL = path.join('src', 'main', 'content', 'jcr_root');
const FILTER_REL = path.join('src', 'main', 'content', 'META-INF', 'vault', 'filter.xml');

// OOTB models the tool migrates even without a project launcher (MigrationConstants.DEFAULT_ENABLED_MODELS).
const DEFAULT_ENABLED_MODELS = {
  'batch-thumbnails': { glob: '/var/dam/pending-thumbs(/.*)', conditions: ['paths!='] },
  'dynamic-media-encode-video': { glob: '/content/dam(/.*/)renditions/original', conditions: ['jcr:content/jcr:mimeType==video/.*'] },
  process_subasset: { glob: '/content/dam(/.*/)(subassets)(/.*/)renditions/original', conditions: ['jcr:content/jcr:mimeType!=video/.*'] },
  update_asset: { glob: '/content/dam(/((?!/subassets).)*/)renditions/original', conditions: [] },
  update_from_lightbox: { glob: '/var/lightbox', conditions: [] },
};

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readText = p => fs.readFileSync(p, 'utf8');
const toPosix = p => p.split(path.sep).join('/');

function walkFiles(dir, pred, out = []) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkFiles(p, pred, out); } else if (e.isFile() && pred(e.name, p)) out.push(p);
  }
  return out.sort();
}

function tryParse(file) {
  try { return X.parseXml(readText(file)); } catch { return null; }
}

// ── Maven ─────────────────────────────────────────────────────────────

function readPom(file) {
  const doc = tryParse(file);
  const proj = doc && X.rootElement(doc);
  if (!proj) return null;
  const modulesEl = X.child(proj, 'modules');
  let packageType = null;
  for (const pt of X.findAll(proj, el => el.name === 'packageType')) { packageType = X.textOf(pt); break; }
  return {
    artifactId: X.textOf(X.child(proj, 'artifactId')),
    packaging: X.textOf(X.child(proj, 'packaging')) || 'jar',
    modules: modulesEl ? modulesEl.children.filter(c => c.name === 'module').map(X.textOf) : [],
    packageType,
  };
}

// Content-package modules listed in the root POM — the only modules the tool scans.
function findModules(root) {
  const pom = readPom(path.join(root, 'pom.xml'));
  if (!pom) return [];
  const out = [];
  for (const name of pom.modules) {
    const dir = path.join(root, name);
    const mp = readPom(path.join(dir, 'pom.xml'));
    if (!mp) continue;
    out.push({ name, dir, packaging: mp.packaging, packageType: mp.packageType, artifactId: mp.artifactId, contentPackage: mp.packaging === 'content-package' });
  }
  return out;
}

// ── Repository paths ──────────────────────────────────────────────────

// FileVault on-disk name → JCR name: _jcr_content → jcr:content.
const decodeSegment = s => s.replace(/^_([A-Za-z0-9]+)_(.+)$/, '$1:$2');

function repoPathOf(file, jcrRoot) {
  const rel = toPosix(path.relative(jcrRoot, file));
  const segs = rel.split('/').map(decodeSegment);
  const last = segs[segs.length - 1];
  if (last === '.content.xml') segs.pop(); else if (last.endsWith('.xml')) segs[segs.length - 1] = last.slice(0, -4);
  return '/' + segs.join('/');
}

function readFilter(file) {
  const doc = tryParse(file);
  const ws = doc && X.rootElement(doc);
  if (!ws) return [];
  return ws.children.filter(c => c.name === 'filter').map(f => ({ root: X.getAttr(f, 'root') || '', mode: X.getAttr(f, 'mode') || 'replace' }));
}

const coveredBy = (repoPath, filters) => filters.some(f => f.root && (repoPath === f.root || repoPath.startsWith(f.root.replace(/\/$/, '') + '/')));

// ── Workflow models ───────────────────────────────────────────────────

const SPLIT_KIND = rt => (/\/model\/or$/.test(rt) ? 'or' : /\/model\/and$/.test(rt) ? 'and' : null);

function metaArgs(meta) {
  const out = {};
  if (meta) for (const a of meta.attrs) if (!a.name.startsWith('jcr:') && !a.name.startsWith('xmlns')) out[a.name] = a.value;
  return out;
}

function parseStep(el, base) {
  const p = `${base}/${el.name}`;
  const rt = X.getAttr(el, 'sling:resourceType') || '';
  const meta = X.child(el, 'metaData');
  const process = meta ? (X.getAttr(meta, 'PROCESS') || X.getAttr(meta, 'EXTERNAL_PROCESS') || null) : null;
  const kind = SPLIT_KIND(rt) || (X.getAttr(el, 'orSplit') === 'true' ? 'or' : null) || (process ? 'process' : 'other');
  const step = { node: el.name, path: p, title: X.getAttr(el, 'jcr:title') || '', resourceType: rt, kind, process, external: !!(meta && !X.getAttr(meta, 'PROCESS') && X.getAttr(meta, 'EXTERNAL_PROCESS')) };
  if (kind === 'process') {
    step.category = C.classifyStep(process);
    step.args = metaArgs(meta);
  } else if (kind === 'or' || kind === 'and') {
    step.category = 'SPLIT';
    step.branches = el.children.filter(b => b.name !== 'metaData').map(b => ({ node: b.name, path: `${p}/${b.name}`, steps: b.children.map(s => parseStep(s, `${p}/${b.name}`)) }));
    if (kind === 'or') step.scripts = el.attrs.filter(a => /^script\d+$/.test(a.name)).map(a => a.name);
  } else {
    step.category = 'NONE';
    step.participant = /participant/i.test(rt);
  }
  return step;
}

function flattenSteps(steps, out = [], ctx = { depth: 0, split: null }) {
  for (const s of steps) {
    out.push(Object.assign({}, s, { depth: ctx.depth, split: ctx.split }));
    if (s.branches) for (const b of s.branches) flattenSteps(b.steps, out, { depth: ctx.depth + 1, split: s.path });
  }
  return out;
}

function readModel(file, jcrRoot, doc) {
  const root = X.rootElement(doc);
  const jc = X.child(root, 'jcr:content');
  if (!jc || X.getAttr(jc, 'sling:resourceType') !== MODEL_PAGE_RT) return null;
  const flow = X.child(jc, 'flow');
  const confPath = repoPathOf(file, jcrRoot);
  const steps = flow ? flow.children.map(s => parseStep(s, 'flow')) : [];
  return {
    file, confPath, runtimePath: runtimePathFor(confPath), id: modelIdOf(confPath), name: confPath.split('/').pop(),
    title: X.getAttr(jc, 'jcr:title') || '', transient: X.getAttr(jc, 'transient') === 'true',
    hasFlow: !!flow, steps, flat: flattenSteps(steps),
  };
}

// The tool maps /var ↔ /conf/global/settings and /etc/…/jcr:content/model ↔ /etc/… (WorkflowModelDAO).
function confPathFor(modelPath) {
  if (!modelPath) return null;
  if (modelPath.startsWith('/var/')) return modelPath.replace(/^\/var/, '/conf/global/settings');
  if (modelPath.startsWith('/etc/') && modelPath.endsWith('/jcr:content/model')) return modelPath.slice(0, -'/jcr:content/model'.length);
  return modelPath;
}
function runtimePathFor(confPath) {
  if (confPath.startsWith('/conf/global/settings/')) return confPath.replace(/^\/conf\/global\/settings/, '/var');
  if (confPath.startsWith('/etc/')) return `${confPath}/jcr:content/model`;
  return confPath;
}
const modelIdOf = p => { const m = /\/workflow\/models\/(.+?)(?:\/jcr:content\/model)?$/.exec(p || ''); return m ? m[1] : (p || '').split('/').pop(); };
const modelBaseName = p => (p || '').replace(/\/jcr:content\/model$/, '').split('/').pop();

// ── Launchers ─────────────────────────────────────────────────────────

function readLauncher(file, jcrRoot, doc) {
  const el = X.rootElement(doc);
  if (X.getAttr(el, 'jcr:primaryType') !== 'cq:WorkflowLauncher') return null;
  const glob = X.getAttr(el, 'glob') || '';
  const conditions = X.parseMultiValue(X.getAttr(el, 'conditions'));
  const single = (X.getAttr(el, 'condition') || '').trim();
  if (single) conditions.push(single);
  const workflow = X.getAttr(el, 'workflow') || '';
  return {
    file, path: repoPathOf(file, jcrRoot), id: repoPathOf(file, jcrRoot).split('/').pop(), glob, workflow,
    modelConfPath: confPathFor(workflow), modelName: modelBaseName(workflow),
    // The tool treats a launcher as enabled only when enabled is exactly {Boolean}true.
    enabled: X.getAttr(el, 'enabled') === '{Boolean}true',
    enabledRaw: X.getAttr(el, 'enabled'),
    conditions, eventType: X.getAttr(el, 'eventType') || '', nodetype: X.getAttr(el, 'nodetype') || '', runModes: X.getAttr(el, 'runModes') || '',
    isAsset: isAssetGlob(glob),
  };
}

const isAssetGlob = g => g.includes('/content/dam') && !g.includes('collections') && !g.includes('metadata');

// Port of WorkflowRunnerConfigCreator: launcher glob → runner entry.
function globToRunnerEntry(glob) {
  let pattern = glob;
  const jc = pattern.indexOf('/jcr:content');
  if (jc >= 0) pattern = pattern.slice(0, jc);
  if (!/[:[\]|* ."']/.test(pattern)) return { type: 'path', pattern };
  pattern = pattern.replace('renditions/original', '');
  const pos = pattern.lastIndexOf('/');
  if (pos > -1) pattern = pattern.slice(0, pos) + pattern.slice(pos + 1);
  return { type: 'expression', pattern };
}

// ── Runner configs ────────────────────────────────────────────────────

function parseRunnerEntries(list) {
  return (list || []).map(s => String(s)).filter(Boolean).map(s => {
    const i = s.lastIndexOf(':/');
    return i > 0 ? { match: s.slice(0, i), model: s.slice(i + 1), raw: s } : { match: s, model: '', raw: s };
  });
}

// ── Runner entry overlap ──────────────────────────────────────────────
// On-prem every matching launcher started its own workflow; the Custom Workflow Runner maps an asset
// to a single post-processing model. Entries are { type: 'path'|'expression', match, model }.

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function runnerEntryRegex(e) {
  if (e.type === 'path') return new RegExp(`^${escapeRe(e.match.replace(/\/$/, ''))}(?:/.*)?$`);
  try { return new RegExp(`^(?:${e.match})$`); } catch { return null; }
}

// A concrete asset path the entry matches, or null when none can be derived.
function sampleAssetPath(e) {
  if (e.type === 'path') return `${e.match.replace(/\/$/, '')}/sample`;
  let s = e.match.replace(/\(\?<?[!=][^()]*\)/g, '').replace(/\(\?:/g, '(');
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\(([^()|]*)\|[^()]*\)/, '$1'); }
  s = s.replace(/\[\^[^\]]*\][*+]|\.[*+]/g, 'sample').replace(/\[([^\]^\\])[^\]]*\][*+?]?/g, '$1')
    .replace(/\\(.)/g, '$1').replace(/[()^$?]/g, '').replace(/\/{2,}/g, '/');
  const re = runnerEntryRegex(e);
  return re && re.test(s) ? s : null;
}

// How two entries for different models overlap: null, or { narrow, broad, sample, mutual }.
function overlapOf(a, b) {
  if (!a.model || !b.model || a.model === b.model) return null;
  const ra = runnerEntryRegex(a), rb = runnerEntryRegex(b);
  const sa = sampleAssetPath(a), sb = sampleAssetPath(b);
  const aInB = !!(sa && rb && rb.test(sa)), bInA = !!(sb && ra && ra.test(sb));
  if (!aInB && !bInA) return null;
  return bInA && !aInB ? { narrow: b, broad: a, sample: sb, mutual: false } : { narrow: a, broad: b, sample: sa, mutual: aInB && bInA };
}

function runnerOverlaps(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const o = overlapOf(entries[i], entries[j]);
    if (o) out.push(o);
  }
  return out;
}

// Moves narrower entries ahead of the broader ones they overlap; other entries keep their order.
function orderMostSpecificFirst(entries) {
  const list = entries.slice();
  for (let guard = 0; guard < list.length * list.length; guard++) {
    let moved = false;
    for (let i = 0; i < list.length && !moved; i++) for (let j = i + 1; j < list.length && !moved; j++) {
      const o = overlapOf(list[i], list[j]);
      if (o && !o.mutual && o.narrow === list[j]) { list.splice(i, 0, list.splice(j, 1)[0]); moved = true; }
    }
    if (!moved) break;
  }
  return list;
}

// Felix .config arrays: `key=[ "a", "b" ]`, optionally typed (`T[`) and continued over lines with `\`.
// Scans character by character so `]` or `,` inside a quoted value does not end the array.
function parseFelixArray(text, key) {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*(?:[A-Za-z])?\\[`, 'm').exec(text);
  if (!m) return [];
  const out = [];
  let cur = null;
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const ch = text[i];
    if (cur !== null) {
      if (ch === '\\' && i + 1 < text.length) cur += text[++i];
      else if (ch === '"') { out.push(cur); cur = null; } else cur += ch;
    } else if (ch === '"') cur = '';
    else if (ch === ']') return out;
  }
  throw new Error(`${key}: array is not closed`);
}

function readRunnerConfig(file, jcrRoot) {
  const base = path.basename(file);
  const format = base.endsWith('.cfg.json') ? 'cfg.json' : base.endsWith('.xml') ? 'xml' : base.endsWith('.config') ? 'config' : base.endsWith('.cfg') ? 'cfg' : 'unknown';
  const folder = path.basename(path.dirname(file));
  const runMode = folder.startsWith('config.') ? folder.slice('config.'.length) : '';
  let byPath = [], byExpression = [], error = null;
  try {
    const text = readText(file);
    if (format === 'cfg.json') {
      const j = JSON.parse(text);
      byPath = [].concat(j.postProcWorkflowsByPath || []); byExpression = [].concat(j.postProcWorkflowsByExpression || []);
    } else if (format === 'xml') {
      const el = X.rootElement(X.parseXml(text));
      byPath = X.parseMultiValue(X.getAttr(el, 'postProcWorkflowsByPath'));
      byExpression = X.parseMultiValue(X.getAttr(el, 'postProcWorkflowsByExpression'));
    } else if (format === 'config') {
      byPath = parseFelixArray(text, 'postProcWorkflowsByPath'); byExpression = parseFelixArray(text, 'postProcWorkflowsByExpression');
    } else if (format === 'cfg') {
      const kv = Object.fromEntries(text.split(/\r?\n/).map(l => l.split('=')).filter(p => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
      byPath = (kv.postProcWorkflowsByPath || '').split(',').filter(Boolean); byExpression = (kv.postProcWorkflowsByExpression || '').split(',').filter(Boolean);
    }
  } catch (e) { error = e.message; }
  return { file, repoPath: repoPathOf(file, jcrRoot), format, runMode, byPath: parseRunnerEntries(byPath), byExpression: parseRunnerEntries(byExpression), error };
}

// ── Processing profiles ───────────────────────────────────────────────

function readProfiles(jcrRoot) {
  const out = [];
  const confDir = path.join(jcrRoot, 'conf');
  if (!isDir(confDir)) return out;
  for (const f of walkFiles(confDir, n => n === '.content.xml')) {
    const rp = repoPathOf(f, jcrRoot);
    const m = /^(\/conf\/.+\/settings\/dam\/processing)\/([^/]+)$/.exec(rp);
    if (!m) continue;
    const doc = tryParse(f);
    const jc = doc && X.child(X.rootElement(doc), 'jcr:content');
    if (!jc || X.getAttr(jc, 'sling:resourceType') !== 'dam/processing/profile') continue;
    const renditions = [];
    for (const rf of walkFiles(path.dirname(f), (n, p) => n === '.content.xml' && p !== f)) {
      const rd = tryParse(rf);
      const rjc = rd && X.child(X.rootElement(rd), 'jcr:content');
      const rt = rjc && X.getAttr(rjc, 'sling:resourceType');
      if (!rt || !rt.startsWith('dam/processing/profile/rendition')) continue;
      const attrs = Object.fromEntries(rjc.attrs.filter(a => !a.name.includes(':')).map(a => [a.name, a.value]));
      renditions.push(Object.assign({ file: rf, node: path.basename(path.dirname(rf)), resourceType: rt }, attrs));
    }
    out.push({ file: f, repoPath: rp, node: m[2], title: X.getAttr(jc, 'jcr:title') || m[2], renditions });
  }
  return out;
}

// Folders under /content/dam that already reference a processing profile.
function readAttachedProfiles(jcrRoot) {
  const out = [];
  const damDir = path.join(jcrRoot, 'content', 'dam');
  if (!isDir(damDir)) return out;
  for (const f of walkFiles(damDir, n => n === '.content.xml')) {
    let text; try { text = readText(f); } catch { continue; }
    if (!text.includes('processingProfile')) continue;
    const doc = tryParse(f);
    const jc = doc && X.child(X.rootElement(doc), 'jcr:content');
    const prof = jc && X.getAttr(jc, 'processingProfile');
    if (prof) out.push({ folder: repoPathOf(f, jcrRoot), profile: prof, file: f });
  }
  return out;
}

// ── Inventory ─────────────────────────────────────────────────────────

function buildInventory(root) {
  root = path.resolve(root);
  const inv = {
    root, isMavenProject: isFile(path.join(root, 'pom.xml')), modules: [], filters: [], launchers: [], models: [],
    runtimeModels: [], runnerConfigs: [], profiles: [], attachedProfiles: [], workflows: [], warnings: [],
  };
  inv.modules = findModules(root);
  for (const mod of inv.modules.filter(m => m.contentPackage)) {
    const jcrRoot = path.join(mod.dir, JCR_ROOT_REL);
    const filterFile = path.join(mod.dir, FILTER_REL);
    const filters = isFile(filterFile) ? readFilter(filterFile) : [];
    inv.filters.push({ module: mod.name, file: filterFile, exists: isFile(filterFile), entries: filters });
    if (!isDir(jcrRoot)) continue;

    for (const top of ['conf', 'etc']) {
      const d = path.join(jcrRoot, top);
      if (!isDir(d)) continue;
      for (const f of walkFiles(d, n => n.endsWith('.xml'))) {
        let text; try { text = readText(f); } catch { continue; }
        if (!text.includes('cq:WorkflowLauncher') && !text.includes(MODEL_PAGE_RT)) continue;
        const doc = tryParse(f);
        if (!doc || !X.rootElement(doc)) { inv.warnings.push(`Unparseable XML: ${f}`); continue; }
        const l = readLauncher(f, jcrRoot, doc);
        if (l) { inv.launchers.push(Object.assign(l, { module: mod.name, filtered: coveredBy(l.path, filters) })); continue; }
        const m = readModel(f, jcrRoot, doc);
        if (m) inv.models.push(Object.assign(m, { module: mod.name, filtered: coveredBy(m.confPath, filters) }));
      }
    }
    const varModels = path.join(jcrRoot, 'var', 'workflow', 'models');
    for (const f of walkFiles(varModels, n => n.endsWith('.xml'))) {
      if (path.basename(f) === '.content.xml') {
        const doc = tryParse(f);
        const el = doc && X.rootElement(doc);
        if (!el || X.getAttr(el, 'jcr:primaryType') !== 'cq:WorkflowModel') continue;
      }
      inv.runtimeModels.push({ module: mod.name, file: f, path: repoPathOf(f, jcrRoot) });
    }
    for (const f of walkFiles(path.join(jcrRoot, 'apps'), n => n.startsWith(RUNNER_PID + '.') || n.startsWith(RUNNER_PID + '~'))) {
      inv.runnerConfigs.push(Object.assign(readRunnerConfig(f, jcrRoot), { module: mod.name }));
    }
    for (const p of readProfiles(jcrRoot)) inv.profiles.push(Object.assign(p, { module: mod.name }));
    for (const a of readAttachedProfiles(jcrRoot)) inv.attachedProfiles.push(Object.assign(a, { module: mod.name }));
  }
  inv.workflows = predictWorkflows(inv);
  return inv;
}

// Port of WorkflowBuilder: which (module, model) pairs the tool treats as asset workflows.
function predictWorkflows(inv) {
  const out = [];
  for (const mod of inv.modules.filter(m => m.contentPackage)) {
    const byModel = new Map();
    const configured = new Set();
    for (const l of inv.launchers.filter(x => x.module === mod.name)) {
      configured.add(l.modelName);
      if (!(l.enabled && l.isAsset)) continue;
      const key = l.workflow;
      if (!byModel.has(key)) {
        const model = inv.models.find(m => m.module === mod.name && m.confPath === l.modelConfPath) || null;
        byModel.set(key, { module: mod.name, modelPath: l.workflow, model, launchers: [], synthetic: false });
      }
      byModel.get(key).launchers.push(l);
    }
    for (const m of inv.models.filter(x => x.module === mod.name)) {
      if (configured.has(m.name) || !DEFAULT_ENABLED_MODELS[m.name]) continue;
      const d = DEFAULT_ENABLED_MODELS[m.name];
      byModel.set(m.confPath, { module: mod.name, modelPath: m.confPath, model: m, synthetic: true, launchers: [{ synthetic: true, glob: d.glob, conditions: d.conditions.slice(), enabled: true, isAsset: true, id: `(default ${m.name} launcher)` }] });
    }
    for (const w of byModel.values()) {
      w.runtimePath = w.model ? w.model.runtimePath : runtimePathFor(confPathFor(w.modelPath));
      w.toolWillMigrate = !!w.model && toolWouldMigrate(w.model);
      w.summary = w.model ? summarizeModel(w.model) : null;
      out.push(w);
    }
  }
  return out;
}

// ModelTransformer only looks at top-level process steps: one enabled step that isn't OPTIONAL/REQUIRED
// (unknown classes and scripts count as enabled) makes the workflow migrate.
function toolWouldMigrate(model) {
  return model.steps.some(s => s.kind === 'process' && ['SUPPORTED', 'CUSTOM', 'SCRIPT', 'NOOP'].includes(s.category));
}

// Asset workflows the migration has to handle: the tool rewrites them, they keep real work only
// inside a split, or they have steps whose renditions are lost once the tool disables their launcher
// (UNSUPPORTED steps such as ImageMagick command lines, rendition steps inside a split, top-level
// rendition steps whose renditions only come back once the tool's processing profile is attached).
const isAffected = w => !!(w.model && w.summary && (w.toolWillMigrate || w.summary.hasRealWork || w.summary.unsupported.length
  || (w.summary.nestedRenditions || []).length || (w.summary.profileRenditions || []).length));

// Affected only through those steps: nothing is left to run in a post-processing workflow, but
// their renditions have to move to a processing profile or be acknowledged.
const isRenditionsOnly = w => isAffected(w) && !w.toolWillMigrate && !w.summary.hasRealWork;

// Removed steps whose output the skill maps to processing-profile renditions or flags: UNSUPPORTED
// steps, and NUI_MIGRATED rendition steps inside a split (the tool maps only top-level ones).
const needsRenditionMapping = s => (!s.kind || s.kind === 'process')
  && (s.category === 'UNSUPPORTED' || (s.category === 'NUI_MIGRATED' && !!(s.split || s.inSplit)));

function summarizeModel(model) {
  const counts = {};
  for (const s of model.flat) if (s.category && s.category !== 'SPLIT') counts[s.category] = (counts[s.category] || 0) + 1;
  const proc = model.flat.filter(s => s.kind === 'process');
  const top = model.steps;
  const completedIdx = top.findIndex(s => s.process === C.COMPLETED_PROCESS);
  const lastProcIdx = (() => { for (let i = top.length - 1; i >= 0; i--) if (top[i].kind !== 'other' || top[i].process) return i; return -1; })();
  return {
    id: model.id,
    counts,
    custom: proc.filter(s => s.category === 'CUSTOM' || s.category === 'SCRIPT').map(s => ({ path: s.path, process: s.process, inSplit: !!s.split })),
    unsupported: proc.filter(s => s.category === 'UNSUPPORTED').map(s => ({ path: s.path, process: s.process, inSplit: !!s.split })),
    nestedRenditions: proc.filter(s => s.category === 'NUI_MIGRATED' && s.split).map(s => ({ path: s.path, process: s.process, inSplit: true })),
    profileRenditions: C.profileRenditionSteps(top).map(s => ({ path: s.path, process: s.process, inSplit: false })),
    removedByCatalog: proc.filter(s => !C.isKept(s.category)).map(s => ({ path: s.path, process: s.process, category: s.category, inSplit: !!s.split })),
    splits: model.flat.filter(s => s.kind === 'or' || s.kind === 'and').map(s => ({ path: s.path, kind: s.kind, branches: s.branches.length })),
    others: model.flat.filter(s => s.kind === 'other').map(s => ({ path: s.path, resourceType: s.resourceType, participant: s.participant })),
    completed: { present: completedIdx >= 0, topLevel: completedIdx >= 0, last: completedIdx >= 0 && completedIdx === lastProcIdx, nested: proc.some(s => s.process === C.COMPLETED_PROCESS && s.split) },
    hasRealWork: proc.some(s => C.isRealWork(s.category)),
    transient: model.transient,
  };
}

// ── Runbook content scan ──────────────────────────────────────────────

function findProjectRoots(workspaceRoot, maxDepth = 2) {
  const out = [];
  const visit = (dir, d) => {
    const pom = readPom(path.join(dir, 'pom.xml'));
    if (pom && pom.modules.length) { out.push(dir); return; }
    if (d >= maxDepth) return;
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(path.join(dir, e.name), d + 1);
  };
  visit(path.resolve(workspaceRoot), 0);
  return out;
}

function runAssetWorkflowScan(workspaceRoot) {
  const empty = extra => Object.assign({ ok: false, findings: [], rawFindings: [], warnings: [] }, extra);
  if (!workspaceRoot) return empty({ error: 'no workspaceRoot' });
  let roots; try { roots = findProjectRoots(workspaceRoot); } catch (e) { return empty({ error: e.message }); }
  const findings = [], rawFindings = [], warnings = [];
  for (const root of roots) {
    let inv; try { inv = buildInventory(root); } catch (e) { warnings.push(`${root}: ${e.message}`); continue; }
    const seen = new Set();
    for (const w of inv.workflows) {
      if (!w.model) { warnings.push(`${w.modelPath}: launcher model not found in module ${w.module}`); continue; }
      const s = w.summary;
      // Same filter as the migration run: models whose steps all run natively need nothing.
      if (!isAffected(w)) continue;
      const key = `${w.module}|${w.model.confPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = [];
      if (s.custom.length) parts.push(`${s.custom.length} custom step(s)`);
      if (s.unsupported.length) parts.push(`${s.unsupported.length} unsupported step(s)`);
      if (s.nestedRenditions.length) parts.push(`${s.nestedRenditions.length} rendition step(s) inside a split`);
      if (s.profileRenditions.length) parts.push(`${s.profileRenditions.length} rendition step(s) whose renditions move to a processing profile`);
      if (s.splits.length) parts.push(`${s.splits.length} split(s)`);
      const launchers = w.launchers.map(l => l.id).join(', ');
      const target = isRenditionsOnly(w) ? 'processing-profile renditions only' : 'post-processing workflow + processing profile';
      findings.push({
        location: path.relative(workspaceRoot, w.model.file) || w.model.file,
        detail: `Asset workflow ${w.model.confPath} (launchers: ${launchers})${parts.length ? ' — ' + parts.join(', ') : ''} → ${target} (Branch F)`,
        severity: s.custom.length || s.unsupported.length || s.nestedRenditions.length ? 'high' : 'medium',
      });
      rawFindings.push({ pattern: 'assetWorkflowMigration', file: w.model.file, line: null, snippet: `model=${w.model.confPath} migrate=${w.toolWillMigrate}` });
    }
  }
  return { ok: true, findings, rawFindings, warnings };
}

module.exports = {
  RUNNER_PID, MIGRATION_APPS, MIGRATION_CONTENT, JCR_ROOT_REL, FILTER_REL, DEFAULT_ENABLED_MODELS,
  buildInventory, summarizeModel, toolWouldMigrate, isAffected, isRenditionsOnly, needsRenditionMapping, runAssetWorkflowScan, findProjectRoots, findModules, readPom,
  readFilter, readLauncher, readModel, readRunnerConfig, readProfiles, parseStep, flattenSteps,
  repoPathOf, confPathFor, runtimePathFor, modelIdOf, globToRunnerEntry, isAssetGlob, parseRunnerEntries, walkFiles, coveredBy,
  runnerEntryRegex, sampleAssetPath, runnerOverlaps, orderMostSpecificFirst,
};
