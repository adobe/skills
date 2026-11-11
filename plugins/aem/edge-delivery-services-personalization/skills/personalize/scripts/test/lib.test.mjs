import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, readdirSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  EDGE_DIR, EDGE_MODULES, PLAYWRIGHT_INSTALL, RUNTIME_DIR, RUNTIME_MODULES, SHARED_WITH_EDGE,
  importAsset, loadPlaywright, parseArgs, readJson, sitePrefixes,
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

  it('lists every runtime and edge module the assets ship', () => {
    const runtime = readdirSync(join(RUNTIME_DIR, 'scripts', 'personalization'), { recursive: true })
      .filter((name) => name.endsWith('.js') && name !== 'config.js');
    assert.deepEqual([...RUNTIME_MODULES].sort(), runtime.sort());
    SHARED_WITH_EDGE.forEach((name) => assert.ok(RUNTIME_MODULES.includes(name), name));
    const edge = readdirSync(join(EDGE_DIR, 'src', 'personalization'), { recursive: true })
      .filter((name) => name.endsWith('.js') && name !== 'edge-config.js');
    assert.deepEqual([...EDGE_MODULES].sort(), edge.sort());
    assert.ok(existsSync(join(EDGE_DIR, 'src', 'personalization', 'edge-config.js')));
  });

  it('imports assets and reads JSON safely', async () => {
    const { parseCondition } = await importAsset('runtime', 'scripts', 'personalization', 'rules.js');
    assert.equal(typeof parseCondition, 'function');
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, 'a.json'), '{"a":1}');
      writeFileSync(join(dir, 'bad.json'), '{');
      assert.deepEqual(readJson(join(dir, 'a.json')), { a: 1 });
      assert.equal(readJson(join(dir, 'bad.json')), null);
      assert.equal(readJson(join(dir, 'none.json')), null);
    } finally {
      cleanup();
    }
  });
});
