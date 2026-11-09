import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFormDefinition, createE2eTest, FIELD_ID } from '../skills/create-custom-component/scripts/create-e2e-test.mjs';
import { buildCommand } from '../skills/create-custom-component/scripts/run-e2e-test.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../skills/create-custom-component/scripts/create-e2e-test.mjs');

function project(name, fieldType, modelFields = []) {
  const root = mkdtempSync(join(tmpdir(), 'ccc-e2e-'));
  const dir = join(root, 'blocks/form/components', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `_${name}.json`), JSON.stringify({
    definitions: [{
      title: 'Thing',
      id: name,
      plugins: { xwalk: { page: { resourceType: 'core/fd/components/form/x/v1/x', template: { 'jcr:title': 'Thing', fieldType, 'fd:viewType': name } } } },
    }],
    models: [{ id: name, fields: modelFields }],
  }));
  return root;
}

test('form definition: field uses the component, action ends with the form id, defaults + props', () => {
  const root = project('star-rating', 'number-input', [
    { '...': '../../models/form-common/_basic.json#/fields' },
    {
      component: 'container',
      name: 'cfg',
      fields: [
        {
          component: 'number', name: 'maxStars', value: 5,
        },
        { component: 'boolean', name: 'allowHalf' },
        {
          component: 'select', name: 'size', options: [{ name: 'S', value: 's' }, { name: 'L', value: 'l' }],
        },
        { component: 'text', name: 'hint' },
      ],
    },
  ]);
  try {
    const def = buildFormDefinition('star-rating', root, { maxStars: 3 });
    assert.equal(def.fieldType, 'form');
    // createForm() passes the last segment of `action` to components as formId
    assert.ok(def.action.endsWith(`/${def.id}`));
    const [item, next] = def.items;
    assert.equal(item.id, FIELD_ID);
    assert.equal(item[':type'], 'star-rating');
    assert.equal(item.fieldType, 'number-input');
    assert.equal(item.type, 'number');
    assert.deepEqual(item.properties, { maxStars: 3, allowHalf: false, size: 's' });
    assert.equal(next.fieldType, 'text-input');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('form definition: option and panel base types get enums / children', () => {
  const root = project('picker', 'drop-down');
  const panelRoot = project('consent', 'panel');
  try {
    const dd = buildFormDefinition('picker', root).items[0];
    assert.equal(dd.enum.length, dd.enumNames.length);
    const panel = buildFormDefinition('consent', panelRoot).items[0];
    assert.ok(panel.items.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(panelRoot, { recursive: true, force: true });
  }
});

test('createE2eTest writes harness, form JSON and a spec with failing TODOs; keeps edits without --force', () => {
  const root = project('star-rating', 'number-input');
  try {
    const { written } = createE2eTest('star-rating', root);
    const base = 'test/e2e/custom-components';
    assert.deepEqual(written.sort(), [
      `${base}/form-harness.js`,
      `${base}/star-rating/star-rating.form.json`, `${base}/star-rating/star-rating.spec.js`,
    ].sort());
    const spec = readFileSync(join(root, base, 'star-rating/star-rating.spec.js'), 'utf8');
    assert.match(spec, /from '\.\.\/form-harness\.js'/);
    assert.match(spec, /loadFormJson\('star-rating'\)/);
    assert.match(spec, /data-component-status', 'loaded'/);
    assert.match(spec, /setModel\(page, FIELD, 'value'/);
    assert.ok((spec.match(/TODO:/g) || []).length >= 4);
    const harness = readFileSync(join(root, base, 'form-harness.js'), 'utf8');
    assert.match(harness, /<pre><code>/);

    writeFileSync(join(root, base, 'star-rating/star-rating.spec.js'), '// edited');
    assert.deepEqual(createE2eTest('star-rating', root).written, []);
    assert.equal(readFileSync(join(root, base, 'star-rating/star-rating.spec.js'), 'utf8'), '// edited');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --help writes nothing, missing project exits 2', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ccc-e2e-help-'));
  try {
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: empty, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.deepEqual(readdirSync(empty), []);
    const missing = spawnSync(process.execPath, [SCRIPT, 'x'], { cwd: empty, encoding: 'utf8' });
    assert.equal(missing.status, 2);
    assert.ok(!existsSync(join(empty, 'test')));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('run-e2e-test uses the skill config, never a project config, and reports missing Playwright', () => {
  const root = project('star-rating', 'number-input');
  try {
    createE2eTest('star-rating', root);
    writeFileSync(join(root, 'package.json'), '{}');
    assert.throws(() => buildCommand({ name: 'star-rating', root, extra: [] }), /@playwright\/test is not installed/);

    const pw = join(root, 'node_modules/@playwright/test');
    mkdirSync(pw, { recursive: true });
    writeFileSync(join(pw, 'package.json'), '{"name":"@playwright/test","exports":{"./package.json":"./package.json"}}');
    writeFileSync(join(pw, 'cli.js'), '');
    const { args } = buildCommand({ name: 'star-rating', root, extra: [] });
    const config = args[args.indexOf('--config') + 1];
    assert.match(config, /assets[\\/]e2e[\\/]playwright\.config\.mjs$/);
    assert.ok(existsSync(config));
    assert.ok(!config.startsWith(root));
    assert.ok(args.includes('custom-components/star-rating/'));
    assert.throws(() => buildCommand({ name: 'nope', root, extra: [] }), /No tests at/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
