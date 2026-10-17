import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  PLAYWRIGHT_INSTALL, loadPlaywright, parseArgs, sitePrefixes,
} from '../lib.mjs';
import { tempDir } from './helpers.mjs';

describe('lib', () => {
  it('parses flags, values and positionals', () => {
    assert.deepEqual(parseArgs(['a', '--x', '1', '--flag', '--y=2', 'b']), {
      _: ['a', 'b'], x: '1', flag: true, y: '2',
    });
  });

  it('loads playwright only from the given folders and installs into the cache', () => {
    const { dir, cleanup } = tempDir();
    try {
      assert.equal(loadPlaywright([dir]), null);
      mkdirSync(join(dir, 'node_modules', 'playwright'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'playwright', 'package.json'), '{"name":"playwright","main":"index.js"}');
      writeFileSync(join(dir, 'node_modules', 'playwright', 'index.js'), 'module.exports = { fake: true };');
      assert.deepEqual(loadPlaywright([dir]), { fake: true });
      assert.match(PLAYWRIGHT_INSTALL, /^npm i --prefix \S+ playwright && npx --prefix \S+ playwright install chromium$/);
      assert.doesNotMatch(PLAYWRIGHT_INSTALL, /-D|--no-save/);
    } finally {
      cleanup();
    }
  });

  it('reads fragment prefixes from the site config', () => {
    const { dir, cleanup } = tempDir();
    try {
      assert.deepEqual(sitePrefixes(dir), ['/fragments/']);
      mkdirSync(join(dir, 'scripts', 'personalization'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), "export default { fragmentPrefixes: ['/fragments/', \"/pzn/\"] };");
      assert.deepEqual(sitePrefixes(dir), ['/fragments/', '/pzn/']);
    } finally {
      cleanup();
    }
  });
});
