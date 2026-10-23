'use strict';
// Branch F one-command runner: pre-flight → gate → baseline → Adobe wf-migrator (pinned JAR) →
// fixers → verification → report. Exit codes: 0 verified, 1 verification or tool failure,
// 2 stopped before changing anything (pre-flight failure or unacknowledged unsupported steps).
//
//   node asset-workflow-run.js <projectRoot> [--dry-run] [--fix-only] [--baseline <dir>]
//     [--acknowledge <step,...|all>] [--rename-ootb-models] [--emit-repoinit]
//     [--report-dir <dir>] [--jar <path>] [--allow-dirty] [--json]
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const C = require('./asset-workflow-catalog.js');
const I = require('./asset-workflow-inventory.js');
const F = require('./asset-workflow-fix.js');
const V = require('./asset-workflow-verify.js');
const R = require('./asset-workflow-report.js');

const TOOL_VERSION = '0.6.0';
const TOOL_JAR = `wf-migrator-${TOOL_VERSION}.jar`;
const TOOL_URL = `https://github.com/adobe/aem-cloud-migration/releases/download/v${TOOL_VERSION}/${TOOL_JAR}`;
const TOOL_SHA256 = 'edc8bbf1d95a1ac0b504d5ca78cf9e8b8d1bd4b56423b40cc55eb754a4f77699';
const TOOL_DIR = path.join(__dirname, 'asset-workflow-tool');
const MIN_JAVA = 11;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', '.idea', '.vscode']);
const BASELINE_FILES = /\.(xml|json|config|cfg)$/;

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// ── Pre-flight ────────────────────────────────────────────────────────

function parseJavaVersion(text) {
  const m = /version "([^"]+)"/.exec(text || '');
  if (!m) return null;
  const parts = m[1].split(/[._-]/).map(Number);
  return { version: m[1], major: parts[0] === 1 ? parts[1] : parts[0] };
}

function checkJava(javaCmd) {
  const r = spawnSync(javaCmd || 'java', ['-version'], { encoding: 'utf8' });
  if (r.error) return { ok: false, error: `java not found (${r.error.code || r.error.message}). Install Java ${MIN_JAVA}+ and put it on PATH.` };
  const v = parseJavaVersion(`${r.stderr}\n${r.stdout}`);
  if (!v) return { ok: false, error: `could not read the Java version from: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}` };
  if (v.major < MIN_JAVA) return Object.assign({ ok: false, error: `Java ${v.version} found; the migration tool needs Java ${MIN_JAVA}+.` }, v);
  return Object.assign({ ok: true }, v);
}

// The tool rewrites files in place, so start from a clean tree to keep its changes reviewable.
function checkCleanGitTree(root, excludeDirs) {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  if (inside.error || inside.status !== 0) return { ok: true, git: false, dirty: [] };
  const spec = ['.'];
  for (const d of excludeDirs || []) {
    const rel = path.relative(root, d);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) spec.push(`:(exclude)${rel.split(path.sep).join('/')}`);
  }
  const r = spawnSync('git', ['status', '--porcelain', '--', ...spec], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, git: true, dirty: [], error: (r.stderr || '').trim() };
  const dirty = r.stdout.split('\n').filter(Boolean);
  return { ok: dirty.length === 0, git: true, dirty };
}

function checkProject(root) {
  if (!isFile(path.join(root, 'pom.xml'))) return { ok: false, error: `${root} has no pom.xml; point at the root of the Maven project.` };
  const pom = I.readPom(path.join(root, 'pom.xml'));
  if (!pom || !pom.modules.length) return { ok: false, error: 'The root pom.xml has no <modules>; the tool needs a multi-module project.' };
  const modules = I.findModules(root);
  const content = modules.filter(m => m.contentPackage);
  if (!content.length) return { ok: false, error: 'No module with <packaging>content-package</packaging>; the tool only scans content packages.' };
  return { ok: true, modules: modules.map(m => m.name), contentModules: content.map(m => m.name) };
}

// ── Tool install / run ────────────────────────────────────────────────

const toolJarPath = toolDir => path.join(toolDir || TOOL_DIR, TOOL_JAR);

function isToolInstalled(toolDir) {
  const jar = toolJarPath(toolDir);
  return isFile(jar) && sha256(jar) === TOOL_SHA256;
}

function ensureToolInstalled(toolDir) {
  toolDir = toolDir || TOOL_DIR;
  const jar = toolJarPath(toolDir);
  if (isToolInstalled(toolDir)) return { installed: true, alreadyPresent: true, jar };
  fs.mkdirSync(toolDir, { recursive: true });
  const tmp = `${jar}.part`;
  const r = spawnSync('curl', ['-fsSL', '--retry', '2', '-o', tmp, TOOL_URL], { encoding: 'utf8', timeout: 300000 });
  if (r.error || r.status !== 0) {
    fs.rmSync(tmp, { force: true });
    return { installed: false, jar, error: `download failed (${r.error ? r.error.message : (r.stderr || '').trim()}). Download ${TOOL_URL} manually and pass --jar <path>.` };
  }
  const got = sha256(tmp);
  if (got !== TOOL_SHA256) {
    fs.rmSync(tmp, { force: true });
    return { installed: false, jar, error: `checksum mismatch for ${TOOL_JAR}: expected ${TOOL_SHA256}, got ${got}.` };
  }
  fs.renameSync(tmp, jar);
  return { installed: true, alreadyPresent: false, jar };
}

// The tool exits 0 even when it fails (errors are only logged), so success means: it printed
// "Migration complete." and wrote migration-report.md.
function runMigrator(projectRoot, reportDir, jar, javaCmd) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'migration-report.md');
  fs.rmSync(reportPath, { force: true });
  const r = spawnSync(javaCmd || 'java', ['-jar', jar, projectRoot, reportDir], { cwd: reportDir, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  let stdout = (r.stdout || '') + (r.stderr || '');
  if (r.error) stdout += String(r.error.message || r.error);
  const complete = /Migration complete\./.test(stdout);
  const ok = r.status === 0 && complete && isFile(reportPath);
  const errors = stdout.split('\n').filter(l => /\bERROR\b|Exception/.test(l)).slice(0, 20);
  let error = null;
  if (!ok) error = r.error ? `could not start java: ${r.error.message}` : !complete ? 'the tool did not report "Migration complete."' : `${path.basename(reportPath)} was not written`;
  return { ok, code: r.status, stdout, reportPath, errors, error };
}

// ── Baseline ──────────────────────────────────────────────────────────

const BASELINE_MARKER = '.asset-workflow-baseline';

// Real path of the nearest existing ancestor plus the rest, so symlinked temp folders compare equal.
function realish(p) {
  const abs = path.resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch {}
    const up = path.dirname(cur);
    if (up === cur) return abs;
    rest.push(path.basename(cur));
    cur = up;
  }
}

const within = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel));
};

// The runner deletes and re-creates <reportDir>/baseline, so the report folder must not be the
// project or one of its ancestors.
function checkReportDir(root, reportDir) {
  if (within(realish(root), realish(reportDir))) return { ok: false, error: `--report-dir ${reportDir} is the project folder or contains it; use a folder under the project's target/ or outside the project.` };
  return { ok: true };
}

// Empties the baseline folder, but only one this runner created (it carries BASELINE_MARKER).
function resetBaseline(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (e) { if (e.code !== 'ENOENT') return { ok: false, error: `cannot use ${dir} as the baseline folder: ${e.message}` }; }
  if (entries.length && !entries.includes(BASELINE_MARKER)) return { ok: false, error: `${dir} already exists and was not created by this runner; move it away or choose another --report-dir.` };
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, BASELINE_MARKER), 'Created by asset-workflow-run.js; emptied on every run.\n');
  return { ok: true };
}
// Copies only the files the inventory, fixers and verification read (XML, JSON, OSGi configs).
function copyTree(src, dest, exclude) {
  const skip = new Set((exclude || []).map(p => path.resolve(p)));
  let copied = 0;
  const visit = (from, to) => {
    let es; try { es = fs.readdirSync(from, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(from, e.name);
      if (skip.has(path.resolve(p))) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(p, path.join(to, e.name)); } else if (e.isFile() && BASELINE_FILES.test(e.name)) {
        fs.mkdirSync(to, { recursive: true });
        fs.copyFileSync(p, path.join(to, e.name));
        copied++;
      }
    }
  };
  visit(src, dest);
  return copied;
}

// --fix-only without --baseline: the committed tree (HEAD) is the state before the tool ran.
function baselineFromGit(root, dest) {
  const prefix = spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8' });
  if (prefix.error || prefix.status !== 0) return { ok: false, error: `${root} is not in a git repository; pass --baseline <dir> with the project as it was before the tool ran.` };
  const p = prefix.stdout.trim().replace(/\/$/, '');
  const tree = p ? `HEAD:${p}` : 'HEAD';
  const ar = spawnSync('git', ['archive', '--format=tar', tree], { cwd: root, maxBuffer: 1024 * 1024 * 1024 });
  if (ar.error || ar.status !== 0) return { ok: false, error: `git archive ${tree} failed: ${ar.error ? ar.error.message : String(ar.stderr).trim()}` };
  fs.mkdirSync(dest, { recursive: true });
  const x = spawnSync('tar', ['-x', '-C', dest], { input: ar.stdout, maxBuffer: 64 * 1024 * 1024 });
  if (x.error || x.status !== 0) return { ok: false, error: `extracting HEAD failed: ${x.error ? x.error.message : String(x.stderr).trim()}` };
  return { ok: true, tree };
}

// ── Plan / gate ───────────────────────────────────────────────────────

const ackMatches = (acks, process) => acks.includes('all') || acks.includes(process) || acks.includes(C.shortName(process));

// Workflows the migration has to handle: rewritten by the tool, wired by the split fixer, or
// renditions-only (steps whose renditions move to a processing profile).
function affectedWorkflows(pre) {
  const seen = new Set();
  return pre.workflows.filter(w => {
    if (!I.isAffected(w)) return false;
    const k = `${w.module}|${w.model.confPath}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Steps whose renditions would be lost (UNSUPPORTED steps, rendition steps inside a split). Steps
// whose output all maps to processing-profile or standard renditions are safe; anything else must
// be acknowledged before the run changes the project.
function gateUnsupported(pre, acknowledge) {
  const acks = (acknowledge || []).map(String);
  const steps = [];
  for (const w of affectedWorkflows(pre)) {
    const need = w.model.flat.filter(x => x.kind === 'process' && I.needsRenditionMapping(x));
    C.mapSteps(need).forEach((maps, k) => {
      const s = need[k];
      const fullyMapped = maps.length > 0 && maps.every(m => m.status !== 'custom');
      const acknowledged = fullyMapped || ackMatches(acks, s.process);
      steps.push({ model: w.model.confPath, path: s.path, process: s.process, fullyMapped, acknowledged,
        custom: maps.filter(m => m.status === 'custom').map(m => `${m.command} — ${m.reason}`), remediation: C.remediationFor(s) });
    });
  }
  const pending = steps.filter(s => !s.acknowledged);
  // The tool deletes every packaged /var/workflow node, so a runtime model without a design-time
  // model in the project would be lost.
  const designIds = new Set(pre.models.map(m => I.modelIdOf(m.confPath)));
  const orphans = (pre.runtimeModels || []).filter(r => !designIds.has(I.modelIdOf(r.path)))
    .map(r => ({ path: r.path, module: r.module, acknowledged: acks.includes('all') || acks.includes(r.path) }));
  const pendingOrphans = orphans.filter(o => !o.acknowledged);
  return { ok: pending.length === 0 && pendingOrphans.length === 0, steps, pending, orphans, pendingOrphans };
}

function planPreview(pre) {
  return affectedWorkflows(pre).map(w => {
    const proc = w.model.flat.filter(s => s.kind === 'process');
    return {
      model: w.model.confPath, module: w.module, synthetic: !!w.synthetic, toolWillMigrate: w.toolWillMigrate, renditionsOnly: I.isRenditionsOnly(w),
      launchers: w.launchers.map(l => ({ id: l.id, glob: l.glob, conditions: l.conditions })),
      keep: proc.filter(s => C.isKept(s.category)).map(s => ({ step: C.shortName(s.process), category: s.category, inSplit: !!s.split })),
      remove: proc.filter(s => !C.isKept(s.category)).map(s => ({ step: C.shortName(s.process), category: s.category, inSplit: !!s.split })),
      splits: w.summary.splits.length, completed: w.summary.completed,
    };
  });
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { root: null, dryRun: false, fixOnly: false, baseline: null, acknowledge: [], renameOotbModels: false, emitRepoinit: false, reportDir: null, jar: null, allowDirty: false, json: false };
  const take = (i, name) => { if (i + 1 >= argv.length) throw new Error(`${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--fix-only') o.fixOnly = true;
    else if (a === '--rename-ootb-models') o.renameOotbModels = true;
    else if (a === '--emit-repoinit') o.emitRepoinit = true;
    else if (a === '--allow-dirty') o.allowDirty = true;
    else if (a === '--json') o.json = true;
    else if (a === '--baseline') o.baseline = take(i++, a);
    else if (a === '--report-dir') o.reportDir = take(i++, a);
    else if (a === '--jar') o.jar = take(i++, a);
    else if (a === '--acknowledge') o.acknowledge.push(...take(i++, a).split(',').map(s => s.trim()).filter(Boolean));
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!o.root) o.root = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!o.root) throw new Error('usage: node asset-workflow-run.js <projectRoot> [--dry-run] [--fix-only] [--baseline <dir>] [--acknowledge <step,...|all>] [--rename-ootb-models] [--emit-repoinit] [--report-dir <dir>] [--jar <path>] [--allow-dirty] [--json]');
  return o;
}

function migrate(o) {
  const temps = [];
  try { return runMigration(o, temps); } finally { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); }
}

function runMigration(o, temps) {
  const root = path.resolve(o.root);
  const reportDir = path.resolve(o.reportDir || path.join(root, 'target', 'asset-workflow-migration'));
  const result = { root, reportDir, stage: 'preflight', ok: false };
  const stop = (stage, error, extra) => Object.assign(result, { stage, ok: false, exitCode: 2, error }, extra || {});

  const project = checkProject(root);
  result.project = project;
  if (!project.ok) return stop('preflight', project.error);
  const rd = checkReportDir(root, reportDir);
  if (!rd.ok) return stop('preflight', rd.error);

  let baseline = o.baseline ? path.resolve(o.baseline) : null;
  if (o.fixOnly && !baseline) {
    if (o.dryRun) {
      baseline = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-workflow-baseline-'));
      temps.push(baseline);
    } else {
      baseline = path.join(reportDir, 'baseline');
      const reset = resetBaseline(baseline);
      if (!reset.ok) return stop('baseline', reset.error);
    }
    result.baseline = baseline;
    const b = baselineFromGit(root, baseline);
    if (!b.ok) return stop('baseline', b.error);
  }
  if (baseline && !isFile(path.join(baseline, 'pom.xml'))) return stop('baseline', `baseline ${baseline} has no pom.xml.`);

  const pre = I.buildInventory(o.fixOnly ? baseline : root);
  result.plan = planPreview(pre);
  const gate = gateUnsupported(pre, o.acknowledge);
  result.gate = gate;
  if (o.dryRun) return Object.assign(result, { stage: 'dry-run', ok: true, exitCode: 0 });
  if (!gate.ok) {
    const why = [];
    if (gate.pending.length) why.push(`${gate.pending.length} step(s) would be removed without a replacement — handle them (see remediation) and re-run with --acknowledge <step,...>`);
    if (gate.pendingOrphans.length) why.push(`${gate.pendingOrphans.length} runtime model(s) under /var/workflow have no design-time model and the tool deletes them — export them into /conf/global/settings/workflow/models first, or --acknowledge <runtime path>`);
    return stop('gate', `${why.join('; ')}.`);
  }

  let tool = { skipped: true };
  if (!o.fixOnly) {
    const java = checkJava();
    result.java = java;
    if (!java.ok) return stop('preflight', java.error);
    const clean = checkCleanGitTree(root, [reportDir]);
    result.git = clean;
    if (!clean.ok && !o.allowDirty) return stop('preflight', `The project has uncommitted changes (${clean.dirty.length}); commit or stash them so the tool's changes are reviewable, or pass --allow-dirty.`);

    let jar;
    if (o.jar) {
      jar = path.resolve(o.jar);
      if (!isFile(jar)) return stop('install', `--jar ${jar} does not exist.`);
    } else {
      const inst = ensureToolInstalled(TOOL_DIR);
      if (!inst.installed) return stop('install', inst.error);
      jar = inst.jar;
    }

    baseline = path.join(reportDir, 'baseline');
    const reset = resetBaseline(baseline);
    if (!reset.ok) return stop('baseline', reset.error);
    result.baseline = baseline;
    copyTree(root, baseline, [reportDir]);

    result.stage = 'tool';
    const run = runMigrator(root, path.join(reportDir, 'tool'), jar);
    const jarSha = sha256(jar);
    tool = { version: jarSha === TOOL_SHA256 ? TOOL_VERSION : `custom jar (sha256 ${jarSha.slice(0, 12)}…)`, jar, ok: run.ok, reportPath: run.reportPath, errors: run.errors };
    fs.writeFileSync(path.join(reportDir, 'tool', 'wf-migrator.log'), run.stdout);
    result.tool = tool;
    if (!run.ok) return Object.assign(result, { ok: false, exitCode: 1, error: `wf-migrator failed: ${run.error}. See ${path.join(reportDir, 'tool', 'wf-migrator.log')}; the project may be partly changed (git checkout . to undo).` });
  }

  result.stage = 'fix';
  const fix = F.applyFixes(root, baseline, { acknowledge: o.acknowledge, renameOotbModels: o.renameOotbModels, emitRepoinit: o.emitRepoinit });
  const post = I.buildInventory(root);
  result.stage = 'verify';
  const verify = V.verifyMigration(pre, post, { fix, acknowledge: o.acknowledge });
  const md = R.renderReport({ pre, post, fix, verify, tool, opts: o, gate });
  result.report = R.writeReport(reportDir, md);
  Object.assign(result, { stage: 'done', ok: verify.ok, exitCode: verify.ok ? 0 : 1, tool, fix: { changedFiles: fix.changedFiles, deletedFiles: fix.deletedFiles, actions: fix.actions.length, manual: fix.manual.length, workflows: fix.workflows.map(w => w.confPath), runner: fix.runner }, verify });
  fs.writeFileSync(path.join(reportDir, 'asset-workflow-result.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

function printText(r, log) {
  if (r.plan) {
    log(`Asset workflows to migrate: ${r.plan.length}`);
    for (const p of r.plan) {
      const how = p.renditionsOnly ? ' (renditions only: launcher disabled, no post-processing workflow)' : p.toolWillMigrate ? '' : ' (wired by this skill: real work only inside a split)';
      log(`  ${p.model}${p.synthetic ? ' (OOTB default, overlaid)' : ''}${how}`);
      for (const l of p.launchers) log(`    launcher ${l.id}: ${l.glob}${l.conditions.length ? ` [conditions: ${l.conditions.join(' AND ')}]` : ''}`);
      log(`    keep:   ${p.keep.map(s => `${s.step}${s.inSplit ? '*' : ''}`).join(', ') || '—'}`);
      log(`    remove: ${p.remove.map(s => `${s.step}${s.inSplit ? '*' : ''} (${s.category})`).join(', ') || '—'}`);
    }
  }
  if (r.gate) {
    for (const s of r.gate.steps) {
      log(`  ${s.acknowledged ? 'ok  ' : 'STOP'} ${C.shortName(s.process)} in ${s.model} — ${s.fullyMapped ? 'everything it produced maps to processing-profile or standard renditions' : s.acknowledged ? 'acknowledged' : 'needs --acknowledge'}`);
      for (const c of s.custom) log(`         ${c}`);
      if (!s.acknowledged && s.remediation) log(`         ${s.remediation}`);
    }
    for (const o of r.gate.orphans) log(`  ${o.acknowledged ? 'ok  ' : 'STOP'} ${o.path} has no design-time model — the tool deletes it${o.acknowledged ? ' (acknowledged)' : ''}`);
  }
  if (r.error) log(`\n${r.stage}: ${r.error}`);
  if (r.verify) {
    log(`\nChanged ${r.fix.changedFiles.length} file(s), ${r.fix.actions} fix(es), ${r.fix.manual} follow-up(s).`);
    log(`Verification: ${r.verify.ok ? 'PASS' : `FAIL (${r.verify.failures.length})`}`);
    for (const f of r.verify.failures) log(`  ${f.category}: ${f.detail}`);
  }
  if (r.report) log(`Report: ${r.report}`);
}

function main(argv, log) {
  log = log || console.log;
  let o;
  try { o = parseArgs(argv); } catch (e) { log(e.message); return 2; }
  const r = migrate(o);
  if (o.json) log(JSON.stringify(r, null, 2)); else printText(r, log);
  return r.exitCode;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  TOOL_VERSION, TOOL_URL, TOOL_SHA256, TOOL_DIR, TOOL_JAR, MIN_JAVA, BASELINE_MARKER,
  parseJavaVersion, checkJava, checkCleanGitTree, checkProject, isToolInstalled, ensureToolInstalled, runMigrator,
  copyTree, baselineFromGit, checkReportDir, resetBaseline, affectedWorkflows, gateUnsupported, planPreview, parseArgs, migrate, main,
};
