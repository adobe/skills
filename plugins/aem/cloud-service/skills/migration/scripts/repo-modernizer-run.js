'use strict';
// Branch I — restructure a legacy project into the AEM as a Cloud Service package layout.
//
// Adobe's Repository Modernizer (@adobe/aem-cs-source-migration-repository-modernizer, the
// tool behind Cloud Acceleration Manager's Repository Modernizer) makes the change. This
// script prepares its configuration, runs it, checks its output and copies the output over
// the project. It adds no transformation of its own: what the tool gets wrong is reported
// as a finding, for the agent and the user to fix, and belongs in the tool's issue tracker.
//
//   node scripts/repo-modernizer-run.js plan <project> [--out <plan.json>]
//       Reads the project and writes a plan: the tool's configuration, and what to decide
//       before the run. Changes nothing but the plan's folder.
//   node scripts/repo-modernizer-run.js run <plan.json>
//       Runs the tool into the plan's folder and checks the output. The project is not
//       changed.
//   node scripts/repo-modernizer-run.js adopt <plan.json>
//       Copies the output of a completed run over the project. Needs a clean git working
//       tree, and refuses after a failed run or when the plan changed since the run.
//
// The plan lives in <project>/target/repository-modernizer/, which ignores itself.
// Exit 0: done. 1: the tool failed. 2: stopped before anything was changed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const TOOL_PKG = '@adobe/aem-cs-source-migration-repository-modernizer';
const TOOL_DIR = path.join(__dirname, 'repo-modernizer-tool');
const WORK_DIR = path.join('target', 'repository-modernizer');
const OUTPUT = path.join('target', 'project', 'src'); // where the tool writes, below its working directory
const ISSUES = 'https://github.com/adobe/aem-cloud-service-source-migration/issues';

// The run-mode folders AEM as a Cloud Service reads; it ignores every other config.<x>.
const CLOUD_RUN_MODE = /^config(\.(author|publish))?(\.(dev|rde|stage|prod))?$/;

// ---- reading a Maven project, without a parser: enough for an inventory ----

// The pom without the sections whose <groupId>, <artifactId> and <version> are not its own.
function ownCoordinates(pom) {
  return pom.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(parent|dependencies|dependencyManagement|build|profiles|reporting|distributionManagement|properties)>[\s\S]*?<\/\1>/g, '');
}
const tag = (xml, name) => (xml.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`)) || [])[1] || null;

function readPom(file) {
  const text = fs.readFileSync(file, 'utf8');
  const own = ownCoordinates(text);
  const parent = (text.replace(/<!--[\s\S]*?-->/g, '').match(/<parent>([\s\S]*?)<\/parent>/) || [])[1] || '';
  return {
    text,
    groupId: tag(own, 'groupId') || tag(parent, 'groupId'),
    artifactId: tag(own, 'artifactId'),
    version: tag(own, 'version') || tag(parent, 'version'),
    ownVersion: tag(own, 'version'),
    name: tag(own, 'name'),
    packaging: tag(own, 'packaging') || 'jar',
    modules: [...new Set([...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map((m) => m[1]))],
  };
}

const subdirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'target' && e.name !== 'node_modules' && !e.name.startsWith('.')).map((e) => e.name) : []);
const isModule = (dir) => fs.existsSync(path.join(dir, 'pom.xml'));

function walkDirs(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (visit(child, entry.name) !== false) walkDirs(child, visit);
  }
}

// The OSGi configuration folders of a content package: /apps/**/config and config.<run mode>.
function osgiConfigFolders(jcrRoot) {
  const apps = path.join(jcrRoot, 'apps');
  const found = [];
  if (!fs.existsSync(apps)) return found;
  walkDirs(apps, (dir, name) => {
    if (name !== 'config' && !name.startsWith('config.')) return true;
    found.push({ path: `/${path.relative(jcrRoot, dir).split(path.sep).join('/')}`, name, cloud: CLOUD_RUN_MODE.test(name) });
    return false;
  });
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

const filterRoots = (file) => (fs.existsSync(file) ? [...fs.readFileSync(file, 'utf8').matchAll(/<filter\s[^>]*root="([^"]+)"/g)].map((m) => m[1]) : []);
const isCode = (root) => /^\/(apps|libs|oak:index)(\/|$)/.test(root);

// What a project is made of: its reactor modules and, for content packages, what they deploy.
function inventory(projectRoot) {
  const root = path.resolve(projectRoot);
  const pomFile = path.join(root, 'pom.xml');
  if (!fs.existsSync(pomFile)) throw new Error(`${root} has no pom.xml: name the folder of the project's reactor pom`);
  const pom = readPom(pomFile);
  const modules = pom.modules.map((dir) => {
    const modulePom = path.join(root, dir, 'pom.xml');
    if (!fs.existsSync(modulePom)) return { dir, kind: 'missing' };
    const module = readPom(modulePom);
    const jcrRoot = path.join(root, dir, 'src', 'main', 'content', 'jcr_root');
    const roots = filterRoots(path.join(root, dir, 'src', 'main', 'content', 'META-INF', 'vault', 'filter.xml'));
    const bundle = module.packaging === 'bundle' || (module.packaging === 'jar' && /maven-bundle-plugin|bnd-maven-plugin/.test(module.text));
    const kind = module.packaging === 'content-package' ? 'content-package' : bundle ? 'bundle' : module.packaging === 'pom' && module.modules.length > 0 ? 'reactor' : 'other';
    return {
      dir,
      kind,
      artifactId: module.artifactId,
      packaging: module.packaging,
      ...(kind === 'content-package' ? { filterRoots: roots, mixed: roots.some(isCode) && roots.some((r) => !isCode(r)), osgiConfigFolders: osgiConfigFolders(jcrRoot) } : {}),
      ...(kind === 'bundle' ? { ownVersion: module.ownVersion, felixScr: /maven-scr-plugin|org\.apache\.felix\.scr\.annotations/.test(module.text) } : {}),
    };
  });
  const names = new Set(modules.map((m) => m.dir));
  // a content package in a folder the reactor does not list is not built, and easily forgotten
  const unlisted = subdirs(root).filter((dir) => !names.has(dir) && fs.existsSync(path.join(root, dir, 'pom.xml')) && readPom(path.join(root, dir, 'pom.xml')).packaging === 'content-package');
  const packages = modules.filter((m) => m.kind === 'content-package');
  // the Cloud Service layout: an `all` container, OSGi configuration in its own package, and no package with code and content
  const cloud = names.has('all') && names.has('ui.config') && !packages.some((m) => m.mixed) && !packages.some((m) => m.osgiConfigFolders.length > 0 && m.dir !== 'ui.config');
  return { root, groupId: pom.groupId, artifactId: pom.artifactId, version: pom.version, name: pom.name, modules, unlisted, layout: cloud ? 'cloud' : 'legacy' };
}

// The tool's configuration for one project, as far as the files say, and what is left to decide.
function proposePlan(inv) {
  const packages = inv.modules.filter((m) => m.kind === 'content-package');
  // an integration-test bundle is built, not deployed: it does not go into `all`
  const isTest = (m) => /(^|[.-])(it|tests?|it\.tests)([.-]|$)/.test(m.dir);
  const bundles = inv.modules.filter((m) => m.kind === 'bundle' && !isTest(m));
  const testBundles = inv.modules.filter((m) => m.kind === 'bundle' && isTest(m));
  // the app folder: the first folder below /apps that a filter names, and the artifactId otherwise
  const appFolders = packages.flatMap((m) => m.filterRoots).map((r) => (r.match(/^\/apps\/([^/]+)/) || [])[1]).filter((n) => n && n !== 'sling');
  const appId = appFolders[0] || inv.artifactId;
  const title = inv.name || inv.artifactId;
  const unsupported = packages.flatMap((m) => m.osgiConfigFolders.filter((f) => !f.cloud).map((f) => f.path));
  return {
    repositoryModernizer: {
      groupId: inv.groupId,
      parentPom: { path: path.join(inv.root, 'pom.xml'), artifactId: inv.artifactId, appTitle: title, version: inv.version },
      all: { artifactId: inv.artifactId, appTitle: title, version: inv.version },
      projects: [{
        projectPath: inv.root,
        existingContentPackageFolder: packages.map((m) => `/${m.dir}`),
        relativePathToExistingFilterXml: null,
        relativePathToExistingJcrRoot: null,
        artifactId: inv.artifactId,
        appTitle: title,
        appId,
        version: inv.version,
        coreBundles: bundles.map((m) => `/${m.dir}`),
        osgiFoldersToRename: {},
      }],
    },
    review: {
      layout: inv.layout,
      appId: `"${appId}" names /apps/${appId}/osgiconfig and /apps/${appId}-packages. Confirm it with the user.`,
      contentPackages: packages.map((m) => ({ folder: `/${m.dir}`, filterRoots: m.filterRoots })),
      // Folders with a content package that the reactor pom does not list. Not in
      // existingContentPackageFolder: ask the user whether one is deployed and belongs there.
      contentPackagesOutsideTheReactor: (inv.unlisted || []).map((dir) => `/${dir}`),
      bundles: bundles.map((m) => `/${m.dir}`),
      // Not in coreBundles, so not embedded in `all`. Move one there if it is deployed after all.
      testBundles: testBundles.map((m) => `/${m.dir}`),
      // Cloud Service ignores these. The user decides which Cloud run mode each maps to; the
      // answer goes into osgiFoldersToRename as "<path>": "<new folder name>".
      unsupportedRunModeFolders: unsupported,
      // The tool leaves these out of the new reactor pom. They stay in the project; add each
      // back to <modules> after the run if it still belongs to the build.
      modulesTheToolLeavesOut: inv.modules.filter((m) => m.kind !== 'content-package' && !bundles.includes(m)).map((m) => m.dir),
      subProjects: inv.modules.filter((m) => m.kind === 'reactor').map((m) => m.dir),
    },
  };
}

// ---- the tool ----

const isToolInstalled = (toolDir) => fs.existsSync(path.join(toolDir, 'node_modules', TOOL_PKG, 'index.js'));

function ensureToolInstalled(toolDir = TOOL_DIR) {
  if (isToolInstalled(toolDir)) return { installed: true, alreadyPresent: true };
  // --ignore-scripts: the tool and its dependencies need no install script
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: toolDir, stdio: 'inherit' });
  return { installed: isToolInstalled(toolDir), alreadyPresent: false };
}

// What is wrong with a plan, before the tool runs. The tool checks that the values exist,
// not that the paths do, and copies nothing for a folder it does not find.
function planProblems(plan) {
  const config = plan && plan.repositoryModernizer;
  if (!config || !Array.isArray(config.projects) || config.projects.length === 0) return ['the plan has no repositoryModernizer.projects'];
  const problems = [];
  for (const key of ['groupId']) if (!config[key]) problems.push(`${key} is empty`);
  for (const section of ['parentPom', 'all']) {
    for (const key of section === 'parentPom' ? ['path', 'artifactId', 'appTitle', 'version'] : ['artifactId', 'appTitle', 'version']) {
      if (!config[section] || !config[section][key]) problems.push(`${section}.${key} is empty`);
    }
  }
  if (config.parentPom && config.parentPom.path && !fs.existsSync(config.parentPom.path)) problems.push(`parentPom.path does not exist: ${config.parentPom.path}`);
  const each = (project, label) => {
    for (const key of ['projectPath', 'artifactId', 'appTitle', 'appId', 'version']) if (!project[key]) problems.push(`${label}.${key} is empty`);
    if (!project.projectPath) return;
    if (!path.isAbsolute(project.projectPath) || !fs.existsSync(project.projectPath)) problems.push(`${label}.projectPath is not an existing absolute path: ${project.projectPath}`);
    const packages = project.existingContentPackageFolder || [];
    if (packages.length === 0) problems.push(`${label}.existingContentPackageFolder is empty: the tool has nothing to restructure`);
    for (const folder of [...packages, ...(project.coreBundles || [])]) {
      if (!fs.existsSync(path.join(project.projectPath, folder))) problems.push(`${label}: ${folder} does not exist below ${project.projectPath}`);
    }
    for (const [from, to] of Object.entries(project.osgiFoldersToRename || {})) {
      if (!CLOUD_RUN_MODE.test(to)) problems.push(`${label}.osgiFoldersToRename: "${to}" (for ${from}) is not a run mode AEM as a Cloud Service reads`);
    }
    (project.subProjects || []).forEach((sub, index) => each(sub, `${label}.subProjects[${index}]`));
  };
  config.projects.forEach((project, index) => each(project, `projects[${index}]`));
  return problems;
}

// The tool's own executor resolves its templates from the working directory and so only
// works inside its package folder. This calls the same two functions with the package
// folder as the base, from the working directory, where the tool writes ./target.
const DRIVER = `
const tool = require(process.argv[1]);
const config = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')).repositoryModernizer;
(async () => {
  if (!(await tool.checkConfig(config))) { console.error('The tool refused the configuration: see target/result.log'); process.exit(1); }
  await tool.performModernization(config, process.argv[1]);
})().catch((error) => { console.error(error && error.stack || String(error)); process.exit(1); });
`;

// The warnings and errors of the tool's log, each once, without the timestamp.
function readLog(file) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const of = (level) => [...new Set(lines.map((line) => (line.match(new RegExp(`\\| ${level}: (.*)$`)) || [])[1]).filter(Boolean))];
  return { warnings: of('warn'), errors: of('error') };
}

// The record of a run that finished: adopt copies an output only when this says that the
// tool completed for the plan as it is now. It is removed before every run, so a failed run
// leaves none, and a plan edited after the run no longer matches it.
const RUN_RECORD = 'run.json';
const planHash = (planPath) => crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');

// Why the output next to this plan must not be adopted, or null when it may be.
function outputProblem(planPath) {
  const workDir = path.dirname(path.resolve(planPath));
  const file = path.join(workDir, RUN_RECORD);
  let record = null;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no record, or not readable: the same answer */ }
  if (!record || record.completed !== true) return 'the tool has not completed a run for this plan (the last run failed, or there was none)';
  if (record.plan !== planHash(planPath)) return 'the plan was changed after the run: the output is not what this plan describes';
  if (!fs.existsSync(path.join(workDir, OUTPUT))) return 'the output of the run is gone';
  return null;
}

function runTool(planPath, toolDir = TOOL_DIR) {
  const workDir = path.dirname(path.resolve(planPath));
  fs.rmSync(path.join(workDir, RUN_RECORD), { force: true });
  fs.rmSync(path.join(workDir, 'findings.json'), { force: true });
  fs.rmSync(path.join(workDir, 'target'), { recursive: true, force: true });
  fs.mkdirSync(path.join(workDir, 'target'), { recursive: true });
  const pkg = path.join(toolDir, 'node_modules', TOOL_PKG);
  const r = spawnSync(process.execPath, ['-e', DRIVER, pkg, path.resolve(planPath)], { cwd: workDir, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const log = readLog(path.join(workDir, 'target', 'result.log'));
  const outputDir = path.join(workDir, OUTPUT);
  const reportPath = path.join(workDir, 'target', 'project', 'repository-modernizer-report.md');
  let output = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error) output += String(r.error.message || r.error);
  // the tool logs an error and goes on in places, and writes its report last: without the
  // report, or with an error in the log, the output is not a finished restructuring
  const failed = r.status !== 0 || log.errors.length > 0 || !fs.existsSync(reportPath);
  if (!failed) fs.writeFileSync(path.join(workDir, RUN_RECORD), `${JSON.stringify({ completed: true, plan: planHash(planPath), tool: `${TOOL_PKG}`, finished: new Date().toISOString() }, null, 2)}\n`);
  return { code: failed ? 1 : 0, output, outputDir, reportPath, logPath: path.join(workDir, 'target', 'result.log'), ...log };
}

// ---- the output ----

// Where the tool put a project: one project lands in <output>/<its folder name>; several
// land next to the shared `all`, `analyse` and pom.xml in <output>.
function targets(plan, outputDir) {
  const projects = plan.repositoryModernizer.projects;
  if (projects.length === 1) return { from: path.join(outputDir, path.basename(projects[0].projectPath)), to: projects[0].projectPath };
  const parents = [...new Set(projects.map((p) => path.dirname(p.projectPath)))];
  return parents.length === 1 ? { from: outputDir, to: parents[0] } : null;
}


// What to do about the tool's output before it is built: findings as { id, where, what, next }.
function checkOutput(plan, outputDir, log = { warnings: [], errors: [] }) {
  const findings = [];
  const add = (id, where, what, next) => findings.push({ id, where, what, next });
  const target = targets(plan, outputDir);
  const root = target ? target.from : outputDir;
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');

  const check = (dir, project) => {
    const pomFile = path.join(dir, 'pom.xml');
    const pom = fs.existsSync(pomFile) ? readPom(pomFile) : null;
    const listed = new Set(pom ? pom.modules : []);
    const present = subdirs(dir).filter((name) => isModule(path.join(dir, name)));
    for (const name of present.filter((n) => !listed.has(n))) {
      add('module-not-in-reactor', rel(path.join(dir, name)), `The tool created the module but did not add it to ${rel(pomFile)}.`, `Add <module>${name}</module> to ${rel(pomFile)}; ui.apps.structure goes before ui.apps.`);
    }
    const all = path.join(dir, 'all', 'pom.xml');
    if (fs.existsSync(all)) {
      const empty = (fs.readFileSync(all, 'utf8').match(/<version>\s*<\/version>|<version\s*\/>/g) || []).length;
      if (empty > 0) add('bundle-version-missing', rel(all), `${empty} dependency version(s) are empty: the tool reads a bundle's own <version> and the bundle inherits it from its parent. Maven refuses the project.`, 'Set each to the bundle\'s version, ${project.version} when the bundle has the reactor\'s.');
    }
    if (project) {
      const source = fs.existsSync(path.join(project.projectPath, 'pom.xml')) ? readPom(path.join(project.projectPath, 'pom.xml')).modules : [];
      const handled = new Set([...(project.existingContentPackageFolder || []), ...(project.coreBundles || []), ...(project.subProjects || []).map((s) => s.projectPath.replace(project.projectPath, ''))].map((f) => f.replace(/^\//, '')));
      const left = source.filter((m) => !handled.has(m) && !listed.has(m));
      if (left.length > 0) add('module-left-out', rel(pomFile), `The legacy reactor also built ${left.join(', ')}. The tool neither copies these nor lists them.`, 'For each, decide with the user: add it back to <modules> (it stays in the project), or drop it. A content package among them was not restructured: add it to existingContentPackageFolder and run again.');
      const config = path.join(dir, 'ui.config', 'src', 'main', 'content', 'jcr_root');
      const ignored = osgiConfigFolders(config).filter((f) => !f.cloud);
      if (ignored.length > 0) add('run-mode-unsupported', 'ui.config', `AEM as a Cloud Service ignores ${ignored.map((f) => f.path).join(', ')}.`, 'The user decides which Cloud run mode each maps to. Put the answer into osgiFoldersToRename in the plan and run again; folders that get the same name are merged, and the tool reports a PID that is in both. Environment-specific values go to Cloud Manager variables (Branch A).');
      const xml = [];
      if (fs.existsSync(config)) walkDirs(config, (d) => { for (const f of fs.readdirSync(d)) if (/\.(xml|config|cfg)$/.test(f) && f !== '.content.xml') xml.push(`${rel(path.join(d, f))}`); });
      const notRepoinit = xml.filter((f) => !/RepositoryInitializer/.test(f));
      if (notRepoinit.length > 0) add('osgi-config-not-converted', 'ui.config', `${notRepoinit.length} OSGi configuration(s) are not .cfg.json: ${notRepoinit.slice(0, 5).join(', ')}${notRepoinit.length > 5 ? ', …' : ''}.`, 'Convert each to .cfg.json with the user, typed as AEM read the legacy file.');
      if (fs.existsSync(path.join(dir, 'ui.apps', 'src', 'main', 'content', 'jcr_root', 'libs'))) add('libs-content', 'ui.apps/src/main/content/jcr_root/libs', 'The project deploys content under /libs, which is read-only in AEM as a Cloud Service.', 'Decide each item with the user: overlay it under /apps, or drop it.');
      if (fs.existsSync(path.join(dir, 'ui.apps', 'src', 'main', 'content', 'jcr_root', '_oak_index'))) add('oak-index', 'ui.apps/src/main/content/jcr_root/_oak_index', 'The project deploys Oak index definitions. The tool moves them as they are.', 'Convert them in their own session: Branch F (references/oak-index.md). An index node that no filter root covers fails the FileVault validation of ui.apps: add its root to ui.apps\' filter if the user wants it deployed.');
      // the tool carries the dependencies of the legacy packages into ui.apps, but not those on the project's own bundles
      const uiApps = path.join(dir, 'ui.apps', 'pom.xml');
      const uiAppsText = fs.existsSync(uiApps) ? fs.readFileSync(uiApps, 'utf8') : '';
      const ids = (project.coreBundles || []).map((b) => path.join(dir, b, 'pom.xml')).filter((f) => fs.existsSync(f)).map((f) => readPom(f).artifactId).filter(Boolean);
      const wanted = ids.filter((id) => (project.existingContentPackageFolder || []).some((folder) => {
        const legacy = path.join(project.projectPath, folder, 'pom.xml');
        return fs.existsSync(legacy) && fs.readFileSync(legacy, 'utf8').includes(`<artifactId>${id}</artifactId>`);
      }));
      const lost = wanted.filter((id) => !uiAppsText.includes(`<artifactId>${id}</artifactId>`));
      if (lost.length > 0) add('bundle-dependency-dropped', 'ui.apps/pom.xml', `A legacy content package depended on ${lost.join(', ')}; the new ui.apps does not. Its HTL scripts are compiled during the build and do not find the bundle's classes.`, 'Add each as a dependency of ui.apps with scope provided and the bundle\'s version.');
      for (const bundle of project.coreBundles || []) {
        const bundlePom = path.join(dir, bundle, 'pom.xml');
        if (fs.existsSync(bundlePom) && /maven-scr-plugin|org\.apache\.felix\.scr\.annotations|maven-bundle-plugin/.test(fs.readFileSync(bundlePom, 'utf8'))) {
          add('felix-build', rel(bundlePom), 'The bundle builds with the Felix SCR or bundle plugin. The tool changes a bundle only to replace uber-jar with aem-sdk-api.', 'Hand to code-assessment (SCR annotations to OSGi DS, bnd-maven-plugin) as its own session.');
        }
      }
      (project.subProjects || []).forEach((sub) => check(path.join(dir, sub.projectPath.replace(project.projectPath, '')), sub));
    }
  };
  const projects = plan.repositoryModernizer.projects;
  if (projects.length === 1) check(root, projects[0]);
  else { check(root, null); for (const project of projects) check(path.join(outputDir, path.basename(project.projectPath)), project); }

  for (const warning of log.warnings) {
    const thirdParty = warning.match(/Found 3rd party dependencies : (.*)\.$/);
    if (thirdParty) add('third-party-dependency', 'pom.xml', `The tool names these as third-party dependencies: ${thirdParty[1]}. It calls third-party whatever is outside the groups com.adobe, com.day and org.apache: that names javax.* artifacts AEM provides, and misses org.apache libraries AEM does not provide (POI, Commons).`, 'Go through the bundles\' dependencies with the user, not only this list. For each one AEM does not provide: embed it in `all` when a repository has it, or put its jar into nonadobedependencies/, which the new parent pom reads as a repository.');
    else if (/does not have version defined/.test(warning)) continue; // bundle-version-missing says it
    else if (/Please review the dependencies and plugins|Please verify the Run mode-specific OSGi configuration folders nomenclature/.test(warning)) continue; // printed on every run; build-versions and run-mode-unsupported say it
    else if (/same PID\/filename already exists/.test(warning)) add('osgi-config-conflict', 'ui.config', warning.replace(/^RestructureConfig: /, ''), 'Two folders that were merged hold the same PID. The tool kept the first and left the other in its old folder. Ask the user which values apply, then delete the other.');
    else add('tool-warning', 'target/result.log', warning, 'Read it with the user.');
  }
  const rootPom = path.join(root, 'pom.xml');
  if (fs.existsSync(rootPom)) {
    const text = fs.readFileSync(rootPom, 'utf8');
    const versions = ['filevault-package-maven-plugin', 'content-package-maven-plugin'].map((plugin) => {
      const version = (text.match(new RegExp(`<artifactId>${plugin}</artifactId>\\s*<version>([^<]+)</version>`)) || [])[1];
      return version ? `${plugin} ${version}` : null;
    }).filter(Boolean);
    for (const property of ['aemanalyser.version', 'aem.sdk.api', 'core.wcm.components.version']) {
      const value = tag(text, property.replace(/\./g, '\\.'));
      if (value) versions.push(`${property} ${value}`);
    }
    if (versions.length > 0) add('build-versions', 'pom.xml', `The new parent pom comes from the tool's template and sets ${versions.join(', ')}. The template is older than the current AEM Project Archetype, and the AEM SDK version comes from a search index that lags behind.`, 'Compare with the current AEM Project Archetype and the project\'s Cloud Service release, and update with the user. Keep the Java level the bundles need.');
  }
  return findings;
}

// ---- adopting the output ----

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, dest);
    else fs.copyFileSync(source, dest);
  }
}

// Empties a folder of the project for its replacement. In a git working tree only the files
// git tracks are removed: what git ignores there (a build's target/, IDE settings, a local
// .env) is not in the output and could not be brought back by the undo, so it stays.
function removeModule(dir) {
  if (!fs.existsSync(dir)) return;
  const tracked = spawnSync('git', ['ls-files', '-z', '--', '.'], { cwd: dir, encoding: 'utf8' });
  if (tracked.status !== 0) { fs.rmSync(dir, { recursive: true, force: true }); return; }
  for (const file of tracked.stdout.split('\0').filter(Boolean)) fs.rmSync(path.join(dir, file), { force: true });
  const prune = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) if (entry.isDirectory()) prune(path.join(d, entry.name));
    if (fs.readdirSync(d).length === 0) fs.rmdirSync(d);
  };
  prune(dir);
}

// Copies the output over the project. A module of the output replaces the files git tracks
// in the folder of that name; a reactor of the output replaces only the pom and is followed
// into its modules; a legacy content package that the output no longer has is removed.
// Everything else in the project stays as it is.
function adopt(plan, outputDir) {
  const target = targets(plan, outputDir);
  if (!target) throw new Error('The projects of this plan have no common parent folder: copy the output by hand, with the user.');
  if (!fs.existsSync(target.from)) throw new Error(`No output at ${target.from}: run the tool first.`);
  const replaced = [];
  const removed = [];
  const overlay = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const dest = path.join(to, entry.name);
      if (!entry.isDirectory()) { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(source, dest); continue; }
      const reactor = isModule(source) && subdirs(source).some((name) => isModule(path.join(source, name)));
      if (reactor) { overlay(source, dest); continue; }
      removeModule(dest);
      copyDir(source, dest);
      replaced.push(path.relative(target.to, dest));
    }
  };
  overlay(target.from, target.to);
  const drop = (project) => {
    // the same place in the output: one formula for a project, one of several, and a sub-project
    const out = path.join(target.from, path.relative(target.to, project.projectPath));
    for (const folder of project.existingContentPackageFolder || []) {
      const legacy = path.join(project.projectPath, folder);
      if (fs.existsSync(legacy) && !fs.existsSync(path.join(out, folder))) {
        removeModule(legacy);
        removed.push(path.relative(target.to, legacy));
      }
    }
    (project.subProjects || []).forEach(drop);
  };
  plan.repositoryModernizer.projects.forEach(drop);
  return { projectRoot: target.to, replaced: replaced.sort(), removed: removed.sort() };
}

// ---- command line ----

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function main(argv, out = console.log) {
  const [command, arg, ...rest] = argv;
  const usage = () => { out('usage: repo-modernizer-run.js plan <project> [--out <plan.json>] | run <plan.json> | adopt <plan.json>'); return 2; };
  if (!command || !arg) return usage();

  if (command === 'plan') {
    let inv;
    try { inv = inventory(arg); } catch (error) { out(error.message); return 2; }
    const at = rest.indexOf('--out');
    const planPath = path.resolve(at === -1 ? path.join(inv.root, WORK_DIR, 'plan.json') : rest[at + 1]);
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    if (at === -1) fs.writeFileSync(path.join(path.dirname(planPath), '.gitignore'), '*\n');
    const plan = proposePlan(inv);
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    out(`Plan: ${planPath}`);
    out(`Layout: ${inv.layout}${inv.layout === 'cloud' ? ' — the project already has the Cloud Service layout (all, ui.config, no package with code and content). Stop unless the user says otherwise.' : ''}`);
    out(`Content packages: ${plan.review.contentPackages.map((p) => p.folder).join(', ') || 'none'}`);
    out(`Bundles: ${plan.review.bundles.join(', ') || 'none'}`);
    if (plan.review.contentPackagesOutsideTheReactor.length > 0) out(`Content packages the reactor does not list, not in the plan: ${plan.review.contentPackagesOutsideTheReactor.join(', ')}`);
    if (plan.review.testBundles.length > 0) out(`Test bundles, not embedded in all: ${plan.review.testBundles.join(', ')}`);
    out(`appId: ${plan.repositoryModernizer.projects[0].appId}`);
    if (plan.review.unsupportedRunModeFolders.length > 0) out(`Run-mode folders Cloud Service ignores: ${plan.review.unsupportedRunModeFolders.join(', ')}`);
    if (plan.review.modulesTheToolLeavesOut.length > 0) out(`Modules the tool leaves out of the new reactor: ${plan.review.modulesTheToolLeavesOut.join(', ')}`);
    if (plan.review.subProjects.length > 0) out(`Reactor modules, which the tool takes as subProjects when you describe them in the plan: ${plan.review.subProjects.join(', ')}`);
    return 0;
  }

  if (command !== 'run' && command !== 'adopt') return usage();
  if (!fs.existsSync(arg)) { out(`No plan at ${arg}. Create it with: repo-modernizer-run.js plan <project>`); return 2; }
  let plan;
  try { plan = JSON.parse(fs.readFileSync(arg, 'utf8')); } catch (error) { out(`${arg} is not JSON: ${error.message}`); return 2; }
  const problems = planProblems(plan);
  if (problems.length > 0) { out(`The plan is not ready:\n${problems.map((p) => `  - ${p}`).join('\n')}`); return 2; }
  const workDir = path.dirname(path.resolve(arg));
  const outputDir = path.join(workDir, OUTPUT);

  if (command === 'run') {
    try {
      if (!ensureToolInstalled().installed) { out(`Could not install ${TOOL_PKG} into ${TOOL_DIR}.`); return 2; }
    } catch (error) { out(`Could not install ${TOOL_PKG}: ${error.message}`); return 2; }
    const result = runTool(arg);
    if (result.code !== 0) {
      out(`The Repository Modernizer failed. Its output in ${result.outputDir} is not a finished restructuring: do not use it.`);
      for (const error of result.errors) out(`  error: ${error}`);
      if (result.output.trim()) out(result.output.trim().split('\n').slice(-15).join('\n'));
      out(`Log: ${result.logPath}`);
      return 1;
    }
    const findings = checkOutput(plan, outputDir, result);
    fs.writeFileSync(path.join(workDir, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`);
    out(`Output: ${(targets(plan, outputDir) || { from: outputDir }).from}`);
    out(`The tool's report: ${result.reportPath}`);
    out(`Findings (${findings.length}), also in ${path.join(workDir, 'findings.json')}:`);
    for (const finding of findings) out(`  [${finding.id}] ${finding.where}: ${finding.what}\n      → ${finding.next}`);
    out('The project is unchanged. A finding about the plan: change plan.json and run again. A finding about the output: fix it in the output. Then, with the user\'s agreement: repo-modernizer-run.js adopt <plan.json>');
    return 0;
  }

  const target = targets(plan, outputDir);
  if (!target) { out('The projects of this plan have no common parent folder: copy the output by hand, with the user.'); return 2; }
  const problem = outputProblem(arg);
  if (problem) { out(`Not adopting: ${problem}. Run the tool first: repo-modernizer-run.js run ${arg}. Nothing was changed.`); return 2; }
  if (!fs.existsSync(target.from)) { out(`No output at ${target.from}. Run the tool first: repo-modernizer-run.js run ${arg}`); return 2; }
  const status = git(target.to, 'status', '--porcelain');
  if (status.status !== 0) { out(`${target.to} is not a git working tree: the change could not be reviewed or undone. Nothing was changed.`); return 2; }
  if (status.stdout.trim() !== '') { out(`${target.to} has uncommitted changes. Commit or stash them first: the undo below would take them along. Nothing was changed.`); return 2; }
  const result = adopt(plan, outputDir);
  out(`Replaced: ${result.replaced.join(', ')}`);
  if (result.removed.length > 0) out(`Removed (their content is now in ui.apps, ui.content and ui.config): ${result.removed.join(', ')}`);
  out('Review with: git status, git diff --stat -M. Files that git ignores in the replaced folders were left alone. To undo: git checkout . && git clean -fd');
  return 0;
}

module.exports = { TOOL_PKG, TOOL_DIR, ISSUES, CLOUD_RUN_MODE, readPom, inventory, proposePlan, planProblems, isToolInstalled, ensureToolInstalled, readLog, runTool, outputProblem, targets, checkOutput, adopt, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
