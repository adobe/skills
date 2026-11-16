'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  TOOL_PKG, CLOUD_RUN_MODE, readPom, inventory, proposePlan, planProblems, readLog, runTool, outputProblem, targets, checkOutput, adopt, main,
} = require('./repo-modernizer-run.js');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rm-')));
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
const pom = (artifactId, packaging, extra = '') => `<project>
  <parent><groupId>com.acme</groupId><artifactId>acme</artifactId><version>1.0-SNAPSHOT</version></parent>
  <artifactId>${artifactId}</artifactId><packaging>${packaging}</packaging>${extra}</project>`;
const filter = (...roots) => `<workspaceFilter version="1.0">${roots.map((r) => `<filter root="${r}"/>`).join('')}</workspaceFilter>`;

// A legacy project: one package with code and content, one with content, a bundle, a test
// bundle, a dispatcher module, and a content package the reactor does not list.
function legacy(root = tmp()) {
  write(root, 'pom.xml', `<project><groupId>com.acme</groupId><artifactId>acme</artifactId><version>1.0-SNAPSHOT</version><packaging>pom</packaging><name>Acme Site</name>
    <modules><module>core</module><module>ui.apps</module><module>ui.content</module><module>it.tests</module><module>dispatcher</module></modules>
    <dependencies><dependency><groupId>x</groupId><artifactId>not-mine</artifactId><version>9</version></dependency></dependencies></project>`);
  write(root, 'core/pom.xml', pom('acme.core', 'bundle', '<build><plugins><plugin><artifactId>maven-scr-plugin</artifactId></plugin></plugins></build>'));
  write(root, 'it.tests/pom.xml', pom('acme.it.tests', 'bundle'));
  write(root, 'dispatcher/pom.xml', pom('acme.dispatcher', 'pom'));
  write(root, 'ui.apps/pom.xml', pom('acme.ui.apps', 'content-package', '<dependencies><dependency><groupId>com.acme</groupId><artifactId>acme.core</artifactId></dependency></dependencies>'));
  write(root, 'ui.apps/src/main/content/META-INF/vault/filter.xml', filter('/apps/acme', '/apps/sling', '/etc/designs/acme'));
  write(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config/a.xml', '<x/>');
  write(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config.author.prod/a.xml', '<x/>');
  write(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config.qa/a.xml', '<x/>');
  write(root, 'ui.apps/src/main/content/jcr_root/apps/acme/components/page/page.html', '<html/>');
  write(root, 'ui.content/pom.xml', pom('acme.ui.content', 'content-package'));
  write(root, 'ui.content/src/main/content/META-INF/vault/filter.xml', filter('/content/acme'));
  write(root, 'oak-indexes/pom.xml', pom('acme.oak', 'content-package'));
  return root;
}

test('a pom is read for its own coordinates, not its parent\'s or its dependencies\'', () => {
  const root = legacy();
  const reactor = readPom(path.join(root, 'pom.xml'));
  assert.deepStrictEqual([reactor.groupId, reactor.artifactId, reactor.version, reactor.packaging, reactor.name], ['com.acme', 'acme', '1.0-SNAPSHOT', 'pom', 'Acme Site']);
  assert.deepStrictEqual(reactor.modules, ['core', 'ui.apps', 'ui.content', 'it.tests', 'dispatcher']);
  const core = readPom(path.join(root, 'core/pom.xml'));
  assert.deepStrictEqual([core.groupId, core.artifactId, core.version, core.ownVersion], ['com.acme', 'acme.core', '1.0-SNAPSHOT', null]);
});

test('the run modes AEM as a Cloud Service reads', () => {
  for (const name of ['config', 'config.author', 'config.publish.prod', 'config.stage', 'config.author.rde']) assert.ok(CLOUD_RUN_MODE.test(name), name);
  for (const name of ['config.qa', 'config.staging', 'config.prod.author', 'config.author.dev1', 'config.local', 'configuration']) assert.ok(!CLOUD_RUN_MODE.test(name), name);
});

test('the inventory tells content packages, bundles and the rest apart, and a legacy layout from a Cloud one', () => {
  const root = legacy();
  const inv = inventory(root);
  assert.strictEqual(inv.layout, 'legacy');
  assert.deepStrictEqual(inv.modules.map((m) => `${m.dir}:${m.kind}`), ['core:bundle', 'ui.apps:content-package', 'ui.content:content-package', 'it.tests:bundle', 'dispatcher:other']);
  const apps = inv.modules.find((m) => m.dir === 'ui.apps');
  assert.strictEqual(apps.mixed, true);
  assert.deepStrictEqual(apps.osgiConfigFolders, [
    { path: '/apps/acme/config', name: 'config', cloud: true },
    { path: '/apps/acme/config.author.prod', name: 'config.author.prod', cloud: true },
    { path: '/apps/acme/config.qa', name: 'config.qa', cloud: false },
  ]);
  assert.strictEqual(inv.modules.find((m) => m.dir === 'core').felixScr, true);
  assert.deepStrictEqual(inv.unlisted, ['oak-indexes']);
  assert.throws(() => inventory(tmp()), /has no pom\.xml/);

  // the Cloud Service layout: all, ui.config, and no package with code and content or with OSGi configuration
  const cloud = tmp();
  write(cloud, 'pom.xml', '<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version><modules><module>all</module><module>ui.apps</module><module>ui.config</module><module>ui.content</module></modules></project>');
  write(cloud, 'all/pom.xml', pom('a.all', 'content-package'));
  write(cloud, 'ui.config/pom.xml', pom('a.ui.config', 'content-package'));
  write(cloud, 'ui.config/src/main/content/jcr_root/apps/a/osgiconfig/config/x.cfg.json', '{}');
  write(cloud, 'ui.apps/pom.xml', pom('a.ui.apps', 'content-package'));
  write(cloud, 'ui.apps/src/main/content/META-INF/vault/filter.xml', filter('/apps/a'));
  write(cloud, 'ui.content/pom.xml', pom('a.ui.content', 'content-package'));
  write(cloud, 'ui.content/src/main/content/META-INF/vault/filter.xml', filter('/content/a'));
  assert.strictEqual(inventory(cloud).layout, 'cloud');
});

test('the plan is the tool\'s configuration, and names what the user has to decide', () => {
  const root = legacy();
  const plan = proposePlan(inventory(root));
  const project = plan.repositoryModernizer.projects[0];
  assert.deepStrictEqual([plan.repositoryModernizer.groupId, plan.repositoryModernizer.parentPom.path, plan.repositoryModernizer.all.appTitle], ['com.acme', path.join(root, 'pom.xml'), 'Acme Site']);
  assert.deepStrictEqual(project.existingContentPackageFolder, ['/ui.apps', '/ui.content']);
  assert.deepStrictEqual(project.coreBundles, ['/core']); // not the test bundle
  assert.strictEqual(project.appId, 'acme'); // the folder below /apps, not /apps/sling
  assert.deepStrictEqual(project.osgiFoldersToRename, {}); // the user decides, not the script
  assert.deepStrictEqual(plan.review.testBundles, ['/it.tests']);
  assert.deepStrictEqual(plan.review.unsupportedRunModeFolders, ['/apps/acme/config.qa']);
  assert.deepStrictEqual(plan.review.modulesTheToolLeavesOut, ['it.tests', 'dispatcher']);
  assert.deepStrictEqual(plan.review.contentPackagesOutsideTheReactor, ['/oak-indexes']);
  assert.deepStrictEqual(planProblems(plan), []);
});

test('a plan with a missing value, a folder that is not there or a run mode Cloud Service ignores is not run', () => {
  const root = legacy();
  const plan = proposePlan(inventory(root));
  const project = plan.repositoryModernizer.projects[0];
  project.existingContentPackageFolder.push('/ui.permissions');
  project.osgiFoldersToRename = { '/apps/acme/config.qa': 'config.qa2', '/apps/acme/config.x': 'config.stage' };
  project.appId = '';
  plan.repositoryModernizer.all.version = null;
  assert.deepStrictEqual(planProblems(plan), [
    'all.version is empty',
    'projects[0].appId is empty',
    `projects[0]: /ui.permissions does not exist below ${root}`,
    'projects[0].osgiFoldersToRename: "config.qa2" (for /apps/acme/config.qa) is not a run mode AEM as a Cloud Service reads',
  ]);
  assert.deepStrictEqual(planProblems({}), ['the plan has no repositoryModernizer.projects']);
  project.existingContentPackageFolder = [];
  assert.ok(planProblems(plan).some((p) => /nothing to restructure/.test(p)));
});

// A stand-in for the tool: writes what the real one writes for this project, with its
// known gaps, into ./target of the working directory.
function fakeTool(behaviour = 'ok') {
  const dir = tmp();
  write(dir, `node_modules/${TOOL_PKG}/index.js`, `
const fs = require('fs'); const path = require('path');
const w = (f, c) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
module.exports = {
  async checkConfig(config) { return ${behaviour === 'refuses' ? 'false' : 'Boolean(config.groupId)'}; },
  async performModernization(config, base) {
    if (!fs.existsSync(path.join(base, 'index.js'))) throw new Error('templates not found at ' + base);
    const project = config.projects[0];
    const out = path.join('target/project/src', path.basename(project.projectPath));
    ${behaviour === 'throws' ? "w(path.join(out, 'pom.xml'), '<project><!-- partial --></project>'); w(path.join(out, 'ui.content/pom.xml'), '<project/>'); w('target/result.log', 'Sun | error: could not copy /ui.apps'); throw new Error('getaddrinfo ENOTFOUND search.maven.org');" : ''}
    w(path.join(out, 'pom.xml'), '<project><modules><module>all</module><module>core</module><module>ui.apps</module><module>ui.config</module><module>ui.content</module></modules><properties><aemanalyser.version>0.0.12</aemanalyser.version><aem.sdk.api>2025.7.1</aem.sdk.api></properties><plugin><artifactId>filevault-package-maven-plugin</artifactId>\\n<version>1.1.4</version></plugin></project>');
    w(path.join(out, 'all/pom.xml'), '<project><dependencies><dependency><artifactId>acme.core</artifactId><version></version></dependency></dependencies></project>');
    w(path.join(out, 'core/pom.xml'), fs.readFileSync(path.join(project.projectPath, 'core/pom.xml'), 'utf8'));
    w(path.join(out, 'ui.apps/pom.xml'), '<project><artifactId>acme.ui.apps</artifactId></project>');
    w(path.join(out, 'ui.apps/src/main/content/jcr_root/apps/acme/components/page/page.html'), '<html/>');
    w(path.join(out, 'ui.apps.structure/pom.xml'), '<project/>');
    w(path.join(out, 'ui.config/pom.xml'), '<project/>');
    for (const folder of ['config', 'config.author.prod', project.osgiFoldersToRename['/apps/acme/config.qa'] || 'config.qa']) w(path.join(out, 'ui.config/src/main/content/jcr_root/apps/acme/osgiconfig', folder, 'a.cfg.json'), '{}');
    w(path.join(out, 'ui.content/pom.xml'), '<project/>');
    w(path.join(out, 'ui.content/src/main/content/jcr_root/etc/designs/acme/.content.xml'), '<x/>');
    w('target/result.log', [
      'Sun, 15 Nov 2026 14:32:14 | info: copied',
      'Sun, 15 Nov 2026 14:32:14 | warn: ' + project.projectPath + '/core/pom.xml does not have version defined. Please add version in \\'all\\' pom file.',
      'Sun, 15 Nov 2026 14:32:15 | warn: RestructurePom: Found 3rd party dependencies : jcr, servlet-api.',
      'Sun, 15 Nov 2026 14:32:15 | warn: RestructurePom: Found 3rd party dependencies : jcr, servlet-api.',
      'Sun, 15 Nov 2026 14:32:15 | warn: RestructureConfig: Please verify the Run mode-specific OSGi configuration folders nomenclature; expected folder-name format :config.<author|publish>.<dev|stage|prod>.',
      ${behaviour === 'logs-error' ? "'Sun, 15 Nov 2026 14:32:15 | error: could not copy /ui.apps'," : ''}
    ].join('\\n'));
    ${behaviour === 'no-report' ? '' : "w('target/project/repository-modernizer-report.md', '# report');"}
  },
};`);
  return dir;
}

function planned(root = legacy()) {
  git(root, 'init', '-q');
  write(root, '.gitignore', 'target/\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'legacy');
  const lines = [];
  assert.strictEqual(main(['plan', root], (line) => lines.push(line)), 0);
  return { root, planPath: path.join(root, 'target/repository-modernizer/plan.json'), lines };
}

test('plan writes the plan into a folder that ignores itself, and says what it found', () => {
  const { root, planPath, lines } = planned();
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(planPath), '.gitignore'), 'utf8'), '*\n');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(planPath, 'utf8')).repositoryModernizer.projects[0].coreBundles, ['/core']);
  const text = lines.join('\n');
  assert.match(text, /Layout: legacy/);
  assert.match(text, /Run-mode folders Cloud Service ignores: \/apps\/acme\/config\.qa/);
  assert.match(text, /Content packages the reactor does not list, not in the plan: \/oak-indexes/);
  assert.strictEqual(git(root, 'status', '--porcelain').stdout, ''); // the project is as it was
  assert.strictEqual(main(['plan', tmp()], () => {}), 2);
  assert.strictEqual(main([], () => {}), 2);
});

test('the tool runs in the plan\'s folder with its package as the base, and the project stays as it is', () => {
  const { root, planPath } = planned();
  const result = runTool(planPath, fakeTool());
  assert.strictEqual(result.code, 0, result.output);
  assert.strictEqual(result.outputDir, path.join(root, 'target/repository-modernizer/target/project/src'));
  assert.ok(fs.existsSync(path.join(result.outputDir, path.basename(root), 'ui.config/pom.xml')));
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.warnings.length, 3); // each once
  assert.strictEqual(git(root, 'status', '--porcelain').stdout, '');
});

test('a run is failed when the tool throws, refuses the configuration, logs an error or writes no report', () => {
  const { planPath } = planned();
  const thrown = runTool(planPath, fakeTool('throws'));
  assert.strictEqual(thrown.code, 1);
  assert.match(thrown.output, /ENOTFOUND search\.maven\.org/);
  assert.strictEqual(runTool(planPath, fakeTool('refuses')).code, 1);
  const logged = runTool(planPath, fakeTool('logs-error'));
  assert.deepStrictEqual([logged.code, logged.errors], [1, ['could not copy /ui.apps']]);
  assert.strictEqual(runTool(planPath, fakeTool('no-report')).code, 1); // the tool exits 0 here
});

test('the output is checked for what the tool leaves undone', () => {
  const { planPath } = planned();
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const result = runTool(planPath, fakeTool());
  const findings = checkOutput(plan, result.outputDir, result);
  const by = Object.fromEntries(findings.map((f) => [f.id, f]));
  assert.deepStrictEqual(findings.map((f) => f.id), ['module-not-in-reactor', 'bundle-version-missing', 'module-left-out', 'run-mode-unsupported', 'bundle-dependency-dropped', 'felix-build', 'third-party-dependency', 'build-versions']);
  assert.strictEqual(by['module-not-in-reactor'].where, 'ui.apps.structure');
  assert.match(by['bundle-version-missing'].what, /^1 dependency version\(s\) are empty/);
  assert.match(by['module-left-out'].what, /also built it\.tests, dispatcher\./);
  assert.match(by['run-mode-unsupported'].what, /ignores \/apps\/acme\/osgiconfig\/config\.qa\./);
  assert.match(by['bundle-dependency-dropped'].what, /depended on acme\.core/);
  assert.strictEqual(by['felix-build'].where, 'core/pom.xml');
  assert.match(by['third-party-dependency'].what, /jcr, servlet-api/);
  assert.match(by['build-versions'].what, /filevault-package-maven-plugin 1\.1\.4, aemanalyser\.version 0\.0\.12, aem\.sdk\.api 2025\.7\.1/);
  for (const finding of findings) assert.ok(finding.next.length > 20, finding.id);

  // a run mode the user mapped is no finding any more
  plan.repositoryModernizer.projects[0].osgiFoldersToRename = { '/apps/acme/config.qa': 'config.stage' };
  fs.writeFileSync(planPath, JSON.stringify(plan));
  const again = runTool(planPath, fakeTool());
  assert.ok(!checkOutput(plan, again.outputDir, again).some((f) => f.id === 'run-mode-unsupported'));
});

test('the log gives each warning and error once, without the timestamp', () => {
  const file = write(tmp(), 'result.log', 'Sun | info: a\nSun | warn: b\nMon | warn: b\nMon | error: c\n');
  assert.deepStrictEqual(readLog(file), { warnings: ['b'], errors: ['c'] });
  assert.deepStrictEqual(readLog(path.join(tmp(), 'none.log')), { warnings: [], errors: [] });
});

test('one project lands in a folder of its name; several next to the shared modules; without a common parent there is no target', () => {
  assert.deepStrictEqual(targets({ repositoryModernizer: { projects: [{ projectPath: '/w/acme' }] } }, '/o'), { from: path.join('/o', 'acme'), to: '/w/acme' });
  assert.deepStrictEqual(targets({ repositoryModernizer: { projects: [{ projectPath: '/w/a' }, { projectPath: '/w/b' }] } }, '/o'), { from: '/o', to: '/w' });
  assert.strictEqual(targets({ repositoryModernizer: { projects: [{ projectPath: '/w/a' }, { projectPath: '/x/b' }] } }, '/o'), null);
});

test('adopt replaces the modules of the output, keeps what the tool left out, and can be undone with git', () => {
  const { root, planPath } = planned();
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  plan.repositoryModernizer.projects[0].existingContentPackageFolder.push('/oak-indexes'); // a legacy package the output has no folder for
  const result = runTool(planPath, fakeTool());
  const adopted = adopt(plan, result.outputDir);
  assert.deepStrictEqual(adopted.replaced, ['all', 'core', 'ui.apps', 'ui.apps.structure', 'ui.config', 'ui.content']);
  assert.deepStrictEqual(adopted.removed, ['oak-indexes']);
  assert.ok(fs.existsSync(path.join(root, 'ui.config/src/main/content/jcr_root/apps/acme/osgiconfig/config/a.cfg.json')));
  assert.ok(!fs.existsSync(path.join(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config'))); // the module was replaced, not merged
  assert.ok(fs.existsSync(path.join(root, 'ui.content/src/main/content/jcr_root/etc/designs/acme/.content.xml')));
  assert.ok(fs.existsSync(path.join(root, 'dispatcher/pom.xml')) && fs.existsSync(path.join(root, 'it.tests/pom.xml'))); // left out, so left alone
  assert.match(fs.readFileSync(path.join(root, 'pom.xml'), 'utf8'), /<module>ui\.config<\/module>/);
  git(root, 'checkout', '.');
  git(root, 'clean', '-fdq');
  assert.strictEqual(git(root, 'status', '--porcelain').stdout, '');
  assert.ok(fs.existsSync(path.join(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config/a.xml')));
});

test('adopt refuses the output of a failed run, and an output the plan no longer describes, and changes nothing', () => {
  const { root, planPath } = planned();
  const say = [];
  const out = (line) => say.push(line);
  const untouched = () => {
    assert.strictEqual(git(root, 'status', '--porcelain').stdout, '');
    assert.ok(fs.existsSync(path.join(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config/a.xml')));
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'pom.xml'), 'utf8'), /partial/);
  };

  // the tool wrote a partial output, logged an error and threw
  const failed = runTool(planPath, fakeTool('throws'));
  assert.strictEqual(failed.code, 1);
  assert.ok(fs.existsSync(path.join(failed.outputDir, path.basename(root), 'pom.xml'))); // the partial output is there
  assert.match(outputProblem(planPath), /has not completed a run/);
  assert.strictEqual(main(['adopt', planPath], out), 2);
  assert.match(say.join('\n'), /Not adopting: the tool has not completed a run for this plan/);
  untouched();

  // a good run, then a failed one: the record of the good run does not survive
  assert.strictEqual(runTool(planPath, fakeTool()).code, 0);
  assert.strictEqual(outputProblem(planPath), null);
  assert.strictEqual(runTool(planPath, fakeTool('logs-error')).code, 1);
  assert.match(outputProblem(planPath), /has not completed a run/);
  assert.strictEqual(main(['adopt', planPath], out), 2);
  untouched();

  // a good run, then the plan is edited: the output is not what the plan says
  assert.strictEqual(runTool(planPath, fakeTool()).code, 0);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  plan.repositoryModernizer.projects[0].osgiFoldersToRename = { '/apps/acme/config.qa': 'config.stage' };
  fs.writeFileSync(planPath, JSON.stringify(plan));
  assert.match(outputProblem(planPath), /plan was changed after the run/);
  say.length = 0;
  assert.strictEqual(main(['adopt', planPath], out), 2);
  assert.match(say.join('\n'), /Not adopting: the plan was changed after the run/);
  untouched();
});

test('adopt leaves what git ignores in a replaced module, so the undo brings everything back', () => {
  const { root, planPath } = planned();
  write(root, 'core/target/classes/Old.class', 'built'); // target/ is ignored
  write(root, 'ui.apps/target/old.zip', 'built');
  assert.strictEqual(git(root, 'status', '--porcelain').stdout, '');
  assert.strictEqual(runTool(planPath, fakeTool()).code, 0);
  const say = [];
  assert.strictEqual(main(['adopt', planPath], (line) => say.push(line)), 0);
  assert.ok(fs.existsSync(path.join(root, 'core/target/classes/Old.class')));
  assert.ok(fs.existsSync(path.join(root, 'ui.apps/target/old.zip')));
  assert.ok(!fs.existsSync(path.join(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config'))); // tracked files of the module went
  assert.match(say.join('\n'), /Files that git ignores in the replaced folders were left alone/);
  git(root, 'checkout', '.');
  git(root, 'clean', '-fdq');
  assert.strictEqual(git(root, 'status', '--porcelain').stdout, '');
  assert.ok(fs.existsSync(path.join(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config/a.xml')));
  assert.ok(fs.existsSync(path.join(root, 'core/target/classes/Old.class')));
});

test('the adopt command needs a plan, an output and a clean git tree, and changes nothing without them', () => {
  const { root, planPath } = planned();
  const say = [];
  const out = (line) => say.push(line);
  assert.strictEqual(main(['adopt', path.join(root, 'no-plan.json')], out), 2);
  assert.strictEqual(main(['adopt', planPath], out), 2); // no run yet
  assert.match(say.join('\n'), /Run the tool first/);
  runTool(planPath, fakeTool());
  write(root, 'mine.txt', 'uncommitted');
  assert.strictEqual(main(['adopt', planPath], out), 2);
  assert.match(say.join('\n'), /has uncommitted changes/);
  assert.ok(fs.existsSync(path.join(root, 'ui.apps/src/main/content/jcr_root/apps/acme/config/a.xml')));
  fs.rmSync(path.join(root, 'mine.txt'));
  say.length = 0;
  assert.strictEqual(main(['adopt', planPath], out), 0);
  assert.match(say.join('\n'), /Replaced: all, core, ui\.apps, ui\.apps\.structure, ui\.config, ui\.content/);
  assert.match(say.join('\n'), /To undo: git checkout \. && git clean -fd/);
  // a plan that is not ready is not run either
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  plan.repositoryModernizer.groupId = '';
  fs.writeFileSync(planPath, JSON.stringify(plan));
  assert.strictEqual(main(['run', planPath], out), 2);
  assert.match(say.join('\n'), /The plan is not ready:\n {2}- groupId is empty/);
});
