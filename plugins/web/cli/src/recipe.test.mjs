import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecipe, resolveLaunch, saveRecipe } from '#src/recipe.mjs';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'recipe-')), 'recipe.json');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('saveRecipe replaces only the given type and keeps the others', () => {
  const file = tmp();
  saveRecipe(file, 'probe', [{ stealth: true }]);
  saveRecipe(file, 'overlays', [{ rules: ['a'] }]);
  saveRecipe(file, 'overlays', [{ rules: ['b'] }]);
  assert.deepEqual(read(file), { probe: [{ stealth: true }], overlays: [{ rules: ['b'] }] });
});

test('saveRecipe refuses to overwrite a file that is not a recipe', () => {
  const file = tmp();
  writeFileSync(file, '{not json');
  assert.throws(() => saveRecipe(file, 'probe', []), { code: 'USAGE' });
  assert.equal(readFileSync(file, 'utf8'), '{not json');
});

test('loadRecipe turns a probe entry into config, persistent and a stealth init script', () => {
  const file = tmp();
  const config = { browserName: 'chromium', launchOptions: { channel: 'chrome' } };
  saveRecipe(file, 'probe', [{ config, persistent: true, stealth: true }]);
  const out = loadRecipe(file);
  assert.deepEqual(out.config, config);
  assert.equal(out.persistent, true);
  assert.equal(out.initSources.length, 1);
  assert.match(out.initSources[0], /webdriver/);
});

test('loadRecipe turns overlay rules into one init script that injects a style', () => {
  const file = tmp();
  saveRecipe(file, 'overlays', [{ rules: ['#a { display:none!important }'] }, { rules: ['.b{}'] }]);
  const { initSources } = loadRecipe(file);
  assert.equal(initSources.length, 1);
  const [source] = initSources;
  assert.ok(source.includes(JSON.stringify('#a { display:none!important }\n.b{}')));
  assert.doesNotThrow(() => new Function(source));
});

test('loadRecipe of an empty recipe adds nothing; a bad path is USAGE', () => {
  const file = tmp();
  writeFileSync(file, '{}');
  assert.deepEqual(loadRecipe(file), { config: undefined, persistent: false, initSources: [] });
  assert.throws(() => loadRecipe('/no/such.json'), { code: 'USAGE', hint: /--save-recipe/ });
});

test('resolveLaunch lets explicit values win and ignores undefined ones', () => {
  const file = tmp();
  saveRecipe(file, 'probe', [{ config: { a: 1 }, persistent: true }]);
  assert.equal(resolveLaunch(file, { persistent: undefined }).persistent, true);
  assert.equal(resolveLaunch(file, { persistent: false }).persistent, false);
  assert.deepEqual(resolveLaunch(undefined, { config: { b: 2 } }), { config: { b: 2 } });
});

test('the overlay init script waits for a root element, then adds the style once', () => {
  const file = tmp();
  saveRecipe(file, 'overlays', [{ rules: ['#a { display:none!important }'] }]);
  const [source] = loadRecipe(file).initSources;
  const added = [];
  const doc = {
    head: null,
    documentElement: null,
    createElement: () => ({ setAttribute() {} }),
  };
  let notify;
  class Observer {
    constructor(fn) {
      notify = fn;
    }
    observe() {}
    disconnect() {
      notify = null;
    }
  }
  new Function('document', 'MutationObserver', source)(doc, Observer);
  assert.equal(added.length, 0);
  doc.documentElement = { appendChild: (el) => added.push(el) };
  notify();
  assert.equal(added.length, 1);
  assert.equal(added[0].textContent, '#a { display:none!important }');
  assert.equal(notify, null);
});

test('a recipe with unknown keys, such as the old flat format, is rejected', () => {
  const file = tmp();
  writeFileSync(file, JSON.stringify({ url: 'http://x', cliConfig: { browser: {} } }));
  assert.throws(() => loadRecipe(file), { code: 'USAGE', message: /unknown keys: url, cliConfig/ });
  assert.throws(() => saveRecipe(file, 'probe', []), { code: 'USAGE' });
});

const bad = (recipe) => {
  const file = tmp();
  writeFileSync(file, JSON.stringify(recipe));
  return file;
};

test('a recipe with the wrong shape is a USAGE error naming the property', () => {
  const cases = [
    [{ overlays: null }, /overlays must be an array/],
    [{ probe: { stealth: true } }, /probe must be an array/],
    [{ overlays: [null] }, /overlays\[0\] must be an object/],
    [{ probe: [[]] }, /probe\[0\] must be an object/],
    [{ probe: [{ stealth: 'yes' }] }, /probe\[0\]\.stealth must be a boolean/],
    [{ probe: [{ persistent: 1 }] }, /probe\[0\]\.persistent must be a boolean/],
    [{ probe: [{ config: [] }] }, /probe\[0\]\.config must be an object/],
    [{ overlays: [{ rules: 'a' }] }, /overlays\[0\]\.rules must be an array of strings/],
    [{ overlays: [{ rules: [1] }] }, /overlays\[0\]\.rules must be an array of strings/],
  ];
  for (const [recipe, message] of cases) {
    const file = bad(recipe);
    assert.throws(() => loadRecipe(file), { code: 'USAGE', message });
    assert.throws(() => saveRecipe(file, 'probe', []), { code: 'USAGE', message });
  }
});
