// Run: node --test scripts/page-collect.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { loadBrowserRecipe } = require('./page-collect.js');

function recipeFile(recipe) {
  const path = join(mkdtempSync(join(tmpdir(), 'page-collect-test-')), 'browser-recipe.json');
  writeFileSync(path, JSON.stringify(recipe));
  return path;
}

test('keeps the persistent flag from a browser-probe recipe', () => {
  const recipe = {
    cliConfig: { browser: { browserName: 'chromium', launchOptions: { channel: 'chrome' } } },
    stealthInitScript: '(function () {})();',
    persistent: true,
  };
  assert.deepEqual(loadBrowserRecipe(recipeFile(recipe)), {
    cliConfig: recipe.cliConfig,
    stealthScript: recipe.stealthInitScript,
    persistent: true,
  });
});

test('recipes without the flag, and no recipe, are not persistent', () => {
  assert.equal(loadBrowserRecipe(recipeFile({ cliConfig: {} })).persistent, false);
  assert.equal(loadBrowserRecipe(null).persistent, false);
});
