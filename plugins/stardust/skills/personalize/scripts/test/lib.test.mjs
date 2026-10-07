import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseArgs, sitePrefixes } from '../lib.mjs';
import { tempDir } from './helpers.mjs';

describe('lib', () => {
  it('parses flags, values and positionals', () => {
    assert.deepEqual(parseArgs(['a', '--x', '1', '--flag', '--y=2', 'b']), {
      _: ['a', 'b'], x: '1', flag: true, y: '2',
    });
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
