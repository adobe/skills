import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateComponent } from '../skills/edge-delivery-services/create-custom-component/scripts/validate-component.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../skills/edge-delivery-services/create-custom-component/scripts/validate-component.mjs');
const NAME = 'star-rating';

const goodJs = `import { subscribe } from '../../rules/index.js';

export default function decorate(fieldDiv, fd, container, formId) {
  const input = fieldDiv.querySelector('input');
  subscribe(fieldDiv, formId, (_el, model, eventType, payload) => {
    if (eventType === 'register') {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (eventType === 'change') {
      payload?.changes?.forEach(() => {});
    }
  }, { listenChanges: true });
  return fieldDiv;
}
`;

const goodSchema = () => ({
  definitions: [{
    title: 'Star Rating',
    id: NAME,
    plugins: {
      xwalk: {
        page: {
          resourceType: 'core/fd/components/form/numberinput/v1/numberinput',
          template: { 'jcr:title': 'Star Rating', fieldType: 'number-input', 'fd:viewType': NAME },
        },
      },
    },
  }],
  models: [{
    id: NAME,
    fields: [
      {
        component: 'container', name: 'basic', label: 'Basic', '...': '../../models/form-common/_basic-input-fields.json',
      },
      {
        component: 'number', name: 'maxStars', label: 'Max stars', valueType: 'number',
      },
      { '...': '../../models/form-common/_help-container.json' },
    ],
  }],
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ccc-'));
  const files = {
    [`blocks/form/components/${NAME}/${NAME}.js`]: goodJs,
    [`blocks/form/components/${NAME}/${NAME}.css`]: `.${NAME} {}\n`,
    [`blocks/form/components/${NAME}/_${NAME}.json`]: JSON.stringify(goodSchema(), null, 2),
    [`blocks/form/components/${NAME}/README.md`]: '# Star Rating\n\n## Authoring Properties\n\n## Usage Notes\n',
    'blocks/form/mappings.js': `let customComponents = ['range', '${NAME}'];\nconst OOTBComponentDecorators = ['accordion'];\n`,
    'blocks/form/_form.json': JSON.stringify({ filters: [{ id: 'form', components: ['text-input', NAME] }] }),
    'blocks/form/models/form-common/_basic-input-fields.json': '{"fields": []}',
    'blocks/form/models/form-common/_help-container.json': '{}',
    'models/_component-definition.json': JSON.stringify({ groups: [{ id: 'custom-components', components: [{ '...': `../blocks/form/components/${NAME}/_${NAME}.json#/definitions` }] }] }),
    'component-models.json': JSON.stringify([{ id: NAME, fields: [] }]),
    'component-definition.json': JSON.stringify({ x: { 'fd:viewType': NAME } }, null, 2),
    ...overrides,
  };
  Object.entries(files).forEach(([path, content]) => {
    if (content === null) return;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  });
  return root;
}

function run(overrides) {
  const root = makeProject(overrides);
  try {
    return validateComponent(NAME, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const ids = (result, level) => result.checks.filter((c) => c.level === level).map((c) => c.id);

test('a complete, registered and built component passes with no warnings', () => {
  const result = run();
  assert.equal(result.status, 'pass', JSON.stringify(result.checks, null, 2));
  assert.deepEqual(ids(result, 'warn'), []);
});

test('component missing from mappings.js fails', () => {
  const result = run({ 'blocks/form/mappings.js': "let customComponents = ['range'];\nconst OOTBComponentDecorators = [];\n" });
  assert.equal(result.status, 'fail');
  assert.ok(ids(result, 'error').includes('register.mappings'));
});

test('fd:viewType that does not match the folder name fails', () => {
  const schema = goodSchema();
  schema.definitions[0].plugins.xwalk.page.template['fd:viewType'] = 'starrating';
  const result = run({ [`blocks/form/components/${NAME}/_${NAME}.json`]: JSON.stringify(schema) });
  assert.ok(ids(result, 'error').includes('json.viewType'));
});

test('JS file name that differs from the folder fails', () => {
  const result = run({ [`blocks/form/components/${NAME}/${NAME}.js`]: null, [`blocks/form/components/${NAME}/rating.js`]: goodJs });
  assert.ok(ids(result, 'error').includes('files.js'));
});

test('unresolvable shared-field reference and duplicate field names fail', () => {
  const schema = goodSchema();
  schema.models[0].fields.push(
    { '...': '../../models/form-common/_does-not-exist.json#/fields' },
    { component: 'text', name: 'maxStars', label: 'dup' },
  );
  const result = run({ [`blocks/form/components/${NAME}/_${NAME}.json`]: JSON.stringify(schema) });
  const errors = ids(result, 'error');
  assert.ok(errors.includes('json.refs'));
  assert.ok(errors.includes('json.fields'));
});

test('missing default export, syntax errors and extensionless imports fail', () => {
  const js = "import { subscribe } from '../../rules/index';\nfunction decorate( {\n";
  const errors = ids(run({ [`blocks/form/components/${NAME}/${NAME}.js`]: js }), 'error');
  ['js.syntax', 'js.export', 'js.import-ext', 'js.subscribe-import'].forEach((id) => assert.ok(errors.includes(id), id));
});

test('legacy subscribe, non-bubbling change and #id child selector are warned', () => {
  const js = `import { subscribe } from '../../rules/index.js';
export default function decorate(el, fd, c, formId) {
  subscribe(el, formId, (_e, model) => {
    model.subscribe((e) => {}, 'change');
    const child = el.querySelector(\`#\${model.items[0].id}\`);
    child.dispatchEvent(new Event('change'));
  });
  return el;
}
`;
  const warnings = ids(run({ [`blocks/form/components/${NAME}/${NAME}.js`]: js }), 'warn');
  ['js.listenChanges', 'js.legacy-change', 'js.change-bubbles', 'js.child-selector'].forEach((id) => assert.ok(warnings.includes(id), id));
});

test('stale build output, missing README sections and missing filter are warned', () => {
  const result = run({
    'component-models.json': '[]',
    [`blocks/form/components/${NAME}/README.md`]: '# Star Rating\n',
    'blocks/form/_form.json': JSON.stringify({ filters: [{ id: 'form', components: ['text-input'] }] }),
  });
  assert.equal(result.status, 'pass');
  const warnings = ids(result, 'warn');
  ['build.json', 'files.readme', 'register.form-filter'].forEach((id) => assert.ok(warnings.includes(id), id));
});

test('CLI: exit codes, --json output and --help writes nothing', () => {
  const root = makeProject({ 'blocks/form/mappings.js': 'let customComponents = [];\n' });
  try {
    const failed = spawnSync(process.execPath, [SCRIPT, NAME, '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).status, 'fail');

    const empty = mkdtempSync(join(tmpdir(), 'ccc-help-'));
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: empty, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.deepEqual(readdirSync(empty), []);
    rmSync(empty, { recursive: true, force: true });

    assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
