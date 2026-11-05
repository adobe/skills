'use strict';
// Branch H runner: pre-flight, then Adobe's wf-migrator (downloaded and checksum-verified, or --jar). The tool
// makes every change to the project; this script only checks the environment, runs it and checks it succeeded.
// Exit codes: 0 tool succeeded, 1 tool failed, 2 stopped before changing anything (pre-flight or bad arguments).
//
//   node asset-workflow-run.js <projectRoot> [--jar <path>] [--report-dir <dir>] [--allow-dirty]
//
// Also exports runAssetWorkflowScan, the runbook's content scan for enabled DAM asset launchers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// 0.7.0 is the first release with split handling, the Completed step, ImageMagick renditions, runner config
// merging and XML formatting (adobe/aem-cloud-migration#25); v0.6.0 has none of them.
const TOOL_VERSION = '0.7.0';
const TOOL_JAR = `wf-migrator-${TOOL_VERSION}.jar`;
const TOOL_URL = `https://github.com/adobe/aem-cloud-migration/releases/download/v${TOOL_VERSION}/${TOOL_JAR}`;
const TOOL_SHA256 = '735eb507c4844df41bc36fd67c2bd0b57415f2873fa3c2b907af747c063a3e30';
const TOOL_DIR = path.join(__dirname, 'asset-workflow-tool');
const MIN_JAVA = 11;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', '.idea', '.vscode']);

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

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

// The tool rewrites files in place; a clean git tree keeps its changes reviewable and undoable.
function checkCleanGitTree(root, excludeDirs) {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  if (inside.error || inside.status !== 0) return { ok: false, git: false, dirty: [], error: 'The project is not in a git repository, so the tool\'s changes could not be undone. Put it under git, or pass --allow-dirty.' };
  const spec = ['.'];
  for (const d of excludeDirs || []) {
    const rel = path.relative(root, d);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) spec.push(`:(exclude)${rel.split(path.sep).join('/')}`);
  }
  const r = spawnSync('git', ['status', '--porcelain', '--', ...spec], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, git: true, dirty: [], error: (r.stderr || '').trim() };
  const dirty = r.stdout.split('\n').filter(Boolean);
  return { ok: dirty.length === 0, git: true, dirty, error: dirty.length ? `The project has ${dirty.length} uncommitted change(s); commit or stash them so the tool's changes are reviewable, or pass --allow-dirty.` : null };
}

// The tool needs a multi-module Maven project with a content-package module.
function checkProject(root) {
  const pom = read(path.join(root, 'pom.xml'));
  if (!pom) return { ok: false, error: `${root} has no pom.xml; point at the root of the Maven project.` };
  const modules = [...pom.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map(m => m[1]);
  if (!modules.length) return { ok: false, error: 'The root pom.xml has no <modules>; the tool needs a multi-module project.' };
  const content = modules.filter(m => /<packaging>\s*content-package\s*<\/packaging>/.test(read(path.join(root, m, 'pom.xml'))));
  if (!content.length) return { ok: false, error: 'No module with <packaging>content-package</packaging>; the tool only scans content packages.' };
  return { ok: true, modules, contentModules: content };
}

// ── Tool install / run ────────────────────────────────────────────────

function ensureToolInstalled(toolDir) {
  const jar = path.join(toolDir || TOOL_DIR, TOOL_JAR);
  if (isFile(jar) && sha256(jar) === TOOL_SHA256) return { installed: true, jar };
  fs.mkdirSync(path.dirname(jar), { recursive: true });
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
  return { installed: true, jar };
}

// The tool exits 0 even when it fails (errors are only logged), so success means: it printed
// "Migration complete." and wrote migration-report.md.
function runMigrator(projectRoot, reportDir, jar, javaCmd) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'migration-report.md');
  fs.rmSync(reportPath, { force: true });
  const r = spawnSync(javaCmd || 'java', ['-jar', jar, projectRoot, reportDir], { cwd: reportDir, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  let log = (r.stdout || '') + (r.stderr || '');
  if (r.error) log += String(r.error.message || r.error);
  const complete = /Migration complete\./.test(log);
  const ok = r.status === 0 && complete && isFile(reportPath);
  let error = null;
  if (!ok) error = r.error ? `could not start java: ${r.error.message}` : !complete ? 'the tool did not report "Migration complete."' : 'migration-report.md was not written';
  // It also prints "Migration complete." after skipping a launcher or model it could not parse.
  const warnings = log.split('\n').filter(l => /Unable to parse|Exception/.test(l) && !/^\s+at /.test(l)).map(l => l.trim());
  return { ok, log, reportPath, warnings, error };
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { root: null, jar: null, reportDir: null, allowDirty: false };
  const take = (i, name) => { if (i + 1 >= argv.length) throw new Error(`${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-dirty') o.allowDirty = true;
    else if (a === '--jar') o.jar = take(i++, a);
    else if (a === '--report-dir') o.reportDir = take(i++, a);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!o.root) o.root = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!o.root) throw new Error('usage: node asset-workflow-run.js <projectRoot> [--jar <path>] [--report-dir <dir>] [--allow-dirty]');
  return o;
}

function migrate(o) {
  const root = path.resolve(o.root);
  const reportDir = path.resolve(o.reportDir || path.join(root, 'target', 'asset-workflow-migration'));
  const stop = error => ({ ok: false, exitCode: 2, error });
  if (reportDir === root || root.startsWith(reportDir + path.sep)) return stop(`--report-dir ${reportDir} must not be the project folder or one of its parents.`);

  const project = checkProject(root);
  if (!project.ok) return stop(project.error);
  const java = checkJava();
  if (!java.ok) return stop(java.error);
  const clean = checkCleanGitTree(root, [reportDir]);
  if (!clean.ok && !o.allowDirty) return stop(clean.error);

  let jar;
  if (o.jar) {
    jar = path.resolve(o.jar);
    if (!isFile(jar)) return stop(`--jar ${jar} does not exist.`);
  } else {
    const inst = ensureToolInstalled(TOOL_DIR);
    if (!inst.installed) return stop(inst.error);
    jar = inst.jar;
  }

  const run = runMigrator(root, reportDir, jar);
  fs.writeFileSync(path.join(reportDir, 'wf-migrator.log'), run.log);
  const jarSha = sha256(jar);
  const version = jarSha === TOOL_SHA256 ? TOOL_VERSION : `custom jar (sha256 ${jarSha.slice(0, 12)}…)`;
  if (!run.ok) return { ok: false, exitCode: 1, version, reportDir, error: `wf-migrator failed: ${run.error}. See ${path.join(reportDir, 'wf-migrator.log')}; the project may be partly changed (git checkout . && git clean -fd to undo).` };
  return { ok: true, exitCode: 0, version, reportDir, reportPath: run.reportPath, warnings: run.warnings };
}

function main(argv, log = console.log) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(e.message); return 2; }
  const r = migrate(o);
  if (!r.ok) { log(r.error); return r.exitCode; }
  log(`wf-migrator ${r.version} finished. Read ${r.reportPath} and review \`git diff\` with the user.`);
  for (const w of r.warnings) log(`WARNING: ${w}`);
  log('To undo: git checkout . && git clean -fd');
  return 0;
}

// ── Runbook content scan ──────────────────────────────────────────────

// One finding per enabled DAM asset launcher the tool would look at (/conf/global/settings or /etc, glob on /content/dam).
// Heuristic: it does not read the models, so launchers that only run out-of-the-box steps are listed too.
function runAssetWorkflowScan(workspaceRoot) {
  const empty = extra => Object.assign({ ok: false, findings: [], rawFindings: [], warnings: [] }, extra);
  if (!workspaceRoot) return empty({ error: 'no workspaceRoot' });
  const findings = [], rawFindings = [];
  const visit = dir => {
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(p); continue; }
      if (!e.name.endsWith('.xml') || !/\/workflow\/launcher\/config\//.test(p.split(path.sep).join('/'))) continue;
      const xml = read(p);
      const attr = n => (new RegExp(`\\s${n}="([^"]*)"`).exec(xml) || [])[1] || '';
      if (attr('jcr:primaryType') !== 'cq:WorkflowLauncher' || attr('enabled') !== '{Boolean}true') continue;
      const glob = attr('glob');
      if (!glob.includes('/content/dam') || glob.includes('collections') || glob.includes('metadata')) continue;
      const id = e.name === '.content.xml' ? path.basename(dir) : e.name.replace(/\.xml$/, '');
      findings.push({
        location: path.relative(workspaceRoot, p) || p,
        detail: `Enabled DAM asset launcher ${id} (glob ${glob}) → workflow ${attr('workflow')} (Branch H)`,
        severity: 'medium',
      });
      rawFindings.push({ pattern: 'assetWorkflowMigration', file: p, line: null, snippet: `launcher=${id} workflow=${attr('workflow')}` });
    }
  };
  visit(path.resolve(workspaceRoot));
  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = {
  TOOL_VERSION, TOOL_URL, TOOL_SHA256, TOOL_DIR,
  parseJavaVersion, checkJava, checkCleanGitTree, checkProject, ensureToolInstalled, runMigrator, parseArgs, migrate, main, runAssetWorkflowScan,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
