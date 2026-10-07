import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HOOK_MARKER, installRuntime, planHook } from '../install-runtime.mjs';
import { BOILERPLATE_SCRIPTS, runHelp, siteRepo } from './helpers.mjs';

describe('planHook', () => {
  it('inserts the hook before decorateMain in loadEager with the file indent', () => {
    const plan = planHook(BOILERPLATE_SCRIPTS);
    assert.equal(plan.status, 'pending');
    assert.ok(plan.source.includes([
      "    if (main.querySelector('div.personalization')) {",
      "      const { initPersonalization } = await import('./personalization/index.js');",
      `      ${HOOK_MARKER};`,
      '    }',
      '    decorateMain(main);',
    ].join('\n')));
    // loadLazy's decorateMain is untouched.
    assert.equal(plan.source.split(HOOK_MARKER).length, 2);
    assert.match(plan.patch, /^\+ {4}if \(main/m);
    assert.equal(planHook(plan.source).status, 'installed');
  });

  it('supports 4-space files and reports unknown shapes', () => {
    const four = 'async function loadEager(doc) {\n    const main = doc.querySelector(\'main\');\n    decorateMain(main);\n}\n';
    assert.match(planHook(four).source, /^ {4}if \(main.*\n {6}const/m);
    assert.equal(planHook('function init() {}').status, 'not-found');
    assert.equal(planHook('async function loadEager() {\n  decorate(main);\n}\nasync function x() { decorateMain(main); }').status, 'not-found');
  });
});

describe('installRuntime', () => {
  it('copies the runtime, keeps site files and applies the hook only on request', () => {
    const { dir, cleanup } = siteRepo();
    try {
      const first = installRuntime(dir);
      assert.ok(first.created.includes('scripts/personalization/rules.js'));
      assert.ok(first.created.includes('blocks/personalization/personalization.js'));
      assert.ok(first.kept.includes('blocks/fragment/fragment.js'), 'existing fragment block is never replaced');
      assert.equal(first.hook.status, 'pending');
      assert.equal(readFileSync(join(dir, 'scripts', 'scripts.js'), 'utf8'), BOILERPLATE_SCRIPTS);
      assert.deepEqual(first.warnings, []);

      writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), '// site edit\n');
      writeFileSync(join(dir, 'scripts', 'personalization', 'rules.js'), '// stale\n');
      const second = installRuntime(dir, { applyHook: true });
      assert.ok(second.kept.includes('scripts/personalization/config.js'));
      assert.ok(second.updated.includes('scripts/personalization/rules.js'));
      assert.equal(second.hook.status, 'applied');
      assert.ok(readFileSync(join(dir, 'scripts', 'scripts.js'), 'utf8').includes(HOOK_MARKER));
      assert.equal(readFileSync(join(dir, 'scripts', 'personalization', 'config.js'), 'utf8'), '// site edit\n');

      const third = installRuntime(dir, { applyHook: true });
      assert.equal(third.hook.status, 'installed');
      assert.deepEqual(third.created, []);
      assert.deepEqual(third.updated, []);
    } finally {
      cleanup();
    }
  });

  it('dry-run writes nothing and warns about a missing loadFragment', () => {
    const { dir, cleanup } = siteRepo();
    try {
      writeFileSync(join(dir, 'blocks', 'fragment', 'fragment.js'), 'export default function decorate() {}\n');
      const report = installRuntime(dir, { dryRun: true, applyHook: true });
      assert.ok(report.created.length > 0);
      assert.equal(existsSync(join(dir, 'scripts', 'personalization')), false);
      assert.equal(report.hook.status, 'pending');
      assert.match(report.warnings.join(), /loadFragment/);
    } finally {
      cleanup();
    }
  });
});

describe('install-runtime.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('install-runtime.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
