#!/usr/bin/env node
/*
 * Generates an end-to-end Playwright test for an AEM Forms custom component.
 *
 * Writes (relative to the repository root):
 *   test/e2e/custom-components/form-harness.js        shared harness (copied from assets/e2e)
 *   test/e2e/custom-components/<name>/<name>.form.json form definition using the component
 *   test/e2e/custom-components/<name>/<name>.spec.js   spec: loads + model sync tests and TODOs
 *
 * No Playwright config is written: run-e2e-test.mjs uses the one shipped with the skill.
 * Existing files are kept unless --force is given. Exit codes: 0 = ok, 2 = usage/project error.
 */
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `create-e2e-test.mjs — generate a Playwright e2e test for an AEM Forms custom component

Usage:
  node create-e2e-test.mjs <component-name> [--root <dir>] [--props <json>] [--force]

Options:
  --root <dir>    Repository root containing package.json and blocks/form (default: cwd)
  --props <json>  Authored properties for the field in the generated form JSON,
                  e.g. '{"min":0,"max":100,"step":5}'
  --force         Overwrite existing harness/spec/form files
  -h, --help      Show this help

Then run, from the repository root:
  node <skill-dir>/scripts/run-e2e-test.mjs <name>

Exit codes: 0 = ok, 2 = usage or project error.`;

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../assets/e2e');
export const FIELD_ID = 'field-under-test';
const NUMERIC_TYPES = new Set(['number-input', 'range']);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--root' || arg === '--props') {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      opts[arg.slice(2)] = argv[i += 1];
    } else if (arg.startsWith('--root=')) opts.root = arg.slice(7);
    else if (arg.startsWith('--props=')) opts.props = arg.slice(8);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.name) opts.name = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return opts;
}

function defaultFor(f) {
  if (f.value !== undefined) return f.value;
  if (f.component === 'boolean') return false;
  if (['select', 'radio-group'].includes(f.component) && f.options?.[0]) return f.options[0].value;
  return undefined;
}

function modelDefaults(fields, out = {}) {
  (fields || []).forEach((f) => {
    if (!f || typeof f !== 'object') return;
    if (Array.isArray(f.fields)) modelDefaults(f.fields, out);
    if (f.name && !['container', 'tab'].includes(f.component) && !f['...']) {
      const v = defaultFor(f);
      if (v !== undefined) out[f.name] = v;
    }
  });
  return out;
}

/** Builds a form definition with one field rendered by the custom component. */
export function buildFormDefinition(name, root, props = {}) {
  const schemaFile = join(root, 'blocks/form/components', name, `_${name}.json`);
  if (!existsSync(schemaFile)) throw new Error(`Missing ${schemaFile}`);
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
  const viewType = (d) => d?.plugins?.xwalk?.page?.template?.['fd:viewType'];
  const def = (schema.definitions || []).find((d) => d.id === name || viewType(d) === name)
    || schema.definitions?.[0];
  const template = def?.plugins?.xwalk?.page?.template || {};
  const fieldType = template.fieldType || 'text-input';
  const model = (schema.models || []).find((m) => m.id === name || m.id === def?.id);

  const item = {
    id: FIELD_ID,
    name: 'fieldUnderTest',
    fieldType,
    ':type': name,
    visible: true,
    enabled: true,
    label: { value: template['jcr:title'] || def?.title || name, visible: true },
    properties: { ...modelDefaults(model?.fields), ...props },
  };
  if (NUMERIC_TYPES.has(fieldType)) item.type = 'number';
  if (fieldType === 'button') item.buttonType = 'button';
  if (fieldType === 'checkbox') item.enum = [true, false];
  if (['drop-down', 'radio-group', 'checkbox-group'].includes(fieldType)) {
    item.enum = ['a', 'b', 'c'];
    item.enumNames = ['Option A', 'Option B', 'Option C'];
    if (fieldType === 'checkbox-group') item.type = 'string[]';
  }
  if (fieldType === 'panel') {
    item.items = [
      {
        id: `${FIELD_ID}-child-1`, name: 'child1', fieldType: 'text-input', label: { value: 'Child 1' },
      },
      {
        id: `${FIELD_ID}-child-2`, name: 'child2', fieldType: 'checkbox', enum: [true, false], label: { value: 'Child 2' },
      },
    ];
  }

  const formId = `${name}-test-form`;
  return {
    id: formId,
    fieldType: 'form',
    title: `${name} e2e test`,
    // createForm() derives the formId passed to components from the last segment of `action`;
    // it must equal `id` or subscribe() callbacks never fire.
    action: `/adobe/forms/af/submit/${formId}`,
    properties: {},
    items: [
      item,
      {
        id: 'next-field', name: 'nextField', fieldType: 'text-input', label: { value: 'Next field' },
      },
    ],
  };
}

function sampleValue(fieldType) {
  if (NUMERIC_TYPES.has(fieldType)) return 42;
  if (fieldType === 'checkbox') return true;
  if (['drop-down', 'radio-group'].includes(fieldType)) return 'b';
  if (fieldType === 'checkbox-group') return ['b'];
  if (fieldType === 'email') return 'jane@example.com';
  return 'sample value';
}

export function specSource(name, fieldType) {
  const hasValue = !['panel', 'button', 'plain-text'].includes(fieldType);
  const valueTest = hasValue ? `
  test('reflects a model value set by a rule or prefill', async ({ page }) => {
    await setModel(page, FIELD, 'value', ${JSON.stringify(sampleValue(fieldType))});
    expect(await getModel(page, FIELD)).toEqual(${JSON.stringify(sampleValue(fieldType))});
    // TODO: assert the component's own UI shows the new value, e.g.
    // await expect(field(page, FIELD).locator('.${name}-display')).toHaveText('...');
    expect(false, 'TODO: assert the component UI reflects the model value').toBe(true);
  });

  test('user interaction updates the form model', async ({ page }) => {
    const changes = await trackChanges(page, FIELD);
    // TODO: interact with the component's UI (click / fill / type / press) as a user would,
    // then assert the committed model value and how many change events rules would see.
    // await field(page, FIELD).locator('...').click();
    // await expect.poll(() => getModel(page, FIELD)).toEqual(...);
    // expect(await changes()).toBe(1);
    expect(changes, 'TODO: drive the UI and assert model value + change count').toBeUndefined();
  });
` : `
  test('reacts to model changes', async ({ page }) => {
    // TODO: change the model (setModel / dispatchModelEvent on this field or its children)
    // and assert the component's DOM reacts.
    expect(page, 'TODO: assert behaviour driven by the model').toBeUndefined();
  });

  test('user interaction updates the form model', async ({ page }) => {
    // TODO: interact with the component and assert the resulting model state.
    expect(page, 'TODO: drive the UI and assert model state').toBeUndefined();
  });
`;

  return `import {
  test, expect, renderForm, loadFormJson, field, getModel, setModel, dispatchModelEvent, trackChanges,
} from '../form-harness.js';

// End-to-end test for the "${name}" custom component. The form is rendered locally from
// ${name}.form.json (no deployed page needed). Replace every TODO with real assertions;
// add more forms/fields to ${name}.form.json for authored-property variants.
const formDef = loadFormJson('${name}');
const FIELD = '${FIELD_ID}';

test.describe('${name} custom component', () => {
  test.beforeEach(async ({ page, formServer }) => {
    await renderForm(page, formServer, formDef);
  });

  test('is loaded by the form block and decorates the field', async ({ page }) => {
    const wrapper = field(page, FIELD);
    await expect(wrapper).toHaveAttribute('data-component-status', 'loaded');
    await expect(wrapper).toBeVisible();
    // TODO: assert the markup/classes the component adds to the OOTB field.
    expect(false, 'TODO: assert the component-specific markup').toBe(true);
  });

  test('applies authored properties', async ({ page }) => {
    // TODO: assert each property from ${name}.form.json (items[0].properties) changes the UI.
    expect(page, 'TODO: assert authored properties are applied').toBeUndefined();
  });
${valueTest}
  test('keeps working with keyboard navigation', async ({ page }) => {
    // TODO: tab into the component, operate it with the keyboard, tab out to "Next field".
    expect(dispatchModelEvent, 'TODO: keyboard / focus behaviour').toBeUndefined();
  });
});
`;
}

function write(file, content, force, written) {
  if (existsSync(file) && !force) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  written.push(file);
}

export function createE2eTest(name, rootDir, { props = {}, force = false } = {}) {
  const root = resolve(rootDir || process.cwd());
  if (!existsSync(join(root, 'blocks/form'))) throw new Error(`No blocks/form under ${root}; run from the repository root or pass --root`);
  const dir = join(root, 'test/e2e/custom-components');
  const written = [];
  ['form-harness.js'].forEach((f) => {
    if (!existsSync(join(dir, f)) || force) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(ASSETS, f), join(dir, f));
      written.push(join(dir, f));
    }
  });
  const formDef = buildFormDefinition(name, root, props);
  write(join(dir, name, `${name}.form.json`), `${JSON.stringify(formDef, null, 2)}\n`, force, written);
  write(join(dir, name, `${name}.spec.js`), specSource(name, formDef.items[0].fieldType), force, written);
  return { root, written: written.map((f) => f.slice(root.length + 1)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(USAGE);
      process.exit(0);
    }
    if (!opts.name) throw new Error('Missing <component-name>');
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  try {
    const props = opts.props ? JSON.parse(opts.props) : {};
    const { written } = createE2eTest(opts.name, opts.root, { props, force: opts.force });
    console.log(written.length ? `Wrote:\n  ${written.join('\n  ')}` : 'All files already exist (use --force to overwrite).');
    console.log(`\nNext: replace the TODOs in test/e2e/custom-components/${opts.name}/${opts.name}.spec.js, then run\n  node ${join(dirname(fileURLToPath(import.meta.url)), 'run-e2e-test.mjs')} ${opts.name}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  }
}
