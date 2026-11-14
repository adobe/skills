import assert from 'node:assert/strict';
import {
  existsSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  LAZY_MARKER, SECTIONS_MARKER, findFunction, installRuntime, planLazyHook, planSectionsHook,
} from '../install-runtime.mjs';
import { RUNTIME_DIR } from '../lib.mjs';
import { BOILERPLATE_SCRIPTS, runHelp, siteRepo } from './helpers.mjs';

// loadLazy as shipped in adobe/aem-boilerplate.
const LAZY = `
async function loadLazy(doc) {
  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
}
`;
const SCRIPTS = BOILERPLATE_SCRIPTS.replace(/\nasync function loadLazy[\s\S]*$/, LAZY);


describe('section hooks', () => {
  it('holds sections right after decorateMain in loadEager', () => {
    const plan = planSectionsHook(SCRIPTS);
    assert.equal(plan.status, 'pending');
    assert.ok(plan.source.includes([
      '    decorateMain(main);',
      "    if (main.querySelector(':scope > .section[data-personalization]')) {",
      "      const { personalizeSections } = await import('./personalization/sections.js');",
      `      await ${SECTIONS_MARKER};`,
      '    }',
      "    document.body.classList.add('appear');",
    ].join('\n')));
    assert.equal(planSectionsHook(plan.source).status, 'installed');
    assert.match(plan.patch, /^ {5}decorateMain\(main\);\n\+ {4}if/m);
  });

  it('supports 4-space files and reports unknown shapes', () => {
    const four = 'async function loadEager(doc) {\n    const main = doc.querySelector(\'main\');\n    decorateMain(main);\n}\n';
    assert.match(planSectionsHook(four).source, /^ {4}if \(main.*\n {6}const/m);
    assert.equal(planSectionsHook('function init() {}').status, 'not-found');
    assert.equal(planSectionsHook('async function loadEager() {\n  decorate(main);\n}\nasync function x() { decorateMain(main); }').status, 'not-found');
  });

  it('arms popups right after loadSections in loadLazy', () => {
    const plan = planLazyHook(SCRIPTS);
    assert.ok(plan.source.includes([
      '  await loadSections(main);',
      "  if (main.querySelector(':scope > .section[data-personalization]')) {",
      "    const { personalizeSectionsLazy } = await import('./personalization/sections.js');",
      `    ${LAZY_MARKER};`,
      '  }',
      '',
      '  const { hash } = window.location;',
    ].join('\n')));
    assert.equal(planLazyHook(plan.source).status, 'installed');
    assert.equal(planLazyHook(BOILERPLATE_SCRIPTS).status, 'not-found');
  });

  it('finds exported and async functions', () => {
    assert.match(findFunction('export function a() {}\nasync function loadLazy(doc) {\n x();\n}\nfunction b() {}', 'loadLazy').body, /x\(\);\n\}$/);
    assert.equal(findFunction('function x() {}', 'loadLazy'), null);
  });
});

describe('installRuntime', () => {
  it('copies the runtime, keeps site files and applies the section hooks only on request', () => {
    const { dir, cleanup } = siteRepo();
    try {
      writeFileSync(join(dir, 'scripts', 'scripts.js'), SCRIPTS);
      const first = installRuntime(dir);
      assert.ok(first.created.includes('scripts/personalization/sections.js'));
      assert.ok(first.created.includes('scripts/personalization/sources/target.js'));
      assert.ok(first.created.includes('styles/target-popup.css'));
      assert.ok(first.kept.includes('blocks/fragment/fragment.js'), 'existing fragment block is never replaced');
      assert.deepEqual(Object.fromEntries(Object.entries(first.hooks).map(([name, hook]) => [name, hook.status])), {
        sections: 'pending', lazy: 'pending',
      });
      assert.equal(first.hook, 'pending');
      assert.equal(readFileSync(join(dir, 'scripts', 'scripts.js'), 'utf8'), SCRIPTS);
      assert.deepEqual(first.warnings, []);

      writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), '// site edit\n');
      writeFileSync(join(dir, 'styles', 'target-popup.css'), '/* site */\n');
      writeFileSync(join(dir, 'scripts', 'personalization', 'rules.js'), '// stale\n');
      const second = installRuntime(dir, { applyHook: true });
      assert.ok(second.kept.includes('scripts/personalization/config.js'));
      assert.ok(second.kept.includes('styles/target-popup.css'));
      assert.ok(second.updated.includes('scripts/personalization/rules.js'));
      assert.equal(second.hook, 'applied');
      const scripts = readFileSync(join(dir, 'scripts', 'scripts.js'), 'utf8');
      assert.ok(scripts.includes(`await ${SECTIONS_MARKER}`) && scripts.includes(LAZY_MARKER));
      assert.equal(readFileSync(join(dir, 'scripts', 'personalization', 'config.js'), 'utf8'), '// site edit\n');

      const third = installRuntime(dir, { applyHook: true });
      assert.equal(third.hook, 'installed');
      assert.deepEqual(third.created, []);
      assert.deepEqual(third.updated, []);
    } finally {
      cleanup();
    }
  });

  it('reports what config.js still needs (contract section 3)', () => {
    const { dir, cleanup } = siteRepo();
    try {
      const fresh = installRuntime(dir, { dryRun: true });
      assert.deepEqual([fresh.config.consent.mode, fresh.config.errors], ['deny', []]);
      assert.match(fresh.config.warnings.join(), /mode is deny/);
      installRuntime(dir);
      writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), "export default { providers: { x: 1 }, consent: { mode: 'cmp' } };");
      const stale = installRuntime(dir);
      assert.ok(stale.kept.includes('scripts/personalization/config.js'), 'the site config is never overwritten');
      assert.match(stale.config.errors.join(), /config.providers is not supported/);
      assert.match(stale.config.errors.join(), /names the consent tool/);
      writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), "export default { consent: { mode: 'cmp', tool: 'onetrust' } };");
      assert.deepEqual(installRuntime(dir).config, {
        consent: {
          mode: 'cmp', tool: 'onetrust', withoutConsent: [], policyRef: '',
        },
        errors: [],
        warnings: [],
      });
    } finally {
      cleanup();
    }
  });

  it('installs every runtime module the asset folder ships', () => {
    const { dir, cleanup } = siteRepo();
    try {
      const report = installRuntime(dir);
      const shipped = readdirSync(join(RUNTIME_DIR, 'scripts', 'personalization'), { recursive: true })
        .filter((name) => name.endsWith('.js')).map((name) => `scripts/personalization/${name}`);
      assert.deepEqual([...report.created].filter((path) => path.startsWith('scripts/personalization/')).sort(), shipped.sort());
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
      assert.equal(report.hooks.sections.status, 'pending');
      assert.equal(report.hooks.lazy.status, 'not-found', 'the helper boilerplate has no loadSections');
      assert.equal(readFileSync(join(dir, 'scripts', 'scripts.js'), 'utf8'), BOILERPLATE_SCRIPTS);
      assert.match(report.warnings.join(), /loadFragment/);
      assert.match(report.warnings.join(), /loadSections/);
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
