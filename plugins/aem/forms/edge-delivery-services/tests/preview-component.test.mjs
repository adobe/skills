import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPreviewForm, previewPageHtml, startPreviewServer,
} from '../skills/create-custom-component/scripts/preview-component.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../skills/create-custom-component/scripts/preview-component.mjs');

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ccc-preview-'));
  const dir = join(root, 'blocks/form/components/star-rating');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_star-rating.json'), JSON.stringify({
    definitions: [{ id: 'star-rating', plugins: { xwalk: { page: { template: { fieldType: 'number-input', 'fd:viewType': 'star-rating' } } } } }],
    models: [{ id: 'star-rating', fields: [{ component: 'number', name: 'maxStars', value: 5 }] }],
  }));
  writeFileSync(join(dir, 'star-rating.js'), 'export default function decorate(el) { return el; }\n');
  writeFileSync(join(root, 'head.html'), '<script src="/scripts/aem.js" type="module"></script>');
  return root;
}

test('preview form: prefers the e2e form JSON, else generates one; action always ends with the form id', () => {
  const root = project();
  try {
    const generated = loadPreviewForm('star-rating', root, { props: '{"maxStars":3}' });
    assert.equal(generated.fieldId, 'field-under-test');
    assert.equal(generated.formDef.items[0].properties.maxStars, 3);
    assert.ok(generated.formDef.action.endsWith(`/${generated.formDef.id}`));

    const saved = join(root, 'test/e2e/custom-components/star-rating');
    mkdirSync(saved, { recursive: true });
    writeFileSync(join(saved, 'star-rating.form.json'), JSON.stringify({
      id: 'my-form', action: '', items: [{ id: 'rating', ':type': 'star-rating' }],
    }));
    const fromE2e = loadPreviewForm('star-rating', root);
    assert.equal(fromE2e.fieldId, 'rating');
    assert.equal(fromE2e.formDef.action, '/adobe/forms/af/submit/my-form');

    writeFileSync(join(saved, 'star-rating.form.json'), JSON.stringify({ id: 'x', items: [{ id: 'a' }] }));
    assert.throws(() => loadPreviewForm('star-rating', root), /no item with ":type"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preview page: form JSON in <pre><code>, project head, inspector only when enabled', () => {
  const root = project();
  try {
    const { formDef, fieldId } = loadPreviewForm('star-rating', root);
    const html = previewPageHtml(formDef, root, { fieldId });
    assert.match(html, /<div class="form"><div><div><pre><code>\{/);
    assert.match(html, /\/scripts\/aem\.js/);
    assert.match(html, /ccc-inspector/);
    assert.match(html, /"field-under-test"/);
    assert.doesNotMatch(previewPageHtml(formDef, root, { fieldId, inspector: false }), /ccc-inspector/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preview server: serves page and fresh files with no-store, blocks paths outside the root', async () => {
  const root = project();
  const server = await startPreviewServer(root, '/__preview__/star-rating.html', () => '<html>page</html>');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/__preview__/star-rating.html`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), '<html>page</html>');
    const jsUrl = `${base}/blocks/form/components/star-rating/star-rating.js`;
    const js = await fetch(jsUrl);
    assert.equal(js.headers.get('content-type'), 'text/javascript');
    assert.equal(js.headers.get('cache-control'), 'no-store');
    writeFileSync(join(root, 'blocks/form/components/star-rating/star-rating.js'), '// edited\n');
    assert.equal(await (await fetch(jsUrl)).text(), '// edited\n');
    assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --help writes nothing; missing project or component exits 2', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ccc-preview-help-'));
  const root = project();
  try {
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: empty, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.deepEqual(readdirSync(empty), []);
    assert.equal(spawnSync(process.execPath, [SCRIPT, 'star-rating'], { cwd: empty, encoding: 'utf8' }).status, 2);
    const missing = spawnSync(process.execPath, [SCRIPT, 'nope', '--no-browser'], { cwd: root, encoding: 'utf8' });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /No component folder/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
